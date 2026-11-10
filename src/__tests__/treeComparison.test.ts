import { describe, it, expect } from 'vitest';
import { generateDemoDataset } from '../random-forest/sampleDataset';
import { DecisionTree } from '../random-forest/decisionTree';
import { compareOnSplit, stratifiedFolds, runFold, summarizeFolds, runTreeComparison, canCrossValidate } from '../random-forest/treeComparison';

const settings = { nTrees: 40, maxDepth: 9 };

describe('Random Forest vs Decision Tree on the demonstration dataset (thesis Tables 15, 19)', () => {
  const r = compareOnSplit(generateDemoDataset(), settings);
  it('uses the same 309 / 131 split for both models', () => {
    expect([r.trainRows, r.testRows]).toEqual([309, 131]);
  });
  it('Random Forest: 87.02 / 90.74 / 80.33 / 85.22', () => {
    const m = r.forest;
    expect([m.tp, m.fp, m.tn, m.fn]).toEqual([49, 5, 65, 12]);
    expect(m.accuracy * 100).toBeCloseTo(87.02, 2);
  });
  it('Decision Tree: 77.86 / 75.00 / 78.69 / 76.80', () => {
    const m = r.tree;
    expect([m.tp, m.fp, m.tn, m.fn]).toEqual([48, 16, 54, 13]);
    expect(m.accuracy * 100).toBeCloseTo(77.86, 2);
    expect(m.precision * 100).toBeCloseTo(75.0, 2);
    expect(m.recall * 100).toBeCloseTo(78.69, 2);
    expect(m.f1 * 100).toBeCloseTo(76.80, 2);
  });
  it('McNemar: b = 15, c = 3, exact p = 0.0075 → H₀ rejected', () => {
    expect([r.test.bothRight, r.test.onlyARight, r.test.onlyBRight, r.test.bothWrong]).toEqual([99, 15, 3, 14]);
    expect(r.test.method).toBe('exact');
    expect(r.test.pValue).toBeCloseTo(0.0075, 4);
    expect(r.test.significant).toBe(true);
  });
});

describe('decision tree', () => {
  it('is deterministic and uses every feature', () => {
    const ds = generateDemoDataset();
    const a = new DecisionTree(); a.fit(ds.X, ds.y);
    const b = new DecisionTree(); b.fit(ds.X, ds.y);
    expect(a.predictBatch(ds.X)).toEqual(b.predictBatch(ds.X));
    expect(a.importances.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
    expect(a.depth).toBeLessThanOrEqual(9);
  });
  it('a tree of depth 0 predicts the majority class', () => {
    const t = new DecisionTree({ maxDepth: 0 }); t.fit([[0], [1], [2]], [1, 1, 0]);
    expect(t.predict([5])).toBe(1);
  });
});

describe('stratified 10-fold cross-validation', () => {
  it('every row is tested exactly once, and each fold keeps the class mix', () => {
    const ds = generateDemoDataset();
    const folds = stratifiedFolds(ds.y);
    expect(folds.flat().sort((a, b) => a - b)).toEqual(ds.y.map((_, i) => i));
    for (const f of folds) {
      const fraud = f.filter(i => ds.y[i] === 1).length;
      expect(fraud).toBeGreaterThanOrEqual(20); expect(fraud).toBeLessThanOrEqual(21);
    }
  });
  it('summarises mean, SD and fold wins', () => {
    const ds = generateDemoDataset();
    const folds = stratifiedFolds(ds.y);
    const cv = summarizeFolds(folds.map(f => runFold(ds, f, settings, { maxDepth: 9, minSamplesSplit: 5 })));
    expect(cv.folds).toBe(10);
    expect(cv.forestWins + cv.treeWins + cv.ties).toBe(10);
    expect(cv.forest.accuracy.mean).toBeGreaterThan(cv.tree.accuracy.mean);
    expect(cv.forest.accuracy.sd).toBeGreaterThan(0);
  });
  it('is skipped when a class has fewer rows than folds', () => {
    expect(canCrossValidate([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(false);
  });
  it('runTreeComparison reports progress and returns both parts', async () => {
    const seen: number[] = [];
    const r = await runTreeComparison(generateDemoDataset(), settings, undefined, d => seen.push(d));
    expect(r?.cv?.folds).toBe(10);
    expect(seen[seen.length - 1]).toBe(11);
    // print for the docs
    const c = r!.cv!, p = (x: number) => (x * 100).toFixed(2);
    console.log(`CV RF ${p(c.forest.accuracy.mean)} (${p(c.forest.accuracy.sd)}) P ${p(c.forest.precision.mean)} (${p(c.forest.precision.sd)}) R ${p(c.forest.recall.mean)} (${p(c.forest.recall.sd)}) F1 ${p(c.forest.f1.mean)} (${p(c.forest.f1.sd)}) | DT ${p(c.tree.accuracy.mean)} (${p(c.tree.accuracy.sd)}) P ${p(c.tree.precision.mean)} (${p(c.tree.precision.sd)}) R ${p(c.tree.recall.mean)} (${p(c.tree.recall.sd)}) F1 ${p(c.tree.f1.mean)} (${p(c.tree.f1.sd)}) wins ${c.forestWins}/${c.treeWins}/${c.ties} AUC rf ${r!.split.forestAuc?.toFixed(3)} dt ${r!.split.treeAuc?.toFixed(3)}`);
  }, 30000);
});
