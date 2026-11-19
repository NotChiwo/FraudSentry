// ============================================================
// FraudSentry — keeping the app and the database in step
//
// The app works on records in memory (the Zustand store, shared/store.ts);
// the database (db.ts) is where they are kept permanently. This module:
//   1. on start-up, loads every record from the database into the app,
//      and moves any history an older version kept in localStorage into it;
//   2. after that, writes every change through to the database: a new or
//      updated record is saved, a deleted one is removed (write-through).
// Turning off "Save my checks" (keepHistory) pauses the writes; the checks
// made meanwhile are saved once it is turned back on.
// Receipt images are kept as a small JPEG copy (receiptImages table) so an
// earlier receipt can be looked at again.
// ============================================================

import type { StoreApi } from 'zustand';
import { openDatabase, type Database, type Row, type TableName } from './db';
import { indexFields, alertIndex, reportIndex, type RecordKind } from './fraudMemory';
import type { ImageScanResult } from '../shared/types';

/** store array → database table (and how its rows are indexed) */
export const COLLECTIONS = [
  { key: 'imageScans', table: 'receipts', kind: 'receipt' },
  { key: 'messageScans', table: 'messages', kind: 'message' },
  { key: 'crossChecks', table: 'crossChecks', kind: 'cross' },
  { key: 'manualTransactions', table: 'transactions', kind: 'transaction' },
  { key: 'alerts', table: 'alerts', kind: 'alert' },
  { key: 'reports', table: 'reports', kind: 'report' },
] as const;
type CollectionKey = typeof COLLECTIONS[number]['key'];
type Collections = Record<CollectionKey, { id: string }[]>;

export type DbStatus = 'loading' | 'ready' | 'unavailable';
export interface DbState extends Collections {
  keepHistory: boolean;
  dbStatus: DbStatus;
}

// Heavy base64 fields are not stored with the record (the image goes to receiptImages).
export function stripHeavy(scan: ImageScanResult): ImageScanResult {
  return { ...scan, previewDataUrl: undefined, ocr: { ...scan.ocr, words: undefined }, forensics: { ...scan.forensics, elaThumbnail: '' } };
}

function toRow(kind: typeof COLLECTIONS[number]['kind'], rec: { id: string }): Row {
  const obj = rec as unknown as Record<string, unknown>;
  if (kind === 'alert') return { ...obj, id: rec.id, index: alertIndex(rec as never) };
  if (kind === 'report') return { ...obj, id: rec.id, index: reportIndex(rec as never) };
  const data = (kind === 'receipt' ? stripHeavy(rec as ImageScanResult) : rec) as unknown as Record<string, unknown>;
  return { ...data, id: rec.id, index: indexFields(kind as RecordKind, rec as never) };
}

const atOf = (r: Record<string, unknown>) => String(r.scannedAt ?? r.dateGenerated ?? r.generatedAt ?? '');
const newestFirst = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => atOf(y as never).localeCompare(atOf(x as never)));

/** Records in memory + records in the database, one per id (the in-memory one wins: it may still hold its image). */
export function mergeById<T extends { id: string }>(memory: T[], saved: T[]): T[] {
  const ids = new Set(memory.map(r => r.id));
  return newestFirst([...memory, ...saved.filter(r => !ids.has(r.id))]);
}

/** A small JPEG copy of a receipt image (browser only; null where there is no canvas). */
export async function makeThumbnail(dataUrl: string, maxSide = 520): Promise<string | null> {
  if (typeof document === 'undefined' || !dataUrl?.startsWith('data:image')) return null;
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  } catch { return null; }
}

let current: Database | null = null;
/** the chain of database writes (each flush waits for the previous one) */
let running: Promise<void> = Promise.resolve();
/** The open database (null until connected, or when the browser has none). */
export const database = () => current;

/**
 * Connect the store to the database: load everything, migrate, then write
 * every change through. Returns a function that disconnects.
 */
export async function connectDatabase<S extends DbState>(
  store: StoreApi<S>,
  opts: { factory?: IDBFactory; name?: string; thumbnail?: (dataUrl: string) => Promise<string | null> } = {},
): Promise<() => void> {
  let db: Database;
  try {
    db = await openDatabase(opts.factory, opts.name);
  } catch {
    store.setState({ dbStatus: 'unavailable' } as Partial<S>);
    return () => {};
  }
  current = db;
  const thumb = opts.thumbnail ?? makeThumbnail;

  // 1) load + migrate: what is in memory now (an older version's localStorage
  //    history, or a check made while loading) is merged with what is saved
  const saved = Object.fromEntries(await Promise.all(COLLECTIONS.map(async c => [c.key, await db.getAll<{ id: string }>(c.table as TableName)]))) as Collections;
  const now = store.getState();
  const merged = Object.fromEntries(COLLECTIONS.map(c => [c.key, mergeById(now[c.key], saved[c.key])])) as Collections;
  // what the database already holds, by id → the exact object loaded (unchanged = not rewritten)
  const synced = new Map<CollectionKey, Map<string, unknown>>(COLLECTIONS.map(c => [c.key, new Map(saved[c.key].map(r => [r.id, r]))]));
  // Records only in memory (e.g. an older version's localStorage history) are
  // written BEFORE the app is told the database is ready — only then does the
  // app stop keeping its history in localStorage, so an upgrade can't lose it.
  if (now.keepHistory) {
    try {
      for (const c of COLLECTIONS) {
        const fresh = now[c.key].filter(r => !synced.get(c.key)!.has(r.id));
        await db.put(c.table as TableName, fresh.map(r => toRow(c.kind, r)));
        for (const r of fresh) synced.get(c.key)!.set(r.id, r);
      }
    } catch {
      db.close();
      store.setState({ dbStatus: 'unavailable' } as Partial<S>);
      return () => {};
    }
  }
  store.setState({ ...merged, dbStatus: 'ready' } as Partial<S>);

  // 2) write-through
  let pending = false;
  const flush = async () => {
    pending = false;
    const s = store.getState();
    if (!s.keepHistory) return;
    for (const c of COLLECTIONS) {
      const was = synced.get(c.key)!;
      const list = s[c.key];
      const changed = list.filter(r => was.get(r.id) !== r);
      const gone = [...was.keys()].filter(id => !list.some(r => r.id === id));
      if (changed.length) {
        await db.put(c.table as TableName, changed.map(r => toRow(c.kind, r)));
        if (c.kind === 'receipt') {
          const imgs: Row[] = [];
          for (const r of changed as ImageScanResult[]) {
            if (!r.previewDataUrl) continue;
            const t = await thumb(r.previewDataUrl);
            if (t) imgs.push({ id: r.id, dataUrl: t });
          }
          await db.put('receiptImages', imgs);
        }
        for (const r of changed) was.set(r.id, r);
      }
      if (gone.length) {
        await db.remove(c.table as TableName, gone);
        if (c.kind === 'receipt') await db.remove('receiptImages', gone);
        for (const id of gone) was.delete(id);
      }
    }
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    running = running.then(() => new Promise<void>(r => setTimeout(r, 0))).then(flush).catch(e => console.error('FraudSentry: could not save to the database', e));
  };
  const unsub = store.subscribe(schedule);
  schedule();
  return () => { unsub(); db.close(); if (current === db) current = null; };
}

/** Wait for pending database writes (tests, backup). */
export const flushed = (): Promise<void> => running;

/** The saved small copy of a receipt image, if any. */
export async function receiptImage(id: string): Promise<string | null> {
  const r = await current?.get<{ id: string; dataUrl: string }>('receiptImages', id);
  return r?.dataUrl ?? null;
}
