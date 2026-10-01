// ============================================================
// FraudSentry — Evidence-Feature Dataset
//
// Provides the data the Random Forest learns from. Two sources:
//
//  1. A built-in DEMONSTRATION dataset — synthetically generated
//     (seeded, reproducible) so the model pipeline is runnable out of
//     the box for the defense. It is clearly labelled as a
//     demonstration set in the UI; it is NOT real collected fraud data.
//
//  2. A user-uploaded CSV — so when you collect a real labelled dataset
//     of authentic vs. fraudulent evidence, the SAME pipeline produces
//     your real thesis metrics. Last column must be the label
//     (1 = fraudulent, 0 = legitimate); other numeric columns are
//     features; an optional header row names them.
//
// The feature set mirrors what FraudSentry already extracts from a
// receipt, so the model and the scanner speak the same language.
// ============================================================

import Papa from 'papaparse';
import { Dataset, makeRng } from '../engine/randomForest';
import { EvidenceSource, ExtractedTransactionData, ForensicReport, ImageScanResult, OcrResult } from '../types';

export interface FeatureSpec {
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
  kind: 'percent' | 'binary' | 'count';
}

// The 10 evidence features (these are exactly what the scanner produces).
export const FEATURE_SPECS: FeatureSpec[] = [
  { key: 'ela_hotspot',     label: 'ELA hotspot %',        description: 'Share of the image flagged by Error-Level Analysis (edited regions re-compress differently).', min: 0, max: 100, kind: 'percent' },
  { key: 'has_exif',        label: 'Has EXIF metadata',    description: 'Whether camera/device metadata is embedded (1 = yes).', min: 0, max: 1, kind: 'binary' },
  { key: 'editor_trace',    label: 'Editor signature',     description: 'An image-editor signature (Photoshop, GIMP…) was found in metadata (1 = yes).', min: 0, max: 1, kind: 'binary' },
  { key: 'ocr_confidence',  label: 'OCR confidence',       description: 'Mean confidence of the text recognised on the receipt.', min: 0, max: 100, kind: 'percent' },
  { key: 'ref_present',     label: 'Reference present',    description: 'A reference / transaction number was read (1 = yes).', min: 0, max: 1, kind: 'binary' },
  { key: 'ref_valid',       label: 'Reference valid',      description: 'The reference matches the expected length/character format (1 = yes).', min: 0, max: 1, kind: 'binary' },
  { key: 'institution_known', label: 'Institution known',  description: 'The issuing bank / e-wallet was identified from the text (1 = yes).', min: 0, max: 1, kind: 'binary' },
  { key: 'amount_present',  label: 'Amount present',       description: 'A clearly formatted peso amount was detected (1 = yes).', min: 0, max: 1, kind: 'binary' },
  { key: 'failed_signals',  label: 'Failed checks',        description: 'How many forensic/structure checks did not pass (0–6).', min: 0, max: 6, kind: 'count' },
  { key: 'metadata_consistency', label: 'Metadata consistency', description: 'How internally consistent the file metadata is (higher = cleaner).', min: 0, max: 100, kind: 'percent' },
];

export const CLASS_NAMES: [string, string] = ['Legitimate', 'Fraudulent'];

// ---- Built-in demonstration dataset (seeded → reproducible) ----
export function generateDemoDataset(n = 440, seed = 7): Dataset {
  const rng = makeRng(seed);
  const gauss = (m: number, s: number) => {
    let u = 0, v = 0;
    while (u === 0) u = rng(); while (v === 0) v = rng();
    return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  const bern = (p: number) => (rng() < p ? 1 : 0);

  const X: number[][] = [];
  const y: number[] = [];

  for (let i = 0; i < n; i++) {
    const fraud = rng() < 0.45 ? 1 : 0;
    let row: number[];
    if (fraud) {
      row = [
        clamp(gauss(34, 12), 0, 100),                 // ela hotspot (higher)
        bern(0.25),                                   // has exif (often stripped/forged)
        bern(0.55),                                   // editor trace (more likely)
        clamp(gauss(63, 16), 0, 100),                 // ocr confidence (lower-ish)
        bern(0.45),                                   // ref present (often missing)
        bern(0.30),                                   // ref valid
        bern(0.60),                                   // institution known
        bern(0.80),                                   // amount present
        Math.round(clamp(gauss(2.4, 1.2), 0, 6)),     // failed checks (more)
        clamp(gauss(58, 18), 0, 100),                 // metadata consistency (lower)
      ];
    } else {
      row = [
        clamp(gauss(9, 6), 0, 100),
        bern(0.40),
        bern(0.08),
        clamp(gauss(86, 9), 0, 100),
        bern(0.85),
        bern(0.80),
        bern(0.92),
        bern(0.95),
        Math.round(clamp(gauss(0.5, 0.7), 0, 6)),
        clamp(gauss(90, 8), 0, 100),
      ];
    }
    // ~6% label noise — keeps the problem realistic (no perfect separation)
    let label = fraud;
    if (rng() < 0.06) label = 1 - label;
    X.push(row.map(v => Math.round(v * 100) / 100));
    y.push(label);
  }

  return { X, y, featureNames: FEATURE_SPECS.map(f => f.label), classNames: CLASS_NAMES };
}

// ---- Parse a user-uploaded CSV into a Dataset ----
export function parseCsvDataset(file: File): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (res) => {
        try {
          const rows = res.data as string[][];
          if (!rows.length) return reject(new Error('The CSV appears to be empty.'));
          // detect header: first row non-numeric in last column
          const firstLast = rows[0][rows[0].length - 1];
          const hasHeader = isNaN(parseFloat(firstLast));
          const header = hasHeader ? rows[0] : null;
          const body = hasHeader ? rows.slice(1) : rows;
          const X: number[][] = [], y: number[] = [];
          for (const r of body) {
            if (r.length < 2) continue;
            const nums = r.map(c => parseFloat(c));
            if (nums.some(isNaN)) continue;
            const label = nums[nums.length - 1];
            X.push(nums.slice(0, -1));
            y.push(label >= 1 ? 1 : 0);
          }
          if (X.length < 20) return reject(new Error('Need at least 20 valid rows to train and test meaningfully.'));
          const featureNames = header
            ? header.slice(0, -1)
            : X[0].map((_, i) => `Feature ${i + 1}`);
          resolve({ X, y, featureNames, classNames: CLASS_NAMES });
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Could not parse the CSV.'));
        }
      },
      error: (err) => reject(err),
    });
  });
}

// ---- Turn real scan evidence into the feature vector the model scores ----
// Built from the raw evidence pieces (not a finished ImageScanResult) so the
// scanner can score a receipt through the forest BEFORE its final risk score
// exists — that score is a blend of these forest votes and the rule findings.
export function buildFeatureVector(
  forensics: ForensicReport,
  ocr: OcrResult,
  extracted: ExtractedTransactionData,
  source: EvidenceSource,
  failedChecks: number,
): number[] {
  const refValid = extracted.referenceNo ? (/^[A-Z0-9]{8,20}$/i.test(extracted.referenceNo.replace(/\s/g, '')) ? 1 : 0) : 0;
  const metadataConsistency = clampPct(100 - (forensics.elaHotspotPct ?? 0) - (forensics.editorSoftware ? 25 : 0));
  return [
    forensics.elaHotspotPct ?? 0,
    forensics.hasExif ? 1 : 0,
    forensics.editorSoftware ? 1 : 0,
    ocr.available ? ocr.confidence : 0,
    extracted.referenceNo ? 1 : 0,
    refValid,
    source !== 'Unknown' ? 1 : 0,
    extracted.amount != null ? 1 : 0,
    Math.min(6, failedChecks),
    metadataConsistency,
  ];
}

export function featureVectorFromScan(scan: ImageScanResult): number[] {
  return buildFeatureVector(scan.forensics, scan.ocr, scan.extracted, scan.source,
    scan.findings.filter(s => !s.passed).length);
}
function clampPct(x: number) { return Math.max(0, Math.min(100, Math.round(x))); }

// ---- Does a dataset describe the SAME 10 evidence features the scanner produces? ----
// Only such a model may be connected to live scans. A CSV with other columns
// (e.g. the PaySim transaction dataset: type, amount, balances…) can still be
// trained and evaluated on the Model page, but feeding receipt evidence into
// trees whose split features mean "account balance" would produce a number
// that looks like a fraud probability yet means nothing. Headerless CSVs are
// rejected too, because their column meaning can't be confirmed.
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export function isEvidenceSchema(featureNames: string[]): boolean {
  if (featureNames.length !== FEATURE_SPECS.length) return false;
  return FEATURE_SPECS.every((spec, i) => {
    const n = normName(featureNames[i] ?? '');
    return n === normName(spec.key) || n === normName(spec.label);
  });
}
