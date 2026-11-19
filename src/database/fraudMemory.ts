// ============================================================
// FraudSentry — fraud memory: "has this happened before?"
//
// Every record in the database is tagged with the fraud types it shows
// (e.g. "Pasted headline amount", "OTP Scam"), and indexed by app, reference
// number and recipient. When a new check comes in, its tags and identifiers
// are looked up against every earlier record, so the user sees at once:
//   • this kind of fraud was seen N times before (and when last), and
//   • the same reference number / recipient appeared in an earlier check.
// Pure functions; the database (db.ts) stores the tags in its indexes.
// ============================================================

import type { CrossEvidenceResult, ImageScanResult, MessageScanResult, VerificationFinding } from '../shared/types';
import type { ManualTransaction } from '../transactions/transactionCheck';
import type { FraudAlert } from '../alerts/alerts';
import type { FraudReport } from '../reports/fraudReports';
import type { IndexFields } from './db';

/** A finding's name → the fraud type it is evidence of. */
const FINDING_TYPES: Record<string, string> = {
  'Headline Amount Matches Details': 'Pasted headline amount',
  'Amount Reconciliation': "Amounts don't add up",
  'Amount Consistency Check': 'Edited amount',
  'Hidden or Blocked-Out Details': 'Hidden details',
  'Earlier Scan Comparison': 'Reused or edited earlier receipt',
  'Earlier Check Comparison': 'Reused or edited earlier receipt',
  'Unconfirmed Transaction': 'Unconfirmed (pending) screen',
  'No Recipient Identified': 'No recipient',
  'Recipient Details Missing': 'No recipient',
  'Receipt Date Plausibility': 'Impossible or future date',
  'Date and Time': 'Impossible or future date',
  'Weekday Matches Date': 'Wrong weekday',
  'Text Colour Consistency': 'Typed-over number',
  'Editing-Software Signature': 'Edited in photo software',
  'Container Integrity': 'Disguised file type',
  'Error Level Analysis': 'Edited regions (ELA)',
  'Reference Number Format': 'Malformed reference',
  'Reference Format': 'Malformed reference',
  'Reference Number': 'No reference number',
};

/** Fraud types shown by the failed findings of a receipt or typed transaction. */
export function fraudTypesOfFindings(findings: VerificationFinding[] = []): string[] {
  const out = new Set<string>();
  for (const f of findings) {
    if (f.passed || !(f.weight > 0)) continue;
    if (f.severity !== 'high' && f.severity !== 'critical') continue;
    out.add(FINDING_TYPES[f.label] ?? f.label);
  }
  return [...out];
}

export function fraudTypesOfMessage(m: MessageScanResult): string[] {
  const out = new Set<string>();
  if (m.scamType !== 'None Detected' && m.threatLevel !== 'low') out.add(m.scamType);
  if ((m.links ?? []).some(l => l.severity === 'critical' || l.severity === 'high')) out.add('Phishing link');
  return [...out];
}

export function fraudTypesOfCross(c: CrossEvidenceResult): string[] {
  const out: string[] = [];
  if (c.linkage === 'contradictory') out.push('Receipt contradicts the chat');
  if (c.linkage === 'unrelated') out.push('Receipt from another transaction');
  if ((c.conversationRiskLevel === 'high' || c.conversationRiskLevel === 'critical') && (c.transactionRiskLevel === 'low' || c.transactionRiskLevel === 'medium')) out.push('Real payment in a scam conversation');
  return out;
}

/** A reference number as compared across records (no spaces, hyphens or case). */
export const normRef = (s: string | null | undefined) => (s ? s.replace(/[\s-]/g, '').toUpperCase() : '') || undefined;
/** A recipient as compared across records: the number if printed, else the name. */
export function normRecipient(name: string | null | undefined, contact: string | null | undefined): string | undefined {
  const digits = contact ? contact.replace(/\D/g, '') : '';
  if (digits.length >= 4) return 'n:' + digits.slice(-4) + ':' + (contact ?? '').replace(/[^•*x\d]/gi, '').length;
  const n = name ? name.toUpperCase().replace(/[^A-Z•*]/g, '') : '';
  return n.length >= 3 ? 'p:' + n : undefined;
}

export type RecordKind = 'receipt' | 'message' | 'cross' | 'transaction';
export type AnyRecord = ImageScanResult | MessageScanResult | CrossEvidenceResult | ManualTransaction;

export function fraudTypesOf(kind: RecordKind, r: AnyRecord): string[] {
  switch (kind) {
    case 'receipt': return fraudTypesOfFindings((r as ImageScanResult).findings);
    case 'transaction': return fraudTypesOfFindings((r as ManualTransaction).findings);
    case 'message': return fraudTypesOfMessage(r as MessageScanResult);
    case 'cross': return fraudTypesOfCross(r as CrossEvidenceResult);
  }
}

const clean = (o: IndexFields): IndexFields => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')) as unknown as IndexFields;

/** The fields each kind of record is indexed on in the database. */
export function indexFields(kind: RecordKind, r: AnyRecord): IndexFields {
  const fraudTypes = fraudTypesOf(kind, r);
  if (kind === 'receipt') {
    const s = r as ImageScanResult;
    return clean({ at: s.scannedAt, risk: s.riskLevel, app: s.source, ref: normRef(s.extracted?.referenceNo), recipient: normRecipient(s.extracted?.receiverName, s.extracted?.receiverContact), fraudTypes });
  }
  if (kind === 'transaction') {
    const t = r as ManualTransaction;
    return clean({ at: t.scannedAt, risk: t.riskLevel, app: t.input.institution, ref: normRef(t.input.referenceNo), recipient: normRecipient(t.input.receiverName, t.input.receiverContact), fraudTypes });
  }
  if (kind === 'message') { const m = r as MessageScanResult; return clean({ at: m.scannedAt, risk: m.threatLevel, fraudTypes }); }
  const c = r as CrossEvidenceResult;
  return clean({ at: c.scannedAt, risk: c.combinedRiskLevel, fraudTypes });
}
export const alertIndex = (a: FraudAlert): IndexFields => ({ at: a.dateGenerated });
export const reportIndex = (r: FraudReport): IndexFields => ({ at: r.generatedAt });

// ── "Has this happened before?" ─────────────────────────────────────────

export interface Records {
  imageScans: ImageScanResult[];
  messageScans: MessageScanResult[];
  crossChecks: CrossEvidenceResult[];
  manualTransactions: ManualTransaction[];
}
export interface PriorRef { id: string; kind: RecordKind; at: string; riskLevel: string; title: string }
export interface PriorCases {
  /** per fraud type of the current record: earlier records with the same type */
  byType: { type: string; count: number; lastAt: string | null; examples: PriorRef[] }[];
  /** earlier records with the same reference number */
  sameReference: PriorRef[];
  /** earlier records paying the same recipient (number, or name when no number) */
  sameRecipient: PriorRef[];
  /** earlier messages sharing a suspicious link host or phone number */
  sameContact: PriorRef[];
  /** how many earlier records were searched */
  searched: number;
}

const php = (n: number | null | undefined) => (n == null ? '' : `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export function titleOf(kind: RecordKind, r: AnyRecord): string {
  if (kind === 'receipt') { const s = r as ImageScanResult; return [s.source !== 'Unknown' ? s.source : 'Receipt', php(s.extracted?.amount)].filter(Boolean).join(' · '); }
  if (kind === 'transaction') { const t = r as ManualTransaction; return [t.input.institution !== 'Unknown' ? t.input.institution : 'Transaction', php(t.input.amount)].filter(Boolean).join(' · '); }
  if (kind === 'message') { const m = r as MessageScanResult; return m.scamType !== 'None Detected' ? m.scamType : 'Message'; }
  return (r as CrossEvidenceResult).verdict;
}
const riskOf = (kind: RecordKind, r: AnyRecord): string =>
  kind === 'message' ? (r as MessageScanResult).threatLevel : kind === 'cross' ? (r as CrossEvidenceResult).combinedRiskLevel : (r as ImageScanResult | ManualTransaction).riskLevel;

/** Every record, newest first, with its kind. */
export function allRecords(db: Records): { kind: RecordKind; r: AnyRecord }[] {
  const out: { kind: RecordKind; r: AnyRecord }[] = [
    ...db.imageScans.map(r => ({ kind: 'receipt' as const, r })),
    ...db.manualTransactions.map(r => ({ kind: 'transaction' as const, r })),
    ...db.messageScans.map(r => ({ kind: 'message' as const, r })),
    ...db.crossChecks.map(r => ({ kind: 'cross' as const, r })),
  ];
  return out.sort((a, b) => b.r.scannedAt.localeCompare(a.r.scannedAt));
}

/** Suspicious link hosts and phone numbers in a message. */
function contactsOf(m: MessageScanResult): string[] {
  const out = new Set<string>();
  for (const l of m.links ?? []) {
    if (l.severity === 'low') continue;
    try { out.add('h:' + new URL(l.url.startsWith('http') ? l.url : 'http://' + l.url).hostname.toLowerCase().replace(/^www\./, '')); } catch { /* not a URL */ }
  }
  for (const p of (m.sourceText ?? '').match(/(?:\+?63|0)\s?9\d{2}[\s-]?\d{3}[\s-]?\d{4}/g) ?? []) out.add('p:' + p.replace(/\D/g, '').slice(-10));
  return [...out];
}

/**
 * Earlier records that share this record's fraud types, reference number,
 * recipient, or (for messages) suspicious link / phone number.
 * "Earlier" = scanned before it; the record itself is never counted.
 */
export function findPriorCases(kind: RecordKind, target: AnyRecord, db: Records, maxExamples = 3): PriorCases {
  const earlier = allRecords(db).filter(x => x.r.id !== target.id && x.r.scannedAt <= target.scannedAt);
  const ref = (x: { kind: RecordKind; r: AnyRecord }): PriorRef => ({ id: x.r.id, kind: x.kind, at: x.r.scannedAt, riskLevel: riskOf(x.kind, x.r), title: titleOf(x.kind, x.r) });
  const ix = indexFields(kind, target);

  const byType = (ix.fraudTypes ?? []).map(type => {
    const hits = earlier.filter(x => fraudTypesOf(x.kind, x.r).includes(type));
    return { type, count: hits.length, lastAt: hits[0]?.r.scannedAt ?? null, examples: hits.slice(0, maxExamples).map(ref) };
  });
  const same = (field: 'ref' | 'recipient') => !ix[field] ? [] : earlier
    .filter(x => (x.kind === 'receipt' || x.kind === 'transaction') && indexFields(x.kind, x.r)[field] === ix[field]).map(ref);
  let sameContact: PriorRef[] = [];
  if (kind === 'message') {
    const mine = new Set(contactsOf(target as MessageScanResult));
    if (mine.size) sameContact = earlier.filter(x => x.kind === 'message' && contactsOf(x.r as MessageScanResult).some(c => mine.has(c))).map(ref);
  }
  return { byType, sameReference: same('ref'), sameRecipient: same('recipient'), sameContact, searched: earlier.length };
}

/** Count of records per fraud type across the whole database (for filters and the dashboard). */
export function fraudTypeCounts(db: Records): { type: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of allRecords(db)) for (const t of fraudTypesOf(x.kind, x.r)) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}
