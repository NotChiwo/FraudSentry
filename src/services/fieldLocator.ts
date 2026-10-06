// ============================================================
// FraudSentry — where on the screenshot was each field read?
//
// Maps the extracted values (amount, reference, date, recipient) back to
// the positioned words Tesseract returned for the ORIGINAL image (pass 1),
// so the result screen can outline them on the receipt. Purely visual: it
// never changes a value or a score. If a value can't be located (it came
// from a different OCR pass, or was typed in by the user) it is simply not
// outlined.
// ============================================================

import type { ExtractedTransactionData, OcrWord } from '../types';

export type FieldKey = 'amount' | 'reference' | 'date' | 'recipient';
export interface FieldBox { key: FieldKey; label: string; x0: number; y0: number; x1: number; y1: number }

const digits = (s: string) => s.replace(/\D/g, '');
const sameLine = (a: OcrWord, b: OcrWord) => {
  const h = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return overlap > h * 0.5;
};
const union = (ws: OcrWord[]) => ({
  x0: Math.min(...ws.map(w => w.x0)), y0: Math.min(...ws.map(w => w.y0)),
  x1: Math.max(...ws.map(w => w.x1)), y1: Math.max(...ws.map(w => w.y1)),
});

/** Group words into lines (reading order), keeping only the given candidates. */
function lines(cands: OcrWord[]): OcrWord[][] {
  const out: OcrWord[][] = [];
  for (const w of [...cands].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const line = out.find(l => sameLine(l[0], w));
    if (line) line.push(w); else out.push([w]);
  }
  return out;
}

function locateReference(words: OcrWord[], ref: string | null): OcrWord[] | null {
  const rd = ref ? digits(ref) : '';
  if (rd.length < 6) return null;
  const cands = words.filter(w => { const d = digits(w.text); return d.length >= 3 && rd.includes(d); });
  let best: OcrWord[] | null = null, bestLen = 0;
  for (const l of lines(cands)) {
    const len = l.reduce((s, w) => s + digits(w.text).length, 0);
    if (len > bestLen) { best = l; bestLen = len; }
  }
  // require most of the reference to be visible in one line
  return best && bestLen >= Math.min(rd.length, 6) ? best : null;
}

function locateAmount(words: OcrWord[], amount: number | null): OcrWord[] | null {
  if (amount == null) return null;
  const target = amount.toFixed(2);
  const hits = words.filter(w => {
    const t = w.text.replace(/^(php|₱|p|£|-)+/i, '').replace(/,/g, '');
    return t === target;
  });
  if (!hits.length) return null;
  // the biggest print of the amount is the headline figure
  return [hits.sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0))[0]];
}

function locateTokens(words: OcrWord[], value: string | null, minLen: number): OcrWord[] | null {
  if (!value) return null;
  const toks = value.toLowerCase().split(/[\s,]+/).filter(t => t.length >= minLen);
  if (!toks.length) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cands = words.filter(w => toks.some(t => norm(w.text) && norm(w.text) === norm(t)));
  let best: OcrWord[] | null = null;
  for (const l of lines(cands)) if (!best || l.length > best.length) best = l;
  return best && best.length >= Math.min(2, toks.length) ? best : null;
}

export function locateFields(words: OcrWord[] | undefined, d: ExtractedTransactionData): FieldBox[] {
  if (!words?.length) return [];
  const out: FieldBox[] = [];
  const add = (key: FieldKey, label: string, ws: OcrWord[] | null) => { if (ws?.length) out.push({ key, label, ...union(ws) }); };
  add('amount', 'Amount', locateAmount(words, d.amount));
  add('reference', 'Reference', locateReference(words, d.referenceNo));
  add('date', 'Date', locateTokens(words, d.date, 2));
  add('recipient', 'Recipient', locateTokens(words, d.receiverName && !/[.*•]/.test(d.receiverName) ? d.receiverName : null, 3));
  return out;
}
