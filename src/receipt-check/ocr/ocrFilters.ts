// ============================================================
// FraudSentry — OCR preprocessing filters (pure pixel math)
//
// Shared by the preprocessing Web Worker (ocrPreprocess.worker.ts) and the
// main-thread fallback in ocr.ts, so both produce IDENTICAL pixels. Running
// them in the worker keeps the UI responsive: on a 944×2046 receipt
// (upscaled to 2100×4551) the enhance filter alone blocked the main thread
// for ~1.4 s under 4× CPU throttling.
// ============================================================

/** Output size for the up-scaled passes. */
export function scaledSize(nw: number, nh: number): { w: number; h: number } {
  const targetW = 2100;            // small phone screenshots need a big upscale to read names
  const maxScale = 4;              // up to 4x for tiny (~450px) receipts
  let scale = 1;
  if (nw < targetW) scale = Math.min(maxScale, targetW / nw);
  let w = Math.round(nw * scale);
  let h = Math.round(nh * scale);
  // bound the long edge so very tall receipts stay fast
  const cap = 5200;
  if (h > cap) { const k = cap / h; w = Math.round(w * k); h = cap; }
  return { w, h };
}

/** Contrast stretch + gamma + 3×3 sharpen, written back as grayscale (in place). */
export function enhancePixels(px: Uint8ClampedArray, w: number, h: number): void {
  let min = 255, max = 0;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    const v = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    gray[g] = v;
    if (v < min) min = v; if (v > max) max = v;
  }
  const range = Math.max(1, max - min);
  const stretched = new Uint8ClampedArray(w * h);
  for (let g = 0; g < gray.length; g++) {
    let v = ((gray[g] - min) / range) * 255;
    v = 255 * Math.pow(v / 255, 0.85);
    stretched[g] = v;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      let v = stretched[idx] * 5;
      v -= stretched[(y) * w + Math.max(0, x - 1)];
      v -= stretched[(y) * w + Math.min(w - 1, x + 1)];
      v -= stretched[Math.max(0, y - 1) * w + x];
      v -= stretched[Math.min(h - 1, y + 1) * w + x];
      const o = idx * 4;
      const c2 = v < 0 ? 0 : v > 255 ? 255 : v;
      px[o] = px[o + 1] = px[o + 2] = c2;
    }
  }
}

/** Otsu threshold of the luma histogram. */
export function otsuThreshold(px: Uint8ClampedArray): { threshold: number; gray: Uint8ClampedArray } {
  const n = px.length / 4;
  const hist = new Array(256).fill(0);
  const gray = new Uint8ClampedArray(n);
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    const v = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    gray[g] = v; hist[v]++;
  }
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (wB === 0) continue;
    const wF = n - wB; if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; threshold = t; }
  }
  return { threshold, gray };
}

/** Black/white at the Otsu threshold (in place). */
export function binarizePixels(px: Uint8ClampedArray): void {
  const { threshold, gray } = otsuThreshold(px);
  for (let g = 0, o = 0; g < gray.length; g++, o += 4) {
    const bw = gray[g] >= threshold ? 255 : 0;
    px[o] = px[o + 1] = px[o + 2] = bw;
  }
}
