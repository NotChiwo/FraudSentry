// ============================================================
// FraudSentry — Application State
// No accounts. Tracks theme, consent, the local history (receipts, messages,
// cross-evidence, typed transactions), alerts, reports, training labels and
// the model registry. Kept on this device only, never transmitted.
//
// Where things are saved:
//   • settings (theme, consent, alert level, training rows, models) → localStorage
//   • the history — every receipt, message, cross-evidence result, typed
//     transaction, alert and report → the on-device database (IndexedDB,
//     src/database/), permanently, until the user deletes it. This store holds
//     the same records in memory; database/sync.ts writes every change through.
// If a browser has no IndexedDB, the history falls back to localStorage (as
// before V10.3), without the large images, which would not fit.
// ============================================================
import { create } from 'zustand';
import { stripHeavy, type DbStatus } from '../database/sync';
import { mergeBackup, type BackupData } from '../database/backup';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ThemeMode, ImageScanResult, MessageScanResult, CrossEvidenceResult, TransactionStatus } from './types';
import type { ManualTransaction } from '../transactions/transactionCheck';
import { withModel, type ModelRecord } from '../random-forest/modelRegistry';
import type { FraudReport } from '../reports/fraudReports';
import { rowFromScan, type TrainingRow, type LabelledModelOptions } from '../random-forest/trainingData';
import {
  alertForReceipt, alertForMessage, alertForCross, alertForTransaction, withAlert, alertsForResults,
  DEFAULT_ALERT_LEVEL, type FraudAlert, type AlertLevel,
} from '../alerts/alerts';

interface AppState {
  theme: ThemeMode;
  toggleTheme: () => void;
  hasConsented: boolean;
  /** which version of the privacy notice was accepted (see CONSENT_VERSION) */
  consentVersion?: number;
  giveConsent: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  imageScans: ImageScanResult[];
  messageScans: MessageScanResult[];
  crossChecks: CrossEvidenceResult[];
  addImageScan: (r: ImageScanResult) => void;
  /** a re-analysis after "Correct text": the new result replaces the old one (keeping its payment outcome) */
  replaceImageScan: (oldId: string, r: ImageScanResult) => void;
  addMessageScan: (r: MessageScanResult) => void;
  addCrossCheck: (r: CrossEvidenceResult) => void;
  /** a Cross-Evidence run saves its receipt, its message and the combined result, with ONE alert (for the combined result) */
  addCrossEvidence: (receipt: ImageScanResult, message: MessageScanResult, cross: CrossEvidenceResult) => void;
  clearHistory: () => void;
  removeImageScan: (id: string) => void;
  removeMessageScan: (id: string) => void;
  removeCrossCheck: (id: string) => void;
  /** Knowledge Base "try this" example waiting to be prefilled in Check Message (never persisted) */
  pendingExample: string | null;
  setPendingExample: (t: string | null) => void;
  /** receipts you labelled genuine/fake for training — numbers only (see trainingData.ts) */
  trainingRows: TrainingRow[];
  /** label a scan (0 genuine, 1 fake), or remove its label (null) */
  labelScan: (scan: ImageScanResult, label: 0 | 1 | null) => void;
  clearTrainingRows: () => void;
  /** when set, live scans use a forest trained on trainingRows with these settings */
  labelledModel: LabelledModelOptions | null;
  setLabelledModel: (o: LabelledModelOptions | null) => void;
  /** fraud alerts generated from checks at or above alertLevel (see services/alerts.ts) */
  alerts: FraudAlert[];
  alertLevel: AlertLevel;
  setAlertLevel: (l: AlertLevel) => void;
  /** show a pop-up when a new alert is created (data dictionary: notification_option); alerts are listed either way */
  alertPopups: boolean;
  setAlertPopups: (v: boolean) => void;
  /** save checks in the on-device database (data dictionary: retain_scan_results); off = new checks are kept only until the app is closed */
  keepHistory: boolean;
  /** the on-device database: loading at start-up, ready, or unavailable in this browser (history then kept in localStorage) */
  dbStatus: DbStatus;
  /** merge a backup file's records into the history (nothing present is replaced or duplicated) */
  restoreBackup: (b: BackupData) => void;
  setKeepHistory: (v: boolean) => void;
  setAlertStatus: (id: string, status: FraudAlert['status']) => void;
  markAllAlertsRead: () => void;
  removeAlert: (id: string) => void;
  clearAlerts: () => void;
  /** transactions checked from typed details (no screenshot) */
  manualTransactions: ManualTransaction[];
  addManualTransaction: (t: ManualTransaction) => void;
  removeManualTransaction: (id: string) => void;
  /** did the money arrive? On a receipt this also sets its training label (received = genuine, not received = fake). */
  setTxStatus: (kind: 'receipt' | 'manual', id: string, status: TransactionStatus) => void;
  /** REPORT: saved reports (local history) */
  reports: FraudReport[];
  addReport: (r: FraudReport) => void;
  removeReport: (id: string) => void;
  /** RF_MODEL: every forest trained on this device (numbers only) */
  models: ModelRecord[];
  addModel: (m: ModelRecord) => void;
  removeModel: (id: string) => void;
  /** History row to scroll to and highlight on the next visit (never persisted) */
  focusResultId: string | null;
  setFocusResultId: (id: string | null) => void;
}

/** The history: every check, alert and report (kept until the user deletes it). */
export interface UserData {
  imageScans: ImageScanResult[];
  messageScans: MessageScanResult[];
  crossChecks: CrossEvidenceResult[];
  manualTransactions: ManualTransaction[];
  alerts: FraudAlert[];
  alertLevel: AlertLevel;
  reports: FraudReport[];
}
export const USER_DATA_KEYS = ['imageScans', 'messageScans', 'crossChecks', 'manualTransactions', 'alerts', 'alertLevel', 'reports'] as const;

// First visit follows the device's light/dark setting; after that the saved choice wins.
const systemTheme = (): ThemeMode => {
  try { return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
};

// Bump when the privacy notice changes, so everyone sees and accepts it again.
// (5 = the current notice: the history is kept in an on-device database until the user deletes it,
//  instead of 30 days, so an earlier case of the same fraud can be found; it can be backed up to a file.)
export const CONSENT_VERSION = 5;
/** Was the CURRENT privacy notice accepted? (An older one is shown again.) */
export function acceptedCurrentNotice(p: { hasConsented?: boolean; consentVersion?: number } | null | undefined): boolean {
  return !!p?.hasConsented && p.consentVersion === CONSENT_VERSION;
}
const MAX_TRAINING_ROWS = 5000;

type History = Pick<AppState, 'imageScans' | 'messageScans' | 'crossChecks' | 'manualTransactions'>;
/** An alert lives only as long as the check it was generated for. */
function keepLinkedAlerts(alerts: FraudAlert[], h: History): FraudAlert[] {
  return alertsForResults(alerts, [...h.imageScans, ...h.messageScans, ...h.crossChecks, ...h.manualTransactions].map(x => x.id));
}

// Quota-safe localStorage wrapper: if a write fails, retry without history.
const safeStorage = {
  getItem: (name: string) => {
    try { return localStorage.getItem(name); } catch { return null; }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      try {
        const parsed = JSON.parse(value);
        if (parsed?.state) for (const k of ['imageScans', 'messageScans', 'crossChecks', 'manualTransactions', 'alerts', 'reports']) parsed.state[k] = [];
        localStorage.setItem(name, JSON.stringify(parsed));
      } catch { /* settings couldn't be saved this time; app still works in-memory */ }
    }
  },
  removeItem: (name: string) => {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
  },
};

/** The user's data as it is saved: nothing expires; heavy images are stripped (the database keeps a small copy); alerts are kept only with their check. */
export function userDataToSave(s: UserData): UserData {
  const h: History = { imageScans: s.imageScans, messageScans: s.messageScans, crossChecks: s.crossChecks, manualTransactions: s.manualTransactions };
  return { ...h, imageScans: h.imageScans.map(stripHeavy), alerts: keepLinkedAlerts(s.alerts, h), alertLevel: s.alertLevel, reports: s.reports };
}
/** Saved user data (possibly old or partial, e.g. an older version's localStorage history) → what the app loads. */
export function userDataFromSaved(p: Partial<UserData> | null | undefined): UserData {
  const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  const h: History = { imageScans: arr(p?.imageScans), messageScans: arr(p?.messageScans), crossChecks: arr(p?.crossChecks), manualTransactions: arr(p?.manualTransactions) };
  return { ...h, alerts: keepLinkedAlerts(arr(p?.alerts), h), alertLevel: p?.alertLevel ?? DEFAULT_ALERT_LEVEL, reports: arr(p?.reports) };
}
export const EMPTY_USER_DATA: UserData = { imageScans: [], messageScans: [], crossChecks: [], manualTransactions: [], alerts: [], alertLevel: DEFAULT_ALERT_LEVEL, reports: [] };
/**
 * What goes into localStorage: only the alert level once the database holds
 * the history; the whole history (images stripped) only while the database
 * is loading or in a browser without one; nothing when "Save my checks" is off.
 */
export function historyToSave(s: UserData & { keepHistory: boolean; dbStatus?: DbStatus }): UserData {
  if (!s.keepHistory || s.dbStatus === 'ready') return { ...EMPTY_USER_DATA, alertLevel: s.alertLevel };
  return userDataToSave(s);
}

/** Apply a history change, add the new check's alert (if any), and drop alerts whose check is gone. */
function withHistory(s: AppState, change: Partial<History>, alert: FraudAlert | null = null): Partial<AppState> {
  const h: History = { imageScans: s.imageScans, messageScans: s.messageScans, crossChecks: s.crossChecks, manualTransactions: s.manualTransactions, ...change };
  return { ...change, alerts: keepLinkedAlerts(withAlert(s.alerts, alert), h) };
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: systemTheme(),
      toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      hasConsented: false,
      giveConsent: () => set({ hasConsented: true, consentVersion: CONSENT_VERSION }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      imageScans: [],
      messageScans: [],
      crossChecks: [],
      addImageScan: (r) => set(s => withHistory(s, { imageScans: [r, ...s.imageScans] }, alertForReceipt(r, s.alertLevel))),
      replaceImageScan: (oldId, r) => set(s => {
        const old = s.imageScans.find(x => x.id === oldId);
        const outcome = old?.txStatus && old.txStatus !== 'pending' ? old.txStatus : null;
        const next = outcome ? { ...r, txStatus: outcome, txStatusAt: old!.txStatusAt } : r;
        const rest = s.trainingRows.filter(t => t.id !== oldId);
        return {
          ...withHistory(s, { imageScans: [next, ...s.imageScans.filter(x => x.id !== oldId)] }, alertForReceipt(next, s.alertLevel)),
          trainingRows: outcome ? [...rest, rowFromScan(next, outcome === 'received' ? 0 : 1)].slice(-MAX_TRAINING_ROWS) : rest,
        };
      }),
      addMessageScan: (r) => set(s => withHistory(s, { messageScans: [r, ...s.messageScans] }, alertForMessage(r, s.alertLevel))),
      addCrossCheck: (r) => set(s => withHistory(s, { crossChecks: [r, ...s.crossChecks] }, alertForCross(r, s.alertLevel))),
      addCrossEvidence: (receipt, message, cross) => set(s => withHistory(s, {
        imageScans: [receipt, ...s.imageScans],
        messageScans: [message, ...s.messageScans],
        crossChecks: [cross, ...s.crossChecks],
      }, alertForCross(cross, s.alertLevel))),
      // saved reports list references and amounts too, so they go with the history
      clearHistory: () => set({ imageScans: [], messageScans: [], crossChecks: [], manualTransactions: [], alerts: [], reports: [] }),
      removeImageScan: (id) => set(s => withHistory(s, { imageScans: s.imageScans.filter(x => x.id !== id) })),
      removeMessageScan: (id) => set(s => withHistory(s, { messageScans: s.messageScans.filter(x => x.id !== id) })),
      removeCrossCheck: (id) => set(s => withHistory(s, { crossChecks: s.crossChecks.filter(x => x.id !== id) })),
      pendingExample: null,
      setPendingExample: (t) => set({ pendingExample: t }),
      trainingRows: [],
      labelScan: (scan, label) => set(s => {
        const rest = s.trainingRows.filter(r => r.id !== scan.id);
        return { trainingRows: label === null ? rest : [...rest, rowFromScan(scan, label)].slice(-MAX_TRAINING_ROWS) };
      }),
      clearTrainingRows: () => set({ trainingRows: [], labelledModel: null }),
      labelledModel: null,
      setLabelledModel: (o) => set({ labelledModel: o }),
      alerts: [],
      alertLevel: DEFAULT_ALERT_LEVEL,
      setAlertLevel: (l) => set({ alertLevel: l }),
      setAlertStatus: (id, status) => set(s => ({ alerts: s.alerts.map(a => (a.id === id ? { ...a, status } : a)) })),
      markAllAlertsRead: () => set(s => ({ alerts: s.alerts.map(a => (a.status === 'read' ? a : { ...a, status: 'read' as const })) })),
      removeAlert: (id) => set(s => ({ alerts: s.alerts.filter(a => a.id !== id) })),
      clearAlerts: () => set({ alerts: [] }),
      manualTransactions: [],
      addManualTransaction: (t) => set(s => withHistory(s, { manualTransactions: [t, ...s.manualTransactions] }, alertForTransaction(t, s.alertLevel))),
      removeManualTransaction: (id) => set(s => withHistory(s, { manualTransactions: s.manualTransactions.filter(x => x.id !== id) })),
      setTxStatus: (kind, id, status) => set(s => {
        const at = new Date().toISOString();
        if (kind === 'manual') return { manualTransactions: s.manualTransactions.map(t => (t.id === id ? { ...t, txStatus: status, txStatusAt: at } : t)) };
        const scan = s.imageScans.find(x => x.id === id);
        if (!scan) return {};
        const updated = { ...scan, txStatus: status, txStatusAt: at };
        // the real outcome is the best training label there is
        const rest = s.trainingRows.filter(r => r.id !== id);
        const trainingRows = status === 'pending' ? rest : [...rest, rowFromScan(updated, status === 'received' ? 0 : 1)].slice(-MAX_TRAINING_ROWS);
        return { imageScans: s.imageScans.map(x => (x.id === id ? updated : x)), trainingRows };
      }),
      reports: [],
      addReport: (r) => set(s => ({ reports: [r, ...s.reports] })),
      removeReport: (id) => set(s => ({ reports: s.reports.filter(r => r.id !== id) })),
      models: [],
      addModel: (m) => set(s => ({ models: withModel(s.models, m) })),
      removeModel: (id) => set(s => ({ models: s.models.filter(m => m.id !== id) })),
      alertPopups: true,
      setAlertPopups: (v) => set({ alertPopups: v }),
      keepHistory: true,
      setKeepHistory: (v) => set({ keepHistory: v }),
      dbStatus: 'loading',
      restoreBackup: (b) => set(s => {
        const { data } = mergeBackup({ imageScans: s.imageScans, messageScans: s.messageScans, crossChecks: s.crossChecks, manualTransactions: s.manualTransactions, alerts: s.alerts, reports: s.reports }, b);
        return { ...data, alerts: keepLinkedAlerts(data.alerts, data) };
      }),
      focusResultId: null,
      setFocusResultId: (id) => set({ focusResultId: id }),
    }),
    {
      name: 'fraudsentry-v5-store',
      storage: createJSONStorage(() => safeStorage),
      version: 1,
      // v0 → v1 only added retention; the shape is unchanged.
      migrate: (persisted) => persisted as AppState,
      partialize: (s) => ({
        theme: s.theme, hasConsented: s.hasConsented, consentVersion: s.consentVersion,
        // training rows are numbers + a label only (no personal data); they
        // belong to the device's model, not to one user
        trainingRows: s.trainingRows,
        labelledModel: s.labelledModel,
        models: s.models,
        alertPopups: s.alertPopups, keepHistory: s.keepHistory,
        // the history lives in the database; localStorage only holds it while the
        // database is loading or unavailable (see historyToSave)
        ...historyToSave(s),
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState> & { legacyUserData?: Partial<UserData> };
        // an older app version kept the history under legacyUserData; load it from there too
        const saved = p.legacyUserData && !USER_DATA_KEYS.some(k => k in p) ? p.legacyUserData : p;
        return {
          ...current,
          theme: p.theme ?? current.theme,
          // a changed privacy notice is shown (and accepted) again
          hasConsented: acceptedCurrentNotice(p), consentVersion: p.consentVersion,
          trainingRows: Array.isArray(p.trainingRows) ? p.trainingRows : [],
          labelledModel: p.labelledModel ?? null,
          models: Array.isArray(p.models) ? p.models : [],
          alertPopups: p.alertPopups ?? true,
          keepHistory: p.keepHistory ?? true,
          ...userDataFromSaved(saved as Partial<UserData>),
        };
      },
    }
  )
);
