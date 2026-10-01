import { useState, useEffect, useRef } from 'react';
import {
  Trees, Play, RefreshCw, Upload, Database, Target, Crosshair,
  Activity, BarChart3, Info, CheckCircle2, AlertTriangle, FlaskConical, Cpu, Link2, Unlink,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  RandomForest, trainTestSplit, computeMetrics, Metrics, Dataset,
} from '../engine/randomForest';
import {
  generateDemoDataset, parseCsvDataset, FEATURE_SPECS, CLASS_NAMES, isEvidenceSchema,
} from '../services/sampleDataset';
import { setSharedModel, getSharedModelMeta, onSharedModelChange, SharedModelMeta } from '../engine/sharedModel';
import { formatDateTime } from '../utils/helpers';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---- Animated number that counts up ----
function CountUp({ value, suffix = '', decimals = 1, duration = 900 }: { value: number; suffix?: string; decimals?: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number | undefined>(undefined);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [value, duration]);
  return <>{display.toFixed(decimals)}{suffix}</>;
}

const PRESET_AUTHENTIC = [8, 1, 0, 90, 1, 1, 1, 1, 0, 92];
const PRESET_TAMPERED = [42, 0, 1, 61, 0, 0, 1, 1, 3, 55];

export default function ModelPage() {
  const [dataset, setDataset] = useState<Dataset>(() => generateDemoDataset());
  const [datasetSource, setDatasetSource] = useState<'demo' | 'uploaded'>('demo');
  const [nTrees, setNTrees] = useState(40);
  const [maxDepth, setMaxDepth] = useState(9);

  const [phase, setPhase] = useState<'idle' | 'training' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [model, setModel] = useState<RandomForest | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [importances, setImportances] = useState<number[]>([]);
  const [trainSize, setTrainSize] = useState(0);
  const [testSize, setTestSize] = useState(0);
  const [error, setError] = useState('');

  const [probeVec, setProbeVec] = useState<number[]>(PRESET_AUTHENTIC);
  // Which forest live Transaction Checks currently use, and whether the last
  // training run could be connected to them.
  const [liveMeta, setLiveMeta] = useState<SharedModelMeta>(() => getSharedModelMeta());
  const [wired, setWired] = useState<boolean | null>(null);
  useEffect(() => onSharedModelChange(setLiveMeta), []);
  const [revealed, setRevealed] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  // Trigger the bar-grow animation once results are shown.
  useEffect(() => {
    if (phase === 'done') {
      setRevealed(false);
      const t = setTimeout(() => setRevealed(true), 60);
      return () => clearTimeout(t);
    }
  }, [phase, metrics]);

  const fraudCount = dataset.y.filter(v => v === 1).length;
  const legitCount = dataset.y.length - fraudCount;
  const fraudPct = Math.round((fraudCount / dataset.y.length) * 100);

  async function train() {
    setError(''); setPhase('training'); setProgress(0.05);
    setStage('Preprocessing & stratified 70/30 split');
    await wait(550); setProgress(0.22);
    const { train, test } = trainTestSplit(dataset, 0.3, 42);
    setTrainSize(train.y.length); setTestSize(test.y.length);
    setStage(`Growing ${nTrees} decision trees (bagging + √n features)`);
    await wait(120); setProgress(0.5);
    const rf = new RandomForest({ nTrees, maxDepth, minSamplesSplit: 4, seed: 42 });
    rf.fit(train.X, train.y);                       // real training
    await wait(120); setProgress(0.78);
    setStage('Evaluating on the held-out test set');
    await wait(450);
    const yPred = rf.predictBatch(test.X);
    const m = computeMetrics(test.y, yPred);
    setProgress(1); await wait(280);
    setModel(rf); setMetrics(m); setImportances(rf.importances);
    // Connect this forest to every FUTURE scan — only possible when it was
    // trained on the same 10 evidence features the scanner produces.
    setWired(setSharedModel(rf, dataset.featureNames, {
      datasetSource: datasetSource === 'demo' ? 'demo' : 'csv',
      nTrees, maxDepth, trainRows: train.y.length,
    }));
    setPhase('done');
  }

  async function onCsv(file: File) {
    setError('');
    try {
      const ds = await parseCsvDataset(file);
      setDataset(ds); setDatasetSource('uploaded');
      setPhase('idle'); setModel(null); setMetrics(null); setWired(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that CSV.');
    }
  }

  function resetToDemo() {
    setDataset(generateDemoDataset()); setDatasetSource('demo');
    setPhase('idle'); setModel(null); setMetrics(null); setError(''); setWired(null);
  }

  const probeProba = model ? model.predictProba(probeVec) : null;
  const featNames = dataset.featureNames;
  const evidenceSchema = isEvidenceSchema(featNames);

  return (
    <div className="page" style={{ maxWidth: 1180, paddingBottom: 48 }}>
      {/* Header */}
      <div className="fade-up" style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 8 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 22px rgba(37,99,235,0.4)' }}>
          <Trees size={22} color="#fff" />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>Detection Model — Random Forest</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5, maxWidth: 720 }}>
            A real Random Forest learns, from labelled examples, how to weigh the evidence features FraudSentry extracts — instead of relying on fixed hand-set weights. Every metric below is computed on a held-out test set.
          </p>
        </div>
      </div>

      {/* Honesty notice */}
      <div className="fade-up" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)', borderRadius: 10, margin: '14px 0 22px' }}>
        <Info size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {datasetSource === 'demo'
            ? <>The loaded data is a <strong style={{ color: 'var(--text-primary)' }}>demonstration dataset</strong> — synthetically generated (seeded, reproducible) to validate the model pipeline end-to-end. It is not real collected fraud data. For your thesis results, upload your own labelled CSV of authentic vs. fraudulent evidence and the same pipeline produces your real numbers.</>
            : <>Training on your <strong style={{ color: 'var(--text-primary)' }}>uploaded dataset</strong>. Metrics below are computed on a held-out 30% test split of this data.</>}
        </div>
      </div>

      {/* Which model live scans use */}
      <div className="fade-up" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '11px 14px', background: 'var(--bg-accent-tint)', border: '1px solid var(--border-accent)', borderRadius: 10, marginBottom: 18, fontSize: 12.5, color: 'var(--text-secondary)' }}>
        <Link2 size={15} color="var(--accent-light)" style={{ flexShrink: 0 }} />
        <span>
          <strong style={{ color: 'var(--text-primary)' }}>Model used by live Transaction Checks:</strong>{' '}
          {liveMeta.datasetSource === 'demo' ? 'demonstration-trained' : 'trained on your uploaded evidence CSV'} · {liveMeta.nTrees} trees · depth {liveMeta.maxDepth} · {liveMeta.trainRows} training rows · since {formatDateTime(liveMeta.trainedAt)}
        </span>
      </div>

      {/* Config + dataset */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, marginBottom: 18 }}>
        {/* Dataset card */}
        <div className="card fade-up">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Database size={16} color="var(--accent-light)" />
            <span style={{ fontSize: 14, fontWeight: 700 }}>Dataset</span>
            <span className={`badge ${datasetSource === 'demo' ? 'badge-medium' : 'badge-accent'}`} style={{ marginLeft: 'auto' }}>
              {datasetSource === 'demo' ? 'Demonstration' : 'Uploaded CSV'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 18, marginBottom: 14, flexWrap: 'wrap' }}>
            <Stat label="Total samples" value={dataset.y.length} />
            <Stat label="Features" value={featNames.length} />
            <Stat label="Legitimate" value={legitCount} color="var(--accent-emerald)" />
            <Stat label="Fraudulent" value={fraudCount} color="var(--accent-red)" />
          </div>

          {/* class balance bar */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Class balance ({100 - fraudPct}% legit / {fraudPct}% fraud)</div>
          <div style={{ display: 'flex', height: 9, borderRadius: 99, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
            <div style={{ width: `${100 - fraudPct}%`, background: 'var(--accent-emerald)', transition: 'width 0.6s ease' }} />
            <div style={{ width: `${fraudPct}%`, background: 'var(--accent-red)', transition: 'width 0.6s ease' }} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={() => csvRef.current?.click()}><Upload size={14} /> Upload labelled CSV</button>
            {datasetSource === 'uploaded' && <button className="btn-ghost" onClick={resetToDemo}><RefreshCw size={13} /> Back to demo data</button>}
            <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onCsv(f); e.target.value = ''; }} />
          </div>
          {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent-red)', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={13} /> {error}</div>}
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            To make live scans use your model, the CSV header must list the 10 evidence features in this order, then the label: <span className="mono" style={{ overflowWrap: 'anywhere' }}>{FEATURE_SPECS.map(f => f.key).join(',')},label</span>. Other datasets (e.g. PaySim) can still be trained and evaluated here.
          </div>
        </div>

        {/* Hyperparameters */}
        <div className="card fade-up">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Cpu size={16} color="var(--accent-light)" />
            <span style={{ fontSize: 14, fontWeight: 700 }}>Model configuration</span>
          </div>
          <Slider label="Number of trees" value={nTrees} min={10} max={80} step={5} onChange={setNTrees} disabled={phase === 'training'} />
          <Slider label="Max tree depth" value={maxDepth} min={4} max={12} step={1} onChange={setMaxDepth} disabled={phase === 'training'} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            Each tree trains on a bootstrap sample and considers √{featNames.length} ≈ {Math.ceil(Math.sqrt(featNames.length))} random features per split. Seed is fixed (42) for reproducible results.
          </div>
          <button className="btn-primary" style={{ width: '100%', marginTop: 16, justifyContent: 'center' }} onClick={train} disabled={phase === 'training'}>
            {phase === 'training' ? <><RefreshCw size={15} className="spin" /> Training…</> : <><Play size={15} /> {model ? 'Retrain model' : 'Train model'}</>}
          </button>
        </div>
      </div>

      {/* Training progress */}
      {phase === 'training' && (
        <div className="card scale-in" style={{ marginBottom: 18, textAlign: 'center', padding: '26px 22px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-light)', marginBottom: 12 }}>{stage}</div>
          <div className="score-track" style={{ maxWidth: 460, margin: '0 auto' }}>
            <div className="score-fill" style={{ width: `${progress * 100}%`, background: 'linear-gradient(90deg,#3b82f6,#60a5fa)' }} />
          </div>
        </div>
      )}

      {/* Empty state */}
      {phase === 'idle' && !model && (
        <div className="card fade-up" style={{ textAlign: 'center', padding: '46px 24px', borderStyle: 'dashed' }}>
          <FlaskConical size={34} color="var(--accent-light)" style={{ opacity: 0.85 }} />
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 12 }}>Ready to train</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.55 }}>
            Press <strong>Train model</strong> to split the data, grow the forest, and evaluate it with Accuracy, Precision, Recall and F1-score on unseen rows.
          </div>
        </div>
      )}

      {/* Results */}
      {phase === 'done' && metrics && (
        <div className="fade-up">
          {wired != null && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 10, marginBottom: 16, background: wired ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)', border: `1px solid ${wired ? 'rgba(16,185,129,0.28)' : 'rgba(245,158,11,0.28)'}` }}>
              {wired ? <Link2 size={16} color="var(--accent-emerald)" style={{ flexShrink: 0, marginTop: 1 }} /> : <Unlink size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />}
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                {wired
                  ? <><strong style={{ color: 'var(--text-primary)' }}>Connected to live scans.</strong> Every future Transaction Check now scores its evidence through this forest ({nTrees} trees) and blends the vote 50/50 with the rule-based findings.</>
                  : <><strong style={{ color: 'var(--text-primary)' }}>Evaluated here only — not connected to live scans.</strong> This dataset&apos;s columns ({featNames.slice(0, 4).join(', ')}{featNames.length > 4 ? ', …' : ''}) are not the 10 receipt-evidence features the scanner produces, so feeding receipt evidence into this forest would give a meaningless number. Live scans keep using the previous model.</>}
              </div>
            </div>
          )}
          {/* Metric cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14, marginBottom: 18 }}>
            <MetricCard icon={Target} label="Accuracy" value={metrics.accuracy * 100} hint="Overall correct predictions" color="var(--accent-emerald)" />
            <MetricCard icon={Crosshair} label="Precision" value={metrics.precision * 100} hint="Of flagged fraud, how many were right" color="var(--accent)" />
            <MetricCard icon={Activity} label="Recall" value={metrics.recall * 100} hint="Of real fraud, how much we caught" color="var(--accent-indigo)" />
            <MetricCard icon={BarChart3} label="F1-Score" value={metrics.f1 * 100} hint="Balance of precision & recall" color="var(--accent-orange)" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, marginBottom: 18 }}>
            {/* Confusion matrix */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>Confusion matrix</span>
                <span className="badge badge-neutral" style={{ marginLeft: 'auto' }}>{testSize} test rows</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>Trained on {trainSize} rows · evaluated on {testSize} unseen rows</div>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 6, alignItems: 'center' }}>
                <div />
                <ColHead>Predicted Legit</ColHead>
                <ColHead>Predicted Fraud</ColHead>
                <RowHead>Actual Legit</RowHead>
                <Cell n={metrics.tn} good delay={0} />
                <Cell n={metrics.fp} good={false} delay={80} />
                <RowHead>Actual Fraud</RowHead>
                <Cell n={metrics.fn} good={false} delay={160} />
                <Cell n={metrics.tp} good delay={240} />
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 14, fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'rgba(16,185,129,0.5)' }} /> Correct</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'rgba(239,68,68,0.5)' }} /> Error</span>
              </div>
            </div>

            {/* Feature importance */}
            <div className="card">
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Feature importance</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>Which evidence features the forest relied on most (Gini decrease). This answers “what features matter” directly from the data.</div>
              {importances
                .map((imp, i) => ({ imp, name: featNames[i] ?? `Feature ${i + 1}` }))
                .sort((a, b) => b.imp - a.imp)
                .map((row, idx, arr) => {
                  const pct = arr[0].imp > 0 ? (row.imp / arr[0].imp) * 100 : 0;
                  return (
                    <div key={row.name} style={{ marginBottom: 9 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{row.name}</span>
                        <span className="mono" style={{ color: 'var(--text-muted)' }}>{(row.imp * 100).toFixed(1)}%</span>
                      </div>
                      <div className="score-track">
                        <div className="score-fill" style={{ width: revealed ? `${pct}%` : '0%', background: 'linear-gradient(90deg,#2563eb,#60a5fa)', transitionDelay: `${idx * 60}ms` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Live classifier — its sliders ARE the 10 evidence features, so it only
              makes sense for a model trained on those features */}
          {!evidenceSchema ? (
            <div className="card" style={{ fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <Info size={15} color="var(--accent-light)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Live classification uses the 10 receipt-evidence features as inputs, so it is available only for models trained on evidence data. This model was trained on {featNames.length} other columns.</span>
            </div>
          ) : (
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Crosshair size={16} color="var(--accent-light)" />
              <span style={{ fontSize: 14, fontWeight: 700 }}>Live classification</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>Feed the trained model a feature vector and see its fraud probability. Try a preset or move the sliders.</div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <button className="btn-secondary" onClick={() => setProbeVec([...PRESET_AUTHENTIC])}><CheckCircle2 size={13} /> Authentic-looking sample</button>
              <button className="btn-secondary" onClick={() => setProbeVec([...PRESET_TAMPERED])}><AlertTriangle size={13} /> Tampered-looking sample</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '10px 18px' }}>
                {FEATURE_SPECS.map((spec, i) => (
                  <ProbeSlider key={spec.key} spec={spec} value={probeVec[i] ?? 0}
                    onChange={v => setProbeVec(p => { const c = [...p]; c[i] = v; return c; })} />
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <ProbabilityRing proba={probeProba ?? 0} />
                {probeProba != null && (
                  <div style={{ marginTop: 12, textAlign: 'center' }}>
                    <span className={`badge ${probeProba >= 0.5 ? 'badge-high' : 'badge-low'}`}>
                      {probeProba >= 0.5 ? CLASS_NAMES[1] : CLASS_NAMES[0]}
                    </span>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, maxWidth: 180, lineHeight: 1.5 }}>
                      Forest vote across {model?.treeCount} trees. ≥ 50% ⇒ classified fraudulent.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- small presentational helpers ----------
function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: color ?? 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 1 }}>{label}</div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, disabled }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="mono" style={{ color: 'var(--accent-light)', fontWeight: 700 }}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#2563eb', cursor: disabled ? 'not-allowed' : 'pointer' }} />
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, hint, color }: { icon: LucideIcon; label: string; value: number; hint: string; color: string }) {
  return (
    <div className="kpi-card scale-in" style={{ borderTop: `2px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Icon size={15} color={color} />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
      </div>
      <div className="mono" style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1 }}>
        <CountUp value={value} suffix="%" decimals={2} />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.45 }}>{hint}</div>
    </div>
  );
}

function ColHead({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{children}</div>;
}
function RowHead({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{children}</div>;
}
function Cell({ n, good, delay }: { n: number; good: boolean; delay: number }) {
  const bg = good ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.13)';
  const bd = good ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)';
  const col = good ? 'var(--accent-emerald)' : 'var(--accent-red)';
  return (
    <div className="scale-in" style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 10, padding: '16px 8px', textAlign: 'center', animationDelay: `${delay}ms` }}>
      <div className="mono" style={{ fontSize: 26, fontWeight: 800, color: col }}>{n}</div>
    </div>
  );
}

function ProbeSlider({ spec, value, onChange }: { spec: typeof FEATURE_SPECS[number]; value: number; onChange: (v: number) => void }) {
  if (spec.kind === 'binary') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }} title={spec.description}>{spec.label}</span>
        <button onClick={() => onChange(value >= 0.5 ? 0 : 1)} className={`badge ${value >= 0.5 ? 'badge-accent' : 'badge-neutral'}`} style={{ cursor: 'pointer', minWidth: 44, justifyContent: 'center' }}>
          {value >= 0.5 ? 'Yes' : 'No'}
        </button>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
        <span style={{ color: 'var(--text-secondary)' }} title={spec.description}>{spec.label}</span>
        <span className="mono" style={{ color: 'var(--text-muted)' }}>{Math.round(value)}</span>
      </div>
      <input type="range" min={spec.min} max={spec.max} step={1} value={value}
        onChange={e => onChange(Number(e.target.value))} style={{ width: '100%', accentColor: '#2563eb' }} />
    </div>
  );
}

function ProbabilityRing({ proba }: { proba: number }) {
  const r = 46, c = 2 * Math.PI * r;
  const off = c * (1 - proba);
  const col = proba >= 0.5 ? '#ef4444' : '#10b981';
  return (
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--border-default)" strokeWidth="9" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={col} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 60 60)"
        style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s ease' }} />
      <text x="60" y="56" textAnchor="middle" fontSize="24" fontWeight="800" fill={col} fontFamily="monospace">{Math.round(proba * 100)}%</text>
      <text x="60" y="74" textAnchor="middle" fontSize="9" fill="var(--text-muted)" letterSpacing="0.5">FRAUD PROB.</text>
    </svg>
  );
}
