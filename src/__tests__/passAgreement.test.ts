// "Never guess": a value the OCR passes don't agree on is not shown.
// Names and numbers below are made up.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { unagreedFields, parseReceiptMulti } from '../receipt-check/reading/receiptParser';
import type { ExtractedTransactionData } from '../shared/types';

const blank: ExtractedTransactionData = {
  senderName: null, receiverName: null, receiverContact: null, amount: null,
  date: null, time: null, referenceNo: null, transactionId: null, institution: null,
};
const d = (o: Partial<ExtractedTransactionData>): ExtractedTransactionData => ({ ...blank, ...o });

describe('2-of-3 agreement for names and numbers', () => {
  it('a name only one pass read (the others read something else) is unreadable', () => {
    const per = [d({ receiverName: 'FRel fun Cruz A.' }), d({ receiverName: 'Ir Rel IL' }), d({ receiverName: null })];
    expect(unagreedFields(['', '', ''], per, per[0])).toContain('receiverName');
  });
  it('a name two passes read the same way (one slip allowed) is kept', () => {
    const per = [d({ receiverName: 'Juan Dela Cruz' }), d({ receiverName: 'Juan Dela Cruz' }), d({ receiverName: 'Juan Dela Crux' })];
    expect(unagreedFields(['', '', ''], per, per[0])).toEqual([]);
  });
  it('masking style and punctuation do not count as disagreement', () => {
    const per = [d({ receiverName: 'JU** DE** C.' }), d({ receiverName: 'JU•• DE•• C' }), d({})];
    expect(unagreedFields(['', '', ''], per, per[0])).toEqual([]);
  });
  it('a recipient number one pass guessed from a photo is unreadable', () => {
    const per = [d({ receiverContact: 'KQZTXVBMLWHPZCT' }), d({}), d({})];
    expect(unagreedFields(['', '', ''], per, per[0])).toEqual(['receiverContact']);
  });
});

describe('format-checked values', () => {
  it('a reference, date or amount only one pass read cleanly is kept (no other pass contradicts it)', () => {
    const per = [d({ referenceNo: '9001234567891', date: 'Apr 21, 2026', time: '12:56 PM', amount: 500 }), d({}), d({})];
    expect(unagreedFields(['Amount 500.00', '', ''], per, per[0])).toEqual([]);
  });
  it('two passes giving different dates with no majority → unreadable', () => {
    const per = [d({ date: 'Apr 21, 2026' }), d({ date: 'Apr 27, 2026' }), d({})];
    expect(unagreedFields(['', '', ''], per, per[0])).toEqual(['date']);
  });
  it('different amounts with no majority → unreadable; the same amount in two passes → kept', () => {
    const split = [d({ amount: 1500 }), d({ amount: 7500 }), d({})];
    expect(unagreedFields(['1,500.00', '7,500.00', ''], split, split[0])).toEqual(['amount']);
    const agreed = [d({ amount: 1500 }), d({ amount: 7500 }), d({ amount: 1500 })];
    expect(unagreedFields(['1,500.00', '7,500.00', '1,500.00'], agreed, agreed[0])).toEqual([]);
  });
  it('a reference may differ by one misread digit', () => {
    const per = [d({ referenceNo: '9001234567891' }), d({ referenceNo: '9001234561891' }), d({})];
    expect(unagreedFields(['', '', ''], per, per[0])).toEqual([]);
  });
  it('a single pass is never second-guessed', () => {
    expect(unagreedFields([''], [d({ receiverName: 'Juan' })], d({ receiverName: 'Juan' }))).toEqual([]);
  });
  it('parseReceiptMulti hides what it marks unreadable', () => {
    const r = parseReceiptMulti(['Date Apr 21, 2026 Ref No. 9001234567891', 'Date Apr 27, 2026 Ref No. 9001234567891', 'Ref No. 9001234567891']);
    if (r.unreadable.includes('date')) expect(r.data.date).toBeNull();
    expect(r.data.referenceNo).toBe('9001234567891');
  });
});

describe('real genuine receipts (redacted fixtures)', () => {
  it('never lose their amount, date, time or reference to the agreement rule', () => {
    const dir = path.join(__dirname, 'fixtures');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, { passes: string[]; filename?: string }>;
      for (const [k, v] of Object.entries(fx)) {
        const { unreadable } = parseReceiptMulti(v.passes, v.filename ?? '');
        for (const field of ['amount', 'date', 'time', 'referenceNo', 'transactionId'] as const) {
          expect(unreadable.includes(field), `${f}:${k} lost ${field}`).toBe(false);
        }
      }
    }
  });
});
