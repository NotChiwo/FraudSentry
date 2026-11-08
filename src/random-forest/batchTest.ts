// ============================================================
// Batch test — run many receipts of KNOWN truth through the real checks and
// measure: how often a genuine receipt is wrongly flagged (false alarms) and
// how many fakes are caught. Nothing here is simulated: each row is a full
// analyzeTransactionImage() result. Pure functions only (tested); the page
// lives in BatchTestCard.tsx.
// ============================================================
import type { ImageScanResult, RiskLevel, VerificationFinding } from '../shared/types';
import { classificationOf, classificationShown } from '../shared/helpers';

export type Truth = 'genuine' | 'fake';

export interface BatchRow {
  file: string;
  truth: Truth;
  /** the scan, or why it couldn't be scanned */
  scan?: ImageScanResult;
  error?: string;
}

/** Flagged = classified "possibly fraudulent" (High or Critical), as the metrics count it. */
export const flagged = (s: ImageScanResult) => (s.classification ?? classificationOf(s.riskLevel)) === 'fraudulent';

/** Right answer: a genuine receipt not flagged, a fake one flagged. */
export const isCorrect = (r: BatchRow) => !!r.scan && (r.truth === 'fake') === flagged(r.scan);

const RANK: Record<RiskLevel, number> = { critical: 3, high: 2, medium: 1, low: 0 };
/** The main reason behind the result (the most severe failed check). */
export function topReason(s: ImageScanResult): string {
  const f: VerificationFinding | undefined = s.findings.filter(x => !x.passed)
    .sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.weight - a.weight)[0];
  return f ? f.label : 'No problems found';
}

/**
 * Upper end of the 95% Wilson interval for a rate of k in n. Says how high the
 * true rate could still be: 0 false alarms in 20 genuine receipts is not
 * "0%", it is "under 16%"; it takes about 300 to show "under 1%".
 */
export function wilsonUpper(k: number, n: number, z = 1.96): number {
  if (n <= 0) return 1;
  const p = k / n, z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, (centre + margin) / (1 + z2 / n));
}

export interface BatchSummary {
  genuine: number; genuinePassed: number; falseAlarms: number;
  /** false alarms / genuine (null when no genuine receipt was scanned) */
  falseAlarmRate: number | null;
  /** 95% upper bound of that rate */
  falseAlarmUpper: number | null;
  fakes: number; fakesCaught: number; fakesMissed: number;
  catchRate: number | null;
  /** genuine receipts flagged only because details were blurred ("Can't be verified") */
  genuineUnverifiable: number;
  /** fakes caught but shown as "Can't be verified" rather than as fake */
  fakesUnverifiable: number;
  failed: number;
}

export function summarize(rows: BatchRow[]): BatchSummary {
  const done = rows.filter(r => r.scan);
  const g = done.filter(r => r.truth === 'genuine'), f = done.filter(r => r.truth === 'fake');
  const falseAlarms = g.filter(r => flagged(r.scan!)).length;
  const fakesCaught = f.filter(r => flagged(r.scan!)).length;
  return {
    genuine: g.length, genuinePassed: g.length - falseAlarms, falseAlarms,
    falseAlarmRate: g.length ? falseAlarms / g.length : null,
    falseAlarmUpper: g.length ? wilsonUpper(falseAlarms, g.length) : null,
    fakes: f.length, fakesCaught, fakesMissed: f.length - fakesCaught,
    catchRate: f.length ? fakesCaught / f.length : null,
    genuineUnverifiable: g.filter(r => flagged(r.scan!) && classificationShown(r.scan!).cls === 'unverifiable').length,
    fakesUnverifiable: f.filter(r => flagged(r.scan!) && classificationShown(r.scan!).cls === 'unverifiable').length,
    failed: rows.length - done.length,
  };
}

/** How many genuine receipts in a row with no false alarm are needed to show the rate is under `target` (95%). */
export function genuineNeededFor(target: number): number {
  let n = 1;
  while (wilsonUpper(0, n) > target && n < 100000) n++;
  return n;
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function batchCsv(rows: BatchRow[]): string {
  const head = ['file', 'truth', 'risk_level', 'risk_score', 'shown_as', 'flagged', 'correct', 'top_reason', 'source', 'capture', 'unreadable_fields', 'error'];
  const lines = rows.map(r => {
    const s = r.scan;
    return [
      r.file, r.truth,
      s?.riskLevel ?? '', s ? s.riskScore.toFixed(3) : '',
      s ? classificationShown(s).label : '', s ? (flagged(s) ? 'yes' : 'no') : '',
      s ? (isCorrect(r) ? 'yes' : 'no') : '', s ? topReason(s) : '',
      s?.source ?? '', s?.forensics?.capture ?? '',
      s ? [...(s.blurredFields ?? []), ...(s.unsureFields ?? [])].join(' ') : '',
      r.error ?? '',
    ].map(csvCell).join(',');
  });
  return [head.join(','), ...lines].join('\n') + '\n';
}
