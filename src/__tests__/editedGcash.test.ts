// A GCash Express Send screenshot with the total amount and the end of the
// reference number pixelated used to pass as Low ("names blurred for
// privacy"). Built from the OCR of that screenshot; names and numbers are made up.
import { describe, it, expect } from 'vitest';
import { assessHiddenFields } from '../receipt-check/checks/hiddenFields';
import { parseReceipt, parseReceiptMulti } from '../receipt-check/reading/receiptParser';
import type { ExtractedTransactionData } from '../shared/types';

const EDITED = [
  'X                  Express Send\nJUeN Doo T.\n+63 GooooeC =\nSent via GCash\nAmount                                               150.00\nTotal Amount Sent         £1 { a ma\nRef No. 1016 642 56s =i\nOct 27, 2026 1:03 PM\nBy going digital, you reduce your carbon footprint\nfrom transportation, paper, and plastic.\n(1) Download',
  'Xx                Express Send\nJUeN Doo T.\n+63 Qoooo0f" =\neet Yar Ta 1n\nAmount                                        150.00\nTotal Amount Sent         P1 r - =\nRef No. 1016 642 56a mA\nOct 27, 2026 1:03 PM\nBy going digital, you reduce your carbon footprint\nfrom transportation, paper, and plastic.\n(4) Download',
  'xX                 Express Send\nJUeN Doo T.\n+63 Qesseeld =\nERLE ETA ana\nAmount                                150.00\nTotal Amount Sent         P122\nRef No. 1016 642 564 wit\nOct 27, 2026 1:03 PM\nfrom transportation, paper, and plastic\n( Download',
];
const ext = (o: Partial<ExtractedTransactionData> = {}): ExtractedTransactionData => ({ senderName: null, receiverName: 'JU•N D•• T.', receiverContact: null, amount: 150, date: 'Oct 27, 2026', time: '1:03 PM', referenceNo: '101664256', transactionId: null, institution: 'GCash', ...o });
const w = (text: string, x0: number, y0: number) => ({ text, x0, y0, x1: x0 + 18 * text.length, y1: y0 + 24 });

describe('blocked-out total and cut-short reference', () => {
  it('"Total Amount Sent" with junk after it is a hidden amount', () => {
    const h = assessHiddenFields(EDITED, undefined, '101664256', [], ext(), false);
    expect(h.totalUnreadable).toBe(true);
    expect(h.detail).toMatch(/Total Amount Sent" label is visible, but the amount after it cannot be read/);
  });
  it('a reference too short for GCash with junk after the digits is cut short', () => {
    const h = assessHiddenFields(EDITED, undefined, '101664256', [], ext(), false);
    expect(h.referenceIncomplete).toBe(true);
    expect(assessHiddenFields(EDITED, undefined, '101664256', [], ext(), true).referenceIncomplete).toBe(false);
  });
  it('with only the phone blurred, the result is never "privacy" while the total or reference is hidden', () => {
    const words = [w('Amount', 40, 400), w('150.00', 500, 400), w('Total', 40, 470), w('Amount', 140, 470), w('Sent', 260, 470)];
    const h = assessHiddenFields(EDITED, words, '101664256', [{ kind: 'pixelated', x: 300, y: 300, w: 60, h: 24, tiles: 5 }], ext(), false);
    expect(h.privacyOnly).toBe(false);
  });
  it('a clean total is not hidden', () => {
    const genuine = ['JU•••N D.\n0917 000 1234\nAmount   95.00\nTotal Amount Sent   £95.00\nRef No. 1016 642 566968\nApr 13, 2024 9:23 pm'];
    expect(assessHiddenFields(genuine, undefined, '1016642566968', [], ext({ referenceNo: '1016642566968' }), true)).toMatchObject({ totalUnreadable: false, referenceIncomplete: false });
  });
});

describe('a blurred name or number above the amounts on a GCash receipt is privacy', () => {
  it('even when OCR could not place the reference and date lines', () => {
    const words = [w('Amount', 40, 273), w('95.00', 250, 273), w('Total', 40, 320), w('Amount', 140, 320), w('Sent', 260, 320), w('£95.00', 400, 320)];
    const genuine = ['Il ==\n0917 000 1234\nAmount   95.00\nTotal Amount Sent   £95.00\nRef No. 1016 642 566968\nApr 13, 2024 9:23 pm'];
    const h = assessHiddenFields(genuine, words, '1016642566968', [{ kind: 'pixelated', x: 168, y: 120, w: 24, h: 48, tiles: 3 }], ext({ referenceNo: '1016642566968', receiverName: null }), true);
    expect(h.privacyOnly).toBe(true);
  });
});

describe('names on this layout', () => {
  it('the carbon-footprint sentence and the Download button are not a sender', () => {
    for (const t of EDITED) expect(parseReceipt(t).data.senderName).toBeNull();
  });
  it('the recipient is the top line of the block, not a garbled "Sent via GCash"', () => {
    expect(parseReceiptMulti(EDITED).data.receiverName).toBe('JU•N D•• T.');
    expect(parseReceipt(EDITED[2]).data.receiverName).toBe('JU•N D•• T.');
  });
});
