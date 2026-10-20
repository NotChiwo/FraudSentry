// Detection Model page (V9.1): ROC curve, the model registry (RF_MODEL) and
// the rules-vs-forest comparison that tests the thesis hypothesis.
import { useState } from 'react';
import { History, Play, Loader2, FlaskConical, Trash2, Check } from 'lucide-react';
import type { RocPoint } from '../../engine/evaluation';
import { useAppStore } from '../../store/useAppStore';
import { canReactivate, sourceLabel, DEMO_MODEL_ID, DEMO_MODEL_NAME, type ModelRecord } from '../../services/modelRegistry';
import { switchToDemoModel, type SharedModelMeta } from '../../engine/sharedModel';
import { restoreLabelledModel, compareApproaches, readiness, type Comparison, type ApproachResult } from '../../services/trainingData';
import { formatDateTime } from '../../utils/helpers';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const auc = (v: number | null) => (v == null ? '—' : v.toFixed(3));

export function RocChart({ points, area }: { points: RocPoint[]; area: number | null }) {
  const W = 260, H = 220, P = 34;
  const x = (f: number) => P + f * (W - P - 10), y = (t: number) => H - P - t * (H - P - 10);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.fpr).toFixed(1)},${y(p.tpr).toFixed(1)}`).join(' ');
  return (
    <div className="card">
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>ROC curve</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        How well the forest's fraud probability separates fake from genuine at every threshold. Area under the curve (ROC-AUC): <b className="mono" style={{ color: 'var(--text-primary)' }}>{auc(area)}</b> (1.0 = perfect, 0.5 = guessing).
      </div>
      {points.length ? (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 340 }} role="img" aria-label={`ROC curve, area ${auc(area)}`}>
          <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--border-strong, #94a3b8)" strokeDasharray="4 4" />
          <rect x={x(0)} y={y(1)} width={x(1) - x(0)} height={y(0) - y(1)} fill="none" stroke="var(--border-default)" />
          <path d={`${d} L${x(1)},${y(0)} L${x(0)},${y(0)} Z`} fill="var(--accent)" opacity="0.12" />
          <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
          <text x={(x(0) + x(1)) / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-muted)">False positive rate</text>
          <text x={10} y={(y(0) + y(1)) / 2} textAnchor="middle" fontSize="10" fill="var(--text-muted)" transform={`rotate(-90 10 ${(y(0) + y(1)) / 2})`}>True positive rate</text>
          {[0, 0.5, 1].map(t => <text key={`x${t}`} x={x(t)} y={y(0) + 13} textAnchor="middle" fontSize="9" fill="var(--text-muted)">{t}</text>)}
          {[0.5, 1].map(t => <text key={`y${t}`} x={x(0) - 5} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--text-muted)">{t}</text>)}
        </svg>
      ) : <p className="muted small">The test set needs both genuine and fake rows to draw a curve.</p>}
    </div>
  );
}

/** RF_MODEL: every forest trained here, which one scans use, and switching back. */
export function ModelRegistryCard({ live }: { live: SharedModelMeta }) {
  const models = useAppStore(s => s.models);
  const removeModel = useAppStore(s => s.removeModel);
  const trainingRows = useAppStore(s => s.trainingRows);
  const setLabelledModel = useAppStore(s => s.setLabelledModel);
  const [busy, setBusy] = useState<string | null>(null);
  const ids = new Set(trainingRows.map(r => r.id));

  const activate = async (rec: ModelRecord | 'demo') => {
    setBusy(rec === 'demo' ? DEMO_MODEL_ID : rec.id);
    try {
      if (rec === 'demo') { await switchToDemoModel(); setLabelledModel(null); }
      else {
        const opts = { nTrees: rec.nTrees, maxDepth: rec.maxDepth, rowIds: rec.rowIds, modelId: rec.id, modelName: rec.name, trainedAt: rec.trainedAt };
        await restoreLabelledModel(trainingRows, opts);
        setLabelledModel(opts);
      }
    } finally { setBusy(null); }
  };

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <History size={16} color="var(--accent-light)" />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Model history</span>
        <span className="badge badge-neutral" style={{ marginLeft: 'auto' }}>{models.length + 1} models</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Every forest trained on this device, with its held-out test metrics. Each check records which model scored it. Only the recipe of a model is kept (its data and settings), so a forest trained on labelled receipts is rebuilt exactly when you switch back to it.
      </div>
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>Model</th><th>Data</th><th>Trees / depth</th><th>Train / test</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th><th>ROC-AUC</th><th>Trained</th><th /></tr></thead>
          <tbody>
            {models.map(m => {
              const inUse = live.modelId === m.id;
              const can = canReactivate(m, ids);
              return (
                <tr key={m.id}>
                  <td><b>{m.name}</b>{inUse && <span className="role-chip admin" style={{ marginLeft: 6 }}>In use</span>}</td>
                  <td>{sourceLabel(m.datasetSource)}</td>
                  <td>{m.nTrees} / {m.maxDepth}</td>
                  <td>{m.trainRows} / {m.testRows}</td>
                  <td>{pct(m.accuracy)}</td><td>{pct(m.precision)}</td><td>{pct(m.recall)}</td><td>{pct(m.f1)}</td><td>{auc(m.rocAuc)}</td>
                  <td>{formatDateTime(m.trainedAt)}{m.trainedBy ? ` · ${m.trainedBy}` : ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!inUse && (can.ok
                      ? <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => void activate(m)}>{busy === m.id ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Use for scans</button>
                      : <span className="muted small" title={can.reason}>{can.reason}</span>)}
                    {!inUse && <button type="button" className="btn-ghost" aria-label={`Delete record ${m.name}`} onClick={() => removeModel(m.id)}><Trash2 size={14} /></button>}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td><b>{DEMO_MODEL_NAME}</b>{live.modelId === DEMO_MODEL_ID && <span className="role-chip admin" style={{ marginLeft: 6 }}>In use</span>}</td>
              <td>demonstration data</td><td>40 / 9</td><td>440 / —</td>
              <td colSpan={5} className="muted">trained on all 440 synthetic rows (train it here to see test metrics)</td>
              <td>built in</td>
              <td>{live.modelId !== DEMO_MODEL_ID && <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => void activate('demo')}>{busy === DEMO_MODEL_ID ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Use for scans</button>}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Thesis hypothesis: does adding the Random Forest significantly improve detection over the rules alone? */
export function ComparisonCard({ nTrees, maxDepth }: { nTrees: number; maxDepth: number }) {
  const rows = useAppStore(s => s.trainingRows);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Comparison | null | undefined>(undefined);
  const usable = rows.filter(r => typeof r.ruleScore === 'number');
  const ready = readiness(usable);
  const run = async () => { setBusy(true); try { setRes(await compareApproaches(rows, { nTrees, maxDepth })); } finally { setBusy(false); } };
  const row = (a: ApproachResult) => (
    <tr key={a.name}>
      <td><b>{a.name}</b></td><td>{pct(a.metrics.accuracy)}</td><td>{pct(a.metrics.precision)}</td><td>{pct(a.metrics.recall)}</td><td>{pct(a.metrics.f1)}</td>
      <td>{auc(a.rocAuc)}</td><td className="mono">{a.metrics.tp} / {a.metrics.fp} / {a.metrics.tn} / {a.metrics.fn}</td>
    </tr>
  );
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <FlaskConical size={16} color="var(--accent-light)" />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Does the Random Forest improve detection? (hypothesis test)</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.55 }}>
        On your labelled receipts, the same held-out 30 % is classified three ways: by the rule-based checks alone, by the forest alone, and by FraudSentry's combination of both. McNemar's test then asks whether the combination makes significantly fewer errors than the rules alone (H₀: no difference; α = 0.05).
        Uses receipts whose outcome was marked after checking with V9.1 or later (they keep the rule score): <b>{usable.length}</b> of {rows.length}.
      </div>
      <button type="button" className="btn-primary" disabled={!ready.ok || busy} onClick={() => void run()} title={ready.ok ? undefined : ready.message}>
        {busy ? <Loader2 size={15} className="spin" /> : <Play size={15} />} Run comparison
      </button>
      {!ready.ok && <p className="muted small">{ready.message}</p>}
      {res && (
        <>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="admin-table">
              <thead><tr><th>Approach</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th><th>ROC-AUC</th><th>TP / FP / TN / FN</th></tr></thead>
              <tbody>{[res.rules, res.forest, res.combined].map(row)}</tbody>
            </table>
          </div>
          {[['FraudSentry (rules + forest)', res.combinedVsRules], ['Random Forest alone', res.forestVsRules]].map(([name, m]) => {
            const t = m as Comparison['combinedVsRules'];
            return (
              <p key={name as string} className={`admin-msg${t.significant ? '' : ' neutral'}`} style={{ marginTop: 10 }}>
                <span><b>{name as string} vs rules alone:</b> right where the rules were wrong on {t.onlyARight} receipt{t.onlyARight === 1 ? '' : 's'}, wrong where the rules were right on {t.onlyBRight}.
                  McNemar ({t.method === 'exact' ? 'exact binomial' : `χ² = ${t.statistic!.toFixed(2)}`}): p = {t.pValue < 0.001 ? '< 0.001' : t.pValue.toFixed(3)}.{' '}
                  {t.significant ? <>H₀ is <b>rejected</b> at α = 0.05: the difference is statistically significant.</> : <>H₀ is <b>not rejected</b> at α = 0.05: no significant difference on these {res.testRows} test receipts.</>}</span>
              </p>
            );
          })}
          <p className="muted small">{res.rowsUsed} receipts ({res.testRows} in the test set){res.rowsSkipped ? `; ${res.rowsSkipped} labelled before V9.1 were left out` : ''}. Report the counts with the percentages; with few receipts the figures move a lot.</p>
        </>
      )}
      {res === null && <p className="muted small">Not enough usable receipts yet.</p>}
    </div>
  );
}
