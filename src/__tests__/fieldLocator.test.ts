// Field highlights: mapping extracted values back to positioned OCR words.
import { describe, it, expect } from 'vitest';
import { locateFields } from '../services/fieldLocator';
import type { ExtractedTransactionData, OcrWord } from '../types';

const w = (text: string, x0: number, y0: number, x1: number, y1: number): OcrWord => ({ text, x0, y0, x1, y1 });
const base: ExtractedTransactionData = {
  senderName: null, receiverName: null, receiverContact: null, amount: null, date: null, time: null,
  referenceNo: null, transactionId: null, institution: null,
};
// Layout modelled on a GCash bank-transfer receipt (coordinates in image pixels)
const words: OcrWord[] = [
  w('JUAN', 300, 200, 380, 230), w('MIGUEL', 390, 200, 500, 230), w('DELA', 510, 200, 580, 230), w('CRUZ', 590, 200, 670, 230),
  w('Amount', 60, 400, 180, 425), w('3,500.00', 700, 400, 850, 425),
  w('Total', 60, 500, 150, 525), w('P', 690, 495, 705, 530), w('3,510.00', 710, 495, 880, 530),
  w('Ref', 60, 600, 110, 625), w('No.', 115, 600, 160, 625), w('1016', 400, 600, 470, 625), w('609', 480, 600, 530, 625), w('788969', 540, 600, 660, 625),
  w('Sep', 400, 700, 450, 725), w('24,', 455, 700, 490, 725), w('2026', 495, 700, 570, 725), w('4:18', 600, 700, 650, 725), w('PM', 655, 700, 690, 725),
];

describe('locateFields', () => {
  it('outlines the amount, the full spaced reference, the date and the recipient', () => {
    const boxes = locateFields(words, { ...base, amount: 3500, referenceNo: '1016609788969', date: 'Sep 24, 2026', receiverName: 'JUAN MIGUEL DELA CRUZ' });
    const by = Object.fromEntries(boxes.map(b => [b.key, b]));
    expect(by.amount).toMatchObject({ x0: 700, y0: 400, x1: 850, y1: 425 });
    expect(by.reference).toMatchObject({ x0: 400, x1: 660, y0: 600 });        // all three digit groups
    expect(by.date).toMatchObject({ x0: 400, x1: 570 });
    expect(by.recipient).toMatchObject({ x0: 300, x1: 670 });
  });
  it('does not outline the total when the amount is the principal', () => {
    const [box] = locateFields(words, { ...base, amount: 3500 });
    expect(box.y0).toBe(400);
  });
  it('outlines nothing for values that are not on the image (e.g. typed by the user)', () => {
    expect(locateFields(words, { ...base, amount: 9999, referenceNo: '5555555555555' })).toEqual([]);
  });
  it('skips masked names and copes with no words at all', () => {
    expect(locateFields(words, { ...base, receiverName: 'JU*N M. D.' })).toEqual([]);
    expect(locateFields(undefined, { ...base, amount: 3500 })).toEqual([]);
  });
});
