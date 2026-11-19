// Phone Protection (Android): FraudSentry checks new messages from your
// messaging apps in the background and warns you about scams — no copy and
// paste. Setup, settings and what it has found. Logic: backgroundScan.ts and
// the Android service (android/.../background/MessageWatcherService.java).
import { useCallback, useEffect, useState } from 'react';
import { Smartphone, ShieldCheck, Bell, Settings2, Image as ImageIcon, Share2, TextSelect, CheckCircle2, Circle, BellRing, Lock } from 'lucide-react';
import { useAppStore } from '../shared/store';
import { formatDateTime, RISK_META } from '../shared/helpers';
import { isAndroidApp } from '../app/nativeApp';
import { BackgroundScan, originLabel, type AlertThreshold, type ProtectionStatus, type WatchedApp } from './backgroundScan';

const THRESHOLDS: [AlertThreshold, string][] = [
  ['medium', 'Medium and above (more warnings)'], ['high', 'High and above (recommended)'], ['critical', 'Critical only (fewest warnings)'],
];

function Step({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className={`pp-step${done ? ' done' : ''}`}>
      {done ? <CheckCircle2 size={20} className="pp-step-ico ok" aria-hidden="true" /> : <Circle size={20} className="pp-step-ico" aria-hidden="true" />}
      <div><strong>{title}</strong>{done ? <span className="sr-only"> (done)</span> : null}{!done && children}</div>
    </li>
  );
}

function HowToUse() {
  return (
    <section className="card pad" aria-labelledby="pp-share">
      <h2 id="pp-share" className="section-title"><Share2 size={18} /> Check anything without copy and paste</h2>
      <ul className="pp-list">
        <li><Share2 size={16} aria-hidden="true" /> <span><strong>Share → FraudSentry.</strong> In any app, share a message or a screenshot to FraudSentry; it is checked at once.</span></li>
        <li><TextSelect size={16} aria-hidden="true" /> <span><strong>Select text → “Check with FraudSentry”.</strong> Long-press a message, select it, and pick FraudSentry from the menu (⋮ if it is hidden).</span></li>
        <li><ImageIcon size={16} aria-hidden="true" /> <span><strong>New screenshots.</strong> With “Offer to check new screenshots” on, taking a screenshot of a receipt shows a notification; tap it to check the receipt.</span></li>
      </ul>
    </section>
  );
}

export default function PhoneProtectionPage({ onNavigate }: { onNavigate: (p: string) => void }) {
  const android = isAndroidApp();
  const messageScans = useAppStore(s => s.messageScans);
  const setFocusResultId = useAppStore(s => s.setFocusResultId);
  const [st, setSt] = useState<ProtectionStatus | null>(null);
  const [apps, setApps] = useState<WatchedApp[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!android) return;
    try {
      setSt(await BackgroundScan.getStatus());
      setApps((await BackgroundScan.listApps()).apps);
    } catch {
      setMsg('This copy of the app does not include Phone Protection. Install the latest FraudSentry APK.');
    }
  }, [android]);

  useEffect(() => {
    void refresh();
    if (!android) return;
    // coming back from Android's settings screens
    const onVis = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [android, refresh]);

  const save = async (o: Parameters<typeof BackgroundScan.setConfig>[0]) => {
    try { setSt(await BackgroundScan.setConfig(o)); setApps((await BackgroundScan.listApps()).apps); } catch { setMsg('Could not save the setting.'); }
  };
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setMsg('');
    try { await f(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); void refresh(); }
  };

  const found = messageScans.filter(m => m.origin === 'background');

  const head = (
    <div className="page-head">
      <div className="page-head-ico"><Smartphone size={22} /></div>
      <div>
        <h1>Phone Protection</h1>
        <p>FraudSentry checks new messages from your messaging apps in the background and warns you when one looks like a scam or phishing. No copying and pasting.</p>
      </div>
    </div>
  );

  if (!android) {
    return (
      <div className="page pp-page">
        {head}
        <section className="card pad">
          <h2 className="section-title"><Smartphone size={18} /> Available in the Android app</h2>
          <p className="small">Checking messages in the background needs Android's <strong>Notification access</strong>, which only an installed Android app can have. Websites, iPhones and computers do not allow it. Install the FraudSentry Android app (APK) from the project website, then open this page there.</p>
          <p className="small muted" style={{ marginBottom: 0 }}>Here you can still check a message by pasting it on the <button type="button" className="link-btn" onClick={() => onNavigate('analyzer')}>Check Message</button> page.</p>
        </section>
        <HowToUse />
      </div>
    );
  }

  const ready = !!st && st.notificationAccess && st.enabled;
  const watched = apps.filter(a => a.watched && a.installed);

  return (
    <div className="page pp-page">
      {head}

      <section className={`card pad pp-status${ready ? ' on' : ''}`} aria-live="polite">
        <div className="pp-status-row">
          {ready ? <ShieldCheck size={26} aria-hidden="true" /> : <Smartphone size={26} aria-hidden="true" />}
          <div style={{ flex: 1 }}>
            <strong>{!st ? 'Checking…' : ready ? 'On — new messages are checked automatically' : 'Off'}</strong>
            {st && ready && <div className="small muted">Watching {watched.length} app{watched.length === 1 ? '' : 's'}{st.watchAll ? ' and all other apps' : ''}. Warns at {st.alertLevel} risk and above.</div>}
            {st && <div className="small muted">Checked {st.checked} message{st.checked === 1 ? '' : 's'} · {st.flagged} suspicious kept · {st.alerted} warning{st.alerted === 1 ? '' : 's'}{st.lastCheckedAt ? ` · last ${formatDateTime(new Date(st.lastCheckedAt).toISOString())}` : ''}</div>}
          </div>
          {st && (
            <label className="toggle">
              <input type="checkbox" checked={st.enabled} disabled={busy} onChange={e => void save({ enabled: e.target.checked })} />
              {st.enabled ? 'On' : 'Turn on'}
            </label>
          )}
        </div>
        {msg && <p className="small" role="alert" style={{ color: 'var(--danger, #c0392b)', marginBottom: 0 }}>{msg}</p>}
      </section>

      {st && (
        <section className="card pad" aria-labelledby="pp-setup">
          <h2 id="pp-setup" className="section-title"><Settings2 size={18} /> Setup</h2>
          <ol className="pp-steps">
            <Step done={st.notificationAccess} title="Allow Notification access">
              <p className="small">Lets FraudSentry read the text of new notifications so it can check them. Android shows a strong warning for this: FraudSentry has no internet permission, so what it reads cannot leave your phone.</p>
              <div className="pp-actions">
                <button type="button" className="btn-primary" disabled={busy} onClick={() => run(() => BackgroundScan.openNotificationAccess())}>Open Notification access</button>
              </div>
              {st.sdk >= 33 && (
                <p className="small muted">Is the switch greyed out (“Restricted setting”)? Android does this for apps installed from an APK. Open <button type="button" className="link-btn" onClick={() => run(() => BackgroundScan.openAppInfo())}>App info</button>, tap ⋮ (top right) → <strong>Allow restricted settings</strong>, then try again.</p>
              )}
            </Step>
            <Step done={st.notificationsAllowed} title="Allow FraudSentry's warnings">
              <div className="pp-actions"><button type="button" className="btn-secondary" disabled={busy} onClick={() => run(async () => setSt(await BackgroundScan.requestNotifications()))}><Bell size={16} /> Allow notifications</button></div>
            </Step>
            <Step done={st.enabled} title="Turn Phone Protection on">
              <div className="pp-actions"><button type="button" className="btn-secondary" disabled={busy} onClick={() => void save({ enabled: true })}>Turn on</button></div>
            </Step>
          </ol>
          <div className="pp-actions" style={{ marginTop: 6 }}>
            <button type="button" className="btn-secondary" disabled={busy || !st.notificationsAllowed} onClick={() => run(async () => {
              const r = await BackgroundScan.testAlert();
              setMsg(`A test warning was posted (sample scam text: ${RISK_META[r.threatLevel].label}, ${r.scamType}). Nothing was saved.`);
            })}><BellRing size={16} /> Show a test warning</button>
          </div>
        </section>
      )}

      {st && (
        <section className="card pad" aria-labelledby="pp-apps">
          <h2 id="pp-apps" className="section-title"><Smartphone size={18} /> Apps to watch</h2>
          <p className="small muted">Only new notifications from the apps ticked here are checked. Apps not installed on this phone are greyed out.</p>
          <div className="pp-apps">
            {apps.map(a => (
              <label key={a.pkg} className={`toggle pp-app${a.installed ? '' : ' missing'}`}>
                <input type="checkbox" checked={a.watched} onChange={e => void save({ apps: e.target.checked ? [...st.apps, a.pkg] : st.apps.filter(p => p !== a.pkg) })} />
                {a.label}{!a.installed && <span className="muted small"> (not installed)</span>}
              </label>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={st.watchAll} onChange={e => void save({ watchAll: e.target.checked })} />
            Also check notifications from all other apps
          </label>

          <h3 className="section-title" style={{ marginTop: 14 }}><Bell size={16} /> Warn me about</h3>
          <div className="pp-levels" role="radiogroup" aria-label="Warn me about">
            {THRESHOLDS.map(([v, label]) => (
              <label key={v} className="toggle">
                <input type="radio" name="pp-level" checked={st.alertLevel === v} onChange={() => void save({ alertLevel: v })} /> {label}
              </label>
            ))}
          </div>
          <p className="small muted">Every message is checked, but only suspicious ones (Medium risk or higher) are kept in your records. Ordinary messages are checked and forgotten.</p>

          <h3 className="section-title" style={{ marginTop: 14 }}><ImageIcon size={16} /> Screenshots</h3>
          <label className="toggle">
            <input type="checkbox" checked={st.screenshots} disabled={busy} onChange={e => {
              const on = e.target.checked;
              void run(async () => {
                if (on && !st.photosAllowed) { const s = await BackgroundScan.requestPhotos(); if (!s.photosAllowed) { setMsg('Photo access was not allowed, so new screenshots cannot be noticed.'); return; } }
                await save({ screenshots: on });
              });
            }} />
            Offer to check new screenshots (needs photo access)
          </label>
        </section>
      )}

      <section className="card pad" aria-labelledby="pp-found">
        <h2 id="pp-found" className="section-title"><ShieldCheck size={18} /> Found in the background</h2>
        {found.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>Nothing suspicious yet. Suspicious messages found while the app is closed appear here and in History when you open FraudSentry.</p>
        ) : (
          <ul className="pp-found">
            {found.slice(0, 20).map(m => (
              <li key={m.id}>
                <span className={`badge badge-${m.threatLevel}`}>{RISK_META[m.threatLevel].label}</span>
                <button type="button" className="link-btn" onClick={() => { setFocusResultId(m.id); onNavigate('history'); }}>{m.scamType}</button>
                <span className="small muted"> · {originLabel(m)} · {formatDateTime(m.scannedAt)}</span>
                <div className="small pp-excerpt">{m.textExcerpt}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <HowToUse />

      <section className="card pad" aria-labelledby="pp-privacy">
        <h2 id="pp-privacy" className="section-title"><Lock size={18} /> Privacy</h2>
        <ul className="small pp-list-plain">
          <li>Messages are checked on this phone by the same rules as the Check Message page. The app has no internet permission, so nothing is sent anywhere.</li>
          <li>Only suspicious messages (Medium or higher) are kept, in the on-device database, with the app they came in and the sender's name as shown in the notification. Delete them any time from History.</li>
          <li>Turning Phone Protection off stops the checks at once. To remove the access completely, switch FraudSentry off under Notification access.</li>
          <li>Android may stop background apps to save battery. If warnings stop coming, set FraudSentry's battery use to “Unrestricted”.</li>
        </ul>
      </section>
    </div>
  );
}
