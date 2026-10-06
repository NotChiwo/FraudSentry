// ============================================================
// FraudSentry — Random Forest Classifier (from scratch)
//
// A REAL, dependency-free Random Forest implemented in TypeScript:
//   • CART decision trees with Gini-impurity splits
//   • Bootstrap aggregation (bagging) across many trees
//   • Random feature subsetting at each split (√n features)
//   • Majority-vote prediction + class probability
//   • Gini-decrease feature importances
//
// It runs entirely in the browser. Nothing is faked: every metric
// the UI shows is computed from the model's predictions on a held-out
// test set. A fixed seed makes training reproducible (like
// scikit-learn's random_state=42) so results are stable on defense day.
// ============================================================

export interface Dataset {
  X: number[][];
  y: number[];                // 0 = legitimate, 1 = fraudulent
  featureNames: string[];
  classNames: [string, string];
}

export interface RFOptions {
  nTrees: number;
  maxDepth: number;
  minSamplesSplit: number;
  seed: number;
}

export const DEFAULT_RF_OPTIONS: RFOptions = {
  nTrees: 40, maxDepth: 9, minSamplesSplit: 4, seed: 42,
};

export interface Metrics {
  accuracy: number; precision: number; recall: number; f1: number;
  tp: number; fp: number; tn: number; fn: number; support: number;
}

// ---- Seeded PRNG (mulberry32) so runs are reproducible ----
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TreeNode {
  leaf: boolean;
  pred?: number;
  prob?: number;            // P(class = 1) at this leaf
  feature?: number;
  threshold?: number;
  gain?: number;
  n?: number;
  left?: TreeNode;
  right?: TreeNode;
}

function giniFromCounts(c0: number, c1: number): number {
  const t = c0 + c1;
  if (t === 0) return 0;
  const p0 = c0 / t, p1 = c1 / t;
  return 1 - p0 * p0 - p1 * p1;
}

export class RandomForest {
  private trees: TreeNode[] = [];
  private nFeatures = 0;
  importances: number[] = [];
  opts: RFOptions;
  private rng: () => number;

  constructor(opts: Partial<RFOptions> = {}) {
    this.opts = { ...DEFAULT_RF_OPTIONS, ...opts };
    this.rng = makeRng(this.opts.seed);
  }

  fit(X: number[][], y: number[]): void {
    for (const _ of this.fitSteps(X, y)) { /* run to completion */ }
  }

  /**
   * Same training as fit(), one tree per step, yielding to the event loop in
   * between so a page stays responsive. Builds an identical forest (same RNG
   * sequence) — enforced by a test.
   */
  async fitAsync(X: number[][], y: number[]): Promise<void> {
    for (const _ of this.fitSteps(X, y)) await new Promise<void>(r => setTimeout(r, 0));
  }

  private *fitSteps(X: number[][], y: number[]): Generator<number> {
    this.nFeatures = X[0]?.length ?? 0;
    const featPerSplit = Math.max(1, Math.ceil(Math.sqrt(this.nFeatures)));
    this.importances = new Array(this.nFeatures).fill(0);
    this.trees = [];

    for (let t = 0; t < this.opts.nTrees; t++) {
      // bootstrap sample (sample rows with replacement)
      const idx: number[] = [];
      for (let i = 0; i < X.length; i++) idx.push(Math.floor(this.rng() * X.length));
      const root = this.buildTree(X, y, idx, 0, featPerSplit);
      this.trees.push(root);
      this.accumulateImportance(root);
      if (t < this.opts.nTrees - 1) yield t;
    }
    // normalise importances to sum to 1
    const total = this.importances.reduce((a, b) => a + b, 0) || 1;
    this.importances = this.importances.map(v => v / total);
  }

  private buildTree(X: number[][], y: number[], idx: number[], depth: number, featPerSplit: number): TreeNode {
    let c0 = 0, c1 = 0;
    for (const i of idx) (y[i] === 1 ? c1++ : c0++);
    const n = idx.length;
    const majority = c1 >= c0 ? 1 : 0;
    const prob = n ? c1 / n : 0;

    if (depth >= this.opts.maxDepth || n < this.opts.minSamplesSplit || c0 === 0 || c1 === 0) {
      return { leaf: true, pred: majority, prob };
    }

    // random feature subset
    const pool = [...Array(this.nFeatures).keys()];
    const feats: number[] = [];
    for (let k = 0; k < featPerSplit && pool.length; k++) {
      feats.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]);
    }

    const parentGini = giniFromCounts(c0, c1);
    let best: { f: number; thr: number; L: number[]; R: number[]; gain: number } | null = null;

    for (const f of feats) {
      const vals = [...new Set(idx.map(i => X[i][f]))].sort((a, b) => a - b);
      for (let v = 0; v < vals.length - 1; v++) {
        const thr = (vals[v] + vals[v + 1]) / 2;
        const L: number[] = [], R: number[] = [];
        let l0 = 0, l1 = 0, r0 = 0, r1 = 0;
        for (const i of idx) {
          if (X[i][f] <= thr) { L.push(i); (y[i] === 1 ? l1++ : l0++); }
          else { R.push(i); (y[i] === 1 ? r1++ : r0++); }
        }
        if (!L.length || !R.length) continue;
        const weighted = (L.length * giniFromCounts(l0, l1) + R.length * giniFromCounts(r0, r1)) / n;
        const gain = parentGini - weighted;
        if (!best || gain > best.gain) best = { f, thr, L, R, gain };
      }
    }

    if (!best || best.gain <= 1e-9) return { leaf: true, pred: majority, prob };

    return {
      leaf: false, feature: best.f, threshold: best.thr, gain: best.gain, n,
      left: this.buildTree(X, y, best.L, depth + 1, featPerSplit),
      right: this.buildTree(X, y, best.R, depth + 1, featPerSplit),
    };
  }

  private accumulateImportance(node: TreeNode): void {
    if (node.leaf) return;
    this.importances[node.feature!] += (node.gain ?? 0) * (node.n ?? 0);
    if (node.left) this.accumulateImportance(node.left);
    if (node.right) this.accumulateImportance(node.right);
  }

  // probability that a single sample is fraudulent (mean of tree votes)
  predictProba(x: number[]): number {
    if (!this.trees.length) return 0;
    let s = 0;
    for (const t of this.trees) {
      let node = t;
      while (!node.leaf) node = x[node.feature!] <= node.threshold! ? node.left! : node.right!;
      s += node.pred!;
    }
    return s / this.trees.length;
  }

  predict(x: number[]): number { return this.predictProba(x) >= 0.5 ? 1 : 0; }
  predictBatch(X: number[][]): number[] { return X.map(x => this.predict(x)); }
  get treeCount(): number { return this.trees.length; }
}

// ---- Stratified train/test split (keeps class balance) ----
export function trainTestSplit(ds: Dataset, testRatio: number, seed: number) {
  const rng = makeRng(seed);
  const byClass: Record<number, number[]> = { 0: [], 1: [] };
  ds.y.forEach((label, i) => byClass[label].push(i));
  const shuffle = (arr: number[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const trainIdx: number[] = [], testIdx: number[] = [];
  for (const c of [0, 1]) {
    const idx = shuffle(byClass[c]);
    const cut = Math.floor(idx.length * testRatio);
    testIdx.push(...idx.slice(0, cut));
    trainIdx.push(...idx.slice(cut));
  }
  shuffle(trainIdx); shuffle(testIdx);
  const pick = (ii: number[]) => ({ X: ii.map(i => ds.X[i]), y: ii.map(i => ds.y[i]) });
  return { train: pick(trainIdx), test: pick(testIdx) };
}

// ---- Classification metrics (positive class = fraudulent = 1) ----
export function computeMetrics(yTrue: number[], yPred: number[]): Metrics {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const a = yTrue[i], p = yPred[i];
    if (p === 1 && a === 1) tp++;
    else if (p === 1 && a === 0) fp++;
    else if (p === 0 && a === 0) tn++;
    else fn++;
  }
  const support = yTrue.length;
  const accuracy = support ? (tp + tn) / support : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { accuracy, precision, recall, f1, tp, fp, tn, fn, support };
}
