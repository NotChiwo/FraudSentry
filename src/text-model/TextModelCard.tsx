// Detection Model page: the trained TEXT model (messages). Shows the proof
// that it was trained: the dataset, the training curve, the results against
// an untrained model and the rules alone (on a test set and on hand-written
// messages it never saw), the learning curve, cross-validation and the words
// it learned. "Retrain now" repeats the whole training in this browser and
// checks the result is identical to the model the app ships with.
import { useMemo, useState } from 'react';
import { MessageSquareText, Play, Loader2, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import savedReport from './trainingReport.json';
import { trainTextModel, stratifiedSplit, TEXT_SEED, DATASET_SIZE, LABEL_NOISE, type TextModelReport, type EvalResult } from './trainTextModel';
import { generateTextDataset } from './textDataset';
import { TEXT_MODEL, textModelScore, featureLabel } from './textModel';
import { analyzeMessageText } from '../message-check/messageAnalysis';
import { downloadBlob } from '../shared/helpers';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function LossChart({ h }: { h: TextModelReport['history'] }) {
  const W = 520, H = 180, P = 32;
  const max = Math.max(...h.map(e => Math.max(e.trainLoss, e.valLoss)));
  const x = (i: number) => P + (i / (h.length - 1)) * (W - P - 8);
  const y = (v: number) => H - P + 4 - (v / max) * (H - P - 12);
  const line = (k: 'trainLoss' | 'valLoss') => h.map((e, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(e[k]).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Training loss falls from ${h[0].trainLoss.toFixed(3)} to ${h[h.length - 1].trainLoss.toFixed(3)} over ${h.length - 1} epochs`} style={{ width: '100%', maxWidth: 560, height: 'auto' }}>
      <line x1={P} y1={H - P + 4} x2={W - 8} y2={H - P + 4} stroke="var(--border-color, #ccc)" />
      <line x1={P} y1={8} x2={P} y2={H - P + 4} stroke="var(--border-color, #ccc)" />
      {[0, max / 2, max].map(v => <text key={v} x={P - 4} y={y(v) + 4} fontSize="10" textAnchor="end" fill="var(--text-muted)">{v.toFixed(2)}</text>)}
      {[0, Math.round((h.length - 1) / 2), h.length - 1].map(i => <text key={i} x={x(i)} y={H - 8} fontSize="10" textAnchor="middle" fill="var(--text-muted)">{h[i].epoch}</text>)}
      <text x={(W + P) / 2} y={H} fontSize="10" textAnchor="middle" fill="var(--text-muted)">epoch</text>
      <path d={line('trainLoss')} fill="none" stroke="var(--accent, #2563eb)" strokeWidth="2" />
      <path d={line('valLoss')} fill="none" stroke="var(--accent-orange, #f59e0b)" strokeWidth="2" strokeDasharray="5 3" />
    </svg>
  );
}

function ResultsTable({ rows }: { rows: [string, EvalResult | null, boolean?][] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead><tr><th>Model</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th><th>ROC-AUC</th><th>TP / FP / TN / FN</th></tr></thead>
        <tbody>
          {rows.filter(r => r[1]).map(([name, e, bold]) => (
            <tr key={name} style={bold ? { fontWeight: 700 } : undefined}>
              <td>{name}</td><td className="mono">{pct(e!.accuracy)}</td><td className="mono">{pct(e!.precision)}</td><td className="mono">{pct(e!.recall)}</td>
              <td className="mono">{pct(e!.f1)}</td><td className="mono">{e!.auc == null ? '–' : e!.auc.toFixed(3)}</td><td className="mono">{e!.tp} / {e!.fp} / {e!.tn} / {e!.fn}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TextModelCard() {
  const [report, setReport] = useState<TextModelReport>(savedReport as TextModelReport);
  const [busy, setBusy] = useState(false);
  const [retrained, setRetrained] = useState<{ ms: number; identical: boolean } | null>(null);
  const [tryText, setTryText] = useState('Approved ka na sa P20,000 loan! Magbayad lang ng P500 processing fee para ma-release ngayon.');
  const tried = useMemo(() => (tryText.trim().length >= 8 ? textModelScore(tryText) : null), [tryText]);

  const retrain = () => {
    setBusy(true); setRetrained(null);
    setTimeout(() => {   // let the button show "Training…" first
      const t0 = performance.now();
      const run = trainTextModel(t => analyzeMessageText(t, undefined, null, { textModel: false }).riskScore);
      const ms = performance.now() - t0;
      setReport(run.report);
      setRetrained({ ms, identical: JSON.stringify(run.model) === JSON.stringify(TEXT_MODEL) });
      setBusy(false);
    }, 30);
  };
  const downloadDataset = () => {
    const [train, val, test] = stratifiedSplit(generateTextDataset(DATASET_SIZE, TEXT_SEED, LABEL_NOISE), [0.7, 0.15, 0.15], TEXT_SEED);
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = ['split,text,label,category,template', ...([['train', train], ['validation', val], ['test', test]] as const)
      .flatMap(([n, rows]) => rows.map(r => [n, q(r.text), r.label, q(r.category), r.template].join(',')))].join('\n') + '\n';
    downloadBlob(csv, 'fraudsentry-text-dataset.csv', 'text/csv');
  };
  const downloadReport = () => downloadBlob(JSON.stringify(report, null, 1), 'fraudsentry-text-model-report.json', 'application/json');

  const h = report.history, last = h[h.length - 1];
  const t = report.test, hw = report.handwritten;

  return (
    <div className="card fade-up" style={{ padding: 18, marginBottom: 18 }} aria-labelledby="tm-title">
      <h2 id="tm-title" style={{ fontSize: 16, fontWeight: 750, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}><MessageSquareText size={18} /> Text model: trained scam-message classifier</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Check Message combines its scam rules with this model. It is <b>logistic regression</b> on words and two-word phrases ({report.vocabularySize.toLocaleString()} features), trained by gradient descent on <b>{report.dataset.size.toLocaleString()} labelled messages</b> ({report.dataset.scam} scam, {report.dataset.legitimate} legitimate). The messages are synthetic, generated from {report.dataset.templates} English, Tagalog and Taglish templates. Seed {report.seed}: the same training always gives the same model.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '10px 0' }}>
        <button type="button" className="btn-primary" onClick={retrain} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <Play size={15} />} {busy ? 'Training…' : 'Retrain now in this browser'}</button>
        <button type="button" className="btn-secondary" onClick={downloadDataset}><Download size={15} /> Dataset (CSV)</button>
        <button type="button" className="btn-secondary" onClick={downloadReport}><Download size={15} /> Training report (JSON)</button>
      </div>
      {retrained && (
        <p className="small" role="status" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {retrained.identical ? <CheckCircle2 size={16} color="var(--accent-emerald, #10b981)" /> : <AlertTriangle size={16} color="var(--accent-orange, #f59e0b)" />}
          Trained {report.split.train} messages × {report.options.epochs} epochs, plus the learning curve and 5-fold cross-validation, in {(retrained.ms / 1000).toFixed(1)} s.{' '}
          {retrained.identical ? 'The result is identical to the model the app uses, weight for weight.' : 'The result differs from the shipped model: run npm run train:text.'}
        </p>
      )}

      <h3 className="section-title" style={{ marginTop: 14 }}>1. Training curve</h3>
      <p className="small muted">Log-loss after each epoch. <span style={{ color: 'var(--accent, #2563eb)' }}>━ training</span> · <span style={{ color: 'var(--accent-orange, #f59e0b)' }}>╍ validation</span> ({report.split.validation} messages held out from training). Before training (epoch 0) every weight is 0, so the model says 50 % for everything (loss {h[0].trainLoss.toFixed(3)}). After {last.epoch} epochs: training loss {last.trainLoss.toFixed(3)}, validation loss {last.valLoss.toFixed(3)}, validation accuracy {pct(last.valAccuracy)}.</p>
      <LossChart h={h} />

      <h3 className="section-title" style={{ marginTop: 14 }}>2. Test set ({report.split.test} messages never used in training)</h3>
      <ResultsTable rows={[['Untrained (all weights 0)', t.untrained], ['Rules only (before the text model)', t.rulesOnly], ['Trained text model', t.trained, true], ['Rules + text model (what the app does)', t.combined, true]]} />

      <h3 className="section-title" style={{ marginTop: 14 }}>3. Hand-written messages ({report.split.handwritten}, not from the templates)</h3>
      <p className="small muted">These messages were written separately, in different words, and never trained on. This is the honest test of whether the model learned general signs of a scam rather than the templates.</p>
      <ResultsTable rows={[['Untrained', hw.untrained], ['Rules only', hw.rulesOnly], ['Trained text model', hw.trained, true], ['Rules + text model (what the app does)', hw.combined, true]]} />
      {hw.mistakes.length > 0 && (
        <details className="small" style={{ marginTop: 6 }}>
          <summary>The {hw.mistakes.length} hand-written messages the model got wrong</summary>
          <ul>{hw.mistakes.map(m => <li key={m.text}><b>{m.label ? 'Scam' : 'Legitimate'}</b>, model {pct(m.probability)} scam: {m.text}</li>)}</ul>
        </details>
      )}

      <h3 className="section-title" style={{ marginTop: 14 }}>4. Learning curve and cross-validation</h3>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Training messages</th>{report.learningCurve.map(l => <th key={l.trainSize} className="mono">{l.trainSize}</th>)}</tr></thead>
          <tbody>
            <tr><td>Test accuracy</td>{report.learningCurve.map(l => <td key={l.trainSize} className="mono">{pct(l.accuracy)}</td>)}</tr>
            <tr><td>Test F1</td>{report.learningCurve.map(l => <td key={l.trainSize} className="mono">{pct(l.f1)}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">More training data gives better test scores, which shows the model is learning from the data. 5-fold cross-validation: accuracy {report.crossValidation.accuracy.map(pct).join(', ')}; mean F1 {pct(report.crossValidation.meanF1)} ± {pct(report.crossValidation.sdF1)}.</p>

      <h3 className="section-title" style={{ marginTop: 14 }}>5. What it learned</h3>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Towards scam</th><th>Weight</th><th>Towards legitimate</th><th>Weight</th></tr></thead>
          <tbody>
            {report.topScam.slice(0, 15).map((s, i) => (
              <tr key={s.feature}><td>{featureLabel(s.feature)}</td><td className="mono">+{s.weight.toFixed(3)}</td><td>{featureLabel(report.topLegitimate[i].feature)}</td><td className="mono">{report.topLegitimate[i].weight.toFixed(3)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="section-title" style={{ marginTop: 14 }}>6. Try it</h3>
      <textarea className="input-field" rows={3} value={tryText} onChange={e => setTryText(e.target.value)} aria-label="A message to score with the text model" style={{ width: '100%', resize: 'vertical' }} />
      {tried && (
        <p className="small" style={{ marginBottom: 0 }}>
          The model says <b>{pct(tried.probability)} scam-like</b>. Words that weighed most: {tried.signals.map(s => <span key={s.feature} className="badge badge-neutral" style={{ marginRight: 4 }}>{featureLabel(s.feature)} {s.weight > 0 ? '+' : ''}{s.weight.toFixed(2)}</span>)}
        </p>
      )}
      <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>Limits: the training messages are synthetic. They prove the method and show what the model learns, but real collected, labelled messages are needed to measure field accuracy. Retrain with <code>npm run train:text</code>; the full report is in <code>docs/text-model/REPORT.md</code>.</p>
    </div>
  );
}
