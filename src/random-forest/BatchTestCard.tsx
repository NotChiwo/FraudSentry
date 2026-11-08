// Batch test card (Detection Model page): scan a set of receipts whose truth
// you know — genuine ones and fake/edited ones — with the same checks a live
// scan uses, and see the false-alarm rate and how many fakes were caught.
// Nothing is added to History; the receipts never leave the device.
import { useRef, useState } from 'react';
import { ClipboardCheck, Play, Square, Download, Database, CheckCircle2, XCircle, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react';
import { analyzeTransactionImage } from '../receipt-check/verifyReceipt';
import { OcrCancelled } from '../receipt-check/ocr/ocr';
import { validateImageFile, shrinkLargePhoto, ACCEPTED_IMAGE_TYPES } from '../receipt-check/checks/uploadValidation';
import { classificationShown, downloadBlob } from '../shared/helpers';
import { useAppStore } from '../shared/store';
import { summarize, batchCsv, isCorrect, topReason, genuineNeededFor, type BatchRow, type Truth } from './batchTest';

const pct = (v: number | null, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const NEEDED_FOR_99 = genuineNeededFor(0.01);

export default function BatchTestCard() {
  const [queue, setQueue] = useState<{ file: File; truth: Truth }[]>([]);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState('');
  const [onlyWrong, setOnlyWrong] = useState(false);
  const [saved, setSaved] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const genuineRef = useRef<HTMLInputElement>(null);
  const fakeRef = useRef<HTMLInputElement>(null);
  const labelScan = useAppStore(s => s.labelScan);

  const add = (files: FileList | null, truth: Truth) => {
    if (!files) return;
    const picked = [...files].map(file => ({ file, truth }));
    setQueue(q => [...q, ...picked]);
  };
  const qGenuine = queue.filter(q => q.truth === 'genuine').length;

  async function run() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true); setRows([]); setSaved('');
    const out: BatchRow[] = [];
    for (let i = 0; i < queue.length; i++) {
      if (ctrl.signal.aborted) break;
      const { file: picked, truth } = queue[i];
      setCurrent(`${i + 1} of ${queue.length} · ${picked.name}`);
      let row: BatchRow;
      try {
        const file = (await shrinkLargePhoto(picked)) ?? picked;
        const err = await validateImageFile(file);
        if (err) row = { file: picked.name, truth, error: err };
        else {
          // history: [] — each receipt is judged on its own, as if it were the first scan
          const scan = await analyzeTransactionImage(file, { history: [], signal: ctrl.signal });
          row = { file: picked.name, truth, scan };
        }
      } catch (e) {
        if (e instanceof OcrCancelled || ctrl.signal.aborted) break;
        row = { file: picked.name, truth, error: e instanceof Error ? e.message : String(e) };
      }
      out.push(row);
      setRows([...out]);
    }
    setRunning(false); setCurrent('');
  }

  function saveAsTraining() {
    const done = rows.filter(r => r.scan);
    for (const r of done) labelScan(r.scan!, r.truth === 'fake' ? 1 : 0);
    setSaved(`${done.length} receipts saved as labelled training rows (genuine = legitimate, fake = fraudulent). Use "Use my labelled receipts" above to train on them.`);
  }

  const sum = summarize(rows);
  const shown = onlyWrong ? rows.filter(r => !isCorrect(r)) : rows;
  const doneCount = rows.length;

  return (
    <div className="card fade-up" style={{ padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <ClipboardCheck size={16} color="var(--accent-light)" />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Batch test with receipts you know</span>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 14px' }}>
        Add receipts you <b>know</b> are genuine and receipts you <b>know</b> are fake or edited. Each one is scanned with exactly the checks a live scan uses, then compared with the truth.
        This measures how often a genuine receipt is wrongly flagged and how many fakes are caught. Nothing is added to History, and the images stay on this device.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn-secondary" disabled={running} onClick={() => genuineRef.current?.click()}><ShieldCheck size={14} /> Add genuine receipts</button>
        <button className="btn-secondary" disabled={running} onClick={() => fakeRef.current?.click()}><ShieldAlert size={14} /> Add fake / edited receipts</button>
        <input ref={genuineRef} type="file" multiple accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden onChange={e => { add(e.target.files, 'genuine'); e.target.value = ''; }} />
        <input ref={fakeRef} type="file" multiple accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden onChange={e => { add(e.target.files, 'fake'); e.target.value = ''; }} />
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{qGenuine} genuine · {queue.length - qGenuine} fake queued</span>
        {queue.length > 0 && !running && <button className="btn-ghost" onClick={() => { setQueue([]); setRows([]); setSaved(''); }}><Trash2 size={13} /> Clear</button>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {running
            ? <button className="btn-secondary" onClick={() => abortRef.current?.abort()}><Square size={13} /> Stop</button>
            : <button className="btn-primary" disabled={!queue.length} onClick={run}><Play size={14} /> Run test ({queue.length})</button>}
        </span>
      </div>

      {(running || doneCount > 0) && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 5 }}>
            <span>{running ? `Scanning ${current}` : `Finished: ${doneCount} of ${queue.length} scanned`}</span>
            <span className="mono">{queue.length ? Math.round((doneCount / queue.length) * 100) : 0}%</span>
          </div>
          <div style={{ height: 7, borderRadius: 99, background: 'var(--bg-input)', overflow: 'hidden' }}>
            <div style={{ width: `${queue.length ? (doneCount / queue.length) * 100 : 0}%`, height: '100%', background: 'var(--accent-light)', transition: 'width .3s' }} />
          </div>
        </div>
      )}

      {doneCount > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginTop: 16 }}>
            <Tile label="Genuine passed" value={`${sum.genuinePassed} of ${sum.genuine}`} sub={sum.genuine ? pct(sum.genuine ? sum.genuinePassed / sum.genuine : null) : 'none scanned'} good />
            <Tile label="False alarms" value={`${sum.falseAlarms}`} sub={sum.falseAlarmRate == null ? 'no genuine receipts' : `${pct(sum.falseAlarmRate)} · could be up to ${pct(sum.falseAlarmUpper)}`} bad={sum.falseAlarms > 0} />
            <Tile label="Fakes caught" value={`${sum.fakesCaught} of ${sum.fakes}`} sub={!sum.fakes ? 'none scanned' : sum.fakesUnverifiable ? `${pct(sum.catchRate)} · ${sum.fakesUnverifiable} as “Can’t be verified”` : pct(sum.catchRate)} good={sum.fakes > 0 && sum.fakesMissed === 0} bad={sum.fakesMissed > 0} />
            <Tile label="Couldn't scan" value={`${sum.failed}`} sub="not counted" />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 10 }}>
            "Could be up to" is the 95% upper bound for this many receipts: with few receipts the true rate can be much higher than what was seen.
            To show that genuine receipts pass at least 99% of the time, about <b>{NEEDED_FOR_99}</b> genuine receipts with no false alarm are needed.
            {sum.genuineUnverifiable > 0 && <> {sum.genuineUnverifiable} of the false alarms were shown as "Can’t be verified" (details blurred), not as fake.</>}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '14px 0 8px' }}>
            <label style={{ fontSize: 12.5, color: 'var(--text-secondary)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={onlyWrong} onChange={e => setOnlyWrong(e.target.checked)} /> Show only wrong results
            </label>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn-secondary" disabled={running} onClick={() => downloadBlob(batchCsv(rows), `fraudsentry-batch-test-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv')}><Download size={13} /> Export CSV</button>
              <button className="btn-secondary" disabled={running || !rows.some(r => r.scan)} onClick={saveAsTraining} title="Adds each scanned receipt to your labelled training rows with its known truth"><Database size={13} /> Save as training rows</button>
            </span>
          </div>
          {saved && <div style={{ fontSize: 12, color: 'var(--accent-emerald)', marginBottom: 8 }}>{saved}</div>}

          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>File</th><th>Truth</th><th>Result</th><th>Shown as</th><th>Right?</th><th>Main reason</th></tr></thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={`${r.file}-${i}`}>
                    <td className="mono" style={{ maxWidth: 220, overflowWrap: 'anywhere' }}>{r.file}</td>
                    <td>{r.truth === 'genuine' ? 'Genuine' : 'Fake'}</td>
                    <td>{r.scan ? <span className={`badge badge-${r.scan.riskLevel}`}>{r.scan.riskLevel} · {Math.round(r.scan.riskScore * 100)}%</span> : '—'}</td>
                    <td>{r.scan ? classificationShown(r.scan).label : 'Couldn’t scan'}</td>
                    <td>{r.scan ? (isCorrect(r) ? <CheckCircle2 size={15} color="var(--accent-emerald)" aria-label="right" /> : <XCircle size={15} color="var(--accent-red)" aria-label="wrong" />) : '—'}</td>
                    <td style={{ minWidth: 180 }}>{r.scan ? topReason(r.scan) : r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, good, bad }: { label: string; value: string; sub: string; good?: boolean; bad?: boolean }) {
  const color = bad ? 'var(--accent-red)' : good ? 'var(--accent-emerald)' : 'var(--text-primary)';
  return (
    <div style={{ padding: '10px 12px', border: '1px solid var(--border-default)', borderRadius: 10, background: 'var(--bg-input)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  );
}
