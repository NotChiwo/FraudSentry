// ============================================================
// FraudSentry — Shared Random Forest (the model live scans use)
//
// This is what makes the thesis algorithm actually run on real
// evidence: every Transaction Check builds a feature vector from its
// evidence (see buildFeatureVector) and scores it through THIS forest.
// The forest's fraud probability is blended 50/50 with the rule-based
// findings to produce the final risk score (imageVerification.ts).
//
//  • On first use, a forest is trained on the seeded demonstration
//    dataset (same seed/settings as the Model page defaults), so scans
//    work out of the box and are reproducible.
//  • Retraining on the Detection Model page calls setSharedModel(), so
//    every FUTURE scan immediately uses the newly trained forest —
//    but only if that dataset uses the same 10 evidence features the
//    scanner produces (isEvidenceSchema). A forest trained on unrelated
//    columns is never wired into scans.
//
// Nothing is persisted or transmitted: the model lives in memory only.
// ============================================================

import { RandomForest } from './randomForest';
import type { ForestAnalysis } from '../types';
import { FEATURE_SPECS, generateDemoDataset, isEvidenceSchema } from '../services/sampleDataset';

export type ModelDatasetSource = 'demo' | 'csv';

export interface SharedModelMeta {
  datasetSource: ModelDatasetSource;
  nTrees: number;
  maxDepth: number;
  trainRows: number;
  trainedAt: string;
}


const DEFAULT_TREES = 40;
const DEFAULT_DEPTH = 9;

let forest: RandomForest | null = null;
let meta: SharedModelMeta | null = null;
const listeners = new Set<(m: SharedModelMeta) => void>();

function trainDefault() {
  const ds = generateDemoDataset();
  const rf = new RandomForest({ nTrees: DEFAULT_TREES, maxDepth: DEFAULT_DEPTH, seed: 42 });
  rf.fit(ds.X, ds.y);
  forest = rf;
  meta = {
    datasetSource: 'demo',
    nTrees: DEFAULT_TREES,
    maxDepth: DEFAULT_DEPTH,
    trainRows: ds.X.length,
    trainedAt: new Date().toISOString(),
  };
}

function ensure(): { forest: RandomForest; meta: SharedModelMeta } {
  if (!forest || !meta) trainDefault();
  return { forest: forest!, meta: meta! };
}

/**
 * Install a newly trained forest for all future scans.
 * Returns false (and leaves the current model in place) when the training
 * data does not use the scanner's evidence features.
 */
export function setSharedModel(
  rf: RandomForest,
  featureNames: string[],
  info: Omit<SharedModelMeta, 'trainedAt'>,
): boolean {
  if (!isEvidenceSchema(featureNames) || rf.treeCount === 0) return false;
  forest = rf;
  meta = { ...info, trainedAt: new Date().toISOString() };
  listeners.forEach(l => l(meta!));
  return true;
}

export function getSharedModelMeta(): SharedModelMeta {
  return ensure().meta;
}

export function onSharedModelChange(fn: (m: SharedModelMeta) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Score one evidence feature vector through the shared forest. */
export function scoreWithSharedModel(features: number[]): ForestAnalysis {
  const { forest: rf, meta: m } = ensure();
  const probability = rf.predictProba(features);
  return {
    probability,
    // predictProba is the mean of 0/1 leaf votes, so this is the exact vote count
    votesFraud: Math.round(probability * rf.treeCount),
    totalTrees: rf.treeCount,
    datasetSource: m.datasetSource,
    trainedAt: m.trainedAt,
    featureNames: FEATURE_SPECS.map(f => f.label),
  };
}

/** Test-only: drop the cached model so the next call retrains the default. */
export function resetSharedModelForTests() {
  forest = null;
  meta = null;
}
