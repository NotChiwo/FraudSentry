// Live-camera frame quality measures (synthetic frames with known properties).
import { describe, it, expect } from 'vitest';
import { frameStats, frameHint, toGray } from '../services/frameQuality';

const W = 160, H = 120;
const frame = (f: (x: number, y: number) => number) => {
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = f(x, y);
  return g;
};
// crisp black text-like stripes on white vs. the same stripes smoothly blurred
const sharp = frame((x, y) => ((Math.floor(x / 4) + Math.floor(y / 6)) % 2 ? 30 : 220));
const blurry = frame((x, y) => 125 + 60 * Math.sin(x / 9) * Math.sin(y / 11));

describe('frameStats', () => {
  it('a crisp frame has far higher Laplacian variance than a blurry one', () => {
    expect(frameStats(sharp, W, H).sharpness).toBeGreaterThan(10 * frameStats(blurry, W, H).sharpness);
  });
  it('brightness is the mean luma', () => {
    expect(frameStats(frame(() => 100), W, H).brightness).toBeCloseTo(100);
  });
  it('motion is null without a previous frame and 0 for an identical one', () => {
    expect(frameStats(sharp, W, H).motion).toBeNull();
    expect(frameStats(sharp, W, H, sharp).motion).toBe(0);
  });
  it('toGray uses Rec.601 luma', () => {
    const g = toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1);
    expect(g[0]).toBeCloseTo(76.245); expect(g[1]).toBeCloseTo(149.685);
  });
});

describe('frameHint', () => {
  it('sharp, lit, steady → ready', () => {
    expect(frameHint(frameStats(sharp, W, H, sharp))).toBe('ready');
  });
  it('blurry → blurry; dark → dark; shaking → moving', () => {
    expect(frameHint(frameStats(blurry, W, H, blurry))).toBe('blurry');
    expect(frameHint(frameStats(frame(() => 20), W, H))).toBe('dark');
    const shifted = frame((x, y) => ((Math.floor((x + 2) / 4) + Math.floor(y / 6)) % 2 ? 30 : 220));
    expect(frameHint(frameStats(shifted, W, H, sharp))).toBe('moving');
  });
});

describe('white receipts are not "glare"', () => {
  it('a mostly-white frame that still has crisp text is ready, not bright', () => {
    const whiteWithText = frame((x, y) => (y % 12 === 0 && x % 7 < 5 ? 20 : 252));
    const s = frameStats(whiteWithText, W, H, whiteWithText);
    expect(s.brightness).toBeGreaterThan(235);
    expect(frameHint(s)).toBe('ready');
  });
  it('a blown-out frame with no detail is glare', () => {
    expect(frameHint(frameStats(frame(() => 254), W, H))).toBe('bright');
  });
});
