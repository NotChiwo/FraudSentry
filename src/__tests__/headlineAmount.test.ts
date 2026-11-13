// A GoTyme InstaPay receipt with a box reading "₱1000" pasted over the big
// "Sent ₱200.00" headline, while the Amount / Total rows still say ₱200.00,
// used to score Low ("No problems found"). Built from the real OCR of that
// screenshot; names, account digits and the reference are made up.
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { checkHeadlineAmount, readHeadlineAmount } from '../receipt-check/checks/consistencyChecks';
import { parseReceiptMulti } from '../receipt-check/reading/receiptParser';

const PASTED_HEADLINE = [
  '5:50 4                         RCN]\nX\nVv\nSent\n£1000\nNN}                      <Q                      ia\nRepeat            Add to favorites             Share\ninstaFay                                             Instant\nTo                        Juan\nOseeees1234\nG-Xchange, Inc (GCash)\nFrom                    r 3\nceeeeeee5678\nGoTyme Bank\nAmount                 £200.00\nFee                      £0.00\nTotal                     £200.00\nTrace ID               000030\nReference No.          1T0260101000000030\nDate                     22 Sep 2026 at 5:50 PM\nfd Get help                                               >',
  '5:50                          RCN]\nX\nSent\nP1000\nRepeat            Add to favorites             Share\ninstaPay                                             Instant\nTo                        Juan\nG-Xchange, Inc (GCash)\nFrom\nGoTyme Bank\nAmount                 P200.00\nFee                      P0.00\nTotal                     P200.00\nTrace ID               000030\nReference No.          IT0260101000000030\nDate                     22 Sep 2026 at 5:50 PM',
];

describe('headline amount vs. the detail rows', () => {
  it('flags a pasted headline that differs from the Amount / Total rows', () => {
    const amount = parseReceiptMulti(PASTED_HEADLINE).data.amount;
    expect(amount).toBe(200);
    const r = checkHeadlineAmount(PASTED_HEADLINE, amount);
    expect(r.status).toBe('mismatch');
    expect(r.headline).toBe(1000);
    expect(r.detail).toMatch(/top says ₱1,000\.00, but the receipt's own details say ₱200\.00/);
  });

  it('accepts a headline equal to the amount, the total, or amount + fee', () => {
    const t = (head: string) => [`Sent\n${head}\nAmount   P1,000.00\nFee   P15.00\nTotal   P1,015.00\nReference No. 123456789`];
    expect(checkHeadlineAmount(t('P1,000.00'), 1000).status).toBe('consistent');
    expect(checkHeadlineAmount(t('PHP 1,015.00'), 1000).status).toBe('consistent');
    expect(checkHeadlineAmount(t('P5,000.00'), 1000).status).toBe('mismatch');
  });

  it('never takes a bare number or a value below the first detail row as the headline', () => {
    expect(readHeadlineAmount('Paid\n400\nAmount  P2,000.00')).toBeNull();          // no currency sign
    expect(readHeadlineAmount('Amount\nP500.00\nTotal P500.00')).toBeNull();        // below a detail row
    expect(readHeadlineAmount('Trace ID\n000030')).toBeNull();
    expect(readHeadlineAmount('Sent\n£365.00\nAmount £365.00')).toBe(365);
    expect(readHeadlineAmount('Sent\nPHP 15,000.00\nAmount')).toBe(15000);
  });

  it('is unknown with no headline or no detail amount', () => {
    expect(checkHeadlineAmount(['Amount P200.00\nTotal P200.00'], 200).status).toBe('unknown');
    expect(checkHeadlineAmount(['Sent\nP200.00\nReference No. 1234'], null).status).toBe('unknown');
  });

  it('needs two passes to agree before it judges', () => {
    // one pass misreads the headline, the others read it right → consistent, not a false alarm
    const passes = ['Sent\nP100.00\nAmount P100.00\nTotal P100.00', 'Sent\nP700.00\nAmount P100.00\nTotal P100.00', 'Sent\nP100.00\nAmount P100.00\nTotal P100.00'];
    expect(checkHeadlineAmount(passes, 100).status).toBe('consistent');
  });

  it('raises no false alarm on any genuine receipt in the fixtures', () => {
    const dir = path.join(__dirname, 'fixtures');
    let checked = 0, consistent = 0;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, { passes?: string[] }>;
      for (const [name, v] of Object.entries(data)) {
        if (!v.passes) continue;
        const r = checkHeadlineAmount(v.passes, parseReceiptMulti(v.passes).data.amount);
        expect(r.status, name).not.toBe('mismatch');
        checked++; if (r.status === 'consistent') consistent++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(19);
    expect(consistent).toBeGreaterThanOrEqual(4);   // GoTyme ×3 and MariBank print a headline
  });
});
