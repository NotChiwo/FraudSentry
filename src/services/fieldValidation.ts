// ============================================================
// Field validation — looks at every extracted field and judges, from the raw
// OCR text, whether it is (a) present, (b) cross-checked against another part of
// the receipt, or (c) likely a mis-read that the user should review. This is the
// honest layer: OCR is imperfect, so instead of showing every field with equal
// confidence, we tell the user which ones are solid and which need a second look.
//
// Each field also gets a read CONFIDENCE (high / medium / low), derived from two
// real signals: whether the value has a valid format, and how many of the OCR
// image passes read the exact same value ("agreement").
// ============================================================
import { ExtractedTransactionData, EvidenceSource } from '../types';
import { parseReceipt } from './receiptParser';

export type FieldStatus = 'verified' | 'present' | 'review' | 'missing';
export type FieldConfidence = 'high' | 'medium' | 'low' | 'na';

export interface FieldCheck {
  key: string;
  label: string;
  value: string | null;
  status: FieldStatus;
  confidence: FieldConfidence;
  /** share of OCR passes (0–1) that read this exact value; null if not measurable */
  agreement: number | null;
  note: string;
}

export interface ValidationSummary {
  checks: FieldCheck[];
  verified: number;
  present: number;
  review: number;
  missing: number;
}

// Reference-number shape per platform (helps confirm a real reference vs noise).
export const REF_FORMATS: Partial<Record<EvidenceSource, RegExp>> = {
  GCash: /^\d{13}$/,
  MariBank: /^\d{6,16}$/,
  SeaBank: /^\d{6,18}$/,
  Maya: /^[A-Z0-9]{8,20}$/i,
  GoTyme: /^[A-Z0-9]{8,20}$/i,
  BPI: /^[A-Z0-9]{8,20}$/i,
  BDO: /^[A-Z0-9]{8,20}$/i,
  CIMB: /^[A-Z0-9]{8,20}$/i,
};

function money(text: string): number[] {
  return [...text.matchAll(/(?:php|₱|p)?\s*([\d,]+\.\d{2})/gi)]
    .map(m => parseFloat(m[1].replace(/,/g, '')))
    .filter(n => !isNaN(n) && n > 0);
}

const isPhMobile = (s: string) => /(?:\+?63|0)[\s-]?9[\d•*\s-]{8,}/.test(s);
const isTime = (s: string) => /\b\d{1,2}:\d{2}\s*(?:[AP]\.?M\.?)?\b/i.test(s);
const isDate = (s: string) =>
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}/i.test(s)
  || /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(s)
  || /\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/.test(s)
  // "24 Sep 2026" (GoTyme) — the parser extracts this form too
  || /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*\d{4}/i.test(s);

type AgreementKey = 'senderName' | 'receiverName' | 'receiverContact' | 'amount' | 'date' | 'time' | 'referenceNo' | 'transactionId';

function normalise(key: AgreementKey, v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (key === 'amount') { const n = parseFloat(s.replace(/[^\d.]/g, '')); return isNaN(n) ? '' : n.toFixed(2); }
  if (key === 'referenceNo' || key === 'receiverContact' || key === 'transactionId') return s.replace(/\D/g, '');
  return s.replace(/\s+/g, '').toLowerCase();
}

// For each field: what fraction of the individual OCR passes read the same
// value as the final merged result.
function passAgreement(passes: string[] | undefined, data: ExtractedTransactionData): Record<AgreementKey, number> | null {
  const list = (passes || []).filter(p => p && p.trim().length > 0);
  if (list.length < 2) return null;
  const perPass = list.map(p => parseReceipt(p).data);
  const keys: AgreementKey[] = ['senderName', 'receiverName', 'receiverContact', 'amount', 'date', 'time', 'referenceNo', 'transactionId'];
  const out = {} as Record<AgreementKey, number>;
  for (const k of keys) {
    const target = normalise(k, data[k]);
    out[k] = target ? perPass.filter(d => normalise(k, d[k]) === target).length / list.length : 0;
  }
  return out;
}

function confidenceFrom(formatOk: boolean, agreement: number | null): FieldConfidence {
  if (agreement == null) return formatOk ? 'medium' : 'low';
  if (formatOk && agreement >= 0.66) return 'high';
  if (agreement >= 0.5 || formatOk) return 'medium';
  return 'low';
}

function nameCheck(key: string, label: string, value: string | null, agreement: number | null): FieldCheck {
  if (!value) return { key, label, value, status: 'missing', confidence: 'na', agreement, note: 'Not detected on the receipt.' };
  const t = value.trim();
  if (/\d{3,}/.test(t)) return { key, label, value, status: 'review', confidence: 'low', agreement, note: 'Contains a long number — likely picked up the wrong line.' };
  const masked = /[•*]/.test(t);
  const wellFormed = /\s/.test(t) || /\.$/.test(t) || masked || t.length <= 4;
  if (!wellFormed && /^[A-Za-z]{5,}$/.test(t)) {
    return { key, label, value, status: 'review', confidence: 'low', agreement, note: 'One run of letters with no spaces — OCR may have merged or dropped characters. Please check.' };
  }
  // A name can never be "verified" — we cannot confirm spelling — but a
  // well-formed one is reported as present with a gentle reminder.
  const confidence: FieldConfidence = masked || (agreement != null && agreement >= 0.66) ? 'medium'
    : agreement != null && agreement < 0.34 ? 'low' : 'medium';
  return { key, label, value, status: 'present', confidence, agreement,
    note: masked ? 'Masked by the sender for privacy — shown as printed.' : 'Detected. OCR can misread names — confirm the spelling if it matters.' };
}

export function validateExtraction(
  data: ExtractedTransactionData,
  rawText: string,
  source: EvidenceSource,
  passes?: string[],
): ValidationSummary {
  const text = rawText || '';
  const monies = money(text);
  const checks: FieldCheck[] = [];
  const agree = passAgreement(passes, data);
  const ag = (k: AgreementKey) => (agree ? agree[k] ?? 0 : null);

  checks.push(nameCheck('senderName', 'Sender', data.senderName, ag('senderName')));
  checks.push(nameCheck('receiverName', 'Receiver', data.receiverName, ag('receiverName')));

  // Receiver contact (phone) — absent on bank-transfer receipts, which is normal.
  if (data.receiverContact) {
    const valid = isPhMobile(data.receiverContact);
    const masked = /•/.test(data.receiverContact);
    checks.push({
      key: 'receiverContact', label: 'Receiver No.', value: data.receiverContact,
      status: valid ? 'present' : 'review',
      confidence: masked ? 'medium' : confidenceFrom(valid, ag('receiverContact')),
      agreement: ag('receiverContact'),
      note: masked ? 'Partly masked by the platform — shown as printed.' : valid ? 'Valid PH mobile-number format.' : 'Does not look like a PH mobile number — please check.',
    });
  } else {
    checks.push({ key: 'receiverContact', label: 'Receiver No.', value: null, status: 'missing', confidence: 'na', agreement: null, note: 'Not shown on this receipt type (normal for bank transfers).' });
  }

  // Amount — cross-checked against every money value on the receipt.
  if (data.amount != null) {
    const hits = monies.filter(v => Math.abs(v - data.amount!) < 0.01).length;
    const a = ag('amount');
    if (hits >= 2) checks.push({ key: 'amount', label: 'Amount', value: `₱${data.amount.toFixed(2)}`, status: 'verified', confidence: 'high', agreement: a, note: `Matches ${hits} lines on the receipt (e.g. Transfer + Total) — strong agreement.` });
    else checks.push({ key: 'amount', label: 'Amount', value: `₱${data.amount.toFixed(2)}`, status: 'present', confidence: confidenceFrom(true, a), agreement: a, note: a != null && a >= 0.66 ? 'Read consistently across image passes.' : 'Found once; limited cross-checking.' });
  } else {
    checks.push({ key: 'amount', label: 'Amount', value: null, status: 'missing', confidence: 'na', agreement: null, note: 'No amount detected.' });
  }

  // Date / Time
  if (data.date) {
    const ok = isDate(data.date);
    checks.push({ key: 'date', label: 'Date', value: data.date, status: ok ? 'present' : 'review', confidence: confidenceFrom(ok, ag('date')), agreement: ag('date'), note: ok ? 'Recognised date format.' : 'Unusual date format — please check.' });
  } else {
    checks.push({ key: 'date', label: 'Date', value: null, status: 'missing', confidence: 'na', agreement: null, note: 'Not detected.' });
  }
  if (data.time) {
    const ok = isTime(data.time);
    checks.push({ key: 'time', label: 'Time', value: data.time, status: ok ? 'present' : 'review', confidence: confidenceFrom(ok, ag('time')), agreement: ag('time'), note: ok ? 'Recognised time format.' : 'Unusual time format — please check.' });
  } else {
    checks.push({ key: 'time', label: 'Time', value: null, status: 'missing', confidence: 'na', agreement: null, note: 'Not detected.' });
  }

  // Reference number — checked against the platform's known format.
  if (data.referenceNo) {
    const fmt = REF_FORMATS[source];
    const ref = data.referenceNo.replace(/\s/g, '');
    const a = ag('referenceNo');
    if (fmt && fmt.test(ref)) checks.push({ key: 'referenceNo', label: 'Reference No.', value: data.referenceNo, status: 'verified', confidence: confidenceFrom(true, a), agreement: a, note: `Length & pattern match a ${source} reference. Still confirm it in your own app.` });
    else if (/^[A-Z0-9]{6,24}$/i.test(ref)) checks.push({ key: 'referenceNo', label: 'Reference No.', value: data.referenceNo, status: 'present', confidence: confidenceFrom(false, a), agreement: a, note: 'Plausible reference format — confirm it in your own app.' });
    else checks.push({ key: 'referenceNo', label: 'Reference No.', value: data.referenceNo, status: 'review', confidence: 'low', agreement: a, note: 'Unusual format — verify against your own records.' });
  } else {
    checks.push({ key: 'referenceNo', label: 'Reference No.', value: null, status: 'missing', confidence: 'na', agreement: null, note: 'No reference number detected.' });
  }

  // Transaction ID (optional on most receipts)
  checks.push(data.transactionId
    ? { key: 'transactionId', label: 'Transaction ID', value: data.transactionId, status: 'present', confidence: confidenceFrom(true, ag('transactionId')), agreement: ag('transactionId'), note: 'Detected.' }
    : { key: 'transactionId', label: 'Transaction ID', value: null, status: 'missing', confidence: 'na', agreement: null, note: 'Not shown on this receipt (often normal).' });

  // Institution
  if (source && source !== 'Unknown') checks.push({ key: 'institution', label: 'Institution', value: source, status: 'verified', confidence: 'high', agreement: null, note: 'Platform identified from the receipt.' });
  else checks.push({ key: 'institution', label: 'Institution', value: null, status: 'review', confidence: 'low', agreement: null, note: 'Could not identify the platform with confidence.' });

  const count = (s: FieldStatus) => checks.filter(c => c.status === s).length;
  return { checks, verified: count('verified'), present: count('present'), review: count('review'), missing: count('missing') };
}
