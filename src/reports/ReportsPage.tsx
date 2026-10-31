// Fraud detection reports (thesis Module 5): generate a summary or detailed
// report for a period, view it, download it as PDF or CSV, and reopen saved
// reports later.
import { useState } from 'react';
import { FileBarChart, Play, Loader2, Download, Trash2, FileText, X } from 'lucide-react';
import { useAppStore, type UserData } from '../shared/store';
import { buildReport, reportToCsv, type FraudReport, type ReportType } from './fraudReports';
import { generateFraudReportPdf } from './pdfReports';
import { formatDateTime, formatPHP, downloadBlob } from '../shared/helpers';

type Preset = 'today' | '7' | '30' | 'month' | 'custom';
const phDate = (d = new Date()) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
function presetRange(p: Preset): [string, string] {
  const today = phDate();
  if (p === 'today') return [today, today];
  if (p === 'month') return [`${today.slice(0, 8)}01`, today];
  const days = p === '7' ? 6 : 29;
  return [phDate(new Date(Date.now() - days * 864e5)), today];
}
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

export default function ReportsPage() {
  const reports = useAppStore(s => s.reports);
  const addReport = useAppStore(s => s.addReport);
  const removeReport = useAppStore(s => s.removeReport);
  const [type, setType] = useState<ReportType>('summary');
  const [preset, setPreset] = useState<Preset>('30');
  const [[from, to], setRange] = useState<[string, string]>(() => presetRange('30'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<FraudReport | null>(null);

  const pickPreset = (p: Preset) => { setPreset(p); if (p !== 'custom') setRange(presetRange(p)); };

  const generate = async () => {
    if (from > to) { setError('The start date is after the end date.'); return; }
    setBusy(true); setError(null);
    try {
      const mine = useAppStore.getState() as UserData;
      const r = buildReport(mine, { type, from, to });
      addReport(r); setViewing(r);
    } catch (e) {
      console.error(e); setError('The report could not be generated.');
    } finally { setBusy(false); }
  };

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <div className="page-head">
        <div className="page-head-ico"><FileBarChart size={22} /></div>
        <div>
          <h1>Reports</h1>
          <p>Fraud detection reports for a period: what was checked, how it was classified, and how often that matched what really happened to the payment. Saved reports stay on this device for 30 days.</p>
        </div>
      </div>

      <section className="card panel" aria-labelledby="gen-title">
        <h2 id="gen-title" className="section-title"><Play size={18} /> Generate a report</h2>
        <div className="report-form">
          <fieldset className="report-fs">
            <legend>Type</legend>
            <div className="chip-row" role="radiogroup" aria-label="Report type">
              {(['summary', 'detailed'] as ReportType[]).map(t => (
                <button key={t} type="button" role="radio" aria-checked={type === t} className={`filter-btn${type === t ? ' active' : ''}`} onClick={() => setType(t)}>
                  {t === 'summary' ? 'Summary' : 'Detailed (every check)'}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="report-fs">
            <legend>Period</legend>
            <div className="chip-row" role="radiogroup" aria-label="Report period">
              {([['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['custom', 'Custom']] as [Preset, string][]).map(([p, l]) => (
                <button key={p} type="button" role="radio" aria-checked={preset === p} className={`filter-btn${preset === p ? ' active' : ''}`} onClick={() => pickPreset(p)}>{l}</button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="report-dates">
                <label className="tx-date">From<input type="date" className="input-field" value={from} onChange={e => setRange([e.target.value, to])} /></label>
                <label className="tx-date">To<input type="date" className="input-field" value={to} onChange={e => setRange([from, e.target.value])} /></label>
              </div>
            )}
          </fieldset>
        </div>
        <div className="chip-row">
          <button type="button" className="btn-primary" onClick={() => void generate()} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <FileBarChart size={15} />} Generate report</button>
          <span className="muted small">{from} to {to}</span>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>

      {viewing && <ReportView r={viewing} onClose={() => setViewing(null)} onDelete={() => { removeReport(viewing.id); setViewing(null); }} />}

      <section className="card panel" aria-labelledby="saved-title">
        <h2 id="saved-title" className="section-title"><FileText size={18} /> Saved reports ({reports.length})</h2>
        {reports.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Reports you generate are kept here so you can reopen or download them later.</p> : (
          <ul className="item-list">
            {reports.map(r => (
              <li key={r.id} className="item-row">
                <div className="item-main">
                  <b>{r.title}</b>
                  <span className={`tag-chip${r.reportType === 'detailed' ? ' accent' : ''}`}>{r.reportType}</span>
                  <div className="muted small">Generated {formatDateTime(r.generatedAt)} · {r.stats.checks} checks · {r.stats.fraudulent} possibly fraudulent</div>
                </div>
                <div className="item-actions">
                  <button type="button" className="btn-ghost" onClick={() => setViewing(r)}>Open</button>
                  <button type="button" className="btn-ghost" onClick={() => generateFraudReportPdf(r)}><Download size={14} /> PDF</button>
                  <button type="button" className="btn-ghost danger" aria-label={`Delete ${r.title}`} onClick={() => { removeReport(r.id); if (viewing?.id === r.id) setViewing(null); }}><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReportView({ r, onClose, onDelete }: { r: FraudReport; onClose: () => void; onDelete: () => void }) {
  const s = r.stats, a = s.agreement;
  return (
    <section className="card panel report-view" aria-labelledby="report-title">
      <div className="row-between">
        <h2 id="report-title" className="section-title" style={{ margin: 0 }}><FileBarChart size={18} /> {r.title}</h2>
        <div className="chip-row">
          <button type="button" className="btn-primary" onClick={() => generateFraudReportPdf(r)}><Download size={15} /> PDF</button>
          <button type="button" className="btn-secondary" onClick={() => downloadBlob(reportToCsv(r), `fraudsentry-${r.reportType}-report-${r.periodFrom}-${r.periodTo}.csv`, 'text/csv')}><Download size={15} /> CSV</button>
          <button type="button" className="btn-ghost danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>
          <button type="button" className="icon-btn" aria-label="Close report" onClick={onClose}><X size={18} /></button>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Generated {formatDateTime(r.generatedAt)} · {r.periodFrom} to {r.periodTo}</p>
      <p className="report-desc">{r.description}</p>

      <div className="stat-grid">
        <div className="card stat-tile"><span className="stat-label">Checks</span><span className="stat-value">{s.checks}</span><span className="muted small">{s.byKind.Receipt} receipts · {s.byKind['Typed details']} typed · {s.byKind.Message} messages</span></div>
        <div className="card stat-tile"><span className="stat-label">Possibly fraudulent</span><span className="stat-value">{s.fraudulent}</span><span className="muted small">{s.amountFlagged ? `${formatPHP(s.amountFlagged)} claimed` : `${s.legitimate} legitimate`}</span></div>
        <div className="card stat-tile"><span className="stat-label">Matched real outcome</span><span className="stat-value">{pct(a.accuracy)}</span><span className="muted small">of {a.confirmed} confirmed payment{a.confirmed === 1 ? '' : 's'}</span></div>
        <div className="card stat-tile"><span className="stat-label">Alerts</span><span className="stat-value">{s.alerts.total}</span><span className="muted small">{s.alerts.unread} unread</span></div>
      </div>

      <div className="report-grid">
        <div>
          <h3 className="how-h">Classification vs what really happened</h3>
          <table className="data-table">
            <thead><tr><th /><th>Not received (fake)</th><th>Received (genuine)</th></tr></thead>
            <tbody>
              <tr><th scope="row">Possibly fraudulent</th><td><b>{a.tp}</b> caught</td><td><b>{a.fp}</b> false alarm{a.fp === 1 ? '' : 's'}</td></tr>
              <tr><th scope="row">Legitimate</th><td><b>{a.fn}</b> missed</td><td><b>{a.tn}</b> correct</td></tr>
            </tbody>
          </table>
          <p className="muted small">Precision {pct(a.precision)} · recall {pct(a.recall)} · {s.outcomes.pending} payment{s.outcomes.pending === 1 ? '' : 's'} not confirmed yet. These come from outcomes users marked after checking their own accounts.</p>
        </div>
        <div>
          <h3 className="how-h">Risk levels</h3>
          <BarList items={(['critical', 'high', 'medium', 'low'] as const).map(l => ({ label: l[0].toUpperCase() + l.slice(1), value: s.byRisk[l], cls: l === 'low' ? 'ok' : l }))} />
        </div>
      </div>

      <div className="report-grid">
        {s.byApp.length > 0 && <Breakdown title="By bank / e-wallet" head={['App or bank', 'Checks', 'Flagged', 'Not received']} rows={s.byApp.map(x => [x.app, x.checks, x.fraudulent, x.notReceived])} />}
        {s.byType.length > 0 && <Breakdown title="By transaction type" head={['Type', 'Checks', 'Flagged']} rows={s.byType.map(x => [x.type, x.checks, x.fraudulent])} />}
        {s.topReasons.length > 0 && <Breakdown title="Most common warning signs" head={['Check that failed', 'Times']} rows={s.topReasons.map(x => [x.label, x.count])} />}
        {s.models.length > 0 && <Breakdown title="Models that scored the receipts" head={['Model', 'Receipts']} rows={s.models.map(x => [x.name, x.checks])} />}
      </div>

      {r.rows && (
        <>
          <h3 className="how-h">Every check ({r.rows.length})</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>When</th><th>Kind</th><th>App</th><th>Type</th><th>Amount</th><th>Reference</th><th>Risk</th><th>Classification</th><th>Outcome</th></tr></thead>
              <tbody>
                {r.rows.map((x, i) => (
                  <tr key={i}>
                    <td>{formatDateTime(x.when)}</td><td>{x.kind}</td><td>{x.app}</td><td>{x.type}{x.direction ? ` · ${x.direction}` : ''}</td><td>{x.amount != null ? formatPHP(x.amount) : '—'}</td>
                    <td className="mono">{x.reference ?? '—'}</td><td><span className={`sev-chip sev-${x.riskLevel === 'low' ? 'ok' : x.riskLevel}`}>{x.riskLevel}</span></td>
                    <td>{x.classification === 'fraudulent' ? 'Possibly fraudulent' : 'Legitimate'}</td>
                    <td>{x.outcome === 'received' ? 'Received' : x.outcome === 'not-received' ? 'Not received' : x.outcome === 'pending' ? 'Not confirmed' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Breakdown({ title, head, rows }: { title: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div>
      <h3 className="how-h">{title}</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function BarList({ items }: { items: { label: string; value: number; cls: string }[] }) {
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <ul className="bar-list">
      {items.map(i => (
        <li key={i.label} className={`sev-${i.cls}`}>
          <span className="bar-label">{i.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(i.value / max) * 100}%` }} /></span>
          <span className="bar-value mono">{i.value}</span>
        </li>
      ))}
    </ul>
  );
}
