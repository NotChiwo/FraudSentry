// Transaction Audit Dashboard: a live feed of every transaction and message
// checked on this device (real, from the on-device database) and, on request,
// simulated incoming transactions run through the same checks — with filters
// for flagged anomalies. Logic: auditFeed.ts and simulator.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Play, Pause, Trash2, RotateCcw, ChevronDown, ExternalLink, Radio } from 'lucide-react';
import { useAppStore } from '../shared/store';
import { formatDateTime, formatPHP } from '../shared/helpers';
import type { RiskLevel } from '../shared/types';
import { buildFeed, filterEvents, auditStats, DEFAULT_FILTER, type AuditEvent, type AuditFilter } from './auditFeed';
import { createSimulator, SCENARIO_LABEL, type Simulator } from './simulator';

// one simulator per app session, so the stream continues where it stopped
let simulator: Simulator | null = null;
const sim = () => (simulator ??= createSimulator(Date.now() % 1_000_003));

const LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
const LEVEL_LABEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const KIND_LABEL = { receipt: 'Receipt', transaction: 'Transaction', message: 'Message', cross: 'Cross-Evidence' } as const;
const SPEEDS: [number, string][] = [[1000, 'Every second'], [2000, 'Every 2 seconds'], [5000, 'Every 5 seconds']];
const PAGE = 150;
// a live feed needs seconds: "Nov 19, 05:01:37 AM"
const feedTime = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : `${d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
};

export default function AuditDashboardPage({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const imageScans = useAppStore(s => s.imageScans);
  const messageScans = useAppStore(s => s.messageScans);
  const crossChecks = useAppStore(s => s.crossChecks);
  const manualTransactions = useAppStore(s => s.manualTransactions);
  const simEvents = useAppStore(s => s.simEvents);
  const addSimEvent = useAppStore(s => s.addSimEvent);
  const clearSimEvents = useAppStore(s => s.clearSimEvents);
  const setFocusResultId = useAppStore(s => s.setFocusResultId);

  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(2000);
  const [f, setF] = useState<AuditFilter>(DEFAULT_FILTER);
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const mountedAt = useRef(new Date().toISOString());

  // the simulated stream runs only while this page is open
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => addSimEvent(sim().next()), speed);
    return () => clearInterval(t);
  }, [running, speed, addSimEvent]);

  const feed = useMemo(() => buildFeed({ imageScans, messageScans, crossChecks, manualTransactions }, simEvents),
    [imageScans, messageScans, crossChecks, manualTransactions, simEvents]);
  const shown = useMemo(() => filterEvents(feed, f), [feed, f]);
  const stats = useMemo(() => auditStats(shown), [shown]);
  const apps = useMemo(() => [...new Set(feed.map(e => e.app))].sort(), [feed]);
  const types = useMemo(() => [...new Set(feed.flatMap(e => e.fraudTypes))].sort(), [feed]);
  const maxType = Math.max(1, ...stats.byType.map(t => t.count));

  const set = <K extends keyof AuditFilter>(k: K, v: AuditFilter[K]) => { setF(p => ({ ...p, [k]: v })); setLimit(PAGE); };
  const toggleLevel = (l: RiskLevel) => set('levels', f.levels.includes(l) ? f.levels.filter(x => x !== l) : [...f.levels, l]);
  const filtered = JSON.stringify(f) !== JSON.stringify(DEFAULT_FILTER);
  const openReal = (e: AuditEvent) => { setFocusResultId(e.id); onNavigate?.(e.kind === 'transaction' ? 'transactions' : 'history'); };

  return (
    <div className="page audit-page">
      <div className="page-head">
        <div className="page-head-ico"><Activity size={22} /></div>
        <div>
          <h1>Transaction Audit Dashboard</h1>
          <p>A live feed of every transaction and message checked on this device, with simulated incoming transactions for testing, and filters for flagged anomalies.</p>
        </div>
      </div>

      <section className="card audit-controls" aria-label="Simulated stream">
        <div className="audit-live">
          <span className={`live-dot${running ? ' on' : ''}`} aria-hidden="true" />
          <strong>{running ? 'Live: simulating incoming transactions' : 'Simulation paused'}</strong>
          <span className="muted small">{simEvents.length} simulated · {feed.length - simEvents.length} real</span>
        </div>
        <div className="audit-buttons">
          <button type="button" className={running ? 'btn-secondary' : 'btn-primary'} onClick={() => setRunning(r => !r)}>
            {running ? <><Pause size={16} /> Pause</> : <><Play size={16} /> Simulate incoming transactions</>}
          </button>
          <label className="small muted">Speed{' '}
            <select className="input-field audit-select" value={speed} onChange={e => setSpeed(Number(e.target.value))}>
              {SPEEDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button type="button" className="btn-ghost" onClick={clearSimEvents} disabled={!simEvents.length}><Trash2 size={15} /> Clear simulated</button>
        </div>
        <p className="small muted audit-note">
          <Radio size={13} style={{ verticalAlign: '-2px' }} /> Simulated transactions are generated on this device across {19} banks and e-wallets and run through the same checks as a typed transaction (reference format, date, reuse of an earlier reference); about one in four carries an injected anomaly. They are labelled <span className="src-chip sim">Simulated</span>, kept only while the app is open, and never saved to the database or the history.
        </p>
      </section>

      <div className="audit-kpis">
        <div className="kpi"><span>Events</span><strong>{stats.total}</strong><em>{stats.real} real · {stats.simulated} simulated</em></div>
        <div className="kpi kpi-warn"><span>Flagged anomalies</span><strong>{stats.flagged}</strong><em>{stats.total ? `${(stats.flagRate * 100).toFixed(1)}% of events` : '—'}</em></div>
        <div className="kpi kpi-high"><span>Possibly fraudulent</span><strong>{stats.fraudulent}</strong><em>High or Critical risk</em></div>
        <div className="kpi kpi-crit"><span>Critical</span><strong>{stats.critical}</strong><em>Do not accept as proof</em></div>
        <div className="kpi"><span>Last flagged</span><strong className="kpi-time" aria-live="polite">{stats.lastFlaggedAt ? formatDateTime(stats.lastFlaggedAt) : '—'}</strong><em>&nbsp;</em></div>
      </div>

      <section className="card audit-filters" aria-label="Filters">
        <div className="chip-row" role="group" aria-label="Source">
          {(['all', 'real', 'simulated'] as const).map(v => (
            <button key={v} type="button" className={`filter-btn${f.source === v ? ' active' : ''}`} aria-pressed={f.source === v} onClick={() => set('source', v)}>
              {v === 'all' ? 'All sources' : v === 'real' ? 'Real checks' : 'Simulated'}
            </button>
          ))}
          <button type="button" className={`filter-btn flag-btn${f.flaggedOnly ? ' active' : ''}`} aria-pressed={f.flaggedOnly} onClick={() => set('flaggedOnly', !f.flaggedOnly)}>
            Flagged anomalies only
          </button>
        </div>
        <div className="chip-row" role="group" aria-label="Risk level">
          {LEVELS.map(l => (
            <button key={l} type="button" className={`filter-btn lvl-${l}${f.levels.includes(l) ? ' active' : ''}`} aria-pressed={f.levels.includes(l)} onClick={() => toggleLevel(l)}>{LEVEL_LABEL[l]}</button>
          ))}
        </div>
        <div className="audit-filter-grid">
          <label>Bank / e-wallet<select className="input-field" value={f.app} onChange={e => set('app', e.target.value)}><option value="">Any</option>{apps.map(a => <option key={a}>{a}</option>)}</select></label>
          <label>Fraud type<select className="input-field" value={f.fraudType} onChange={e => set('fraudType', e.target.value)}><option value="">Any</option>{types.map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Kind<select className="input-field" value={f.kind} onChange={e => set('kind', e.target.value as AuditFilter['kind'])}><option value="all">Any</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>From<input type="date" className="input-field" value={f.from} onChange={e => set('from', e.target.value)} /></label>
          <label>To<input type="date" className="input-field" value={f.to} onChange={e => set('to', e.target.value)} /></label>
          <label>Search<input className="input-field" value={f.q} onChange={e => set('q', e.target.value)} placeholder="Reference, name, app…" /></label>
        </div>
        {filtered && <button type="button" className="btn-ghost" onClick={() => { setF(DEFAULT_FILTER); setLimit(PAGE); }}><RotateCcw size={14} /> Reset filters</button>}
      </section>

      <div className="audit-grid">
        <section className="card audit-feed" aria-label="Transaction feed">
          <div className="feed-head"><h2>Feed</h2><span className="muted small" aria-live="polite">{shown.length} of {feed.length} events</span></div>
          {shown.length === 0 ? (
            <p className="muted" style={{ padding: 18 }}>{feed.length ? 'Nothing matches these filters.' : 'No transactions yet. Check a receipt or a message, type a transaction, or start the simulation.'}</p>
          ) : (
            <div className="feed-scroll">
              <table className="feed-table">
                <thead><tr><th>Time</th><th>Source</th><th>App</th><th className="num">Amount</th><th>Reference</th><th>Risk</th><th>Anomaly</th></tr></thead>
                <tbody>
                  {shown.slice(0, limit).map(e => (
                    <FeedRow key={e.id} e={e} isOpen={open === e.id} fresh={e.at > mountedAt.current && Date.now() - Date.parse(e.at) < 4000}
                      onToggle={() => setOpen(o => (o === e.id ? null : e.id))} onOpenReal={() => openReal(e)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shown.length > limit && <button type="button" className="btn-secondary" style={{ margin: 12 }} onClick={() => setLimit(l => l + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more</button>}
        </section>

        <aside className="audit-side">
          <section className="card pad">
            <h2 className="side-title">Flagged by fraud type</h2>
            {stats.byType.length ? (
              <ul className="bar-list">
                {stats.byType.map(t => (
                  <li key={t.type}>
                    <button type="button" className="bar-label link-btn" onClick={() => set('fraudType', f.fraudType === t.type ? '' : t.type)}>{t.type}</button>
                    <span className="bar"><span style={{ width: `${(t.count / maxType) * 100}%` }} /></span>
                    <span className="bar-n">{t.count}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">No flagged anomalies in this view.</p>}
          </section>
          <section className="card pad">
            <h2 className="side-title">By bank / e-wallet</h2>
            {stats.byApp.length ? (
              <table className="app-table"><thead><tr><th>App</th><th className="num">Checks</th><th className="num">Flagged</th></tr></thead>
                <tbody>{stats.byApp.map(a => (
                  <tr key={a.app} className={f.app === a.app ? 'sel' : ''} onClick={() => set('app', f.app === a.app ? '' : a.app)}>
                    <td>{a.app}</td><td className="num">{a.total}</td><td className="num">{a.flagged} <span className="muted">({Math.round((a.flagged / a.total) * 100)}%)</span></td>
                  </tr>))}
                </tbody>
              </table>
            ) : <p className="muted small">No payments in this view.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

function FeedRow({ e, isOpen, fresh, onToggle, onOpenReal }: { e: AuditEvent; isOpen: boolean; fresh: boolean; onToggle: () => void; onOpenReal: () => void }) {
  return (
    <>
      <tr className={`feed-row lvl-${e.riskLevel}${e.flagged ? ' flagged' : ''}${fresh ? ' fresh' : ''}`} onClick={onToggle} aria-expanded={isOpen}>
        <td className="t-time">{feedTime(e.at)}</td>
        <td><span className={`src-chip ${e.simulated ? 'sim' : 'real'}`}>{e.simulated ? 'Simulated' : 'Real'}</span> <span className="muted small">{KIND_LABEL[e.kind]}</span></td>
        <td>{e.app}</td>
        <td className="num">{e.amount != null ? formatPHP(e.amount) : '—'}</td>
        <td className="mono t-ref">{e.reference ?? '—'}</td>
        <td><span className={`sev-chip sev-${e.riskLevel === 'low' ? 'ok' : e.riskLevel}`}>{LEVEL_LABEL[e.riskLevel]}</span></td>
        <td className="t-anom">{e.flagged ? (e.fraudTypes[0] ?? e.mainReason ?? 'Check the details') : <span className="muted">—</span>} <ChevronDown size={14} className="chev" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} /></td>
      </tr>
      {isOpen && (
        <tr className="feed-detail"><td colSpan={7}>
          <div className="detail-inner">
            {e.simulated && e.scenario && <p className="small"><strong>Simulated scenario:</strong> {SCENARIO_LABEL[e.scenario]}</p>}
            {e.recipient && <p className="small"><strong>Recipient:</strong> {e.recipient}</p>}
            {e.fraudTypes.length > 0 && <p className="small"><strong>Fraud types:</strong> {e.fraudTypes.join(', ')}</p>}
            {e.reasons.length ? (
              <><p className="small"><strong>{e.kind === 'message' ? 'Warning signs' : e.kind === 'cross' ? 'Why' : 'Checks that did not pass'}:</strong></p>
                <ul className="small">{e.reasons.slice(0, 6).map((r, i) => <li key={i}>{r}</li>)}</ul></>
            ) : <p className="small muted">Every check passed.</p>}
            {!e.simulated && <button type="button" className="btn-ghost" onClick={ev => { ev.stopPropagation(); onOpenReal(); }}><ExternalLink size={14} /> Open the full check</button>}
          </div>
        </td></tr>
      )}
    </>
  );
}
