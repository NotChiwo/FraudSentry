// Masked names are shown the way the app printed them: asterisks for MariBank /
// InstaPay ("Ma*a Sa***s L."), bullets for GCash ("JU•••N D.") — not letters
// OCR made up, and not OCR noise from a photo's background.
import { describe, it, expect } from 'vitest';
import { parseReceipt, parseReceiptMulti, readMaskedName, gcashBullets } from '../receipt-check/reading/receiptParser';

describe('asterisk masks (MariBank / InstaPay)', () => {
  it('a quote mark OCR read for an asterisk becomes the asterisk again', () => {
    expect(readMaskedName('Ma“a Sa***sL')).toBe('Ma*a Sa***s L');
    expect(readMaskedName('Ma*a Sa"sL.')).toBe('Ma*a Sa*s L.');
    // (applied only to the value next to a To/From label, where an apostrophe is not expected)
  });
  it('from the OCR passes of a photographed MariBank receipt', () => {
    const passes = [
      'Transfer Result\nTransfer Successful!\nFrom PEDRO SANTOSS\n\\      To                      3 Ma“a Sa***sL\n1         |                    Acct No.: KPRTXV7BM   QWHZC2\nPHP 1,000.00\nReference Number   604217',
      'MariBank: 10450091237\ni.          To                                       0 Maa Sa***sL.\nG-Xchange / GCash\nPHP 1,000.00',
    ];
    expect(parseReceiptMulti(passes, 'photo.jpg').data.receiverName).toBe('Ma*a Sa***s L');
  });
  it('OCR noise from the background is not taken as the name', () => {
    const r = parseReceipt('MariBank\nTransfer Result\nTo\nAao NG DINOMA TA DNA AA NA\nPHP 1,000.00');
    expect(r.data.receiverName).toBeNull();
  });
});

describe('bullet masks (GCash)', () => {
  it('"+", "..." and "---" inside an uppercase name are the bullets', () => {
    expect(gcashBullets('JU+++N D.')).toBe('JU•••N D.');
    expect(gcashBullets('MA...O R.')).toBe('MA•••O R.');
    expect(gcashBullets('JU---N D.')).toBe('JU•••N D.');
    expect(gcashBullets('JUAN D.')).toBe('JUAN D.');
  });
  it('a pass that dropped the bullets loses to the one that kept them', () => {
    const passes = ['JU+++N D.\n0917 000 1234\nSent via GCash\nAmount 95.00\nTotal Amount Sent P95.00\nRef No. 1016 642 566968', 'JUN D.\n0917 000 1234\nSent via GCash\nAmount 95.00\nRef No. 1016 642 566968'];
    expect(parseReceiptMulti(passes).data.receiverName).toBe('JU•••N D.');
  });
});

describe('recipient account across passes', () => {
  it('when every pass read it differently, the most complete reading wins', () => {
    const passes = [
      'MariBank\nTo                 Ma*a Sa***s L.\nAcct No.: KPRTXV7BM   QWHZC2\nPHP 1,000.00',
      'MariBank\nTo                 Ma*a Sa***s L.\nAcct No.: KPRTXV7BMLQWHZC2\nPHP 1,000.00',
    ];
    expect(parseReceiptMulti(passes).data.receiverContact).toBe('KPRTXV7BMLQWHZC2');
  });
});
