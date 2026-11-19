// ============================================================
// FraudSentry — the Transaction Audit Dashboard's data (pure functions)
//
// Turns every record — real checks from the on-device database and simulated
// incoming transactions — into one audit event: when, which app, amount,
// reference, risk, whether it is a flagged anomaly (anything that did not
// fully check out: Medium risk or above) and whether it is possibly
// fraudulent (High or above, the system's classification), its fraud types
// and the main reason. Then filters the stream and summarises it.
// ============================================================

import type { RiskLevel, ImageScanResult, MessageScanResult, CrossEvidenceResult, VerificationFinding } from '../shared/types';
import type { ManualTransaction } from '../transactions/transactionCheck';
import { fraudTypesOf, titleOf, type RecordKind, type Records } from '../database/fraudMemory';
import type { SimEvent, Scenario } from './simulator';

export interface AuditEvent {
  id: string;
  kind: RecordKind;
  at: string;
  app: string;
  amount: number | null;
  reference: string | null;
  recipient: string | null;
  riskLevel: RiskLevel;
  riskScore: number;
  /** a flagged anomaly: something did not check out (Medium risk or above) */
  flagged: boolean;
  /** High or Critical: the system classifies it as possibly fraudulent */
  fraudulent: boolean;
  fraudTypes: string[];
  title: string;
  mainReason: string | null;
  /** the failed findings / message flags, for the row's details */
  reasons: string[];
  simulated: boolean;
  scenario?: Scenario;
}

const isFlagged = (l: RiskLevel) => l !== 'low';
const isFraudulent = (l: RiskLevel) => l === 'high' || l === 'critical';
const failedReasons = (f: VerificationFinding[]) => [...f].filter(x => !x.passed && x.weight > 0).sort((a, b) => b.weight - a.weight).map(x => x.label);

export function eventFromRecord(kind: RecordKind, r: ImageScanResult | MessageScanResult | CrossEvidenceResult | ManualTransaction, simulated = false, scenario?: Scenario): AuditEvent {
  const base = { id: r.id, kind, at: r.scannedAt, title: titleOf(kind, r), fraudTypes: fraudTypesOf(kind, r), simulated, scenario };
  if (kind === 'receipt') {
    const s = r as ImageScanResult; const reasons = failedReasons(s.findings);
    return { ...base, app: s.source, amount: s.extracted?.amount ?? null, reference: s.extracted?.referenceNo ?? null, recipient: s.extracted?.receiverName ?? s.extracted?.receiverContact ?? null,
      riskLevel: s.riskLevel, riskScore: s.riskScore, flagged: isFlagged(s.riskLevel), fraudulent: isFraudulent(s.riskLevel), mainReason: reasons[0] ?? null, reasons };
  }
  if (kind === 'transaction') {
    const t = r as ManualTransaction; const reasons = failedReasons(t.findings);
    return { ...base, app: t.input.institution, amount: t.input.amount, reference: t.input.referenceNo, recipient: t.input.receiverName ?? t.input.receiverContact,
      riskLevel: t.riskLevel, riskScore: t.riskScore, flagged: isFlagged(t.riskLevel), fraudulent: isFraudulent(t.riskLevel), mainReason: reasons[0] ?? null, reasons };
  }
  if (kind === 'message') {
    const m = r as MessageScanResult; const reasons = (m.flags ?? []).map(f => f.reason);
    return { ...base, app: m.platform ?? 'Message', amount: null, reference: null, recipient: null,
      riskLevel: m.threatLevel, riskScore: m.riskScore, flagged: isFlagged(m.threatLevel), fraudulent: isFraudulent(m.threatLevel), mainReason: m.scamType !== 'None Detected' ? m.scamType : null, reasons };
  }
  const c = r as CrossEvidenceResult;
  return { ...base, app: 'Cross-Evidence', amount: null, reference: null, recipient: null,
    riskLevel: c.combinedRiskLevel, riskScore: c.combinedScore, flagged: isFlagged(c.combinedRiskLevel), fraudulent: isFraudulent(c.combinedRiskLevel), mainReason: c.verdict, reasons: c.rationale ?? [] };
}

/** Real records and simulated events as one stream, newest first. */
export function buildFeed(records: Records, simulated: SimEvent[]): AuditEvent[] {
  const real = [
    ...records.imageScans.map(r => eventFromRecord('receipt', r)),
    ...records.manualTransactions.map(r => eventFromRecord('transaction', r)),
    ...records.messageScans.map(r => eventFromRecord('message', r)),
    ...records.crossChecks.map(r => eventFromRecord('cross', r)),
  ];
  const sim = simulated.map(e => eventFromRecord(e.kind, e.record, true, e.scenario));
  return [...real, ...sim].sort((a, b) => b.at.localeCompare(a.at));
}

export interface AuditFilter {
  source: 'all' | 'real' | 'simulated';
  flaggedOnly: boolean;
  /** empty: every level */
  levels: RiskLevel[];
  app: string;
  fraudType: string;
  kind: RecordKind | 'all';
  /** YYYY-MM-DD, inclusive (Philippine date) */
  from: string;
  to: string;
  q: string;
}
export const DEFAULT_FILTER: AuditFilter = { source: 'all', flaggedOnly: false, levels: [], app: '', fraudType: '', kind: 'all', from: '', to: '', q: '' };

/** The event's date in the Philippines (UTC+8), YYYY-MM-DD. */
export const phDate = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);

export function filterEvents(events: AuditEvent[], f: AuditFilter): AuditEvent[] {
  const q = f.q.trim().toLowerCase();
  return events.filter(e =>
    (f.source === 'all' || (f.source === 'simulated') === e.simulated) &&
    (!f.flaggedOnly || e.flagged) &&
    (!f.levels.length || f.levels.includes(e.riskLevel)) &&
    (!f.app || e.app === f.app) &&
    (!f.fraudType || e.fraudTypes.includes(f.fraudType)) &&
    (f.kind === 'all' || e.kind === f.kind) &&
    (!f.from || phDate(e.at) >= f.from) &&
    (!f.to || phDate(e.at) <= f.to) &&
    (!q || [e.app, e.reference, e.recipient, e.title, e.mainReason, ...e.fraudTypes].some(v => v && String(v).toLowerCase().includes(q))),
  );
}

export interface AuditStats {
  total: number;
  /** flagged anomalies (Medium or above) */
  flagged: number;
  /** possibly fraudulent (High or above) */
  fraudulent: number;
  critical: number;
  /** flagged ÷ total (0 when empty) */
  flagRate: number;
  real: number;
  simulated: number;
  byApp: { app: string; total: number; flagged: number }[];
  byType: { type: string; count: number }[];
  byLevel: Record<RiskLevel, number>;
  lastFlaggedAt: string | null;
}

export function auditStats(events: AuditEvent[]): AuditStats {
  const byApp = new Map<string, { total: number; flagged: number }>();
  const byType = new Map<string, number>();
  const byLevel: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  let flagged = 0, fraudulent = 0, critical = 0, simulated = 0, lastFlaggedAt: string | null = null;
  for (const e of events) {
    byLevel[e.riskLevel]++;
    if (e.simulated) simulated++;
    if (e.riskLevel === 'critical') critical++;
    if (e.fraudulent) fraudulent++;
    if (e.flagged) { flagged++; if (!lastFlaggedAt || e.at > lastFlaggedAt) lastFlaggedAt = e.at; }
    if (e.kind === 'receipt' || e.kind === 'transaction') {
      const a = byApp.get(e.app) ?? { total: 0, flagged: 0 };
      a.total++; if (e.flagged) a.flagged++;
      byApp.set(e.app, a);
    }
    if (e.flagged) for (const t of e.fraudTypes) byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  return {
    total: events.length, flagged, fraudulent, critical, flagRate: events.length ? flagged / events.length : 0,
    real: events.length - simulated, simulated,
    byApp: [...byApp.entries()].map(([app, v]) => ({ app, ...v })).sort((a, b) => b.total - a.total || a.app.localeCompare(b.app)),
    byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    byLevel, lastFlaggedAt,
  };
}
