// Forensic signal thresholds. The "genuine" values below are real measurements
// from genuine PH receipt screenshots (ELA hotspot % range 2.0–17.5, mean ≤ 8).
import { describe, it, expect } from 'vitest';
import { buildForensicSignals, ELA_HOTSPOT_THRESHOLD, ForensicInput } from '../services/imageForensics';
import { checkReceiptDate } from '../services/consistencyChecks';

const base: ForensicInput = {
  sniff: 'image/jpeg', declaredType: 'image/jpeg',
  jpeg: { hasExif: false, software: null, progressive: true },
  width: 944, height: 2046, ela: { mean: 4, hotspotPct: 6.4 },
};
const failed = (x: ForensicInput) => buildForensicSignals(x).filter(s => !s.passed).map(s => s.label);
const score = (x: ForensicInput) => buildForensicSignals(x).filter(s => !s.passed).reduce((t, s) => t + s.weight, 0);

describe('forensic signals on genuine-looking screenshots', () => {
  it('a typical chat-forwarded genuine JPEG (progressive, no EXIF, median ELA) raises nothing', () => {
    expect(failed(base)).toEqual([]);
    expect(score(base)).toBe(0);
  });
  it('the highest ELA hotspot % we measured on a genuine receipt (17.5) is not flagged', () => {
    expect(failed({ ...base, ela: { mean: 8, hotspotPct: 17.5 } })).toEqual([]);
    expect(ELA_HOTSPOT_THRESHOLD).toBeGreaterThan(17.5);
  });
  it('progressive encoding and missing EXIF are shown as noted, never scored', () => {
    const s = buildForensicSignals(base);
    for (const l of ['JPEG Encoding Mode', 'Metadata (EXIF) Presence']) {
      const x = s.find(v => v.label === l)!;
      expect(x.passed).toBe(true);
      expect(x.weight).toBe(0);
    }
  });
});

describe('forensic signals that still fire', () => {
  it('ELA above the threshold is a medium-severity hint', () => {
    const e = buildForensicSignals({ ...base, ela: { mean: 9, hotspotPct: 26 } }).find(s => s.label === 'Error Level Analysis')!;
    expect(e.passed).toBe(false);
    expect(e.severity).toBe('medium');
  });
  it('an editor signature in the metadata is high severity', () => {
    expect(failed({ ...base, jpeg: { ...base.jpeg, software: 'Adobe Photoshop 25.0' } })).toContain('Editing-Software Signature');
  });
  it('a renamed file (bytes say PNG, name says JPEG) fails container integrity', () => {
    expect(failed({ ...base, sniff: 'image/png', declaredType: 'image/jpeg' })).toContain('Container Integrity');
  });
  it('an odd crop fails screen geometry', () => {
    expect(failed({ ...base, width: 900, height: 300 })).toContain('Screen Geometry');
  });
});

describe('future date wording mentions the device clock', () => {
  it('tells the user to check their phone date before trusting the alarm', () => {
    const c = checkReceiptDate('Oct 12, 2026', '9:00 AM', new Date('2026-10-07T12:00:00+08:00'));
    expect(c.status).toBe('future');
    expect(c.detail).toMatch(/phone's own date and time/);
  });
});
