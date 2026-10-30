// ============================================================
// FraudSentry — check a transaction from its typed details (no screenshot)
//
// Sometimes all a seller has is what the buyer typed: "sent na po, ref
// 1016642566968, ₱1,500 via GCash". These details can still be checked:
//   • is there a reference number, and does it have this app's format?
//   • is the date real and not in the future?
//   • was this reference already used in an earlier check — with another
//     amount (an edited copy) or the same one (a reused receipt)?
// With no image, image forensics and the Random Forest (which scores image
// evidence) cannot run, so the result is rules-only and says so.
// Pure function.
// ============================================================
import type { EvidenceSource, ExtractedTransactionData, RiskLevel, VerificationFinding, Classification, TransactionStatus } from '../shared/types';
import type { TransactionType } from '../receipt-check/reading/receiptParser';
import { REF_FORMATS } from '../receipt-check/reading/fieldValidation';
import { checkReceiptDate } from '../receipt-check/checks/consistencyChecks';
import { matchAgainstHistory, type PriorScan } from '../receipt-check/checks/historyMatch';
import { clamp, scoreToRiskLevel, classificationOf, generateId, formatPHP } from '../shared/helpers';

export interface TransactionInput {
  institution: EvidenceSource;
  type: TransactionType;
  amount: number | null;
  /** YYYY-MM-DD */
  date: string | null;
  /** HH:MM (24-hour) */
  time: string | null;
  referenceNo: string | null;
  senderName: string | null;
  receiverName: string | null;
  receiverContact: string | null;
}

/** TRANSACTION + FRAUD_RESULT for a transaction entered by hand. */
export interface ManualTransaction {
  id: string;
  input: TransactionInput;
  findings: VerificationFinding[];
  riskScore: number;
  riskLevel: RiskLevel;
  classification: Classification;
  txStatus: TransactionStatus;
  txStatusAt?: string;
  /** when it was entered (also drives the 30-day expiry) */
  scannedAt: string;
}

const f = (id: string, label: string, detail: string, severity: RiskLevel, passed: boolean, weight: number): VerificationFinding =>
  ({ id, category: 'reference', label, detail, severity, passed, weight });

export function toExtracted(i: TransactionInput): ExtractedTransactionData {
  return {
    senderName: i.senderName, receiverName: i.receiverName, receiverContact: i.receiverContact, amount: i.amount,
    date: i.date, time: i.time, referenceNo: i.referenceNo, transactionId: null, institution: i.institution === 'Unknown' ? null : i.institution,
  };
}

export function checkTransaction(input: TransactionInput, history: PriorScan[], now = new Date()): ManualTransaction {
  const ref = input.referenceNo?.replace(/\s+/g, '') || null;
  const findings: VerificationFinding[] = [];
  let floor = 0;

  // reference
  if (!ref) findings.push(f('ref-present', 'Reference Number', 'No reference number was given. Every completed bank or e-wallet transfer has one; ask for it and look it up in your own account.', 'medium', false, 0.2));
  else {
    const fmt = REF_FORMATS[input.institution];
    if (fmt && !fmt.test(ref)) findings.push(f('ref-format', 'Reference Format', `“${ref}” does not have the shape of a ${input.institution} reference number. A made-up or mistyped number is a common sign of a fake payment claim.`, 'high', false, 0.35));
    else findings.push(f('ref-format', 'Reference Format', fmt ? `The reference has the usual ${input.institution} format.` : 'A reference number was given.', 'low', true, 0));
  }

  // amount
  if (input.amount == null) findings.push(f('amount', 'Amount', 'No amount was given.', 'medium', false, 0.1));
  else if (!(input.amount > 0)) findings.push(f('amount', 'Amount', 'The amount must be more than zero.', 'high', false, 0.3));

  // date and time
  const time12 = input.time ? to12h(input.time) : null;
  const date = checkReceiptDate(input.date, time12, now);
  if (date.status === 'future') { findings.push(f('date', 'Date and Time', date.detail.replace('This receipt is dated', 'This transaction is dated'), 'high', false, 0.45)); floor = Math.max(floor, 0.45); }
  else if (date.status === 'invalid') findings.push(f('date', 'Date and Time', 'The date or time is not a real calendar date or clock time.', 'high', false, 0.3));
  else if (date.status === 'unknown') findings.push(f('date', 'Date and Time', 'No date was given. Ask when the transfer was made, then find it in your own account by that date.', 'low', false, 0.05));
  else findings.push(f('date', 'Date and Time', 'The date is a real date and not in the future.', 'low', true, 0));


  // earlier checks on this device
  const hist = matchAgainstHistory(toExtracted({ ...input, referenceNo: ref }), history);
  if (hist.kind === 'edited-copy') { findings.push(f('history', 'Earlier Check Comparison', hist.detail, 'critical', false, 0.5)); floor = Math.max(floor, 0.45); }
  else if (hist.kind === 'same-moment') findings.push(f('history', 'Earlier Check Comparison', hist.detail, 'high', false, 0.3));
  else if (hist.kind === 'reused') findings.push(f('history', 'Earlier Check Comparison', `${hist.detail} The same payment cannot be claimed twice.`, 'medium', false, 0.25));

  const heuristic = clamp(findings.filter(x => !x.passed).reduce((s, x) => s + x.weight, 0), 0, 1);
  const riskScore = Math.max(heuristic, floor);
  const riskLevel = scoreToRiskLevel(riskScore);
  return {
    id: generateId('txn'), input: { ...input, referenceNo: ref }, findings, riskScore, riskLevel,
    classification: classificationOf(riskLevel), txStatus: 'pending', scannedAt: now.toISOString(),
  };
}

function to12h(t: string): string | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return t;
  const h = +m[1];
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** One line for lists: "GCash · ₱1,500.00 · ref 1016642566968". */
export function describeTransaction(i: TransactionInput): string {
  return [i.institution !== 'Unknown' ? i.institution : null, i.amount != null ? formatPHP(i.amount) : null, i.referenceNo ? `ref ${i.referenceNo}` : null].filter(Boolean).join(' · ') || 'Transaction';
}
