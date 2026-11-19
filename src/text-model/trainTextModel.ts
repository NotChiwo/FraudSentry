// ============================================================
// Text model: the whole training run, and the evidence that it learned
//
//   1. Generate the synthetic dataset (textDataset.ts, seeded).
//   2. Split it, stratified by label: 70 % training, 15 % validation (watched
//      during training), 15 % test (used once, at the end).
//   3. Train logistic regression (logisticRegression.ts) and log the loss
//      after every epoch.
//   4. Evaluate on the test set AND on the hand-written messages that are
//      not from the templates (handwrittenTest.ts), against baselines:
//      the untrained model, "always the majority class", and the rule-based
//      analyzer on its own.
//   5. A learning curve (more training data → better test scores) and
//      5-fold cross-validation (the result does not hinge on one split).
//   6. The words and phrases the model learned to weigh most.
// Everything is seeded: the same run gives exactly the same model.
// ============================================================
import { computeMetrics, makeRng, type Metrics } from '../random-forest/randomForest';
import { rocAuc } from '../random-forest/evaluation';
import { generateTextDataset, TEMPLATE_COUNT, SCAM_CATEGORIES, LEGIT_CATEGORIES, type TextSample } from './textDataset';
import { HANDWRITTEN_TEST } from './handwrittenTest';
import { fit, scorer, topFeatures, DEFAULT_FIT, type EpochLog, type FitOptions, type TextModel } from './logisticRegression';

export interface EvalResult extends Metrics { auc: number | null }
export interface TextModelReport {
  seed: number;
  dataset: { size: number; scam: number; legitimate: number; templates: number; labelNoise: number; byCategory: { category: string; kind: 'scam' | 'legitimate'; count: number; flipped: number }[] };
  split: { train: number; validation: number; test: number; handwritten: number };
  options: FitOptions;
  vocabularySize: number;
  history: EpochLog[];
  test: { untrained: EvalResult; majority: EvalResult; rulesOnly: EvalResult | null; trained: EvalResult; combined: EvalResult | null };
  handwritten: { untrained: EvalResult; rulesOnly: EvalResult | null; trained: EvalResult; combined: EvalResult | null; mistakes: { text: string; label: 0 | 1; probability: number }[] };
  learningCurve: { trainSize: number; accuracy: number; f1: number }[];
  crossValidation: { folds: number; accuracy: number[]; f1: number[]; meanAccuracy: number; meanF1: number; sdF1: number };
  topScam: { feature: string; weight: number }[];
  topLegitimate: { feature: string; weight: number }[];
}

export const TEXT_SEED = 42;
export const DATASET_SIZE = 2400;
export const LABEL_NOISE = 0.02;

/** How the message checker combines the two (messageAnalysis.ts). */
export const blend = (rules: number, model: number) => Math.max(rules, 0.6 * rules + 0.4 * model);
/** The checker's Medium threshold: a message at or above it is flagged. */
export const FLAG_AT = 0.22;
const flagged = (scores: number[]) => scores.map(v => (v >= FLAG_AT ? 1 : 0));

function evaluate(y: number[], p: number[]): EvalResult {
  return { ...computeMetrics(y, p.map(v => (v >= 0.5 ? 1 : 0))), auc: rocAuc(y, p) };
}

/** Stratified split: the same scam / legitimate mix in every part. */
export function stratifiedSplit<T extends { label: number }>(rows: T[], parts: number[], seed: number): T[][] {
  const rng = makeRng(seed);
  const out = parts.map(() => [] as T[]);
  for (const label of [0, 1]) {
    const g = rows.filter(r => r.label === label);
    for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [g[i], g[j]] = [g[j], g[i]]; }
    let start = 0;
    parts.forEach((share, k) => {
      const n = k === parts.length - 1 ? g.length - start : Math.round(g.length * share);
      out[k].push(...g.slice(start, start + n));
      start += n;
    });
  }
  return out;
}

/**
 * Runs the full training and evaluation. `rules`, when given, is the
 * rule-based analyzer's risk score (0–1) for a message: it gives the
 * "rules only" baseline (flagged at Medium, 0.22, or above) and the app's
 * actual combination, max(rules, 0.6 × rules + 0.4 × model).
 */
export function trainTextModel(rules?: (text: string) => number, opts: Partial<FitOptions> = {}): { model: TextModel; report: TextModelReport } {
  const options = { ...DEFAULT_FIT, ...opts };
  const data = generateTextDataset(DATASET_SIZE, TEXT_SEED, LABEL_NOISE);
  const [train, val, test] = stratifiedSplit(data, [0.7, 0.15, 0.15], TEXT_SEED);
  const { model, history } = fit(train, val, options);
  const s = scorer(model);
  const yT = test.map(r => r.label), yH = HANDWRITTEN_TEST.map(r => r.label);
  const pT = test.map(r => s.probability(r.text)), pH = HANDWRITTEN_TEST.map(r => s.probability(r.text));
  const rT = rules ? test.map(r => rules(r.text)) : [], rH = rules ? HANDWRITTEN_TEST.map(r => rules(r.text)) : [];
  const half = (n: number) => new Array<number>(n).fill(0.5);
  const majority = train.filter(r => r.label === 1).length >= train.length / 2 ? 1 : 0;

  // learning curve: the same model trained on growing shares of the training set
  const learningCurve = [0.02, 0.05, 0.1, 0.25, 0.5, 1].map(share => {
    const part = stratifiedSplit(train, [share, 1 - share], TEXT_SEED + 1)[0];
    const m = scorer(fit(part, val, options).model);
    const e = evaluate(yT, test.map(r => m.probability(r.text)));
    return { trainSize: part.length, accuracy: e.accuracy, f1: e.f1 };
  });

  // 5-fold cross-validation on training + validation (the test set stays unseen)
  const pool: TextSample[] = [...train, ...val];
  const folds = stratifiedSplit(pool, [0.2, 0.2, 0.2, 0.2, 0.2], TEXT_SEED + 2);
  const cv = folds.map((fold, k) => {
    const rest = folds.filter((_, j) => j !== k).flat();
    const m = scorer(fit(rest, fold, options).model);
    return evaluate(fold.map(r => r.label), fold.map(r => m.probability(r.text)));
  });
  const meanF1 = cv.reduce((a, e) => a + e.f1, 0) / cv.length;

  const top = topFeatures(model, 20);
  const round = <T,>(o: T): T => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)));
  const report: TextModelReport = {
    seed: TEXT_SEED,
    dataset: {
      size: data.length, scam: data.filter(r => r.label === 1).length, legitimate: data.filter(r => r.label === 0).length,
      templates: TEMPLATE_COUNT, labelNoise: LABEL_NOISE,
      byCategory: [...SCAM_CATEGORIES.map(c => [c, 'scam'] as const), ...LEGIT_CATEGORIES.map(c => [c, 'legitimate'] as const)].map(([category, kind]) => ({
        category, kind, count: data.filter(r => r.category === category).length, flipped: data.filter(r => r.category === category && r.flipped).length,
      })),
    },
    split: { train: train.length, validation: val.length, test: test.length, handwritten: HANDWRITTEN_TEST.length },
    options,
    vocabularySize: model.vocab.length,
    history,
    test: {
      untrained: evaluate(yT, half(yT.length)),
      majority: evaluate(yT, new Array<number>(yT.length).fill(majority)),
      rulesOnly: rules ? { ...computeMetrics(yT, flagged(rT)), auc: rocAuc(yT, rT) } : null,
      trained: evaluate(yT, pT),
      combined: rules ? { ...computeMetrics(yT, flagged(rT.map((r, i) => blend(r, pT[i])))), auc: rocAuc(yT, rT.map((r, i) => blend(r, pT[i]))) } : null,
    },
    handwritten: {
      untrained: evaluate(yH, half(yH.length)),
      rulesOnly: rules ? { ...computeMetrics(yH, flagged(rH)), auc: rocAuc(yH, rH) } : null,
      trained: evaluate(yH, pH),
      combined: rules ? { ...computeMetrics(yH, flagged(rH.map((r, i) => blend(r, pH[i])))), auc: rocAuc(yH, rH.map((r, i) => blend(r, pH[i]))) } : null,
      mistakes: HANDWRITTEN_TEST.map((r, i) => ({ ...r, probability: pH[i] })).filter(r => (r.probability >= 0.5 ? 1 : 0) !== r.label),
    },
    learningCurve,
    crossValidation: {
      folds: 5, accuracy: cv.map(e => e.accuracy), f1: cv.map(e => e.f1), meanAccuracy: cv.reduce((a, e) => a + e.accuracy, 0) / cv.length,
      meanF1, sdF1: Math.sqrt(cv.reduce((a, e) => a + (e.f1 - meanF1) ** 2, 0) / cv.length),
    },
    topScam: top.scam, topLegitimate: top.legitimate,
  };
  return { model, report: round(report) };
}
