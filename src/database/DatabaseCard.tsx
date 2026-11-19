// Privacy & Data → "On-device database": what is stored, how much space it
// uses, keeping it safe from the browser's automatic clean-up, and backing it
// up to a file / restoring it.
import { useEffect, useRef, useState } from 'react';
import { Database as DbIcon, Download, Upload, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../shared/store';
import { downloadBlob, formatBytes, formatDateTime } from '../shared/helpers';
import { APP_VERSION } from '../shared/version';
import { database, flushed } from './sync';
import { makeBackup, readBackup, backupFilename } from './backup';

export default function DatabaseCard() {
  const s = useAppStore();
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const counts: [string, number][] = [
    ['Receipts', s.imageScans.length], ['Messages', s.messageScans.length], ['Cross-evidence', s.crossChecks.length],
    ['Typed transactions', s.manualTransactions.length], ['Alerts', s.alerts.length], ['Reports', s.reports.length],
  ];
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const oldest = [...s.imageScans, ...s.messageScans, ...s.crossChecks, ...s.manualTransactions].map(r => r.scannedAt).sort()[0];

  useEffect(() => {
    const st = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    st?.estimate?.().then(e => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => {});
    st?.persisted?.().then(setPersisted).catch(() => {});
  }, [total]);

  const protect = async () => {
    try {
      const ok = await navigator.storage?.persist?.();
      setPersisted(!!ok);
      setNote(ok ? 'The browser will no longer delete the database on its own to free up space.' : 'The browser did not allow it (it decides by how often the app is used). Back up regularly to be safe.');
    } catch { setNote('This browser does not support protecting the database. Back up regularly to be safe.'); }
  };

  const backup = async () => {
    await flushed();
    const images: Record<string, string> = {};
    const db = database();
    if (db) for (const r of await db.getAll<{ id: string; dataUrl: string }>('receiptImages')) images[r.id] = r.dataUrl;
    const file = makeBackup({ imageScans: s.imageScans, messageScans: s.messageScans, crossChecks: s.crossChecks, manualTransactions: s.manualTransactions, alerts: s.alerts, reports: s.reports }, images, APP_VERSION);
    downloadBlob(JSON.stringify(file), backupFilename(), 'application/json');
    setNote(`Backup saved: ${total} records${Object.keys(images).length ? ` and ${Object.keys(images).length} receipt images` : ''}. Keep the file somewhere safe; it contains names, amounts and reference numbers.`);
  };

  const restore = async (f: File) => {
    try {
      const b = readBackup(await f.text());
      const before = total;
      s.restoreBackup(b);
      const db = database();
      if (db) await db.put('receiptImages', Object.entries(b.receiptImages).map(([id, dataUrl]) => ({ id, dataUrl })));
      const after = useAppStore.getState();
      const now = [after.imageScans, after.messageScans, after.crossChecks, after.manualTransactions, after.alerts, after.reports].reduce((a, l) => a + l.length, 0);
      setNote(now > before ? `Restored ${now - before} records from the backup. Records you already had were kept as they are.` : 'Everything in this backup is already in the database. Nothing was added.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'The backup could not be read.');
    }
  };

  const status = s.dbStatus === 'ready' ? 'Connected' : s.dbStatus === 'loading' ? 'Opening…' : 'Not available in this browser';
  return (
    <section className="card db-card" aria-labelledby="db-title">
      <div className="db-head">
        <DbIcon size={18} color="var(--accent-light)" />
        <h2 id="db-title">On-device database</h2>
        <span className={`db-status db-${s.dbStatus}`}>{status}</span>
      </div>
      <p className="muted small" style={{ margin: '6px 0 12px' }}>
        {s.dbStatus === 'unavailable'
          ? 'This browser does not allow an on-device database (for example, some private windows). Your checks are kept in the browser’s smaller storage instead, without receipt images.'
          : 'Every check is kept here until you delete it, so an earlier case of the same fraud, reference number or recipient can always be found. It stays on this device; nothing is uploaded.'}
      </p>
      <div className="db-counts">
        {counts.map(([label, n]) => <div key={label}><strong>{n}</strong><span>{label}</span></div>)}
      </div>
      <p className="small" style={{ margin: '12px 0 0' }}>
        {total ? <>Records since <strong>{formatDateTime(oldest ?? new Date().toISOString())}</strong>.</> : 'No records yet.'}
        {usage && usage.quota > 0 && <> Using {formatBytes(usage.used)} of the {formatBytes(usage.quota)} this browser allows.</>}
        {persisted === true && <> <ShieldCheck size={13} style={{ verticalAlign: '-2px' }} /> Protected from automatic clean-up.</>}
      </p>
      <div className="db-actions">
        <button type="button" className="btn-primary" onClick={backup} disabled={!total}><Download size={16} /> Back up to a file</button>
        <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}><Upload size={16} /> Restore from a backup</button>
        {persisted === false && <button type="button" className="btn-secondary" onClick={protect}><ShieldCheck size={16} /> Protect from clean-up</button>}
        <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Choose a FraudSentry backup file"
          onChange={e => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = ''; }} />
      </div>
      {note && <p className="small db-note" role="status">{note}</p>}
    </section>
  );
}
