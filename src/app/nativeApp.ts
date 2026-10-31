// ============================================================
// FraudSentry — the few things that differ in the installed apps
//
// The same single-file page runs as a website, in the Android app
// (Capacitor) and in the desktop app (Electron). Only these differ:
//   • saving a file: a browser or Electron downloads it; an Android WebView
//     cannot, so the file is written to the app's cache and handed to the
//     system share sheet ("Save to Files", Drive, Messenger …);
//   • the Android back button (see App.tsx);
//   • only the website keeps an offline copy of itself (service worker), so
//     it still opens with no internet once added to a phone's Home Screen;
//   • on an iPhone/iPad a file goes to the share sheet, where "Save to Files"
//     is, instead of a download.
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isAndroidApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export const isDesktopApp = () => typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);
export const isInstalledApp = () => Capacitor.isNativePlatform() || isDesktopApp();
const isAppleMobile = () => typeof navigator !== 'undefined'
  && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Website over https only: keep an offline copy of the app (public/sw.js). */
export function registerOfflineCopy(): void {
  if (isInstalledApp() || location.protocol !== 'https:' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* still works online */ });
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/** Save a generated file (PDF report, CSV export) the way this platform allows. */
export async function saveFile(filename: string, content: Blob | BlobPart, mime: string): Promise<void> {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  if (Capacitor.isNativePlatform()) {
    const safeName = filename.replace(/[^\w.-]+/g, '_');
    const written = await Filesystem.writeFile({ path: safeName, data: await blobToBase64(blob), directory: Directory.Cache });
    await Share.share({ title: safeName, url: written.uri, dialogTitle: 'Save or send this file' });
    return;
  }
  if (isAppleMobile() && typeof navigator.canShare === 'function') {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return; }
      catch (e) { if ((e as Error).name === 'AbortError') return; /* not allowed here: download instead */ }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
