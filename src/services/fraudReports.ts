// ============================================================
// FraudSentry — fraud detection reports (thesis Module 5, REPORT table)
//
// A report is a snapshot over a period: what was checked, how it was
// classified, which apps and transaction types were involved, the most
// common reasons, the alerts raised, which models scored the checks and —
// most usefully — how often the classification agreed with the REAL
// outcome users confirmed in their own accounts (received / not received).
//   • summary  — the numbers and the breakdowns
//   • detailed — the same, plus every check in the period
// Administrators can report on all users of the device.
// Reports are saved in the generating user's encrypted vault, so they can be
// reopened later; like the history, they expire after 30 days.
// Pure functions.
// ============================================================
import type { RiskLevel, TransactionStatus, Classification } from '../types';
import type { UserData } from '../store/useAppStore';
import { classificationOf, generateId, formatPHP } from '../utils/helpers';
import { unreadCount } from './alerts';

export type ReportType = 'summary' | 'detailed';
export type ReportScope = 'me' | 'all';

export interface ReportRow {
  when: string;
  kind: 'Receipt' | 'Message' | 'Cross-Evidence' | 'Typed details';
  app: string;
  type: string;
  amount: number | null;
  reference: string | null;
  riskLevel: RiskLevel;
  classification: Classification;
  outcome: TransactionStatus | null;
  user?: string;
}

export interface Agreement { confirmed: number; tp: number; fp: number; tn: number; fn: number; accuracy: number | null; precision: number | null; recall: number | null }

export interface ReportStats {
  checks: number;
  byKind: Record<ReportRow['kind'], number>;
  fraudulent: number;
  legitimate: number;
  byRisk: Record<RiskLevel, number>;
  outcomes: Record<TransactionStatus, number>;
  /** classification vs the outcome confirmed by the user (receipts and typed details) */
  agreement: Agreement;
  amountFlagged: number;
  byApp: { app: string; checks: number; fraudulent: number; notReceived: number }[];
  byType: { type: string; checks: number; fraudulent: number }[];
  topReasons: { label: string; count: number }[];
  alerts: { total: number; unread: number };
  models: { name: string; checks: number }[];
  users?: { username: string; checks: number; fraudulent: number }[];
}

export interface FraudReport {
  id: string;
  userId: string | null;
  username: string | null;
  reportType: ReportType;
  scope: ReportScope;
  title: string;
  /** the findings in plain words (REPORT.description) */
  description: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  stats: ReportStats;
  /** detailed reports only */
  rows?: ReportRow[];
}

export const MAX_REPORTS = 50;

export interface ReportSource { username: string; data: UserData }

/** the Philippine calendar day of a timestamp (UTC+8, no DST) */
export const phDay = (when: string) => { const t = Date.parse(when); return isNaN(t) ? when.slice(0, 10) : new Date(t + 8 * 3600_000).toISOString().slice(0, 10); };
const inPeriod = (when: string, from: string, to: string) => { const d = phDay(when); return d >= from && d <= to; };
const ratio = (a: number, b: number) => (b ? a / b : null);

/** Every check of these users in the period, as report rows (newest first). */
export function reportRows(sources: ReportSource[], from: string, to: string): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const { username, data } of sources) {
    const user = sources.length > 1 ? username : undefined;
    for (const s of data.imageScans) if (inPeriod(s.scannedAt, from, to)) rows.push({
      when: s.scannedAt, kind: 'Receipt', app: s.source, type: s.transactionType ?? 'Other', amount: s.extracted.amount, reference: s.extracted.referenceNo,
      riskLevel: s.riskLevel, classification: s.classification ?? classificationOf(s.riskLevel), outcome: s.txStatus ?? 'pending', user,
    });
    for (const t of data.manualTransactions) if (inPeriod(t.scannedAt, from, to)) rows.push({
      when: t.scannedAt, kind: 'Typed details', app: t.input.institution, type: t.input.type, amount: t.input.amount, reference: t.input.referenceNo,
      riskLevel: t.riskLevel, classification: t.classification, outcome: t.txStatus, user,
    });
    for (const m of data.messageScans) if (inPeriod(m.scannedAt, from, to)) rows.push({
      when: m.scannedAt, kind: 'Message', app: m.platform, type: m.scamType, amount: null, reference: null,
      riskLevel: m.threatLevel, classification: classificationOf(m.threatLevel), outcome: null, user,
    });
    for (const c of data.crossChecks) if (inPeriod(c.scannedAt, from, to)) rows.push({
      when: c.scannedAt, kind: 'Cross-Evidence', app: '—', type: c.verdict, amount: null, reference: null,
      riskLevel: c.combinedRiskLevel, classification: classificationOf(c.combinedRiskLevel), outcome: null, user,
    });
  }
  return rows.sort((a, b) => b.when.localeCompare(a.when));
}

function tally<K extends string>(items: K[]): Map<K, number> {
  const m = new Map<K, number>();
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

export function reportStats(sources: ReportSource[], from: string, to: string): ReportStats {
  const rows = reportRows(sources, from, to);
  const pay = rows.filter(r => r.kind === 'Receipt' || r.kind === 'Typed details');
  const confirmed = pay.filter(r => r.outcome === 'received' || r.outcome === 'not-received');
  const tp = confirmed.filter(r => r.classification === 'fraudulent' && r.outcome === 'not-received').length;
  const fp = confirmed.filter(r => r.classification === 'fraudulent' && r.outcome === 'received').length;
  const tn = confirmed.filter(r => r.classification === 'legitimate' && r.outcome === 'received').length;
  const fn = confirmed.filter(r => r.classification === 'legitimate' && r.outcome === 'not-received').length;
  const byRisk: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  rows.forEach(r => { byRisk[r.riskLevel]++; });
  const byKind = { Receipt: 0, Message: 0, 'Cross-Evidence': 0, 'Typed details': 0 } as Record<ReportRow['kind'], number>;
  rows.forEach(r => { byKind[r.kind]++; });

  const apps = [...new Set(pay.map(r => r.app))];
  const types = [...new Set(pay.map(r => r.type))];
  const reasons: string[] = [];
  const modelNames: string[] = [];
  let alertsTotal = 0, alertsUnread = 0;
  for (const { data } of sources) {
    for (const s of data.imageScans) if (inPeriod(s.scannedAt, from, to)) {
      s.findings.filter(f => !f.passed && f.weight > 0).forEach(f => reasons.push(f.label));
      modelNames.push(s.forestAnalysis?.modelName ?? (s.forestAnalysis ? 'earlier model (not recorded)' : 'no model'));
    }
    for (const t of data.manualTransactions) if (inPeriod(t.scannedAt, from, to)) t.findings.filter(f => !f.passed && f.weight > 0).forEach(f => reasons.push(f.label));
    const alerts = data.alerts.filter(a => inPeriod(a.dateGenerated, from, to));
    alertsTotal += alerts.length; alertsUnread += unreadCount(alerts);
  }
  return {
    checks: rows.length, byKind,
    fraudulent: rows.filter(r => r.classification === 'fraudulent').length,
    legitimate: rows.filter(r => r.classification === 'legitimate').length,
    byRisk,
    outcomes: { pending: pay.filter(r => r.outcome === 'pending').length, received: pay.filter(r => r.outcome === 'received').length, 'not-received': pay.filter(r => r.outcome === 'not-received').length },
    agreement: { confirmed: confirmed.length, tp, fp, tn, fn, accuracy: ratio(tp + tn, confirmed.length), precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) },
    amountFlagged: pay.filter(r => r.classification === 'fraudulent').reduce((s, r) => s + (r.amount ?? 0), 0),
    byApp: apps.map(app => {
      const a = pay.filter(r => r.app === app);
      return { app, checks: a.length, fraudulent: a.filter(r => r.classification === 'fraudulent').length, notReceived: a.filter(r => r.outcome === 'not-received').length };
    }).sort((x, y) => y.checks - x.checks),
    byType: types.map(type => {
      const a = pay.filter(r => r.type === type);
      return { type, checks: a.length, fraudulent: a.filter(r => r.classification === 'fraudulent').length };
    }).sort((x, y) => y.checks - x.checks),
    topReasons: [...tally(reasons).entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    alerts: { total: alertsTotal, unread: alertsUnread },
    models: [...tally(modelNames).entries()].map(([name, checks]) => ({ name, checks })).sort((a, b) => b.checks - a.checks),
    ...(sources.length > 1 ? {
      users: sources.map(({ username }) => {
        const u = rows.filter(r => r.user === username);
        return { username, checks: u.length, fraudulent: u.filter(r => r.classification === 'fraudulent').length };
      }),
    } : {}),
  };
}

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);

/** REPORT.description: the period's findings in plain words. */
export function describeReport(s: ReportStats): string {
  if (!s.checks) return 'No checks were made in this period.';
  const parts = [
    `${s.checks} check${s.checks === 1 ? ' was' : 's were'} made (${s.byKind.Receipt} receipts, ${s.byKind['Typed details']} typed transactions, ${s.byKind.Message} messages, ${s.byKind['Cross-Evidence']} cross-evidence).`,
    `${s.fraudulent} (${pct(s.fraudulent / s.checks)}) ${s.fraudulent === 1 ? 'was' : 'were'} classified possibly fraudulent${s.amountFlagged ? `, involving ${formatPHP(s.amountFlagged)} in claimed payments` : ''}.`,
  ];
  const a = s.agreement;
  if (a.confirmed) parts.push(`Users confirmed the real outcome of ${a.confirmed} payment${a.confirmed === 1 ? '' : 's'}: the classification matched it in ${a.tp + a.tn} (${pct(a.accuracy)}); ${a.tp} fake payment${a.tp === 1 ? ' was' : 's were'} caught, ${a.fn} missed, and ${a.fp} genuine payment${a.fp === 1 ? ' was' : 's were'} flagged.`);
  else parts.push('No payment outcome was confirmed yet, so the classification could not be compared with what really happened.');
  if (s.topReasons.length) parts.push(`The most common warning sign was “${s.topReasons[0].label}” (${s.topReasons[0].count}×).`);
  if (s.outcomes.pending) parts.push(`${s.outcomes.pending} payment${s.outcomes.pending === 1 ? ' is' : 's are'} still waiting to be confirmed.`);
  return parts.join(' ');
}

export function buildReport(
  sources: ReportSource[],
  opts: { type: ReportType; scope: ReportScope; from: string; to: string; userId: string | null; username: string | null },
  now = new Date(),
): FraudReport {
  const stats = reportStats(sources, opts.from, opts.to);
  const range = opts.from === opts.to ? opts.from : `${opts.from} to ${opts.to}`;
  return {
    id: generateId('report'), userId: opts.userId, username: opts.username, reportType: opts.type, scope: opts.scope,
    title: `${opts.type === 'summary' ? 'Summary' : 'Detailed'} report · ${opts.scope === 'all' ? 'all users' : opts.username ?? 'me'} · ${range}`,
    description: describeReport(stats), periodFrom: opts.from, periodTo: opts.to, generatedAt: now.toISOString(), stats,
    ...(opts.type === 'detailed' ? { rows: reportRows(sources, opts.from, opts.to) } : {}),
  };
}

/** The rows as CSV (detailed reports), or the breakdowns (summary). */
export function reportToCsv(r: FraudReport): string {
  const esc = (v: unknown) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
  if (r.rows) {
    const head = ['checked_at', 'kind', 'app_or_platform', 'type', 'amount', 'reference', 'risk_level', 'classification', 'outcome', ...(r.scope === 'all' ? ['user'] : [])];
    return [head.join(','), ...r.rows.map(x => [x.when, x.kind, x.app, x.type, x.amount ?? '', x.reference, x.riskLevel, x.classification, x.outcome ?? '', ...(r.scope === 'all' ? [x.user] : [])].map(esc).join(','))].join('\n') + '\n';
  }
  const s = r.stats;
  const lines = [['measure', 'value'], ['checks', s.checks], ['possibly fraudulent', s.fraudulent], ['legitimate', s.legitimate],
    ...Object.entries(s.byRisk).map(([k, v]) => [`risk ${k}`, v]), ...Object.entries(s.outcomes).map(([k, v]) => [`outcome ${k}`, v]),
    ['confirmed outcomes', s.agreement.confirmed], ['agreement accuracy', s.agreement.accuracy ?? ''], ['TP', s.agreement.tp], ['FP', s.agreement.fp], ['TN', s.agreement.tn], ['FN', s.agreement.fn],
    ...s.byApp.map(a => [`app ${a.app}`, `${a.checks} checks, ${a.fraudulent} flagged, ${a.notReceived} not received`])];
  return lines.map(l => l.map(esc).join(',')).join('\n') + '\n';
}

export function reportsWithinRetention(reports: FraudReport[], days: number, now = Date.now()): FraudReport[] {
  const cutoff = now - days * 864e5;
  return reports.filter(r => { const t = Date.parse(r.generatedAt); return isNaN(t) || t >= cutoff; });
}
