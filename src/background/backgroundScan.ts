// ============================================================
// FraudSentry — Phone Protection, the app's side (Android only)
//
// The Android part (android/.../background/) watches new notifications from
// messaging apps, checks each message with the same analyzer as the Check
// Message page (analyzer.js), warns about suspicious ones and keeps only those
// (Medium risk or higher) until the app opens. Here:
//   • drain()            moves those kept messages into the on-device database
//   • takeShared()       picks up what was shared to the app: Share → FraudSentry,
//                        Select text → "Check with FraudSentry", a tapped warning,
//                        or a tapped "check this new screenshot?" offer
//   • the settings / permission calls used by the Phone Protection page.
// Nothing here talks to the internet (the Android app has no INTERNET permission).
// ============================================================
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { MessagePlatform, MessageScanResult, RiskLevel } from '../shared/types';

export type AlertThreshold = 'medium' | 'high' | 'critical';

export interface ProtectionStatus {
  supported: boolean;
  /** Android "Notification access" granted to FraudSentry */
  notificationAccess: boolean;
  listenerConnected: boolean;
  notificationsAllowed: boolean;
  photosAllowed: boolean;
  enabled: boolean;
  watchAll: boolean;
  alertLevel: AlertThreshold;
  screenshots: boolean;
  apps: string[];
  checked: number;
  flagged: number;
  alerted: number;
  lastCheckedAt: number;
  queued: number;
  sdk: number;
}

export interface WatchedApp { pkg: string; label: string; platform: MessagePlatform; installed: boolean; watched: boolean; defaultOn: boolean }

export type Shared =
  | { type?: undefined }
  | { type: 'text'; text: string }
  | { type: 'image'; imageDataUrl: string; name: string }
  | { type: 'open'; id: string }
  | { type: 'error'; message: string };

interface BackgroundScanPlugin {
  getStatus(): Promise<ProtectionStatus>;
  setConfig(o: Partial<Pick<ProtectionStatus, 'enabled' | 'watchAll' | 'alertLevel' | 'screenshots' | 'apps'>>): Promise<ProtectionStatus>;
  listApps(): Promise<{ apps: WatchedApp[] }>;
  openNotificationAccess(): Promise<void>;
  openAppInfo(): Promise<void>;
  requestNotifications(): Promise<ProtectionStatus>;
  requestPhotos(): Promise<ProtectionStatus>;
  drain(): Promise<{ items: unknown[] }>;
  takeShared(): Promise<Shared>;
  analyzeNow(o: { text: string; platform?: string }): Promise<{ json: string }>;
  testAlert(): Promise<{ threatLevel: RiskLevel; scamType: string }>;
  addListener(event: 'incoming', cb: () => void): Promise<PluginListenerHandle>;
}

export const BackgroundScan = registerPlugin<BackgroundScanPlugin>('BackgroundScan');

const LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
const PLATFORMS: MessagePlatform[] = ['SMS', 'Messenger', 'Facebook', 'WhatsApp', 'Telegram', 'Discord', 'Viber', 'Email', 'Unknown'];
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

/**
 * One kept message from the Android queue → a message check for the database.
 * The queue is written by the app's own analyzer, but it is still read as
 * untrusted data: anything malformed is dropped, and fields are re-typed.
 */
export function toBackgroundScan(item: unknown): MessageScanResult | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const id = str(o.id), sourceText = str(o.sourceText), scannedAt = str(o.scannedAt);
  const threatLevel = o.threatLevel as RiskLevel;
  if (!id || !sourceText || !LEVELS.includes(threatLevel) || Number.isNaN(Date.parse(scannedAt))) return null;
  const platform = PLATFORMS.includes(o.platform as MessagePlatform) ? (o.platform as MessagePlatform) : 'Unknown';
  return {
    id, platform, sourceText, scannedAt, threatLevel,
    textExcerpt: str(o.textExcerpt) || sourceText.slice(0, 160),
    scamType: (str(o.scamType) || 'None Detected') as MessageScanResult['scamType'],
    riskScore: typeof o.riskScore === 'number' ? Math.min(1, Math.max(0, o.riskScore)) : 0,
    confidence: typeof o.confidence === 'number' ? o.confidence : 0,
    ocrConfidence: null,
    explanation: str(o.explanation),
    flags: arr(o.flags), links: arr(o.links),
    recommendedActions: arr<string>(o.recommendedActions).filter(x => typeof x === 'string'),
    observations: arr<string>(o.observations).filter(x => typeof x === 'string'),
    origin: 'background',
    sourceApp: str(o.sourceApp) || undefined,
    sender: str(o.sender) || undefined,
  };
}

/** Kept messages not already in the database, oldest first. */
export function newBackgroundScans(items: unknown[], existing: { id: string }[]): MessageScanResult[] {
  const have = new Set(existing.map(x => x.id));
  const out: MessageScanResult[] = [];
  for (const it of items) {
    const r = toBackgroundScan(it);
    if (r && !have.has(r.id)) { have.add(r.id); out.push(r); }
  }
  return out.sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
}

/** "Checked automatically · Viber · from 0917…" */
export function originLabel(r: Pick<MessageScanResult, 'origin' | 'sourceApp' | 'sender'>): string | null {
  if (r.origin === 'background') return ['Checked automatically', r.sourceApp, r.sender ? `from ${r.sender}` : null].filter(Boolean).join(' · ');
  if (r.origin === 'share') return 'Shared to FraudSentry';
  return null;
}

/** A data: URL → File, for the receipt checker. */
export function dataUrlToFile(dataUrl: string, name: string): File {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Not an image');
  const type = m[1] || 'image/png';
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  return new File([bytes], /\.\w+$/.test(name) ? name : `${name}.${ext}`, { type });
}
