import { useState } from 'react';
import {
  FileText, Download, Trash2, Inbox, ScanLine, MessageSquareWarning,
  GitCompareArrows, Filter,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { generateImageReport, generateMessageReport } from '../services/reportGenerator';
import { RISK_META, formatDateTime, formatRelativeTime } from '../utils/helpers';
import { RiskLevel } from '../types';

type Filter = 'all' | 'images' | 'messages' | 'cross';

export default function ReportsPage() {
  const imageScans = useAppStore(s => s.imageScans);
  const messageScans = useAppStore(s => s.messageScans);
  const crossChecks = useAppStore(s => s.crossChecks);
  const clearHistory = useAppStore(s => s.clearHistory);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmClear, setConfirmClear] = useState(false);

  const total = imageScans.length + messageScans.length + crossChecks.length;

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--bg-accent-tint)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FileText size={19} color="var(--accent-light)" />
          </div>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: 'var(--text-primary)' }}>Reports &amp; Records</h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
              Every scan you run is saved locally in this browser. Download any as a PDF for documentation.
            </p>
          </div>
        </div>
        {total > 0 && (
          confirmClear ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Clear all records?</span>
              <button className="btn-ghost" onClick={() => { clearHistory(); setConfirmClear(false); }} style={{ color: 'var(--accent-red)', borderColor: 'rgba(239,68,68,0.4)' }}>Yes, clear</button>
              <button className="btn-ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn-ghost" onClick={() => setConfirmClear(true)}><Trash2 size={13} /> Clear history</button>
          )
        )}
      </div>

      {total === 0 ? (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, margin: '0 auto 16px', borderRadius: 15, background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Inbox size={26} color="var(--text-muted)" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>No records yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 380, margin: '0 auto', lineHeight: 1.55 }}>
            Run a transaction check or message analysis and it will appear here, ready to export.
          </div>
        </div>
      ) : (
        <>
          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {([['all', 'All', total], ['images', 'Transactions', imageScans.length], ['messages', 'Messages', messageScans.length], ['cross', 'Cross-Evidence', crossChecks.length]] as [Filter, string, number][]).map(([f, label, count]) => (
              <button key={f} className={`filter-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {label} <span style={{ opacity: 0.7 }}>({count})</span>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {(filter === 'all' || filter === 'images') && imageScans.map(s => (
              <RecordRow key={s.id} icon={ScanLine} kind="Transaction" title={s.legitimacyLabel}
                meta={`${s.source} · ${s.findings.filter(f => !f.passed).length} factor(s) · OCR ${s.ocr.available ? Math.round(s.ocr.confidence) + '%' : 'N/A'}`}
                level={s.riskLevel} when={s.scannedAt} onDownload={() => generateImageReport(s)} />
            ))}
            {(filter === 'all' || filter === 'messages') && messageScans.map(s => (
              <RecordRow key={s.id} icon={MessageSquareWarning} kind="Message" title={s.scamType}
                meta={`${s.platform} · ${s.flags.length} flagged phrase(s)`}
                level={s.threatLevel} when={s.scannedAt} onDownload={() => generateMessageReport(s)} />
            ))}
            {(filter === 'all' || filter === 'cross') && crossChecks.map(s => (
              <RecordRow key={s.id} icon={GitCompareArrows} kind="Cross-Evidence" title={s.verdict}
                meta={`Transaction ${RISK_META[s.transactionRiskLevel].label} · Conversation ${RISK_META[s.conversationRiskLevel].label}`}
                level={s.combinedRiskLevel} when={s.scannedAt} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RecordRow({ icon: Icon, kind, title, meta, level, when, onDownload }: {
  icon: any; kind: string; title: string; meta: string; level: RiskLevel; when: string; onDownload?: () => void;
}) {
  const rm = RISK_META[level];
  const badgeClass = level === 'critical' ? 'critical' : level === 'high' ? 'high' : level === 'medium' ? 'medium' : 'low';
  return (
    <div className="card card-hover" style={{ padding: '15px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: `${rm.hex}1a`, border: `1px solid ${rm.hex}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={17} color={rm.hex} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="badge badge-neutral">{kind}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</span>
          <span className={`badge badge-${badgeClass}`}>{rm.label}</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{meta}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }} title={formatDateTime(when)}>{formatRelativeTime(when)}</div>
        {onDownload && (
          <button className="btn-secondary" style={{ marginTop: 7, padding: '6px 12px', fontSize: 12 }} onClick={onDownload}>
            <Download size={13} /> PDF
          </button>
        )}
      </div>
    </div>
  );
}
