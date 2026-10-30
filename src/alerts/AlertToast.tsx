// Pop-up notice when a check generates a new fraud alert (thesis §9.5.1:
// "notify users when suspicious transactions are detected"). It names the
// risk level and opens the Alerts page; the alert itself stays unread there.
import { useEffect, useRef, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { useAppStore } from '../shared/store';
import type { FraudAlert } from './alerts';

const LEVEL: Record<FraudAlert['riskLevel'], string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const SHOW_MS = 12000;

export default function AlertToast({ onOpen }: { onOpen: () => void }) {
  const alerts = useAppStore(s => s.alerts);
  // alerts that already existed when the app opened are not announced again
  const seen = useRef<Set<string>>(new Set(alerts.map(a => a.id)));
  const [current, setCurrent] = useState<FraudAlert | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const fresh = alerts.filter(a => !seen.current.has(a.id));
    fresh.forEach(a => seen.current.add(a.id));
    if (fresh.length) setCurrent(fresh[0]);
    // the alert was deleted (or its check was) while the notice was showing
    else if (current && !alerts.some(a => a.id === current.id)) setCurrent(null);
  }, [alerts, current]);

  useEffect(() => {
    if (!current || paused) return;
    const t = setTimeout(() => setCurrent(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [current, paused]);

  if (!current) return null;
  const sev = current.riskLevel === 'low' ? 'ok' : current.riskLevel;
  return (
    <div className={`alert-toast sev-${sev}`} role="alert"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <ShieldAlert size={20} className="alert-toast-ico" aria-hidden="true" />
      <div className="alert-toast-body">
        <div className="alert-toast-title">{LEVEL[current.riskLevel]} risk: {current.title}</div>
        <div className="alert-toast-text">An alert was saved to your Alerts.</div>
        <button type="button" className="btn-secondary" onClick={() => { setCurrent(null); onOpen(); }}>View alerts</button>
      </div>
      <button type="button" className="icon-btn sm" aria-label="Dismiss" onClick={() => setCurrent(null)}><X size={16} /></button>
    </div>
  );
}
