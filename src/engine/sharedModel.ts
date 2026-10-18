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

export type ModelDatasetSource = 'demo' | 'csv' | 'labelled';

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

let warming: Promise<void> | null = null;

function install(rf: RandomForest, rows: number) {
  forest = rf;
  meta = {
    datasetSource: 'demo',
    nTrees: DEFAULT_TREES,
    maxDepth: DEFAULT_DEPTH,
    trainRows: rows,
    trainedAt: new Date().toISOString(),
  };
}

function trainDefault() {
  const ds = generateDemoDataset();
  const rf = new RandomForest({ nTrees: DEFAULT_TREES, maxDepth: DEFAULT_DEPTH, seed: 42 });
  rf.fit(ds.X, ds.y);
  install(rf, ds.X.length);
}

/**
 * Train the default forest in the background, one tree at a time, so the
 * first scan doesn't freeze the page (training blocked the main thread for
 * ~1.2 s under 4x CPU throttling). Safe to call repeatedly.
 */
export async function warmUpSharedModel(): Promise<void> {
  // a model being rebuilt from your labelled scans takes priority over the demo one
  if (restoring) await restoring;
  if (forest) return;
  if (!warming) {
    warming = (async () => {
      const ds = generateDemoDataset();
      const rf = new RandomForest({ nTrees: DEFAULT_TREES, maxDepth: DEFAULT_DEPTH, seed: 42 });
      await rf.fitAsync(ds.X, ds.y);
      if (!forest) install(rf, ds.X.length);   // a retrained model may have been set meanwhile
    })().finally(() => { warming = null; });
  }
  return warming;
}

// The model you connected on the Model page from your own labelled scans is
// rebuilt when the app opens (same rows + seeded split ⇒ the identical forest).
// Scans wait for it via warmUpSharedModel, so none is scored by the demo model meanwhile.
let restoring: Promise<void> | null = null;
export function restoreSharedModel(build: () => Promise<{ rf: RandomForest; featureNames: string[]; info: Omit<SharedModelMeta, 'trainedAt'> } | null>): Promise<void> {
  restoring = build()
    .then(r => { if (r) setSharedModel(r.rf, r.featureNames, r.info); })
    .catch(() => { /* keep whatever model is in place */ })
    .finally(() => { restoring = null; });
  return restoring;
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
    votesFraud: rf.countVotes(features),
    totalTrees: rf.treeCount,
    datasetSource: m.datasetSource,
    trainedAt: m.trainedAt,
    featureNames: FEATURE_SPECS.map(f => f.label),
    features: features.slice(),
  };
}

/** Test-only: drop the cached model so the next call retrains the default. */
export function resetSharedModelForTests() {
  forest = null;
  meta = null;
  warming = null;
  restoring = null;
}
