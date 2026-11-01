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
import { RandomForest, trainTestSplit, computeMetrics, type Dataset, type Metrics } from './randomForest';
import { rocAuc, rocCurve, mcnemar, type RocPoint, type McNemar } from './evaluation';
import { FRAUD_THRESHOLD, blendScore } from '../shared/helpers';
import { FEATURE_SPECS, CLASS_NAMES, featureVectorFromScan } from './sampleDataset';
import type { ImageScanResult } from '../shared/types';
import { restoreSharedModel } from './sharedModel';

export interface TrainingRow {
  /** the scan this row came from */
  id: string;
  /** the 10 evidence features, in FEATURE_SPECS order */
  features: number[];
  /** 1 = fake (fraudulent), 0 = genuine */
  label: 0 | 1;
  addedAt: string;
  /** the rule-based score and the floor of that scan, so rules alone can be compared with the forest */
  ruleScore?: number;
  scoreFloor?: number;
  /** a photo of a screen: the app scored it with the rules alone (see verifyReceipt.ts) */
  photo?: boolean;
}

export interface LabelledModelOptions {
  nTrees: number; maxDepth: number;
  /** the rows the connected model was trained on, so reopening the app rebuilds exactly that model */
  rowIds?: string[];
  /** its model-registry id and name */
  modelId?: string;
  modelName?: string;
  trainedAt?: string;
}

export const MIN_ROWS = 20;       // same floor as an uploaded CSV
export const MIN_PER_CLASS = 5;   // a split needs examples of both classes
const SPLIT_SEED = 42, TEST_RATIO = 0.3;

/** The exact vector the forest scored for this scan ; older scans are rebuilt from their evidence. */
export function featuresOf(scan: ImageScanResult): number[] {
  const f = scan.forestAnalysis?.features;
  return f && f.length === FEATURE_SPECS.length ? f : featureVectorFromScan(scan);
}

export function rowFromScan(scan: ImageScanResult, label: 0 | 1, now = new Date()): TrainingRow {
  const row: TrainingRow = { id: scan.id, features: featuresOf(scan), label, addedAt: now.toISOString() };
  if (typeof scan.heuristicScore === 'number') { row.ruleScore = scan.heuristicScore; row.scoreFloor = scan.scoreFloor ?? 0; }
  if (scan.forensics?.capture === 'photo') row.photo = true;
  return row;
}

export function counts(rows: TrainingRow[]) {
  const fake = rows.filter(r => r.label === 1).length;
  return { total: rows.length, fake, genuine: rows.length - fake };
}

/** Can these rows train and test a forest? If not, what is missing (plain words). */
export function readiness(rows: TrainingRow[]): { ok: boolean; message: string } {
  const unique = uniqueRows(rows);
  const c = counts(unique);
  const dup = rows.length - unique.length;
  const need: string[] = [];
  if (c.total < MIN_ROWS) need.push(`${MIN_ROWS - c.total} more labelled receipt${MIN_ROWS - c.total === 1 ? '' : 's'}`);
  if (c.genuine < MIN_PER_CLASS) need.push(`at least ${MIN_PER_CLASS} genuine (have ${c.genuine})`);
  if (c.fake < MIN_PER_CLASS) need.push(`at least ${MIN_PER_CLASS} fake (have ${c.fake})`);
  return need.length
    ? { ok: false, message: `Need ${need.join(', ')} before training.` }
    : { ok: true, message: `${c.total} labelled receipts: ${c.genuine} genuine, ${c.fake} fake.${dup ? ` (${dup} duplicate${dup === 1 ? '' : 's'} not counted.)` : ''}` };
}

/**
 * Drop exact duplicates (same 10 features, same label): the same screenshot
 * scanned and labelled twice. Kept, one copy could land in the training set
 * and the other in the test set, and the model would be "tested" on a receipt
 * it has already seen — inflating every metric.
 */
export function uniqueRows(rows: TrainingRow[]): TrainingRow[] {
  const seen = new Set<string>();
  return rows.filter(r => {
    const key = `${r.label}|${r.features.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The training set from labelled rows (exact duplicates removed, see uniqueRows). */
export function datasetFromRows(rows: TrainingRow[]): Dataset {
  rows = uniqueRows(rows);
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

export interface Evaluation { metrics: Metrics; rocAuc: number | null; roc: RocPoint[] }
export interface LabelledTraining extends Evaluation { rf: RandomForest; trainRows: number; testRows: number; importances: number[] }

/** Held-out metrics of a trained forest, including ROC-AUC from its fraud probabilities. */
export function evaluateForest(rf: RandomForest, test: { X: number[][]; y: number[] }): Evaluation {
  const proba = test.X.map(x => rf.predictProba(x));
  return { metrics: computeMetrics(test.y, proba.map(p => (p >= 0.5 ? 1 : 0))), rocAuc: rocAuc(test.y, proba), roc: rocCurve(test.y, proba) };
}

/** Seeded 70/30 split → train → evaluate on the held-out 30 %. Same rows ⇒ same forest. (Duplicates are removed by datasetFromRows.) */
export async function trainOnRows(rows: TrainingRow[], opts: LabelledModelOptions, background = false): Promise<LabelledTraining> {
  const { train, test } = trainTestSplit(datasetFromRows(rows), TEST_RATIO, SPLIT_SEED);
  const rf = new RandomForest({ nTrees: opts.nTrees, maxDepth: opts.maxDepth, minSamplesSplit: 4, seed: 42 });
  if (background) await rf.fitAsync(train.X, train.y); else rf.fit(train.X, train.y);
  return { rf, ...evaluateForest(rf, test), trainRows: train.y.length, testRows: test.y.length, importances: rf.importances };
}

// ── does the forest help? rules alone vs forest vs both (thesis hypothesis) ──
export interface ApproachResult { name: string; metrics: Metrics; rocAuc: number | null }
export interface Comparison {
  rowsUsed: number;
  /** older labelled rows without a rule score */
  rowsSkipped: number;
  /** exact duplicates removed (the same screenshot labelled twice) */
  duplicates: number;
  testRows: number;
  rules: ApproachResult;
  forest: ApproachResult;
  combined: ApproachResult;
  /** McNemar: combined (A) vs rules alone (B), and forest (A) vs rules alone (B) */
  combinedVsRules: McNemar;
  forestVsRules: McNemar;
}

/**
 * Same seeded 70/30 split for all three, the forest trained on the 70 %:
 *  • rules alone:  the rule score (with its floor) ≥ 0.45
 *  • forest alone: forest probability ≥ 0.5
 *  • combined:     the scanner's 50/50 blend (with its floor) ≥ 0.45 — what FraudSentry reports
 *                  (rules alone for a photo of a screen, as the app scores it)
 */
export async function compareApproaches(rows: TrainingRow[], opts: LabelledModelOptions): Promise<Comparison | null> {
  const withScore = rows.filter(r => typeof r.ruleScore === 'number');
  const usable = uniqueRows(withScore);
  if (!readiness(usable).ok) return null;
  const ds = datasetFromRows(usable);
  // carry each row's index through the split so its rule score can be found
  const tagged: Dataset = { ...ds, X: ds.X.map((x, i) => [...x, i]) };
  const { train, test } = trainTestSplit(tagged, TEST_RATIO, SPLIT_SEED);
  const strip = (X: number[][]) => X.map(x => x.slice(0, -1));
  const rf = new RandomForest({ nTrees: opts.nTrees, maxDepth: opts.maxDepth, minSamplesSplit: 4, seed: 42 });
  await rf.fitAsync(strip(train.X), train.y);
  const y = test.y;
  const idx = test.X.map(x => x[x.length - 1]);
  const prob = strip(test.X).map(x => rf.predictProba(x));
  const ruleS = idx.map(i => Math.max(usable[i].ruleScore!, usable[i].scoreFloor ?? 0));
  // exactly what the app reported: the 50/50 blend, or the rules alone for a photo of a screen
  const combS = idx.map((i, k) => (usable[i].photo ? ruleS[k] : blendScore(usable[i].ruleScore!, prob[k], usable[i].scoreFloor ?? 0)));
  const pred = (s: number[], t: number) => s.map(v => (v >= t ? 1 : 0));
  const pRules = pred(ruleS, FRAUD_THRESHOLD), pForest = pred(prob, 0.5), pComb = pred(combS, FRAUD_THRESHOLD);
  const res = (name: string, p: number[], s: number[]): ApproachResult => ({ name, metrics: computeMetrics(y, p), rocAuc: rocAuc(y, s) });
  return {
    rowsUsed: usable.length, rowsSkipped: rows.length - withScore.length, duplicates: withScore.length - usable.length, testRows: y.length,
    rules: res('Rules alone', pRules, ruleS),
    forest: res('Random Forest alone', pForest, prob),
    combined: res('FraudSentry (rules + forest)', pComb, combS),
    combinedVsRules: mcnemar(y, pComb, pRules),
    forestVsRules: mcnemar(y, pForest, pRules),
  };
}

/** Rebuild (in the background) the forest you connected from your labelled scans. */
export function restoreLabelledModel(rows: TrainingRow[], opts: LabelledModelOptions): Promise<void> {
  const ids = opts.rowIds ? new Set(opts.rowIds) : null;
  const used = uniqueRows(ids ? rows.filter(r => ids.has(r.id)) : rows);
  return restoreSharedModel(async () => {
    if (!readiness(used).ok) return null;
    const t = await trainOnRows(used, opts, true);
    return {
      rf: t.rf, featureNames: FEATURE_SPECS.map(f => f.key), trainedAt: opts.trainedAt,
      info: { datasetSource: 'labelled', nTrees: opts.nTrees, maxDepth: opts.maxDepth, trainRows: t.trainRows, modelId: opts.modelId, modelName: opts.modelName },
    };
  });
}
