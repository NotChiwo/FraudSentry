// Detection Model page: the thesis hypothesis test — the Random Forest vs. a
// single Decision Tree on the same data (same split, same test samples),
// with McNemar's test and stratified 10-fold cross-validation.
import { useEffect, useRef, useState } from 'react';
import { GitCompareArrows, Play, Loader2, Download } from 'lucide-react';
import type { Dataset } from './randomForest';
import { DEFAULT_DT_OPTIONS } from './decisionTree';
import { runTreeComparison, CV_FOLDS, SPLIT_SEED, CV_SEED, canCrossValidate, type TreeComparison, type MeanSd } from './treeComparison';
import { downloadBlob } from '../shared/helpers';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const pts = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}`;
const ms = (m: MeanSd) => `${(m.mean * 100).toFixed(2)} (${(m.sd * 100).toFixed(2)})`;
const pval = (p: number) => (p < 0.0001 ? '< 0.0001' : p.toFixed(4));
const METRICS: ['accuracy' | 'precision' | 'recall' | 'f1', string][] = [['accuracy', 'Accuracy'], ['precision', 'Precision'], ['recall', 'Recall'], ['f1', 'F1-score']];

export function comparisonCsv(r: TreeComparison): string {
  const L: string[] = ['section,measure,random_forest,decision_tree,difference'];
  const s = r.split;
  for (const [k, label] of METRICS) L.push(`test split,${label},${(s.forest[k] * 100).toFixed(2)},${(s.tree[k] * 100).toFixed(2)},${((s.forest[k] - s.tree[k]) * 100).toFixed(2)}`);
  L.push(`test split,ROC-AUC,${s.forestAuc?.toFixed(3) ?? ''},${s.treeAuc?.toFixed(3) ?? ''},`);
  for (const k of ['tp', 'fp', 'tn', 'fn'] as const) L.push(`test split,${k.toUpperCase()},${s.forest[k]},${s.tree[k]},`);
  L.push(`mcnemar,both right,${s.test.bothRight},,`, `mcnemar,RF right DT wrong (b),${s.test.onlyARight},,`, `mcnemar,RF wrong DT right (c),${s.test.onlyBRight},,`,
    `mcnemar,both wrong,${s.test.bothWrong},,`, `mcnemar,method,${s.test.method},,`, `mcnemar,p-value,${s.test.pValue.toFixed(4)},,`);
  if (r.cv) {
    for (const [k, label] of METRICS) L.push(`${CV_FOLDS}-fold CV,${label} mean,${(r.cv.forest[k].mean * 100).toFixed(2)},${(r.cv.tree[k].mean * 100).toFixed(2)},${((r.cv.forest[k].mean - r.cv.tree[k].mean) * 100).toFixed(2)}`,
      `${CV_FOLDS}-fold CV,${label} SD,${(r.cv.forest[k].sd * 100).toFixed(2)},${(r.cv.tree[k].sd * 100).toFixed(2)},`);
    r.cv.perFold.forEach((f, i) => L.push(`${CV_FOLDS}-fold CV,fold ${i + 1} accuracy (n=${f.size}),${(f.forest.accuracy * 100).toFixed(2)},${(f.tree.accuracy * 100).toFixed(2)},${((f.forest.accuracy - f.tree.accuracy) * 100).toFixed(2)}`));
  }
  return L.join('\n') + '\n';
}

export default function TreeComparisonCard({ dataset, nTrees, maxDepth, datasetLabel }: { dataset: Dataset; nTrees: number; maxDepth: number; datasetLabel: string }) {
  const [res, setRes] = useState<TreeComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  // a different dataset or forest setting makes an old result stale
  useEffect(() => { abortRef.current?.abort(); setRes(null); setBusy(false); setStep(''); }, [dataset, nTrees, maxDepth]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const tooSmall = dataset.y.length < 20 || !dataset.y.includes(0) || !dataset.y.includes(1);
  const run = async () => {
    const ctrl = new AbortController(); abortRef.current = ctrl;
    setBusy(true); setRes(null);
    try {
      const r = await runTreeComparison(dataset, { nTrees, maxDepth }, DEFAULT_DT_OPTIONS, (done, total) => {
        setStep(done === 0 ? 'Training both models on the 70 % split' : done < total ? `Cross-validation: fold ${done} of ${CV_FOLDS}` : 'Done');
      }, ctrl.signal);
      if (!ctrl.signal.aborted) setRes(r);
    } finally { if (!ctrl.signal.aborted) setBusy(false); }
  };

  const s = res?.split, t = s?.test;
  return (
    <div className="card fade-up" style={{ padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <GitCompareArrows size={16} color="var(--accent-light)" />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Hypothesis test: Random Forest vs. Decision Tree</span>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 12px' }}>
        <b>H₀:</b> there is no significant difference in classification accuracy between the Random Forest and a Decision Tree. <b>H₁:</b> there is.
        Both models are trained on the same 70 % of <b>{datasetLabel}</b> and tested on the same 30 %, then compared with McNemar's test (α = 0.05) and checked with stratified {CV_FOLDS}-fold cross-validation.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn-primary" disabled={busy || tooSmall} onClick={() => void run()}>
          {busy ? <Loader2 size={15} className="spin" /> : <Play size={15} />} {res ? 'Run again' : 'Run comparison'}
        </button>
        {busy && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{step}</span>}
        {tooSmall && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Needs at least 20 rows with both classes.</span>}
        {res && !busy && <button type="button" className="btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => downloadBlob(comparisonCsv(res), `fraudsentry-rf-vs-dt-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv')}><Download size={13} /> Export CSV</button>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 10 }}>
        Random Forest: {nTrees} trees, depth {maxDepth}, bootstrap samples, √n random features per split. Decision Tree: one tree, depth {DEFAULT_DT_OPTIONS.maxDepth}, at least {DEFAULT_DT_OPTIONS.minSamplesSplit} samples to split, all features, all training rows. Both: Gini impurity, fraudulent at probability ≥ 0.50, split seed {SPLIT_SEED}, cross-validation seed {CV_SEED}.
      </div>

      {s && t && (
        <>
          <div className="table-scroll" style={{ marginTop: 14 }}>
            <table className="data-table">
              <thead><tr><th>Test set ({s.testRows} samples)</th><th>Random Forest</th><th>Decision Tree</th><th>Difference (points)</th></tr></thead>
              <tbody>
                {METRICS.map(([k, label]) => (
                  <tr key={k}><td><b>{label}</b></td><td className="mono">{pct(s.forest[k])}</td><td className="mono">{pct(s.tree[k])}</td><td className="mono">{pts(s.forest[k] - s.tree[k])}</td></tr>
                ))}
                <tr><td><b>ROC-AUC</b></td><td className="mono">{s.forestAuc?.toFixed(3) ?? '—'}</td><td className="mono">{s.treeAuc?.toFixed(3) ?? '—'}</td><td /></tr>
                <tr><td>Frauds caught (TP) / missed (FN)</td><td className="mono">{s.forest.tp} / {s.forest.fn}</td><td className="mono">{s.tree.tp} / {s.tree.fn}</td><td /></tr>
                <tr><td>False alarms (FP) / genuine passed (TN)</td><td className="mono">{s.forest.fp} / {s.forest.tn}</td><td className="mono">{s.tree.fp} / {s.tree.tn}</td><td /></tr>
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14, marginTop: 14, alignItems: 'start' }}>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Paired outcomes</th><th>DT right</th><th>DT wrong</th></tr></thead>
                <tbody>
                  <tr><td><b>RF right</b></td><td className="mono">{t.bothRight}</td><td className="mono">{t.onlyARight} (b)</td></tr>
                  <tr><td><b>RF wrong</b></td><td className="mono">{t.onlyBRight} (c)</td><td className="mono">{t.bothWrong}</td></tr>
                </tbody>
              </table>
            </div>
            <p className={`notice${t.significant ? '' : ' neutral'}`} style={{ margin: 0 }}>
              <span>
                The models disagreed on <b>{t.onlyARight + t.onlyBRight}</b> sample{t.onlyARight + t.onlyBRight === 1 ? '' : 's'}: the Random Forest was right on {t.onlyARight}, the Decision Tree on {t.onlyBRight}.{' '}
                McNemar ({t.method === 'exact' ? 'exact binomial, since b + c < 25' : `χ² = ${t.statistic!.toFixed(2)}`}): <b>p = {pval(t.pValue)}</b>.{' '}
                {t.significant
                  ? <>p &lt; 0.05, so <b>H₀ is rejected</b>: the difference in accuracy is statistically significant, in favour of the {t.onlyARight > t.onlyBRight ? 'Random Forest' : 'Decision Tree'}.</>
                  : <>p ≥ 0.05, so <b>H₀ is not rejected</b>: no significant difference on these {s.testRows} test samples.</>}
              </span>
            </p>
          </div>

          {res.cv ? (
            <>
              <div className="table-scroll" style={{ marginTop: 14 }}>
                <table className="data-table">
                  <thead><tr><th>Stratified {CV_FOLDS}-fold CV</th><th>RF mean (SD)</th><th>DT mean (SD)</th><th>Difference (points)</th></tr></thead>
                  <tbody>
                    {METRICS.map(([k, label]) => (
                      <tr key={k}><td><b>{label}</b></td><td className="mono">{ms(res.cv!.forest[k])}</td><td className="mono">{ms(res.cv!.tree[k])}</td><td className="mono">{pts(res.cv!.forest[k].mean - res.cv!.tree[k].mean)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 8 }}>
                Accuracy per fold (RF / DT): {res.cv.perFold.map((f, i) => <span key={i} className="mono" style={{ whiteSpace: 'nowrap' }}>{i + 1}: {(f.forest.accuracy * 100).toFixed(1)} / {(f.tree.accuracy * 100).toFixed(1)}{i < res.cv!.perFold.length - 1 ? ' · ' : ''}</span>)}
                <br />The Random Forest had the higher accuracy in {res.cv.forestWins} of {res.cv.folds} folds{res.cv.ties ? `, tied in ${res.cv.ties}` : ''}{res.cv.treeWins ? `, and was lower in ${res.cv.treeWins}` : ''}. Cross-validation is a consistency check, not a second significance test.
              </div>
            </>
          ) : (
            <p className="muted small" style={{ marginTop: 10 }}>Cross-validation skipped: each class needs at least {CV_FOLDS} rows.</p>
          )}
          {!canCrossValidate(dataset.y) ? null : (
            <p className="muted small" style={{ marginTop: 8 }}>Report the counts (TP / FP / TN / FN and b / c) with the percentages. On the demonstration dataset these results show the method works, not how it performs on real receipts.</p>
          )}
        </>
      )}
    </div>
  );
}
