// Signed-in sessions (V9.0): each user's history lives in their own encrypted
// vault, is saved as they work, leaves memory on sign-out, and checks are
// written to the activity log.
import { describe, it, expect, beforeEach } from 'vitest';
import { memoryKV, setupAdmin, createUser, login, vaultKey, type Session } from '../services/accounts';
import { readLog } from '../services/auditLog';
import { useSession, setSessionKV, flushSession } from '../store/useSession';
import { useAppStore, userDataFromSaved } from '../store/useAppStore';
import type { ImageScanResult, RiskLevel } from '../types';

const IT = { iterations: 1000 };
const receipt = (id: string, riskLevel: RiskLevel): ImageScanResult => ({
  id, riskLevel, scannedAt: new Date().toISOString(), source: 'GCash', filename: 'r.png', riskScore: 0.6,
  extracted: { amount: 5000, referenceNo: '8041241631871' }, findings: [], ocr: { words: [] }, forensics: { elaThumbnail: 'data:x' },
} as unknown as ImageScanResult);

let kv: ReturnType<typeof memoryKV>;
let admin: Session;
beforeEach(async () => {
  await useSession.getState().signOut();
  kv = memoryKV();
  setSessionKV(kv);
  useAppStore.setState({ legacyUserData: null });
  admin = await setupAdmin(kv, 'owner', 'sari-sari-2026', IT);
});
const st = () => useAppStore.getState();

describe('sessions', () => {
  it('signing in loads only that user\'s data; work is saved encrypted; signing out clears memory', async () => {
    await useSession.getState().signIn(admin);
    st().addImageScan(receipt('r1', 'high'));
    await flushSession();
    const raw = kv.get(vaultKey(admin.userId))!;
    expect(raw).toBeTruthy();
    expect(raw).not.toMatch(/8041241631871|GCash/);
    await useSession.getState().signOut();
    expect(st().imageScans).toEqual([]);
    expect(st().alerts).toEqual([]);

    await createUser(kv, admin, 'cashier1', 'temp-pass-01', 'user', IT);
    const r = await login(kv, 'cashier1', 'temp-pass-01');
    if (!r.ok) throw new Error(r.reason);
    await useSession.getState().signIn(r.session);
    expect(st().imageScans).toEqual([]);                       // the cashier does not see the owner's checks
    await useSession.getState().signOut();

    const again = await login(kv, 'owner', 'sari-sari-2026');
    if (!again.ok) throw new Error(again.reason);
    await useSession.getState().signIn(again.session);
    expect(st().imageScans.map(s => s.id)).toEqual(['r1']);
    expect(st().imageScans[0].forensics.elaThumbnail).toBe('');  // heavy images are not stored
    expect(st().alerts.map(a => a.resultId)).toEqual(['r1']);
  });

  it('the first administrator takes over history saved before accounts existed', async () => {
    useAppStore.setState({ legacyUserData: userDataFromSaved({ imageScans: [receipt('old-1', 'low')] }) });
    await useSession.getState().signIn(admin);
    expect(st().imageScans.map(s => s.id)).toEqual(['old-1']);
    expect(st().legacyUserData).toBeNull();
  });

  it('checks, clearing history and signing out are written to the activity log', async () => {
    await useSession.getState().signIn(admin);
    st().addImageScan(receipt('r9', 'critical'));
    st().clearHistory();
    await useSession.getState().signOut();
    await new Promise(r => setTimeout(r, 20));
    const log = readLog(kv).map(e => [e.action, e.actor, e.detail]);
    expect(log).toEqual(expect.arrayContaining([
      ['receipt-checked', 'owner', 'r9 critical'],
      ['history-cleared', 'owner', '1 records'],
      ['logout', 'owner', ''],
    ]));
    expect(JSON.stringify(log)).not.toMatch(/8041241631871/);
  });
});
