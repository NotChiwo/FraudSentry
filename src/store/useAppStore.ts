// ============================================================
// FraudSentry — Application State
// No authentication (yet). Tracks theme, consent, local scan history and the
// fraud alerts generated from it. Persisted in the browser only, never transmitted.
//
// IMPORTANT: scan results carry large base64 blobs (the receipt preview
// and the ELA heatmap). Those are kept in memory for the live result view
// but are STRIPPED before writing to localStorage — otherwise a dozen image
// scans blow past the browser's ~5MB quota and saving throws. A safety net
// also trims history if a write ever fails for any other reason.
// ============================================================
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ThemeMode, ImageScanResult, MessageScanResult, CrossEvidenceResult } from '../types';
import { rowFromScan, type TrainingRow, type LabelledModelOptions } from '../services/trainingData';
import {
  alertForReceipt, alertForMessage, alertForCross, withAlert, alertsForResults,
  DEFAULT_ALERT_LEVEL, type FraudAlert, type AlertLevel,
} from '../services/alerts';

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
  setAlertStatus: (id: string, status: FraudAlert['status']) => void;
  markAllAlertsRead: () => void;
  removeAlert: (id: string) => void;
  clearAlerts: () => void;
  /** History row to scroll to and highlight on the next visit (never persisted) */
  focusResultId: string | null;
  setFocusResultId: (id: string | null) => void;
}

// First visit follows the device's light/dark setting; after that the saved choice wins.
const systemTheme = (): ThemeMode => {
  try { return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
};

// RA 10173 data minimisation: saved results hold names, numbers and message
// text, so they are kept on this device for a limited time only. Anything
// older than this is removed when the app loads and whenever history is saved.
// Bump when the privacy notice changes, so everyone sees and accepts it again.
// 2 = V8.6: training labels (numbers only) and the 30-day history expiry.
export const CONSENT_VERSION = 2;
/** Was the CURRENT privacy notice accepted? (An older one is shown again.) */
export function acceptedCurrentNotice(p: { hasConsented?: boolean; consentVersion?: number } | null | undefined): boolean {
  return !!p?.hasConsented && p.consentVersion === CONSENT_VERSION;
}
export const HISTORY_RETENTION_DAYS = 30;
const MAX_TRAINING_ROWS = 5000;
export function withinRetention<T extends { scannedAt: string }>(items: T[], now = Date.now()): T[] {
  const cutoff = now - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return items.filter(i => { const t = Date.parse(i.scannedAt); return isNaN(t) || t >= cutoff; });
}

type History = Pick<AppState, 'imageScans' | 'messageScans' | 'crossChecks'>;
/** An alert lives only as long as the check it was generated for. */
function keepLinkedAlerts(alerts: FraudAlert[], h: History): FraudAlert[] {
  return alertsForResults(alerts, [...h.imageScans, ...h.messageScans, ...h.crossChecks].map(x => x.id));
}

// Drop the heavy base64 fields so persisted history stays tiny.
function stripHeavy(scan: ImageScanResult): ImageScanResult {
  return {
    ...scan,
    previewDataUrl: undefined,
    ocr: { ...scan.ocr, words: undefined },
    forensics: { ...scan.forensics, elaThumbnail: '' },
  };
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
        if (parsed?.state) {
          parsed.state.imageScans = [];
          parsed.state.messageScans = [];
          parsed.state.crossChecks = [];
        }
        localStorage.setItem(name, JSON.stringify(parsed));
      } catch { /* settings couldn't be saved this time; app still works in-memory */ }
    }
  },
  removeItem: (name: string) => {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
  },
};

/** Apply a history change, add the new check's alert (if any), and drop alerts whose check is gone. */
function withHistory(s: AppState, change: Partial<History>, alert: FraudAlert | null = null): Partial<AppState> {
  const h: History = { imageScans: s.imageScans, messageScans: s.messageScans, crossChecks: s.crossChecks, ...change };
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
      addImageScan: (r) => set(s => withHistory(s, { imageScans: [r, ...s.imageScans].slice(0, 40) }, alertForReceipt(r, s.alertLevel))),
      addMessageScan: (r) => set(s => withHistory(s, { messageScans: [r, ...s.messageScans].slice(0, 40) }, alertForMessage(r, s.alertLevel))),
      addCrossCheck: (r) => set(s => withHistory(s, { crossChecks: [r, ...s.crossChecks].slice(0, 20) }, alertForCross(r, s.alertLevel))),
      addCrossEvidence: (receipt, message, cross) => set(s => withHistory(s, {
        imageScans: [receipt, ...s.imageScans].slice(0, 40),
        messageScans: [message, ...s.messageScans].slice(0, 40),
        crossChecks: [cross, ...s.crossChecks].slice(0, 20),
      }, alertForCross(cross, s.alertLevel))),
      clearHistory: () => set({ imageScans: [], messageScans: [], crossChecks: [], alerts: [] }),
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
        imageScans: withinRetention(s.imageScans).map(stripHeavy),
        // training rows are numbers + a label only (no personal data), so they
        // are not subject to the history expiry
        trainingRows: s.trainingRows,
        labelledModel: s.labelledModel,
        messageScans: withinRetention(s.messageScans),
        crossChecks: withinRetention(s.crossChecks),
        alerts: keepLinkedAlerts(s.alerts, {
          imageScans: withinRetention(s.imageScans), messageScans: withinRetention(s.messageScans), crossChecks: withinRetention(s.crossChecks),
        }),
        alertLevel: s.alertLevel,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const history: History = {
          imageScans: withinRetention(p.imageScans ?? []),
          messageScans: withinRetention(p.messageScans ?? []),
          crossChecks: withinRetention(p.crossChecks ?? []),
        };
        return {
          ...current, ...p, ...history,
          // a changed privacy notice is shown (and accepted) again
          hasConsented: acceptedCurrentNotice(p),
          alerts: keepLinkedAlerts(Array.isArray(p.alerts) ? p.alerts : [], history),
          alertLevel: p.alertLevel ?? DEFAULT_ALERT_LEVEL,
        };
      },
    }
  )
);
