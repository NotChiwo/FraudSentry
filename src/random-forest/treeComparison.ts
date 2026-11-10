// ============================================================
// FraudSentry — Random Forest vs. a single Decision Tree
//
// The thesis hypothesis (Chapter 1, 8.2.3):
//   H₀: no significant difference in classification accuracy between the
//       Random Forest and a Decision Tree; H₁: there is one.
// Procedure (Chapter 2, 9.11.3–9.11.4):
//   1. Same stratified 70:30 split (seed 42) for both models; fraudulent
//      when the predicted fraud probability is ≥ 0.50.
//   2. Accuracy, precision, recall and F1 from each confusion matrix.
//   3. McNemar's test on the paired outcomes (exact when b + c < 25).
//   4. Stratified 10-fold cross-validation: mean and SD of each metric.
// Pure functions; the page calls runTreeComparison(), which yields between
// folds so the screen stays responsive.
// ============================================================
import { RandomForest, trainTestSplit, computeMetrics, makeRng, type Dataset, type Metrics } from './randomForest';
import { DecisionTree, DEFAULT_DT_OPTIONS, type DTOptions } from './decisionTree';
import { mcnemar, rocAuc, type McNemar } from './evaluation';

export const SPLIT_SEED = 42;
export const CV_FOLDS = 10;
export const CV_SEED = 42;

export interface ForestSettings { nTrees: number; maxDepth: number }

export interface PairedOutcomes extends McNemar {
  bothRight: number;
  bothWrong: number;
}

export interface SplitComparison {
  trainRows: number;
  testRows: number;
  forest: Metrics;
  tree: Metrics;
  forestAuc: number | null;
  treeAuc: number | null;
  /** A = Random Forest, B = Decision Tree */
  test: PairedOutcomes;
}

export interface MeanSd { mean: number; sd: number }
export interface CvSummary { accuracy: MeanSd; precision: MeanSd; recall: MeanSd; f1: MeanSd }
export interface CrossValidation {
  folds: number;
  /** per fold: [forest metrics, tree metrics] */
  perFold: { size: number; forest: Metrics; tree: Metrics }[];
  forest: CvSummary;
  tree: CvSummary;
  forestWins: number;
  treeWins: number;
  ties: number;
}

export interface TreeComparison {
  split: SplitComparison;
  cv: CrossValidation | null;
  forestSettings: ForestSettings;
  treeSettings: DTOptions;
}

function newForest(s: ForestSettings) {
  return new RandomForest({ nTrees: s.nTrees, maxDepth: s.maxDepth, minSamplesSplit: 4, seed: 42 });
}

/** Train both on the same 70 % and test both on the same 30 %. */
export function compareOnSplit(ds: Dataset, forest: ForestSettings, tree: DTOptions = DEFAULT_DT_OPTIONS): SplitComparison {
  const { train, test } = trainTestSplit(ds, 0.3, SPLIT_SEED);
  const rf = newForest(forest); rf.fit(train.X, train.y);
  const dt = new DecisionTree(tree); dt.fit(train.X, train.y);
  const rfP = test.X.map(x => rf.predictProba(x)), dtP = test.X.map(x => dt.predictProba(x));
  const rfPred = rfP.map(p => (p >= 0.5 ? 1 : 0)), dtPred = dtP.map(p => (p >= 0.5 ? 1 : 0));
  let bothRight = 0, bothWrong = 0;
  test.y.forEach((t, i) => { const a = rfPred[i] === t, b = dtPred[i] === t; if (a && b) bothRight++; else if (!a && !b) bothWrong++; });
  return {
    trainRows: train.y.length, testRows: test.y.length,
    forest: computeMetrics(test.y, rfPred), tree: computeMetrics(test.y, dtPred),
    forestAuc: rocAuc(test.y, rfP), treeAuc: rocAuc(test.y, dtP),
    test: { ...mcnemar(test.y, rfPred, dtPred), bothRight, bothWrong },
  };
}

/** Stratified k folds: each class shuffled (seeded) and dealt out in turn. */
export function stratifiedFolds(y: number[], k = CV_FOLDS, seed = CV_SEED): number[][] {
  const rng = makeRng(seed);
  const folds: number[][] = Array.from({ length: k }, () => []);
  for (const c of [0, 1]) {
    const idx = y.map((v, i) => (v === c ? i : -1)).filter(i => i >= 0);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    idx.forEach((v, n) => folds[n % k].push(v));
  }
  return folds;
}

const meanSd = (v: number[]): MeanSd => {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { mean, sd };
};
const summarize = (m: Metrics[]): CvSummary => ({
  accuracy: meanSd(m.map(x => x.accuracy)), precision: meanSd(m.map(x => x.precision)),
  recall: meanSd(m.map(x => x.recall)), f1: meanSd(m.map(x => x.f1)),
});

/** One fold: train both on the other folds, test both on this one. */
export function runFold(ds: Dataset, testIdx: number[], forest: ForestSettings, tree: DTOptions) {
  const inTest = new Set(testIdx);
  const trainIdx = ds.y.map((_, i) => i).filter(i => !inTest.has(i));
  const X = trainIdx.map(i => ds.X[i]), y = trainIdx.map(i => ds.y[i]);
  const rf = newForest(forest); rf.fit(X, y);
  const dt = new DecisionTree(tree); dt.fit(X, y);
  const yt = testIdx.map(i => ds.y[i]), Xt = testIdx.map(i => ds.X[i]);
  return { size: testIdx.length, forest: computeMetrics(yt, rf.predictBatch(Xt)), tree: computeMetrics(yt, dt.predictBatch(Xt)) };
}

export function summarizeFolds(perFold: CrossValidation['perFold']): CrossValidation {
  let forestWins = 0, treeWins = 0, ties = 0;
  for (const f of perFold) {
    const d = f.forest.accuracy - f.tree.accuracy;
    if (Math.abs(d) < 1e-12) ties++; else if (d > 0) forestWins++; else treeWins++;
  }
  return {
    folds: perFold.length, perFold,
    forest: summarize(perFold.map(f => f.forest)), tree: summarize(perFold.map(f => f.tree)),
    forestWins, treeWins, ties,
  };
}

/** Cross-validation needs every fold to hold both classes. */
export function canCrossValidate(y: number[], k = CV_FOLDS) {
  const fraud = y.filter(v => v === 1).length;
  return fraud >= k && y.length - fraud >= k;
}

/** The whole comparison, yielding to the browser between folds. */
export async function runTreeComparison(
  ds: Dataset, forest: ForestSettings, tree: DTOptions = DEFAULT_DT_OPTIONS,
  onProgress?: (done: number, total: number) => void, signal?: AbortSignal,
): Promise<TreeComparison | null> {
  const tick = () => new Promise<void>(r => setTimeout(r, 0));
  onProgress?.(0, CV_FOLDS + 1);
  await tick();
  const split = compareOnSplit(ds, forest, tree);
  let cv: CrossValidation | null = null;
  if (canCrossValidate(ds.y)) {
    const perFold: CrossValidation['perFold'] = [];
    const folds = stratifiedFolds(ds.y);
    for (let k = 0; k < folds.length; k++) {
      onProgress?.(k + 1, CV_FOLDS + 1);
      await tick();
      if (signal?.aborted) return null;
      perFold.push(runFold(ds, folds[k], forest, tree));
    }
    cv = summarizeFolds(perFold);
  }
  onProgress?.(CV_FOLDS + 1, CV_FOLDS + 1);
  return { split, cv, forestSettings: forest, treeSettings: tree };
}
