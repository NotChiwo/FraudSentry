// ============================================================
// FraudSentry — OCR Service (REAL text extraction)
//
// Runs Tesseract OCR entirely in the browser via WebAssembly.
// The engine + language data load from a public CDN (jsDelivr) at
// runtime. There is NO fabricated text: if the engine cannot load
// (e.g. offline), we say so honestly and fall back to manual entry.
//
// Reading-accuracy pipeline (money matters, so we try hard):
//   1. Decode upload to a canvas.
//   2. A reusable Tesseract worker is configured for receipts:
//      single-block segmentation + preserved inter-word spacing
//      (keeps "8041 241 631871" intact).
//   3. Three preprocessing passes are recognised — ORIGINAL,
//      ENHANCED (up-scaled + sharpened) and BINARISED (Otsu) — and
//      we keep whichever returns the highest mean word confidence.
//   4. The worker is cached across scans, so the multi-pass read is
//      fast after the first load. If the worker API is unavailable,
//      we fall back to Tesseract's one-shot recognise.
// ============================================================

import { OcrResult } from '../types';

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
// Subresource Integrity hash of the EXACT pinned file above. Computed from the
// real npm package (openssl dgst -sha384 -binary tesseract.min.js | openssl base64 -A).
// If the CDN URL or version ever changes this MUST be recomputed, otherwise the
// browser will (correctly) refuse to execute the script.
const TESSERACT_SRI = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';
declare global { interface Window { Tesseract?: any } }

let loaderPromise: Promise<any> | null = null;
let workerPromise: Promise<any> | null = null;
let workerLangs = 'eng+fil';

function loadTesseract(timeoutMs = 20000): Promise<any> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_CDN; s.async = true;
    s.integrity = TESSERACT_SRI; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
    // A failed load must NOT stay cached — otherwise "Retry scan" could never
    // succeed after the connection comes back (it would replay the old rejection).
    const fail = (msg: string) => {
      clearTimeout(timer);
      s.remove();
      loaderPromise = null;
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail('OCR engine load timed out'), timeoutMs);
    s.onload = () => {
      clearTimeout(timer);
      if (window.Tesseract) resolve(window.Tesseract);
      else fail('OCR engine missing after load');
    };
    s.onerror = () => fail('OCR engine could not be verified or downloaded');
    document.head.appendChild(s);
  });
  return loaderPromise;
}

// Watchdog: Tesseract's worker can fail in ways that never settle its promise
// (e.g. its WebAssembly being blocked aborts the worker silently). Without a
// time limit the scan would spin forever; with one, the user gets the honest
// "OCR engine didn't load — retry" path instead.
const WORKER_INIT_TIMEOUT_MS = 90_000;   // first run downloads ~10 MB of language data
const PASS_TIMEOUT_MS = 60_000;
class OcrTimeout extends Error {}
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new OcrTimeout(`${what} timed out`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
// Forget a broken worker so the next scan (or "Retry scan") builds a fresh one.
function discardWorker() {
  const old = workerPromise;
  workerPromise = null;
  old?.then(w => w?.terminate?.()).catch(() => { /* already dead */ });
}

// Build (once) a receipt-tuned worker; reused across scans for speed.
async function getWorker(T: any): Promise<any | null> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    if (typeof T.createWorker !== 'function') return null;
    let worker: any;
    try {
      worker = await T.createWorker('eng+fil', 1);
      workerLangs = 'eng+fil';
    } catch {
      try { worker = await T.createWorker('eng', 1); workerLangs = 'eng'; }
      catch { return null; }
    }
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '6',          // assume a single uniform block (receipts)
        preserve_interword_spaces: '1',      // keep spacing in reference numbers
      });
    } catch { /* parameters are best-effort */ }
    return worker;
  })();
  return workerPromise;
}

export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
    img.src = url;
  });
}

function drawScaled(img: HTMLImageElement): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const targetW = 2100;            // small phone screenshots need a big upscale to read names
  const maxScale = 4;              // up to 4x for tiny (~450px) receipts
  let scale = 1;
  if (img.naturalWidth < targetW) scale = Math.min(maxScale, targetW / img.naturalWidth);
  let w = Math.round(img.naturalWidth * scale);
  let h = Math.round(img.naturalHeight * scale);
  // bound the long edge so very tall receipts stay fast
  const cap = 5200;
  if (h > cap) { const k = cap / h; w = Math.round(w * k); h = cap; }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  (ctx as any).imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { c, ctx };
}

// The unprocessed original as a canvas. Tesseract re-reads an <img> by its
// src, and fileToImage() has already revoked that blob: URL — so handing it
// the <img> itself made pass 1 fail silently on every scan (only the two
// processed passes ever ran). A canvas carries the pixels directly.
export function originalForOcr(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

export function enhanceForOcr(img: HTMLImageElement): HTMLCanvasElement {
  const { c, ctx } = drawScaled(img);
  const w = c.width, h = c.height;
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
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
  ctx.putImageData(data, 0, 0);
  return c;
}

export function binarizeForOcr(img: HTMLImageElement): HTMLCanvasElement {
  const { c, ctx } = drawScaled(img);
  const w = c.width, h = c.height;
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const hist = new Array(256).fill(0);
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    const v = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    gray[g] = v; hist[v]++;
  }
  const total = w * h;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (wB === 0) continue;
    const wF = total - wB; if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; threshold = t; }
  }
  for (let g = 0, o = 0; g < gray.length; g++, o += 4) {
    const bw = gray[g] >= threshold ? 255 : 0;
    px[o] = px[o + 1] = px[o + 2] = bw;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

// Recognise via the cached worker if available, else the one-shot API.
async function recognise(T: any, worker: any | null, image: HTMLImageElement | HTMLCanvasElement): Promise<{ text: string; conf: number }> {
  if (worker) {
    const { data } = await worker.recognize(image);
    return { text: (data.text || '').trim(), conf: typeof data.confidence === 'number' ? data.confidence : 0 };
  }
  const { data } = await T.recognize(image, workerLangs, {});
  return { text: (data.text || '').trim(), conf: typeof data.confidence === 'number' ? data.confidence : 0 };
}

export async function runOcr(file: File, onStage?: (s: string) => void): Promise<OcrResult> {
  const started = performance.now();
  let T: any;
  try { onStage?.('Loading OCR engine'); T = await loadTesseract(); }
  catch {
    return { text: '', confidence: 0, pass: 'original', wordCount: 0, engine: 'unavailable (offline)', durationMs: Math.round(performance.now() - started), available: false };
  }
  let img: HTMLImageElement;
  try { img = await fileToImage(file); }
  catch { return { text: '', confidence: 0, pass: 'original', wordCount: 0, engine: 'decode failed', durationMs: Math.round(performance.now() - started), available: false }; }

  const unavailable = (engine: string): OcrResult => ({
    text: '', confidence: 0, pass: 'original', wordCount: 0, engine,
    durationMs: Math.round(performance.now() - started), available: false,
  });

  let worker: any = null;
  try {
    onStage?.('Preparing OCR engine');
    worker = await withTimeout(getWorker(T), WORKER_INIT_TIMEOUT_MS, 'OCR engine start-up');
  } catch (e) {
    discardWorker();
    // A hung start-up means the engine itself is broken — the one-shot
    // fallback below would hang the same way, so report it honestly now.
    if (e instanceof OcrTimeout) return unavailable('unavailable (engine failed to start)');
    worker = null;
  }

  const results: { text: string; conf: number; tag: OcrResult['pass'] }[] = [];
  const pass = (src: HTMLImageElement | HTMLCanvasElement, w: any) =>
    withTimeout(recognise(T, w, src), PASS_TIMEOUT_MS, 'OCR pass');

  // Pass 1 — original
  const original = originalForOcr(img);
  try { onStage?.('Reading text (pass 1 of 3)'); const r = await pass(original, worker); results.push({ ...r, tag: 'original' }); }
  catch (e) {
    if (e instanceof OcrTimeout) { discardWorker(); return unavailable('unavailable (engine stopped responding)'); }
    try { const r = await pass(original, null); results.push({ ...r, tag: 'original' }); } catch { /* none */ }
  }
  // Pass 2 — enhanced (up-scaled + sharpened)
  try { onStage?.('Reading text (enhanced pass)'); const r = await pass(enhanceForOcr(img), worker); results.push({ ...r, tag: 'enhanced' }); }
  catch (e) { if (e instanceof OcrTimeout) discardWorker(); }
  // Pass 3 — binarised (Otsu) — reads structured text & names best
  try { onStage?.('Reading text (binarised pass)'); const r = await pass(binarizeForOcr(img), worker); results.push({ ...r, tag: 'binarised' }); }
  catch (e) { if (e instanceof OcrTimeout) discardWorker(); }

  // Every pass failed → the engine did not actually read anything. Don't
  // report an empty read as a successful one.
  if (!results.length) return unavailable('unavailable (no pass completed)');

  // Highest-confidence pass drives the displayed text / confidence; ALL pass
  // texts are returned so the parser can pick the best value for each field.
  // Passes are returned best-confidence FIRST: when the passes disagree on a
  // field and nothing else breaks the tie, the parser favours earlier passes.
  const ordered = results.filter(r => r.text).sort((a, b) => b.conf - a.conf);
  const best = ordered[0] ?? { text: '', conf: 0, tag: 'original' as OcrResult['pass'] };
  const text = best.text;
  return {
    text,
    confidence: Math.round(best.conf),
    pass: best.tag,
    passes: ordered.map(r => r.text),
    passConfidences: ordered.map(r => Math.round(r.conf)),
    wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
    engine: `Tesseract 5 (${workerLangs})`,
    durationMs: Math.round(performance.now() - started),
    available: true,
  };
}
