// ============================================================
// FraudSentry — Application State
// No authentication. Tracks theme, consent, and local scan history.
// History is persisted in the browser only and never transmitted.
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
      addImageScan: (r) => set(s => ({ imageScans: [r, ...s.imageScans].slice(0, 40) })),
      addMessageScan: (r) => set(s => ({ messageScans: [r, ...s.messageScans].slice(0, 40) })),
      addCrossCheck: (r) => set(s => ({ crossChecks: [r, ...s.crossChecks].slice(0, 20) })),
      clearHistory: () => set({ imageScans: [], messageScans: [], crossChecks: [] }),
      removeImageScan: (id) => set(s => ({ imageScans: s.imageScans.filter(x => x.id !== id) })),
      removeMessageScan: (id) => set(s => ({ messageScans: s.messageScans.filter(x => x.id !== id) })),
      removeCrossCheck: (id) => set(s => ({ crossChecks: s.crossChecks.filter(x => x.id !== id) })),
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
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current, ...p,
          // a changed privacy notice is shown (and accepted) again
          hasConsented: acceptedCurrentNotice(p),
          imageScans: withinRetention(p.imageScans ?? []),
          messageScans: withinRetention(p.messageScans ?? []),
          crossChecks: withinRetention(p.crossChecks ?? []),
        };
      },
    }
  )
);
