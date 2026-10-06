import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  ScanLine, UploadCloud, FileImage, X, RefreshCw, Download, AlertTriangle, CheckCircle2, ShieldAlert,
  Pencil, Camera, ClipboardPaste, ChevronDown, Info, WifiOff, Copy, ShieldCheck, Smartphone, Clock,
  Eye, ScanText, Sparkles, Square,
} from 'lucide-react';
import { analyzeTransactionImage } from '../engine/imageVerification';
import { OcrCancelled } from '../services/ocr';
import type { OcrProgress } from '../services/ocr';
import { generateImageReport } from '../services/reportGenerator';
import { validateExtraction, FieldCheck, FieldStatus, FieldConfidence } from '../services/fieldValidation';
import { validateImageFile, ACCEPTED_IMAGE_TYPES } from '../services/uploadValidation';
import { locateFields, FieldBox } from '../services/fieldLocator';
import { useAppStore } from '../store/useAppStore';
import { ImageScanResult, ExtractedTransactionData, OcrResult, OcrWord, RiskLevel, VerificationFinding } from '../types';
import { formatBytes, formatPHP, formatRelativeTime } from '../utils/helpers';

// Plain-language verdicts. The technical label (legitimacyLabel) still goes in the PDF report.
export const VERDICT: Record<RiskLevel, { title: string; level: string; Icon: typeof CheckCircle2 }> = {
  low:      { title: 'No signs of editing found', level: 'Low risk', Icon: CheckCircle2 },
  medium:   { title: "Some details don't add up", level: 'Medium risk', Icon: AlertTriangle },
  high:     { title: 'Suspicious — verify before trusting', level: 'High risk', Icon: AlertTriangle },
  critical: { title: 'Likely fake — do not accept', level: 'Critical risk', Icon: ShieldAlert },
};
const LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

type Phase = 'idle' | 'selected' | 'scanning' | 'complete';
type Step = 'image' | 'engine' | 'read' | 'score';
interface Live { step: Step; pass?: 1 | 2 | 3; progress?: number; words?: OcrWord[]; imageSize?: { w: number; h: number }; startedAt: number }

export default function ScannerPage() {
  const addImageScan = useAppStore(s => s.addImageScan);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [live, setLive] = useState<Live | null>(null);
  const [result, setResult] = useState<ImageScanResult | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<ImageScanResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<ExtractedTransactionData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    abortRef.current?.abort();
    setFile(null); setPreview(''); setPhase('idle'); setResult(null); setDuplicateOf(null);
    setError(''); setNotice(''); setEditing(false); setEditData(null); setLive(null);
  };

  const handleFile = useCallback(async (f: File) => {
    const err = await validateImageFile(f);
    if (err) { setError(err); return; }
    setError(''); setNotice(''); setResult(null); setEditing(false);
    setFile(f);
    setPhase('selected');
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  }, []);

  // Paste a screenshot straight from the clipboard (Ctrl/Cmd+V).
  const busy = phase === 'scanning';
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (busy) return;
      for (const item of Array.from(e.clipboardData?.items || [])) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) { e.preventDefault(); handleFile(f); return; }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFile, busy]);

  const pasteFromClipboard = async () => {
    try {
      const items = await (navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> }).read?.();
      for (const it of items || []) {
        const type = it.types.find(t => t.startsWith('image/'));
        if (type) { const blob = await it.getType(type); handleFile(new File([blob], `pasted.${type.split('/')[1]}`, { type })); return; }
      }
      setError('No image found on the clipboard. Copy a screenshot first, or press Ctrl+V.');
    } catch {
      setError('Your browser blocked clipboard access. Press Ctrl+V (or long-press → Paste) instead.');
    }
  };

  const runScan = async (f: File, opts?: { ocrOverride?: OcrResult; extractedOverride?: ExtractedTransactionData }) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase('scanning'); setError(''); setNotice('');
    setLive({ step: 'image', startedAt: performance.now() });
    try {
      const history = useAppStore.getState().imageScans
        .map(s => ({ id: s.id, filename: s.filename, scannedAt: s.scannedAt, extracted: s.extracted }));
      const scan = await analyzeTransactionImage(f, {
        previewDataUrl: preview,
        ocrOverride: opts?.ocrOverride,
        extractedOverride: opts?.extractedOverride,
        history: opts?.extractedOverride ? [] : history,
        signal: ctrl.signal,
        onStage: (s: string) => {
          if (/scor|evidence/i.test(s)) setLive(l => l && { ...l, step: 'score' });
          else if (/forensic/i.test(s)) setLive(l => l && { ...l, step: 'image' });
        },
        onOcrProgress: (p: OcrProgress) => setLive(l => {
          if (!l) return l;
          if (p.phase === 'engine') return { ...l, step: 'engine' };
          if (p.phase === 'read') return { ...l, step: 'read', pass: p.pass, progress: p.progress, words: p.words ?? l.words, imageSize: p.imageSize ?? l.imageSize };
          return l;
        }),
      });
      if (ctrl.signal.aborted) return;
      const ref = scan.extracted.referenceNo;
      const prior = ref && ref.replace(/\s/g, '').length >= 6 && !opts?.extractedOverride
        ? useAppStore.getState().imageScans.find(s => s.extracted.referenceNo && s.extracted.referenceNo.replace(/\s/g, '') === ref.replace(/\s/g, ''))
        : null;
      setDuplicateOf(prior || null);
      setResult(scan);
      setEditData(scan.extracted);
      addImageScan(scan);
      setPhase('complete');
    } catch (e: unknown) {
      if (e instanceof OcrCancelled || ctrl.signal.aborted) {
        setPhase('selected'); setNotice('Scan cancelled. Nothing was saved.');
      } else {
        setPhase('selected');
        setError((e instanceof Error && e.message) || "We couldn't read this receipt. Try a clearer, uncropped screenshot.");
      }
    } finally {
      setLive(null);
    }
  };

  const cancelScan = () => abortRef.current?.abort();
  const reanalyzeWithEdits = async () => {
    if (!file || !result || !editData) return;
    setEditing(false);
    await runScan(file, { ocrOverride: result.ocr, extractedOverride: editData });
  };

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      {phase !== 'complete' && (
        <div className="page-head">
          <div className="page-head-ico"><ScanLine size={22} /></div>
          <div>
            <h1>Check a receipt</h1>
            <p>Upload a payment screenshot. We read it, look for signs of editing, and explain what we found. Only your own bank or e-wallet app can confirm money actually arrived.</p>
          </div>
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {phase === 'scanning' && live ? stepAnnouncement(live) : phase === 'complete' && result ? `Result: ${VERDICT[result.riskLevel].title}. ${VERDICT[result.riskLevel].level}.` : ''}
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" className="btn-ghost" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      {notice && !error && (
        <div className="alert alert-info" role="status">
          <Info size={18} aria-hidden="true" /><span>{notice}</span>
          <button type="button" className="btn-ghost" onClick={() => setNotice('')}>OK</button>
        </div>
      )}

      {phase === 'idle' && (
        <div
          className={`dropzone${dragOver ? ' over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
        >
          <div className="dropzone-art" aria-hidden="true">
            <div className="phone-outline"><span className="phone-line w1" /><span className="phone-line w2" /><span className="phone-line w3" /><span className="phone-line w4" /><span className="dz-scan" /></div>
          </div>
          <h2 className="dz-title">Drop a payment screenshot here</h2>
          <p className="dz-sub">GCash · Maya · GoTyme · MariBank · BPI · BDO · other PH banks</p>
          <div className="dz-actions">
            <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()}><FileImage size={18} /> Choose screenshot</button>
            <button type="button" className="btn-secondary" onClick={() => cameraRef.current?.click()}><Camera size={17} /> Take photo</button>
            <button type="button" className="btn-secondary" onClick={pasteFromClipboard}><ClipboardPaste size={17} /> Paste</button>
          </div>
          <p className="dz-foot">PNG, JPG or WEBP · up to 10 MB · read entirely in this browser — nothing is uploaded</p>
          <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden aria-label="Choose a receipt screenshot"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden aria-label="Take a photo of a receipt"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        </div>
      )}

      {phase === 'selected' && file && (
        <div className="card selected-card pop-in">
          {preview ? <img src={preview} alt="Selected receipt" className="selected-thumb" /> : <div className="selected-thumb skeleton" />}
          <div className="selected-info">
            <div className="selected-name">{file.name}</div>
            <div className="muted">{formatBytes(file.size)} · {(file.type.replace('image/', '') || 'image').toUpperCase()}</div>
            <ul className="selected-checks">
              <li><Eye size={15} aria-hidden="true" /> Check the image for signs of editing</li>
              <li><ScanText size={15} aria-hidden="true" /> Read the amount, reference, date and recipient</li>
              <li><Sparkles size={15} aria-hidden="true" /> Score the evidence and explain why</li>
            </ul>
          </div>
          <div className="selected-actions">
            <button type="button" className="btn-primary btn-lg" onClick={() => runScan(file)}><ScanLine size={19} /> Verify authenticity</button>
            <button type="button" className="btn-ghost" onClick={reset}><X size={15} /> Choose another</button>
          </div>
        </div>
      )}

      {phase === 'scanning' && live && <ScanLive live={live} preview={preview} onCancel={cancelScan} />}

      {phase === 'complete' && result && (
        <>
          {!result.ocr.available && (
            <div className="alert alert-warn">
              <WifiOff size={18} aria-hidden="true" />
              <span><b>The text reader didn't load.</b> It downloads once from the internet on first use and couldn't be reached. The image checks below still ran, but no text was read. Check your connection and retry.</span>
              <button type="button" className="btn-primary" onClick={() => file && runScan(file)}><RefreshCw size={15} /> Retry scan</button>
            </div>
          )}
          {duplicateOf && (
            <div className="alert alert-warn">
              <Copy size={18} aria-hidden="true" />
              <span><b>Seen before.</b> Reference <span className="mono">{result.extracted.referenceNo}</span> was already checked {formatRelativeTime(duplicateOf.scannedAt)}. If you didn't scan the same receipt twice, be careful: sending one real screenshot to several sellers is a common scam.</span>
            </div>
          )}
          <ResultView
            result={result} preview={preview} editing={editing} editData={editData}
            setEditing={setEditing} setEditData={setEditData} onReanalyze={reanalyzeWithEdits} onReset={reset}
          />
        </>
      )}
    </div>
  );
}

function stepAnnouncement(l: Live): string {
  if (l.step === 'image') return 'Checking the image for signs of editing';
  if (l.step === 'engine') return 'Starting the text reader';
  if (l.step === 'read') return `Reading the text, pass ${l.pass ?? 1} of 3`;
  return 'Scoring the evidence';
}

/* ── live scan view (every number here is a real event from the pipeline) ── */
const PASS_NAMES = ['Original', 'Sharpened', 'High-contrast'];
function ScanLive({ live, preview, onCancel }: { live: Live; preview: string; onCancel: () => void }) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => { const t = setInterval(() => setNow(performance.now()), 250); return () => clearInterval(t); }, []);
  const secs = Math.max(0, (now - live.startedAt) / 1000);
  const order: Step[] = ['image', 'engine', 'read', 'score'];
  const at = order.indexOf(live.step);
  const steps: { key: Step; label: string; sub: string }[] = [
    { key: 'image', label: 'Checking the image', sub: 'Compression, metadata and edit traces' },
    { key: 'engine', label: 'Starting the text reader', sub: 'First use downloads the OCR engine once' },
    { key: 'read', label: 'Reading the text', sub: 'Three passes, each from a differently prepared image' },
    { key: 'score', label: 'Scoring the evidence', sub: 'Rule-based findings + Random Forest vote' },
  ];
  const words = live.words || [];
  const size = live.imageSize;
  return (
    <div className="card scan-live pop-in">
      <div className="scan-stage">
        <div className="scan-window">
          <div className="scan-inner">
          {preview && <img src={preview} alt="Receipt being scanned" />}
          {size && words.slice(0, 220).map((w, i) => (
            <span key={i} className="word-box" style={{
              left: `${(w.x0 / size.w) * 100}%`, top: `${(w.y0 / size.h) * 100}%`,
              width: `${((w.x1 - w.x0) / size.w) * 100}%`, height: `${((w.y1 - w.y0) / size.h) * 100}%`,
              animationDelay: `${Math.min(i * 12, 1400)}ms`,
            }} />
          ))}
          </div>
          <span className="scan-beam" aria-hidden="true" />
          <span className="scan-corner tl" /><span className="scan-corner tr" /><span className="scan-corner bl" /><span className="scan-corner br" />
        </div>
        {words.length > 0 && <div className="scan-count"><b className="mono">{words.length}</b> words found on pass 1</div>}
      </div>
      <div className="scan-steps">
        <div className="scan-steps-head">
          <h2 className="section-title"><span className="spinner" aria-hidden="true" /> Checking your receipt</h2>
          <span className="mono muted" aria-label={`${Math.floor(secs)} seconds elapsed`}><Clock size={14} aria-hidden="true" /> {secs.toFixed(0)}s</span>
        </div>
        <ol className="steps">
          {steps.map((s, i) => {
            const state = i < at ? 'done' : i === at ? 'active' : 'todo';
            return (
              <li key={s.key} className={`step ${state}`}>
                <span className="step-dot" aria-hidden="true">{state === 'done' ? <CheckCircle2 size={16} /> : i + 1}</span>
                <div className="step-body">
                  <div className="step-label">{s.label}{state === 'done' && <span className="sr-only"> (done)</span>}</div>
                  <div className="step-sub">{s.sub}</div>
                  {s.key === 'read' && state !== 'todo' && (
                    <div className="passes">
                      {[1, 2, 3].map(n => {
                        const cur = live.pass ?? 0;
                        const pct = state === 'done' || n < cur ? 100 : n === cur ? Math.round((live.progress ?? 0) * 100) : 0;
                        return (
                          <div key={n} className="pass-row">
                            <span className="pass-name">{PASS_NAMES[n - 1]}</span>
                            <span className="pass-track" role="progressbar" aria-label={`${PASS_NAMES[n - 1]} pass`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                              <span className="pass-fill" style={{ width: `${pct}%` }} />
                            </span>
                            <span className="pass-pct mono">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn-secondary" onClick={onCancel}><Square size={14} /> Cancel</button>
      </div>
    </div>
  );
}

/* ── result ── */
function firstSentence(s: string): string {
  const m = s.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim();
}
function topFailures(r: ImageScanResult): VerificationFinding[] {
  const rank: Record<RiskLevel, number> = { critical: 3, high: 2, medium: 1, low: 0 };
  return r.findings.filter(f => !f.passed).sort((a, b) => rank[b.severity] - rank[a.severity] || b.weight - a.weight);
}
function oneLineReason(r: ImageScanResult): string {
  const top = topFailures(r)[0];
  if (!top) return 'We read the receipt and none of our checks found a sign of editing or a missing detail.';
  if (r.riskLevel === 'low') return `None of the checks found a serious problem. Minor note: ${top.label.toLowerCase()}.`;
  return `${top.label}: ${firstSentence(top.detail)}`;
}

function ResultView(props: {
  result: ImageScanResult; preview: string; editing: boolean; editData: ExtractedTransactionData | null;
  setEditing: (v: boolean) => void; setEditData: (d: ExtractedTransactionData) => void;
  onReanalyze: () => void; onReset: () => void;
}) {
  const { result, preview, editing, editData, setEditing, setEditData, onReanalyze, onReset } = props;
  const [howOpen, setHowOpen] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  const v = VERDICT[result.riskLevel];
  const app = result.source === 'Unknown' ? 'bank or e-wallet' : result.source;
  const failures = topFailures(result);
  const validation = useMemo(
    () => (result.ocr.available ? validateExtraction(result.extracted, result.ocr.text, result.source, result.ocr.passes) : null),
    [result],
  );
  const vmap: Record<string, FieldCheck | undefined> = {};
  validation?.checks.forEach(c => { vmap[c.key] = c; });
  const boxes = useMemo(() => locateFields(result.ocr.words, result.extracted), [result]);
  const size = result.ocr.imageSize;

  return (
    <div className="result">
      {/* 1 · verdict */}
      <section className={`verdict vd-${result.riskLevel}`} aria-labelledby="verdict-title">
        <div className="verdict-top">
          <span className={`verdict-badge verdict-ico verdict-${result.riskLevel}`} aria-hidden="true"><v.Icon size={30} /></span>
          <div className="verdict-text">
            <div className="verdict-level">{v.level}</div>
            <h1 id="verdict-title" className="verdict-title">{v.title}</h1>
            <p className="verdict-reason">{oneLineReason(result)}</p>
          </div>
        </div>
        <div className="level-meter" aria-hidden="true">
          {LEVELS.map(l => (
            <div key={l} className={`lm-seg lm-${l}${l === result.riskLevel ? ' on' : ''}`}><span>{VERDICT[l].level.replace(' risk', '')}</span></div>
          ))}
        </div>
        <div className="verify-banner">
          <Smartphone size={20} aria-hidden="true" />
          <div>
            <b>{result.riskLevel === 'low' ? 'This is not a payment confirmation.' : 'Do not release anything yet.'}</b>{' '}
            Open your own {app} app and check that {result.extracted.amount != null ? <b className="mono">{formatPHP(result.extracted.amount)}</b> : 'the money'} actually arrived{result.extracted.referenceNo ? <> (reference <span className="mono">{result.extracted.referenceNo}</span>)</> : null}. A screenshot alone can never prove that.
          </div>
        </div>
        <div className="verdict-actions">
          <button type="button" className="btn-primary" onClick={() => generateImageReport(result)}><Download size={16} /> Download report</button>
          <button type="button" className="btn-secondary" onClick={onReset}><RefreshCw size={15} /> Check another</button>
        </div>
      </section>

      {/* 2 · what we read */}
      <div className="facts">
        <Fact label="Amount" value={result.extracted.amount == null ? null : formatPHP(result.extracted.amount)} mono />
        <Fact label="Reference" value={result.extracted.referenceNo} mono />
        <Fact label="App" value={result.source === 'Unknown' ? null : result.source} />
        <Fact label="Date" value={[result.extracted.date, result.extracted.time].filter(Boolean).join(' · ') || null} />
      </div>

      {result.ocr.available && result.ocr.confidence < 65 && (
        <div className="alert alert-warn">
          <AlertTriangle size={18} aria-hidden="true" />
          <span><b>The text was hard to read ({Math.round(result.ocr.confidence)}% OCR confidence).</b> Some details may be wrong. For a better read: use the original screenshot (not a photo of a screen), don't crop it, and avoid forwarded low-quality copies. Or tap <b>Correct text</b> below.</span>
        </div>
      )}

      {/* 3 · findings + receipt */}
      <div className="result-grid">
        <section className="card pad">
          <h2 className="section-title"><ShieldAlert size={18} /> {!failures.length ? 'What we checked' : result.riskLevel === 'low' ? `Minor note${failures.length > 1 ? 's' : ''}` : `Top ${Math.min(3, failures.length)} reason${failures.length > 1 ? 's' : ''}`}</h2>
          <ul className="findings">
            {(failures.length ? failures.slice(0, 3) : result.findings.filter(f => f.passed).slice(0, 3)).map(f => (
              <li key={f.id} className={`finding sev-${f.passed ? 'ok' : f.severity}`}>
                <span className="finding-ico" aria-hidden="true">{f.passed ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</span>
                <div>
                  <div className="finding-head"><span className="finding-label">{f.label}</span><span className={`sev-chip sev-${f.passed ? 'ok' : f.severity}`}>{f.passed ? 'Passed' : f.severity}</span></div>
                  <p className="finding-detail">{f.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          {failures.length > 3 && <p className="muted small">+{failures.length - 3} more in “How this was decided”.</p>}
          {result.actionPlan && result.actionPlan.length > 0 && (
            <>
              <h2 className="section-title" style={{ marginTop: 20 }}><CheckCircle2 size={18} /> What to do next</h2>
              <ol className="next-steps">{result.actionPlan.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </>
          )}
        </section>

        <section className="card pad">
          <div className="row-between">
            <h2 className="section-title"><Eye size={18} /> Where we read it</h2>
            {boxes.length > 0 && (
              <label className="toggle"><input type="checkbox" checked={showBoxes} onChange={e => setShowBoxes(e.target.checked)} /> Highlights</label>
            )}
          </div>
          <div className="evidence-img">
            {preview ? <img src={preview} alt="The receipt you checked" /> : <div className="skeleton" style={{ height: 320 }} />}
            {showBoxes && size && boxes.map((b: FieldBox) => (
              <span key={b.key} className={`field-box fb-${b.key}`} style={{
                left: `${(b.x0 / size.w) * 100}%`, top: `${(b.y0 / size.h) * 100}%`,
                width: `${((b.x1 - b.x0) / size.w) * 100}%`, height: `${((b.y1 - b.y0) / size.h) * 100}%`,
              }}><span className="fb-tag">{b.label}</span></span>
            ))}
          </div>
          <p className="muted small">{boxes.length ? 'Outlined: where each detail was read on your screenshot.' : 'Details were read, but their exact position on the image could not be pinned down.'}</p>
        </section>
      </div>

      {/* 4 · all extracted details (editable) */}
      <section className="card pad">
        <div className="row-between">
          <h2 className="section-title"><ScanText size={18} /> Details we read</h2>
          {!editing
            ? <button type="button" className="btn-ghost" onClick={() => setEditing(true)}><Pencil size={14} /> Correct text</button>
            : <button type="button" className="btn-primary" onClick={onReanalyze}><RefreshCw size={15} /> Re-check with my corrections</button>}
        </div>
        {validation && !editing && (
          <div className="field-legend">
            {validation.verified > 0 && <span className="lg lg-ok">● {validation.verified} cross-checked</span>}
            {validation.present > 0 && <span className="lg lg-present">● {validation.present} read</span>}
            {validation.review > 0 && <span className="lg lg-review">● {validation.review} to review</span>}
            {validation.missing > 0 && <span className="lg lg-missing">● {validation.missing} not found</span>}
          </div>
        )}
        {editing && editData ? (
          <div className="fields">
            {([
              ['senderName', 'Sender'], ['receiverName', 'Receiver'], ['receiverContact', 'Receiver number'], ['amount', 'Amount'],
              ['date', 'Date'], ['time', 'Time'], ['referenceNo', 'Reference no.'], ['transactionId', 'Transaction ID'], ['institution', 'App / bank'],
            ] as [keyof ExtractedTransactionData, string][]).map(([k, lbl]) => (
              <label key={k} className="edit-field">
                <span>{lbl}</span>
                <input className="input-field" value={(editData[k] ?? '') as string} inputMode={k === 'amount' ? 'decimal' : undefined}
                  onChange={e => setEditData({ ...editData, [k]: k === 'amount' ? (parseFloat(e.target.value.replace(/,/g, '')) || null) : e.target.value })} />
              </label>
            ))}
          </div>
        ) : (
          <div className="fields">
            <DataField label="Sender" value={result.extracted.senderName} check={vmap.senderName} />
            <DataField label="Receiver" value={result.extracted.receiverName} check={vmap.receiverName} />
            <DataField label="Receiver number" value={result.extracted.receiverContact} mono check={vmap.receiverContact} />
            <DataField label="Amount" value={result.extracted.amount == null ? null : formatPHP(result.extracted.amount)} mono check={vmap.amount} />
            <DataField label="Date" value={result.extracted.date} check={vmap.date} />
            <DataField label="Time" value={result.extracted.time} check={vmap.time} />
            <DataField label="Reference no." value={result.extracted.referenceNo} mono check={vmap.referenceNo} />
            <DataField label="Transaction ID" value={result.extracted.transactionId} mono check={vmap.transactionId} />
            <DataField label="App / bank" value={result.extracted.institution || result.source} check={vmap.institution} />
          </div>
        )}
        {!result.ocr.available && (
          <p className="muted small" style={{ marginTop: 12 }}>The text reader couldn't run. Tap “Correct text” to type the details yourself, then re-check.</p>
        )}
      </section>

      {/* 5 · how this was decided (technical, collapsed) */}
      <section className="card pad">
        <button type="button" className="expander" aria-expanded={howOpen} aria-controls="how-panel" onClick={() => setHowOpen(o => !o)}>
          <span className="section-title"><Info size={18} /> How this was decided</span>
          <span className="muted small hide-sm">Scores, Random Forest vote, image forensics</span>
          <ChevronDown size={18} className="chev" style={{ transform: howOpen ? 'rotate(180deg)' : 'none' }} />
        </button>
        {howOpen && <HowDecided result={result} preview={preview} />}
      </section>
    </div>
  );
}

function HowDecided({ result, preview }: { result: ImageScanResult; preview: string }) {
  const fa = result.forestAnalysis;
  const pct = (x: number | undefined) => `${Math.round((x ?? 0) * 100)}%`;
  return (
    <div id="how-panel" className="how fade-in">
      <p className="how-intro">
        Two scorers look at the same evidence and are averaged 50/50. The <b>rule-based score</b> adds up the weight of each check that failed.
        The <b>Random Forest</b> turns the evidence into 10 numbers and lets {fa?.totalTrees ?? 'its'} decision trees vote.
      </p>
      <div className="score-trio">
        <div className="trio"><div className="trio-v mono">{pct(result.heuristicScore)}</div><div className="trio-l">Rule-based score</div></div>
        <div className="trio-op" aria-hidden="true">+</div>
        <div className="trio"><div className="trio-v mono">{fa ? pct(fa.probability) : '—'}</div><div className="trio-l">Random Forest{fa ? ` (${fa.votesFraud}/${fa.totalTrees} trees)` : ''}</div></div>
        <div className="trio-op" aria-hidden="true">=</div>
        <div className="trio strong"><div className="trio-v mono">{pct(result.riskScore)}</div><div className="trio-l">Final risk (½ + ½)</div></div>
      </div>
      {fa?.datasetSource === 'demo' && (
        <p className="note">The forest is currently trained on a seeded <b>demonstration</b> dataset, not on real collected evidence. It shows how the method works; its vote is not a measured accuracy.</p>
      )}

      <h3 className="how-h">Every check ({result.findings.length})</h3>
      <ul className="findings compact">
        {result.findings.slice().sort((a, b) => Number(a.passed) - Number(b.passed) || b.weight - a.weight).map(f => (
          <li key={f.id} className={`finding sev-${f.passed ? 'ok' : f.severity}`}>
            <span className="finding-ico" aria-hidden="true">{f.passed ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</span>
            <div>
              <div className="finding-head">
                <span className="finding-label">{f.label}</span>
                {!f.passed && f.weight > 0 && <span className="mono weight" title="Weight in the rule-based score">+{Math.round(f.weight * 100)}%</span>}
              </div>
              <p className="finding-detail">{f.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="how-h">Image forensics</h3>
      <div className="forensic-row">
        <figure><img src={preview} alt="Original" /><figcaption>Original</figcaption></figure>
        {result.forensics.elaThumbnail && (
          <figure><img src={result.forensics.elaThumbnail} alt="Error-level analysis heatmap" /><figcaption>Error-level analysis: bright patches re-compress differently. On screenshots this is a weak signal — treat it as a hint, not proof.</figcaption></figure>
        )}
      </div>
      <div className="metrics">
        <Metric label="Size" value={`${result.forensics.width}×${result.forensics.height}`} />
        <Metric label="File type" value={result.forensics.sniffType.replace('image/', '').toUpperCase()} />
        <Metric label="Metadata" value={result.forensics.hasExif ? 'Present' : 'None'} />
        <Metric label="ELA hotspots" value={`${result.forensics.elaHotspotPct}%`} />
        <Metric label="OCR engine" value={result.ocr.engine} />
        <Metric label="OCR time" value={`${(result.ocr.durationMs / 1000).toFixed(1)} s`} />
        {result.ocr.passConfidences?.map((c, i) => <Metric key={i} label={`Pass ${i + 1} confidence`} value={`${c}%`} />)}
      </div>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="fact">
      <div className="fact-l">{label}</div>
      <div className={`fact-v${mono ? ' mono' : ''}${value ? '' : ' empty'}`}>{value || 'Not found'}</div>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><div className="metric-l">{label}</div><div className="metric-v mono">{value}</div></div>;
}
const STATUS_CLASS: Record<FieldStatus, string> = { verified: 'ok', present: 'present', review: 'review', missing: 'missing' };
const CONFIDENCE_CHIP: Record<FieldConfidence, string | null> = { high: 'High', medium: 'Medium', low: 'Check', na: null };
function DataField({ label, value, mono, check }: { label: string; value: string | null; mono?: boolean; check?: FieldCheck }) {
  const empty = value == null || value === '';
  const chip = check && !empty ? CONFIDENCE_CHIP[check.confidence] : null;
  return (
    <div className={`data-field st-${check ? STATUS_CLASS[check.status] : 'none'}`} title={check?.note || ''}>
      <div className="df-head">
        {check && <span className="df-dot" aria-hidden="true" />}
        <span className="df-label">{label}</span>
        {chip && <span className={`df-chip conf-${check!.confidence}`} title={check && check.agreement != null ? `Read identically in ${Math.round(check.agreement * 100)}% of image passes` : 'Confidence of this read'}>{chip}</span>}
      </div>
      <div className={`df-value${mono ? ' mono' : ''}${empty ? ' empty' : ''}`}>{empty ? 'not detected' : value}</div>
      {check && check.status === 'review' && <div className="df-note">{check.note}</div>}
    </div>
  );
}
