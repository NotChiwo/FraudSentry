import { useAppStore } from '../../store/useAppStore';
import type { ImageScanResult } from '../../types';

// Mark a scanned receipt as genuine or fake for the Random Forest's training
// data. Only the 10 numeric evidence features and the label are kept.
export default function TrainingLabel({ scan, compact = false }: { scan: ImageScanResult; compact?: boolean }) {
  const label = useAppStore(s => s.trainingRows.find(r => r.id === scan.id)?.label ?? null);
  const labelScan = useAppStore(s => s.labelScan);
  const set = (l: 0 | 1) => labelScan(scan, label === l ? null : l);
  return (
    <div className={`train-label${compact ? ' compact' : ''}`} role="group" aria-label="Training label for this receipt">
      {!compact && <span className="tl-q">For training: is this receipt really</span>}
      <button type="button" className={`tl-btn tl-genuine${label === 0 ? ' on' : ''}`} aria-pressed={label === 0} onClick={() => set(0)}>Genuine</button>
      <button type="button" className={`tl-btn tl-fake${label === 1 ? ' on' : ''}`} aria-pressed={label === 1} onClick={() => set(1)}>Fake</button>
      {!compact && <span className="tl-note">{label === null ? 'Not labelled' : 'Saved as training data (numbers only)'}</span>}
    </div>
  );
}
