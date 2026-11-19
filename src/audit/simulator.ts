// ============================================================
// FraudSentry — simulated incoming transactions (Audit Dashboard)
//
// Generates a stream of realistic incoming payments and messages for the
// Transaction Audit Dashboard, so the live feed and its anomaly filters can
// be shown and tested without waiting for real checks.
//
// Nothing here is a canned result: every simulated payment is run through the
// SAME rule checks as a transaction typed on the Transactions page
// (checkTransaction: reference format, real / not-future date, reuse of an
// earlier reference), and every simulated message through the same message
// analyzer (analyzeMessageText). About a quarter of the payments carry an
// injected anomaly (a scenario), so the checks have something to flag.
// The records are labelled SIMULATED and are never saved to the database.
// Seeded (mulberry32), so a run is reproducible. Names and numbers are made up.
// ============================================================

import { makeRng } from '../random-forest/randomForest';
import { checkTransaction, toExtracted, type ManualTransaction, type TransactionInput } from '../transactions/transactionCheck';
import { analyzeMessageText } from '../message-check/messageAnalysis';
import type { PriorScan } from '../receipt-check/checks/historyMatch';
import type { EvidenceSource, MessageScanResult } from '../shared/types';
import type { TransactionType } from '../receipt-check/reading/receiptParser';

export type Scenario =
  | 'normal' | 'future-date' | 'malformed-reference' | 'missing-reference'
  | 'edited-copy' | 'reused-receipt' | 'scam-message' | 'ordinary-message';

export const SCENARIO_LABEL: Record<Scenario, string> = {
  normal: 'Normal payment', 'future-date': 'Dated in the future',
  'malformed-reference': 'Malformed reference', 'missing-reference': 'No reference given',
  'edited-copy': 'Earlier reference, new amount', 'reused-receipt': 'Earlier reference reused',
  'scam-message': 'Scam message', 'ordinary-message': 'Ordinary message',
};

export type SimEvent =
  | { kind: 'transaction'; scenario: Scenario; record: ManualTransaction }
  | { kind: 'message'; scenario: Scenario; record: MessageScanResult };

// How often each app appears (GCash and Maya most, as in real PH traffic), and
// every other bank / e-wallet the reader supports.
const APPS: [EvidenceSource, number][] = [
  ['GCash', 24], ['Maya', 14], ['GoTyme', 7], ['BPI', 7], ['BDO', 7], ['UnionBank', 5], ['MariBank', 5],
  ['Landbank', 4], ['Metrobank', 4], ['ShopeePay', 4], ['Security Bank', 3], ['RCBC', 3], ['GrabPay', 3],
  ['PNB', 2], ['Chinabank', 2], ['Coins.ph', 2], ['PalawanPay', 2], ['Tonik', 2], ['CIMB', 2],
];
const FIRST = ['Juan', 'Maria', 'Jose', 'Ana', 'Pedro', 'Liza', 'Carlo', 'Grace', 'Ramon', 'Bea', 'Tony', 'Nina', 'Rico', 'Diana', 'Paolo', 'Kim'];
const LAST = ['Dela Cruz', 'Santos', 'Reyes', 'Garcia', 'Bautista', 'Morales', 'Lim', 'Tan', 'Cruz', 'Diaz', 'Ong', 'Sy', 'Arce', 'Lopez'];

const SCAM_MESSAGES = [
  'Your GCash account has been suspended due to unusual activity. Verify now at http://gcash-verify-ph.xyz/login and reply with the OTP we sent.',
  'Good day! You have a pending parcel. Pay the P150 customs fee at bit.ly/ph-parcel-fee within 24 hours or it will be returned.',
  'Hi po, I accidentally sent you P5,000. Please send it back to this number 0917 555 0142, salamat po.',
  'Earn P1,500 a day liking videos from home! Message us on Telegram to get your first task. Limited slots.',
  'BDO: Your account is locked. Click this link to update your details: http://bdo-online-support.top/verify',
  'Congratulations! You won P50,000 in the Maya raffle. Send P500 processing fee to claim your prize.',
];
const ORDINARY_MESSAGES = [
  'Sent na po yung bayad, pa-check na lang po. Salamat!',
  'Hi, available pa po ba yung item? Pick up na lang po bukas.',
  'Thank you for your order! It will be shipped tomorrow morning.',
  'Payment received, salamat po. Ingat!',
];

export interface Simulator {
  next(): SimEvent;
  /** how many events have been generated */
  readonly count: number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function createSimulator(seed = 42, clock: () => Date = () => new Date()): Simulator {
  const rng = makeRng(seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rng() * a.length)];
  const weighted = <T,>(a: [T, number][]) => { let r = rng() * a.reduce((s, [, w]) => s + w, 0); for (const [v, w] of a) { if ((r -= w) < 0) return v; } return a[a.length - 1][0]; };
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rng() * 10)).join('');
  const alnum = (n: number) => Array.from({ length: n }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(rng() * 34)]).join('');
  const reference = (app: EvidenceSource) =>
    app === 'GCash' ? digits(13) : app === 'MariBank' ? digits(12) : app === 'Maya' ? alnum(12)
    : app === 'GoTyme' ? 'ITO' + digits(15) : alnum(3) + digits(10);
  const typeFor = (app: EvidenceSource): TransactionType =>
    ['GCash', 'Maya', 'ShopeePay', 'GrabPay', 'Coins.ph', 'PalawanPay'].includes(app) ? 'Send Money' : 'Bank Transfer';

  // A normal payment never reuses a recent recipient: the same recipient at the
  // same minute is itself an anomaly the checks flag ("same moment").
  const recent: string[] = [];
  const freshRecipient = () => {
    let name = '';
    do name = `${pick(FIRST)} ${'ABCDEFGHJKLMNPRSTV'[Math.floor(rng() * 18)]}. ${pick(LAST)}`; while (recent.includes(name));
    recent.push(name); if (recent.length > 120) recent.shift();
    return name;
  };
  const history: PriorScan[] = [];
  const sent: TransactionInput[] = [];
  let count = 0;

  const transaction = (scenario: Scenario): SimEvent => {
    const now = clock();
    let app = weighted(APPS);
    if (scenario === 'malformed-reference') app = pick(['GCash', 'MariBank'] as EvidenceSource[]);   // apps with a known reference shape
    const earlier = sent.length ? pick(sent) : null;
    let input: TransactionInput = {
      institution: app, type: typeFor(app), amount: Math.round((50 + rng() * 9950) / 10) * 10,
      date: ymd(now), time: hm(now), referenceNo: reference(app),
      senderName: `${pick(FIRST)} ${pick(LAST)}`, receiverName: freshRecipient(), receiverContact: null,
    };
    if (scenario === 'future-date') { const d = new Date(now.getTime() + (2 + Math.floor(rng() * 5)) * 864e5); input = { ...input, date: ymd(d) }; }
    if (scenario === 'malformed-reference') input = { ...input, referenceNo: app === 'GCash' ? digits(9) + 'A' : 'X' + digits(4) };
    if (scenario === 'missing-reference') input = { ...input, referenceNo: null };
    if (scenario === 'edited-copy' && earlier) input = { ...earlier, amount: (earlier.amount ?? 100) * 10, date: ymd(now), time: hm(now) };
    if (scenario === 'reused-receipt' && earlier) input = { ...earlier };
    const t = checkTransaction(input, history, now);
    const record: ManualTransaction = { ...t, id: `sim-${++count}`, scannedAt: now.toISOString() };
    history.push({ id: record.id, filename: 'simulated', scannedAt: record.scannedAt, extracted: toExtracted(input) });
    if (history.length > 400) history.shift();
    if (scenario === 'normal') { sent.push(input); if (sent.length > 60) sent.shift(); }
    return { kind: 'transaction', scenario, record };
  };

  const message = (scam: boolean): SimEvent => {
    const r = analyzeMessageText(pick(scam ? SCAM_MESSAGES : ORDINARY_MESSAGES));
    return { kind: 'message', scenario: scam ? 'scam-message' : 'ordinary-message', record: { ...r, id: `sim-${++count}`, scannedAt: clock().toISOString() } };
  };

  return {
    next() {
      if (rng() < 0.18) return message(rng() < 0.6);
      const scenario = weighted<Scenario>([
        ['normal', 76], ['future-date', 4], ['malformed-reference', 5],
        ['missing-reference', 4], ['edited-copy', sent.length ? 6 : 0], ['reused-receipt', sent.length ? 5 : 0],
      ]);
      return transaction(scenario);
    },
    get count() { return count; },
  };
}
