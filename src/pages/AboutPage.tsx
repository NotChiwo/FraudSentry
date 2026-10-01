import { ShieldCheck, ScanLine, MessageSquareWarning, GitCompareArrows, BookOpen, Layers, Cpu, Eye, FileText } from 'lucide-react';

const MODULES = [
  { icon: ScanLine, color: '#2563eb', title: 'Transaction Authenticity Check', body: 'Reads payment screenshots with OCR and inspects the image for editing signals, scoring evidence rather than guessing fraud.' },
  { icon: MessageSquareWarning, color: '#f59e0b', title: 'Fraud Message Analyzer', body: 'Detects scam language, known patterns, and suspicious links in text or screenshots, highlighting the exact risky phrases.' },
  { icon: GitCompareArrows, color: '#6366f1', title: 'Cross-Evidence Analysis', body: 'Correlates a transaction with its conversation to surface the dangerous combination of real money and a fraudulent context.' },
  { icon: BookOpen, color: '#10b981', title: 'Scam Knowledge Base', body: 'An educational reference of the scam patterns the analyzer checks against, with red flags and protective advice.' },
];

const PRINCIPLES = [
  { icon: Eye, title: 'Explainable by design', body: 'Every percentage breaks down into named, weighted factors. No unexplained scores.' },
  { icon: Cpu, title: 'Real, on-device analysis', body: 'OCR and image forensics run in your browser — no fabricated data, no synthetic predictions.' },
  { icon: Layers, title: 'Evidence over assumptions', body: 'The system never claims to know if money was truly stolen; it assesses what the evidence shows.' },
  { icon: ShieldCheck, title: 'Privacy first', body: 'No accounts, no tracking, no server uploads. Your data stays with you.' },
];

export default function AboutPage() {
  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--bg-accent-tint)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShieldCheck size={19} color="var(--accent-light)" />
          </div>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: 'var(--text-primary)' }}>About FraudSentry</h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '2px 0 0' }}>An evidence-based fraud verification and scam-intelligence platform.</p>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 22, marginBottom: 18 }}>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
          FraudSentry helps everyday users assess whether a payment screenshot looks authentic and whether a message
          matches known scam patterns. Instead of pretending to "detect fraud" from arbitrary numbers, it reads the actual
          evidence you provide, measures concrete signals, and explains its reasoning in plain terms — so you can make an
          informed decision and verify through official channels.
        </p>
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' }}>Core modules</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14, marginBottom: 24 }}>
        {MODULES.map((m, i) => {
          const Icon = m.icon;
          return (
            <div key={i} className="card" style={{ padding: 18, display: 'flex', gap: 13, alignItems: 'flex-start' }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: `${m.color}1a`, border: `1px solid ${m.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={18} color={m.color} />
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{m.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{m.body}</div>
              </div>
            </div>
          );
        })}
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' }}>Design principles</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14, marginBottom: 24 }}>
        {PRINCIPLES.map((p, i) => {
          const Icon = p.icon;
          return (
            <div key={i} className="card" style={{ padding: 16 }}>
              <Icon size={18} color="var(--accent-light)" style={{ marginBottom: 9 }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{p.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{p.body}</div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ padding: 18, display: 'flex', gap: 13, alignItems: 'flex-start' }}>
        <FileText size={18} color="var(--accent-light)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          FraudSentry is a BSCS thesis research project developed at the University of Perpetual Help System DALTA. It is
          intended for educational and evidence-support purposes and complies with the Philippine Data Privacy Act of 2012
          (RA 10173). It is not affiliated with any bank or e-wallet provider.
        </div>
      </div>
    </div>
  );
}
