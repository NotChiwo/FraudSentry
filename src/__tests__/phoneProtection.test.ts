// Phone Protection (V10.4, Android): incoming messages are checked in the
// background by the SAME analyzer as the Check Message page, only suspicious
// ones are kept, and they come into the app's database with their alerts.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeForBackground } from '../background/analyzerEntry';
import { toBackgroundScan, newBackgroundScans, originLabel, dataUrlToFile } from '../background/backgroundScan';
import { analyzeMessageText } from '../message-check/messageAnalysis';
import { useAppStore } from '../shared/store';

const SCAM = 'GCash: Your account will be suspended today. Verify your identity at http://gcash-verify-ph.xyz/login and enter the OTP we sent.';
const ORDINARY = 'Hi, available pa po ba yung item? Pick up na lang po bukas.';
const fromQueue = (text: string, extra: Record<string, unknown> = {}) =>
  ({ ...JSON.parse(analyzeForBackground(text, 'SMS')), origin: 'background', sourceApp: 'Messages (SMS)', sender: '0917 555 0142', ...extra });

describe('the background analyzer', () => {
  it('gives the same result as the Check Message page', () => {
    for (const t of [SCAM, ORDINARY]) {
      const bg = JSON.parse(analyzeForBackground(t, 'SMS'));
      const page = analyzeMessageText(t, 'SMS');
      expect([bg.threatLevel, bg.scamType, bg.riskScore, bg.flags.length]).toEqual([page.threatLevel, page.scamType, page.riskScore, page.flags.length]);
    }
  });
  it('flags the scam and leaves an ordinary message low (so it is not kept)', () => {
    expect(['high', 'critical']).toContain(JSON.parse(analyzeForBackground(SCAM, 'SMS')).threatLevel);
    expect(JSON.parse(analyzeForBackground(ORDINARY, 'Messenger')).threatLevel).toBe('low');
  });
  it('an unknown platform name falls back to Unknown', () => {
    expect(JSON.parse(analyzeForBackground(SCAM, 'Pager')).platform).toBe('Unknown');
  });
});

describe('moving kept messages into the app', () => {
  it('reads a queued message and labels where it came from', () => {
    const r = toBackgroundScan(fromQueue(SCAM))!;
    expect(r).toMatchObject({ origin: 'background', sourceApp: 'Messages (SMS)', sender: '0917 555 0142', ocrConfidence: null, platform: 'SMS' });
    expect(originLabel(r)).toBe('Checked automatically · Messages (SMS) · from 0917 555 0142');
    expect(originLabel({ origin: 'share' })).toBe('Shared to FraudSentry');
    expect(originLabel({})).toBeNull();
  });
  it('drops malformed items and ones already saved, oldest first', () => {
    const a = fromQueue(SCAM, { id: 'bg-a', scannedAt: '2026-11-19T03:00:00.000Z' });
    const b = fromQueue(SCAM, { id: 'bg-b', scannedAt: '2026-11-19T01:00:00.000Z' });
    const out = newBackgroundScans([a, null, 'x', { id: 'bad' }, { ...a, threatLevel: 'severe' }, b, b], [{ id: 'old' }]);
    expect(out.map(r => r.id)).toEqual(['bg-b', 'bg-a']);
    expect(newBackgroundScans([a], [{ id: 'bg-a' }])).toEqual([]);
  });
  it('the store adds them to History with their alerts', () => {
    useAppStore.setState({ messageScans: [], alerts: [], alertLevel: 'high' });
    const rs = newBackgroundScans([fromQueue(SCAM, { id: 'bg-1', scannedAt: '2026-11-19T01:00:00.000Z' }), fromQueue(SCAM + ' Now!', { id: 'bg-2', scannedAt: '2026-11-19T02:00:00.000Z' })], []);
    useAppStore.getState().addBackgroundScans(rs);
    const s = useAppStore.getState();
    expect(s.messageScans.map(m => m.id)).toEqual(['bg-2', 'bg-1']);
    expect(s.alerts.map(a => a.resultId).sort()).toEqual(['bg-1', 'bg-2']);
  });
});

describe('shared images', () => {
  beforeEach(() => useAppStore.setState({ pendingShared: null }));
  it('a data URL becomes an image file for the receipt checker', async () => {
    const f = dataUrlToFile('data:image/png;base64,iVBORw0KGgo=', 'screenshot');
    expect([f.name, f.type, f.size]).toEqual(['screenshot.png', 'image/png', 8]);
    expect(new Uint8Array(await f.arrayBuffer())[1]).toBe(0x50);   // "P" of PNG
    expect(() => dataUrlToFile('not a url', 'x')).toThrow();
  });
});

describe('the Android app', () => {
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  const apps = readFileSync('android/app/src/main/java/com/fraudsentry/app/background/WatchedApps.java', 'utf8');
  it('still has no internet permission', () => {
    expect(manifest).not.toMatch(/android\.permission\.INTERNET"/);
  });
  it('declares the notification listener (bindable only by the system), share and select-text targets', () => {
    expect(manifest).toMatch(/\.background\.MessageWatcherService"[\s\S]*?BIND_NOTIFICATION_LISTENER_SERVICE/);
    expect(manifest).toContain('android.intent.action.PROCESS_TEXT');
    expect(manifest).toMatch(/action\.SEND"[\s\S]*?text\/plain/);
    expect(manifest).toMatch(/action\.SEND"[\s\S]*?image\/\*/);
  });
  it('the app list and the manifest <queries> name the same apps', () => {
    const known = [...apps.matchAll(/add\("([\w.]+)"/g)].map(m => m[1]).sort();
    const queried = [...manifest.matchAll(/<package android:name="([\w.]+)"/g)].map(m => m[1]).sort();
    expect(known.length).toBeGreaterThanOrEqual(15);
    expect(queried).toEqual(known);
  });
  it('the build makes analyzer.js for the APK', () => {
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['build:offline']).toContain('vite.analyzer.config.ts');
  });
});
