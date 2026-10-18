// Internal-consistency checks: amount + fee = total, and no future-dated receipts.
// Genuine-receipt cases use the REAL redacted OCR fixtures; "edited" cases are
// those same fixtures with one figure changed, as a faker would do.
import { describe, it, expect } from 'vitest';
import fixtures from './fixtures/real-ocr-redacted.json';
import { parseReceiptMulti, parseReceipt } from '../services/receiptParser';
import { reconcileAmounts, readFeeAndTotal, correctPrincipal, checkReceiptDate, parseReceiptDate } from '../services/consistencyChecks';

type Fx = { filename: string; passes: string[] };
const fx = fixtures as Record<string, Fx>;
const NOW = new Date('2026-10-05T12:00:00+08:00');

function reconcile(passes: string[]) {
  return reconcileAmounts(passes, parseReceiptMulti(passes).data.amount);
}

describe('amount + fee = total (real receipts)', () => {
  it('GCash bank transfer 3,500.00 + fee 10.00 = total 3,510.00 reconciles', () => {
    const r = reconcile(fx.gcash_to_gotyme.passes);
    expect(r).toMatchObject({ status: 'consistent', amount: 3500, fee: 10, total: 3510 });
  });
  it('a waived fee ("PHP 15.00 FREE") counts as zero', () => {
    expect(readFeeAndTotal('Transfer Fee PHP 15.00 FREE\nTotal Amount PHP 500.00')).toEqual({ fee: 0, total: 500 });
    expect(reconcile(fx.maribank.passes).status).toBe('consistent');
  });
  it('"+Fee" read by OCR as "tFee" is still a fee', () => {
    expect(readFeeAndTotal('tFee 10.00\nTotal P 1,010.00')).toEqual({ fee: 10, total: 1010 });
  });
  it('no real fixture is flagged as a mismatch', () => {
    for (const k of Object.keys(fx)) expect(reconcile(fx[k].passes).status, k).not.toBe('mismatch');
  });
});

describe('amount + fee = total (edited receipts)', () => {
  it('amount edited from 3,500 to 8,500 but total left at 3,510 → mismatch', () => {
    const edited = fx.gcash_to_gotyme.passes.map(p => p.replace(/3,500\.00/g, '8,500.00'));
    const r = reconcile(edited);
    expect(r.status).toBe('mismatch');
    expect(r.detail).toMatch(/do not add up/);
  });
  it('total edited but amount left alone → mismatch', () => {
    const edited = fx.gcash_to_gotyme.passes.map(p => p.replace(/3,510\.00/g, '9,510.00'));
    expect(reconcile(edited).status).toBe('mismatch');
  });
  it('a misread in ONE of three passes does not raise it (needs a stable read)', () => {
    const p = [...fx.gcash_to_gotyme.passes];
    p[1] = p[1].replace(/3,510\.00/g, '3,518.00');
    expect(reconcile(p).status).toBe('consistent');
  });
  it('unknown when the receipt prints no fee / total', () => {
    expect(reconcile(fx.maya_purchase_numeric_ref.passes).status).toBe('unknown');
  });
});

describe('principal vs total', () => {
  it('a load receipt whose Amount row was missed reads the principal, not the total', () => {
    const text = 'Load Smart 1,000.00\nConvenience Fee (2%)   20.00\nTotal   P 1,020.00';
    expect(correctPrincipal([text], 1020)).toBe(1000);
    expect(parseReceipt(text).data.amount).toBe(1000);
  });
  it('leaves the amount alone when the principal is not printed anywhere', () => {
    expect(correctPrincipal(['Fee 20.00\nTotal 1,020.00'], 1020)).toBe(1020);
  });
});

describe('receipt date plausibility', () => {
  it('parses the date styles PH apps print', () => {
    for (const [d, t] of [['Sep 28, 2026', '2:32PM'], ['24 Sep 2026', '4:18 PM'], ['Sept 21, 2026', '08:47 PM'], ['09/28/2026', null], ['2026-09-28', '14:05']] as const) {
      expect(parseReceiptDate(d, t), d).toBeInstanceOf(Date);
    }
  });
  it('a past receipt is ok', () => {
    expect(checkReceiptDate('24 Sep 2026', '4:18 PM', NOW).status).toBe('ok');
  });
  it('a receipt dated next week is flagged as future', () => {
    const c = checkReceiptDate('Oct 12, 2026', '9:00 AM', NOW);
    expect(c.status).toBe('future');
    expect(c.detail).toMatch(/future/);
  });
  it('a few hours ahead (clock / time-zone skew) is tolerated', () => {
    expect(checkReceiptDate('Oct 5, 2026', '8:30 PM', NOW).status).toBe('ok');
    expect(checkReceiptDate('Oct 6, 2026', null, NOW).status).toBe('ok');
  });
  it('impossible dates and times are invalid', () => {
    expect(checkReceiptDate('Feb 30, 2026', null, NOW).status).toBe('invalid');
    expect(checkReceiptDate('Sep 12, 2026', '13:75', NOW).status).toBe('invalid');
  });
  it('unreadable / missing date → unknown (no finding)', () => {
    expect(checkReceiptDate(null, '11:01AM', NOW).status).toBe('unknown');
  });
  it('no real fixture is flagged', () => {
    for (const k of Object.keys(fx)) {
      const d = parseReceiptMulti(fx[k].passes).data;
      expect(['ok', 'unknown'], k).toContain(checkReceiptDate(d.date, d.time, NOW).status);
    }
  });
});

describe('reconciliation without a fee line (GCash Send Money layout)', () => {
  const gap = (n: number) => ' '.repeat(n);
  it('flags an edited total when no fee is printed (real OCR spacing)', () => {
    const pass = `Sent via GCash\nAmount${gap(54)}1,500.00\nTotal Amount Sent${gap(25)}P15000.00`;
    expect(reconcileAmounts([pass, pass, pass.replace('P15000', '£15000')], 1500).status).toBe('mismatch');
  });
  it('flags a total below the amount', () => {
    expect(reconcileAmounts(['Amount 2,000.00\nTotal Amount Sent ₱200.00'], 2000).status).toBe('mismatch');
  });
  it('a small gap may be an unread fee — not flagged', () => {
    expect(reconcileAmounts(['Amount 500.00\nTotal 515.00'], 500).status).toBe('unknown');
  });
  it('amount = total with no fee is not flagged', () => {
    expect(reconcileAmounts(['Amount 160.00\nTotal Amount Sent ₱160.00'], 160).status).toBe('unknown');
  });
  it('is not judged when the amount is not on an "Amount" row (parser fallback)', () => {
    expect(reconcileAmounts(['Paid 1,500.00\nTotal 9,000.00'], 1500).status).toBe('unknown');
  });
});
