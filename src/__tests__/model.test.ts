import { describe, it, expect, beforeEach } from 'vitest';
import { RandomForest, trainTestSplit, computeMetrics } from '../engine/randomForest';
import { generateDemoDataset, FEATURE_SPECS, isEvidenceSchema, buildFeatureVector } from '../services/sampleDataset';
import { setSharedModel, scoreWithSharedModel, getSharedModelMeta, resetSharedModelForTests } from '../engine/sharedModel';
import type { ForensicReport, OcrResult, ExtractedTransactionData } from '../types';

describe('Random Forest (from scratch)', () => {
  it('training is reproducible with a fixed seed', () => {
    const ds = generateDemoDataset();
    const a = new RandomForest({ nTrees: 20, maxDepth: 6, seed: 42 }); a.fit(ds.X, ds.y);
    const b = new RandomForest({ nTrees: 20, maxDepth: 6, seed: 42 }); b.fit(ds.X, ds.y);
    expect(a.predictBatch(ds.X)).toEqual(b.predictBatch(ds.X));
  });
  it('metrics are computed from real held-out predictions', () => {
    const ds = generateDemoDataset();
    const { train, test } = trainTestSplit(ds, 0.25, 42);
    const rf = new RandomForest({ nTrees: 30, maxDepth: 8, seed: 42 });
    rf.fit(train.X, train.y);
    const m = computeMetrics(test.y, rf.predictBatch(test.X));
    expect(m.tp + m.fp + m.tn + m.fn).toBe(test.y.length);
    expect(m.accuracy).toBeCloseTo((m.tp + m.tn) / test.y.length, 10);
    // better than always guessing the majority class on this (demo) data
    const majority = Math.max(test.y.filter(v => v === 1).length, test.y.filter(v => v === 0).length) / test.y.length;
    expect(m.accuracy).toBeGreaterThan(majority);
  });
  it('feature importances sum to 1', () => {
    const ds = generateDemoDataset();
    const rf = new RandomForest({ nTrees: 15, seed: 1 }); rf.fit(ds.X, ds.y);
    expect(rf.importances.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });
});

describe('evidence schema gate (which models may score live scans)', () => {
  it('accepts the scanner\'s own feature keys or labels', () => {
    expect(isEvidenceSchema(FEATURE_SPECS.map(f => f.key))).toBe(true);
    expect(isEvidenceSchema(FEATURE_SPECS.map(f => f.label))).toBe(true);
  });
  it('rejects the PaySim transaction columns', () => {
    const paysim = ['type_TRANSFER', 'type_CASH_OUT', 'amount', 'oldbalanceOrg', 'newbalanceOrig', 'oldbalanceDest', 'newbalanceDest', 'errorBalanceOrig', 'errorBalanceDest'];
    expect(isEvidenceSchema(paysim)).toBe(false);
  });
  it('rejects headerless CSVs (column meaning unknown)', () => {
    expect(isEvidenceSchema(FEATURE_SPECS.map((_, i) => `Feature ${i + 1}`))).toBe(false);
  });
  it('rejects the right names in the wrong order', () => {
    expect(isEvidenceSchema([...FEATURE_SPECS.map(f => f.key)].reverse())).toBe(false);
  });
});

describe('shared model used by live scans', () => {
  beforeEach(() => resetSharedModelForTests());

  it('starts with a demo-trained forest and scores a feature vector', () => {
    const r = scoreWithSharedModel([0, 1, 0, 90, 1, 1, 1, 1, 0, 95]);
    expect(r.datasetSource).toBe('demo');
    expect(r.totalTrees).toBeGreaterThan(0);
    expect(r.probability).toBeGreaterThanOrEqual(0);
    expect(r.probability).toBeLessThanOrEqual(1);
    expect(r.votesFraud).toBe(Math.round(r.probability * r.totalTrees));
  });
  it('clean evidence scores lower than tampered evidence', () => {
    const clean = scoreWithSharedModel([2, 1, 0, 92, 1, 1, 1, 1, 0, 96]).probability;
    const bad = scoreWithSharedModel([45, 0, 1, 50, 0, 0, 0, 0, 5, 40]).probability;
    expect(bad).toBeGreaterThan(clean);
  });
  it('a retrained evidence-schema model replaces it for future scans', () => {
    const ds = generateDemoDataset(200, 3);
    const rf = new RandomForest({ nTrees: 7, maxDepth: 4, seed: 9 }); rf.fit(ds.X, ds.y);
    expect(setSharedModel(rf, ds.featureNames, { datasetSource: 'csv', nTrees: 7, maxDepth: 4, trainRows: 200 })).toBe(true);
    expect(scoreWithSharedModel(ds.X[0]).totalTrees).toBe(7);
    expect(getSharedModelMeta().datasetSource).toBe('csv');
  });
  it('a model trained on unrelated columns is NOT wired into scans', () => {
    const before = getSharedModelMeta();
    const X = Array.from({ length: 40 }, (_, i) => [i % 2, i, i * 3, 1, 0, 1, 0, 1, 0]);
    const y = X.map(r => r[0]);
    const rf = new RandomForest({ nTrees: 5, seed: 1 }); rf.fit(X, y);
    const ok = setSharedModel(rf, ['type_TRANSFER', 'type_CASH_OUT', 'amount', 'oldbalanceOrg', 'newbalanceOrig', 'oldbalanceDest', 'newbalanceDest', 'errorBalanceOrig', 'errorBalanceDest'],
      { datasetSource: 'csv', nTrees: 5, maxDepth: 9, trainRows: 40 });
    expect(ok).toBe(false);
    expect(getSharedModelMeta()).toEqual(before);
  });
});

describe('scan evidence → feature vector', () => {
  it('maps evidence to the 10 features in FEATURE_SPECS order', () => {
    const forensics = { elaHotspotPct: 12, hasExif: false, editorSoftware: 'Adobe Photoshop' } as ForensicReport;
    const ocr = { available: true, confidence: 88 } as OcrResult;
    const ex = { referenceNo: '4045 516 855953', amount: 160 } as ExtractedTransactionData;
    const v = buildFeatureVector(forensics, ocr, ex, 'GCash', 3);
    expect(v).toHaveLength(FEATURE_SPECS.length);
    expect(v).toEqual([12, 0, 1, 88, 1, 1, 1, 1, 3, 63]);
  });
  it('OCR unavailable → confidence feature is 0, unknown source → 0', () => {
    const v = buildFeatureVector({ elaHotspotPct: 0, hasExif: true, editorSoftware: null } as ForensicReport,
      { available: false, confidence: 77 } as OcrResult, { referenceNo: null, amount: null } as ExtractedTransactionData, 'Unknown', 9);
    expect(v[3]).toBe(0);
    expect(v[6]).toBe(0);
    expect(v[8]).toBe(6); // failed checks capped at 6
  });
});
