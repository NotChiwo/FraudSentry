// Comparing a receipt with earlier scans: reused receipt vs edited copy.
import { describe, it, expect } from 'vitest';
import fixtures from './fixtures/real-ocr-redacted.json';
import { parseReceiptMulti } from '../services/receiptParser';
import { matchAgainstHistory, sameReference, PriorScan } from '../services/historyMatch';
import { ExtractedTransactionData } from '../types';

type Fx = { filename: string; passes: string[] };
const fx = fixtures as Record<string, Fx>;
const read = (k: string, edit?: (p: string) => string) =>
  parseReceiptMulti(edit ? fx[k].passes.map(edit) : fx[k].passes, fx[k].filename).data;
const prior = (k: string, extracted: ExtractedTransactionData): PriorScan =>
  ({ id: k, filename: `${k}.jpg`, scannedAt: '2026-10-01T09:00:00+08:00', extracted });

const allPriors = () => Object.keys(fx).map(k => prior(k, read(k)));

describe('reference matching', () => {
  it('tolerates one misread digit on long references only', () => {
    expect(sameReference('1016609788969', '1016609788969')).toBe(true);
    expect(sameReference('1016609788969', '1016609788960')).toBe(true);
    expect(sameReference('1016609788969', '1016609788000')).toBe(false);
    expect(sameReference('000002', '000003')).toBe(false); // short GoTyme Trace-ID style
  });
});

describe('earlier-scan comparison (real receipts)', () => {
  it('nothing in history → no match', () => {
    expect(matchAgainstHistory(read('gcash_to_gotyme'), []).kind).toBe('none');
  });
  it('the same receipt scanned again → reused (informational)', () => {
    const m = matchAgainstHistory(read('gcash_to_gotyme'), allPriors());
    expect(m.kind).toBe('reused');
    expect(m.prior?.id).toBe('gcash_to_gotyme');
  });
  it('the same receipt with its amount edited → edited copy', () => {
    const edited = read('gcash_to_gotyme', p => p.replace(/3,500\.00/g, '8,500.00').replace(/3,510\.00/g, '8,510.00'));
    expect(edited.amount).toBe(8500);
    const m = matchAgainstHistory(edited, allPriors());
    expect(m.kind).toBe('edited-copy');
    expect(m.detail).toMatch(/same reference number/);
  });
  it('the 8 distinct real receipts never match each other', () => {
    for (const k of Object.keys(fx)) {
      const others = allPriors().filter(p => p.id !== k);
      expect(matchAgainstHistory(read(k), others).kind, k).toBe('none');
    }
  });
});

describe('same recipient, same minute', () => {
  const base: ExtractedTransactionData = {
    senderName: null, receiverName: 'JUAN MIGUEL DELA CRUZ', receiverContact: null, amount: 1000,
    date: 'Sep 28, 2026', time: '2:32 PM', referenceNo: '5012345679162', transactionId: null, institution: 'GCash',
  };
  it('different reference and amount at the same minute → flagged', () => {
    const m = matchAgainstHistory({ ...base, amount: 7000, referenceNo: '5098765432162' }, [prior('a', base)]);
    expect(m.kind).toBe('same-moment');
  });
  it('seconds printed on one receipt but not the other still count as the same minute', () => {
    const m = matchAgainstHistory({ ...base, time: '02:32:41 PM', amount: 7000, referenceNo: null }, [prior('a', base)]);
    expect(m.kind).toBe('same-moment');
  });
  it('a different minute is not flagged', () => {
    expect(matchAgainstHistory({ ...base, time: '2:35 PM', amount: 7000, referenceNo: '5098765432162' }, [prior('a', base)]).kind).toBe('none');
  });
});
