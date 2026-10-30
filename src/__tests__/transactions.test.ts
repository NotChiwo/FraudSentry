// V9.1 transactions: checking typed details, the transaction type of a
// receipt, and the real outcome (did the money arrive?) — which also
// becomes the receipt's training label.
import { describe, it, expect, beforeEach } from 'vitest';
import { checkTransaction, toExtracted, type TransactionInput } from '../engine/transactionCheck';
import { transactionTypeOf } from '../services/receiptParser';
import { useAppStore } from '../store/useAppStore';
import type { ImageScanResult } from '../types';

const NOW = new Date('2026-10-20T08:00:00Z');
const base: TransactionInput = {
  institution: 'GCash', type: 'Send Money', amount: 1500, date: '2026-10-20', time: '09:15', referenceNo: '1016642566968',
  senderName: null, receiverName: 'Juan D.', receiverContact: '0917 000 0000',
};

describe('checking typed details', () => {
  it('consistent details: Low, legitimate, pending', () => {
    const t = checkTransaction(base, [], NOW);
    expect(t).toMatchObject({ riskLevel: 'low', classification: 'legitimate', txStatus: 'pending' });
    expect(t.findings.filter(f => !f.passed)).toEqual([]);
  });
  it('a reference that is not GCash-shaped, or none at all', () => {
    expect(checkTransaction({ ...base, referenceNo: '12345' }, [], NOW).findings.find(f => f.id === 'ref-format')).toMatchObject({ passed: false, severity: 'high' });
    expect(checkTransaction({ ...base, referenceNo: null }, [], NOW).findings.find(f => f.id === 'ref-present')?.passed).toBe(false);
  });
  it('a date in the future is at least High', () => {
    const t = checkTransaction({ ...base, date: '2026-10-25' }, [], NOW);
    expect(t.riskLevel === 'high' || t.riskLevel === 'critical').toBe(true);
    expect(t.classification).toBe('fraudulent');
  });
  it('the same reference with another amount (an edited copy) is caught from earlier checks', () => {
    const prior = checkTransaction(base, [], NOW);
    const hist = [{ id: prior.id, filename: 'typed details', scannedAt: prior.scannedAt, extracted: toExtracted(prior.input) }];
    const t = checkTransaction({ ...base, amount: 15000 }, hist, NOW);
    expect(t.findings.find(f => f.id === 'history')).toMatchObject({ passed: false, severity: 'critical' });
    expect(t.classification).toBe('fraudulent');
  });
});

describe('transaction type of a receipt', () => {
  it('reads the kind of payment from the wording', () => {
    expect(transactionTypeOf('Express Send\nSent via GCash')).toBe('Send Money');
    expect(transactionTypeOf('instaFay Instant\nTo Bebs')).toBe('Bank Transfer');
    expect(transactionTypeOf('Transfer to:\nJuan (QR Code)\nSAVINGS')).toBe('Bank Transfer');
    expect(transactionTypeOf('Purchased on\nSTEAMGAMES.COM')).toBe('Purchase');
    expect(transactionTypeOf('Bills Payment\nMERALCO')).toBe('Bill Payment');
    expect(transactionTypeOf('Cash In via 7-Eleven')).toBe('Cash In');
    expect(transactionTypeOf('Scan to Pay\nQR Ph')).toBe('QR Payment');
    expect(transactionTypeOf('Amount 3,398.30', 'GCash')).toBe('Send Money');
    expect(transactionTypeOf('Amount 3,398.30')).toBe('Other');
  });
});

describe('payment outcome', () => {
  const st = () => useAppStore.getState();
  const scan = { id: 'scan-o1', riskLevel: 'medium', scannedAt: new Date().toISOString(), source: 'GCash', extracted: {}, findings: [], heuristicScore: 0.3, scoreFloor: 0,
    forestAnalysis: { features: [5, 1, 0, 88, 1, 1, 1, 1, 1, 90] }, txStatus: 'pending' } as unknown as ImageScanResult;
  beforeEach(() => { st().clearHistory(); st().clearTrainingRows(); });

  it('"received" / "not received" on a receipt sets its training label; back to pending removes it', () => {
    st().addImageScan(scan);
    st().setTxStatus('receipt', scan.id, 'not-received');
    expect(st().imageScans[0].txStatus).toBe('not-received');
    expect(st().trainingRows).toMatchObject([{ id: scan.id, label: 1, ruleScore: 0.3 }]);
    st().setTxStatus('receipt', scan.id, 'received');
    expect(st().trainingRows.map(r => r.label)).toEqual([0]);
    st().setTxStatus('receipt', scan.id, 'pending');
    expect(st().trainingRows).toEqual([]);
  });
  it('typed-details transactions keep an outcome but never train the model; a risky one raises an alert', () => {
    const t = checkTransaction({ ...base, date: '2026-12-25' }, [], NOW);
    st().addManualTransaction(t);
    expect(st().alerts.map(a => [a.resultKind, a.resultId])).toEqual([['transaction', t.id]]);
    st().setTxStatus('manual', t.id, 'not-received');
    expect(st().manualTransactions[0].txStatus).toBe('not-received');
    expect(st().trainingRows).toEqual([]);
    st().removeManualTransaction(t.id);
    expect(st().alerts).toEqual([]);
  });
});
