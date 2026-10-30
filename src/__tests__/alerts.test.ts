// Alerts (thesis §9.5.1): risky checks generate an ALERT record (ERD fields),
// with read/unread status and a history that follows the checks it belongs to.
import { describe, it, expect, beforeEach } from 'vitest';
import { alertForReceipt, alertForMessage, alertForCross, withAlert, unreadCount, MAX_ALERTS, type FraudAlert } from '../services/alerts';
import { useAppStore, HISTORY_RETENTION_DAYS, userDataToSave, userDataFromSaved, type UserData } from '../store/useAppStore';
import type { ImageScanResult, MessageScanResult, CrossEvidenceResult, RiskLevel, VerificationFinding } from '../types';

const NOW = '2026-10-20T08:00:00.000Z';
const finding = (label: string, severity: RiskLevel, weight: number, passed = false): VerificationFinding =>
  ({ id: label, category: 'integrity', label, detail: '', severity, passed, weight });

function receipt(id: string, riskLevel: RiskLevel, scannedAt = NOW): ImageScanResult {
  return {
    id, riskLevel, scannedAt, source: 'BPI', riskScore: 0.6,
    extracted: { amount: 15000, referenceNo: '1814193089365' },
    findings: [finding('Reference Present', 'low', 0.1, true), finding('Weekday Matches Date', 'high', 0.45), finding('Amount Formatting', 'high', 0.5), finding('Minor note', 'medium', 0.2)],
  } as unknown as ImageScanResult;
}
function message(id: string, threatLevel: RiskLevel): MessageScanResult {
  return {
    id, threatLevel, scannedAt: NOW, platform: 'SMS', scamType: 'Phishing',
    flags: [{ reason: 'Asks for your OTP.', severity: 'critical' }], links: [{ reason: 'Fake GCash domain.', severity: 'high' }],
  } as unknown as MessageScanResult;
}
function cross(id: string, combinedRiskLevel: RiskLevel): CrossEvidenceResult {
  return { id, combinedRiskLevel, transactionRiskLevel: 'high', conversationRiskLevel: 'low', verdict: 'Receipt and chat disagree', rationale: ['The amount in the chat is not the amount on the receipt.'], scannedAt: NOW } as CrossEvidenceResult;
}

describe('generating an alert', () => {
  it('a High receipt gives an alert with the ERD fields, unread, dated when the check ran', () => {
    const a = alertForReceipt(receipt('scan-1', 'high'))!;
    expect(a).toMatchObject({ id: 'alert-scan-1', resultId: 'scan-1', resultKind: 'receipt', riskLevel: 'high', status: 'unread', dateGenerated: NOW, title: 'Suspicious receipt' });
    expect(Object.keys(a).sort()).toEqual(['dateGenerated', 'id', 'message', 'resultId', 'resultKind', 'riskLevel', 'status', 'title']);
  });
  it('the message names the receipt and its strongest failed checks, then what to do', () => {
    const m = alertForReceipt(receipt('scan-1', 'critical'))!.message;
    expect(m).toMatch(/^BPI receipt for ₱15,000\.00 \(ref 1814193089365\)\. Main reasons: Amount Formatting; Weekday Matches Date\. Do not release/);
    expect(m).not.toMatch(/Reference Present|Minor note/);
  });
  it('follows the alert level: Low never, Medium only when asked, Critical-only skips High', () => {
    expect(alertForReceipt(receipt('a', 'low'), 'medium')).toBeNull();
    expect(alertForReceipt(receipt('a', 'medium'))).toBeNull();
    expect(alertForReceipt(receipt('a', 'medium'), 'medium')).not.toBeNull();
    expect(alertForReceipt(receipt('a', 'high'), 'critical')).toBeNull();
    expect(alertForReceipt(receipt('a', 'critical'), 'critical')).not.toBeNull();
  });
  it('messages and cross-evidence results get their own wording', () => {
    const m = alertForMessage(message('msg-1', 'critical'))!;
    expect(m.title).toBe('Possible Phishing (SMS)');
    expect(m.message).toMatch(/^2 warning signs found\. Main sign: Asks for your OTP\. Do not reply/);
    const c = alertForCross(cross('x-1', 'high'))!;
    expect(c).toMatchObject({ resultKind: 'cross', title: 'Receipt and chat disagree' });
    expect(c.message).toMatch(/^The amount in the chat/);
  });
  it('one alert per check, newest first, capped', () => {
    let list: FraudAlert[] = [];
    for (let i = 0; i < MAX_ALERTS + 5; i++) list = withAlert(list, alertForReceipt(receipt(`s${i}`, 'high')));
    list = withAlert(list, alertForReceipt(receipt('s3', 'critical')));
    expect(list).toHaveLength(MAX_ALERTS);
    expect(list[0]).toMatchObject({ resultId: 's3', riskLevel: 'critical' });
    expect(list.filter(a => a.resultId === 's3')).toHaveLength(1);
    expect(unreadCount(list)).toBe(MAX_ALERTS);
  });
});

describe('alerts in the store', () => {
  const st = () => useAppStore.getState();
  beforeEach(() => { st().clearHistory(); st().setAlertLevel('high'); });

  it('saving a risky check creates its alert; a clean one does not', () => {
    st().addImageScan(receipt('r-high', 'high'));
    st().addImageScan(receipt('r-low', 'low'));
    st().addMessageScan(message('m-crit', 'critical'));
    expect(st().alerts.map(a => a.resultId)).toEqual(['m-crit', 'r-high']);
  });
  it('the alert level setting applies to new checks', () => {
    st().setAlertLevel('medium');
    st().addImageScan(receipt('r-med', 'medium'));
    expect(st().alerts.map(a => a.resultId)).toEqual(['r-med']);
  });
  it('read / unread, mark all read, delete one', () => {
    st().addImageScan(receipt('r1', 'high')); st().addImageScan(receipt('r2', 'critical'));
    st().setAlertStatus('alert-r1', 'read');
    expect(st().alerts.find(a => a.id === 'alert-r1')!.status).toBe('read');
    st().setAlertStatus('alert-r1', 'unread');
    expect(unreadCount(st().alerts)).toBe(2);
    st().markAllAlertsRead();
    expect(unreadCount(st().alerts)).toBe(0);
    st().removeAlert('alert-r2');
    expect(st().alerts.map(a => a.id)).toEqual(['alert-r1']);
    expect(st().imageScans).toHaveLength(2);     // deleting an alert keeps the check
  });
  it('deleting a check deletes its alert; clearing history clears all alerts', () => {
    st().addImageScan(receipt('r1', 'high')); st().addMessageScan(message('m1', 'high'));
    st().removeImageScan('r1');
    expect(st().alerts.map(a => a.resultId)).toEqual(['m1']);
    st().clearHistory();
    expect(st().alerts).toEqual([]);
  });
  it('a check pushed out of the 40-item history takes its alert with it', () => {
    st().addImageScan(receipt('old', 'high'));
    for (let i = 0; i < 40; i++) st().addImageScan(receipt(`n${i}`, 'low'));
    expect(st().alerts).toEqual([]);
  });
  it('a Cross-Evidence run saves three records but raises one alert', () => {
    st().addCrossEvidence(receipt('cx-r', 'critical'), message('cx-m', 'critical'), cross('cx', 'critical'));
    expect(st().imageScans.map(s => s.id)).toEqual(['cx-r']);
    expect(st().messageScans.map(s => s.id)).toEqual(['cx-m']);
    expect(st().alerts.map(a => a.resultId)).toEqual(['cx']);
  });
  it('saving and reopening keeps alerts of kept checks (with their status) and drops expired ones', () => {
    const old = new Date(Date.now() - (HISTORY_RETENTION_DAYS + 1) * 864e5).toISOString();
    const fresh = new Date().toISOString();
    st().addImageScan(receipt('expired', 'high', old));
    st().addImageScan(receipt('kept', 'high', fresh));
    st().setAlertStatus('alert-kept', 'read');
    // what goes into the user's encrypted vault
    const saved = JSON.parse(JSON.stringify(userDataToSave(st()))) as UserData;
    expect(saved.alerts.map(a => a.resultId)).toEqual(['kept']);
    expect(saved.alertLevel).toBe('high');
    // reopened: the saved alerts come back; an alert whose check expired meanwhile is dropped
    const reopened = userDataFromSaved({ ...saved, alerts: [...saved.alerts, { ...saved.alerts[0], id: 'alert-expired', resultId: 'expired' }] });
    expect(reopened.alerts.map(a => [a.resultId, a.status])).toEqual([['kept', 'read']]);
    // older saved data (before V8.7) has no alerts: none, and the default level
    const before = userDataFromSaved({ imageScans: [] });
    expect([before.alerts, before.alertLevel]).toEqual([[], 'high']);
  });
  it('history is saved on the device and loaded back; history parked by V9.0–V10.0 comes back too', () => {
    const opts = useAppStore.persist.getOptions();
    const fresh = new Date().toISOString();
    const persisted = opts.partialize!({ ...st(), imageScans: [receipt('x', 'high', fresh)], alerts: [] }) as Record<string, unknown>;
    expect((persisted.imageScans as { id: string }[]).map(s => s.id)).toEqual(['x']);
    const merged = opts.merge!({ hasConsented: true, imageScans: [receipt('v8', 'high', fresh)], alerts: [] }, st());
    expect(merged.imageScans.map(s => s.id)).toEqual(['v8']);
    const parked = opts.merge!({ hasConsented: true, legacyUserData: { imageScans: [receipt('v9', 'high', fresh)] } }, st());
    expect(parked.imageScans.map(s => s.id)).toEqual(['v9']);
  });
});
