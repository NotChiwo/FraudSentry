// V9.1 evaluation: ROC-AUC, McNemar's test, the rules-vs-forest comparison
// on labelled receipts, and the model registry.
import { describe, it, expect } from 'vitest';
import { rocAuc, rocCurve, mcnemar } from '../random-forest/evaluation';
import { compareApproaches, rowFromScan, evaluateForest, type TrainingRow } from '../random-forest/trainingData';
import { canReactivate, defaultModelName, nextVersion, withModel, type ModelRecord } from '../random-forest/modelRegistry';
import { generateDemoDataset } from '../random-forest/sampleDataset';
import { RandomForest, trainTestSplit } from '../random-forest/randomForest';
import { blendScore, classificationOf } from '../shared/helpers';
import type { ImageScanResult } from '../shared/types';

describe('ROC', () => {
  it('AUC: perfect, guessing, reversed, ties count half, one class only', () => {
    expect(rocAuc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9])).toBe(1);
    expect(rocAuc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5])).toBe(0.5);
    expect(rocAuc([0, 0, 1, 1], [0.9, 0.8, 0.2, 0.1])).toBe(0);
    expect(rocAuc([0, 1, 1], [0.4, 0.4, 0.9])).toBeCloseTo(0.75);
    expect(rocAuc([1, 1], [0.2, 0.9])).toBeNull();
  });
  it('the curve runs from (0,0) to (1,1) and its area equals the AUC', () => {
    const y = [0, 0, 1, 0, 1, 1, 0, 1], s = [0.1, 0.4, 0.35, 0.8, 0.7, 0.9, 0.2, 0.6];
    const c = rocCurve(y, s);
    expect(c[0]).toMatchObject({ fpr: 0, tpr: 0 });
    expect(c.at(-1)).toMatchObject({ fpr: 1, tpr: 1 });
    let area = 0;
    for (let i = 1; i < c.length; i++) area += (c[i].fpr - c[i - 1].fpr) * (c[i].tpr + c[i - 1].tpr) / 2;
    expect(area).toBeCloseTo(rocAuc(y, s)!, 10);
  });
  it('the demo forest has a high held-out AUC', () => {
    const { train, test } = trainTestSplit(generateDemoDataset(), 0.3, 42);
    const rf = new RandomForest({ nTrees: 40, maxDepth: 9, minSamplesSplit: 4, seed: 42 });
    rf.fit(train.X, train.y);
    const ev = evaluateForest(rf, test);
    expect(ev.rocAuc!).toBeGreaterThan(0.85);
    expect(ev.metrics.tp + ev.metrics.fp + ev.metrics.tn + ev.metrics.fn).toBe(test.y.length);
  });
});

describe("McNemar's test", () => {
  const truth = Array(40).fill(1);
  it('counts only the disagreements; exact binomial when few', () => {
    // A right on 10 that B gets wrong, B right on 1 that A gets wrong
    const a = truth.map((_, i) => (i < 30 ? 1 : i < 35 ? 0 : 1));
    const b = truth.map((_, i) => (i < 20 ? 1 : i < 30 ? 0 : i < 34 ? 0 : i < 35 ? 1 : 1));
    const m = mcnemar(truth, a, b);
    expect([m.onlyARight, m.onlyBRight, m.method]).toEqual([10, 1, 'exact']);
    expect(m.pValue).toBeCloseTo(2 * (1 + 11) / 2 ** 11, 10);   // 2·P(X ≤ 1), X ~ Bin(11, ½)
    expect(m.significant).toBe(true);
  });
  it('no disagreement: p = 1; balanced disagreement: not significant', () => {
    expect(mcnemar(truth, truth, truth)).toMatchObject({ pValue: 1, significant: false });
    const a = truth.map((_, i) => (i < 3 ? 0 : 1)), b = truth.map((_, i) => (i >= 3 && i < 6 ? 0 : 1));
    expect(mcnemar(truth, a, b).significant).toBe(false);
  });
  it('chi-square with continuity correction when the disagreements are many', () => {
    const y = Array(100).fill(0);
    const a = y.map((_, i) => (i < 30 ? 1 : 0)), b = y.map((_, i) => (i >= 30 && i < 40 ? 1 : 0));
    const m = mcnemar(y, a, b);   // A wrong on 30, B wrong on 10 → onlyARight 10, onlyBRight 30
    expect([m.onlyARight, m.onlyBRight, m.method]).toEqual([10, 30, 'chi-square']);
    expect(m.statistic).toBeCloseTo((Math.abs(10 - 30) - 1) ** 2 / 40, 10);
    expect(m.pValue).toBeCloseTo(0.0026, 3);
  });
});

describe('rules alone vs forest vs combined', () => {
  // labelled receipts whose rule score is known: the rules catch half the fakes, the forest sees the rest in the features
  const demo = generateDemoDataset(300, 5);
  const rows: TrainingRow[] = demo.X.map((x, i) => ({
    id: `r${i}`, features: x, label: demo.y[i] as 0 | 1, addedAt: '2026-10-20T00:00:00Z',
    ruleScore: demo.y[i] === 1 ? (i % 2 ? 0.6 : 0.2) : 0.1, scoreFloor: 0,
  }));
  it('scores all three on the same held-out receipts and tests the difference', async () => {
    const c = (await compareApproaches(rows, { nTrees: 25, maxDepth: 7 }))!;
    expect(c.rowsUsed).toBe(300);
    expect(c.testRows).toBe(c.rules.metrics.tp + c.rules.metrics.fp + c.rules.metrics.tn + c.rules.metrics.fn);
    expect(c.combined.metrics.recall).toBeGreaterThan(c.rules.metrics.recall);
    expect(c.combinedVsRules.onlyARight).toBeGreaterThan(c.combinedVsRules.onlyBRight);
    expect(c.combinedVsRules.pValue).toBeLessThan(0.05);
  });
  it('rows labelled before V9.1 (no rule score) are left out; too few usable rows: null', async () => {
    const old = rows.map(({ ruleScore, scoreFloor, ...r }) => r);
    expect(await compareApproaches([...old.slice(0, 285), ...rows.slice(285)], { nTrees: 10, maxDepth: 5 })).toBeNull();
  });
  it('a labelled scan keeps its rule score and floor (numbers only)', () => {
    const scan = { id: 's', heuristicScore: 0.35, scoreFloor: 0.45, forestAnalysis: { features: [1, 0, 0, 90, 1, 1, 1, 1, 0, 100] } } as unknown as ImageScanResult;
    expect(rowFromScan(scan, 1)).toMatchObject({ ruleScore: 0.35, scoreFloor: 0.45, label: 1 });
  });
  it('the blend and the classification threshold', () => {
    expect(blendScore(0.4, 0.2)).toBeCloseTo(0.3);
    expect(blendScore(0.1, 0.1, 0.45)).toBe(0.45);
    expect([classificationOf('low'), classificationOf('medium'), classificationOf('high'), classificationOf('critical')]).toEqual(['legitimate', 'legitimate', 'fraudulent', 'fraudulent']);
  });
});

describe('model registry', () => {
  const rec = (o: Partial<ModelRecord>): ModelRecord => ({
    id: 'm1', name: 'x', version: 1, datasetSource: 'labelled', nTrees: 40, maxDepth: 9, trainRows: 14, testRows: 6, accuracy: 1, precision: 1, recall: 1, f1: 1,
    rocAuc: 1, confusion: { tp: 3, fp: 0, tn: 3, fn: 0 }, importances: [], featureNames: [], trainedAt: '', trainedBy: 'owner', usableByScans: true, rowIds: ['a', 'b'], ...o,
  });
  it('versions and default names', () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([rec({ version: 3 }), rec({ id: 'm2', version: 1 })])).toBe(4);
    expect(defaultModelName(4, 'labelled', 37)).toBe('RF v4 · labelled receipts (37 rows)');
    expect(withModel([rec({})], rec({ name: 'new' }))).toHaveLength(1);
  });
  it('which models can be put back into use', () => {
    expect(canReactivate(rec({}), new Set(['a', 'b']))).toEqual({ ok: true });
    expect(canReactivate(rec({}), new Set(['a'])).reason).toMatch(/1 of its labelled receipts/);
    expect(canReactivate(rec({ datasetSource: 'csv' }), new Set()).reason).toMatch(/Upload the same CSV/);
    expect(canReactivate(rec({ usableByScans: false }), new Set()).ok).toBe(false);
  });
});
