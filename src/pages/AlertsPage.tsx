import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bell, BellOff, CheckCheck, Trash2, ScanLine, MessageSquareWarning, GitCompareArrows, ArrowRight, Mail, MailOpen, SlidersHorizontal, ReceiptText } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { formatDateTime, formatRelativeTime } from '../utils/helpers';
import { ALERT_LEVEL_LABEL, unreadCount, type FraudAlert, type AlertKind, type AlertLevel } from '../services/alerts';
import type { RiskLevel } from '../types';

type StatusFilter = 'all' | 'unread' | 'read';
const LEVEL_LABEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const KIND: Record<AlertKind, { label: string; icon: LucideIcon }> = {
  receipt: { label: 'Receipt', icon: ScanLine },
  message: { label: 'Message', icon: MessageSquareWarning },
  cross: { label: 'Cross-Evidence', icon: GitCompareArrows },
  transaction: { label: 'Transaction', icon: ReceiptText },
};

export default function AlertsPage({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const alerts = useAppStore(s => s.alerts);
  const alertLevel = useAppStore(s => s.alertLevel);
  const setAlertLevel = useAppStore(s => s.setAlertLevel);
  const setAlertStatus = useAppStore(s => s.setAlertStatus);
  const markAllAlertsRead = useAppStore(s => s.markAllAlertsRead);
  const removeAlert = useAppStore(s => s.removeAlert);
  const clearAlerts = useAppStore(s => s.clearAlerts);
  const setFocusResultId = useAppStore(s => s.setFocusResultId);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [confirmClear, setConfirmClear] = useState(false);

  const unread = unreadCount(alerts);
  const shown = alerts.filter(a => status === 'all' || a.status === status);
  const count = (f: StatusFilter) => (f === 'all' ? alerts.length : f === 'unread' ? unread : alerts.length - unread);

  const viewCheck = (a: FraudAlert) => {
    setAlertStatus(a.id, 'read');
    setFocusResultId(a.resultId);
    onNavigate?.(a.resultKind === 'transaction' ? 'transactions' : 'reports');
  };

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div className="page-head-ico"><Bell size={22} /></div>
        <div>
          <h1>Alerts</h1>
          <p>An alert is created whenever a check comes back at <b>{alertLevel === 'critical' ? 'Critical' : `${LEVEL_LABEL[alertLevel]} or higher`}</b> risk. Alerts are kept on this device with your history and are removed together with the check they came from.</p>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-ico"><BellOff size={28} /></span>
          <h2>No alerts</h2>
          <p>When a check finds a suspicious receipt or a scam message, an alert appears here so you can review it later.</p>
          {onNavigate && (
            <div className="dz-actions">
              <button type="button" className="btn-primary" onClick={() => onNavigate('scanner')}><ScanLine size={17} /> Check a receipt</button>
              <button type="button" className="btn-secondary" onClick={() => onNavigate('analyzer')}><MessageSquareWarning size={17} /> Check a message</button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="alerts-bar">
            <div className="chip-row" role="group" aria-label="Filter by status">
              {(['all', 'unread', 'read'] as StatusFilter[]).map(f => (
                <button key={f} type="button" className={`filter-btn${status === f ? ' active' : ''}`} aria-pressed={status === f} onClick={() => setStatus(f)}>
                  {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : 'Read'} <span className="count">{count(f)}</span>
                </button>
              ))}
            </div>
            <div className="alerts-bar-actions">
              <button type="button" className="btn-secondary" disabled={unread === 0} onClick={markAllAlertsRead}><CheckCheck size={15} /> Mark all as read</button>
              {confirmClear ? (
                <span className="confirm-row">
                  <span>Delete all {alerts.length} alerts?</span>
                  <button type="button" className="btn-ghost danger" onClick={() => { clearAlerts(); setConfirmClear(false); }}>Yes, delete</button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
                </span>
              ) : (
                <button type="button" className="btn-ghost danger" onClick={() => setConfirmClear(true)}><Trash2 size={15} /> Delete all</button>
              )}
            </div>
          </div>

          <p className="muted small" aria-live="polite">{unread} unread · {alerts.length} total</p>
          <ul className="history-list">
            {shown.map(a => (
              <AlertRow key={a.id} alert={a} onView={() => viewCheck(a)} onDelete={() => removeAlert(a.id)}
                onToggle={() => setAlertStatus(a.id, a.status === 'unread' ? 'read' : 'unread')} />
            ))}
          </ul>
          {shown.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: 24 }}>No {status} alerts.</p>}
        </>
      )}

      <section className="card alert-settings" aria-labelledby="alert-level-title">
        <div className="tc-head">
          <SlidersHorizontal size={20} aria-hidden="true" />
          <h2 id="alert-level-title" className="section-title" style={{ margin: 0 }}>When to create an alert</h2>
        </div>
        <div className="chip-row" role="radiogroup" aria-labelledby="alert-level-title">
          {(['critical', 'high', 'medium'] as AlertLevel[]).map(l => (
            <button key={l} type="button" role="radio" aria-checked={alertLevel === l} className={`filter-btn${alertLevel === l ? ' active' : ''}`} onClick={() => setAlertLevel(l)}>
              {ALERT_LEVEL_LABEL[l]}{l === 'high' && ' (recommended)'}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Applies to new checks. Alerts are shown inside FraudSentry only; no email or SMS is sent, because nothing leaves this device.</p>
      </section>
    </div>
  );
}

function AlertRow({ alert: a, onView, onToggle, onDelete }: { alert: FraudAlert; onView: () => void; onToggle: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const K = KIND[a.resultKind];
  const sev = a.riskLevel === 'low' ? 'ok' : a.riskLevel;
  const isUnread = a.status === 'unread';
  return (
    <li className={`history-row alert-row sev-${sev}${isUnread ? ' unread' : ''}`}>
      <span className="hr-ico" aria-hidden="true"><K.icon size={18} /></span>
      <div className="hr-main">
        <div className="hr-top">
          <span className="hr-kind">{K.label}</span>
          <span className={`sev-chip sev-${sev}`}>{LEVEL_LABEL[a.riskLevel]}</span>
          <span className={`alert-status${isUnread ? ' unread' : ''}`}>{isUnread ? 'Unread' : 'Read'}</span>
        </div>
        <div className="hr-title">{a.title}</div>
        <div className="hr-meta">{a.message}</div>
        <div className="alert-date">Generated <time dateTime={a.dateGenerated}>{formatDateTime(a.dateGenerated)}</time></div>
      </div>
      <div className="hr-side">
        <time dateTime={a.dateGenerated} title={formatDateTime(a.dateGenerated)}>{formatRelativeTime(a.dateGenerated)}</time>
        <div className="hr-actions">
          <button type="button" className="btn-ghost" onClick={onView} aria-label={`View the check for: ${a.title}`}><ArrowRight size={15} /> View check</button>
          <button type="button" className="btn-ghost" onClick={onToggle} aria-label={isUnread ? `Mark as read: ${a.title}` : `Mark as unread: ${a.title}`} title={isUnread ? 'Mark as read' : 'Mark as unread'}>
            {isUnread ? <MailOpen size={15} /> : <Mail size={15} />}
          </button>
          {confirm ? (
            <>
              <button type="button" className="btn-ghost danger" onClick={onDelete}>Delete</button>
              <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>Keep</button>
            </>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => setConfirm(true)} aria-label={`Delete alert: ${a.title}`}><Trash2 size={15} /></button>
          )}
        </div>
      </div>
    </li>
  );
}
