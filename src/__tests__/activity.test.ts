// Home-page activity numbers come only from local history.
import { describe, it, expect } from 'vitest';
import { computeActivity, MILESTONES, ActivityEvent } from '../services/activity';

const NOW = new Date(2026, 9, 7, 15, 0);            // 7 Oct 2026, 3 PM local
const at = (daysAgo: number, h = 10) => { const d = new Date(NOW); d.setDate(d.getDate() - daysAgo); d.setHours(h); return d.toISOString(); };
const ev = (daysAgo: number, kind: ActivityEvent['kind'] = 'receipt', level: ActivityEvent['level'] = 'low'): ActivityEvent => ({ kind, level, when: at(daysAgo) });

describe('computeActivity', () => {
  it('is all zeros with no history (nothing is invented)', () => {
    expect(computeActivity([], NOW)).toEqual({ total: 0, receipts: 0, messages: 0, last7: 0, risky: 0, streak: 0, activeDays: 0 });
  });
  it('counts totals, kinds, risky results and the last 7 days', () => {
    const a = computeActivity([ev(0), ev(0, 'message', 'high'), ev(3, 'receipt', 'critical'), ev(6), ev(7), ev(30, 'message')], NOW);
    expect(a).toMatchObject({ total: 6, receipts: 4, messages: 2, risky: 2, last7: 4, activeDays: 5 });
  });
  it('streak counts consecutive days ending today', () => {
    expect(computeActivity([ev(0), ev(1), ev(2), ev(4)], NOW).streak).toBe(3);
  });
  it('a streak ending yesterday still counts until today is over', () => {
    expect(computeActivity([ev(1), ev(2)], NOW).streak).toBe(2);
  });
  it('a gap of a full day resets it', () => {
    expect(computeActivity([ev(2), ev(3)], NOW).streak).toBe(0);
  });
  it('ignores records with an unreadable date', () => {
    expect(computeActivity([{ kind: 'receipt', level: 'low', when: 'not a date' }], NOW).total).toBe(0);
  });
  it('milestones are earned only from real history', () => {
    const none = computeActivity([], NOW);
    expect(MILESTONES.filter(m => m.earned(none))).toEqual([]);
    const some = computeActivity([ev(0), ev(1, 'message', 'critical'), ev(2)], NOW);
    expect(MILESTONES.filter(m => m.earned(some)).map(m => m.id)).toEqual(['first', 'both', 'caught', 'streak3']);
  });
});
