import { useState } from 'react';
import { BookOpen, ChevronDown, ShieldCheck, AlertTriangle } from 'lucide-react';
import { ENTRIES } from '../data/scamKnowledge';

export default function KnowledgeBasePage() {
  const [open, setOpen] = useState<string | null>('otp');

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--bg-accent-tint)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BookOpen size={19} color="var(--accent-light)" />
          </div>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: 'var(--text-primary)' }}>Scam Pattern Knowledge Base</h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
              A reference of the scam types FraudSentry checks against. This is educational material — not live statistics.
            </p>
          </div>
        </div>
      </div>

      <div className="privacy-notice" style={{ marginBottom: 18 }}>
        <ShieldCheck size={15} color="var(--accent-light)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>These descriptions explain the patterns the Message Analyzer looks for. When your scanned message matches one of these, you\u2019ll see it named in the result with the specific phrases highlighted.</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ENTRIES.map(e => {
          const Icon = e.icon;
          const isOpen = open === e.id;
          return (
            <div key={e.id} className="card card-hover" style={{ padding: 0, overflow: 'hidden' }}>
              <button onClick={() => setOpen(isOpen ? null : e.id)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '16px 18px',
                background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: `${e.color}1a`, border: `1px solid ${e.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={18} color={e.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>{e.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5 }}>{e.summary}</div>
                </div>
                <ChevronDown size={17} color="var(--text-muted)" style={{ flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }} />
              </button>

              {isOpen && (
                <div className="animate-fade-in" style={{ padding: '0 18px 18px', borderTop: '1px solid var(--border-default)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16, marginTop: 16 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                        <AlertTriangle size={13} color="var(--accent-amber)" />
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Red flags</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {e.redFlags.map((r, i) => (
                          <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: e.color, marginTop: 6, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                        <ShieldCheck size={13} color="var(--accent-emerald)" />
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>How to protect yourself</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {e.protect.map((r, i) => (
                          <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                            <ShieldCheck size={12} color="var(--accent-emerald)" style={{ marginTop: 2, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 14, padding: '11px 14px', background: 'var(--bg-subtle)', border: `1px solid ${e.color}33`, borderLeft: `3px solid ${e.color}`, borderRadius: 8 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Typical message</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.55 }}>{e.example}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
