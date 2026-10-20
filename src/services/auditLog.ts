// ============================================================
// FraudSentry — tamper-evident activity log (System Administration)
//
// Every security-relevant action (sign-in, failed sign-in, lock-out, account
// changes, checks run, model training, deletions) is appended to a local
// log. Each entry stores the SHA-256 hash of the previous entry, so editing,
// removing or re-ordering any entry breaks the chain, and verifyLog() shows
// where. Entries hold no receipt or message content: only who, what, when,
// and the id / risk level of a result.
// ============================================================
import { sha256Hex } from './vaultCrypto';
import type { KV } from './accounts';

export type AuditAction =
  | 'setup' | 'login' | 'login-failed' | 'locked-out' | 'logout' | 'auto-lock'
  | 'signup' | 'user-created' | 'user-deleted' | 'role-changed' | 'user-disabled' | 'user-enabled'
  | 'password-changed' | 'password-reset' | 'settings-changed'
  | 'receipt-checked' | 'message-checked' | 'cross-checked' | 'history-cleared' | 'alerts-cleared'
  | 'model-trained' | 'labels-cleared' | 'report-generated' | 'transaction-entered';

export interface AuditEntry {
  seq: number;
  at: string;
  action: AuditAction;
  /** who did it (username), or null before sign-in */
  actor: string | null;
  /** short, non-personal detail: a target username, a result id and risk level, a setting */
  detail: string;
  prev: string;
  hash: string;
}

interface Stored { anchor: string; entries: AuditEntry[] }

export const AUDIT_KEY = 'fraudsentry-audit';
export const MAX_ENTRIES = 3000;
const GENESIS = '0'.repeat(64);

const entryHash = (e: Omit<AuditEntry, 'hash'>) => sha256Hex(`${e.seq}|${e.at}|${e.action}|${e.actor ?? ''}|${e.detail}|${e.prev}`);

function load(kv: KV): Stored {
  try {
    const raw = kv.get(AUDIT_KEY);
    const p = raw ? JSON.parse(raw) as Stored : null;
    if (p && Array.isArray(p.entries) && typeof p.anchor === 'string') return p;
  } catch { /* unreadable: start a new chain */ }
  return { anchor: GENESIS, entries: [] };
}

// appends are serialised so concurrent events keep a valid chain
let queue: Promise<unknown> = Promise.resolve();

export function appendLog(kv: KV, action: AuditAction, actor: string | null, detail = '', now = new Date()): Promise<AuditEntry> {
  const run = async () => {
    const s = load(kv);
    const last = s.entries.at(-1);
    const base = { seq: (last?.seq ?? 0) + 1, at: now.toISOString(), action, actor, detail: detail.slice(0, 200), prev: last?.hash ?? s.anchor };
    const entry: AuditEntry = { ...base, hash: await entryHash(base) };
    s.entries.push(entry);
    // the oldest entries are dropped; the chain then starts from the last dropped hash
    if (s.entries.length > MAX_ENTRIES) {
      const dropped = s.entries.splice(0, s.entries.length - MAX_ENTRIES);
      s.anchor = dropped.at(-1)!.hash;
    }
    kv.set(AUDIT_KEY, JSON.stringify(s));
    return entry;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

export function readLog(kv: KV): AuditEntry[] {
  return load(kv).entries;
}

export interface LogCheck { ok: boolean; entries: number; brokenAt: number | null }

/** Recompute the chain. brokenAt = seq of the first entry that does not match. */
export async function verifyLog(kv: KV): Promise<LogCheck> {
  const s = load(kv);
  let prev = s.anchor;
  for (let i = 0; i < s.entries.length; i++) {
    const e = s.entries[i];
    const { hash, ...base } = e;
    const expectedSeq = i === 0 ? e.seq : s.entries[i - 1].seq + 1;
    if (e.prev !== prev || e.seq !== expectedSeq || hash !== await entryHash(base)) return { ok: false, entries: s.entries.length, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true, entries: s.entries.length, brokenAt: null };
}
