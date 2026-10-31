// Sent or received? Who was paid? The GCash bill-payment (GBills) receipt.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import gbills from './fixtures/real-ocr-redacted-gbills.json';
import { parseReceiptMulti, transactionDirectionOf, transactionTypeOf, payeeOf, ecpayReferenceOf } from '../receipt-check/reading/receiptParser';
import { refFormatFor } from '../receipt-check/reading/fieldValidation';
import { paymentContextNotes } from '../receipt-check/verifyReceipt';

const G = gbills.gcash_gbills_bill_payment_2026.passes;

describe('which side of the payment a screenshot shows', () => {
  it('payer screens are "sent"', () => {
    expect(transactionDirectionOf('Express Send\nSent via GCash\nTotal Amount Sent ₱500.00')).toBe('sent');
    expect(transactionDirectionOf('Transfer successful!\nSent via BPI\nTransfer to\nJuan (QR Code)')).toBe('sent');
    expect(transactionDirectionOf(G[0])).toBe('sent');
  });
  it('receiver screens are "received"', () => {
    expect(transactionDirectionOf('You have received PHP 2,000.00 of GCash from JUAN D. Ref. No. 1016642566968')).toBe('received');
    expect(transactionDirectionOf('Received money\nfrom Juan D.\n+₱2,000.00')).toBe('received');
    expect(transactionDirectionOf('InstaPay\nFund transfer from JUAN DELA CRUZ\ncredited to your account')).toBe('received');
  });
  it('no wording, or both: unclear', () => {
    expect(transactionDirectionOf('Amount 3,398.30\nRef No. 1016642566968')).toBe('unclear');
    expect(transactionDirectionOf('You sent ₱500 and received ₱20 cashback')).toBe('unclear');
  });
  it('every real receipt fixture (all are payer screens) is never read as "received"', () => {
    const dir = path.join(__dirname, 'fixtures');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, { passes: string[] }>;
      for (const [k, v] of Object.entries(fx)) expect(transactionDirectionOf(v.passes.join('\n')), `${f}:${k}`).not.toBe('received');
    }
  });
});

describe('GCash bill payment (GBills via ECPay)', () => {
  const p = parseReceiptMulti(G, 'receipt-gbills.jpg');
  const type = transactionTypeOf(G.join('\n'), p.source);
  it('is a GCash bill payment to the biller, not to the "Account Name"', () => {
    expect(p.source).toBe('GCash');
    expect(type).toBe('Bill Payment');
    expect(payeeOf(G[0], type)).toBe('PLATINUM FIBER');
  });
  it('its 9-digit GCash reference is the right shape for a bill payment (but not for a transfer)', () => {
    expect(p.data.referenceNo).toBe('681700523');
    expect(refFormatFor('GCash', 'Bill Payment')!.test('681700523')).toBe(true);
    expect(refFormatFor('GCash', 'Send Money')!.test('681700523')).toBe(false);
  });
  it('reads the ECPay reference', () => {
    expect(ecpayReferenceOf(G)).toBe('2026304abCDE1f');
  });
  it('merchant of a purchase', () => {
    expect(payeeOf('Purchased (Updated) on                    Xx\nSTEAMGAMES.COM 1769677956          (7)\nv Completed', 'Purchase')).toBe('STEAMGAMES.COM');
    expect(payeeOf('Sent via GCash', 'Send Money')).toBeNull();
  });
});

describe('notes on what the screenshot can prove', () => {
  it('a received screen warns about fake "you received" screenshots; a cash-in does not', () => {
    expect(paymentContextNotes('Send Money', 'received', null)[0]).toMatch(/receiving side.*refund scams/);
    expect(paymentContextNotes('Cash In', 'received', null)).toEqual([]);
  });
  it('a bill payment or purchase cannot prove a payment to a person', () => {
    expect(paymentContextNotes('Bill Payment', 'sent', 'PLATINUM FIBER')).toEqual(['This receipt shows a payment to PLATINUM FIBER (a biller), not to a person. It cannot prove that someone paid you.']);
    expect(paymentContextNotes('Purchase', 'sent', null)[0]).toMatch(/a merchant, not to a person/);
    expect(paymentContextNotes('Send Money', 'sent', null)).toEqual([]);
  });
});
