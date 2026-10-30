// Real-data training path: labelled scans → evidence rows → forest that live
// scans use, rebuilt identically when the app reopens.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  rowFromScan, featuresOf, readiness, counts, datasetFromRows, rowsToCsv, trainOnRows, restoreLabelledModel,
  type TrainingRow,
} from '../random-forest/trainingData';
import { FEATURE_SPECS, generateDemoDataset, isEvidenceSchema } from '../random-forest/sampleDataset';
import { scoreWithSharedModel, getSharedModelMeta, resetSharedModelForTests, warmUpSharedModel } from '../random-forest/sharedModel';
import { useAppStore } from '../shared/store';
import type { ImageScanResult } from '../shared/types';

// rows that look like real evidence: the demo generator's rows, labelled
const demo = generateDemoDataset(60, 11);
const ROWS: TrainingRow[] = demo.X.map((x, i) => ({ id: `scan-${i}`, features: x, label: demo.y[i] as 0 | 1, addedAt: '2026-10-18T00:00:00Z' }));

function fakeScan(id: string, features?: number[]): ImageScanResult {
  return {
    id, forestAnalysis: features ? { probability: 0, votesFraud: 0, totalTrees: 1, datasetSource: 'demo', trainedAt: '', featureNames: [], features } : undefined,
    forensics: { elaHotspotPct: 3, hasExif: false, editorSoftware: null, sniffType: 'image/png', declaredType: 'image/png', width: 1080, height: 2340, jpegProgressive: null },
    ocr: { available: true, confidence: 91 }, extracted: { referenceNo: '8041241631871', amount: 215 }, source: 'GCash', findings: [],
  } as unknown as ImageScanResult;
}

describe('a labelled scan becomes a numbers-only training row', () => {
  it('uses the exact vector the forest scored', () => {
    const v = [1, 0, 0, 90, 1, 1, 1, 1, 0, 100];
    const r = rowFromScan(fakeScan('a', v), 1);
    expect(r).toMatchObject({ id: 'a', label: 1, features: v });
    expect(Object.keys(r).sort()).toEqual(['addedAt', 'features', 'id', 'label']);   // no names, numbers or text
  });
  it('older scans (no stored vector) are rebuilt from their evidence', () => {
    expect(featuresOf(fakeScan('b'))).toHaveLength(FEATURE_SPECS.length);
  });
  it('live scoring now returns the vector it scored', () => {
    resetSharedModelForTests();
    const v = [2, 1, 0, 92, 1, 1, 1, 1, 0, 100];
    expect(scoreWithSharedModel(v).features).toEqual(v);
  });
});

describe('readiness and export', () => {
  it('asks for enough receipts of both kinds', () => {
    expect(readiness(ROWS.slice(0, 5)).ok).toBe(false);
    expect(readiness(ROWS.filter(r => r.label === 0)).message).toMatch(/fake/);
    expect(readiness(ROWS).ok).toBe(true);
    expect(counts(ROWS).total).toBe(60);
  });
  it('the CSV header is the evidence schema, so the Model page connects it to scans', () => {
    const [head, first] = rowsToCsv(ROWS).split('\n');
    const cols = head.split(',');
    expect(cols.at(-1)).toBe('label');
    expect(isEvidenceSchema(cols.slice(0, -1))).toBe(true);
    expect(first.split(',').map(Number)).toEqual([...ROWS[0].features, ROWS[0].label]);
  });
  it('datasetFromRows keeps order, features and labels', () => {
    const ds = datasetFromRows(ROWS);
    expect(ds.X[3]).toEqual(ROWS[3].features);
    expect(ds.y).toEqual(ROWS.map(r => r.label));
  });
});

describe('training on labelled rows', () => {
  beforeEach(() => resetSharedModelForTests());
  it('is deterministic: the same rows build the same forest', async () => {
    const a = await trainOnRows(ROWS, { nTrees: 15, maxDepth: 6 });
    const b = await trainOnRows(ROWS, { nTrees: 15, maxDepth: 6 }, true);   // background (fitAsync) path
    for (const x of demo.X) expect(b.rf.predictProba(x)).toBe(a.rf.predictProba(x));
    expect(a.metrics.tp + a.metrics.fp + a.metrics.tn + a.metrics.fn).toBe(a.testRows);
  });
  it('reopening the app rebuilds exactly the connected model, and scans wait for it', async () => {
    const t = await trainOnRows(ROWS, { nTrees: 15, maxDepth: 6 });
    const restoring = restoreLabelledModel([...ROWS, { ...ROWS[0], id: 'not-used' }], { nTrees: 15, maxDepth: 6, rowIds: ROWS.map(r => r.id) });
    await warmUpSharedModel();            // what every scan awaits first
    await restoring;
    expect(getSharedModelMeta().datasetSource).toBe('labelled');
    for (const x of demo.X.slice(0, 20)) expect(scoreWithSharedModel(x).probability).toBe(t.rf.predictProba(x));
  });
  it('does not replace the model when the rows are not enough', async () => {
    await restoreLabelledModel(ROWS.slice(0, 4), { nTrees: 5, maxDepth: 4 });
    expect(getSharedModelMeta().datasetSource).toBe('demo');
  });
});

describe('labelling in the store', () => {
  it('labels, relabels and unlabels a scan', () => {
    const s = fakeScan('scan-x', [1, 0, 0, 80, 1, 1, 1, 1, 0, 100]);
    useAppStore.getState().labelScan(s, 0);
    useAppStore.getState().labelScan(s, 1);
    expect(useAppStore.getState().trainingRows.filter(r => r.id === 'scan-x').map(r => r.label)).toEqual([1]);
    useAppStore.getState().labelScan(s, null);
    expect(useAppStore.getState().trainingRows.some(r => r.id === 'scan-x')).toBe(false);
  });
  it('clearing training data also disconnects the labelled model', () => {
    useAppStore.getState().setLabelledModel({ nTrees: 10, maxDepth: 5 });
    useAppStore.getState().clearTrainingRows();
    expect(useAppStore.getState().labelledModel).toBeNull();
  });
});
