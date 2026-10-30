// ============================================================
// FraudSentry — fraud alerts (thesis §9.5.1: notification & alert management)
//
// When a check comes back at or above the alert level (High by default), an
// ALERT record is generated for it. The fields follow the ALERT table of the
// thesis ERD:
//   alert_id → id, result_id → resultId, message, risk_level → riskLevel,
//   status ('unread' | 'read'), date_generated → dateGenerated
// (there is no user_id: FraudSentry has no user accounts, one user per device).
// An alert belongs to the check it came from: deleting that check (or the
// 30-day history expiry) removes its alert too. Like the rest of the
// history, alerts never leave this device.
// Pure functions only — the store (useAppStore) keeps the records.
// ============================================================
import type { RiskLevel, ImageScanResult, MessageScanResult, CrossEvidenceResult } from '../shared/types';
import type { ManualTransaction } from '../transactions/transactionCheck';
import { RISK_RANK, formatPHP } from '../shared/helpers';

export type AlertKind = 'receipt' | 'message' | 'cross' | 'transaction';
export type AlertStatus = 'unread' | 'read';
/** the lowest risk level that generates an alert */
export type AlertLevel = Exclude<RiskLevel, 'low'>;

export interface FraudAlert {
  id: string;
  /** the check (fraud result) this alert was generated for */
  resultId: string;
  resultKind: AlertKind;
  title: string;
  message: string;
  riskLevel: RiskLevel;
  status: AlertStatus;
  dateGenerated: string;
}

export const DEFAULT_ALERT_LEVEL: AlertLevel = 'high';
export const MAX_ALERTS = 100;

export const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = {
  critical: 'Critical only',
  high: 'High and Critical',
  medium: 'Medium, High and Critical',
};

export const meetsAlertLevel = (level: RiskLevel, min: AlertLevel) => RISK_RANK[level] >= RISK_RANK[min];

const RECEIPT_TITLE: Record<RiskLevel, string> = {
  low: 'Receipt checked', medium: "Receipt details don't add up", high: 'Suspicious receipt', critical: 'Likely fake receipt',
};
const ADVICE: Record<AlertKind, string> = {
  transaction: 'Do not release goods or money until the payment shows in your own account.',
  receipt: 'Do not release goods or money until the payment shows in your own account.',
  message: 'Do not reply, click links, or share codes. Contact the company through its official app or hotline.',
  cross: 'Do not release goods or money until the payment shows in your own account.',
};

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** The strongest failed checks of a receipt, most important first. */
function topReasons(scan: ImageScanResult, n = 2): string[] {
  return scan.findings
    .filter(f => !f.passed)
    .sort((a, b) => RISK_RANK[b.severity] - RISK_RANK[a.severity] || b.weight - a.weight)
    .slice(0, n)
    .map(f => f.label);
}

function make(kind: AlertKind, resultId: string, riskLevel: RiskLevel, title: string, body: string, when: string): FraudAlert {
  return {
    id: `alert-${resultId}`,
    resultId, resultKind: kind, title,
    message: `${sentence(body)} ${ADVICE[kind]}`,
    riskLevel, status: 'unread', dateGenerated: when,
  };
}

export function alertForReceipt(scan: ImageScanResult, min: AlertLevel = DEFAULT_ALERT_LEVEL): FraudAlert | null {
  if (!meetsAlertLevel(scan.riskLevel, min)) return null;
  const what = [
    scan.source !== 'Unknown' ? `${scan.source} receipt` : 'Receipt',
    scan.extracted.amount != null ? `for ${formatPHP(scan.extracted.amount)}` : null,
    scan.extracted.referenceNo ? `(ref ${scan.extracted.referenceNo})` : null,
  ].filter(Boolean).join(' ');
  const reasons = topReasons(scan);
  const body = reasons.length ? `${what}. Main reason${reasons.length > 1 ? 's' : ''}: ${reasons.join('; ')}` : what;
  return make('receipt', scan.id, scan.riskLevel, RECEIPT_TITLE[scan.riskLevel], body, scan.scannedAt);
}

export function alertForMessage(scan: MessageScanResult, min: AlertLevel = DEFAULT_ALERT_LEVEL): FraudAlert | null {
  if (!meetsAlertLevel(scan.threatLevel, min)) return null;
  const type = scan.scamType === 'None Detected' ? 'Suspicious message' : `Possible ${scan.scamType}`;
  const from = scan.platform !== 'Unknown' ? ` (${scan.platform})` : '';
  const signs = scan.flags.length + scan.links.length;
  const top = [...scan.flags, ...scan.links].sort((a, b) => RISK_RANK[b.severity] - RISK_RANK[a.severity])[0];
  const body = `${signs} warning sign${signs === 1 ? '' : 's'} found${top ? `. Main sign: ${top.reason}` : ''}`;
  return make('message', scan.id, scan.threatLevel, `${type}${from}`, body, scan.scannedAt);
}

export function alertForCross(cross: CrossEvidenceResult, min: AlertLevel = DEFAULT_ALERT_LEVEL): FraudAlert | null {
  if (!meetsAlertLevel(cross.combinedRiskLevel, min)) return null;
  const body = cross.rationale[0] ?? `Receipt risk ${cross.transactionRiskLevel}, conversation risk ${cross.conversationRiskLevel}`;
  return make('cross', cross.id, cross.combinedRiskLevel, cross.verdict, body, cross.scannedAt);
}

export function alertForTransaction(t: ManualTransaction, min: AlertLevel = DEFAULT_ALERT_LEVEL): FraudAlert | null {
  if (!meetsAlertLevel(t.riskLevel, min)) return null;
  const what = [
    t.input.institution !== 'Unknown' ? `${t.input.institution} ${t.input.type.toLowerCase()}` : t.input.type,
    t.input.amount != null ? `for ${formatPHP(t.input.amount)}` : null,
    t.input.referenceNo ? `(ref ${t.input.referenceNo})` : null,
  ].filter(Boolean).join(' ');
  const reasons = t.findings.filter(f => !f.passed).sort((a, b) => RISK_RANK[b.severity] - RISK_RANK[a.severity] || b.weight - a.weight).slice(0, 2).map(f => f.label);
  return make('transaction', t.id, t.riskLevel, t.riskLevel === 'critical' ? 'Likely fake payment claim' : 'Suspicious payment details',
    reasons.length ? `${what}. Main reason${reasons.length > 1 ? 's' : ''}: ${reasons.join('; ')}` : what, t.scannedAt);
}

/** Add an alert (newest first, one per check). */
export function withAlert(alerts: FraudAlert[], alert: FraudAlert | null): FraudAlert[] {
  if (!alert) return alerts;
  return [alert, ...alerts.filter(a => a.resultId !== alert.resultId)].slice(0, MAX_ALERTS);
}

/** Keep only alerts whose check still exists. */
export function alertsForResults(alerts: FraudAlert[], resultIds: Iterable<string>): FraudAlert[] {
  const ids = new Set(resultIds);
  return alerts.filter(a => ids.has(a.resultId));
}

export const unreadCount = (alerts: FraudAlert[]) => alerts.reduce((n, a) => n + (a.status === 'unread' ? 1 : 0), 0);
