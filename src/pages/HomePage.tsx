import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ScanLine, MessageSquareWarning, GitCompareArrows, ShieldCheck, ShieldAlert,
  Activity, FileSearch, ArrowRight, Inbox, TrendingUp, Lock, Eye, Cpu, Trees, Sparkles,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { RISK_META, formatRelativeTime } from '../utils/helpers';
import { useCountUp } from '../utils/useCountUp';
import { RiskLevel } from '../types';

export default function HomePage({ onNavigate }: { onNavigate: (p: string) => void }) {
  const imageScans = useAppStore(s => s.imageScans);
  const messageScans = useAppStore(s => s.messageScans);
  const crossChecks = useAppStore(s => s.crossChecks);

  const stats = useMemo(() => {
    const all: { level: RiskLevel }[] = [
      ...imageScans.map(s => ({ level: s.riskLevel })),
      ...messageScans.map(s => ({ level: s.threatLevel })),
    ];
    const highRisk = all.filter(a => a.level === 'high' || a.level === 'critical').length;
    const clean = all.filter(a => a.level === 'low').length;
    const ocrVals = imageScans.filter(s => s.ocr.available).map(s => s.ocr.confidence);
    const avgOcr = ocrVals.length ? Math.round(ocrVals.reduce((a, b) => a + b, 0) / ocrVals.length) : 0;
    return {
      total: imageScans.length + messageScans.length,
      images: imageScans.length,
      messages: messageScans.length,
      crosses: crossChecks.length,
      highRisk, clean, avgOcr,
    };
  }, [imageScans, messageScans, crossChecks]);

  const recent = useMemo(() => {
    type Row = { id: string; kind: string; title: string; level: RiskLevel; when: string };
    const rows: Row[] = [
      ...imageScans.map(s => ({ id: s.id, kind: 'Transaction', title: s.legitimacyLabel, level: s.riskLevel, when: s.scannedAt })),
      ...messageScans.map(s => ({ id: s.id, kind: 'Message', title: s.scamType, level: s.threatLevel, when: s.scannedAt })),
    ];
    return rows.sort((a, b) => +new Date(b.when) - +new Date(a.when)).slice(0, 6);
  }, [imageScans, messageScans]);

  const hasData = stats.total > 0;

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      {/* Hero */}
      <section className="card flow-border reveal" style={{ padding: 0, marginBottom: 22, position: 'relative', overflow: 'hidden' }}>
        <div className="hero-aurora" />
        <div className="hero-scanline" />
        <div className="hero-inner" style={{ position: 'relative', zIndex: 2, display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 420px', minWidth: 0 }}>
            <span className="badge badge-accent reveal d1" style={{ marginBottom: 14 }}><Lock size={10} /> No account · processed entirely in your browser</span>
            <h1 className="reveal d2" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 10px', color: 'var(--text-primary)', lineHeight: 1.15 }}>
              Verify payment proof and catch scam messages with <span className="gradient-text">evidence you can see</span>
            </h1>
            <p className="reveal d3" style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 560, lineHeight: 1.6, margin: '0 0 22px' }}>
              FraudSentry reads your screenshots with real OCR, inspects images for signs of editing, cross-checks receipts against the conversation behind them, and explains every risk score — instead of just guessing whether something is “fraud.”
            </p>
            <div className="reveal d4" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={() => onNavigate('scanner')}><ScanLine size={16} /> Check a transaction</button>
              <button className="btn-secondary" onClick={() => onNavigate('analyzer')}><MessageSquareWarning size={15} /> Analyze a message</button>
            </div>
          </div>
          <div className="reveal d3 hero-orb" style={{ flex: '0 0 auto', display: 'grid', placeItems: 'center', minWidth: 150 }} aria-hidden="true">
            <div className="shield-orb float-slow" style={{ width: 116, height: 116, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, rgba(96,165,250,0.30), rgba(37,99,235,0.10) 60%, transparent)', border: '1px solid var(--border-accent)' }}>
              <ShieldCheck size={52} color="var(--accent-light)" strokeWidth={1.6} />
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <div className="reveal d2" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
        {[
          { icon: Cpu, t: 'On-device analysis' },
          { icon: Lock, t: 'No data leaves your browser' },
          { icon: ShieldCheck, t: 'RA 10173 compliant' },
          { icon: Eye, t: 'Every score explained' },
        ].map(c => (
          <div key={c.t} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 99 }}>
            <c.icon size={13} color="var(--accent-light)" />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 550 }}>{c.t}</span>
          </div>
        ))}
      </div>

      {/* Tools */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(232px,1fr))', gap: 14, marginBottom: 26 }}>
        <ToolCard d="d1" icon={ScanLine} color="#2563eb" title="Transaction Check" desc="Upload a receipt to verify authenticity and read every field." onClick={() => onNavigate('scanner')} />
        <ToolCard d="d2" icon={MessageSquareWarning} color="#f59e0b" title="Message Analyzer" desc="Detect phishing and scam scripts in any pasted text." onClick={() => onNavigate('analyzer')} />
        <ToolCard d="d3" icon={GitCompareArrows} color="#6366f1" title="Cross-Evidence" desc="Pair a payment with its conversation and catch contradictions." onClick={() => onNavigate('cross')} />
        <ToolCard d="d4" icon={Trees} color="#10b981" title="Detection Model" desc="Train the Random Forest live and see its real metrics." onClick={() => onNavigate('model')} />
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 14px' }}>
        <Activity size={15} color="var(--accent-light)" />
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Your activity</h2>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· computed only from your real scans</span>
      </div>

      {hasData ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14, marginBottom: 22 }}>
          <Kpi accent="blue" icon={FileSearch} label="Total scans" value={stats.total} sub={`${stats.images} image · ${stats.messages} message`} />
          <Kpi accent="red" icon={ShieldAlert} label="High-risk found" value={stats.highRisk} sub="critical + high results" />
          <Kpi accent="emerald" icon={ShieldCheck} label="Low-risk" value={stats.clean} sub="passed checks" />
          <Kpi accent="indigo" icon={Cpu} label="Avg OCR confidence" value={stats.avgOcr} suffix="%" sub="across image scans" />
        </div>
      ) : (
        <EmptyState onNavigate={onNavigate} />
      )}

      {/* Recent activity */}
      {hasData && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 22 }}>
          <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={15} color="var(--accent-light)" />
              <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Recent scans</h3>
            </div>
            <button className="btn-ghost" onClick={() => onNavigate('reports')}>View all <ArrowRight size={12} /></button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Type</th><th>Result</th><th>Risk</th><th style={{ textAlign: 'right' }}>When</th></tr></thead>
              <tbody>
                {recent.map(r => {
                  const meta = RISK_META[r.level];
                  return (
                    <tr key={r.id}>
                      <td><span className="badge badge-neutral">{r.kind}</span></td>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{r.title}</td>
                      <td><span className={`badge badge-${r.level}`} style={{ color: meta.hex }}>{meta.label}</span></td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>{formatRelativeTime(r.when)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Sparkles size={15} color="var(--accent-light)" />
          <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>How FraudSentry decides</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, flexWrap: 'wrap' }}>
          {[
            { n: '01', t: 'Read the evidence', d: 'OCR extracts the text; forensic checks measure compression and error levels.' },
            { n: '02', t: 'Weigh each signal', d: 'Every rule-based finding has a named weight — nothing is a black box.' },
            { n: '03', t: 'Two scorers, one score', d: 'The risk % blends those weighted findings (50%) with a Random Forest vote on the same evidence (50%). Both are shown to you.' },
            { n: '04', t: 'You decide', d: 'Results support your judgment; always verify through official channels.' },
          ].map((s, i, arr) => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'flex-start', flex: '1 1 200px', minWidth: 180 }}>
              <div className="reveal" style={{ flex: 1, animationDelay: `${0.08 * i}s` }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--bg-accent-tint)', border: '1px solid var(--border-accent)', display: 'grid', placeItems: 'center', marginBottom: 10 }}>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--accent-light)', fontWeight: 800 }}>{s.n}</span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{s.t}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, paddingRight: 16 }}>{s.d}</div>
              </div>
              {i < arr.length - 1 && <div className="step-connector" style={{ marginTop: 16, minWidth: 24 }} aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolCard({ icon: Icon, color, title, desc, onClick, d }: {
  icon: LucideIcon; color: string; title: string; desc: string; onClick: () => void; d: string;
}) {
  return (
    <button onClick={onClick} className={`card tool-card reveal ${d}`} style={{ padding: 18, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
      <div className="tool-ico" style={{ width: 42, height: 42, borderRadius: 12, background: `${color}1a`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={20} color={color} />
      </div>
      <div style={{ width: '100%' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {title} <ArrowRight className="tool-arrow" size={15} color={color} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>{desc}</div>
      </div>
    </button>
  );
}

function Kpi({ accent, icon: Icon, label, value, sub, suffix }: {
  accent: string; icon: LucideIcon; label: string; value: number; sub: string; suffix?: string;
}) {
  const shown = useCountUp(value);
  return (
    <div className={`kpi-card accent-${accent} pop-in`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</span>
        <Icon size={16} color="var(--text-muted)" />
      </div>
      <div className="mono" style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }} aria-label={`${value}${suffix || ''}`}>{shown}{suffix || ''}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function EmptyState({ onNavigate }: { onNavigate: (p: string) => void }) {
  return (
    <div className="card reveal d2" style={{ padding: '44px 24px', textAlign: 'center', marginBottom: 22 }}>
      <div className="float-slow" style={{ width: 56, height: 56, margin: '0 auto 16px', borderRadius: 15, background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Inbox size={26} color="var(--text-muted)" />
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>No analyses have been performed yet</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 400, margin: '0 auto 18px', lineHeight: 1.55 }}>
        Your activity stays empty until you run a real scan. Every number here will be computed from your own results — nothing is simulated.
      </div>
      <button className="btn-primary" onClick={() => onNavigate('scanner')}><ScanLine size={15} /> Run your first check</button>
    </div>
  );
}
