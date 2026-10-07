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

interface AppState {
  theme: ThemeMode;
  toggleTheme: () => void;
  hasConsented: boolean;
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
}

// First visit follows the device's light/dark setting; after that the saved choice wins.
const systemTheme = (): ThemeMode => {
  try { return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
};

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
      giveConsent: () => set({ hasConsented: true }),
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
    }),
    {
      name: 'fraudsentry-v5-store',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        theme: s.theme, hasConsented: s.hasConsented,
        imageScans: s.imageScans.map(stripHeavy),
        messageScans: s.messageScans,
        crossChecks: s.crossChecks,
      }),
    }
  )
);
