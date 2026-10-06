// ============================================================
// FraudSentry — on-device activity numbers for the Home page
//
// Every value is computed from the scan history stored in this browser
// (localStorage). Nothing is sent anywhere and nothing is estimated: with
// no history, every number is zero.
// ============================================================

import type { RiskLevel } from '../types';

export interface ActivityEvent { kind: 'receipt' | 'message'; level: RiskLevel; when: string }

export interface Activity {
  total: number;
  receipts: number;
  messages: number;
  /** checks in the last 7 days, including today */
  last7: number;
  /** high + critical results */
  risky: number;
  /** consecutive local days with at least one check, ending today (or yesterday) */
  streak: number;
  /** distinct local days with at least one check */
  activeDays: number;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function computeActivity(events: ActivityEvent[], now: Date): Activity {
  const valid = events.filter(e => !isNaN(Date.parse(e.when)));
  const days = new Set(valid.map(e => dayKey(new Date(e.when))));
  const weekAgo = new Date(now); weekAgo.setHours(0, 0, 0, 0); weekAgo.setDate(weekAgo.getDate() - 6);

  let streak = 0;
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);   // today not checked yet: streak can still end yesterday
  while (days.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }

  return {
    total: valid.length,
    receipts: valid.filter(e => e.kind === 'receipt').length,
    messages: valid.filter(e => e.kind === 'message').length,
    last7: valid.filter(e => { const t = new Date(e.when); return t >= weekAgo && t <= now; }).length,
    risky: valid.filter(e => e.level === 'high' || e.level === 'critical').length,
    streak,
    activeDays: days.size,
  };
}

export interface Milestone { id: string; label: string; hint: string; earned: (a: Activity) => boolean }

/** Small, honest milestones — each is a plain fact about the user's own history. */
export const MILESTONES: Milestone[] = [
  { id: 'first', label: 'First check', hint: 'Run your first check', earned: a => a.total >= 1 },
  { id: 'both', label: 'Receipt + message', hint: 'Check at least one receipt and one message', earned: a => a.receipts >= 1 && a.messages >= 1 },
  { id: 'ten', label: '10 checks', hint: 'Run 10 checks', earned: a => a.total >= 10 },
  { id: 'caught', label: 'Spotted a risky one', hint: 'Get a high or critical result', earned: a => a.risky >= 1 },
  { id: 'streak3', label: '3-day streak', hint: 'Check something 3 days in a row', earned: a => a.streak >= 3 },
];
