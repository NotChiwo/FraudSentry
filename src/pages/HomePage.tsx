import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ScanLine, MessageSquareWarning, GitCompareArrows, ShieldCheck, ShieldAlert, ArrowRight, Lock, Eye, Cpu, Trees,
  Flame, CalendarDays, Lightbulb, Award, Smartphone, History,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { formatRelativeTime } from '../utils/helpers';
import { useCountUp } from '../utils/useCountUp';
import { computeActivity, MILESTONES } from '../services/activity';
import { ENTRIES } from '../data/scamKnowledge';
import { RiskLevel } from '../types';

const LEVEL_LABEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

export default function HomePage({ onNavigate }: { onNavigate: (p: string) => void }) {
  const imageScans = useAppStore(s => s.imageScans);
  const messageScans = useAppStore(s => s.messageScans);

  const events = useMemo(() => [
    ...imageScans.map(s => ({ id: s.id, kind: 'receipt' as const, level: s.riskLevel, when: s.scannedAt, title: s.source !== 'Unknown' ? `${s.source} receipt` : 'Receipt' })),
    ...messageScans.map(s => ({ id: s.id, kind: 'message' as const, level: s.threatLevel, when: s.scannedAt, title: s.scamType })),
  ], [imageScans, messageScans]);
  const act = useMemo(() => computeActivity(events, new Date()), [events]);
  const recent = useMemo(() => [...events].sort((a, b) => b.when.localeCompare(a.when)).slice(0, 5), [events]);
  // Same tip all day, a different one tomorrow — chosen by date, no randomness.
  const tip = ENTRIES[Math.floor(Date.now() / 86_400_000) % ENTRIES.length];

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      {/* Hero */}
      <section className="home-hero">
        <div className="hh-text">
          <span className="hh-eyebrow"><Lock size={14} aria-hidden="true" /> No account · nothing uploaded</span>
          <h1 className="hh-title">Got a payment screenshot?<br /><span className="grad">Check it before you hand anything over.</span></h1>
          <p className="hh-sub">FraudSentry reads the receipt, looks for signs of editing, and tells you in plain words what it found — and what to do next.</p>
          <div className="hh-cta">
            <button type="button" className="btn-primary btn-lg" onClick={() => onNavigate('scanner')}><ScanLine size={19} /> Check a receipt</button>
            <button type="button" className="btn-secondary btn-lg" onClick={() => onNavigate('analyzer')}><MessageSquareWarning size={18} /> Check a message</button>
          </div>
        </div>
        <div className="hh-art" aria-hidden="true">
          <div className="mock-phone">
            <div className="mp-notch" />
            <div className="mp-head" />
            <div className="mp-amount"><span /></div>
            <div className="mp-row"><span className="hl hl-a" /></div>
            <div className="mp-row short" />
            <div className="mp-row"><span className="hl hl-r" /></div>
            <div className="mp-row short" />
            <div className="mp-beam" />
          </div>
          <div className="mp-badge"><ShieldCheck size={16} /> Checked on-device</div>
        </div>
      </section>

      {/* Activity — every number is computed from this device's own history */}
      <section aria-labelledby="act-h" className="home-section">
        <div className="row-between">
          <h2 id="act-h" className="section-title"><CalendarDays size={18} /> Your activity <span className="muted small" style={{ fontWeight: 500 }}>· from checks on this device</span></h2>
          {act.total > 0 && <button type="button" className="btn-ghost" onClick={() => onNavigate('reports')}><History size={15} /> History</button>}
        </div>
        {act.total === 0 ? (
          <div className="card empty-state">
            <span className="empty-ico"><Smartphone size={28} /></span>
            <h2>Nothing checked yet</h2>
            <p>Your numbers start at zero and grow only from checks you actually run here. Nothing is estimated or made up.</p>
            <button type="button" className="btn-primary" onClick={() => onNavigate('scanner')}><ScanLine size={17} /> Run your first check</button>
          </div>
        ) : (
          <>
            <div className="stat-grid">
              <Stat icon={Eye} label="Total checks" value={act.total} sub={`${act.receipts} receipt${act.receipts === 1 ? '' : 's'} · ${act.messages} message${act.messages === 1 ? '' : 's'}`} />
              <Stat icon={CalendarDays} label="Last 7 days" value={act.last7} sub="checks this week" />
              <Stat icon={ShieldAlert} label="Risky results" value={act.risky} sub="high or critical" tone="risk" />
              <Stat icon={Flame} label="Day streak" value={act.streak} sub={act.streak === 1 ? 'day in a row' : 'days in a row'} tone="streak" />
            </div>
            <div className="badges" aria-label="Milestones">
              {MILESTONES.map(m => {
                const got = m.earned(act);
                return (
                  <span key={m.id} className={`badge-pill${got ? ' got' : ''}`} title={m.hint}>
                    <Award size={15} aria-hidden="true" /> {m.label}<span className="sr-only">{got ? ' (earned)' : ' (not yet)'}</span>
                  </span>
                );
              })}
            </div>
          </>
        )}
      </section>

      <div className="home-split">
        {/* Recent */}
        {recent.length > 0 && (
          <section className="card pad" aria-labelledby="recent-h">
            <h2 id="recent-h" className="section-title"><History size={18} /> Recent checks</h2>
            <ul className="recent-list">
              {recent.map(r => (
                <li key={r.id} className={`sev-${r.level === 'low' ? 'ok' : r.level}`}>
                  <span className="rl-ico" aria-hidden="true">{r.kind === 'receipt' ? <ScanLine size={16} /> : <MessageSquareWarning size={16} />}</span>
                  <span className="rl-title">{r.title}</span>
                  <span className={`sev-chip sev-${r.level === 'low' ? 'ok' : r.level}`}>{LEVEL_LABEL[r.level]}</span>
                  <time className="rl-when" dateTime={r.when}>{formatRelativeTime(r.when)}</time>
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* Tip of the day */}
        <section className="card pad tip-card" aria-labelledby="tip-h">
          <h2 id="tip-h" className="section-title"><Lightbulb size={18} /> Scam to know today</h2>
          <div className="tip-name"><tip.icon size={18} color={tip.color} aria-hidden="true" /> {tip.name}</div>
          <p className="tip-sum">{tip.summary}</p>
          <ul className="tip-flags">{tip.redFlags.slice(0, 3).map(f => <li key={f}>{f}</li>)}</ul>
          <button type="button" className="btn-ghost" onClick={() => onNavigate('knowledge')}>More scams to know <ArrowRight size={15} /></button>
        </section>
      </div>

      {/* Tools */}
      <section className="home-section" aria-labelledby="tools-h">
        <h2 id="tools-h" className="section-title"><ShieldCheck size={18} /> Tools</h2>
        <div className="tool-grid">
          <Tool icon={ScanLine} title="Check Receipt" desc="Is this payment screenshot real? Read it, check it, get next steps." onClick={() => onNavigate('scanner')} tone="violet" />
          <Tool icon={MessageSquareWarning} title="Check Message" desc="Paste a text or upload a chat screenshot to spot scam wording and links." onClick={() => onNavigate('analyzer')} tone="amber" />
          <Tool icon={GitCompareArrows} title="Cross-Evidence" desc="Research tool: does this receipt really belong to this conversation?" onClick={() => onNavigate('cross')} tone="blue" research />
          <Tool icon={Trees} title="Detection Model" desc="Research tool: train the Random Forest and see its metrics." onClick={() => onNavigate('model')} tone="green" research />
        </div>
      </section>

      {/* How it decides */}
      <section className="card pad" aria-labelledby="how-h">
        <h2 id="how-h" className="section-title"><Cpu size={18} /> How FraudSentry decides</h2>
        <ol className="how-steps">
          <li><b>Read the evidence.</b> OCR reads the text three times; image checks look at compression and editing traces.</li>
          <li><b>Check each signal.</b> Every rule has a name and a weight, so you can see exactly why.</li>
          <li><b>Two scorers, one result.</b> Rule-based findings (50%) and a Random Forest vote on the same evidence (50%).</li>
          <li><b>You confirm.</b> Only your own bank or e-wallet app can prove the money arrived.</li>
        </ol>
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, tone }: { icon: LucideIcon; label: string; value: number; sub: string; tone?: 'risk' | 'streak' }) {
  const shown = useCountUp(value);
  return (
    <div className={`stat pop-in${tone ? ` stat-${tone}` : ''}`}>
      <div className="stat-top"><span className="stat-l">{label}</span><Icon size={18} aria-hidden="true" /></div>
      <div className="stat-v mono" aria-label={String(value)}>{shown}</div>
      <div className="stat-s">{sub}</div>
    </div>
  );
}

function Tool({ icon: Icon, title, desc, onClick, tone, research }: { icon: LucideIcon; title: string; desc: string; onClick: () => void; tone: string; research?: boolean }) {
  return (
    <button type="button" className={`tool tool-${tone}`} onClick={onClick}>
      <span className="tool-ico" aria-hidden="true"><Icon size={22} /></span>
      <span className="tool-body">
        <span className="tool-title">{title}{research && <span className="tool-tag">Research</span>}</span>
        <span className="tool-desc">{desc}</span>
      </span>
      <ArrowRight size={18} className="tool-arrow" aria-hidden="true" />
    </button>
  );
}
