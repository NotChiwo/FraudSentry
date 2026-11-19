// ============================================================
// Text model: logistic regression, trained by gradient descent
//
//   p(scam | message) = sigmoid( bias + Σ weight[f] for each feature f in it )
//
// Training (fit): start with every weight at 0 (the untrained model says
// 50 % for every message), then for a number of passes (epochs) over the
// shuffled training messages, in small batches, move each weight a little in
// the direction that lowers the log-loss (cross-entropy), with L2
// regularisation to keep weights small. The loss on the training data and on
// a separate validation set is recorded after each epoch: the training
// curve. Seeded, so training is reproducible to the last digit.
// ============================================================
import { makeRng } from '../random-forest/randomForest';
import { features } from './textFeatures';

export interface TextModel {
  vocab: string[];
  weights: number[];
  bias: number;
}
export interface EpochLog { epoch: number; trainLoss: number; valLoss: number; valAccuracy: number }
export interface FitOptions { epochs: number; learningRate: number; l2: number; batchSize: number; minCount: number; seed: number }
export const DEFAULT_FIT: FitOptions = { epochs: 30, learningRate: 0.5, l2: 1e-4, batchSize: 32, minCount: 2, seed: 42 };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** The vocabulary: features in at least `minCount` training messages (rare ones are noise). */
export function buildVocab(texts: string[], minCount: number): string[] {
  const df = new Map<string, number>();
  for (const t of texts) for (const f of features(t)) df.set(f, (df.get(f) ?? 0) + 1);
  return [...df.entries()].filter(([, n]) => n >= minCount).map(([f]) => f).sort();
}

const encode = (index: Map<string, number>, text: string) => features(text).map(f => index.get(f)).filter((i): i is number => i !== undefined);

function logLoss(model: { weights: number[]; bias: number }, X: number[][], y: number[]): { loss: number; acc: number } {
  let loss = 0, ok = 0;
  for (let i = 0; i < X.length; i++) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, sigmoid(model.bias + X[i].reduce((s, j) => s + model.weights[j], 0))));
    loss += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p));
    if ((p >= 0.5 ? 1 : 0) === y[i]) ok++;
  }
  return { loss: loss / Math.max(1, X.length), acc: ok / Math.max(1, X.length) };
}

export function fit(train: { text: string; label: number }[], val: { text: string; label: number }[], o: FitOptions = DEFAULT_FIT): { model: TextModel; history: EpochLog[] } {
  const vocab = buildVocab(train.map(s => s.text), o.minCount);
  const index = new Map(vocab.map((f, i) => [f, i]));
  const X = train.map(s => encode(index, s.text)), y = train.map(s => s.label);
  const Xv = val.map(s => encode(index, s.text)), yv = val.map(s => s.label);
  const w = new Array<number>(vocab.length).fill(0);
  let b = 0;
  const rng = makeRng(o.seed);
  const order = X.map((_, i) => i);
  const history: EpochLog[] = [];
  const log = (epoch: number) => {
    const tr = logLoss({ weights: w, bias: b }, X, y), va = logLoss({ weights: w, bias: b }, Xv, yv);
    history.push({ epoch, trainLoss: tr.loss, valLoss: va.loss, valAccuracy: va.acc });
  };
  log(0);   // before training: every weight 0 → p = 0.5 → loss ln 2 ≈ 0.693
  for (let epoch = 1; epoch <= o.epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const lr = o.learningRate / Math.sqrt(epoch);
    for (let start = 0; start < order.length; start += o.batchSize) {
      const batch = order.slice(start, start + o.batchSize);
      const grad = new Map<number, number>();
      let gb = 0;
      for (const i of batch) {
        const err = sigmoid(b + X[i].reduce((s, j) => s + w[j], 0)) - y[i];   // d loss / d z
        gb += err;
        for (const j of X[i]) grad.set(j, (grad.get(j) ?? 0) + err);
      }
      const n = batch.length;
      for (const [j, g] of grad) w[j] -= lr * (g / n + o.l2 * w[j]);
      b -= lr * (gb / n);
    }
    log(epoch);
  }
  return { model: { vocab, weights: w.map(v => Math.round(v * 1e6) / 1e6), bias: Math.round(b * 1e6) / 1e6 }, history };
}

/** A fitted model, ready to score messages. */
export function scorer(model: TextModel) {
  const index = new Map(model.vocab.map((f, i) => [f, i]));
  return {
    probability(text: string): number {
      return sigmoid(model.bias + features(text).reduce((s, f) => s + (model.weights[index.get(f) ?? -1] ?? 0), 0));
    },
    /** the features present in the message that pushed it most towards scam (positive) or legitimate (negative) */
    contributions(text: string, k = 5): { feature: string; weight: number }[] {
      return features(text).map(f => ({ feature: f, weight: model.weights[index.get(f) ?? -1] ?? 0 }))
        .filter(x => x.weight !== 0).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, k);
    },
  };
}

/** The learned weights, strongest first: what the model associates with scams and with legitimate messages. */
export function topFeatures(model: TextModel, k = 20) {
  const all = model.vocab.map((f, i) => ({ feature: f, weight: model.weights[i] }));
  return {
    scam: [...all].sort((a, b) => b.weight - a.weight).slice(0, k),
    legitimate: [...all].sort((a, b) => a.weight - b.weight).slice(0, k),
  };
}
