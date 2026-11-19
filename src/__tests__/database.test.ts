// The on-device database (V10.3): records are kept permanently, survive a
// restart, migrate from an older version's localStorage history, can be
// backed up and restored, and answer "has this kind of fraud happened before?".
// Runs against fake-indexeddb, an in-memory IndexedDB for tests.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { openDatabase, SCHEMA } from '../database/db';
import { connectDatabase, flushed, type DbState } from '../database/sync';
import { fraudTypesOfFindings, fraudTypesOfMessage, findPriorCases, fraudTypeCounts, indexFields, normRef } from '../database/fraudMemory';
import { makeBackup, readBackup, mergeBackup, BACKUP_FORMAT } from '../database/backup';
import type { ImageScanResult, MessageScanResult, VerificationFinding } from '../shared/types';

let n = 0;
const dbName = () => `test-db-${++n}`;
const f = (label: string, severity: VerificationFinding['severity'] = 'high', passed = false, weight = 0.4): VerificationFinding => ({ id: label, category: 'text', label, detail: '', severity, passed, weight });
const receipt = (id: string, o: { at?: string; ref?: string; findings?: VerificationFinding[]; risk?: string; amount?: number; to?: string; preview?: string } = {}) => ({
  id, scannedAt: o.at ?? '2026-11-01T10:00:00.000Z', riskLevel: o.risk ?? 'high', riskScore: 0.5, source: 'GCash',
  findings: o.findings ?? [], extracted: { referenceNo: o.ref ?? null, amount: o.amount ?? 100, receiverName: o.to ?? null, receiverContact: null },
  ocr: { text: '', passes: [], words: [{ text: 'x' }] }, forensics: { signals: [], elaThumbnail: 'data:big' }, previewDataUrl: o.preview,
}) as unknown as ImageScanResult;
const message = (id: string, scamType: string, at = '2026-11-01T10:00:00.000Z', text = '') =>
  ({ id, scannedAt: at, threatLevel: 'high', scamType, riskScore: 0.6, links: [], flags: [], sourceText: text }) as unknown as MessageScanResult;

const emptyState = (): DbState => ({ imageScans: [], messageScans: [], crossChecks: [], manualTransactions: [], alerts: [], reports: [], keepHistory: true, dbStatus: 'loading' });
const thumbnail = async () => 'data:image/jpeg;base64,THUMB';

describe('the database schema', () => {
  it('has a table for every record type, each indexed for the "seen before" lookups', () => {
    expect(Object.keys(SCHEMA)).toEqual(['receipts', 'messages', 'crossChecks', 'transactions', 'alerts', 'reports', 'receiptImages']);
    expect(SCHEMA.receipts.map(i => i.name)).toEqual(['by_date', 'by_risk', 'by_app', 'by_reference', 'by_recipient', 'by_fraud_type']);
  });
});

describe('write-through, restart and delete', () => {
  it('a new check is saved; after a restart it is loaded back; a deleted one is removed', async () => {
    const name = dbName();
    const store = createStore<DbState>(() => emptyState());
    const stop = await connectDatabase(store, { name, thumbnail });
    expect(store.getState().dbStatus).toBe('ready');

    store.setState({ imageScans: [receipt('r1', { ref: '1016 642 566968', preview: 'data:image/png;base64,FULL' })] });
    await flushed();
    const db = await openDatabase(undefined, name);
    const [row] = await db.getAll<ImageScanResult>('receipts');
    expect(row.id).toBe('r1');
    // heavy fields are not stored with the record; a small image copy is
    expect(row.previewDataUrl).toBeUndefined();
    expect(row.forensics.elaThumbnail).toBe('');
    expect((row as unknown as { index?: unknown }).index).toBeUndefined();   // index fields are internal
    expect(await db.get('receiptImages', 'r1')).toEqual({ id: 'r1', dataUrl: 'data:image/jpeg;base64,THUMB' });
    // the indexes answer lookups directly
    expect((await db.byIndex<ImageScanResult>('receipts', 'by_reference', '1016642566968')).map(r => r.id)).toEqual(['r1']);
    stop();

    // restart: a fresh app loads it back
    const again = createStore<DbState>(() => emptyState());
    const stop2 = await connectDatabase(again, { name, thumbnail });
    expect(again.getState().imageScans.map(r => r.id)).toEqual(['r1']);

    // delete
    again.setState({ imageScans: [] });
    await flushed();
    expect(await db.count('receipts')).toBe(0);
    expect(await db.count('receiptImages')).toBe(0);
    stop2(); db.close();
  });

  it('keeps every record, however old: nothing expires', async () => {
    const name = dbName();
    const store = createStore<DbState>(() => emptyState());
    const stop = await connectDatabase(store, { name, thumbnail });
    store.setState({ imageScans: Array.from({ length: 150 }, (_, i) => receipt(`r${i}`, { at: new Date(Date.parse('2024-01-01') + i * 864e5).toISOString() })) });
    await flushed(); stop();
    const again = createStore<DbState>(() => emptyState());
    const stop2 = await connectDatabase(again, { name, thumbnail });
    expect(again.getState().imageScans).toHaveLength(150);
    expect((again.getState().imageScans[149] as ImageScanResult).scannedAt.startsWith('2024-01-01')).toBe(true);   // newest first
    stop2();
  });

  it('migrates an older version\'s localStorage history into the database', async () => {
    const name = dbName();
    const store = createStore<DbState>(() => ({ ...emptyState(), imageScans: [receipt('legacy')], messageScans: [message('legacy-m', 'OTP Scam')] }));
    const stop = await connectDatabase(store, { name, thumbnail });
    const db = await openDatabase(undefined, name);
    expect((await db.getAll<{ id: string }>('receipts')).map(r => r.id)).toEqual(['legacy']);
    expect((await db.getAll<{ id: string }>('messages')).map(r => r.id)).toEqual(['legacy-m']);
    stop(); db.close();
  });

  it('"Save my checks" off pauses saving; turning it on saves what was made meanwhile', async () => {
    const name = dbName();
    const store = createStore<DbState>(() => emptyState());
    const stop = await connectDatabase(store, { name, thumbnail });
    const db = await openDatabase(undefined, name);
    store.setState({ keepHistory: false, imageScans: [receipt('private')] });
    await flushed();
    expect(await db.count('receipts')).toBe(0);
    store.setState({ keepHistory: true });
    await flushed();
    expect(await db.count('receipts')).toBe(1);
    stop(); db.close();
  });

  it('reports "unavailable" when the browser has no database, and the app keeps working', async () => {
    const store = createStore<DbState>(() => emptyState());
    const stop = await connectDatabase(store, { factory: undefined as unknown as IDBFactory, name: dbName(), thumbnail });
    expect(['ready', 'unavailable']).toContain(store.getState().dbStatus);
    stop();
    const broken = { open: () => { throw new Error('blocked'); } } as unknown as IDBFactory;
    const s2 = createStore<DbState>(() => emptyState());
    await connectDatabase(s2, { factory: broken, name: dbName(), thumbnail }).catch(() => () => {});
    expect(s2.getState().dbStatus).not.toBe('ready');
  });
});

describe('fraud types', () => {
  it('a receipt is tagged with the frauds its failed high / critical findings show', () => {
    expect(fraudTypesOfFindings([
      f('Headline Amount Matches Details', 'critical'), f('Amount Reconciliation', 'high'),
      f('OCR Text Confidence', 'medium'),            // not high: not a fraud type
      f('Weekday Matches Date', 'high', true),        // passed: not a fraud type
    ])).toEqual(['Pasted headline amount', "Amounts don't add up"]);
  });
  it('a message is tagged with its scam type and a phishing link', () => {
    const m = { ...message('m', 'OTP Scam'), links: [{ url: 'http://gcash-verify.xyz', reason: '', severity: 'critical' }] } as unknown as MessageScanResult;
    expect(fraudTypesOfMessage(m)).toEqual(['OTP Scam', 'Phishing link']);
    expect(fraudTypesOfMessage({ ...m, threatLevel: 'low', links: [] })).toEqual([]);
  });
  it('references are compared without spaces, hyphens or case', () => {
    expect(normRef('1016 642-566968')).toBe('1016642566968');
    expect(indexFields('receipt', receipt('x', { ref: 'ab-12 34' })).ref).toBe('AB1234');
  });
});

describe('has this happened before?', () => {
  const data = {
    imageScans: [
      receipt('now', { at: '2026-11-10T10:00:00Z', ref: '1016642566968', to: 'JUAN DELA CRUZ', findings: [f('Headline Amount Matches Details', 'critical')] }),
      receipt('a', { at: '2026-11-05T10:00:00Z', ref: '1016 642 566968', findings: [f('Headline Amount Matches Details', 'critical')] }),
      receipt('b', { at: '2026-10-01T10:00:00Z', to: 'Juan Dela Cruz', findings: [f('Headline Amount Matches Details', 'critical'), f('Amount Reconciliation')] }),
      receipt('later', { at: '2026-11-12T10:00:00Z', findings: [f('Headline Amount Matches Details', 'critical')] }),
    ],
    messageScans: [message('m1', 'OTP Scam', '2026-11-01T00:00:00Z', 'call 0917 123 4567 now'), message('m2', 'OTP Scam', '2026-11-08T00:00:00Z', 'text 09171234567')],
    crossChecks: [], manualTransactions: [],
  };
  it('finds earlier cases of the same fraud type, newest first, and never counts the record itself or later ones', () => {
    const p = findPriorCases('receipt', data.imageScans[0], data);
    expect(p.byType).toEqual([{ type: 'Pasted headline amount', count: 2, lastAt: '2026-11-05T10:00:00Z', examples: expect.any(Array) }]);
    expect(p.byType[0].examples.map(e => e.id)).toEqual(['a', 'b']);
  });
  it('finds the same reference number and the same recipient in earlier checks', () => {
    const p = findPriorCases('receipt', data.imageScans[0], data);
    expect(p.sameReference.map(e => e.id)).toEqual(['a']);
    expect(p.sameRecipient.map(e => e.id)).toEqual(['b']);
  });
  it('finds an earlier scam message from the same phone number', () => {
    const p = findPriorCases('message', data.messageScans[1], data);
    expect(p.byType[0]).toMatchObject({ type: 'OTP Scam', count: 1 });
    expect(p.sameContact.map(e => e.id)).toEqual(['m1']);
  });
  it('counts records per fraud type over the whole database', () => {
    expect(fraudTypeCounts(data)[0]).toEqual({ type: 'Pasted headline amount', count: 4 });
  });
});

describe('backup and restore', () => {
  const current = { imageScans: [receipt('r1')], messageScans: [], crossChecks: [], manualTransactions: [], alerts: [], reports: [] };
  it('a backup holds every record (without the large images) and reads back', () => {
    const b = makeBackup({ ...current, imageScans: [receipt('r1', { preview: 'data:image/png;base64,FULL' })] }, { r1: 'data:image/jpeg;base64,T' }, '10.3.0', new Date('2026-11-19T00:00:00Z'));
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.imageScans[0].previewDataUrl).toBeUndefined();
    const back = readBackup(JSON.stringify(b));
    expect(back.imageScans.map(r => r.id)).toEqual(['r1']);
    expect(back.receiptImages).toEqual({ r1: 'data:image/jpeg;base64,T' });
  });
  it('restoring merges: nothing present is duplicated, restoring twice adds nothing', () => {
    const backup = { ...current, imageScans: [receipt('r1'), receipt('r2')] };
    const once = mergeBackup(current, backup);
    expect([once.data.imageScans.map(r => r.id).sort(), once.added]).toEqual([['r1', 'r2'], 1]);
    expect(mergeBackup(once.data, backup).added).toBe(0);
  });
  it('rejects a file that is not a FraudSentry backup, or one from a newer version', () => {
    expect(() => readBackup('hello')).toThrow(/not a FraudSentry backup/);
    expect(() => readBackup(JSON.stringify({ format: 'other' }))).toThrow(/not a FraudSentry backup/);
    expect(() => readBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99 }))).toThrow(/newer version/);
  });
});

describe('app version', () => {
  it('the version in the backup file matches package.json', async () => {
    const { APP_VERSION } = await import('../shared/version');
    const fs = await import('fs');
    expect(APP_VERSION).toBe(JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version);
  });
});
