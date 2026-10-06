// Preprocessing Web Worker: runs the slow per-pixel filters for the ENHANCED
// and BINARISED OCR passes off the main thread, so the scan animation and
// buttons stay responsive while a receipt is being read.
//
// The main thread still does the up-scale (drawImage, GPU-backed and fast) and
// hands over the raw RGBA pixels. Scaling inside the worker (OffscreenCanvas)
// resampled slightly differently and changed Tesseract's output, so it is
// deliberately NOT done here: the pixels must match the previous pipeline exactly.
import { enhancePixels, binarizePixels } from './ocrFilters';

type Req = { id: number; buf: ArrayBuffer; w: number; h: number };

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, buf, w, h } = e.data;
  try {
    const src = new Uint8ClampedArray(buf);
    const enhanced = new Uint8ClampedArray(src);   // copy; each filter works in place
    enhancePixels(enhanced, w, h);
    binarizePixels(src);
    (self as unknown as Worker).postMessage({ id, enhanced: enhanced.buffer, binarised: src.buffer }, [enhanced.buffer, src.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message || err) });
  }
};
