// A name OCR guessed out of a pixelated line is hidden, even when the blur
// detector missed the pixelation; a genuine name never is.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { nameLooksGarbled } from '../receipt-check/checks/hiddenFields';
import { parseReceiptMulti } from '../receipt-check/reading/receiptParser';

// OCR passes of a GCash receipt whose name line was pixelated (surname replaced)
const PIXELATED = [
  'Ir Rel"  IL ® ny Cruz A.\n+63 fmecee4O] 2\n\nAmount   215.00\nTotal Amount Sent   £21 500\nRef No. "Bf “Ew 9904 Bb    Oct 04, 2026 12:26 PM',
  'FRelv “Tu. Cruz A.\n+63 mee e040] ia\n\nAmount   215.00\nTotal Amount Sent   P215.00\nRef No." I" w990 Bb      Oct 04, 2026 12:26 PM',
  'FRel  iL =" Cruz A.\n+63 (o.0449 2\nSent via GCash\nAmount   215.00\nTotal Amount Sent   £215.00\nRef No. "nl "Bw 9906 Bb     Oct 04,2026 12:26 PM',
];

describe('garbled names', () => {
  it('the pixelated name line: junk symbols in its reads', () => {
    expect(nameLooksGarbled(PIXELATED, 'FRel fun Cruz A.')).toBe(true);
    expect(nameLooksGarbled(PIXELATED, 'Cruz A.')).toBe(true);
  });
  it('letter-case no name has', () => {
    expect(nameLooksGarbled(['FRel fun Cruz A.'], 'FRel fun Cruz A.')).toBe(true);
    expect(nameLooksGarbled(['Juan iL Cruz'], 'Juan iL Cruz')).toBe(true);
  });
  it('masked and ordinary names are not garbled', () => {
    for (const [t, n] of [
      ['JU•••N D.\n+63 917 000 1234', 'JU•••N D.'], ['To   Ma“a Sa***sL', 'Ma*a Sa***s L'], ['Transfer to\nJuan (QR Code)', 'Juan'],
      ['Account Name   Juan Dela Cruz', 'Juan Dela Cruz'], ['Paid to McDonald Santos', 'McDonald Santos'], ['PEDRO SANTOS R.', 'PEDRO SANTOS R.'],
    ]) expect(nameLooksGarbled([t], n), n).toBe(false);
  });
  it('never fires on a genuine name in the real-receipt fixtures', () => {
    // where the value read is itself OCR noise, hiding it is right: GoTyme prints the
    // sender as "JOHN" + masking dots, which OCR reads as "yun punan" / "yoooeee press"
    const noise = new Set(['real-ocr-redacted-2.json:gotyme_paid_psa:sender']);
    const dir = path.join(__dirname, 'fixtures');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, { passes: string[]; filename?: string }>;
      for (const [k, v] of Object.entries(fx)) {
        if (/blurred|pixelated|edited/.test(k)) continue;
        const d = parseReceiptMulti(v.passes, v.filename ?? '').data;
        expect(nameLooksGarbled(v.passes, d.receiverName), `${f}:${k} receiver ${d.receiverName}`).toBe(noise.has(`${f}:${k}:receiver`));
        expect(nameLooksGarbled(v.passes, d.senderName), `${f}:${k} sender ${d.senderName}`).toBe(noise.has(`${f}:${k}:sender`));
      }
    }
  });
});

describe('a GCash name line that reads as junk', () => {
  it('is a pixelated name (shown as unreadable, not "not detected")', async () => {
    const { walletNameLineGarbled } = await import('../receipt-check/checks/hiddenFields');
    expect(walletNameLineGarbled(PIXELATED)).toBe(true);
    expect(walletNameLineGarbled(['JU•••N D.\n+63 917 000 1234\nSent via GCash'])).toBe(false);
  });
});
