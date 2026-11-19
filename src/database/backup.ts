// ============================================================
// FraudSentry — back up and restore the database
//
// The database lives in this browser / app. If the browser's data is
// cleared or the phone is lost, so is the database — so the user can save
// a backup file (JSON) of every record and load it back later, on this or
// another device. Restoring MERGES: records already present are kept, so
// restoring the same file twice adds nothing.
// Pure functions (tested); the Privacy & Data page does the download/upload.
// ============================================================

import type { CrossEvidenceResult, ImageScanResult, MessageScanResult } from '../shared/types';
import type { ManualTransaction } from '../transactions/transactionCheck';
import type { FraudAlert } from '../alerts/alerts';
import type { FraudReport } from '../reports/fraudReports';
import { stripHeavy, mergeById } from './sync';

export const BACKUP_FORMAT = 'fraudsentry-backup';
export const BACKUP_VERSION = 1;

export interface BackupData {
  imageScans: ImageScanResult[];
  messageScans: MessageScanResult[];
  crossChecks: CrossEvidenceResult[];
  manualTransactions: ManualTransaction[];
  alerts: FraudAlert[];
  reports: FraudReport[];
}
export interface BackupFile extends BackupData {
  format: typeof BACKUP_FORMAT;
  version: number;
  appVersion: string;
  exportedAt: string;
  /** small receipt images, by receipt id */
  receiptImages: Record<string, string>;
}
const KEYS = ['imageScans', 'messageScans', 'crossChecks', 'manualTransactions', 'alerts', 'reports'] as const;

export function makeBackup(data: BackupData, images: Record<string, string>, appVersion: string, now = new Date()): BackupFile {
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, appVersion, exportedAt: now.toISOString(),
    ...data, imageScans: data.imageScans.map(stripHeavy), receiptImages: images,
  };
}

export const backupFilename = (now = new Date()) => `FraudSentry-backup-${now.toISOString().slice(0, 10)}.json`;

/** Parse and check a backup file. Throws a message for the user when it isn't one. */
export function readBackup(text: string): BackupFile {
  let p: Partial<BackupFile>;
  try { p = JSON.parse(text); } catch { throw new Error('This file is not a FraudSentry backup (it is not valid JSON).'); }
  if (!p || p.format !== BACKUP_FORMAT) throw new Error('This file is not a FraudSentry backup.');
  if (typeof p.version !== 'number' || p.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of FraudSentry. Update the app, then restore it.');
  const out = { ...p } as BackupFile;
  for (const k of KEYS) {
    const v = (p as Record<string, unknown>)[k];
    (out as unknown as Record<string, unknown[]>)[k] = Array.isArray(v) ? v.filter(r => r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string') : [];
  }
  out.receiptImages = p.receiptImages && typeof p.receiptImages === 'object' ? p.receiptImages : {};
  return out;
}

/** Merge a backup into the current records: nothing already present is replaced or duplicated. */
export function mergeBackup(current: BackupData, backup: BackupData): { data: BackupData; added: number } {
  let added = 0;
  const data = Object.fromEntries(KEYS.map(k => {
    const merged = mergeById(current[k] as { id: string }[], backup[k] as { id: string }[]);
    added += merged.length - current[k].length;
    return [k, merged];
  })) as unknown as BackupData;
  return { data, added };
}
