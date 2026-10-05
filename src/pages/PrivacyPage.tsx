import { Lock, Database, Eye, ShieldCheck, UserCheck, AlertCircle, ScanText, Server } from 'lucide-react';

const SECTIONS = [
  {
    icon: Database, color: '#2563eb', title: 'What data we process',
    body: 'FraudSentry processes the images and text you choose to submit — payment screenshots, chat captures, and pasted messages — solely to produce a fraud risk assessment. Within these, personal details such as names, amounts, reference numbers, links, and phone numbers may be read in order to display findings back to you.',
  },
  {
    icon: ScanText, color: '#3b82f6', title: 'OCR processing',
    body: 'Screenshots are analyzed using Optical Character Recognition (OCR) that runs inside your own browser. The extracted text is shown to you, used for the analysis, and kept only in your local scan history. It is never transmitted to an external server by this application.',
  },
  {
    icon: Server, color: '#6366f1', title: 'Temporary file handling',
    body: 'Uploaded files are held in memory only for the duration of a scan and are not written to any server. A short history of your results is stored locally in your browser (localStorage) so you can re-open and export them. New receipts are compared against the fields in this local history (reference number, amount, recipient, date) to warn you about a reused or edited copy of an earlier receipt; that comparison also happens only in your browser. Clearing your history from the Reports page removes this immediately.',
  },
  {
    icon: Eye, color: '#10b981', title: 'How results are used',
    body: 'Analysis results exist only to help you assess fraud risk. We do not profile users, run advertising, sell data, or share your content with third parties. There is no account system, so your scans are not linked to an identity.',
  },
  {
    icon: AlertCircle, color: '#f59e0b', title: 'AI limitations disclaimer',
    body: 'FraudSentry produces evidence-based risk indicators, not legal, official, or bank-certified determinations. No automated system is 100% accurate — both false positives and false negatives are possible. Always confirm important matters through official channels (your bank, the e-wallet provider, or the authorities).',
  },
  {
    icon: UserCheck, color: '#3b82f6', title: 'Your responsibilities',
    body: 'You are responsible for ensuring you have the right to upload the content you submit, and for any decisions you make based on the results. Avoid uploading other people\u2019s sensitive information unless necessary.',
  },
];

export default function PrivacyPage() {
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--bg-accent-tint)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Lock size={19} color="var(--accent-light)" />
          </div>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: 'var(--text-primary)' }}>Privacy &amp; Data Policy</h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '2px 0 0' }}>Compliant with the Philippine Data Privacy Act of 2012 (RA 10173).</p>
          </div>
        </div>
      </div>

      <div className="privacy-notice" style={{ marginBottom: 18 }}>
        <ShieldCheck size={15} color="var(--accent-light)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>In short: your uploads are processed in your browser, not on a server. There is no login, no tracking, and no data resale. You stay in control and can clear everything at any time.</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        {SECTIONS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="card" style={{ padding: 18, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: `${s.color}1a`, border: `1px solid ${s.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={18} color={s.color} />
              </div>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 5 }}>{s.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{s.body}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ padding: 18, marginTop: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Your rights under RA 10173</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          You have the right to be informed, to object to processing, and to access, correct, or erase your data. Because
          FraudSentry processes everything locally and retains nothing on a server, you can exercise these rights directly:
          stop using the tool, edit any extracted text before analysis, and clear your local history whenever you wish.
        </div>
      </div>
    </div>
  );
}
