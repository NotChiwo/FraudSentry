// ============================================================
// FraudSentry — the signed-in session
//
// Signing in opens the user's encrypted vault and loads it into the app
// store; every change to that user's data is encrypted and saved back
// (debounced). Signing out (or the inactivity lock) saves, then clears the
// user's data from memory. The keys live only in memory: reloading the page
// signs out.
// Checks run, history cleared and labels cleared are written to the
// activity log here, from the store's changes, so pages need no logging code.
// ============================================================
import { create } from 'zustand';
import { browserKV, readVault, writeVault, accountSettings, type KV, type Session } from '../services/accounts';
import { appendLog, type AuditAction } from '../services/auditLog';
import { useAppStore, userDataToSave, userDataFromSaved, USER_DATA_KEYS, type UserData } from './useAppStore';

interface SessionState {
  session: Session | null;
  signIn: (s: Session) => Promise<void>;
  signOut: (reason?: 'logout' | 'auto-lock') => Promise<void>;
  /** after a password change */
  update: (s: Session) => void;
}

let kv: KV = browserKV;
/** tests use an in-memory store */
export function setSessionKV(k: KV) { kv = k; }
export const sessionKV = () => kv;

const pick = (s: UserData): UserData => ({ imageScans: s.imageScans, messageScans: s.messageScans, crossChecks: s.crossChecks, manualTransactions: s.manualTransactions, alerts: s.alerts, alertLevel: s.alertLevel });

// ── saving ───────────────────────────────────────────────────
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();
const SAVE_DELAY_MS = 150;

function save(session: Session): Promise<void> {
  const data = userDataToSave(pick(useAppStore.getState()));
  writing = writing.then(() => writeVault(kv, session, data)).catch(e => { console.error('FraudSentry: could not save your data', e); });
  return writing;
}
function scheduleSave(session: Session) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void save(session); }, SAVE_DELAY_MS);
}
/** Save now (e.g. before signing out). */
export async function flushSession(): Promise<void> {
  const s = useSession.getState().session;
  if (timer) { clearTimeout(timer); timer = null; }
  if (s) await save(s); else await writing;
}

export const useSession = create<SessionState>()((set, get) => ({
  session: null,
  signIn: async (session) => {
    const saved = await readVault<Partial<UserData>>(kv, session);
    let data = userDataFromSaved(saved);
    // the first administrator inherits history saved before accounts existed (V8.x)
    const legacy = session.role === 'admin' ? useAppStore.getState().takeLegacyUserData() : null;
    if (legacy) {
      data = userDataFromSaved({
        ...data,
        imageScans: [...data.imageScans, ...legacy.imageScans],
        messageScans: [...data.messageScans, ...legacy.messageScans],
        crossChecks: [...data.crossChecks, ...legacy.crossChecks],
        manualTransactions: data.manualTransactions,
        alerts: [...data.alerts, ...legacy.alerts],
        alertLevel: saved?.alertLevel ?? legacy.alertLevel,
      });
    }
    useAppStore.getState().loadUserData(data);
    set({ session });
    if (legacy) await save(session);
  },
  signOut: async (reason = 'logout') => {
    const s = get().session;
    if (!s) return;
    await flushSession();
    set({ session: null });
    useAppStore.getState().loadUserData(null);
    await appendLog(kv, reason, s.username, reason === 'auto-lock' ? `no activity for ${accountSettings(kv).autoLockMinutes} min` : '');
  },
  update: (session) => set({ session }),
}));

// ── save + log on every change of the signed-in user's data ──
const newIds = <T extends { id: string }>(now: T[], before: T[]) => { const old = new Set(before.map(x => x.id)); return now.filter(x => !old.has(x.id)); };

useAppStore.subscribe((now, before) => {
  const session = useSession.getState().session;
  if (!session) return;
  const log = (a: AuditAction, d: string) => { void appendLog(kv, a, session.username, d); };
  if (USER_DATA_KEYS.some(k => now[k] !== before[k])) {
    scheduleSave(session);
    // a whole Cross-Evidence run (receipt + message + combined) is logged once
    const crosses = newIds(now.crossChecks, before.crossChecks);
    crosses.forEach(c => log('cross-checked', `${c.id} ${c.combinedRiskLevel}`));
    if (!crosses.length) {
      newIds(now.imageScans, before.imageScans).forEach(r => log('receipt-checked', `${r.id} ${r.riskLevel}`));
      newIds(now.messageScans, before.messageScans).forEach(m => log('message-checked', `${m.id} ${m.threatLevel}`));
    }
    newIds(now.manualTransactions, before.manualTransactions).forEach(t => log('transaction-entered', `${t.id} ${t.riskLevel}`));
    const had = before.imageScans.length + before.messageScans.length + before.crossChecks.length + before.manualTransactions.length;
    if (had > 0 && !now.imageScans.length && !now.messageScans.length && !now.crossChecks.length && !now.manualTransactions.length) log('history-cleared', `${had} records`);
    else if (before.alerts.length > 0 && now.alerts.length === 0) log('alerts-cleared', `${before.alerts.length} alerts`);
  }
  if (before.trainingRows.length > 0 && now.trainingRows.length === 0) log('labels-cleared', `${before.trainingRows.length} labels`);
});
