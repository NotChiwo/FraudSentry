// Transaction Audit Dashboard (V10.3): the simulated stream is run through the
// real checks, so injected anomalies are flagged by those checks; the feed
// merges real and simulated events and filters them for flagged anomalies.
import { describe, it, expect } from 'vitest';
import { createSimulator, type SimEvent } from '../audit/simulator';
import { buildFeed, filterEvents, auditStats, eventFromRecord, DEFAULT_FILTER, phDate } from '../audit/auditFeed';
import type { ImageScanResult } from '../shared/types';

const clock = (() => { let t = Date.parse('2026-11-19T02:00:00Z'); return () => new Date((t += 2000)); });
const run = (n: number, seed = 42) => { const sim = createSimulator(seed, clock()); return Array.from({ length: n }, () => sim.next()); };

describe('simulated incoming transactions', () => {
  const events = run(600);

  it('is reproducible for the same seed', () => {
    const sig = (e: SimEvent) => [e.kind, e.scenario, e.kind === 'transaction' ? e.record.riskLevel : e.record.threatLevel];
    const a = run(50, 7).map(sig);
    const b = run(50, 7).map(sig);
    expect(a).toEqual(b);
  });

  it('covers many banks and e-wallets, not only GCash', () => {
    const apps = new Set(events.filter(e => e.kind === 'transaction').map(e => (e.record as never as { input: { institution: string } }).input.institution));
    expect(apps.size).toBeGreaterThanOrEqual(15);
  });

  it('injected anomalies are flagged by the real checks; normal payments are not', () => {
    const level = (e: SimEvent) => (e.kind === 'transaction' ? e.record.riskLevel : e.record.threatLevel);
    const flagged = (e: SimEvent) => level(e) !== 'low';
    const fraudulent = (e: SimEvent) => ['high', 'critical'].includes(level(e));
    const by = (s: string) => events.filter(e => e.scenario === s);
    // no reference alone is a weak sign (many people send details without one): Low, with the failed finding listed
    expect(by('missing-reference').length).toBeGreaterThan(0);
    expect(by('missing-reference').every(e => e.kind === 'transaction' && e.record.findings.some(f => f.label === 'Reference Number' && !f.passed))).toBe(true);
    for (const s of ['future-date', 'malformed-reference', 'edited-copy', 'reused-receipt']) {
      expect(by(s).length, s).toBeGreaterThan(0);
      expect(by(s).every(flagged), s).toBe(true);
    }
    expect(by('normal').filter(flagged)).toEqual([]);
    expect(by('ordinary-message').filter(flagged)).toEqual([]);
    // a future date and an edited copy are possibly fraudulent (High+); a malformed or missing reference is an anomaly to verify (Medium)
    expect(by('future-date').every(fraudulent) && by('edited-copy').every(fraudulent)).toBe(true);
    expect(by('scam-message').filter(fraudulent).length / by('scam-message').length).toBeGreaterThan(0.8);
  });

  it('a reused reference is caught by the earlier-check comparison', () => {
    const reused = events.filter(e => e.scenario === 'edited-copy');
    expect(reused.every(e => e.kind === 'transaction' && e.record.findings.some(f => f.label === 'Earlier Check Comparison' && !f.passed))).toBe(true);
  });
});

describe('the audit feed', () => {
  const sim = run(80);
  const real = { id: 'real-1', scannedAt: '2026-11-19T05:00:00.000Z', riskLevel: 'critical', riskScore: 0.8, source: 'GoTyme',
    findings: [{ id: 'h', category: 'text', label: 'Headline Amount Matches Details', detail: '', severity: 'critical', passed: false, weight: 0.55 }],
    extracted: { amount: 200, referenceNo: 'ITO1', receiverName: 'DUDS', receiverContact: null } } as unknown as ImageScanResult;
  const feed = buildFeed({ imageScans: [real], messageScans: [], crossChecks: [], manualTransactions: [] }, sim);

  it('merges real checks and simulated events, newest first, and labels them', () => {
    expect(feed).toHaveLength(81);
    expect(feed.map(e => e.at)).toEqual([...feed.map(e => e.at)].sort().reverse());
    expect(feed.find(e => e.id === 'real-1')).toMatchObject({ simulated: false, flagged: true, fraudulent: true, fraudTypes: ['Pasted headline amount'], mainReason: 'Headline Amount Matches Details', app: 'GoTyme' });
    expect(feed.filter(e => e.simulated)).toHaveLength(80);
  });

  it('filters for flagged anomalies, by source, app, fraud type, risk and search', () => {
    const flagged = filterEvents(feed, { ...DEFAULT_FILTER, flaggedOnly: true });
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every(e => e.flagged)).toBe(true);
    expect(filterEvents(feed, { ...DEFAULT_FILTER, source: 'real' }).map(e => e.id)).toEqual(['real-1']);
    expect(filterEvents(feed, { ...DEFAULT_FILTER, fraudType: 'Pasted headline amount' }).map(e => e.id)).toEqual(['real-1']);
    expect(filterEvents(feed, { ...DEFAULT_FILTER, levels: ['critical'] }).every(e => e.riskLevel === 'critical')).toBe(true);
    expect(filterEvents(feed, { ...DEFAULT_FILTER, q: 'duds' }).map(e => e.id)).toEqual(['real-1']);
    const app = feed.find(e => e.simulated && e.kind === 'transaction')!.app;
    expect(filterEvents(feed, { ...DEFAULT_FILTER, app }).every(e => e.app === app)).toBe(true);
  });

  it('filters by Philippine date', () => {
    expect(phDate('2026-11-18T17:00:00.000Z')).toBe('2026-11-19');   // 1 AM in Manila
    expect(filterEvents(feed, { ...DEFAULT_FILTER, from: '2026-11-20' })).toEqual([]);
  });

  it('summarises the stream: totals, flag rate, flagged fraud types and apps', () => {
    const s = auditStats(feed);
    expect(s.total).toBe(81);
    expect([s.real, s.simulated]).toEqual([1, 80]);
    expect(s.flagRate).toBeCloseTo(s.flagged / 81, 10);
    expect(s.byType.find(t => t.type === 'Pasted headline amount')?.count).toBe(1);
    expect(s.byApp.reduce((a, x) => a + x.total, 0)).toBe(feed.filter(e => e.kind === 'transaction' || e.kind === 'receipt').length);
  });

  it('a message event takes its scam type as the main reason', () => {
    const m = sim.find(e => e.scenario === 'scam-message')!;
    expect(eventFromRecord('message', m.record, true).mainReason).toBe((m.record as never as { scamType: string }).scamType);
  });
});
