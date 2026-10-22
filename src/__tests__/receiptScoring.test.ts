// End-to-end scoring of real receipts (redacted OCR text from real screenshots):
// genuine receipts must not be rated "possibly fraudulent", edited ones must be.
// The file reading, OCR engine and pixel checks are replaced with fixed values,
// so the whole rule + Random Forest pipeline runs on the real OCR text.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ForensicReport, OcrResult, OcrWord } from '../types';
import type { ObscuredRegion } from '../services/obscuredRegions';

const state: { passes: string[]; words?: OcrWord[]; regions: ObscuredRegion[] } = { passes: [], regions: [] };

vi.mock('../services/ocr', async importActual => ({
  ...(await importActual<typeof import('../services/ocr')>()),
  runOcr: async (): Promise<OcrResult> => ({
    text: state.passes[0], passes: state.passes, confidence: 88, pass: 'original',
    wordCount: state.passes[0].split(/\s+/).length, engine: 'test', durationMs: 0, available: true, words: state.words,
  }),
}));
vi.mock('../services/imageForensics', async importActual => {
  const actual = await importActual<typeof import('../services/imageForensics')>();
  return {
    ...actual,
    inkCheckForFile: async () => ({ status: 'consistent', outliers: [], detail: '' }),
    // a plain phone screenshot: PNG, no metadata, normal ELA
    analyzeForensics: async (): Promise<ForensicReport> => ({
      width: 1080, height: 2340, aspectRatio: '19.5:9', fileSizeBytes: 300_000, declaredType: 'image/png', sniffType: 'image/png',
      hasExif: false, editorSoftware: null, jpegProgressive: null, elaScore: 8, elaHotspotPct: 6, elaThumbnail: null,
      obscuredRegions: state.regions,
      signals: actual.buildForensicSignals({ sniff: 'image/png', declaredType: 'image/png', jpeg: { hasExif: false, software: null, progressive: null }, width: 1080, height: 2340, ela: { mean: 8, hotspotPct: 6 } }),
    }),
  };
});

const { analyzeTransactionImage } = await import('../engine/imageVerification');

type Fixture = Record<string, { passes: string[]; filename?: string }>;
const dir = path.join(__dirname, 'fixtures');
const all: [string, string[]][] = fs.readdirSync(dir).filter(n => n.endsWith('.json'))
  .flatMap(f => Object.entries(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Fixture).map(([k, v]) => [k, v.passes] as [string, string[]]));
const EDITED = /blurred|pixelated|edited|unsent/;
const NOW = new Date('2030-01-01T00:00:00Z');   // after every fixture's date
const file = new File([new Uint8Array(8)], 'receipt.png', { type: 'image/png' });

async function score(passes: string[], words?: OcrWord[], regions: ObscuredRegion[] = []) {
  state.passes = passes; state.words = words; state.regions = regions;
  return analyzeTransactionImage(file, { now: NOW });
}

describe('real receipts: genuine ones are not flagged', () => {
  it.each(all.filter(([k]) => !EDITED.test(k)))('%s is rated Low or Medium', async (_k, passes) => {
    const r = await score(passes);
    expect(['low', 'medium'], r.findings.filter(f => !f.passed).map(f => f.label).join(', ')).toContain(r.riskLevel);
  });
});

describe('real receipts: edited or unsent ones are flagged', () => {
  it.each(all.filter(([k]) => EDITED.test(k)))('%s is rated High or Critical', async (_k, passes) => {
    const r = await score(passes);
    expect(['high', 'critical']).toContain(r.riskLevel);
  });
});

describe('a blurred area only makes a receipt unverifiable when it covers a key detail', () => {
  const gcash = all.find(([k]) => k === 'gcash_express_send')![1];
  // where OCR placed the amount and the reference line
  const words: OcrWord[] = [
    { text: 'Amount', x0: 60, y0: 1100, x1: 220, y1: 1140 }, { text: '215.00', x0: 860, y0: 1100, x1: 1000, y1: 1140 },
    { text: 'Ref', x0: 60, y0: 1400, x1: 110, y1: 1440 }, { text: 'No.', x0: 118, y0: 1400, x1: 170, y1: 1440 },
  ];
  const region = (y: number): ObscuredRegion => ({ kind: 'pixelated', x: 100, y, w: 800, h: 60, tiles: 12 });

  it('an ad photo or status-bar icon (away from every key field) leaves a genuine GCash receipt below High', async () => {
    for (const y of [10, 1600, 1900]) {
      const r = await score(gcash, words, [region(y)]);
      expect(['low', 'medium'], `y=${y}`).toContain(r.riskLevel);
      expect(r.findings.some(f => !f.passed && f.label === 'Blurred or Covered Area')).toBe(true);
      expect(r.findings.some(f => !f.passed && f.label === 'Hidden or Blocked-Out Details')).toBe(false);
    }
  });
  it.each([['the reference', 1395], ['the amount', 1095]])('a blur over %s is rated High or Critical', async (_what, y) => {
    const r = await score(gcash, words, [region(y as number)]);
    expect(['high', 'critical']).toContain(r.riskLevel);
    expect(r.findings.some(f => !f.passed && f.label === 'Hidden or Blocked-Out Details')).toBe(true);
  });
  it('when OCR placed no key field, a blur anywhere is still rated High', async () => {
    const r = await score(gcash, undefined, [region(1600)]);
    expect(['high', 'critical']).toContain(r.riskLevel);
  });
});
