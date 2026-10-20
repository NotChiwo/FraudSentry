// V9.2 reports: period statistics, classification vs confirmed outcome,
// breakdowns, all-users reports, the plain-language description and CSV.
import { describe, it, expect } from 'vitest';
import { buildReport, reportStats, reportRows, reportToCsv, describeReport, reportsWithinRetention } from '../services/fraudReports';
import { EMPTY_USER_DATA, userDataToSave, type UserData } from '../store/useAppStore';
import { checkTransaction } from '../engine/transactionCheck';
import type { ImageScanResult, RiskLevel, TransactionStatus, MessageScanResult } from '../types';

const receipt = (id: string, day: string, risk: RiskLevel, status: TransactionStatus, source = 'GCash', amount = 1000, reasons: string[] = []): ImageScanResult => ({
  id, scannedAt: `2026-10-${day}T03:00:00.000Z`, riskLevel: risk, source, transactionType: 'Send Money', txStatus: status,
  classification: risk === 'high' || risk === 'critical' ? 'fraudulent' : 'legitimate',
  extracted: { amount, referenceNo: `ref-${id}` }, findings: reasons.map(l => ({ id: l, label: l, passed: false, weight: 0.3, severity: 'high', detail: '', category: 'text' })),
  forestAnalysis: { modelName: 'RF v2 · labelled receipts (40 rows)' },
} as unknown as ImageScanResult);

const data = (o: Partial<UserData>): UserData => ({ ...EMPTY_USER_DATA, ...o });
const owner = data({
  imageScans: [
    receipt('a', '02', 'critical', 'not-received', 'GCash', 5000, ['Hidden or Blocked-Out Details']),   // caught
    receipt('b', '05', 'high', 'received', 'BPI', 2500, ['Text Colour Consistency']),                   // false alarm
    receipt('c', '08', 'low', 'received'),                                                               // correct
    receipt('d', '09', 'medium', 'not-received', 'Maya', 800, ['Hidden or Blocked-Out Details']),       // missed
    receipt('e', '10', 'low', 'pending'),
    receipt('old', '01', 'critical', 'not-received'),                                                   // outside the period
  ],
  messageScans: [{ id: 'm', scannedAt: '2026-10-03T00:00:00Z', threatLevel: 'critical', platform: 'SMS', scamType: 'Phishing' } as unknown as MessageScanResult],
  alerts: [{ id: 'x', resultId: 'a', resultKind: 'receipt', userId: null, title: '', message: '', riskLevel: 'critical', status: 'unread', dateGenerated: '2026-10-02T03:00:00Z' }],
});

describe('report statistics', () => {
  const s = reportStats([{ username: 'owner', data: owner }], '2026-10-02', '2026-10-15');
  it('counts the period only', () => {
    expect(s.checks).toBe(6);
    expect(s.byKind).toEqual({ Receipt: 5, Message: 1, 'Cross-Evidence': 0, 'Typed details': 0 });
    expect([s.fraudulent, s.legitimate]).toEqual([3, 3]);
    expect(s.byRisk).toEqual({ low: 2, medium: 1, high: 1, critical: 2 });
    expect(s.outcomes).toEqual({ pending: 1, received: 2, 'not-received': 2 });
  });
  it('compares the classification with the confirmed outcome', () => {
    expect(s.agreement).toEqual({ confirmed: 4, tp: 1, fp: 1, tn: 1, fn: 1, accuracy: 0.5, precision: 0.5, recall: 0.5 });
    expect(s.amountFlagged).toBe(7500);
  });
  it('breaks down by app, type, warning sign and model', () => {
    expect(s.byApp[0]).toEqual({ app: 'GCash', checks: 3, fraudulent: 1, notReceived: 1 });
    expect(s.byType).toEqual([{ type: 'Send Money', checks: 5, fraudulent: 2 }]);
    expect(s.topReasons[0]).toEqual({ label: 'Hidden or Blocked-Out Details', count: 2 });
    expect(s.models).toEqual([{ name: 'RF v2 · labelled receipts (40 rows)', checks: 5 }]);
    expect(s.alerts).toEqual({ total: 1, unread: 1 });
  });
  it('describes the findings in plain words', () => {
    const d = describeReport(s);
    expect(d).toMatch(/^6 checks were made \(5 receipts, 0 typed transactions, 1 messages, 0 cross-evidence\)\. 3 \(50%\) were classified possibly fraudulent/);
    expect(d).toMatch(/confirmed the real outcome of 4 payments: the classification matched it in 2 \(50%\); 1 fake payment was caught, 1 missed, and 1 genuine payment was flagged/);
    expect(d).toMatch(/“Hidden or Blocked-Out Details” \(2×\)/);
    expect(describeReport(reportStats([{ username: 'o', data: EMPTY_USER_DATA }], '2026-10-01', '2026-10-31'))).toBe('No checks were made in this period.');
  });
});

describe('reports', () => {
  it('summary vs detailed; typed-details transactions included', () => {
    const t = checkTransaction({ institution: 'GCash', type: 'Send Money', amount: 1500, date: '2026-10-04', time: null, referenceNo: '12', senderName: null, receiverName: null, receiverContact: null }, [], new Date('2026-10-04T05:00:00Z'));
    const d = data({ ...owner, manualTransactions: [t] });
    const opts = { scope: 'me' as const, from: '2026-10-02', to: '2026-10-15', userId: 'u1', username: 'owner' };
    const sum = buildReport([{ username: 'owner', data: d }], { ...opts, type: 'summary' });
    expect(sum.rows).toBeUndefined();
    expect(sum.stats.byKind['Typed details']).toBe(1);
    expect(sum.title).toBe('Summary report · 2026-10-02 to 2026-10-15');
    const det = buildReport([{ username: 'owner', data: d }], { ...opts, type: 'detailed' });
    expect(det.rows).toHaveLength(7);
    expect(det.rows!.map(r => r.when)).toEqual([...det.rows!.map(r => r.when)].sort().reverse());
    const csv = reportToCsv(det).split('\n');
    expect(csv[0]).toBe('checked_at,kind,app_or_platform,type,amount,reference,risk_level,classification,outcome');
    expect(csv).toHaveLength(9);
  });
  it('an all-users report adds who made each check', () => {
    const cashier = data({ imageScans: [receipt('z', '06', 'high', 'not-received')] });
    const r = buildReport([{ username: 'owner', data: owner }, { username: 'cashier1', data: cashier }], { type: 'detailed', scope: 'all', from: '2026-10-02', to: '2026-10-15', userId: 'u1', username: 'owner' });
    expect(r.stats.users).toEqual([{ username: 'owner', checks: 6, fraudulent: 3 }, { username: 'cashier1', checks: 1, fraudulent: 1 }]);
    expect(reportRows([{ username: 'owner', data: owner }, { username: 'cashier1', data: cashier }], '2026-10-06', '2026-10-06')[0].user).toBe('cashier1');
    expect(reportToCsv(r).split('\n')[0].endsWith(',user')).toBe(true);
  });
  it('saved reports expire after 30 days with the history', () => {
    const r = buildReport([{ username: 'o', data: owner }], { type: 'summary', scope: 'me', from: '2026-10-01', to: '2026-10-31', userId: null, username: 'o' }, new Date('2026-10-01T00:00:00Z'));
    expect(reportsWithinRetention([r], 30, Date.parse('2026-10-20T00:00:00Z'))).toHaveLength(1);
    expect(reportsWithinRetention([r], 30, Date.parse('2026-11-05T00:00:00Z'))).toHaveLength(0);
    expect(userDataToSave({ ...EMPTY_USER_DATA, reports: [r] }, Date.parse('2026-11-05T00:00:00Z')).reports).toEqual([]);
  });
});
