// ============================================================
// FraudSentry — live camera frame quality (pure, unit-tested)
//
// Measured on a small grayscale copy of each video frame:
//   • sharpness  — variance of the Laplacian (blurry frames have few edges)
//   • brightness — mean luma 0–255
//   • motion     — mean absolute difference from the previous frame
// These drive the viewfinder hints and auto-capture. They describe the
// picture, not the receipt: a sharp, steady frame can still be a fake.
// ============================================================

export interface FrameStats { sharpness: number; brightness: number; motion: number | null }

/** Grayscale (luma) from RGBA pixels. */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
  return g;
}

export function frameStats(gray: Float32Array, w: number, h: number, prev?: Float32Array | null): FrameStats {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const brightness = gray.length ? sum / gray.length : 0;

  // 4-neighbour Laplacian over the interior
  let n = 0, mean = 0, m2 = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      n++;
      const d = lap - mean;
      mean += d / n;
      m2 += d * (lap - mean);
    }
  }
  const sharpness = n > 1 ? m2 / (n - 1) : 0;

  let motion: number | null = null;
  if (prev && prev.length === gray.length) {
    let diff = 0;
    for (let i = 0; i < gray.length; i++) diff += Math.abs(gray[i] - prev[i]);
    motion = diff / gray.length;
  }
  return { sharpness, brightness, motion };
}

export type FrameHint = 'dark' | 'bright' | 'blurry' | 'moving' | 'ready';

/** Thresholds are for a ~160 px wide grayscale frame. */
// A receipt is mostly white, so a high average is normal; it only counts as
// glare when the frame is almost blown out AND has no detail left.
export const FRAME_LIMITS = { minBrightness: 55, maxBrightness: 248, minSharpness: 120, maxMotion: 6 };

export function frameHint(s: FrameStats): FrameHint {
  if (s.brightness < FRAME_LIMITS.minBrightness) return 'dark';
  if (s.brightness > FRAME_LIMITS.maxBrightness && s.sharpness < FRAME_LIMITS.minSharpness) return 'bright';
  if (s.motion != null && s.motion > FRAME_LIMITS.maxMotion) return 'moving';
  if (s.sharpness < FRAME_LIMITS.minSharpness) return 'blurry';
  return 'ready';
}

export const HINT_TEXT: Record<FrameHint, string> = {
  dark: 'Too dark — add light or turn on the flashlight',
  bright: 'Too much glare — tilt the phone slightly',
  moving: 'Hold steady…',
  blurry: 'Focusing… move a little closer or farther',
  ready: 'Looks sharp — hold still',
};
