// Transactions (thesis Module 2): every payment checked on this device — from
// a receipt screenshot or from typed details — with its result and its real
// outcome (did the money arrive?). Marking the outcome of a receipt also
// makes it a training example for the Random Forest.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ReceiptText, Plus, X, Search, ScanLine, Keyboard, Trash2, Download, Loader2, CheckCircle2, XCircle, Clock, ArrowRight } from 'lucide-react';
import { useAppStore } from '../shared/store';
import { checkTransaction, toExtracted, describeTransaction, type TransactionInput, type ManualTransaction } from './transactionCheck';
import { KNOWN_SOURCES, TRANSACTION_TYPES, DIRECTION_LABEL, type TransactionType, type TransactionDirection } from '../receipt-check/reading/receiptParser';
import type { PriorScan } from '../receipt-check/checks/historyMatch';
import { formatDateTime, formatPHP, downloadBlob, classificationOf, classificationShown, CLASSIFICATION_LABEL } from '../shared/helpers';
import { phDay } from '../reports/fraudReports';
import type { EvidenceSource, RiskLevel, TransactionStatus, Classification } from '../shared/types';

const LEVEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const STATUS_LABEL: Record<TransactionStatus, string> = { pending: 'Not confirmed yet', received: 'Money received', 'not-received': 'Not received' };

interface Row {
  id: string; kind: 'receipt' | 'manual';
  when: string; source: string; type: string; amount: number | null; reference: string | null; receiver: string | null;
  txDate: string | null; direction: TransactionDirection | null; riskLevel: RiskLevel; classification: Classification; shown: { label: string; cls: string }; status: TransactionStatus; statusAt?: string;
  manual?: ManualTransaction;
}

const sev = (l: RiskLevel) => (l === 'low' ? 'ok' : l);

export default function TransactionsPage({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const imageScans = useAppStore(s => s.imageScans);
  const manual = useAppStore(s => s.manualTransactions);
  const setTxStatus = useAppStore(s => s.setTxStatus);
  const removeManual = useAppStore(s => s.removeManualTransaction);
  const setFocusResultId = useAppStore(s => s.setFocusResultId);
  const focusResultId = useAppStore(s => s.focusResultId);
  const [formOpen, setFormOpen] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | TransactionStatus>('all');
  const [cls, setCls] = useState<'all' | Classification>('all');
  const [source, setSource] = useState('all');
  const [type, setType] = useState('all');
  const [direction, setDirection] = useState<'all' | TransactionDirection>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  // "View check" on a transaction alert opens it here
  useEffect(() => {
    if (!focusResultId || !manual.some(t => t.id === focusResultId)) return;
    setOpen(focusResultId); setFocusResultId(null);
    setTimeout(() => document.getElementById(`tx-${focusResultId}`)?.scrollIntoView({ block: 'center' }), 60);
  }, [focusResultId, manual, setFocusResultId]);

  const rows: Row[] = useMemo(() => [
    ...imageScans.map(s => ({
      id: s.id, kind: 'receipt' as const, when: s.scannedAt, source: s.source, type: s.transactionType ?? 'Other',
      amount: s.extracted.amount, reference: s.extracted.referenceNo, receiver: s.extracted.receiverName ?? s.extracted.receiverContact,
      txDate: [s.extracted.date, s.extracted.time].filter(Boolean).join(' ') || null, direction: s.direction ?? null,
      riskLevel: s.riskLevel, classification: s.classification ?? classificationOf(s.riskLevel), shown: classificationShown(s), status: s.txStatus ?? 'pending', statusAt: s.txStatusAt,
    })),
    ...manual.map(t => ({
      id: t.id, kind: 'manual' as const, when: t.scannedAt, source: t.input.institution, type: t.input.type,
      amount: t.input.amount, reference: t.input.referenceNo, receiver: t.input.receiverName ?? t.input.receiverContact,
      txDate: [t.input.date, t.input.time].filter(Boolean).join(' ') || null, direction: null,
      riskLevel: t.riskLevel, classification: t.classification, shown: classificationShown(t), status: t.txStatus, statusAt: t.txStatusAt, manual: t,
    })),
  ].sort((a, b) => b.when.localeCompare(a.when)), [imageScans, manual]);

  const shown = rows.filter(r =>
    (status === 'all' || r.status === status) && (cls === 'all' || r.classification === cls) &&
    (source === 'all' || r.source === source) && (type === 'all' || r.type === type) && (direction === 'all' || r.direction === direction) &&
    (!from || phDay(r.when) >= from) && (!to || phDay(r.when) <= to) &&
    (!q.trim() || [r.source, r.type, r.amount, r.reference, r.receiver].join(' ').toLowerCase().includes(q.trim().toLowerCase())));
  const count = (st: TransactionStatus) => rows.filter(r => r.status === st).length;
  const sources = [...new Set(rows.map(r => r.source))].sort();
  const types = [...new Set(rows.map(r => r.type))].sort();

  const exportCsv = () => {
    const esc = (v: unknown) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
    const head = 'transaction_id,checked_at,input,institution,transaction_type,direction,amount,reference,receiver,transaction_date,risk_level,classification,status,status_updated';
    const lines = shown.map(r => [r.id, r.when, r.kind === 'receipt' ? 'receipt screenshot' : 'typed details', r.source, r.type, r.direction ?? '', r.amount ?? '', r.reference, r.receiver, r.txDate, r.riskLevel, r.classification, r.status, r.statusAt ?? ''].map(esc).join(','));
    downloadBlob([head, ...lines].join('\n') + '\n', `fraudsentry-transactions-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <div className="page-head">
        <div className="page-head-ico"><ReceiptText size={22} /></div>
        <div>
          <h1>Transactions</h1>
          <p>Every payment you checked, from a receipt or from typed details. After you look in your own bank or e-wallet, mark whether the money really arrived: that keeps your records honest, and for receipts it also teaches the detection model.</p>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="Transactions" value={rows.length} />
        <Stat label="Not confirmed yet" value={count('pending')} icon={<Clock size={15} />} />
        <Stat label="Money received" value={count('received')} icon={<CheckCircle2 size={15} />} />
        <Stat label="Not received" value={count('not-received')} icon={<XCircle size={15} />} />
      </div>

      <div className="chip-row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn-primary" onClick={() => setFormOpen(v => !v)} aria-expanded={formOpen}>
          {formOpen ? <><X size={16} /> Close</> : <><Keyboard size={16} /> Check typed details</>}
        </button>
        {onNavigate && <button type="button" className="btn-secondary" onClick={() => onNavigate('scanner')}><ScanLine size={16} /> Check a receipt screenshot</button>}
        <button type="button" className="btn-ghost" onClick={exportCsv} disabled={!shown.length}><Download size={15} /> CSV</button>
      </div>

      {formOpen && <EntryForm onDone={id => { setOpen(id); }} />}

      {rows.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-ico"><ReceiptText size={28} /></span>
          <h2>No transactions yet</h2>
          <p>Check a receipt screenshot, or enter the details a buyer sent you, and it appears here.</p>
        </div>
      ) : (
        <>
          <div className="history-tools">
            <label className="search-box">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search transactions</span>
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by reference, app, amount, recipient…" />
            </label>
            <div className="tx-filters">
              <select className="input-field" value={status} onChange={e => setStatus(e.target.value as typeof status)} aria-label="Filter by outcome">
                <option value="all">Any outcome</option>
                {(Object.keys(STATUS_LABEL) as TransactionStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
              <select className="input-field" value={cls} onChange={e => setCls(e.target.value as typeof cls)} aria-label="Filter by classification">
                <option value="all">Any classification</option>
                <option value="fraudulent">{CLASSIFICATION_LABEL.fraudulent}</option>
                <option value="legitimate">{CLASSIFICATION_LABEL.legitimate}</option>
              </select>
              <select className="input-field" value={direction} onChange={e => setDirection(e.target.value as typeof direction)} aria-label="Filter by sent or received">
                <option value="all">Sent or received</option>
                {(Object.keys(DIRECTION_LABEL) as TransactionDirection[]).map(d => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
              </select>
              <select className="input-field" value={source} onChange={e => setSource(e.target.value)} aria-label="Filter by bank or e-wallet">
                <option value="all">Any app or bank</option>
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="input-field" value={type} onChange={e => setType(e.target.value)} aria-label="Filter by transaction type">
                <option value="all">Any type</option>
                {types.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <label className="tx-date">From<input type="date" className="input-field" value={from} onChange={e => setFrom(e.target.value)} /></label>
              <label className="tx-date">To<input type="date" className="input-field" value={to} onChange={e => setTo(e.target.value)} /></label>
            </div>
          </div>
          <p className="muted small" aria-live="polite">{shown.length} of {rows.length} shown</p>
          <ul className="history-list">
            {shown.map(r => (
              <li key={r.id} id={`tx-${r.id}`} className={`history-row tx-row sev-${sev(r.riskLevel)}`}>
                <span className="hr-ico" aria-hidden="true">{r.kind === 'receipt' ? <ScanLine size={18} /> : <Keyboard size={18} />}</span>
                <div className="hr-main">
                  <div className="hr-top">
                    <span className="hr-kind">{r.type}{r.direction && r.direction !== 'unclear' ? ` · ${DIRECTION_LABEL[r.direction]}` : ''}{r.kind === 'manual' ? ' · typed details' : ''}</span>
                    <span className={`sev-chip sev-${sev(r.riskLevel)}`}>{LEVEL[r.riskLevel]}</span>
                    <span className={`cls-chip ${r.shown.cls}`}>{r.shown.label}</span>
                  </div>
                  <div className="hr-title">{[r.amount != null ? formatPHP(r.amount) : 'Amount not read', r.source !== 'Unknown' ? r.source : null].filter(Boolean).join(' · ')}</div>
                  <div className="hr-meta">{[r.reference ? `Ref ${r.reference}` : 'No reference', r.receiver ? `to ${r.receiver}` : null, r.txDate].filter(Boolean).join(' · ')}</div>
                  <OutcomeControl status={r.status} statusAt={r.statusAt} isReceipt={r.kind === 'receipt'} onChange={st => setTxStatus(r.kind, r.id, st)} />
                  {open === r.id && r.manual && <Findings t={r.manual} />}
                </div>
                <div className="hr-side">
                  <time dateTime={r.when} title={formatDateTime(r.when)}>{formatDateTime(r.when)}</time>
                  <div className="hr-actions">
                    {r.kind === 'receipt'
                      ? <button type="button" className="btn-ghost" onClick={() => { setFocusResultId(r.id); onNavigate?.('history'); }}><ArrowRight size={15} /> Details</button>
                      : <button type="button" className="btn-ghost" aria-expanded={open === r.id} onClick={() => setOpen(o => (o === r.id ? null : r.id))}>{open === r.id ? 'Hide' : 'Details'}</button>}
                    {r.kind === 'manual' && <button type="button" className="btn-ghost" aria-label="Delete this transaction" onClick={() => removeManual(r.id)}><Trash2 size={15} /></button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: 24 }}>Nothing matches these filters.</p>}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return <div className="card stat-tile"><span className="stat-label">{icon} {label}</span><span className="stat-value">{value}</span></div>;
}

/** Did the money arrive? Shared by the Transactions list and the receipt result page. */
export function OutcomeControl({ status, statusAt, isReceipt, onChange }: { status: TransactionStatus; statusAt?: string; isReceipt: boolean; onChange: (s: TransactionStatus) => void }) {
  return (
    <div className="outcome" role="group" aria-label="Did the money arrive in your account?">
      <span className="outcome-q">Did the money arrive in your account?</span>
      <button type="button" className={`tl-btn tl-genuine${status === 'received' ? ' on' : ''}`} aria-pressed={status === 'received'} onClick={() => onChange(status === 'received' ? 'pending' : 'received')}>
        <CheckCircle2 size={14} /> Received</button>
      <button type="button" className={`tl-btn tl-fake${status === 'not-received' ? ' on' : ''}`} aria-pressed={status === 'not-received'} onClick={() => onChange(status === 'not-received' ? 'pending' : 'not-received')}>
        <XCircle size={14} /> Not received</button>
      <span className="tl-note">
        {status === 'pending' ? 'Check your own bank or e-wallet first.' : `${STATUS_LABEL[status]}${statusAt ? ` · marked ${formatDateTime(statusAt)}` : ''}${isReceipt ? ' · saved as a training example (numbers only)' : ''}`}
      </span>
    </div>
  );
}

function Findings({ t }: { t: ManualTransaction }) {
  return (
    <div className="tx-findings">
      <p className="muted small" style={{ margin: '8px 0' }}>Checked from typed details only — without a screenshot, image forensics and the Random Forest could not run. {describeTransaction(t.input)}.</p>
      <ul className="findings compact">
        {t.findings.map(f => (
          <li key={f.id} className={`finding sev-${f.passed ? 'ok' : f.severity}`}>
            <div>
              <div className="finding-head"><span className="finding-label">{f.label}</span><span className={`sev-chip sev-${f.passed ? 'ok' : f.severity}`}>{f.passed ? 'OK' : LEVEL[f.severity]}</span></div>
              <p className="finding-detail">{f.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

function EntryForm({ onDone }: { onDone: (id: string) => void }) {
  const imageScans = useAppStore(s => s.imageScans);
  const manual = useAppStore(s => s.manualTransactions);
  const add = useAppStore(s => s.addManualTransaction);
  const [institution, setInstitution] = useState<EvidenceSource>('GCash');
  const [type, setType] = useState<TransactionType>('Send Money');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [reference, setReference] = useState('');
  const [sender, setSender] = useState('');
  const [receiver, setReceiver] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ManualTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amt = amount.trim() ? Number(amount.replace(/[₱,\s]/g, '')) : null;
    if (amt != null && isNaN(amt)) { setError('Enter the amount as a number, e.g. 1500 or 1,500.00.'); return; }
    setError(null); setBusy(true);
    const input: TransactionInput = {
      institution, type, amount: amt, date: date || null, time: time || null, referenceNo: reference.trim() || null,
      senderName: sender.trim() || null, receiverName: receiver.trim() || null, receiverContact: contact.trim() || null,
    };
    const history: PriorScan[] = [
      ...imageScans.map(s => ({ id: s.id, filename: s.filename, scannedAt: s.scannedAt, extracted: s.extracted })),
      ...manual.map(t => ({ id: t.id, filename: 'typed details', scannedAt: t.scannedAt, extracted: toExtracted(t.input) })),
    ];
    const t = checkTransaction(input, history);
    add(t); setResult(t); setBusy(false); onDone(t.id);
  };

  return (
    <section className="card panel" aria-labelledby="tx-form-title">
      <h2 id="tx-form-title" className="section-title"><Plus size={18} /> Check a transaction from its details</h2>
      <p className="muted small" style={{ margin: 0 }}>For when the buyer only sent the details (“sent na po, ref …”). The reference, date and amount are checked, and compared with your earlier checks. A screenshot gives a fuller check.</p>
      <form className="form-grid tx-form" onSubmit={submit} noValidate>
        <label>Bank or e-wallet
          <select className="input-field" value={institution} onChange={e => setInstitution(e.target.value as EvidenceSource)}>
            {KNOWN_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            <option value="Unknown">Other / not sure</option>
          </select>
        </label>
        <label>Type
          <select className="input-field" value={type} onChange={e => setType(e.target.value as TransactionType)}>
            {TRANSACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Amount (₱)<input className="input-field" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="1,500.00" /></label>
        <label>Reference / confirmation no.<input className="input-field mono" value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. 1016642566968" spellCheck={false} /></label>
        <label>Date<input type="date" className="input-field" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Time (optional)<input type="time" className="input-field" value={time} onChange={e => setTime(e.target.value)} /></label>
        <label>Sender (optional)<input className="input-field" value={sender} onChange={e => setSender(e.target.value)} /></label>
        <label>Recipient name (optional)<input className="input-field" value={receiver} onChange={e => setReceiver(e.target.value)} /></label>
        <label>Recipient number / account (optional)<input className="input-field" value={contact} onChange={e => setContact(e.target.value)} /></label>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <ReceiptText size={15} />} Check details</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {result && (
        <div className={`tx-result sev-${sev(result.riskLevel)}`} role="status">
          <span className={`sev-chip sev-${sev(result.riskLevel)}`}>{LEVEL[result.riskLevel]} risk</span>
          <span className={`cls-chip ${classificationShown(result).cls}`}>{classificationShown(result).label}</span>
          <span>{result.findings.filter(f => !f.passed).length ? `Main reason: ${result.findings.filter(f => !f.passed).sort((a, b) => b.weight - a.weight)[0].label}.` : 'The details are consistent.'} Saved to the list below — mark it once you have checked your account.</span>
        </div>
      )}
    </section>
  );
}
