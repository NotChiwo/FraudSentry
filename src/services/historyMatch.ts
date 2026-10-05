// ============================================================
// FraudSentry — compare a receipt against EARLIER scans (this device only)
//
// Fakers rarely build a receipt from scratch; they take one genuine
// receipt and keep re-sending it, or edit its amount and send it again.
// Comparing the new receipt's fields with the local scan history catches:
//   • edited copy — same reference number, different amount
//   • same moment — same recipient and same date+time to the minute,
//                   but a different reference or amount
//   • reused      — same reference AND same amount (often just the user
//                   re-checking the same file, so informational only)
// Uses the fields already kept in local history; nothing leaves the device.
// ============================================================

import { ExtractedTransactionData } from '../types';

export interface PriorScan {
  id: string;
  filename: string;
  scannedAt: string;
  extracted: ExtractedTransactionData;
}

export interface HistoryMatch {
  kind: 'none' | 'reused' | 'edited-copy' | 'same-moment';
  prior: PriorScan | null;
  detail: string;
}

const cleanRef = (r: string | null) => (r ? r.replace(/\s/g, '').toUpperCase() : '');
const cleanName = (n: string | null) => (n ? n.toUpperCase().replace(/[^A-Z]/g, '') : '');
/** "02:02:13 AM" → "2:02am" — to the minute, so OCR'd seconds don't matter. */
function cleanTime(t: string | null): string {
  const m = (t || '').toLowerCase().match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/);
  return m ? `${+m[1]}:${m[2]}${m[3] || ''}` : '';
}

/** Same reference, allowing ONE differing character on long refs (an OCR misread). */
export function sameReference(a: string | null, b: string | null): boolean {
  const x = cleanRef(a), y = cleanRef(b);
  if (x.length < 6 || y.length < 6) return false;
  if (x === y) return true;
  if (x.length !== y.length || x.length < 10) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && ++diff > 1) return false;
  return true;
}

const php = (n: number | null) => (n == null ? 'an unread amount' : `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
const when = (s: string) => { const d = new Date(s); return isNaN(+d) ? 'earlier' : d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }); };

export function matchAgainstHistory(current: ExtractedTransactionData, history: PriorScan[]): HistoryMatch {
  const none: HistoryMatch = { kind: 'none', prior: null, detail: '' };
  if (!history.length) return none;

  // 1. Same reference number
  const byRef = history.find(h => sameReference(h.extracted.referenceNo, current.referenceNo));
  if (byRef) {
    const a = current.amount, b = byRef.extracted.amount;
    if (a != null && b != null && Math.abs(a - b) >= 0.01) {
      return { kind: 'edited-copy', prior: byRef,
        detail: `This receipt has the same reference number as one scanned ${when(byRef.scannedAt)} ("${byRef.filename}"), but a different amount: ${php(a)} now vs ${php(b)} then. A reference number belongs to exactly one transaction, so one of the two receipts has been edited.` };
    }
    return { kind: 'reused', prior: byRef,
      detail: `The same receipt (reference ${cleanRef(current.referenceNo)}${a != null ? `, ${php(a)}` : ''}) was already scanned ${when(byRef.scannedAt)} ("${byRef.filename}"). If you are just re-checking it, ignore this; if someone sent it to you again as proof of a NEW payment, it is not.` };
  }

  // 2. Same recipient at the same minute, different figures
  const name = cleanName(current.receiverName), t = cleanTime(current.time);
  if (name.length >= 4 && current.date && t) {
    const byMoment = history.find(h =>
      cleanName(h.extracted.receiverName) === name &&
      (h.extracted.date || '').replace(/\s/g, '').toLowerCase() === current.date!.replace(/\s/g, '').toLowerCase() &&
      cleanTime(h.extracted.time) === t &&
      ((current.amount != null && h.extracted.amount != null && Math.abs(current.amount - h.extracted.amount) >= 0.01) ||
       (!!current.referenceNo && !!h.extracted.referenceNo && !sameReference(current.referenceNo, h.extracted.referenceNo))));
    if (byMoment) {
      return { kind: 'same-moment', prior: byMoment,
        detail: `A receipt scanned ${when(byMoment.scannedAt)} ("${byMoment.filename}") shows the same recipient at exactly the same date and minute (${current.date} ${current.time}), but with different figures (${php(current.amount)} vs ${php(byMoment.extracted.amount)}). Two separate transfers in the same minute are possible but unusual — this pattern also fits one receipt edited into two.` };
    }
  }
  return none;
}
