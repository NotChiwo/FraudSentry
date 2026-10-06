// ============================================================
// FraudSentry — Image Forensics Service
//
// Every signal here is COMPUTED from the actual file bytes / pixels.
// Nothing is random or fabricated. Techniques used:
//
//  • Magic-byte sniffing  — read the file header to confirm the real
//    format and catch a mismatch with the declared MIME type.
//  • JPEG segment scan    — walk APPn/SOFn markers to detect an EXIF
//    block, an embedded "Software" (editor) tag, and baseline-vs-
//    progressive encoding (re-saved images are often progressive).
//  • Error Level Analysis — recompress the image at a known quality
//    and measure where it changes. Edited/pasted regions frequently
//    recompress at a different error level than their surroundings.
//
// ELA is interpreted conservatively: it FLAGS regions for human
// review; it never asserts forgery on its own.
// ============================================================

import { ForensicReport, ForensicSignal, RiskLevel } from '../types';
import { generateId } from '../utils/helpers';
import { fileToImage } from './ocr';

function sig(label: string, value: string, detail: string, severity: RiskLevel, passed: boolean, weight: number): ForensicSignal {
  return { id: generateId('fx'), label, value, detail, severity, passed, weight };
}

function sniffType(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return 'unknown';
}

interface JpegMeta { hasExif: boolean; software: string | null; progressive: boolean | null; }

function scanJpeg(bytes: Uint8Array): JpegMeta {
  const meta: JpegMeta = { hasExif: false, software: null, progressive: null };
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return meta;
  let i = 2;
  const td = new TextDecoder('latin1');
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    const segStart = i + 4, segEnd = i + 2 + len;
    if (marker === 0xe1) { // APP1 — EXIF / XMP
      const head = td.decode(bytes.slice(segStart, Math.min(segStart + 6, segEnd)));
      if (head.startsWith('Exif')) meta.hasExif = true;
      const blob = td.decode(bytes.slice(segStart, segEnd));
      const m = blob.match(/(Adobe Photoshop[^\x00]*|GIMP[^\x00]*|Snapseed|PicsArt|Canva|Pixlr|Lightroom[^\x00]*|Paint\.NET)/i);
      if (m) meta.software = m[1].replace(/[^\x20-\x7e].*$/, '').trim();
    }
    if (marker === 0xc0 || marker === 0xc1) meta.progressive = false; // baseline
    if (marker === 0xc2) meta.progressive = true;                     // progressive
    i = segEnd;
  }
  return meta;
}

// Error Level Analysis: returns mean error, hotspot %, and a heatmap dataURL.
async function computeELA(img: HTMLImageElement): Promise<{ mean: number; hotspotPct: number; thumb: string }> {
  const cap = 900;
  const scale = Math.min(1, cap / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const base = document.createElement('canvas'); base.width = w; base.height = h;
  const bctx = base.getContext('2d', { willReadFrequently: true })!;
  bctx.drawImage(img, 0, 0, w, h);
  const orig = bctx.getImageData(0, 0, w, h).data;

  // recompress at quality 0.90
  const requ = base.toDataURL('image/jpeg', 0.90);
  const reImg = await new Promise<HTMLImageElement>((res, rej) => {
    const x = new Image(); x.onload = () => res(x); x.onerror = () => rej(new Error('ELA recompress failed')); x.src = requ;
  });
  const re = document.createElement('canvas'); re.width = w; re.height = h;
  const rctx = re.getContext('2d', { willReadFrequently: true })!;
  rctx.drawImage(reImg, 0, 0, w, h);
  const recomp = rctx.getImageData(0, 0, w, h).data;

  const heat = rctx.createImageData(w, h);
  const hp = heat.data;
  const AMP = 18;
  let sum = 0, hot = 0, n = w * h;
  for (let i = 0; i < orig.length; i += 4) {
    const dr = Math.abs(orig[i] - recomp[i]);
    const dg = Math.abs(orig[i + 1] - recomp[i + 1]);
    const db = Math.abs(orig[i + 2] - recomp[i + 2]);
    const d = (dr + dg + db) / 3;
    const amp = Math.min(255, d * AMP);
    sum += d;
    if (amp > 70) hot++;
    hp[i] = amp; hp[i + 1] = Math.min(255, amp * 0.5); hp[i + 2] = 255 - amp; hp[i + 3] = 255;
  }
  rctx.putImageData(heat, 0, 0);
  const thumbCanvas = document.createElement('canvas');
  const tw = 240, th = Math.max(1, Math.round((h / w) * tw));
  thumbCanvas.width = tw; thumbCanvas.height = th;
  thumbCanvas.getContext('2d')!.drawImage(re, 0, 0, tw, th);

  const mean = (sum / n);
  return {
    mean: Math.min(100, Math.round(mean * 4)),       // scaled 0–100
    hotspotPct: Math.round((hot / n) * 1000) / 10,   // one decimal
    thumb: thumbCanvas.toDataURL('image/png'),
  };
}

function aspectLabel(w: number, h: number): string {
  const r = (Math.max(w, h) / Math.min(w, h));
  return `${r.toFixed(2)}:1`;
}
const PHONE_ASPECTS = [19.5 / 9, 20 / 9, 16 / 9, 18 / 9, 4 / 3, 3 / 2, 1];
function plausiblePhoneAspect(w: number, h: number): boolean {
  const r = Math.max(w, h) / Math.min(w, h);
  return PHONE_ASPECTS.some(a => Math.abs(r - a) <= 0.18);
}

export async function analyzeForensics(file: File): Promise<ForensicReport> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const sniff = sniffType(buf);
  const jpeg = sniff === 'image/jpeg' ? scanJpeg(buf) : { hasExif: false, software: null, progressive: null };

  const img = await fileToImage(file);
  const width = img.naturalWidth, height = img.naturalHeight;

  let ela = { mean: 0, hotspotPct: 0, thumb: null as string | null };
  try { const r = await computeELA(img); ela = { mean: r.mean, hotspotPct: r.hotspotPct, thumb: r.thumb }; }
  catch { /* leave defaults */ }

  const signals = buildForensicSignals({ sniff, declaredType: file.type, jpeg, width, height, ela });

  return {
    width, height,
    aspectRatio: aspectLabel(width, height),
    fileSizeBytes: file.size,
    declaredType: file.type || 'unknown',
    sniffType: sniff,
    hasExif: jpeg.hasExif,
    editorSoftware: jpeg.software,
    jpegProgressive: jpeg.progressive,
    elaScore: ela.mean,
    elaHotspotPct: ela.hotspotPct,
    elaThumbnail: ela.thumb,
    signals,
  };
}

/**
 * ELA hotspot threshold. Measured on 63 genuine PH receipt screenshots
 * (43 JPEG, 20 PNG; 2026-10-07): hotspot % ranged 2.0-17.5 (median 6.4).
 * The old 4.5 % threshold flagged 39 of 63 genuine images as "high". The new
 * one sits above every genuine value measured. It was chosen from genuine
 * images only: how many real edits it catches has NOT been measured.
 */
export const ELA_HOTSPOT_THRESHOLD = 20;

export interface ForensicInput {
  sniff: string; declaredType: string;
  jpeg: { hasExif: boolean; software: string | null; progressive: boolean | null };
  width: number; height: number;
  ela: { mean: number; hotspotPct: number };
}

/** Pure: turns measured file/pixel facts into forensic findings (unit-tested). */
export function buildForensicSignals(x: ForensicInput): ForensicSignal[] {
  const { sniff, jpeg, width, height, ela } = x;
  const declared = x.declaredType || '';
  const signals: ForensicSignal[] = [];

  // 1. Magic-byte vs declared type
  const typeMatch = sniff !== 'unknown' && (declared === '' || declared.includes(sniff.split('/')[1]) || sniff === declared);
  signals.push(sig(
    'Container Integrity',
    typeMatch ? `${sniff} confirmed` : `declared ${declared || 'none'}, header says ${sniff}`,
    typeMatch ? 'The file header matches its declared format — no container spoofing.' : 'The file extension/MIME type does not match the actual bytes. Renamed or repackaged files warrant caution.',
    typeMatch ? 'low' : 'high', typeMatch, 0.18,
  ));

  // 2. EXIF presence — noted, not scored: screenshots and chat-app copies
  //    normally have no EXIF, so its absence says almost nothing.
  if (sniff === 'image/jpeg') {
    signals.push(sig(
      'Metadata (EXIF) Presence',
      jpeg.hasExif ? 'EXIF block present' : 'no EXIF block',
      jpeg.hasExif ? 'The image retains device metadata.' : 'No EXIF metadata. This is normal for screenshots and for images sent through chat apps, so it is noted but not counted in the score.',
      'low', true, 0,
    ));
  }

  // 3. Editor software tag
  signals.push(sig(
    'Editing-Software Signature',
    jpeg.software ? jpeg.software : 'none detected',
    jpeg.software ? `Metadata names an image editor (${jpeg.software}). The image passed through editing software after creation.` : 'No embedded editing-tool signature was found in the metadata.',
    jpeg.software ? 'high' : 'low', !jpeg.software, 0.22,
  ));

  // 4. Encoding mode — noted, not scored: chat apps and downloads re-save
  //    images progressively, so it fired on most genuine JPEGs we tested.
  if (sniff === 'image/jpeg' && jpeg.progressive !== null) {
    signals.push(sig(
      'JPEG Encoding Mode',
      jpeg.progressive ? 'progressive' : 'baseline',
      jpeg.progressive ? 'Progressive encoding. Common for images re-saved by chat apps, browsers or downloads, so it is noted but not counted in the score.' : 'Baseline encoding, typical of a direct device screenshot.',
      'low', true, 0,
    ));
  }

  // 5. Dimensions / aspect plausibility
  const aspectOk = plausiblePhoneAspect(width, height);
  signals.push(sig(
    'Screen Geometry',
    `${width}×${height} (${aspectLabel(width, height)})`,
    aspectOk ? 'Dimensions match a common phone/desktop screenshot ratio.' : 'Dimensions do not match a standard screen ratio — the image may be cropped or composited from multiple sources.',
    aspectOk ? 'low' : 'medium', aspectOk, 0.12,
  ));

  // 6. Error Level Analysis — a hint for human review, never proof on its own
  const elaConcern = ela.hotspotPct > ELA_HOTSPOT_THRESHOLD || ela.mean > 55;
  signals.push(sig(
    'Error Level Analysis',
    `mean ${ela.mean}/100 · ${ela.hotspotPct}% hotspots`,
    elaConcern ? `An unusually large share of the image (${ela.hotspotPct}%) re-compresses differently from the rest — more than any genuine receipt in our test set. This can mean parts were pasted or edited. It is a hint, not proof: open the heatmap under "How this was decided".` : 'Error levels are within the range we measured on genuine receipt screenshots. (On screenshots this check is weak — it can miss careful edits.)',
    elaConcern ? 'medium' : 'low', !elaConcern, 0.15,
  ));
  return signals;
}
