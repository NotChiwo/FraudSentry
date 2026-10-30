// BPI online-banking receipts (real OCR, redacted) and the checks that tell
// a genuine one from an edited one.
import { describe, it, expect } from 'vitest';
import fixtures from './fixtures/real-ocr-redacted-bpi.json';
import { parseReceiptMulti, detectSourceFromText } from '../services/receiptParser';
import { checkWeekday } from '../services/consistencyChecks';
import { referenceLooksHidden } from '../services/hiddenFields';
import { acceptedCurrentNotice, CONSENT_VERSION } from '../store/useAppStore';

type Fx = { filename: string; passes: string[] };
const fx = fixtures as Record<string, Fx>;
const parse = (k: string) => parseReceiptMulti(fx[k].passes, fx[k].filename);
const edit = (k: string, from: string | RegExp, to: string) => fx[k].passes.map(t => t.replace(from, to));

describe('BPI receipts are read correctly (real OCR, redacted)', () => {
  it('2025-style receipt with a Fee row', () => {
    const { data, source } = parse('bpi_transfer_2025_with_fee');
    expect(source).toBe('BPI');
    expect(data.referenceNo).toBe('1742416202347');               // "Confirmation No."
    expect(data.receiverName).toBe('Juan');                       // "Transfer to / Juan (QR Code)"
    expect(data.receiverContact).toBe('xxxxxxxxxxx418');
    expect(data.amount).toBe(2500);
    expect([data.date, data.time]).toEqual(['Mar 20 2025', '04:30:05 AM']);
  });
  it('2027-style receipt with a masked legal name', () => {
    const { data } = parse('bpi_transfer_2027');
    expect(data.referenceNo).toBe('1814193089365');
    expect(data.receiverName).toMatch(/^[A-Z]/);                   // the masked legal name, not "Transfer successful!"
    expect(data.receiverName).not.toMatch(/success|transfer/i);
    expect(data.receiverContact).toBe('xxxxxxxxxxx418');
    expect(data.amount).toBe(15000);
  });
  it('"Sent via BPI" is BPI even when another bank is named as the destination', () => {
    expect(detectSourceFromText('Transfer successful!\nSent via BPI\nTransfer to\nJuan\nGCash\nxxxxxxx123')).toBe('BPI');
  });
});

describe('a BPI confirmation number is not a timestamp', () => {
  // An earlier rule assumed it was (it held on two receipts) and flagged this
  // genuine receipt High. The rule was removed; this receipt must read cleanly.
  it('genuine Sep 2026 receipt: every field read, weekday consistent', () => {
    const { data, source } = parse('bpi_transfer_2026_genuine_conf_not_time');
    expect(source).toBe('BPI');
    expect(data.referenceNo).toBe('1624503955714');
    expect(data.amount).toBe(12000);
    expect([data.date, data.time]).toEqual(['Sep 02 2026', '03:03:36 AM']);
    expect(data.receiverContact).toBe('xxxxxxxxxxx418');
    expect(checkWeekday(fx.bpi_transfer_2026_genuine_conf_not_time.passes).status).toBe('consistent');
  });
});

describe('weekday ↔ date', () => {
  it('genuine receipts: the weekday matches', () => {
    expect(checkWeekday(fx.bpi_transfer_2025_with_fee.passes).status).toBe('consistent');
    expect(checkWeekday(fx.bpi_transfer_2027.passes).status).toBe('consistent');
  });
  it('an edited date that keeps the old weekday is caught', () => {
    const r = checkWeekday(edit('bpi_transfer_2027', /Jun 28 2027/, 'Jun 30 2027'));
    expect(r.status).toBe('mismatch');
    expect(r.detail).toMatch(/Monday.*Wednesday/);
  });
  it('a single OCR pass misreading the weekday is not trusted', () => {
    const p = fx.bpi_transfer_2027.passes;
    expect(checkWeekday([p[0].replace('Monday', 'Friday'), p[1], p[2]]).status).toBe('consistent');
  });
  it('receipts without a weekday are not judged', () => {
    expect(checkWeekday(['Oct 04, 2026 12:26 PM']).status).toBe('unknown');
  });
});

describe('the blurred BPI receipt', () => {
  it('its confirmation number reads as junk → hidden', () => {
    const p = parse('bpi_transfer_2027_blurred');
    expect(p.data.referenceNo).toBeNull();
    expect(referenceLooksHidden(fx.bpi_transfer_2027_blurred.passes, p.data.referenceNo)).toBe(true);
  });
  it('the genuine ones are not "hidden"', () => {
    for (const k of ['bpi_transfer_2025_with_fee', 'bpi_transfer_2027']) expect(referenceLooksHidden(fx[k].passes, parse(k).data.referenceNo)).toBe(false);
  });
});

describe('privacy notice versioning (the welcome screen)', () => {
  it('a notice accepted before the current version is shown again', () => {
    expect(acceptedCurrentNotice({ hasConsented: true })).toBe(false);
    expect(acceptedCurrentNotice({ hasConsented: true, consentVersion: CONSENT_VERSION - 1 })).toBe(false);
    expect(acceptedCurrentNotice({ hasConsented: true, consentVersion: CONSENT_VERSION })).toBe(true);
    expect(acceptedCurrentNotice({ hasConsented: false, consentVersion: CONSENT_VERSION })).toBe(false);
  });
});
