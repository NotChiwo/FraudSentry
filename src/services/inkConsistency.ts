// ============================================================
// FraudSentry — ink-colour consistency (repainted numbers)
//
// The most common fake is a genuine receipt with one number typed over
// (usually the amount). The editor picks the text colour by eye, and it is
// almost never exactly the app's colour. On a genuine receipt, text of the
// same darkness shares one tint: e.g. BPI's dark text has green ≈ blue
// (57,71,70 / 66,73,73 / 70,77,76); a repainted "PHP 50,000.00" measured
// 57,66,74 — bluer by 8–11 at the same lightness.
//
// For each OCR word that contains a digit, the "core ink" (its most
// strongly coloured pixels) is reduced to its TINT (the colour minus its own
// grey level), then compared with the median tint of the receipt's other text
// of similar darkness on other lines. Words whose tint is clearly off are
// reported. Lightness is NOT compared: labels and values are legitimately
// lighter or darker.
// Pure function over RGBA pixels + OCR word boxes (original image pixels).
// ============================================================
import type { OcrWord } from '../types';

export interface InkOutlier { text: string; x0: number; y0: number; x1: number; y1: number; offBy: number }
export interface InkCheck { status: 'consistent' | 'suspicious' | 'unknown'; outliers: InkOutlier[]; detail: string }

const MIN_HEIGHT = 16;      // px — thin small text has unreliable colour (anti-aliasing, chroma subsampling)
const MIN_PEERS = 6;        // other words needed to know the receipt's normal tint
const SIMILAR_DARKNESS = 35;  // peers are within this grey-level of the word

type RGB = [number, number, number];
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

function coreInk(data: ArrayLike<number>, W: number, H: number, w: OcrWord): { ink: RGB; contrast: number } | null {
  const x0 = Math.max(0, Math.floor(w.x0)), x1 = Math.min(W, Math.ceil(w.x1));
  const y0 = Math.max(0, Math.floor(w.y0)), y1 = Math.min(H, Math.ceil(w.y1));
  if (x1 - x0 < 4 || y1 - y0 < MIN_HEIGHT) return null;
  const px = (x: number, y: number): RGB => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  // background = median of the rows just above and below the word
  const border: RGB[] = [];
  for (let x = x0; x < x1; x++) { border.push(px(x, Math.max(0, y0 - 2)), px(x, Math.min(H - 1, y1 + 1))); }
  const bg = [0, 1, 2].map(k => median(border.map(c => c[k]))) as RGB;
  const inside: { c: RGB; d: number }[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const c = px(x, y);
    inside.push({ c, d: Math.max(Math.abs(c[0] - bg[0]), Math.abs(c[1] - bg[1]), Math.abs(c[2] - bg[2])) });
  }
  inside.sort((a, b) => b.d - a.d);
  const core = inside.slice(0, Math.max(5, Math.round(inside.length * 0.08)));
  if (core[core.length - 1].d < 60) return null;   // too faint to judge
  const ink = [0, 1, 2].map(k => core.reduce((s, p) => s + p.c[k], 0) / core.length) as RGB;
  return { ink, contrast: core[core.length - 1].d };
}

const grey = (c: RGB) => (c[0] + c[1] + c[2]) / 3;
// tint as two channel differences: green−red and blue−green (independent of lightness)
const hue = (c: RGB): [number, number] => [c[1] - c[0], c[2] - c[1]];

/**
 * Lines (not single words) are compared, because an edit repaints its line.
 * A line is "off" when its tint differs from the receipt's other text of
 * similar size and darkness by more than that text's own spread allows:
 * max(MIN_GAP, SPREAD_K × spread). The spread adapts the test to each image —
 * desktop screenshots with coloured (sub-pixel) text edges are noisier than
 * phone screenshots, and get a wider allowance.
 */
const MIN_GAP = 5, SPREAD_K = 4;
export function checkInkConsistency(data: ArrayLike<number>, W: number, H: number, words: OcrWord[] | undefined): InkCheck {
  const unknown: InkCheck = { status: 'unknown', outliers: [], detail: '' };
  if (!words?.length) return unknown;
  const measured = words
    .filter(w => w.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 2)
    .map(w => ({ w, h: w.y1 - w.y0, m: coreInk(data, W, H, w) }))
    .filter((x): x is { w: OcrWord; h: number; m: { ink: RGB; contrast: number } } => !!x.m);
  // dark, low-colour body text only — not logos, links or coloured buttons
  const body = measured.filter(x => grey(x.m.ink) < 150 && Math.max(...hue(x.m.ink).map(Math.abs)) < 30);
  if (body.length < MIN_PEERS + 2) return unknown;
  // group into lines
  const lines: typeof body[] = [];
  for (const x of [...body].sort((a, b) => a.w.y0 - b.w.y0)) {
    const cy = (x.w.y0 + x.w.y1) / 2;
    const line = lines.find(l => Math.abs((l[0].w.y0 + l[0].w.y1) / 2 - cy) < l[0].h * 0.5);
    if (line) line.push(x); else lines.push([x]);
  }
  const outliers: InkOutlier[] = [];
  for (const line of lines) {
    // only the lines fakers edit: a money amount ("15,000.00") or a long reference number
    if (!line.some(x => /\d[\d,]*\.\d{2}\b/.test(x.w.text) || /\d{8,}/.test(x.w.text.replace(/\s/g, '')))) continue;
    const lh = median(line.map(x => x.h)), lg = median(line.map(x => grey(x.m.ink)));
    const peers = body.filter(o => !line.includes(o) && Math.abs(grey(o.m.ink) - lg) <= SIMILAR_DARKNESS && Math.abs(o.h - lh) <= lh * 0.35);
    if (peers.length < MIN_PEERS) continue;
    let off = 0;
    for (const k of [0, 1]) {
      const pv = peers.map(p => hue(p.m.ink)[k]);
      const mid = median(pv), spread = Math.max(1, median(pv.map(v => Math.abs(v - mid))));
      const gap = Math.abs(median(line.map(x => hue(x.m.ink)[k])) - mid);
      off = Math.max(off, gap / Math.max(MIN_GAP, SPREAD_K * spread));
    }
    // a tint that recurs elsewhere on the page is part of the design (labels, links, footers), not an edit
    const lineHue = [0, 1].map(k => median(line.map(x => hue(x.m.ink)[k])));
    const sameTintElsewhere = body.filter(o => !line.includes(o) && Math.abs(hue(o.m.ink)[0] - lineHue[0]) <= MIN_GAP && Math.abs(hue(o.m.ink)[1] - lineHue[1]) <= MIN_GAP).length;
    if (off > 1 && sameTintElsewhere < 2) for (const x of line) outliers.push({ text: x.w.text, x0: x.w.x0, y0: x.w.y0, x1: x.w.x1, y1: x.w.y1, offBy: Math.round(off * 100) / 100 });
  }
  if (!outliers.length) return { status: 'consistent', outliers, detail: '' };
  const list = [...new Set(outliers.map(o => o.text))].map(t => `“${t}”`).join(' ');
  return {
    status: 'suspicious', outliers,
    detail: `The text ${list} is printed in a slightly different colour than the receipt's other text of the same size. A bank app prints text of one style in exactly one colour; a number typed over by an editor usually comes out a little off. This is a hint, not proof — check the amount that actually arrived in your own account.`,
  };
}
