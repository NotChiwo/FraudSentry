// A value OCR read THROUGH a blurred area is noise ("FRel fun Cruz A." from a
// pixelated name): it is not shown. Values in clear text next to a blur stay.
import { describe, it, expect } from 'vitest';
import { fieldsUnderBlur } from '../receipt-check/checks/hiddenFields';
import type { ExtractedTransactionData } from '../shared/types';

const w = (text: string, x0: number, y0: number) => ({ text, x0, y0, x1: x0 + 18 * text.length, y1: y0 + 24 });
// a GCash receipt: name, phone, amount, total, reference + date on one line
const words = [
  w('FRel', 200, 100), w('fun', 290, 100), w('Cruz', 360, 100), w('A.', 430, 100),
  w('+63', 200, 150), w('9•••••0449', 270, 150),
  w('Amount', 40, 300), w('215.00', 500, 300),
  w('Total', 40, 360), w('Amount', 140, 360), w('Sent', 260, 360), w('£21', 480, 360), w('500', 540, 360),
  w('Ref', 40, 450), w('No.', 100, 450), w('9904', 160, 450), w('Oct', 400, 450), w('04,', 470, 450), w('2026', 530, 450), w('12:26', 620, 450), w('PM', 720, 450),
];
const d: ExtractedTransactionData = { senderName: null, receiverName: 'FRel fun Cruz A.', receiverContact: '+63 9•••••0449', amount: 215, date: 'Oct 04, 2026', time: '12:26 PM', referenceNo: '9904', transactionId: null, institution: 'GCash' };
const nameBlur = { kind: 'pixelated' as const, x: 190, y: 95, w: 300, h: 36, tiles: 9 };
const totalBlur = { kind: 'pixelated' as const, x: 470, y: 355, w: 120, h: 34, tiles: 6 };
const refBlur = { kind: 'pixelated' as const, x: 150, y: 445, w: 90, h: 34, tiles: 5 };

describe('values read through a blur', () => {
  it('a pixelated name is not shown', () => {
    expect(fieldsUnderBlur([nameBlur], words, d)).toEqual(['receiverName']);
  });
  it('a blurred total does not hide the amount read clearly on the "Amount" line', () => {
    expect(fieldsUnderBlur([totalBlur], words, d)).toEqual([]);
  });
  it('a blurred reference hides the reference, not the date printed next to it', () => {
    expect(fieldsUnderBlur([refBlur], words, d)).toEqual(['referenceNo']);
  });
  it('no blur, nothing hidden', () => {
    expect(fieldsUnderBlur([], words, d)).toEqual([]);
  });
});

describe('a name another OCR pass read through the blur', () => {
  it('matches no clear text, with a blur above the amounts: not shown', () => {
    expect(fieldsUnderBlur([nameBlur], words, { ...d, receiverName: 'Elrmvngd 6,' })).toContain('receiverName');
  });
  it('a clear name with only the phone blurred stays', () => {
    const clearName = words.map(x => (x.text === 'FRel' ? { ...x, text: 'JUAN' } : x.text === 'fun' ? { ...x, text: 'DELA' } : x.text === 'Cruz' ? { ...x, text: 'CRUZ' } : x));
    const phoneBlur = { kind: 'pixelated' as const, x: 260, y: 145, w: 200, h: 34, tiles: 6 };
    expect(fieldsUnderBlur([phoneBlur], clearName, { ...d, receiverName: 'JUAN DELA CRUZ A.' })).toEqual(['receiverContact']);
  });
});
