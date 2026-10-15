import { describe, it, expect } from 'vitest';
import { withinRetention, HISTORY_RETENTION_DAYS } from '../store/useAppStore';

describe('local history retention (RA 10173 data minimisation)', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-10-15T00:00:00Z');
  const at = (daysAgo: number) => ({ scannedAt: new Date(now - daysAgo * day).toISOString() });

  it(`keeps results from the last ${HISTORY_RETENTION_DAYS} days and drops older ones`, () => {
    const kept = withinRetention([at(0), at(29), at(31), at(400)], now);
    expect(kept).toEqual([at(0), at(29)]);
  });
  it('never drops an entry whose date cannot be read', () => {
    expect(withinRetention([{ scannedAt: 'not a date' }], now)).toHaveLength(1);
  });
});
