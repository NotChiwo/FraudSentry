import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { History, Download, Trash2, Inbox, ScanLine, MessageSquareWarning, GitCompareArrows, Search, HardDrive, X, Trees } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { generateImageReport, generateMessageReport } from '../services/reportGenerator';
import { formatDateTime, formatRelativeTime, formatPHP, downloadBlob } from '../utils/helpers';
import { RiskLevel, ImageScanResult } from '../types';
import TrainingLabel from '../components/training/TrainingLabel';
import { counts, readiness, rowsToCsv } from '../services/trainingData';

type Kind = 'all' | 'receipt' | 'message' | 'cross';
type LevelFilter = 'any' | 'risky';
interface Row {
  id: string; kind: Exclude<Kind, 'all'>; title: string; meta: string; level: RiskLevel; when: string;
  search: string; onDownload?: () => void; onDelete: () => void;
  /** receipts only: for the Genuine / Fake training label */
  scan?: ImageScanResult;
}

const LEVEL_LABEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const KIND: Record<Row['kind'], { label: string; icon: LucideIcon }> = {
  receipt: { label: 'Receipt', icon: ScanLine },
  message: { label: 'Message', icon: MessageSquareWarning },
  cross: { label: 'Cross-Evidence', icon: GitCompareArrows },
};
const RECEIPT_TITLE: Record<RiskLevel, string> = {
  low: 'No problems found by these checks', medium: "Some details don't add up", high: 'Suspicious receipt', critical: 'Likely fake receipt',
};

export default function ReportsPage({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const imageScans = useAppStore(s => s.imageScans);
  const messageScans = useAppStore(s => s.messageScans);
  const crossChecks = useAppStore(s => s.crossChecks);
  const clearHistory = useAppStore(s => s.clearHistory);
  const removeImageScan = useAppStore(s => s.removeImageScan);
  const removeMessageScan = useAppStore(s => s.removeMessageScan);
  const removeCrossCheck = useAppStore(s => s.removeCrossCheck);
  const [kind, setKind] = useState<Kind>('all');
  const [level, setLevel] = useState<LevelFilter>('any');
  const [q, setQ] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const trainingRows = useAppStore(s => s.trainingRows);
  const clearTrainingRows = useAppStore(s => s.clearTrainingRows);
  const [confirmClearTraining, setConfirmClearTraining] = useState(false);

  const rows: Row[] = useMemo(() => {
    const r: Row[] = [
      ...imageScans.map(s => ({
        id: s.id, kind: 'receipt' as const, level: s.riskLevel, when: s.scannedAt,
        title: RECEIPT_TITLE[s.riskLevel],
        meta: [s.source !== 'Unknown' ? s.source : null, s.extracted.amount != null ? formatPHP(s.extracted.amount) : null, s.extracted.referenceNo ? `Ref ${s.extracted.referenceNo}` : null].filter(Boolean).join(' · ') || s.filename,
        search: [s.filename, s.source, s.extracted.referenceNo, s.extracted.receiverName, s.extracted.amount].join(' '),
        onDownload: () => generateImageReport(s), onDelete: () => removeImageScan(s.id), scan: s,
      })),
      ...messageScans.map(s => ({
        id: s.id, kind: 'message' as const, level: s.threatLevel, when: s.scannedAt,
        title: s.scamType, meta: `${s.platform} · ${s.flags.length} warning sign${s.flags.length === 1 ? '' : 's'}`,
        search: [s.scamType, s.platform, s.textExcerpt].join(' '),
        onDownload: () => generateMessageReport(s), onDelete: () => removeMessageScan(s.id),
      })),
      ...crossChecks.map(s => ({
        id: s.id, kind: 'cross' as const, level: s.combinedRiskLevel, when: s.scannedAt,
        title: s.verdict, meta: `Receipt ${LEVEL_LABEL[s.transactionRiskLevel]} · Conversation ${LEVEL_LABEL[s.conversationRiskLevel]}`,
        search: s.verdict, onDelete: () => removeCrossCheck(s.id),
      })),
    ];
    return r.sort((a, b) => b.when.localeCompare(a.when));
  }, [imageScans, messageScans, crossChecks, removeImageScan, removeMessageScan, removeCrossCheck]);

  const shown = rows.filter(r =>
    (kind === 'all' || r.kind === kind) &&
    (level === 'any' || r.level === 'high' || r.level === 'critical') &&
    (!q.trim() || r.search.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const count = (k: Kind) => (k === 'all' ? rows.length : rows.filter(r => r.kind === k).length);

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div className="page-head-ico"><History size={22} /></div>
        <div>
          <h1>History</h1>
          <p>Every check you run is kept in this browser only, so you can look back or download a report. Nothing here is sent anywhere.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <>
        {trainingRows.length > 0 && (
          <TrainingCard rows={trainingRows} onNavigate={onNavigate}
            confirmClear={confirmClearTraining} setConfirmClear={setConfirmClearTraining} onClear={clearTrainingRows} />
        )}
        <div className="card empty-state">
          <span className="empty-ico"><Inbox size={28} /></span>
          <h2>No checks yet</h2>
          <p>When you check a receipt or a message, it shows up here, ready to review or download as a PDF.</p>
          {onNavigate && (
            <div className="dz-actions">
              <button type="button" className="btn-primary" onClick={() => onNavigate('scanner')}><ScanLine size={17} /> Check a receipt</button>
              <button type="button" className="btn-secondary" onClick={() => onNavigate('analyzer')}><MessageSquareWarning size={17} /> Check a message</button>
            </div>
          )}
        </div>
        </>
      ) : (
        <>
          <div className="history-tools">
            <label className="search-box">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search history</span>
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by reference, app, name, amount…" />
              {q && <button type="button" className="icon-btn sm" aria-label="Clear search" onClick={() => setQ('')}><X size={15} /></button>}
            </label>
            <div className="chip-row" role="group" aria-label="Filter by type">
              {(['all', 'receipt', 'message', 'cross'] as Kind[]).map(k => (
                <button key={k} type="button" className={`filter-btn${kind === k ? ' active' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {k === 'all' ? 'All' : KIND[k].label} <span className="count">{count(k)}</span>
                </button>
              ))}
              <button type="button" className={`filter-btn${level === 'risky' ? ' active' : ''}`} aria-pressed={level === 'risky'} onClick={() => setLevel(l => (l === 'risky' ? 'any' : 'risky'))}>
                High risk only
              </button>
            </div>
          </div>

          <TrainingCard rows={trainingRows} onNavigate={onNavigate}
            confirmClear={confirmClearTraining} setConfirmClear={setConfirmClearTraining} onClear={clearTrainingRows} />

          <p className="muted small" aria-live="polite">{shown.length} of {rows.length} shown</p>
          <ul className="history-list">
            {shown.map(r => <HistoryRow key={r.id} row={r} />)}
          </ul>
          {shown.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: 24 }}>Nothing matches these filters.</p>}

          <div className="card device-card">
            <HardDrive size={20} aria-hidden="true" />
            <div>
              <b>Your data stays on this device.</b>
              <p>History lives in this browser's local storage (up to the last 40 receipts and 40 messages). Clearing your browser data also removes it. Receipt images are not kept, only the details read from them. Training labels are kept separately (numbers only) and are not removed by “Delete all”.</p>
            </div>
            {confirmClear ? (
              <div className="confirm-row">
                <span>Delete all {rows.length} records?</span>
                <button type="button" className="btn-ghost danger" onClick={() => { clearHistory(); setConfirmClear(false); }}>Yes, delete all</button>
                <button type="button" className="btn-ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="btn-ghost danger" onClick={() => setConfirmClear(true)}><Trash2 size={15} /> Delete all</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function HistoryRow({ row }: { row: Row }) {
  const [confirm, setConfirm] = useState(false);
  const K = KIND[row.kind];
  return (
    <li className={`history-row sev-${row.level === 'low' ? 'ok' : row.level}`}>
      <span className="hr-ico" aria-hidden="true"><K.icon size={18} /></span>
      <div className="hr-main">
        <div className="hr-top">
          <span className="hr-kind">{K.label}</span>
          <span className={`sev-chip sev-${row.level === 'low' ? 'ok' : row.level}`}>{LEVEL_LABEL[row.level]}</span>
        </div>
        <div className="hr-title">{row.title}</div>
        <div className="hr-meta">{row.meta}</div>
        {row.scan && <TrainingLabel scan={row.scan} compact />}
      </div>
      <div className="hr-side">
        <time dateTime={row.when} title={formatDateTime(row.when)}>{formatRelativeTime(row.when)}</time>
        <div className="hr-actions">
          {row.onDownload && <button type="button" className="btn-ghost" onClick={row.onDownload} aria-label={`Download PDF report: ${row.title}`}><Download size={15} /> PDF</button>}
          {confirm ? (
            <>
              <button type="button" className="btn-ghost danger" onClick={row.onDelete}>Delete</button>
              <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>Keep</button>
            </>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => setConfirm(true)} aria-label={`Delete record: ${row.title}`}><Trash2 size={15} /></button>
          )}
        </div>
      </div>
    </li>
  );
}

function TrainingCard(props: {
  rows: ReturnType<typeof useAppStore.getState>['trainingRows'];
  onNavigate?: (p: string) => void;
  confirmClear: boolean; setConfirmClear: (v: boolean) => void; onClear: () => void;
}) {
  const c = counts(props.rows);
  const ready = readiness(props.rows);
  return (
    <section className="card training-card" aria-labelledby="training-title">
      <div className="tc-head">
        <Trees size={20} aria-hidden="true" />
        <h2 id="training-title" className="section-title" style={{ margin: 0 }}>Training data for the Random Forest</h2>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Mark each checked receipt <b>Genuine</b> or <b>Fake</b> (what it really is, not what the app said). The forest then learns from real evidence instead of the demonstration data.
        Only the 10 evidence numbers and your label are kept — no names, account numbers or amounts — and they stay on this device even after history is cleared.
      </p>
      <div className="tc-counts" aria-live="polite">
        <span><b>{c.total}</b> labelled</span><span><b>{c.genuine}</b> genuine</span><span><b>{c.fake}</b> fake</span>
        <span>{ready.message}</span>
      </div>
      <div className="tc-actions">
        <button type="button" className="btn-primary" disabled={!ready.ok} onClick={() => props.onNavigate?.('model')}><Trees size={15} /> Train on the Model page</button>
        <button type="button" className="btn-secondary" disabled={c.total === 0}
          onClick={() => downloadBlob(rowsToCsv(props.rows), `fraudsentry-training-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv')}>
          <Download size={15} /> Download training CSV
        </button>
        {c.total > 0 && (props.confirmClear ? (
          <span className="confirm-row">
            <span>Delete all {c.total} labels?</span>
            <button type="button" className="btn-ghost danger" onClick={() => { props.onClear(); props.setConfirmClear(false); }}>Yes, delete</button>
            <button type="button" className="btn-ghost" onClick={() => props.setConfirmClear(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="btn-ghost danger" onClick={() => props.setConfirmClear(true)}><Trash2 size={15} /> Delete labels</button>
        ))}
      </div>
    </section>
  );
}
