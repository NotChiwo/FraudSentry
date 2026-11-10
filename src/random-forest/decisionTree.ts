// ============================================================
// FraudSentry — single Decision Tree (the baseline for the hypothesis)
//
// The thesis hypothesis compares the Random Forest with ONE decision tree.
// This is that tree: the same CART algorithm and Gini-impurity splits the
// forest's trees use, but grown once on ALL the training rows (no bootstrap
// sample) and allowed to look at ALL features at every split (no random
// subset). So the comparison isolates exactly what the "forest" adds:
// bagging and random feature selection.
//
// A sample is fraudulent when its leaf's fraud share is at least 0.50.
// Defaults: max depth 9 (as the forest), at least 5 samples to split.
// Deterministic: no randomness, so it gives the same tree every time.
// ============================================================

export interface DTOptions {
  maxDepth: number;
  minSamplesSplit: number;
}

export const DEFAULT_DT_OPTIONS: DTOptions = { maxDepth: 9, minSamplesSplit: 5 };

interface Node {
  leaf: boolean;
  prob: number;              // share of fraudulent training rows reaching this node
  feature?: number;
  threshold?: number;
  left?: Node;
  right?: Node;
}

const gini = (c0: number, c1: number) => {
  const t = c0 + c1;
  if (!t) return 0;
  const p0 = c0 / t, p1 = c1 / t;
  return 1 - p0 * p0 - p1 * p1;
};

export class DecisionTree {
  opts: DTOptions;
  private root: Node | null = null;
  private nFeatures = 0;
  /** Gini-decrease importance per feature, normalised to sum to 1. */
  importances: number[] = [];
  /** Number of leaves, and the depth actually reached. */
  leaves = 0;
  depth = 0;

  constructor(opts: Partial<DTOptions> = {}) {
    this.opts = { ...DEFAULT_DT_OPTIONS, ...opts };
  }

  fit(X: number[][], y: number[]): void {
    this.nFeatures = X[0]?.length ?? 0;
    this.importances = new Array(this.nFeatures).fill(0);
    this.leaves = 0; this.depth = 0;
    this.root = this.build(X, y, X.map((_, i) => i), 0);
    const total = this.importances.reduce((a, b) => a + b, 0) || 1;
    this.importances = this.importances.map(v => v / total);
  }

  private build(X: number[][], y: number[], idx: number[], depth: number): Node {
    let c0 = 0, c1 = 0;
    for (const i of idx) (y[i] === 1 ? c1++ : c0++);
    const n = idx.length;
    const prob = n ? c1 / n : 0;
    this.depth = Math.max(this.depth, depth);
    if (depth >= this.opts.maxDepth || n < this.opts.minSamplesSplit || c0 === 0 || c1 === 0) {
      this.leaves++;
      return { leaf: true, prob };
    }
    const parent = gini(c0, c1);
    let best: { f: number; thr: number; L: number[]; R: number[]; gain: number } | null = null;
    for (let f = 0; f < this.nFeatures; f++) {                 // every feature, every split
      const vals = [...new Set(idx.map(i => X[i][f]))].sort((a, b) => a - b);
      for (let v = 0; v < vals.length - 1; v++) {
        const thr = (vals[v] + vals[v + 1]) / 2;
        const L: number[] = [], R: number[] = [];
        let l0 = 0, l1 = 0, r0 = 0, r1 = 0;
        for (const i of idx) {
          if (X[i][f] <= thr) { L.push(i); (y[i] === 1 ? l1++ : l0++); }
          else { R.push(i); (y[i] === 1 ? r1++ : r0++); }
        }
        const gain = parent - (L.length * gini(l0, l1) + R.length * gini(r0, r1)) / n;
        if (!best || gain > best.gain) best = { f, thr, L, R, gain };   // first best wins a tie
      }
    }
    if (!best || best.gain <= 1e-9) { this.leaves++; return { leaf: true, prob }; }
    this.importances[best.f] += best.gain * n;
    return {
      leaf: false, prob, feature: best.f, threshold: best.thr,
      left: this.build(X, y, best.L, depth + 1),
      right: this.build(X, y, best.R, depth + 1),
    };
  }

  predictProba(x: number[]): number {
    let node = this.root;
    if (!node) return 0;
    while (!node.leaf) node = x[node.feature!] <= node.threshold! ? node.left! : node.right!;
    return node.prob;
  }

  predict(x: number[]): number { return this.predictProba(x) >= 0.5 ? 1 : 0; }
  predictBatch(X: number[][]): number[] { return X.map(x => this.predict(x)); }
}
