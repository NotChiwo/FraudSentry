import { useState, useRef } from 'react';
import {
  GitCompareArrows, UploadCloud, MessageSquareText, Loader2, ShieldAlert,
  AlertTriangle, CheckCircle2, ArrowRight, X, ScanLine, Type, Table2,
} from 'lucide-react';
import { analyzeTransactionImage } from '../engine/imageVerification';
import { analyzeMessageText, correlateEvidence } from '../engine/messageAnalysis';
import { runOcr } from '../services/ocr';
import { useAppStore } from '../store/useAppStore';
import { ImageScanResult, MessageScanResult, CrossEvidenceResult, RiskLevel, FieldMatchState, EvidenceLinkage } from '../types';
import { RISK_META } from '../utils/helpers';
import { validateImageFile, ACCEPTED_IMAGE_TYPES } from '../services/uploadValidation';

export default function CrossEvidencePage() {
  const addCrossCheck = useAppStore(s => s.addCrossCheck);
  const addImageScan = useAppStore(s => s.addImageScan);
  const addMessageScan = useAppStore(s => s.addMessageScan);

  const [txFile, setTxFile] = useState<File | null>(null);
  const [txPreview, setTxPreview] = useState('');
  const [convMode, setConvMode] = useState<'text' | 'image'>('text');
  const [convText, setConvText] = useState('');
  const [convFile, setConvFile] = useState<File | null>(null);
  const [convPreview, setConvPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ cross: CrossEvidenceResult; tx: ImageScanResult; msg: MessageScanResult } | null>(null);

  const txRef = useRef<HTMLInputElement>(null);
  const convRef = useRef<HTMLInputElement>(null);

  const pickTx = async (f: File) => {
    const invalid = await validateImageFile(f);
    if (invalid) { setError(`Transaction screenshot: ${invalid}`); return; }
    setError(''); setTxFile(f);
    const r = new FileReader(); r.onload = () => setTxPreview(r.result as string); r.readAsDataURL(f);
  };
  const pickConv = async (f: File) => {
    const invalid = await validateImageFile(f);
    if (invalid) { setError(`Conversation screenshot: ${invalid}`); return; }
    setError(''); setConvFile(f);
    const r = new FileReader(); r.onload = () => setConvPreview(r.result as string); r.readAsDataURL(f);
  };

  const canRun = txFile && (convMode === 'text' ? convText.trim().length > 0 : convFile);

  const run = async () => {
    if (!txFile) { setError('Please add a transaction screenshot.'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      setStage('Analyzing transaction evidence');
      const tx = await analyzeTransactionImage(txFile, { previewDataUrl: txPreview, onStage: s => setStage(s) });

      let convRaw = convText;
      let ocrConf: number | null = null;
      if (convMode === 'image' && convFile) {
        setStage('Reading conversation screenshot');
        const ocr = await runOcr(convFile, s => setStage(s));
        if (!ocr.available) { setBusy(false); setError('Could not OCR the conversation. Paste the chat text instead.'); return; }
        convRaw = ocr.text; ocrConf = ocr.confidence;
        setConvText(ocr.text);
      }
      if (!convRaw.trim()) { setBusy(false); setError('The conversation text is empty.'); return; }

      setStage('Correlating evidence');
      const msg = analyzeMessageText(convRaw, 'Unknown', ocrConf);
      const cross = correlateEvidence(tx, msg);

      addImageScan(tx); addMessageScan(msg); addCrossCheck(cross);
      setResult({ cross, tx, msg });
      setBusy(false);
    } catch (e: unknown) {
      setBusy(false);
      setError((e instanceof Error && e.message) || 'Cross-evidence analysis failed.');
    }
  };

  const reset = () => {
    setTxFile(null); setTxPreview(''); setConvText(''); setConvFile(null);
    setConvPreview(''); setResult(null); setError('');
  };

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--bg-accent-tint)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GitCompareArrows size={19} color="var(--accent-light)" />
          </div>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: 'var(--text-primary)' }}>Cross-Evidence Analysis</h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '2px 0 0', maxWidth: 640 }}>
              Pair a payment with the conversation behind it. An authentic-looking transfer plus a scam chat is the dangerous combination — real money, fraudulent context.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: '13px 16px', display: 'flex', gap: 10, alignItems: 'center', borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)', marginBottom: 16 }}>
          <AlertTriangle size={16} color="var(--accent-red)" />
          <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{error}</span>
          <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      {!result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, marginBottom: 18 }}>
          {/* Transaction input */}
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <ScanLine size={15} color="var(--accent-light)" />
              <h2 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>1 · Transaction screenshot</h2>
            </div>
            {!txPreview ? (
              <div onClick={() => txRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) pickTx(f); }}
                style={{ borderRadius: 12, padding: '34px 18px', textAlign: 'center', border: '2px dashed var(--border-strong)', background: 'var(--bg-subtle)', cursor: 'pointer' }}>
                <UploadCloud size={24} color="var(--accent-light)" style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Add the receipt / transfer</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>GCash, Maya, bank screenshot…</div>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <img src={txPreview} alt="tx" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border-default)' }} />
                <button onClick={() => { setTxFile(null); setTxPreview(''); }} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(2,6,23,0.8)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: 5, cursor: 'pointer', display: 'flex' }}><X size={14} color="#fff" /></button>
              </div>
            )}
            <input ref={txRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden onChange={e => { const f = e.target.files?.[0]; if (f) pickTx(f); e.target.value = ''; }} />
          </div>

          {/* Conversation input */}
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MessageSquareText size={15} color="var(--accent-light)" />
                <h2 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>2 · Conversation</h2>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" title="Paste conversation text" aria-pressed={convMode === 'text'} className={`filter-btn ${convMode === 'text' ? 'active' : ''}`} onClick={() => setConvMode('text')}><Type size={15} /> Text</button>
                <button type="button" title="Upload conversation screenshot" aria-pressed={convMode === 'image'} className={`filter-btn ${convMode === 'image' ? 'active' : ''}`} onClick={() => setConvMode('image')}><UploadCloud size={15} /> Image</button>
              </div>
            </div>
            {convMode === 'text' ? (
              <textarea className="input-field" rows={7} placeholder="Paste the chat / SMS that came with this payment…" value={convText} onChange={e => setConvText(e.target.value)} style={{ resize: 'vertical', lineHeight: 1.55 }} />
            ) : !convPreview ? (
              <div onClick={() => convRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) pickConv(f); }}
                style={{ borderRadius: 12, padding: '34px 18px', textAlign: 'center', border: '2px dashed var(--border-strong)', background: 'var(--bg-subtle)', cursor: 'pointer' }}>
                <UploadCloud size={24} color="var(--accent-light)" style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Add the chat screenshot</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>We'll OCR it for you</div>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <img src={convPreview} alt="conv" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border-default)' }} />
                <button onClick={() => { setConvFile(null); setConvPreview(''); }} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(2,6,23,0.8)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: 5, cursor: 'pointer', display: 'flex' }}><X size={14} color="#fff" /></button>
              </div>
            )}
            <input ref={convRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden onChange={e => { const f = e.target.files?.[0]; if (f) pickConv(f); e.target.value = ''; }} />
          </div>
        </div>
      )}

      {!result && (
        <button className="btn-primary" disabled={!canRun || busy} onClick={run} style={{ width: '100%', justifyContent: 'center', padding: '13px' }}>
          {busy ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> {stage}…</> : <><GitCompareArrows size={16} /> Correlate evidence</>}
        </button>
      )}

      {result && <CrossResult data={result} onReset={reset} />}
    </div>
  );
}

function CrossResult({ data, onReset }: { data: { cross: CrossEvidenceResult; tx: ImageScanResult; msg: MessageScanResult }; onReset: () => void }) {
  const { cross, tx, msg } = data;
  const meta = RISK_META[cross.combinedRiskLevel];
  const Verdict = cross.combinedRiskLevel === 'low' ? CheckCircle2 : cross.combinedRiskLevel === 'critical' ? ShieldAlert : AlertTriangle;

  return (
    <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 22, borderColor: `${meta.hex}55`, background: meta.soft }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: 50, height: 50, borderRadius: 13, background: `${meta.hex}22`, border: `1px solid ${meta.hex}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span className={`verdict-ico verdict-${cross.combinedRiskLevel}`} style={{ display: 'inline-flex' }}><Verdict size={26} color={meta.hex} /></span>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>{cross.verdict}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>
              Combined risk · {Math.round(cross.combinedScore * 100)}%
              {cross.linkage && <> · Evidence {LINKAGE_LABEL[cross.linkage]}</>}
            </div>
          </div>
          <button className="btn-secondary" onClick={onReset}>New comparison</button>
        </div>
      </div>

      {/* Two-source summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
        <SourceCard title="Transaction evidence" risk={tx.riskLevel} label={tx.legitimacyLabel} detail={`${tx.source} · OCR ${tx.ocr.available ? Math.round(tx.ocr.confidence) + '%' : 'N/A'}`} />
        <SourceCard title="Conversation" risk={msg.threatLevel} label={msg.scamType} detail={`${msg.flags.length} flagged phrase(s)`} />
      </div>

      {/* Rationale */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <GitCompareArrows size={15} color="var(--accent-light)" />
          <h2 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>How the two sources combine</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {cross.rationale.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <ArrowRight size={15} color="var(--accent-light)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{r}</span>
            </div>
          ))}
        </div>
      </div>

      {cross.fieldComparison && cross.fieldComparison.some(c => c.state !== 'absent') && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Table2 size={15} color="var(--accent-light)" />
            <h2 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Detail comparison</h2>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            What the receipt says versus what the conversation claims — a matching reference or recipient number links them; a conflict on the same transaction means one of them was altered. Names are shown for reference only (OCR and nicknames make them unreliable), so they never decide the verdict.
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Detail</th><th>Receipt</th><th>Conversation</th><th style={{ textAlign: 'right' }}>Status</th></tr></thead>
              <tbody>
                {cross.fieldComparison.filter(c => c.state !== 'absent').map(c => {
                  const st = MATCH_STYLE[c.state];
                  return (
                    <tr key={c.key} style={c.state === 'conflict' ? { background: 'rgba(239,68,68,0.06)' } : undefined}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.label}</td>
                      <td className="mono" style={{ fontSize: 12.5 }}>{c.receiptValue ?? <span style={{ color: 'var(--text-disabled)', fontStyle: 'italic' }}>not found</span>}</td>
                      <td className="mono" style={{ fontSize: 12.5 }}>{c.messageValue ?? <span style={{ color: 'var(--text-disabled)', fontStyle: 'italic' }}>not found</span>}</td>
                      <td style={{ textAlign: 'right' }}><span style={{ fontSize: 12, fontWeight: 800, color: st.color, letterSpacing: '0.03em' }}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const LINKAGE_LABEL: Record<EvidenceLinkage, string> = {
  linked: 'linked to the same transaction',
  contradictory: 'contradicts itself',
  unrelated: 'not about the same transaction',
  insufficient: 'linkage unknown (no shared details)',
};

const MATCH_STYLE: Record<FieldMatchState, { label: string; color: string }> = {
  match: { label: 'Match', color: 'var(--accent-emerald)' },
  conflict: { label: 'CONFLICT', color: 'var(--accent-red)' },
  'receipt-only': { label: 'Receipt only', color: 'var(--text-muted)' },
  'message-only': { label: 'Message only', color: 'var(--text-muted)' },
  absent: { label: '—', color: 'var(--text-disabled)' },
};

function SourceCard({ title, risk, label, detail }: { title: string; risk: RiskLevel; label: string; detail: string }) {
  const meta = RISK_META[risk];
  const badgeClass = risk;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
        <span className={`badge badge-${badgeClass}`}>{meta.label}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{detail}</div>
    </div>
  );
}
