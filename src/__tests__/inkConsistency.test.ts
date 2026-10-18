// Ink-colour consistency: a retyped amount line printed in a slightly different
// tint is reported; genuine text, and design colours that recur, are not.
import { describe, it, expect } from 'vitest';
import { checkInkConsistency } from '../services/inkConsistency';
import type { OcrWord } from '../types';

type RGB = [number, number, number];
const W = 700, H = 900;
function canvas(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < W * H; i++) { const n = 252 + Math.round(rnd() * 3); d.set([n, n + 1, n + 1, 255], i * 4); }   // off-white, JPEG-ish noise
  return d;
}
// a "word": bold anti-aliased glyph stems + bars inside its box, in one ink colour
function word(d: Uint8ClampedArray, text: string, x: number, y: number, ink: RGB, h = 26): OcrWord {
  const w = Math.max(30, text.length * 15);
  const put = (px: number, py: number, a: number) => {
    const i = (py * W + px) * 4;
    for (let k = 0; k < 3; k++) d[i + k] = Math.round(d[i + k] * (1 - a) + ink[k] * a);
  };
  for (let gx = x; gx < x + w - 6; gx += 15) {
    for (let yy = y; yy < y + h; yy++) for (let xx = gx; xx < gx + 5; xx++) put(xx, yy, 1);
    for (let yy = y; yy < y + h; yy++) { put(gx - 1, yy, 0.45); put(gx + 5, yy, 0.45); }
    for (let xx = gx; xx < gx + 10; xx++) for (let yy = y; yy < y + 4; yy++) put(xx, yy, 1);
  }
  return { text, x0: x - 2, y0: y - 2, x1: x + w, y1: y + h + 2 };
}
const BODY: RGB = [57, 71, 70];   // green ≈ blue, like BPI's dark text

function receipt(amountInk: RGB, extraTint?: RGB) {
  const d = canvas(); const words: OcrWord[] = [];
  const lines: [string[], number][] = [[['Transfer', 'successful!'], 60], [['Confirmation', 'No.', '1814193089365'], 130], [['Transfer', 'to'], 200],
    [['Juan', '(QR', 'Code)'], 260], [['SAVINGS', 'ACCOUNT'], 330], [['XXXXXX9051'], 390], [['Transfer', 'amount'], 450]];
  for (const [ws, y] of lines) { let x = 30; for (const t of ws) { words.push(word(d, t, x, y, BODY)); x += t.length * 15 + 30; } }
  words.push(word(d, 'PHP', 30, 520, amountInk), word(d, '15,000.00', 110, 520, amountInk));
  if (extraTint) for (const [y, t] of [[600, 'Fee'], [660, 'Total'], [720, 'Service']] as [number, string][]) words.push(word(d, t, 30, y, extraTint));
  return { d, words };
}

describe('ink-colour consistency', () => {
  it('a genuine receipt (one ink) is consistent', () => {
    const { d, words } = receipt(BODY);
    expect(checkInkConsistency(d, W, H, words).status).toBe('consistent');
  });
  it('an amount line retyped in a slightly bluer ink is reported, with its words', () => {
    const { d, words } = receipt([60, 66, 77]);
    const r = checkInkConsistency(d, W, H, words);
    expect(r.status).toBe('suspicious');
    expect(r.outliers.map(o => o.text)).toEqual(['PHP', '15,000.00']);
    expect(r.detail).toMatch(/hint, not proof/);
  });
  it('a tint that recurs on other lines is a design colour, not an edit', () => {
    const tint: RGB = [60, 66, 77];
    const { d, words } = receipt(tint, tint);
    expect(checkInkConsistency(d, W, H, words).status).toBe('consistent');
  });
  it('lines without an amount or long reference are never judged', () => {
    const { d, words } = receipt(BODY);
    const r = checkInkConsistency(d, W, H, [...words.filter(w => !/\d/.test(w.text)), word(d, 'Monday', 30, 800, [60, 66, 77])]);
    expect(r.status).not.toBe('suspicious');
  });
  it('too few words to know the normal ink: unknown', () => {
    const { d, words } = receipt([60, 66, 77]);
    expect(checkInkConsistency(d, W, H, words.slice(-3)).status).toBe('unknown');
  });
});
