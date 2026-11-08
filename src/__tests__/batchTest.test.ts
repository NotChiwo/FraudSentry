import { describe, it, expect } from 'vitest';
import { summarize, wilsonUpper, genuineNeededFor, batchCsv, isCorrect, topReason, type BatchRow } from '../random-forest/batchTest';
import type { ImageScanResult, RiskLevel, VerificationFinding } from '../shared/types';

const f = (label: string, severity: RiskLevel, passed = false, weight = 0.1): VerificationFinding =>
  ({ id: label, category: 'text', label, detail: '', severity, passed, weight });
const scan = (riskLevel: RiskLevel, findings: VerificationFinding[] = []): ImageScanResult =>
  ({ riskLevel, riskScore: riskLevel === 'low' ? 0.1 : riskLevel === 'medium' ? 0.3 : riskLevel === 'high' ? 0.5 : 0.8, findings, source: 'GCash', forensics: { capture: 'screenshot' } } as unknown as ImageScanResult);

describe('batch test', () => {
  it('counts false alarms on genuine receipts and fakes caught', () => {
    const rows: BatchRow[] = [
      { file: 'g1.png', truth: 'genuine', scan: scan('low') },
      { file: 'g2.png', truth: 'genuine', scan: scan('medium') },     // medium is not a flag
      { file: 'g3.png', truth: 'genuine', scan: scan('high', [f('Hidden or Blocked-Out Details', 'high')]) },
      { file: 'f1.png', truth: 'fake', scan: scan('critical') },
      { file: 'f2.png', truth: 'fake', scan: scan('low') },
      { file: 'x.png', truth: 'fake', error: 'unreadable file' },
    ];
    const s = summarize(rows);
    expect([s.genuine, s.genuinePassed, s.falseAlarms]).toEqual([3, 2, 1]);
    expect(s.falseAlarmRate).toBeCloseTo(1 / 3);
    expect(s.genuineUnverifiable).toBe(1);                         // shown as "Can't be verified"
    expect([s.fakes, s.fakesCaught, s.fakesMissed, s.failed, s.fakesUnverifiable]).toEqual([2, 1, 1, 1, 0]);
    expect(rows.map(isCorrect)).toEqual([true, true, false, true, false, false]);
  });
  it('the 95% upper bound is honest about small samples', () => {
    expect(wilsonUpper(0, 20)).toBeGreaterThan(0.15);              // 0 of 20 is not "0%"
    expect(wilsonUpper(0, 400)).toBeLessThan(0.01);
    const n = genuineNeededFor(0.01);
    expect(n).toBeGreaterThan(350); expect(n).toBeLessThan(420);
    expect(wilsonUpper(0, n)).toBeLessThanOrEqual(0.01);
    expect(wilsonUpper(0, n - 1)).toBeGreaterThan(0.01);
  });
  it('main reason is the most severe failed check', () => {
    expect(topReason(scan('high', [f('Minor', 'medium', false, 0.5), f('Edited amount', 'critical'), f('Fine', 'critical', true)]))).toBe('Edited amount');
    expect(topReason(scan('low'))).toBe('No problems found');
  });
  it('CSV quotes commas and quotes, one line per receipt', () => {
    const csv = batchCsv([{ file: 'a, "b".png', truth: 'genuine', scan: scan('low') }, { file: 'c.png', truth: 'fake', error: 'bad' }]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith('"a, ""b"".png",genuine,low,0.100,Legitimate,no,yes')).toBe(true);
    expect(lines[2]).toBe('c.png,fake,,,,,,,,,,bad');
  });
});
