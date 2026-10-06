import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { History, Download, Trash2, Inbox, ScanLine, MessageSquareWarning, GitCompareArrows, Search, HardDrive, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { generateImageReport, generateMessageReport } from '../services/reportGenerator';
import { formatDateTime, formatRelativeTime, formatPHP } from '../utils/helpers';
import { RiskLevel } from '../types';

type Kind = 'all' | 'receipt' | 'message' | 'cross';
type LevelFilter = 'any' | 'risky';
interface Row {
  id: string; kind: Exclude<Kind, 'all'>; title: string; meta: string; level: RiskLevel; when: string;
  search: string; onDownload?: () => void; onDelete: () => void;
}

const LEVEL_LABEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const KIND: Record<Row['kind'], { label: string; icon: LucideIcon }> = {
  receipt: { label: 'Receipt', icon: ScanLine },
  message: { label: 'Message', icon: MessageSquareWarning },
  cross: { label: 'Cross-Evidence', icon: GitCompareArrows },
};
const RECEIPT_TITLE: Record<RiskLevel, string> = {
  low: 'No signs of editing found', medium: "Some details don't add up", high: 'Suspicious receipt', critical: 'Likely fake receipt',
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

  const rows: Row[] = useMemo(() => {
    const r: Row[] = [
      ...imageScans.map(s => ({
        id: s.id, kind: 'receipt' as const, level: s.riskLevel, when: s.scannedAt,
        title: RECEIPT_TITLE[s.riskLevel],
        meta: [s.source !== 'Unknown' ? s.source : null, s.extracted.amount != null ? formatPHP(s.extracted.amount) : null, s.extracted.referenceNo ? `Ref ${s.extracted.referenceNo}` : null].filter(Boolean).join(' · ') || s.filename,
        search: [s.filename, s.source, s.extracted.referenceNo, s.extracted.receiverName, s.extracted.amount].join(' '),
        onDownload: () => generateImageReport(s), onDelete: () => removeImageScan(s.id),
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

          <p className="muted small" aria-live="polite">{shown.length} of {rows.length} shown</p>
          <ul className="history-list">
            {shown.map(r => <HistoryRow key={r.id} row={r} />)}
          </ul>
          {shown.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: 24 }}>Nothing matches these filters.</p>}

          <div className="card device-card">
            <HardDrive size={20} aria-hidden="true" />
            <div>
              <b>Your data stays on this device.</b>
              <p>History lives in this browser's local storage (up to the last 40 receipts and 40 messages). Clearing your browser data also removes it. Receipt images are not kept, only the details read from them.</p>
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
