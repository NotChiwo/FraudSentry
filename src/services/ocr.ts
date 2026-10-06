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

import { OcrResult, OcrWord } from '../types';
import { scaledSize, enhancePixels, binarizePixels } from './ocrFilters';
import PrepWorker from './ocrPreprocess.worker?worker&inline';

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
// Tesseract reports recognition progress through the logger given at worker
// creation; route it to whichever pass is running now.
let currentProgress: ((p: number) => void) | null = null;
const logger = (m: { status?: string; progress?: number }) => {
  if (m?.status === 'recognizing text' && typeof m.progress === 'number') currentProgress?.(m.progress);
};

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
      worker = await T.createWorker('eng+fil', 1, { logger });
      workerLangs = 'eng+fil';
    } catch {
      try { worker = await T.createWorker('eng', 1, { logger }); workerLangs = 'eng'; }
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
  const { w, h } = scaledSize(img.naturalWidth, img.naturalHeight);
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

// Main-thread versions — used only when OffscreenCanvas / workers are unavailable.
export function enhanceForOcr(img: HTMLImageElement): HTMLCanvasElement {
  const { c, ctx } = drawScaled(img);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  enhancePixels(data.data, c.width, c.height);
  ctx.putImageData(data, 0, 0);
  return c;
}
export function binarizeForOcr(img: HTMLImageElement): HTMLCanvasElement {
  const { c, ctx } = drawScaled(img);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  binarizePixels(data.data);
  ctx.putImageData(data, 0, 0);
  return c;
}

// ── Off-main-thread preprocessing ───────────────────────────────────────
let prepWorker: Worker | null = null;
let prepSeq = 0;
/**
 * Enhanced + binarised passes. The up-scale happens here (fast, GPU-backed);
 * the slow per-pixel filters run in a Web Worker. Returns null on any worker
 * problem so the caller falls back to the main-thread filters (same pixels).
 */
async function preprocessOffThread(img: HTMLImageElement): Promise<{ enhanced: HTMLCanvasElement; binarised: HTMLCanvasElement } | null> {
  if (typeof Worker === 'undefined') return null;
  try {
    if (!prepWorker) prepWorker = new PrepWorker();
    const { c, ctx } = drawScaled(img);
    const w = c.width, h = c.height;
    const pixels = ctx.getImageData(0, 0, w, h);
    const id = ++prepSeq;
    const wk: Worker = prepWorker;
    const out = await withTimeout(new Promise<{ enhanced: ArrayBuffer; binarised: ArrayBuffer }>((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        if (e.data?.id !== id) return;
        wk.removeEventListener('message', onMsg);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve({ enhanced: e.data.enhanced, binarised: e.data.binarised });
      };
      wk.addEventListener('message', onMsg);
      wk.addEventListener('error', () => reject(new Error('preprocess worker failed')), { once: true });
      wk.postMessage({ id, buf: pixels.data.buffer, w, h }, [pixels.data.buffer]);
    }), 45_000, 'image preprocessing');
    const toCanvas = (buf: ArrayBuffer) => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
      return cv;
    };
    return { enhanced: toCanvas(out.enhanced), binarised: toCanvas(out.binarised) };
  } catch {
    prepWorker?.terminate(); prepWorker = null;
    return null;
  }
}

type OcrSource = HTMLImageElement | HTMLCanvasElement | Blob;

// Recognise via the cached worker if available, else the one-shot API.
async function recognise(T: any, worker: any | null, image: OcrSource, withWords = false): Promise<{ text: string; conf: number; words?: OcrWord[] }> {
  const pick = (data: any) => ({
    text: (data.text || '').trim(),
    conf: typeof data.confidence === 'number' ? data.confidence : 0,
    words: withWords ? collectWords(data) : undefined,
  });
  if (worker) {
    const { data } = await worker.recognize(image, {}, withWords ? { text: true, blocks: true } : undefined);
    return pick(data);
  }
  const { data } = await T.recognize(image, workerLangs, {});
  return pick(data);
}

/** Flatten Tesseract's block / paragraph / line / word tree into positioned words. */
function collectWords(data: any): OcrWord[] {
  const out: OcrWord[] = [];
  const push = (w: any) => { if (w?.text && w.bbox) out.push({ text: String(w.text), x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }); };
  if (Array.isArray(data.words) && data.words.length) data.words.forEach(push);
  else for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) push(w);
  return out;
}

/** Thrown when the user cancels a scan. */
export class OcrCancelled extends Error { constructor() { super('Scan cancelled'); } }

export interface OcrProgress {
  /** engine = loading/starting Tesseract; prepare = building the image passes; read = recognising pass N */
  phase: 'engine' | 'prepare' | 'read';
  pass?: 1 | 2 | 3;
  /** 0-1 exactly as reported by Tesseract for the current pass */
  progress?: number;
  /** sent once, when pass 1 finishes: the words it found and where (original-image pixels) */
  words?: OcrWord[];
  imageSize?: { w: number; h: number };
}

export async function runOcr(
  file: File,
  onStage?: (s: string) => void,
  opts?: { signal?: AbortSignal; onProgress?: (p: OcrProgress) => void },
): Promise<OcrResult> {
  const started = performance.now();
  const signal = opts?.signal;
  const report = opts?.onProgress;
  const checkCancel = () => { if (signal?.aborted) throw new OcrCancelled(); };
  // Tesseract cannot abort a recognise in progress, so cancelling stops the
  // worker; the next scan builds a fresh one (language data stays cached).
  const onAbort = () => discardWorker();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let T: any;
    try { onStage?.('Loading OCR engine'); report?.({ phase: 'engine' }); T = await loadTesseract(); }
    catch {
      return { text: '', confidence: 0, pass: 'original', wordCount: 0, engine: 'unavailable (offline)', durationMs: Math.round(performance.now() - started), available: false };
    }
    checkCancel();
    let img: HTMLImageElement;
    try { img = await fileToImage(file); }
    catch { return { text: '', confidence: 0, pass: 'original', wordCount: 0, engine: 'decode failed', durationMs: Math.round(performance.now() - started), available: false }; }

    const unavailable = (engine: string): OcrResult => ({
      text: '', confidence: 0, pass: 'original', wordCount: 0, engine,
      durationMs: Math.round(performance.now() - started), available: false,
    });

    // Build the processed passes in the background straight away; this
    // overlaps with engine start-up and pass 1.
    const prepared = preprocessOffThread(img);

    let worker: any = null;
    try {
      onStage?.('Preparing OCR engine');
      worker = await withTimeout(getWorker(T), WORKER_INIT_TIMEOUT_MS, 'OCR engine start-up');
    } catch (e) {
      discardWorker();
      checkCancel();
      // A hung start-up means the engine itself is broken; the one-shot
      // fallback below would hang the same way, so report it honestly now.
      if (e instanceof OcrTimeout) return unavailable('unavailable (engine failed to start)');
      worker = null;
    }
    checkCancel();

    const results: { text: string; conf: number; tag: OcrResult['pass'] }[] = [];
    let words: OcrWord[] | undefined;
    const pass = (src: OcrSource, w: any, n: 1 | 2 | 3, withWords = false) => {
      currentProgress = p => report?.({ phase: 'read', pass: n, progress: p });
      report?.({ phase: 'read', pass: n, progress: 0 });
      return withTimeout(recognise(T, w, src, withWords), PASS_TIMEOUT_MS, 'OCR pass');
    };

    // Pass 1 — original (also yields word positions for the on-image highlights)
    const original = originalForOcr(img);
    try { onStage?.('Reading text (pass 1 of 3)'); const r = await pass(original, worker, 1, true); results.push({ ...r, tag: 'original' }); words = r.words;
      report?.({ phase: 'read', pass: 1, progress: 1, words, imageSize: { w: img.naturalWidth, h: img.naturalHeight } }); }
    catch (e) {
      checkCancel();
      if (e instanceof OcrTimeout) { discardWorker(); return unavailable('unavailable (engine stopped responding)'); }
      try { const r = await pass(original, null, 1); results.push({ ...r, tag: 'original' }); } catch { /* none */ }
    }
    checkCancel();
    report?.({ phase: 'prepare' });
    const off = await prepared;
    // Pass 2 — enhanced (up-scaled + sharpened)
    try { onStage?.('Reading text (enhanced pass)'); const r = await pass(off ? off.enhanced : enhanceForOcr(img), worker, 2); results.push({ ...r, tag: 'enhanced' }); }
    catch (e) { checkCancel(); if (e instanceof OcrTimeout) discardWorker(); }
    checkCancel();
    // Pass 3 — binarised (Otsu) — reads structured text & names best
    try { onStage?.('Reading text (binarised pass)'); const r = await pass(off ? off.binarised : binarizeForOcr(img), worker, 3); results.push({ ...r, tag: 'binarised' }); }
    catch (e) { checkCancel(); if (e instanceof OcrTimeout) discardWorker(); }
    checkCancel();

    // Every pass failed: the engine did not actually read anything. Don't
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
      words,
      imageSize: { w: img.naturalWidth, h: img.naturalHeight },
    };
  } finally {
    currentProgress = null;
    signal?.removeEventListener('abort', onAbort);
  }
}
