// ============================================================
// FraudSentry — the on-device database (IndexedDB)
//
// Every check is kept here permanently, until the user deletes it: receipts,
// messages, cross-evidence results, typed transactions, alerts and reports,
// plus a small copy of each receipt image. It lives in the browser / app on
// this device only; nothing is sent anywhere (RA 10173).
//
// IndexedDB is the database built into every browser (and the Android /
// desktop app's WebView). Unlike localStorage (a single ~5 MB text box),
// it stores structured records in tables ("object stores") with indexes,
// so the app can ask questions such as "every earlier receipt with this
// reference number" or "every earlier case of this fraud type" directly.
//
// Each row is the record itself plus an `index` object holding the fields
// the indexes are built on (see fraudMemory.ts → indexFields).
// ============================================================

export const DB_NAME = 'fraudsentry-db';
export const DB_VERSION = 1;

export type TableName = 'receipts' | 'messages' | 'crossChecks' | 'transactions' | 'alerts' | 'reports' | 'receiptImages';

interface IndexDef { name: string; keyPath: string; multiEntry?: boolean }
const DATE = { name: 'by_date', keyPath: 'index.at' };
const RISK = { name: 'by_risk', keyPath: 'index.risk' };
const APP = { name: 'by_app', keyPath: 'index.app' };
const REF = { name: 'by_reference', keyPath: 'index.ref' };
const RECIPIENT = { name: 'by_recipient', keyPath: 'index.recipient' };
const FRAUD_TYPE = { name: 'by_fraud_type', keyPath: 'index.fraudTypes', multiEntry: true };

/** The tables and their indexes (the database schema). */
export const SCHEMA: Record<TableName, IndexDef[]> = {
  receipts: [DATE, RISK, APP, REF, RECIPIENT, FRAUD_TYPE],
  messages: [DATE, RISK, FRAUD_TYPE],
  crossChecks: [DATE, RISK, FRAUD_TYPE],
  transactions: [DATE, RISK, APP, REF, RECIPIENT, FRAUD_TYPE],
  alerts: [DATE, { name: 'by_result', keyPath: 'resultId' }, { name: 'by_status', keyPath: 'status' }],
  reports: [DATE],
  receiptImages: [],
};
export const TABLES = Object.keys(SCHEMA) as TableName[];

/** Values a row is indexed on. `null` fields are simply left out of that index. */
export interface IndexFields {
  at: string;
  risk?: string;
  app?: string;
  ref?: string;
  recipient?: string;
  fraudTypes?: string[];
}
export type Row = { id: string; index?: IndexFields } & Record<string, unknown>;

export interface Database {
  getAll<T>(table: TableName): Promise<T[]>;
  get<T>(table: TableName, id: string): Promise<T | undefined>;
  /** rows that have `value` in the given index (e.g. every receipt of fraud type X) */
  byIndex<T>(table: TableName, index: string, value: string): Promise<T[]>;
  put(table: TableName, rows: Row[]): Promise<void>;
  remove(table: TableName, ids: string[]): Promise<void>;
  clear(tables?: TableName[]): Promise<void>;
  count(table: TableName): Promise<number>;
  close(): void;
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

/** A row as stored → the record the app uses (without its index fields). */
function strip<T>(row: Row): T {
  const { index: _index, ...rest } = row;
  return rest as unknown as T;
}

export function openDatabase(factory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined, name = DB_NAME): Promise<Database> {
  if (!factory) return Promise.reject(new Error('IndexedDB is not available here'));
  return new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const table of TABLES) {
        const os = db.objectStoreNames.contains(table) ? open.transaction!.objectStore(table) : db.createObjectStore(table, { keyPath: 'id' });
        for (const ix of SCHEMA[table]) if (!os.indexNames.contains(ix.name)) os.createIndex(ix.name, ix.keyPath, { multiEntry: !!ix.multiEntry });
      }
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('The database is open in an older version of the app; close other FraudSentry tabs.'));
    open.onsuccess = () => {
      const db = open.result;
      const store = (t: TableName, mode: IDBTransactionMode) => db.transaction(t, mode).objectStore(t);
      resolve({
        async getAll<T>(table: TableName) { return (await req(store(table, 'readonly').getAll() as IDBRequest<Row[]>)).map(r => strip<T>(r)); },
        async get<T>(table: TableName, id: string) { const r = await req(store(table, 'readonly').get(id) as IDBRequest<Row | undefined>); return r ? strip<T>(r) : undefined; },
        async byIndex<T>(table: TableName, index: string, value: string) {
          return (await req(store(table, 'readonly').index(index).getAll(value) as IDBRequest<Row[]>)).map(r => strip<T>(r));
        },
        async put(table: TableName, rows: Row[]) {
          if (!rows.length) return;
          const tx = db.transaction(table, 'readwrite');
          for (const r of rows) tx.objectStore(table).put(r);
          await done(tx);
        },
        async remove(table: TableName, ids: string[]) {
          if (!ids.length) return;
          const tx = db.transaction(table, 'readwrite');
          for (const id of ids) tx.objectStore(table).delete(id);
          await done(tx);
        },
        async clear(tables: TableName[] = TABLES) {
          const tx = db.transaction(tables, 'readwrite');
          for (const t of tables) tx.objectStore(t).clear();
          await done(tx);
        },
        async count(table: TableName) { return req(store(table, 'readonly').count()); },
        close() { db.close(); },
      });
    };
  });
}
