// Hidden-detail detection: pixelated / covered areas (pixels) and a reference
// number blocked out (OCR text). Images are drawn in code so no personal
// screenshot is stored in the repository; the only real pixels are two crops
// with no personal data (a GCash in-app ad banner and an iOS battery icon).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { findObscuredRegions } from '../receipt-check/checks/obscuredRegions';
import { assessHiddenFields, referenceLooksHidden } from '../receipt-check/checks/hiddenFields';
import { parseReceiptMulti } from '../receipt-check/reading/receiptParser';

// ---- a tiny raster canvas -------------------------------------------------
type RGB = [number, number, number];
class Raster {
  data: Uint8ClampedArray;
  constructor(public w: number, public h: number, bg: RGB) {
    this.data = new Uint8ClampedArray(w * h * 4);
    this.rect(0, 0, w, h, bg);
  }
  set(x: number, y: number, c: RGB, a = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    for (let k = 0; k < 3; k++) this.data[i + k] = Math.round(this.data[i + k] * (1 - a) + c[k] * a);
    this.data[i + 3] = 255;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c); }
  /** anti-aliased stroke: solid core, 1 px half-covered edge (like rendered text) */
  stroke(x: number, y: number, w: number, h: number, c: RGB) {
    this.rect(x, y, w, h, c);
    for (let yy = y; yy < y + h; yy++) { this.set(x - 1, yy, c, 0.45); this.set(x + w, yy, c, 0.45); }
    for (let xx = x; xx < x + w; xx++) { this.set(xx, y - 1, c, 0.45); this.set(xx, y + h, c, 0.45); }
  }
  /** a word of fake glyphs: vertical stems + crossbars, text-sized */
  word(x: number, y: number, chars: number, c: RGB, size = 34) {
    for (let i = 0; i < chars; i++) {
      const gx = x + i * Math.round(size * 0.62);
      this.stroke(gx, y, 5, size, c);
      if (i % 2) this.stroke(gx, y + Math.round(size / 2) - 2, Math.round(size * 0.4), 5, c);
      else this.stroke(gx, y, Math.round(size * 0.4), 5, c);
    }
  }
  /** pixelate a rectangle with square tiles (what phone editors do) */
  pixelate(x: number, y: number, w: number, h: number, tile: number) {
    for (let ty = y; ty < y + h; ty += tile) for (let tx = x; tx < x + w; tx += tile) {
      const s = [0, 0, 0]; let n = 0;
      for (let yy = ty; yy < Math.min(y + h, ty + tile); yy++) for (let xx = tx; xx < Math.min(x + w, tx + tile); xx++) { const i = (yy * this.w + xx) * 4; s[0] += this.data[i]; s[1] += this.data[i + 1]; s[2] += this.data[i + 2]; n++; }
      this.rect(tx, ty, Math.min(tile, x + w - tx), Math.min(tile, y + h - ty), [s[0] / n, s[1] / n, s[2] / n]);
    }
  }
}
/** Decode an 8-bit RGB/RGBA, non-interlaced PNG (all the fixtures are). */
function readPng(file: string): { w: number; h: number; px: (x: number, y: number) => RGB } {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'images', file));
  let off = 8, w = 0, h = 0, ch = 3; const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); ch = body[9] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? out[y * stride + x - ch] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= ch && y ? out[(y - 1) * stride + x - ch] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      out[y * stride + x] = (v + pred) & 255;
    }
  }
  return { w, h, px: (x, y) => { const i = y * stride + x * ch; return [out[i], out[i + 1], out[i + 2]]; } };
}

const WHITE: RGB = [255, 255, 255], INK: RGB = [20, 60, 200], GREY: RGB = [244, 246, 251];

/** A GCash-like receipt: name, phone pill, amount rows, reference line, green footer card, UI chips. */
function receipt(): Raster {
  const r = new Raster(1080, 1800, WHITE);
  r.word(300, 200, 14, INK);                      // recipient name
  r.rect(330, 300, 420, 60, [238, 241, 250]);     // phone pill (flat tint)
  r.word(360, 312, 11, [40, 50, 80], 30);
  r.word(80, 520, 6, [30, 40, 70]); r.word(800, 520, 6, [30, 40, 70]);   // Amount ... 215.00
  r.rect(0, 860, 1080, 300, GREY);                // shaded lower section
  r.word(80, 900, 18, [80, 90, 110], 28);         // Ref No. + digits
  r.rect(80, 1500, 920, 220, [160, 232, 200]);    // green carbon card with text
  r.word(130, 1560, 20, [20, 110, 70], 28);
  r.rect(60, 1300, 70, 70, [220, 228, 255]);      // flat icon chip with a glyph
  r.stroke(85, 1315, 18, 40, INK);
  for (let x = 200; x < 360; x++) for (let y = 1320; y < 1350; y++) {   // rounded placeholder pill
    const dx = Math.max(0, Math.max(215 - x, x - 345)); if (dx * dx + 0 <= 225) r.set(x, y, [170, 160, 240]);
  }
  return r;
}

describe('pixel check: pixelated and covered areas', () => {
  it('a clean receipt with UI cards, pills and icon chips has no hidden areas', () => {
    const r = receipt();
    expect(findObscuredRegions(r.data, r.w, r.h)).toEqual([]);
  });
  it.each([6, 10, 14])('a reference number pixelated with %i px tiles is found, on the reference line', tile => {
    const r = receipt();
    r.pixelate(80, 896, 520, 42, tile);
    const found = findObscuredRegions(r.data, r.w, r.h).filter(x => x.kind === 'pixelated');
    expect(found.length).toBeGreaterThan(0);
    expect(found.some(x => x.y < 940 && x.y + x.h > 896)).toBe(true);
  });
  it('a pixelated name is found', () => {
    const r = receipt();
    r.pixelate(300, 196, 600, 42, 12);
    expect(findObscuredRegions(r.data, r.w, r.h).some(x => x.kind === 'pixelated' && x.y < 240)).toBe(true);
  });
  it('a box in the text colour right after "Ref No." is found; a tinted UI bar is not', () => {
    const r = receipt();
    r.rect(250, 893, 360, 42, [80, 90, 110]);       // same colour as the reference-line text
    expect(findObscuredRegions(r.data, r.w, r.h).some(x => x.kind === 'covered' && x.y >= 880 && x.y < 940)).toBe(true);
  });
  it('a black box drawn over a field is found as "covered"', () => {
    const r = receipt();
    r.rect(296, 192, 560, 50, [0, 0, 0]);
    expect(findObscuredRegions(r.data, r.w, r.h).some(x => x.kind === 'covered')).toBe(true);
  });
});

// Regression: a GENUINE GCash Express Send receipt (2026-10-22) was rated HIGH
// risk, "7 parts are blurred or pixelated". All 7 were in the photo ad banner
// GCash shows under the reference line, plus the iOS battery icon.
describe('pixel check: genuine app content is not a redaction', () => {
  const ad = readPng('gcash-express-send-ad-banner.png');      // 648×550 incl. its shadow, as captured (828 px wide screenshot)
  const battery = readPng('ios-status-bar-battery.png');       // 120×70, from the 1179 px wide copy
  const paste = (r: Raster, img: typeof ad, x0: number, y0: number) => {
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) r.set(x0 + x, y0 + y, img.px(x, y));
  };
  it('the GCash photo ad banner is not "pixelated"', () => {
    const r = new Raster(828, 1100, [244, 246, 251]);           // the receipt's light-grey lower section
    paste(r, ad, 90, 300);
    expect(findObscuredRegions(r.data, r.w, r.h)).toEqual([]);
  });
  it('the iOS battery icon in the blue status bar is not "pixelated"', () => {
    const r = new Raster(400, 200, [20, 80, 230]);
    paste(r, battery, 140, 60);
    expect(findObscuredRegions(r.data, r.w, r.h)).toEqual([]);
  });
  it.each([6, 10, 14])('a reference pixelated with %i px tiles is still found next to the ad banner', tile => {
    const r = receipt();
    paste(r, ad, 216, 1000);                                   // ad between the reference line and the footer
    r.pixelate(80, 896, 520, 42, tile);
    const found = findObscuredRegions(r.data, r.w, r.h);
    expect(found.some(x => x.y < 940 && x.y + x.h > 896)).toBe(true);
    expect(found.every(x => x.y + x.h <= 1000 || x.y >= 1000 + ad.h)).toBe(true);   // nothing inside the ad
  });
});

// OCR output of a real GCash receipt whose name, phone and reference were
// pixelated (3 passes, best first). The readable part of the name is replaced.
const PIXELATED_PASSES = [
  'Ir Rel"  IL ® ny Cruz A.\n+63 fmecee4O] 2\n\nAmount                                                   215.00\nTotal Amount Sent           £21 500\nRef No. "Bf “Ew 9904 Bb    Oct 04, 2026 12:26 PM\n\n[Ng   2799 (gcoze)\n\nBy going digital, you reduce your carbon footprint from\n\ntransportation, paper, and plastic.',
  'FRelv “Tu. Cruz A.\n+63 mee e040] ia\n\nAmount                                                   215.00\nTotal Amount Sent                 P215.00\nRef No." I" w990 Bb      Oct 04, 2026 12:26 PM\n\n05 279g core\n\nBy going digital, you reduce your carbon footprint from\n\ntransportation, paper, and plastic.',
  'FRel  iL =" Cruz A.\n+63 (o.0449 2\nSent via GCash\nAmount                                          215.00\nTotal Amount Sent                    £215.00\nRef No. "nl "Bw 9906 Bb     Oct 04,2026 12:26 PM',
];

describe('text check: the reference label is there but its number is blocked out', () => {
  it('the pixelated real receipt: reference reads as junk → hidden', () => {
    const p = parseReceiptMulti(PIXELATED_PASSES);
    expect(p.data.referenceNo).toBeNull();
    expect(referenceLooksHidden(PIXELATED_PASSES, p.data.referenceNo)).toBe(true);
    const h = assessHiddenFields(PIXELATED_PASSES, undefined, null, []);
    expect(h.referenceUnreadable).toBe(true);
    expect(h.detail).toMatch(/cannot be read/);
  });
  it('OCR junk is no longer accepted as the recipient name', () => {
    expect(parseReceiptMulti(PIXELATED_PASSES).data.receiverName ?? '').not.toMatch(/[="“”®]/);
  });
  it('never fires on any GENUINE real-OCR receipt fixture', () => {
    const dir = path.join(__dirname, 'fixtures');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, { passes: string[]; filename?: string }>;
      for (const [k, v] of Object.entries(fx)) {
        if (/blurred|pixelated|edited/.test(k)) continue;   // fixtures that are hidden on purpose
        const p = parseReceiptMulti(v.passes, v.filename ?? '');
        expect(referenceLooksHidden(v.passes, p.data.referenceNo), `${f}:${k}`).toBe(false);
      }
    }
  });
  it('a clean reference, or a label with nothing after it, is not "hidden"', () => {
    expect(referenceLooksHidden(['Ref No. 8041 241 631871   Oct 10, 2026'], '8041241631871')).toBe(false);
    expect(referenceLooksHidden(['Reference Number'], null)).toBe(false);
  });
  it('a region on the reference line is reported as hiding the reference', () => {
    const words = [{ text: 'Ref', x0: 80, y0: 900, x1: 120, y1: 930 }, { text: 'No.', x0: 126, y0: 900, x1: 170, y1: 930 }];
    const h = assessHiddenFields(['Ref No.'], words, null, [{ kind: 'pixelated', x: 200, y: 896, w: 300, h: 40, tiles: 9 }]);
    expect(h.regionOnReference).toBe(true);
    expect(h.detail).toMatch(/including the reference number/);
  });
  it('a region on the "+63" line is reported as hiding the mobile number', () => {
    const words = [{ text: '+63', x0: 360, y0: 340, x1: 430, y1: 385 }];
    const h = assessHiddenFields([''], words, null, [{ kind: 'pixelated', x: 456, y: 360, w: 24, h: 32, tiles: 3 }]);
    expect(h.regionOnPhone).toBe(true);
    expect(h.detail).toMatch(/mobile number/);
  });
});

describe('privacy blur vs. hidden key details', () => {
  // a BPI-like layout: date line, confirmation line, recipient name line, amount line
  const w = (text: string, x0: number, y0: number) => ({ text, x0, y0, x1: x0 + 20 * text.length, y1: y0 + 30 });
  const words = [
    w('Monday,', 40, 700), w('Jun', 200, 700), w('29', 270, 700), w('2026;', 320, 700),
    w('Confirmation', 40, 760), w('No.', 300, 760), w('1782743489365', 380, 760),
    w('Jeth', 40, 990), w('(QR', 140, 990), w('Code)', 220, 990),
    w('PHP', 40, 1250), w('15,000.00', 130, 1250),
  ];
  const extracted = { senderName: null, receiverName: null, receiverContact: null, amount: 15000, date: 'Jun 29 2026', time: '10:31:31 PM', referenceNo: '1782743489365', transactionId: null, institution: 'BPI' };
  const region = (y: number) => ({ kind: 'pixelated' as const, x: 40, y, w: 400, h: 40, tiles: 6 });

  it('only the name blurred, reference/date/amount readable: privacy, not held against it', () => {
    const h = assessHiddenFields([''], words, extracted.referenceNo, [region(985)], extracted);
    expect(h.keyDetailsCovered).toEqual([]);
    expect(h.privacyOnly).toBe(true);
    expect(h.detail).toMatch(/blurred for privacy/);
  });
  it('the date and confirmation number blurred: key details, cannot be verified', () => {
    const h = assessHiddenFields([''], words, extracted.referenceNo, [region(695), region(755), region(985)], extracted);
    expect(h.keyDetailsCovered).toEqual(['reference', 'date']);
    expect(h.privacyOnly).toBe(false);
    expect(h.detail).toMatch(/including the reference number and the date/);
    expect(h.detail).toMatch(/cannot be checked/);
  });
  it('a key detail that was not read cannot be ruled out', () => {
    const h = assessHiddenFields([''], words, null, [region(985)], { ...extracted, referenceNo: null });
    expect(h.keyDetailsCovered).toBeNull();
    expect(h.privacyOnly).toBe(false);
  });
});
