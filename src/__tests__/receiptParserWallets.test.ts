// More wallets on REAL OCR output (redacted with tools/redact-corpus.cjs):
// Maya merchant purchases and bills, an older GCash Express Send layout, and a
// GoTyme payment to a Maya wallet. Expected references are the true values put
// through the same 0- and 9-preserving digit permutation the fixtures use.
import { describe, it, expect } from 'vitest';
import fixtures from './fixtures/real-ocr-redacted-2.json';
import { parseReceiptMulti, detectSourceFromText } from '../services/receiptParser';

type Fx = { filename: string; passes: string[] };
const fx = fixtures as Record<string, Fx>;
// neutral filename: the fixture keys (e.g. "maya_purchase_…") would otherwise give the issuer away
const parse = (k: string) => parseReceiptMulti(fx[k].passes, 'receipt.jpg');
const PERM = '0478162359';
const redacted = (digits: string) => digits.replace(/\d/g, d => PERM[Number(d)]);

describe('Maya merchant purchase receipts (no readable "maya" logo)', () => {
  it('are identified as Maya from their wording', () => {
    expect(fx.maya_purchase_starbucks.passes.join(' ')).not.toMatch(/maya/i);
    expect(parse('maya_purchase_starbucks').source).toBe('Maya');
    expect(parse('maya_purchase_steam').source).toBe('Maya');
  });
  it('the merchant under the "Purchased (Updated) on" headline is the payee', () => {
    expect(parse('maya_purchase_starbucks').data.receiverName).toBe('STARBUCKS 727 ORTIGAS');   // digits redacted
    expect(parse('maya_purchase_steam').data.receiverName).toMatch(/^WL .Steam Purchase$/);        // "*" OCR'd as a quote
  });
  it('uses the "Purchase date", not the "updated on" header date', () => {
    const d = parse('maya_purchase_starbucks').data;
    expect(d.date).toBe('Jul 27, 2026');
    expect(d.time).toBe('04:43 PM');
    expect(parse('maya_purchase_steam').data.date).toBe('Sept 19, 2026');
  });
  it('reads amount and grouped Reference ID', () => {
    const d = parse('maya_purchase_starbucks').data;
    expect(d.amount).toBe(300);
    expect(d.referenceNo).toBe(redacted('620808788210'));
    expect(parse('maya_purchase_steam').data.amount).toBe(1000);
  });
});

describe('Maya bills payment', () => {
  it('Meralco: Maya, biller as payee, amount above the biller, reference', () => {
    const r = parse('maya_bills_meralco');
    expect(r.source).toBe('Maya');
    expect(r.data.receiverName).toBe('MERALCO');
    expect(r.data.amount).toBe(20000);
    expect(r.data.referenceNo).toBe(redacted('626202008066'));
    expect(r.data.date).toBe('Sept 19, 2026');
  });
});

describe('older GCash Express Send layout (no "GCash" text, "Ref No." read as "Rel Mo")', () => {
  it('is GCash, and the 13-digit reference is read', () => {
    const r = parse('gcash_old_express_send');
    expect(r.source).toBe('GCash');
    expect(r.data.referenceNo).toBe(redacted('1009429419747'));
    expect(r.data.amount).toBe(3398.3);
  });
  it('"Total Amount Paid" alone (without a 4-3-6 reference) is not enough to call it GCash', () => {
    expect(detectSourceFromText('Total Amount Paid P500.00\nInvoice 12345')).toBe('Unknown');
  });
});

describe('GoTyme paying a Maya wallet', () => {
  it('stays GoTyme (Maya is only the destination) and keeps the payee', () => {
    const r = parse('gotyme_paid_psa');
    expect(r.source).toBe('GoTyme');
    expect(r.data.amount).toBe(365);
    expect(r.data.receiverName).toBe('PSA HELPLINE');
    expect(r.data.transactionId).toBe(redacted('130026'));
  });
});
