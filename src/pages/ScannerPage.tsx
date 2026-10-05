import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ScanLine, UploadCloud, FileImage, X, RefreshCw, Download, AlertTriangle,
  CheckCircle2, ShieldAlert, Loader2, Pencil, Camera, Eye, Layers, Fingerprint, Gauge, Copy,
  Trees, ChevronDown, Info, WifiOff,
} from 'lucide-react';
import { analyzeTransactionImage } from '../engine/imageVerification';
import { generateImageReport } from '../services/reportGenerator';
import { validateExtraction, FieldCheck, FieldStatus, FieldConfidence } from '../services/fieldValidation';
import { validateImageFile, ACCEPTED_IMAGE_TYPES } from '../services/uploadValidation';
import { useAppStore } from '../store/useAppStore';
import { ImageScanResult, ExtractedTransactionData, ScanStatus, OcrResult } from '../types';
import { formatBytes, formatPHP, formatRelativeTime, RISK_META } from '../utils/helpers';

const STAGES = [
  { key: 'preprocessing', label: 'Upload received',     desc: 'Reading and validating the image file' },
  { key: 'forensics',     label: 'Forensic analysis',    desc: 'Inspecting compression, metadata & error levels' },
  { key: 'ocr',           label: 'OCR text extraction',  desc: 'Reading the on-screen text' },
  { key: 'analyzing',     label: 'Evidence scoring',     desc: 'Rule-based findings + Random Forest vote' },
  { key: 'complete',      label: 'Assessment ready',     desc: 'Final evidence-based verdict' },
];

function stageIndex(s: ScanStatus): number {
  const order: ScanStatus[] = ['preprocessing', 'forensics', 'ocr', 'analyzing', 'complete'];
  return order.indexOf(s);
}

export default function ScannerPage() {
  const addImageScan = useAppStore(s => s.addImageScan);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [stageLabel, setStageLabel] = useState('');
  const [result, setResult] = useState<ImageScanResult | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<ImageScanResult | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<ExtractedTransactionData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null); setPreview(''); setStatus('idle'); setResult(null); setDuplicateOf(null);
    setError(''); setEditing(false); setEditData(null); setStageLabel('');
  };

  const handleFile = useCallback(async (f: File) => {
    const err = await validateImageFile(f);
    if (err) { setError(err); return; }
    setError(''); setResult(null); setEditing(false);
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  }, []);

  // Paste a screenshot straight from the clipboard (Ctrl/Cmd+V) — the fastest
  // path on desktop when the receipt was just copied from a chat.
  const busy = status !== 'idle' && status !== 'complete' && status !== 'error';
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (busy) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) { e.preventDefault(); handleFile(f); return; }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFile, busy]);

  const runScan = async (f: File, opts?: { ocrOverride?: OcrResult; extractedOverride?: ExtractedTransactionData }) => {
    setStatus('preprocessing');
    setStageLabel('Reading image');
    setError('');
    try {
      // EARLIER scans (read before this scan is added to history)
      const history = useAppStore.getState().imageScans
        .map(s => ({ id: s.id, filename: s.filename, scannedAt: s.scannedAt, extracted: s.extracted }));
      const scan = await analyzeTransactionImage(f, {
        previewDataUrl: preview,
        ocrOverride: opts?.ocrOverride,
        extractedOverride: opts?.extractedOverride,
        history: opts?.extractedOverride ? [] : history,
        onStage: (s: string) => {
          setStageLabel(s);
          if (/forensic/i.test(s)) setStatus('forensics');
          else if (/ocr|text/i.test(s)) setStatus('ocr');
          else if (/scor|evidence/i.test(s)) setStatus('analyzing');
        },
      });
      setStatus('complete');
      // Reused-receipt check: has this reference number been seen before?
      const ref = scan.extracted.referenceNo;
      const prior = ref && ref.replace(/\s/g, '').length >= 6 && !opts?.extractedOverride
        ? useAppStore.getState().imageScans.find(s => s.extracted.referenceNo && s.extracted.referenceNo.replace(/\s/g, '') === ref.replace(/\s/g, ''))
        : null;
      setDuplicateOf(prior || null);
      setResult(scan);
      setEditData(scan.extracted);
      addImageScan(scan);
    } catch (e: unknown) {
      setStatus('error');
      setError((e instanceof Error && e.message) || "We couldn't read this receipt. This can happen when the image is blurry, heavily cropped, very small, or in an unsupported format. Try a clearer, uncropped screenshot.");
    }
  };

  const reanalyzeWithEdits = async () => {
    if (!file || !result || !editData) return;
    setEditing(false);
    await runScan(file, { ocrOverride: result.ocr, extractedOverride: editData });
  };

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <PageHeader />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
        {/* Upload zone */}
        {!result && !busy && (
          <div className="card animate-fade-up" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload a transaction screenshot"
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              style={{
                margin: 20, borderRadius: 14, padding: '48px 24px', textAlign: 'center',
                border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border-strong)'}`,
                background: dragOver ? 'var(--bg-accent-tint)' : 'var(--bg-subtle)',
                transition: 'all 0.2s', cursor: 'pointer',
              }}
              onClick={() => inputRef.current?.click()}
            >
              <div style={{ width: 60, height: 60, margin: '0 auto 16px', borderRadius: 16, background: 'var(--bg-accent-tint)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UploadCloud size={28} color="var(--accent-light)" />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                Drop a transaction screenshot here
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                GCash · Maya · GoTyme · MariBank · BPI · BDO · Metrobank · UnionBank · Landbank · online banking receipts
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn-primary" onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}>
                  <FileImage size={16} /> Choose file
                </button>
                <button className="btn-secondary" onClick={e => { e.stopPropagation(); cameraRef.current?.click(); }}>
                  <Camera size={15} /> Use camera
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 16 }}>
                PNG, JPG, or WEBP · up to 10 MB · or paste with Ctrl+V · processed entirely in your browser
              </div>
            </div>
            <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </div>
        )}

        {error && (
          <div className="card" role="alert" style={{ padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'center', borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)' }}>
            <AlertTriangle size={17} color="var(--accent-red)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{error}</span>
            <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        {/* Preview + run */}
        {file && !result && !busy && (
          <div className="card animate-fade-up" style={{ padding: 18, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <img src={preview} alt="Selected receipt" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border-default)' }} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{file.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{formatBytes(file.size)} · {file.type.replace('image/', '').toUpperCase()}</div>
            </div>
            <button className="btn-ghost" onClick={reset}><X size={14} /> Remove</button>
            <button className="btn-primary" onClick={() => runScan(file)}><ScanLine size={16} /> Verify authenticity</button>
          </div>
        )}

        {/* Progress timeline */}
        {busy && <ScanProgress status={status} stageLabel={stageLabel} preview={preview} />}

        {/* Result */}
        {result && status === 'complete' && (
          <>
            {!result.ocr.available && (
              <div className="card animate-fade-up" style={{ padding: 16, borderColor: 'var(--accent-amber)' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <WifiOff size={16} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Text reading engine didn't load</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.55 }}>
                      The OCR engine downloads once from the internet on first use. It couldn't be reached just now — the image-forensics results below are still valid, but no text fields were read. Check your connection and retry.
                    </div>
                  </div>
                  <button className="btn-primary" onClick={() => file && runScan(file)} style={{ alignSelf: 'center' }}><RefreshCw size={14} /> Retry scan</button>
                </div>
              </div>
            )}
            {duplicateOf && (
              <div className="fade-up" style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 15px', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 12 }}>
                <Copy size={17} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Reused reference number.</strong> Reference <span className="mono" style={{ color: 'var(--accent-amber)' }}>{result.extracted.referenceNo}</span> was already submitted in an earlier scan ({formatRelativeTime(duplicateOf.scannedAt)}). If you did not scan the same receipt twice, be careful — sending one genuine payment screenshot to several people is a common scam. Confirm the payment directly in your own account.
                </div>
              </div>
            )}
            <ResultView
              result={result}
              preview={preview}
              editing={editing}
              editData={editData}
              setEditing={setEditing}
              setEditData={setEditData}
              onReanalyze={reanalyzeWithEdits}
              onReset={reset}
            />
          </>
        )}
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--bg-accent-tint)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <ScanLine size={19} color="var(--accent-light)" />
        </div>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: 'var(--text-primary)' }}>Transaction Authenticity Check</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
            Upload a payment screenshot. We read the text, inspect the image for signs of editing, and explain the risk — without pretending to know if money actually changed hands.
          </p>
        </div>
      </div>
    </div>
  );
}

function ScanProgress({ status, stageLabel, preview }: { status: ScanStatus; stageLabel: string; preview: string }) {
  const current = stageIndex(status);
  return (
    <div className="card animate-fade-up" style={{ padding: 24 }} aria-live="polite">
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div className="scan-frame" style={{ position: 'relative', width: 190, maxWidth: '100%', height: 210, borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
          {preview && <img src={preview} alt="Receipt being scanned" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.9)' }} />}
          <div className="scan-line" style={{ top: 0 }} />
          <span className="scan-corner tl" /><span className="scan-corner tr" />
          <span className="scan-corner bl" /><span className="scan-corner br" />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Loader2 size={16} color="var(--accent-light)" style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-primary)' }}>{stageLabel || 'Analyzing'}…</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {STAGES.map((st, i) => {
              const done = i < current;
              const active = i === current;
              return (
                <div key={st.key} className="timeline-node" style={{ paddingBottom: 14 }}>
                  <div className="timeline-dot" style={{
                    background: done ? 'var(--accent-emerald)' : active ? 'var(--accent)' : 'var(--bg-input)',
                    borderColor: 'var(--bg-base)',
                  }}>
                    {done ? <CheckCircle2 size={11} color="#fff" /> : active ? <Loader2 size={10} color="#fff" style={{ animation: 'spin 1s linear infinite' }} /> : null}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? 'var(--text-primary)' : done ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{st.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{st.desc}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultView(props: {
  result: ImageScanResult; preview: string; editing: boolean;
  editData: ExtractedTransactionData | null;
  setEditing: (v: boolean) => void;
  setEditData: (d: ExtractedTransactionData) => void;
  onReanalyze: () => void; onReset: () => void;
}) {
  const { result, preview, editing, editData, setEditing, setEditData, onReanalyze, onReset } = props;
  const [techOpen, setTechOpen] = useState(false);
  const meta = RISK_META[result.riskLevel];
  const pct = Math.round(result.riskScore * 100);

  // Per-field validation / cross-check (only meaningful when OCR ran).
  const validation = useMemo(
    () => (result.ocr.available ? validateExtraction(result.extracted, result.ocr.text, result.source, result.ocr.passes) : null),
    [result],
  );
  const vmap: Record<string, FieldCheck | undefined> = {};
  validation?.checks.forEach(c => { vmap[c.key] = c; });

  const Verdict = result.riskLevel === 'low' ? CheckCircle2 : result.riskLevel === 'critical' ? ShieldAlert : AlertTriangle;

  // Authenticity breakdown sub-scores (derived from real findings)
  const sub = breakdownScores(result);
  const fa = result.forestAnalysis;

  return (
    <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Verdict banner */}
      <div className="card" style={{ padding: 22, borderColor: `${meta.hex}55`, background: meta.soft }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ width: 50, height: 50, borderRadius: 13, background: `${meta.hex}22`, border: `1px solid ${meta.hex}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span className={`verdict-ico verdict-${result.riskLevel}`} style={{ display: 'inline-flex' }}><Verdict size={26} color={meta.hex} /></span>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>{result.legitimacyLabel}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.55 }}>{result.recommendedAction}</div>
            {result.actionPlan && result.actionPlan.length > 0 && (
              <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg-card-solid)', border: `1px solid ${meta.hex}33`, borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: meta.hex, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>What to do next</div>
                <ol style={{ margin: 0, paddingLeft: 20, listStyle: 'decimal', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {result.actionPlan.map((step, i) => <li key={i} style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{step}</li>)}
                </ol>
              </div>
            )}
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div className="mono" style={{ fontSize: 34, fontWeight: 800, color: meta.hex, lineHeight: 1 }}>{pct}%</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>Risk Score</div>
            <span className={`badge badge-${result.riskLevel}`} style={{ marginTop: 6 }}>{meta.label}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={() => generateImageReport(result)}><Download size={15} /> Download PDF report</button>
          <button className="btn-secondary" onClick={onReset}><RefreshCw size={14} /> Scan another</button>
        </div>
      </div>

      {/* Random Forest — the thesis algorithm, running on THIS scan's evidence */}
      {fa && (
        <div className="card animate-fade-up" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <Trees size={15} color="var(--accent-light)" />
            <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Random Forest analysis</h3>
            <span className={`badge ${fa.datasetSource === 'demo' ? 'badge-medium' : 'badge-accent'}`} style={{ marginLeft: 'auto' }}>
              {fa.datasetSource === 'demo' ? 'Demonstration-trained' : 'Trained on uploaded data'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            The same evidence signals shown below — OCR confidence, ELA hotspot %, reference validity, metadata — were converted into a feature vector and passed through the trained forest. Its vote is blended 50/50 with the rule-based findings to produce the risk score above.
          </div>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <Stat big value={`${Math.round(fa.probability * 100)}%`} label="forest fraud probability" />
            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-default)' }} />
            <Stat value={`${fa.votesFraud} / ${fa.totalTrees}`} label="trees voted fraudulent" />
            <Stat value={`${Math.round((result.heuristicScore ?? 0) * 100)}%`} label="rule-based findings score" />
            <Stat value={`${pct}%`} label="blended risk (½ + ½)" />
          </div>
          {fa.datasetSource === 'demo' && (
            <div style={{ marginTop: 14, padding: '9px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              This forest is currently trained on a seeded demonstration dataset (see the Detection Model page), not real collected evidence. Its vote here illustrates the mechanism end-to-end; once a real labelled evidence dataset is trained there, every future scan uses that model automatically.
            </div>
          )}
        </div>
      )}

      {result.ocr.available && result.ocr.confidence < 65 && (
        <div className="card animate-fade-up" style={{ padding: 16, borderColor: 'var(--accent-amber)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={16} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>The text was hard to read ({Math.round(result.ocr.confidence)}% OCR confidence)</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.55 }}>
                Some fields may be incomplete or wrong. This usually happens when the receipt is blurry, cropped, very small, or photographed at an angle. Try uploading the original full screenshot instead of a photo of a screen — or press <b>Correct text</b> to fix any misread field before trusting the results.
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18 }}>
        {/* Evidence preview + ELA (collapsed by default — it's for the technically curious) */}
        <div className="card" style={{ padding: 18 }}>
          <button onClick={() => setTechOpen(o => !o)} aria-expanded={techOpen}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}>
            <SectionTitle icon={Eye} title="Technical details (forensic view)" />
            <ChevronDown size={15} color="var(--text-muted)" style={{ marginLeft: 'auto', transition: 'transform 0.2s', transform: techOpen ? 'rotate(180deg)' : 'none' }} />
          </button>
          {!techOpen && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              ELA heatmap, metadata and file diagnostics{result.ocr.available && result.ocr.pass ? ` · best OCR read: ${result.ocr.pass} pass` : ''} — tap to expand.
            </div>
          )}
          {techOpen && (
            <>
              <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Original</div>
                  <img src={preview} alt="Uploaded receipt" style={{ width: '100%', borderRadius: 9, border: '1px solid var(--border-default)' }} />
                </div>
                {result.forensics.elaThumbnail && (
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Error-Level Analysis</div>
                    <img src={result.forensics.elaThumbnail} alt="Error-level analysis heatmap" style={{ width: '100%', borderRadius: 9, border: '1px solid var(--border-default)' }} />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.45 }}>
                      Brighter areas re-compress differently. Uniform = consistent; isolated bright patches can indicate edited regions.
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
                <MetricChip label="Dimensions" value={`${result.forensics.width}×${result.forensics.height}`} />
                <MetricChip label="File type" value={result.forensics.sniffType.toUpperCase()} />
                <MetricChip label="Has metadata" value={result.forensics.hasExif ? 'Yes' : 'No'} />
                <MetricChip label="ELA score" value={`${result.forensics.elaScore.toFixed(1)}`} />
              </div>
            </>
          )}
        </div>

        {/* Authenticity breakdown */}
        <div className="card" style={{ padding: 18 }}>
          <SectionTitle icon={Layers} title="Authenticity breakdown" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13, marginTop: 14 }}>
            {sub.map(s => <ScoreRow key={s.label} label={s.label} value={s.value} hint={s.hint} />)}
          </div>
        </div>
      </div>

      {/* Confidence meter */}
      <div className="card" style={{ padding: 18 }}>
        <SectionTitle icon={Gauge} title="Evidence confidence meter" />
        <div className="stagger-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 16, marginTop: 14 }}>
          <ConfidenceItem label="OCR accuracy" value={result.ocr.available ? Math.round(result.ocr.confidence) : 0} note={result.ocr.available ? `${result.ocr.wordCount} words read` : 'OCR unavailable'} />
          <ConfidenceItem label="Image quality" value={imageQualityScore(result)} note={`${result.forensics.width}×${result.forensics.height}px`} />
          <ConfidenceItem label="Text extraction" value={extractionScore(result)} note={`${countExtracted(result)}/9 fields found`} />
          <ConfidenceItem label="Overall assessment" value={Math.round(result.confidence)} note="Combined certainty" />
        </div>
      </div>

      {/* Extracted data — editable (OCR) */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 8, flexWrap: 'wrap' }}>
          <SectionTitle icon={Fingerprint} title="Extracted details (OCR)" />
          {!editing ? (
            <button className="btn-ghost" onClick={() => setEditing(true)}><Pencil size={12} /> Correct text</button>
          ) : (
            <button className="btn-primary" style={{ padding: '7px 14px', fontSize: 13 }} onClick={onReanalyze}><RefreshCw size={13} /> Re-analyze with edits</button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>OCR confidence:</span>
          <div className="score-track" style={{ flex: 1, maxWidth: 180, minWidth: 80 }}>
            <div className="score-fill" style={{ width: `${result.ocr.available ? result.ocr.confidence : 0}%`, background: result.ocr.confidence > 75 ? 'var(--accent-emerald)' : result.ocr.confidence > 50 ? 'var(--accent-amber)' : 'var(--accent-red)' }} />
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{result.ocr.available ? `${Math.round(result.ocr.confidence)}%` : 'N/A'}</span>
          <span className="badge badge-neutral" style={{ marginLeft: 'auto' }}>{result.ocr.engine}</span>
        </div>

        {editing && editData ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            {([
              ['senderName', 'Sender'], ['receiverName', 'Receiver'], ['receiverContact', 'Receiver No.'], ['amount', 'Amount'],
              ['date', 'Date'], ['time', 'Time'], ['referenceNo', 'Reference No.'],
              ['transactionId', 'Transaction ID'], ['institution', 'Institution'],
            ] as [keyof ExtractedTransactionData, string][]).map(([k, lbl]) => (
              <label key={k} style={{ display: 'block' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{lbl}</span>
                <input className="input-field" value={(editData[k] ?? '') as string}
                  inputMode={k === 'amount' ? 'decimal' : undefined}
                  onChange={e => setEditData({ ...editData, [k]: k === 'amount' ? (parseFloat(e.target.value.replace(/,/g, '')) || null) : e.target.value })} />
              </label>
            ))}
          </div>
        ) : (
          <div>
            {validation && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12, fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>Field check:</span>
                {validation.verified > 0 && <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>● {validation.verified} cross-checked</span>}
                {validation.present > 0 && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>● {validation.present} detected</span>}
                {validation.review > 0 && <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>● {validation.review} to review</span>}
                {validation.missing > 0 && <span style={{ color: 'var(--text-disabled)', fontWeight: 600 }}>● {validation.missing} not found</span>}
                {validation.review > 0 && <span style={{ color: 'var(--text-muted)' }}>— tap “Correct text” to fix flagged fields.</span>}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
              <DataField label="Sender" value={result.extracted.senderName} check={vmap.senderName} />
              <DataField label="Receiver" value={result.extracted.receiverName} check={vmap.receiverName} />
              <DataField label="Receiver No." value={result.extracted.receiverContact} mono check={vmap.receiverContact} />
              <DataField label="Amount" value={result.extracted.amount == null ? null : formatPHP(result.extracted.amount)} mono check={vmap.amount} />
              <DataField label="Date" value={result.extracted.date} check={vmap.date} />
              <DataField label="Time" value={result.extracted.time} check={vmap.time} />
              <DataField label="Reference No." value={result.extracted.referenceNo} mono check={vmap.referenceNo} />
              <DataField label="Transaction ID" value={result.extracted.transactionId} mono check={vmap.transactionId} />
              <DataField label="Institution" value={result.extracted.institution || result.source} check={vmap.institution} />
            </div>
            {result.extracted.referenceNo && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, padding: '10px 12px', background: 'var(--bg-accent-tint)', border: '1px solid var(--border-accent)', borderRadius: 9 }}>
                <Info size={15} color="var(--accent-light)" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Reading a field correctly is not the same as proving a payment is real. The one certain check is to look up this reference number inside your own official app — FraudSentry is an awareness aid, not a substitute for that confirmation.
                </div>
              </div>
            )}
          </div>
        )}
        {!result.ocr.available && (
          <div className="privacy-notice" style={{ marginTop: 14, borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.07)' }}>
            <AlertTriangle size={14} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>The OCR engine couldn't be reached (you may be offline). Tap "Correct text" to enter the details manually, then re-analyze — or retry once you're back online.</span>
          </div>
        )}
      </div>

      {/* Findings — explainable */}
      <div className="card" style={{ padding: 18 }}>
        <SectionTitle icon={ShieldAlert} title={`Why this score — ${result.findings.filter(f => !f.passed).length} contributing factor(s)`} />
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
          Percentages are each finding's weight in the <b>rule-based score</b> ({Math.round((result.heuristicScore ?? result.riskScore) * 100)}% here), which makes up half of the final risk; the Random Forest vote is the other half.
        </div>
        <div className="stagger-in" style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
          {result.findings.slice().sort((a, b) => Number(a.passed) - Number(b.passed) || b.weight - a.weight).map(f => (
            <FindingRow key={f.id} passed={f.passed} label={f.label} detail={f.detail} weight={f.weight} severity={f.severity} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── small presentational helpers ── */
function SectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon size={15} color="var(--accent-light)" />
      <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{title}</h3>
    </div>
  );
}
function Stat({ value, label, big }: { value: string; label: string; big?: boolean }) {
  return (
    <div style={{ flex: '0 0 auto' }}>
      <div className="mono" style={{ fontSize: big ? 26 : 16, fontWeight: big ? 800 : 700, color: 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
    </div>
  );
}
function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div className="mono" style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}
const STATUS_COLOR: Record<FieldStatus, string> = {
  verified: 'var(--accent-emerald)',
  present: 'var(--accent)',
  review: 'var(--accent-amber)',
  missing: 'var(--text-disabled)',
};
const CONFIDENCE_CHIP: Record<FieldConfidence, { label: string; color: string } | null> = {
  high: { label: 'High', color: 'var(--accent-emerald)' },
  medium: { label: 'Medium', color: 'var(--accent)' },
  low: { label: 'Check', color: 'var(--accent-amber)' },
  na: null,
};
function DataField({ label, value, mono, check }: { label: string; value: string | null; mono?: boolean; check?: FieldCheck }) {
  const empty = value == null || value === '';
  const dot = check ? STATUS_COLOR[check.status] : 'transparent';
  const border = check && check.status === 'review' ? 'var(--accent-amber)' : 'var(--border-default)';
  const chip = check && !empty ? CONFIDENCE_CHIP[check.confidence] : null;
  return (
    <div title={check?.note || ''} style={{ background: 'var(--bg-subtle)', border: `1px solid ${border}`, borderRadius: 8, padding: '9px 11px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        {check && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        {chip && (
          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: chip.color, background: 'var(--bg-card-solid)', border: `1px solid ${chip.color}44`, borderRadius: 5, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}
            title={check && check.agreement != null ? `Read identically in ${Math.round(check.agreement * 100)}% of image passes` : 'Confidence of this read'}>
            {chip.label}
          </span>
        )}
      </div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: 13, color: empty ? 'var(--text-disabled)' : 'var(--text-primary)', fontWeight: empty ? 400 : 600, fontStyle: empty ? 'italic' : 'normal', overflowWrap: 'anywhere' }}>
        {empty ? 'not detected' : value}
      </div>
      {check && check.status === 'review' && (
        <div style={{ fontSize: 10.5, color: 'var(--accent-amber)', marginTop: 4, lineHeight: 1.4 }}>{check.note}</div>
      )}
    </div>
  );
}
function ScoreRow({ label, value, hint }: { label: string; value: number; hint: string }) {
  const color = value >= 70 ? 'var(--accent-emerald)' : value >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
        <span className="mono" style={{ fontSize: 12.5, color, fontWeight: 700 }}>{value}%</span>
      </div>
      <div className="score-track"><div className="score-fill" style={{ width: `${value}%`, background: color }} /></div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>
    </div>
  );
}
function ConfidenceItem({ label, value, note }: { label: string; value: number; note: string }) {
  const color = value >= 70 ? 'var(--accent-emerald)' : value >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)';
  const r = 26, c = 2 * Math.PI * r, off = c - (value / 100) * c;
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ position: 'relative', width: 70, height: 70, margin: '0 auto 8px' }}>
        <svg width="70" height="70" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
          <circle cx="35" cy="35" r={r} fill="none" stroke="var(--border-default)" strokeWidth="5" />
          <circle cx="35" cy="35" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 1s ease' }} />
        </svg>
        <div className="mono" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color }}>{value}%</div>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>{note}</div>
    </div>
  );
}
function FindingRow({ passed, label, detail, weight, severity }: { passed: boolean; label: string; detail: string; weight: number; severity: string }) {
  const color = passed ? 'var(--accent-emerald)' : severity === 'critical' ? 'var(--accent-red)' : severity === 'high' ? 'var(--accent-orange)' : severity === 'medium' ? 'var(--accent-amber)' : 'var(--text-muted)';
  return (
    <div style={{ display: 'flex', gap: 11, padding: '11px 13px', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 9 }}>
      <div style={{ flexShrink: 0, marginTop: 1 }}>
        {passed ? <CheckCircle2 size={16} color={color} /> : <AlertTriangle size={16} color={color} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
          {!passed && weight > 0 && <span className="mono" title="Weight in the rule-based score" style={{ fontSize: 12, fontWeight: 700, color, whiteSpace: 'nowrap' }}>+{Math.round(weight * 100)}% rule</span>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>{detail}</div>
      </div>
    </div>
  );
}

/* ── derived sub-scores (all from real findings, no fabrication) ── */
function breakdownScores(r: ImageScanResult) {
  const byCat = (cats: string[]) => {
    const fs = r.findings.filter(f => cats.includes(f.category));
    if (!fs.length) return 100;
    const failedWeight = fs.filter(f => !f.passed).reduce((s, f) => s + f.weight, 0);
    return Math.max(0, Math.round(100 - failedWeight * 100));
  };
  return [
    { label: 'Layout & template', value: byCat(['layout']), hint: 'Receipt structure — e.g. a pre-send confirmation screen is not a receipt' },
    { label: 'Image integrity', value: byCat(['forensic', 'integrity']), hint: 'Compression, error-level & editing signals' },
    { label: 'Metadata consistency', value: byCat(['metadata']), hint: 'Embedded file metadata & editor traces' },
    { label: 'Reference & timestamp', value: byCat(['reference', 'timestamp']), hint: 'Format of reference numbers & dates' },
  ];
}
function imageQualityScore(r: ImageScanResult): number {
  const px = r.forensics.width * r.forensics.height;
  if (px >= 1_000_000) return 92;
  if (px >= 500_000) return 78;
  if (px >= 200_000) return 60;
  if (px >= 80_000) return 42;
  return 28;
}
function countExtracted(r: ImageScanResult): number {
  const e = r.extracted;
  return [e.senderName, e.receiverName, e.receiverContact, e.amount, e.date, e.time, e.referenceNo, e.transactionId, e.institution].filter(v => v != null && v !== '').length;
}
function extractionScore(r: ImageScanResult): number {
  return Math.round((countExtracted(r) / 9) * 100);
}
