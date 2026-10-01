// Receipt parser tests.
//
// The fixtures in real-ocr-redacted.json are REAL output of this app's own OCR
// pipeline (src/services/ocr.ts, run in Chromium via tools/ocr-corpus.mjs) on
// genuine PH e-wallet / bank screenshots — noise and all ("instaFay", "£100.00",
// garbage lines from ad banners, masked digits read as "Deeeeee/803").
// Personal data was redacted by tools/redact-corpus.cjs: names/emails replaced,
// and every 3+ digit run scrambled with a 0- and 9-preserving digit permutation
// (so "+63 9…" phone structure survives). Expected values below are the
// redacted forms of the values visible on the original screenshots.
import { describe, it, expect } from 'vitest';
import fixtures from './fixtures/real-ocr-redacted.json';
import { parseReceipt, parseReceiptMulti, detectSourceFromText, isUnconfirmedTransaction, amountFormattingSignal } from '../services/receiptParser';

type Fx = { filename: string; passes: string[] };
const fx = fixtures as Record<string, Fx>;
const parse = (k: string) => parseReceiptMulti(fx[k].passes, fx[k].filename);

describe('issuer detection on real OCR (the destination-bank bug)', () => {
  it('GoTyme app receipt sending TO GCash is GoTyme, not GCash', () => {
    // the text contains "G-Xchange, Inc (GCash)" as the destination
    expect(fx.gotyme_to_gcash.passes.join(' ')).toMatch(/GCash/);
    expect(parse('gotyme_to_gcash').source).toBe('GoTyme');
  });
  it('GoTyme app receipt sending TO Maya is GoTyme, not Maya', () => {
    expect(fx.gotyme_to_maya.passes.join(' ')).toMatch(/PayMaya/);
    expect(parse('gotyme_to_maya').source).toBe('GoTyme');
  });
  it('GCash receipt sending TO a GoTyme account stays GCash', () => {
    expect(fx.gcash_to_gotyme.passes.join(' ')).toMatch(/GoTyme Bank/);
    expect(parse('gcash_to_gotyme').source).toBe('GCash');
  });
  it('accepts the InstaPay logo as OCR actually reads it ("instaFay")', () => {
    expect(fx.gotyme_to_gcash.passes[0]).toMatch(/instaFay/);
    expect(fx.gotyme_to_gcash.passes[0]).not.toMatch(/instapay/i);
  });
  it('also accepts the documented p→r misread "instaray"', () => {
    expect(detectSourceFromText('instaray  Instant\nTrace ID 000006\nGoTyme Bank')).toBe('GoTyme');
  });
  it('does NOT call it GoTyme on a plain mention without Trace ID', () => {
    expect(detectSourceFromText('Bank GoTyme Bank\nTransfer Method InstaPay\nSent via GCash')).toBe('GCash');
  });
  it('MariBank and Express Send GCash are still detected', () => {
    expect(parse('maribank').source).toBe('MariBank');
    expect(parse('gcash_express_send').source).toBe('GCash');
  });
});

describe('field extraction on real OCR', () => {
  it('GoTyme: Trace ID does not run into the next row ("000006ReferenceNo" bug)', () => {
    const d = parse('gotyme_to_gcash').data;
    expect(d.transactionId).toBe('000002');
    expect(d.referenceNo).toBe('ITO720971054542002');
    expect(d.amount).toBe(100);
    expect(d.date).toBe('24 Sep 2026');
    expect(d.time).toBe('4:18 PM');
  });
  it('GCash bank transfer: 13-digit reference, amount = transfer amount (not total)', () => {
    const d = parse('gcash_to_gotyme').data;
    expect(d.referenceNo).toBe('1016609788969');
    expect(d.referenceNo).toHaveLength(13);
    expect(d.amount).toBe(3500);
    expect(d.receiverName).toBe('JUAN MIGUEL DELA CRUZ');
  });
  it('GCash Express Send: masked name + phone + reference', () => {
    const d = parse('gcash_express_send').data;
    expect(d.receiverName).toBe('MA...O R.');
    expect(d.receiverContact).toBe('+63 993 922 1790');
    expect(d.referenceNo).toBe('1016642566968');
    expect(d.amount).toBe(160);
  });
  it('Maya: spaced numeric "Reference ID" is read (was missed entirely before)', () => {
    expect(parse('maya_purchase_numeric_ref').data.referenceNo).toBe('272740735508');
  });
  it('Maya: hex-style "Reference ID" groups are read', () => {
    expect(parse('maya_purchase_hex_ref').data.referenceNo).toBe('4CCD207553B8');
  });
  it('never captures a word fragment like "erence" as the reference', () => {
    for (const k of Object.keys(fx)) {
      const ref = parse(k).data.referenceNo;
      if (ref) expect(ref, k).toMatch(/\d/);
    }
  });
});

describe('Maya "Confirm transaction" (unsent) screen', () => {
  it('is recognised as an unconfirmed transaction', () => {
    expect(fx.maya_confirm_unsent.passes.some(isUnconfirmedTransaction)).toBe(true);
    expect(parse('maya_confirm_unsent').source).toBe('Maya');
  });
  it('the payer\'s own number under "Source" is not reported as the receiver', () => {
    const d = parse('maya_confirm_unsent').data;
    expect(d.receiverContact).toBeNull();
    expect(d.receiverName).toBeNull();
    expect(d.referenceNo).toBeNull();           // nothing was sent, so no reference exists
  });
  it('completed receipts are never flagged as unconfirmed', () => {
    for (const k of Object.keys(fx).filter(k => k !== 'maya_confirm_unsent')) {
      expect(fx[k].passes.some(isUnconfirmedTransaction), k).toBe(false);
    }
  });
});

describe('multi-pass merge (patterns seen in real 3-pass OCR, digits made up)', () => {
  it('disagreeing reference reads → the consensus read wins, not just the first pass', () => {
    // pass 1 misread one digit (9→0), pass 2 dropped a digit, pass 3 is right
    const d = parseReceiptMulti(['Ref No. 5012345670162', 'Ref No. 501234567962', 'Ref No 5012345679162']).data;
    expect(d.referenceNo).toBe('5012345679162');
  });
  it('a clean majority still wins outright', () => {
    expect(parseReceiptMulti(['Ref No. 5012345679162', 'Ref No. 5012345670162', 'Ref No. 5012345679162']).data.referenceNo).toBe('5012345679162');
  });
  it('issuer comes from ALL passes: one pass reading the GCash boilerplate beats two that only see the destination bank', () => {
    const r = parseReceiptMulti([
      'Bank   GoTyme Bank\nTransfer Amount 1,000.00',
      'receive an update about this transaction in your GCash Inbox\nBank   GoTyme Bank',
      'Bank   GoTyme Bank',
    ]);
    expect(r.source).toBe('GCash');
  });
  it('button labels under a "Purchased" headline are not taken as the payee', () => {
    const d = parseReceiptMulti(['Purchased on\nShare\nReference ID 1234 5678 9012', 'Purchased on\nP Share\nReference ID 1234 5678 9012']).data;
    expect(d.receiverName).toBeNull();
  });
});

describe('parser rules (synthetic edge cases)', () => {
  it('bank SMS "[BPI] You have transferred … to GCash" is a BPI record, not GCash', () => {
    expect(detectSourceFromText('[BPI] You have transferred PHP\n490.00 to GCash/G-Xchange on\nDec 21 2025')).toBe('BPI');
  });
  it('"Ref Mo." (N misread as M) still yields the reference', () => {
    expect(parseReceipt('Ref Mo. 5016 713 788852').data.referenceNo).toBe('5016713788852');
  });
  it('Maya "Reference ID" followed by an unspaced number', () => {
    expect(parseReceipt('Reference ID   201302085045').data.referenceNo).toBe('201302085045');
  });
  it('normalises dot-grouped thousands ("3.500.00")', () => {
    expect(parseReceipt('Amount Sent PHP 3.500.00').data.amount).toBe(3500);
  });
  it('reads debit amounts printed with a minus sign', () => {
    expect(parseReceipt('Amount - ₱400.00').data.amount).toBe(400);
  });
  it('payee under a "Successfully sent to" headline', () => {
    expect(parseReceipt('Successfully sent to\nMeralco\nPHP 1,250.00').data.receiverName).toBe('Meralco');
  });
  it('a spaced reference does not swallow digits from the next line', () => {
    expect(parseReceipt('Ref No. 8041 241 631871\n2026').data.referenceNo).toBe('8041241631871');
  });
  it('edited-amount tell: same value formatted two ways', () => {
    const sig = amountFormattingSignal(['Amount sent 4,500.00\nTotal Amount 4500.00']);
    expect(sig.suspicious).toBe(true);
  });
  it('no edited-amount alarm when formatting is consistent', () => {
    expect(amountFormattingSignal(['Amount sent 4,500.00\nTotal Amount 4,500.00']).suspicious).toBe(false);
  });
});
