import { useState, useRef, useMemo } from 'react';
import {
  MessageSquareWarning, Type, ImagePlus, Loader2, Download, RefreshCw,
  AlertTriangle, CheckCircle2, ShieldAlert, Link2, ListChecks, Highlighter, X, Info,
} from 'lucide-react';
import { analyzeMessageText } from '../engine/messageAnalysis';
import { runOcr } from '../services/ocr';
import { generateMessageReport } from '../services/reportGenerator';
import { useAppStore } from '../store/useAppStore';
import { MessageScanResult, MessagePlatform, MessageFlag } from '../types';
import { RISK_META } from '../utils/helpers';
import { validateImageFile, ACCEPTED_IMAGE_TYPES } from '../services/uploadValidation';

const PLATFORMS: MessagePlatform[] = ['Unknown', 'SMS', 'Messenger', 'Facebook', 'WhatsApp', 'Telegram', 'Viber', 'Discord', 'Email'];

export default function MessageAnalyzerPage() {
  const addMessageScan = useAppStore(s => s.addMessageScan);
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [platform, setPlatform] = useState<MessagePlatform>('Unknown');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [result, setResult] = useState<MessageScanResult | null>(null);
  const [preview, setPreview] = useState('');
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const analyze = (raw: string, ocrConf: number | null) => {
    if (!raw.trim()) { setError('There is no text to analyze yet.'); return; }
    const res = analyzeMessageText(raw, platform, ocrConf);
    setResult(res);
    addMessageScan(res);
  };

  const handleImage = async (f: File) => {
    const invalid = await validateImageFile(f);
    if (invalid) { setError(invalid); return; }
    setError(''); setResult(null); setBusy(true); setStage('Loading OCR engine');
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
    try {
      const ocr = await runOcr(f, s => setStage(s));
      setBusy(false);
      if (!ocr.available) {
        setError('OCR could not run (you may be offline). Switch to "Paste text" and type the message in manually.');
        setText(''); setOcrConfidence(null);
        return;
      }
      setText(ocr.text);
      setOcrConfidence(ocr.confidence);
      analyze(ocr.text, ocr.confidence);
    } catch (e: unknown) {
      setBusy(false);
      setError((e instanceof Error && e.message) || 'OCR failed. Try pasting the text instead.');
    }
  };

  const reset = () => { setText(''); setResult(null); setPreview(''); setOcrConfidence(null); setError(''); };

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--bg-accent-tint)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MessageSquareWarning size={19} color="var(--accent-light)" />
          </div>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: 'var(--text-primary)' }}>Fraud Message Analyzer</h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
              Paste a suspicious message or upload a screenshot. We highlight the exact phrases that look like a scam and explain why.
            </p>
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`filter-btn ${mode === 'text' ? 'active' : ''}`} onClick={() => setMode('text')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px' }}><Type size={13} /> Paste text</button>
        <button className={`filter-btn ${mode === 'image' ? 'active' : ''}`} onClick={() => setMode('image')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px' }}><ImagePlus size={13} /> Upload screenshot</button>
      </div>

      {error && (
        <div className="card" style={{ padding: '13px 16px', display: 'flex', gap: 10, alignItems: 'center', borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.06)', marginBottom: 16 }}>
          <AlertTriangle size={16} color="var(--accent-amber)" />
          <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{error}</span>
          <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      {/* Input */}
      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Source platform:</span>
          <select value={platform} onChange={e => setPlatform(e.target.value as MessagePlatform)} className="input-field" style={{ width: 'auto', padding: '6px 10px', fontSize: 12 }}>
            {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {ocrConfidence != null && <span className="badge badge-accent" style={{ marginLeft: 'auto' }}>OCR {Math.round(ocrConfidence)}%</span>}
        </div>

        {mode === 'text' ? (
          <textarea className="input-field" rows={6} placeholder="Paste the SMS, chat, or email text here…"
            value={text} onChange={e => setText(e.target.value)} style={{ resize: 'vertical', lineHeight: 1.6 }} />
        ) : (
          <div>
            {!preview ? (
              <div onClick={() => inputRef.current?.click()} style={{ borderRadius: 12, padding: '36px 20px', textAlign: 'center', border: '2px dashed var(--border-strong)', background: 'var(--bg-subtle)', cursor: 'pointer' }}
                onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleImage(f); }}>
                <ImagePlus size={26} color="var(--accent-light)" style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-primary)' }}>Drop a chat / SMS screenshot</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>We'll read the text automatically with OCR</div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <img src={preview} alt="screenshot" style={{ width: 130, borderRadius: 10, border: '1px solid var(--border-default)' }} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Extracted text (editable):</div>
                  <textarea className="input-field" rows={5} value={text} onChange={e => setText(e.target.value)} style={{ resize: 'vertical', lineHeight: 1.55 }} />
                </div>
              </div>
            )}
            <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden onChange={e => { const f = e.target.files?.[0]; if (f) handleImage(f); e.target.value = ''; }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn-primary" disabled={busy} onClick={() => analyze(text, ocrConfidence)}>
            {busy ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> {stage}…</> : <><ShieldAlert size={15} /> Analyze message</>}
          </button>
          {(result || text) && <button className="btn-secondary" onClick={reset}><RefreshCw size={14} /> Clear</button>}
        </div>
      </div>

      {result && <MessageResult result={result} />}
    </div>
  );
}

function MessageResult({ result }: { result: MessageScanResult }) {
  const meta = RISK_META[result.threatLevel];
  const pct = Math.round(result.riskScore * 100);
  const Verdict = result.threatLevel === 'low' ? CheckCircle2 : result.threatLevel === 'critical' ? ShieldAlert : AlertTriangle;
  const badgeClass = result.threatLevel === 'critical' ? 'critical' : result.threatLevel === 'high' ? 'high' : result.threatLevel === 'medium' ? 'medium' : 'low';

  return (
    <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Verdict */}
      <div className="card" style={{ padding: 20, borderColor: `${meta.hex}55`, background: meta.soft }}>
        <div style={{ display: 'flex', gap: 15, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: `${meta.hex}22`, border: `1px solid ${meta.hex}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Verdict size={24} color={meta.hex} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{result.scamType}</span>
              <span className={`badge badge-${badgeClass}`}>{meta.label}</span>
              <span className="badge badge-neutral">{result.platform}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.55 }}>{result.explanation}</div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div className="mono" style={{ fontSize: 30, fontWeight: 800, color: meta.hex, lineHeight: 1 }}>{pct}%</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 3 }}>Risk</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={() => generateMessageReport(result)}><Download size={15} /> Download PDF report</button>
        </div>
      </div>

      {/* Conversation risk mapping (Feature 2) */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Highlighter size={15} color="var(--accent-light)" />
          <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Conversation risk mapping</h3>
        </div>
        <HighlightedText text={result.sourceText} flags={result.flags} />
        {result.flags.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, fontStyle: 'italic' }}>No high-risk phrases were detected in this text.</div>
        )}
        {(result.observations?.length ?? 0) > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.3 }}>What to keep in mind</div>
            {result.observations.map((o, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8 }}>
                <Info size={15} color="var(--accent-light)" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{o}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
        {/* Contributing factors */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <ListChecks size={15} color="var(--accent-light)" />
            <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Why this score</h3>
          </div>
          {result.flags.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {result.flags.slice().sort((a, b) => b.weight - a.weight).map(f => {
                const c = f.severity === 'critical' ? 'var(--accent-red)' : f.severity === 'high' ? 'var(--accent-orange)' : f.severity === 'medium' ? 'var(--accent-amber)' : 'var(--text-muted)';
                return (
                  <div key={f.id} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8 }}>
                    <AlertTriangle size={15} color={c} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>“{f.keyword}”</span>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: c }}>+{Math.round(f.weight * 100)}%</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.45 }}>{f.reason}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No scam indicators found.</div>}
        </div>

        {/* Links + actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Link2 size={15} color="var(--accent-light)" />
              <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Link analysis</h3>
            </div>
            {result.links.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.links.map((l, i) => {
                  const c = l.severity === 'critical' ? 'var(--accent-red)' : l.severity === 'high' ? 'var(--accent-orange)' : l.severity === 'medium' ? 'var(--accent-amber)' : 'var(--accent-emerald)';
                  return (
                    <div key={i} style={{ padding: '10px 12px', background: 'var(--bg-subtle)', border: `1px solid ${c}44`, borderRadius: 8 }}>
                      <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-primary)', wordBreak: 'break-all', fontWeight: 600 }}>{l.url}</div>
                      <div style={{ fontSize: 11, color: c, marginTop: 3 }}>{l.reason}</div>
                    </div>
                  );
                })}
              </div>
            ) : <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No links detected in the message.</div>}
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <ShieldAlert size={15} color="var(--accent-emerald)" />
              <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Recommended actions</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {result.recommendedActions.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <CheckCircle2 size={14} color="var(--accent-emerald)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{a}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HighlightedText({ text, flags }: { text: string; flags: MessageFlag[] }) {
  const segments = useMemo(() => {
    if (!flags.length) return [{ text, flag: null as MessageFlag | null }];
    const sorted = flags.slice().filter(f => f.start >= 0 && f.end <= text.length && f.end > f.start).sort((a, b) => a.start - b.start);
    const segs: { text: string; flag: MessageFlag | null }[] = [];
    let cursor = 0;
    for (const f of sorted) {
      if (f.start < cursor) continue; // skip overlaps
      if (f.start > cursor) segs.push({ text: text.slice(cursor, f.start), flag: null });
      segs.push({ text: text.slice(f.start, f.end), flag: f });
      cursor = f.end;
    }
    if (cursor < text.length) segs.push({ text: text.slice(cursor), flag: null });
    return segs;
  }, [text, flags]);

  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.9, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 10, padding: '14px 16px' }}>
      {segments.map((s, i) => s.flag ? (
        <mark key={i} className={`risk-mark sev-${s.flag.severity === 'critical' ? 'critical' : s.flag.severity === 'high' ? 'high' : 'medium'}`} title={s.flag.reason}>{s.text}</mark>
      ) : <span key={i}>{s.text}</span>)}
    </div>
  );
}
