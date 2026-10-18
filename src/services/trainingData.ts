// ============================================================
// FraudSentry — labelled training data from your own scans
//
// The built-in forest is trained on a SEEDED DEMONSTRATION dataset. To get
// real thesis metrics, the forest must learn from real evidence: receipts you
// scanned and then labelled as genuine or fake.
//
// What is kept for each labelled scan: only the 10 numeric evidence features
// the forest scored at scan time (ELA %, OCR confidence, "reference present",
// …) and the label. No name, number, amount, reference or text — so it is
// not personal data and is not removed by the 30-day history expiry.
//
// Training uses a fixed, seeded 70/30 split, so the same rows always build
// the same forest: the model connected on the Model page is rebuilt exactly
// when the app reopens (restoreLabelledModel).
// ============================================================
import { RandomForest, trainTestSplit, computeMetrics, type Dataset, type Metrics } from '../engine/randomForest';
import { FEATURE_SPECS, CLASS_NAMES, featureVectorFromScan } from './sampleDataset';
import type { ImageScanResult } from '../types';
import { restoreSharedModel } from '../engine/sharedModel';

export interface TrainingRow {
  /** the scan this row came from */
  id: string;
  /** the 10 evidence features, in FEATURE_SPECS order */
  features: number[];
  /** 1 = fake (fraudulent), 0 = genuine */
  label: 0 | 1;
  addedAt: string;
}

export interface LabelledModelOptions {
  nTrees: number; maxDepth: number;
  /** the rows the connected model was trained on, so reopening the app rebuilds exactly that model */
  rowIds?: string[];
}

export const MIN_ROWS = 20;       // same floor as an uploaded CSV
export const MIN_PER_CLASS = 5;   // a split needs examples of both classes
const SPLIT_SEED = 42, TEST_RATIO = 0.3;

/** The exact vector the forest scored for this scan (recorded since V8.5); older scans are rebuilt from their evidence. */
export function featuresOf(scan: ImageScanResult): number[] {
  const f = scan.forestAnalysis?.features;
  return f && f.length === FEATURE_SPECS.length ? f : featureVectorFromScan(scan);
}

export function rowFromScan(scan: ImageScanResult, label: 0 | 1, now = new Date()): TrainingRow {
  return { id: scan.id, features: featuresOf(scan), label, addedAt: now.toISOString() };
}

export function counts(rows: TrainingRow[]) {
  const fake = rows.filter(r => r.label === 1).length;
  return { total: rows.length, fake, genuine: rows.length - fake };
}

/** Can these rows train and test a forest? If not, what is missing (plain words). */
export function readiness(rows: TrainingRow[]): { ok: boolean; message: string } {
  const c = counts(rows);
  const need: string[] = [];
  if (c.total < MIN_ROWS) need.push(`${MIN_ROWS - c.total} more labelled receipt${MIN_ROWS - c.total === 1 ? '' : 's'}`);
  if (c.genuine < MIN_PER_CLASS) need.push(`at least ${MIN_PER_CLASS} genuine (have ${c.genuine})`);
  if (c.fake < MIN_PER_CLASS) need.push(`at least ${MIN_PER_CLASS} fake (have ${c.fake})`);
  return need.length
    ? { ok: false, message: `Need ${need.join(', ')} before training.` }
    : { ok: true, message: `${c.total} labelled receipts: ${c.genuine} genuine, ${c.fake} fake.` };
}

export function datasetFromRows(rows: TrainingRow[]): Dataset {
  return {
    X: rows.map(r => r.features.slice()),
    y: rows.map(r => r.label),
    featureNames: FEATURE_SPECS.map(f => f.key),
    classNames: CLASS_NAMES,
  };
}

/** CSV the Model page (and any other tool) can train on: the 10 feature keys, then the label. */
export function rowsToCsv(rows: TrainingRow[]): string {
  const head = [...FEATURE_SPECS.map(f => f.key), 'label'].join(',');
  return [head, ...rows.map(r => [...r.features, r.label].join(','))].join('\n') + '\n';
}

export interface LabelledTraining { rf: RandomForest; metrics: Metrics; trainRows: number; testRows: number; importances: number[] }

/** Seeded 70/30 split → train → evaluate on the held-out 30 %. Same rows ⇒ same forest. */
export async function trainOnRows(rows: TrainingRow[], opts: LabelledModelOptions, background = false): Promise<LabelledTraining> {
  const { train, test } = trainTestSplit(datasetFromRows(rows), TEST_RATIO, SPLIT_SEED);
  const rf = new RandomForest({ nTrees: opts.nTrees, maxDepth: opts.maxDepth, minSamplesSplit: 4, seed: 42 });
  if (background) await rf.fitAsync(train.X, train.y); else rf.fit(train.X, train.y);
  const metrics = computeMetrics(test.y, rf.predictBatch(test.X));
  return { rf, metrics, trainRows: train.y.length, testRows: test.y.length, importances: rf.importances };
}

/** Rebuild (in the background) the forest you connected from your labelled scans. */
export function restoreLabelledModel(rows: TrainingRow[], opts: LabelledModelOptions): Promise<void> {
  const ids = opts.rowIds ? new Set(opts.rowIds) : null;
  const used = ids ? rows.filter(r => ids.has(r.id)) : rows;
  return restoreSharedModel(async () => {
    if (!readiness(used).ok) return null;
    const t = await trainOnRows(used, opts, true);
    return {
      rf: t.rf, featureNames: FEATURE_SPECS.map(f => f.key),
      info: { datasetSource: 'labelled', nTrees: opts.nTrees, maxDepth: opts.maxDepth, trainRows: t.trainRows },
    };
  });
}
