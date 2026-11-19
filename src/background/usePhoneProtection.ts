// Android: brings in what Phone Protection found while the app was closed, and
// what was shared to the app — when the app starts, each time it comes back to
// the front, and when something is shared while it is open.
import { useEffect, useRef } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { isAndroidApp } from '../app/nativeApp';
import { useAppStore } from '../shared/store';
import { BackgroundScan, newBackgroundScans } from './backgroundScan';

export function usePhoneProtection(enabled: boolean, navigate: (page: string) => void) {
  const nav = useRef(navigate);
  nav.current = navigate;
  const dbStatus = useAppStore(s => s.dbStatus);

  useEffect(() => {
    if (!enabled || !isAndroidApp() || dbStatus === 'loading') return;
    let busy = false;
    const pull = async () => {
      if (busy) return;
      busy = true;
      try {
        const st = useAppStore.getState();
        const { items } = await BackgroundScan.drain();
        const fresh = newBackgroundScans(items ?? [], useAppStore.getState().messageScans);
        if (fresh.length) st.addBackgroundScans(fresh);
        const s = await BackgroundScan.takeShared();
        if (s.type === 'text' && s.text.trim()) {
          st.setPendingShared({ kind: 'text', text: s.text });
          nav.current('analyzer');
        } else if (s.type === 'image' && s.imageDataUrl) {
          st.setPendingShared({ kind: 'image', dataUrl: s.imageDataUrl, name: s.name || 'shared-image' });
          nav.current('scanner');
        } else if (s.type === 'open') {
          if (s.id && s.id !== 'test') { st.setFocusResultId(s.id); nav.current('history'); }
          else nav.current('protection');
        } else if (s.type === 'error') {
          window.alert(s.message);
        }
      } catch {
        // the plugin is missing (older APK) or busy: try again next time
      } finally {
        busy = false;
      }
    };
    void pull();
    const subs = [
      NativeApp.addListener('appStateChange', ({ isActive }) => { if (isActive) void pull(); }),
      BackgroundScan.addListener('incoming', () => { void pull(); }),
    ];
    return () => { for (const s of subs) void s.then(h => h.remove()).catch(() => {}); };
  }, [enabled, dbStatus]);
}
