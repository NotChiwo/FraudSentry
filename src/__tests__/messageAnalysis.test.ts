import { describe, it, expect } from 'vitest';
import { analyzeMessageText, correlateEvidence, assessLinkage } from '../engine/messageAnalysis';
import type { ImageScanResult, ExtractedTransactionData, RiskLevel } from '../types';

describe('PH scam patterns', () => {
  it('parcel / customs-fee scam', () => {
    const r = analyzeMessageText('LBC: Your parcel is on hold. Pay the customs clearance fee of P150 to release it: lbc-ph.top/pay');
    expect(r.scamType).toBe('Parcel Scam');
    expect(['high', 'critical']).toContain(r.threatLevel);
  });
  it('wrong-send refund scam (Taglish)', () => {
    const r = analyzeMessageText('Hi po, na-send ko po sa inyo yung 2,000 by mistake. Wrong send po, paki balik na lang sa 09171234567 salamat');
    expect(r.flags.some(f => /money mule/.test(f.reason))).toBe(true);
    expect(r.scamType).toBe('Wrong-Send Refund Scam');
  });
  it('task-job deposit scam', () => {
    const r = analyzeMessageText('Online job! Earn ₱800 daily doing simple tasks. Just pay the activation fee first to unlock your task commission.');
    expect(r.scamType).toBe('Job Offer Scam');
    expect(['high', 'critical']).toContain(r.threatLevel);
  });
  it('OTP request is at least high risk', () => {
    const r = analyzeMessageText('GCash Advisory: please send the OTP you received to verify your account or it will be suspended.');
    expect(['high', 'critical']).toContain(r.threatLevel);
    expect(r.scamType).toBe('OTP Scam');
  });
  it('"send the OTP" (verb before OTP) is caught', () => {
    const r = analyzeMessageText('Hello po, pakisend po ang OTP na natanggap mo para ma-verify ang order.');
    expect(r.scamType).toBe('OTP Scam');
    expect(['high', 'critical']).toContain(r.threatLevel);
  });
  it('a legitimate "never share your OTP" bank warning is NOT treated as an OTP request', () => {
    for (const t of [
      'Your GCash OTP is 482913. Never share it with anyone, including GCash employees.',
      'BPI: Do not share your OTP with anyone. BPI will never ask for it.',
      'Paalala: Huwag ibigay ang OTP sa kahit sino.',
    ]) {
      const r = analyzeMessageText(t);
      expect(r.flags.some(f => f.weight >= 0.4), t).toBe(false);
      expect(['low', 'medium'], t).toContain(r.threatLevel);
    }
  });
  it('bare-domain links (no http/www) are inspected', () => {
    const r = analyzeMessageText('Your package is held. Settle the fee here: lbc-ph.top/pay');
    expect(r.links.map(l => l.url)).toContain('lbc-ph.top/pay');
  });
  it('an ordinary bare domain mention is not flagged as a link', () => {
    const r = analyzeMessageText('GCash user here, I saw your item on shopee.ph, still available?');
    expect(r.links).toHaveLength(0);
  });
  it('a critical-severity flag never yields an overall "low"/"medium" verdict', () => {
    const r = analyzeMessageText('Please install AnyDesk so I can fix your account.');
    expect(['high', 'critical']).toContain(r.threatLevel);
  });
  it('ordinary chat stays low risk', () => {
    const r = analyzeMessageText('Hi! Is the bike still available? I can pick it up Saturday afternoon.');
    expect(r.threatLevel).toBe('low');
    expect(r.flags).toHaveLength(0);
  });
  it('too-short input is not scored', () => {
    const r = analyzeMessageText('ok');
    expect(r.riskScore).toBe(0);
    expect(r.observations).toHaveLength(0);
  });
});

describe('context observations', () => {
  it('payment-confirmation text is flagged as not proof on its own', () => {
    const r = analyzeMessageText('You have sent PHP 500.00 to JUAN D. Ref No. 1234567890123. Thank you for using GCash!');
    expect(r.observations.some(o => /does not prove a real transfer/.test(o))).toBe(true);
  });
  it('forwarded "official" notice is flagged', () => {
    const r = analyzeMessageText('BPI Official Advisory: Your account needs updating. Contact customer service today.');
    expect(r.observations.some(o => /official bank or e-wallet notice/.test(o))).toBe(true);
  });
});

// ── Cross-evidence linkage ──────────────────────────────────
function tx(e: Partial<ExtractedTransactionData>, riskLevel: RiskLevel = 'low', riskScore = 0.1): ImageScanResult {
  return {
    id: 't', filename: 'r.jpg', fileSize: 1, fileType: 'image/jpeg', source: 'GCash',
    riskScore, riskLevel, legitimacyLabel: '', confidence: 80,
    ocr: { text: '', confidence: 90, pass: 'original', wordCount: 40, engine: 'test', durationMs: 0, available: true },
    forensics: { width: 1, height: 1, aspectRatio: '1:1', fileSizeBytes: 1, declaredType: 'image/jpeg', sniffType: 'image/jpeg', hasExif: false, editorSoftware: null, jpegProgressive: null, elaScore: 0, elaHotspotPct: 0, elaThumbnail: null, signals: [] },
    extracted: { senderName: null, receiverName: null, receiverContact: null, amount: null, date: null, time: null, referenceNo: null, transactionId: null, institution: 'GCash', ...e },
    findings: [], recommendedAction: '', scannedAt: new Date().toISOString(),
  };
}

describe('receipt ↔ conversation linkage', () => {
  it('matching reference + amount → linked', () => {
    const r = correlateEvidence(tx({ referenceNo: '4045516855953', amount: 160 }),
      analyzeMessageText('Bayad na po! ₱160 sent. Ref No. 4045516855953'));
    expect(r.linkage).toBe('linked');
  });
  it('same reference but different amount → contradictory ("paid small, claimed large")', () => {
    const r = correlateEvidence(tx({ referenceNo: '4045516855953', amount: 160 }),
      analyzeMessageText('I sent you ₱1,600 already, ref no 4045516855953. Please ship now.'));
    expect(r.linkage).toBe('contradictory');
    expect(r.combinedRiskLevel).toBe('critical');
    expect(r.rationale.join(' ')).toMatch(/paid small, claimed large/);
  });
  it('different reference numbers → unrelated evidence', () => {
    const r = correlateEvidence(tx({ referenceNo: '4045516855953', amount: 160 }),
      analyzeMessageText('Here is proof, ref no 9999999999999 for the ₱160'));
    expect(r.linkage).toBe('unrelated');
    expect(r.verdict).toMatch(/Unrelated Evidence/);
  });
  it('one misread OCR digit in a long reference still links', () => {
    const r = correlateEvidence(tx({ referenceNo: '4045516855958', amount: 160 }),   // last digit misread
      analyzeMessageText('Sent ₱160, ref no 4045516855953'));
    expect(r.linkage).toBe('linked');
  });
  it('masked receipt number matches on its visible last 4 digits', () => {
    const r = assessLinkage(tx({ receiverContact: '+63 9•••••4290' }),
      analyzeMessageText('Send to my GCash 0997 966 4290 po'));
    expect(r.comparison.find(c => c.key === 'receiverContact')!.state).toBe('match');
    expect(r.linkage).toBe('linked');
  });
  it('"to you" / "to confirm" are not treated as recipient names (no false contradiction)', () => {
    const r = correlateEvidence(tx({ referenceNo: '4045516855953', amount: 160, receiverName: 'MARIA SANTOS' }),
      analyzeMessageText('I already sent ₱160 to you, ref no 4045516855953. Just want to confirm'));
    expect(r.linkage).toBe('linked');
    expect(r.combinedRiskLevel).not.toBe('critical');
  });
  it('a genuine name mismatch is shown but never decides the verdict on its own', () => {
    const r = correlateEvidence(tx({ referenceNo: '4045516855953', amount: 160, receiverName: 'MARIA SANTOS' }),
      analyzeMessageText('Paid ₱160 to Joy, ref no 4045516855953'));
    expect(r.fieldComparison!.find(c => c.key === 'receiverName')!.state).toBe('conflict');
    expect(r.linkage).toBe('linked');
  });
  it('nothing comparable → insufficient', () => {
    const r = correlateEvidence(tx({}), analyzeMessageText('Hello, is this still available?'));
    expect(r.linkage).toBe('insufficient');
  });
  it('clean receipt + scam conversation → high-risk context', () => {
    const r = correlateEvidence(tx({ referenceNo: '4045516855953', amount: 160 }),
      analyzeMessageText('Congratulations you have won! Claim your prize, just pay the processing fee. Send the OTP code you receive to verify. Ref no 4045516855953 ₱160'));
    expect(['high', 'critical']).toContain(r.combinedRiskLevel);
  });
});
