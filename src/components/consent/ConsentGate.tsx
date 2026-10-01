import { useState } from 'react';
import { ShieldCheck, Lock, Eye, Database, AlertTriangle, ArrowRight, ScanText, UserX } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

const POINTS = [
  {
    icon: Database, color: '#2563eb',
    title: 'What we process',
    body: 'Images and text you submit are processed temporarily, inside your own browser, solely to generate a fraud risk assessment. They are not uploaded to any server.',
  },
  {
    icon: ScanText, color: '#3b82f6',
    title: 'OCR text extraction',
    body: 'Screenshots are read using on-device OCR to pull out text such as names, amounts, and reference numbers. This extracted text is shown back to you and used only for the analysis.',
  },
  {
    icon: Lock, color: '#10b981',
    title: 'Temporary file handling',
    body: 'Uploaded files live only in memory for the duration of your scan. A short local history is kept in this browser (so you can re-open past results) and you can clear it anytime.',
  },
  {
    icon: UserX, color: '#6366f1',
    title: 'No account, no tracking',
    body: 'FraudSentry requires no registration or login. We do not build user profiles, run advertising, or resell any data you provide.',
  },
  {
    icon: AlertTriangle, color: '#f59e0b',
    title: 'AI limitations disclaimer',
    body: 'Results are evidence-based risk indicators to support your own judgment — not official, legal, or bank-certified rulings. No automated system is 100% accurate; always verify through official channels.',
  },
  {
    icon: ShieldCheck, color: '#10b981',
    title: 'Your responsibilities',
    body: 'Only upload content you have the right to submit. Avoid sharing other people\u2019s sensitive data unnecessarily. You remain responsible for any decisions made using these results.',
  },
];

export default function ConsentGate() {
  const [checked, setChecked] = useState(false);
  const giveConsent = useAppStore(s => s.giveConsent);

  return (
    <div className="mesh-bg" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
      <div style={{ width: '100%', maxWidth: 660 }}>
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 26 }} className="animate-fade-up">
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 32px rgba(37,99,235,0.45)', marginBottom: 16
          }}>
            <ShieldCheck size={28} color="#ffffff" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: 'var(--text-primary)' }}>
            Welcome to <span className="gradient-text">FraudSentry</span>
          </h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 8, textAlign: 'center', maxWidth: 460, lineHeight: 1.6 }}>
            Before you continue, please review how your data is handled. This notice is provided in compliance with the
            Philippine Data Privacy Act of 2012 (RA 10173).
          </p>
        </div>

        <div className="card animate-fade-up" style={{ padding: 26, animationDelay: '0.05s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
            <Eye size={15} color="var(--accent-light)" />
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Data Privacy Notice &amp; User Consent
            </h2>
          </div>

          <div style={{ display: 'grid', gap: 13 }}>
            {POINTS.map((p, i) => {
              const Icon = p.icon;
              return (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: `${p.color}1a`, border: `1px solid ${p.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={15} color={p.color} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)', marginBottom: 2 }}>{p.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{p.body}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="privacy-notice" style={{ marginTop: 20 }}>
            <Lock size={14} color="var(--accent-light)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Under RA 10173, you have the right to be informed, to object, and to access or correct your data. Because
              processing happens locally and nothing is retained on a server, the simplest way to withdraw consent is to
              stop using the tool and clear your local history from the Reports page.
            </span>
          </div>

          {/* Consent checkbox */}
          <label style={{
            display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 20, padding: '14px 16px',
            background: checked ? 'var(--bg-accent-tint)' : 'var(--bg-input)',
            border: `1px solid ${checked ? 'var(--border-accent)' : 'var(--border-input)'}`,
            borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.2s'
          }}>
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}
              style={{ width: 17, height: 17, marginTop: 1, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.55, fontWeight: 500 }}>
              I have read, understood, and voluntarily consent to the processing of uploaded data for fraud analysis purposes.
            </span>
          </label>

          <button className="btn-primary" disabled={!checked} onClick={giveConsent}
            style={{ width: '100%', justifyContent: 'center', marginTop: 16, padding: '13px' }}>
            Continue to FraudSentry <ArrowRight size={16} />
          </button>

          <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
            A BSCS thesis research project · University of Perpetual Help System DALTA · For educational and evidence-support use only.
          </p>
        </div>
      </div>
    </div>
  );
}
