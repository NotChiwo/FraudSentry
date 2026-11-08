// Photos of a screen (an SME taking a picture of the customer's phone):
// told apart from screenshots, and read without false alarms.
import { describe, it, expect } from 'vitest';
import photo from './fixtures/real-ocr-redacted-photo.json';
import { flatBlockShare, captureKindOf, PHOTO_FLAT_SHARE } from '../receipt-check/checks/captureType';
import { parseReceiptMulti, parseReceipt, receivingAppOf } from '../receipt-check/reading/receiptParser';
import { photoNotes } from '../receipt-check/verifyReceipt';
import { buildForensicSignals } from '../receipt-check/checks/imageForensics';

/** RGBA pixels: flat app background with a few text rows, or camera-like noise. */
function image(w: number, h: number, kind: 'screen' | 'photo', seed = 7): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let v = kind === 'screen' ? (y % 40 < 12 && x % 9 < 5 ? 30 : 250) : 120 + 60 * Math.sin(x / 50) + (rnd() - 0.5) * 12;
    v = Math.max(0, Math.min(255, v));
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return d;
}

describe('screenshot or photo of a screen', () => {
  it('a flat app screen is a screenshot; a noisy camera image is a photo', () => {
    const screen = flatBlockShare(image(320, 640, 'screen'), 320, 640);
    const cam = flatBlockShare(image(320, 640, 'photo'), 320, 640);
    expect(screen).toBeGreaterThan(0.3);
    expect(cam).toBeLessThan(PHOTO_FLAT_SHARE);
    expect([captureKindOf(screen), captureKindOf(cam)]).toEqual(['screenshot', 'photo']);
  });
  it('the in-app camera always counts as a photo', () => {
    expect(captureKindOf(0.8, true)).toBe('photo');
  });
  it('on a photo, ELA and screen size are not checked (and not scored)', () => {
    const base = { sniff: 'image/jpeg', declaredType: 'image/jpeg', jpeg: { hasExif: false, software: null, progressive: false }, width: 1536, height: 2048, ela: { mean: 0, hotspotPct: 0 } };
    const s = buildForensicSignals({ ...base, capture: 'photo' });
    expect(s.find(x => x.label === 'Error Level Analysis')).toMatchObject({ passed: true, weight: 0 });
    expect(s.find(x => x.label === 'Screen Geometry')).toMatchObject({ passed: true, weight: 0 });
  });
});

describe('the MariBank → GCash InstaPay receipt photographed on a phone', () => {
  const p = parseReceiptMulti(photo.maribank_instapay_photo_of_screen_2026.passes, 'photo-of-phone.jpg');
  it('reads the recipient after a scrap of background before "To"; the account number one pass guessed is dropped', () => {
    expect(p.source).toBe('MariBank');
    expect(p.data.receiverName).toBe('Ma*a Sa***s L.');
    // only one of the three passes read the account number off the photo: not shown, not guessed
    expect(p.data.receiverContact).toBeNull();
    expect(p.unreadable).toContain('receiverContact');
    expect(p.data.amount).toBe(1000);
    expect(p.data.referenceNo).toBe('604217');
  });
  it('does not invent a date from "MariBank: 1045…" (the real date row is cut off in the photo)', () => {
    expect(p.data.date).toBeNull();
  });
  it('the receiver checks GCash (where the money went), not MariBank (the sender’s bank)', () => {
    expect(receivingAppOf(photo.maribank_instapay_photo_of_screen_2026.passes.join('\n'), 'MariBank', 'Bank Transfer')).toBe('GCash');
    expect(receivingAppOf('Transfer successful\nSent via BPI\nTransfer to\nJuan (QR Code)\nxxxxxxxx418', 'BPI', 'Bank Transfer')).toBeNull();
    expect(receivingAppOf('Express Send\nSent via GCash', 'GCash', 'Send Money')).toBe('GCash');
  });
  it('the photo notes name what could not be read', () => {
    const n = photoNotes(true, p.data);
    expect(n[0]).toMatch(/photo of a screen/);
    expect(n[1]).toMatch(/^The date could not be read/);
    expect(photoNotes(false, p.data)).toEqual([]);
  });
});

describe('written dates', () => {
  const d = (t: string) => parseReceipt(t).data.date;
  it('a real month name, a day of 1–31, a space or comma before the year', () => {
    expect(d('MarBans 132767')).toBeNull();
    expect(d('Mar 132767')).toBeNull();
    expect(d('Date  Oct 31,2026 3:15 PM')).toBe('Oct 31,2026');
    expect(d('Monday, Jun 29 2026; 10:31:31 PM')).toBe('Jun 29 2026');
    expect(d('Sept 21, 2026, 08:47 PM')).toBe('Sept 21, 2026');
    expect(d('21 September 2026')).toBe('21 September 2026');
    expect(d('Jan 32 2026')).toBeNull();
  });
  it('a "To" label after two scraps of photo background is still found', () => {
    expect(parseReceipt('MariBank\nTransfer Result\n.           3          To                Ma*a Sa***s L.\nPHP 1,000.00').data.receiverName).toBe('Ma*a Sa***s L.');
  });
  it('"Go to Accounts" is not a "To" label', () => {
    expect(parseReceipt('Transfer successful\nGo to Accounts\nPHP 500.00').data.receiverName).toBeNull();
  });
});
