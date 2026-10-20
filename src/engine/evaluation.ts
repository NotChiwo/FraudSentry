// ============================================================
// FraudSentry — model evaluation beyond accuracy
//
//  • ROC curve and ROC-AUC from the forest's fraud probabilities
//    (AUC = probability that a random fake receipt scores higher than a
//    random genuine one; ties count half — the Mann-Whitney statistic).
//  • McNemar's test: do two classifiers make significantly different
//    errors on the SAME test receipts? This is what tests the thesis
//    hypothesis "the Random Forest significantly improves detection"
//    against the rule-based checks alone. Exact binomial when the
//    disagreements are few (< 25), chi-square with continuity correction
//    otherwise.
// Pure functions.
// ============================================================

export interface RocPoint { fpr: number; tpr: number; threshold: number }

/** ROC curve, from (0,0) to (1,1), one point per distinct score. */
export function rocCurve(yTrue: number[], scores: number[]): RocPoint[] {
  const P = yTrue.filter(y => y === 1).length, N = yTrue.length - P;
  if (!P || !N) return [];
  const order = scores.map((s, i) => [s, yTrue[i]] as const).sort((a, b) => b[0] - a[0]);
  const pts: RocPoint[] = [{ fpr: 0, tpr: 0, threshold: Infinity }];
  let tp = 0, fp = 0;
  for (let i = 0; i < order.length; i++) {
    if (order[i][1] === 1) tp++; else fp++;
    if (i === order.length - 1 || order[i + 1][0] !== order[i][0]) pts.push({ fpr: fp / N, tpr: tp / P, threshold: order[i][0] });
  }
  return pts;
}

/** Area under the ROC curve (null when the test set has only one class). */
export function rocAuc(yTrue: number[], scores: number[]): number | null {
  const pos = scores.filter((_, i) => yTrue[i] === 1), neg = scores.filter((_, i) => yTrue[i] !== 1);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export interface McNemar {
  /** A right, B wrong */
  onlyARight: number;
  /** A wrong, B right */
  onlyBRight: number;
  method: 'exact' | 'chi-square';
  statistic: number | null;
  pValue: number;
  significant: boolean;
}

function logChoose(n: number, k: number) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}
// complementary error function (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7)
function erfc(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
}

/** McNemar's test of two classifiers' predictions against the truth. */
export function mcnemar(yTrue: number[], predA: number[], predB: number[], alpha = 0.05): McNemar {
  let b = 0, c = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const a = predA[i] === yTrue[i], bb = predB[i] === yTrue[i];
    if (a && !bb) b++; else if (!a && bb) c++;
  }
  const n = b + c;
  if (n === 0) return { onlyARight: 0, onlyBRight: 0, method: 'exact', statistic: null, pValue: 1, significant: false };
  if (n < 25) {
    const k = Math.min(b, c);
    let tail = 0;
    for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
    const p = Math.min(1, 2 * tail);
    return { onlyARight: b, onlyBRight: c, method: 'exact', statistic: null, pValue: p, significant: p < alpha };
  }
  const chi2 = (Math.abs(b - c) - 1) ** 2 / n;
  const p = erfc(Math.sqrt(chi2 / 2));     // chi-square, 1 degree of freedom
  return { onlyARight: b, onlyBRight: c, method: 'chi-square', statistic: chi2, pValue: p, significant: p < alpha };
}
