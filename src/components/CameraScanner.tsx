// ============================================================
// FraudSentry — live camera scanner
//
// Opens the device camera inside the page (getUserMedia), shows a receipt
// guide frame, measures every few hundred ms how sharp / bright / steady the
// live picture is (services/frameQuality.ts) and captures a full-resolution
// still — automatically once the picture has been sharp and steady for a
// moment, or when the user presses the shutter. Works with phone cameras
// (rear camera preferred), laptop webcams and USB cameras.
// The video never leaves the device: frames are read into a canvas in this
// browser only.
// ============================================================
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, SwitchCamera, Flashlight, FlashlightOff, Camera, Zap, ZapOff, ImageUp } from 'lucide-react';
import { toGray, frameStats, frameHint, HINT_TEXT, FrameHint } from '../services/frameQuality';

interface Props {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** opens the device's own camera app / file picker instead (fallback) */
  onFallback: () => void;
}

type CamState = 'starting' | 'live' | 'error';
const READY_HOLD_MS = 1200;     // picture must stay "ready" this long before auto-capture
const SAMPLE_MS = 200;

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name || '';
  if (!window.isSecureContext) return 'The camera only works on a secure page (https:// or this computer). Use "Use camera app instead" below.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again — or use your camera app instead.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  if (name === 'NotSupportedError' || name === 'NotSupported') return 'This browser cannot open a live camera here. Use your camera app instead — the photo is checked the same way.';
  return 'The camera could not be started on this browser.';
}

export default function CameraScanner({ onCapture, onClose, onFallback }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const prevRef = useRef<Float32Array | null>(null);
  const readySinceRef = useRef<number | null>(null);
  const capturedRef = useRef(false);
  const [state, setState] = useState<CamState>('starting');
  const [error, setError] = useState('');
  const [hint, setHint] = useState<FrameHint | null>(null);
  const [stats, setStats] = useState<{ s: number; b: number; m: number | null } | null>(null);
  const [holdPct, setHoldPct] = useState(0);
  const [auto, setAuto] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [torchOk, setTorchOk] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [flash, setFlash] = useState(false);

  const stop = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; };

  // start / restart the camera
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState('starting'); setError(''); setTorchOn(false); capturedRef.current = false;
      if (!navigator.mediaDevices?.getUserMedia) { setState('error'); setError(cameraError({ name: 'NotSupported' })); return; }
      stop();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => { /* autoplay with muted+playsInline normally succeeds */ });
        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() || {}) as MediaTrackCapabilities & { torch?: boolean };
        setTorchOk(!!caps.torch);
        // device labels are only available after permission is granted
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter(d => d.kind === 'videoinput'));
        if (!cancelled) setState('live');
      } catch (e) {
        if (!cancelled) { setState('error'); setError(cameraError(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, [deviceId]);

  useEffect(() => () => stop(), []);

  const capture = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || capturedRef.current) return;
    capturedRef.current = true;
    setFlash(true);
    // Prefer a full-resolution still from the camera sensor (Chrome/Android
    // support ImageCapture.takePhoto); fall back to the current video frame.
    let blob: Blob | null = null;
    const track = streamRef.current?.getVideoTracks()[0];
    const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture;
    if (IC && track) {
      try {
        blob = await Promise.race([
          new IC(track).takePhoto(),
          new Promise<null>(r => setTimeout(() => r(null), 4000)),
        ]);
      } catch { blob = null; }
    }
    if (!blob) {
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0);
      blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
    }
    if (!blob) { capturedRef.current = false; setFlash(false); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    stop();
    onCapture(new File([blob], `camera-${stamp}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
  }, [onCapture]);

  // live quality sampling + auto-capture
  useEffect(() => {
    if (state !== 'live') return;
    const sc = document.createElement('canvas');
    const ctx = sc.getContext('2d', { willReadFrequently: true })!;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.videoWidth || capturedRef.current) return;
      const w = 160, h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * 160));
      sc.width = w; sc.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      const gray = toGray(ctx.getImageData(0, 0, w, h).data, w, h);
      const s = frameStats(gray, w, h, prevRef.current);
      prevRef.current = gray;
      const hnt = frameHint(s);
      setHint(hnt);
      setStats({ s: Math.round(s.sharpness), b: Math.round(s.brightness), m: s.motion == null ? null : Math.round(s.motion * 10) / 10 });
      const now = performance.now();
      if (hnt === 'ready') {
        readySinceRef.current ??= now;
        const held = now - readySinceRef.current;
        setHoldPct(Math.min(100, Math.round((held / READY_HOLD_MS) * 100)));
        if (auto && held >= READY_HOLD_MS) void capture();
      } else {
        readySinceRef.current = null;
        setHoldPct(0);
      }
    }, SAMPLE_MS);
    return () => clearInterval(t);
  }, [state, auto, capture]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { stop(); onClose(); }
      if ((e.key === ' ' || e.key === 'Enter') && state === 'live' && (e.target as HTMLElement)?.tagName !== 'BUTTON') { e.preventDefault(); void capture(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, capture, onClose]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] }); setTorchOn(o => !o); } catch { setTorchOk(false); }
  };
  const switchCamera = () => {
    if (devices.length < 2) return;
    const cur = streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId;
    const idx = devices.findIndex(d => d.deviceId === cur);
    setDeviceId(devices[(idx + 1) % devices.length].deviceId);
  };
  const close = () => { stop(); onClose(); };

  // Portal to <body>: the page's entrance animation creates a stacking context
  // that would otherwise trap this fixed overlay under the top bar / tab bar.
  return createPortal(
    <div className="cam-overlay" role="dialog" aria-modal="true" aria-label="Scan a receipt with your camera">
      <div className="cam-stage">
        <video ref={videoRef} className="cam-video" playsInline muted autoPlay aria-hidden="true" />
        {state === 'live' && (
          <div className={`cam-guide${hint === 'ready' ? ' ok' : ''}`} aria-hidden="true">
            <span className="scan-corner tl" /><span className="scan-corner tr" /><span className="scan-corner bl" /><span className="scan-corner br" />
            <span className="cam-sweep" />
            {holdPct > 0 && auto && <span className="cam-hold" style={{ width: `${holdPct}%` }} />}
          </div>
        )}
        {flash && <div className="cam-flash" aria-hidden="true" />}

        <div className="cam-top">
          <button type="button" className="cam-btn" onClick={close} aria-label="Close camera"><X size={22} /></button>
          <div className="cam-title">Fit the whole receipt inside the frame</div>
          <button type="button" className={`cam-btn${auto ? ' on' : ''}`} onClick={() => setAuto(a => !a)} aria-pressed={auto}
            aria-label={auto ? 'Auto-capture on' : 'Auto-capture off'} title="Auto-capture when sharp and steady">
            {auto ? <Zap size={20} /> : <ZapOff size={20} />}
          </button>
        </div>

        {state === 'starting' && <div className="cam-msg"><span className="spinner" aria-hidden="true" /> Starting camera… allow access if your browser asks.</div>}
        {state === 'error' && (
          <div className="cam-msg cam-error" role="alert">
            <Camera size={28} aria-hidden="true" />
            <p>{error}</p>
            <div className="cam-err-actions">
              <button type="button" className="btn-primary" onClick={() => { stop(); onFallback(); }}><ImageUp size={17} /> Use camera app instead</button>
              <button type="button" className="btn-secondary" onClick={() => setDeviceId(d => (d === null ? '' : null))}>Try again</button>
            </div>
          </div>
        )}

        {state === 'live' && (
          <div className="cam-bottom">
            <div className={`cam-hint hint-${hint ?? 'none'}`} aria-live="polite" data-sharpness={stats?.s} data-brightness={stats?.b} data-motion={stats?.m ?? ''}>{hint ? HINT_TEXT[hint] : 'Point the camera at the receipt'}{auto && hint === 'ready' ? ' · auto-capturing' : ''}</div>
            <div className="cam-controls">
              {torchOk
                ? <button type="button" className={`cam-btn${torchOn ? ' on' : ''}`} onClick={toggleTorch} aria-pressed={torchOn} aria-label="Flashlight">{torchOn ? <Flashlight size={22} /> : <FlashlightOff size={22} />}</button>
                : <span className="cam-btn ghost" aria-hidden="true" />}
              <button type="button" className="cam-shutter" onClick={() => void capture()} aria-label="Capture receipt"><span /></button>
              {devices.length > 1
                ? <button type="button" className="cam-btn" onClick={switchCamera} aria-label="Switch camera"><SwitchCamera size={22} /></button>
                : <span className="cam-btn ghost" aria-hidden="true" />}
            </div>
            <button type="button" className="cam-link" onClick={() => { stop(); onFallback(); }}>Use camera app or gallery instead</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
