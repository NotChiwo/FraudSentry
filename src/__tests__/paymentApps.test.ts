// Receipts from banks and e-wallets other than GCash. Most real receipts in
// the fixtures are GCash, so these are written in each app's usual layout and
// wording (labels, reference style, date style). They are NOT real receipts:
// names, numbers and references are made up. They check that the reader
// handles each layout; accuracy on real screenshots of these apps still needs
// real samples (see TESTING.md).
import { describe, it, expect } from 'vitest';
import { parseReceipt } from '../receipt-check/reading/receiptParser';
import { parseReceiptDate, checkHeadlineAmount } from '../receipt-check/checks/consistencyChecks';
import { checkTransaction } from '../transactions/transactionCheck';

type Want = { source: string; amount: number; ref: string; date: string; receiver?: string; contact?: string };
const CASES: Record<string, [string, Want]> = {
  'Maya send money': ['Sent money\n₱1,500.00\nSuccessfully sent to\nJUAN DELA CRUZ\n+63 917 ••• 4821\nAmount  ₱1,500.00\nReference ID  6262 1027 8803\nDate  Nov 18, 2026, 10:42 AM\nmaya',
    { source: 'Maya', amount: 1500, ref: '626210278803', date: 'Nov 18, 2026', receiver: 'JUAN DELA CRUZ', contact: '+63 9•••••4821' }],
  'Maya bank transfer (destination BDO)': ['Bank transfer\n₱2,000.00\nTransfer successful\nRecipient  MARIA SANTOS\nBank  BDO Unibank\nAccount number  ••••••••4410\nAmount  ₱2,000.00\nTransfer fee  ₱15.00\nTotal  ₱2,015.00\nReference ID  4CCD 2075 53B8\nNov 18, 2026, 2:15 PM\nmaya',
    { source: 'Maya', amount: 2000, ref: '4CCD207553B8', date: 'Nov 18, 2026', receiver: 'MARIA SANTOS', contact: '••••••••4410' }],
  BDO: ['BDO\nTransaction Successful\nSend Money\nTransfer Amount  PHP 3,000.00\nService Fee  PHP 0.00\nFrom  Savings ••••5521\nTo  PEDRO REYES\nGCash ••••••9932\nReference No.  2026111800123456\nNov 18, 2026 09:05 AM',
    { source: 'BDO', amount: 3000, ref: '2026111800123456', date: 'Nov 18, 2026', receiver: 'PEDRO REYES', contact: '••••••9932' }],
  UnionBank: ['UnionBank\nTransfer successful!\nYou sent\nPHP 750.00\nto ANA GARCIA\nVia InstaPay\nAmount  PHP 750.00\nFee  PHP 0.00\nReference Number  UB2026111800987\nTransaction Date  11/18/2026 03:30 PM',
    { source: 'UnionBank', amount: 750, ref: 'UB2026111800987', date: '11/18/2026', receiver: 'ANA GARCIA' }],
  Landbank: ['LANDBANK\nFund Transfer\nTransaction Successful\nAmount  PHP 5,000.00\nFee  PHP 25.00\nAccount Name  JOSE RIZAL\nTransaction Reference No.  LBP2611180045123\nDate/Time  18-Nov-2026 11:20:45 AM',
    { source: 'Landbank', amount: 5000, ref: 'LBP2611180045123', date: '18-Nov-2026', receiver: 'JOSE RIZAL' }],
  Metrobank: ['Metrobank\nTransfer Successful\nAmount  PHP 1,200.00\nTransferred to  LUZ VIMINDA\nBank  BPI\nReference No.  MBT8812345678\nNov 18, 2026 | 4:02 PM',
    { source: 'Metrobank', amount: 1200, ref: 'MBT8812345678', date: 'Nov 18, 2026', receiver: 'LUZ VIMINDA' }],
  'Security Bank': ['Security Bank\nTransfer Complete\nAmount PHP 900.00\nRecipient  CARLO BAUTISTA\nReference Number  SB2611180001234\n18 Nov 2026 01:11 PM',
    { source: 'Security Bank', amount: 900, ref: 'SB2611180001234', date: '18 Nov 2026', receiver: 'CARLO BAUTISTA' }],
  RCBC: ['RCBC Pulz\nSend Money Successful\nAmount  PHP 640.00\nSend to  LIZA MORALES\nReference No. 202611185500321\nNovember 18, 2026 7:45 PM',
    { source: 'RCBC', amount: 640, ref: '202611185500321', date: 'November 18, 2026', receiver: 'LIZA MORALES' }],
  PNB: ['PNB Digital\nFund Transfer Successful\nAmount  PHP 2,500.00\nBeneficiary  RAMON CRUZ\nReference No.  PNB0018112026A77\n11/18/2026 08:30 AM',
    { source: 'PNB', amount: 2500, ref: 'PNB0018112026A77', date: '11/18/2026', receiver: 'RAMON CRUZ' }],
  Chinabank: ['Chinabank\nTransfer Successful\nTransfer Amount PHP 4,200.00\nPayee  GRACE LIM\nConfirmation No.  CBC123456789012\nNov 18, 2026 12:00 PM',
    { source: 'Chinabank', amount: 4200, ref: 'CBC123456789012', date: 'Nov 18, 2026', receiver: 'GRACE LIM' }],
  'GrabPay (hyphenated reference)': ['GrabPay\nPayment Successful\nYou paid\n₱420.00\nto Mang Inasal\nAmount  ₱420.00\nReference No. A-7XK2P9QM\n18 Nov 2026, 12:41 PM',
    { source: 'GrabPay', amount: 420, ref: 'A-7XK2P9QM', date: '18 Nov 2026' }],
  'Coins.ph (hyphenated reference)': ['Coins.ph\nSent\nPHP 1,000.00\nRecipient  NINA TAN\nGCash 09•••••7712\nReference No.  CPH-88124590\nNov 18, 2026 5:10 PM',
    { source: 'Coins.ph', amount: 1000, ref: 'CPH-88124590', date: 'Nov 18, 2026', receiver: 'NINA TAN', contact: '+63 9•••••7712' }],
  PalawanPay: ['PalawanPay\nSend Money Successful\nAmount  ₱800.00\nSent to  TONY ARCE\nReference No.  PP2611187654321\nNov 18, 2026 3:33 PM',
    { source: 'PalawanPay', amount: 800, ref: 'PP2611187654321', date: 'Nov 18, 2026', receiver: 'TONY ARCE' }],
  Tonik: ['Tonik\nTransfer sent\n₱2,750.00\nTo  BEA SY\nInstaPay reference  TNK20261118AB12\nAmount  ₱2,750.00\nNov 18, 2026 9:15 AM',
    { source: 'Tonik', amount: 2750, ref: 'TNK20261118AB12', date: 'Nov 18, 2026', receiver: 'BEA SY' }],
  'CIMB (day-first date, 24-hour time)': ['CIMB\nTransfer successful\nAmount  PHP 1,800.00\nTo account  ••••8821\nAccount Name  DIANA ONG\nReference number  CIMB2611180044\n18/11/2026 10:10',
    { source: 'CIMB', amount: 1800, ref: 'CIMB2611180044', date: '18/11/2026', receiver: 'DIANA ONG', contact: '••••8821' }],
};

describe('receipts from other banks and e-wallets', () => {
  for (const [name, [text, want]] of Object.entries(CASES)) {
    it(name, () => {
      const { data, source } = parseReceipt(text);
      expect(source).toBe(want.source);
      expect(data.amount).toBe(want.amount);
      expect(data.referenceNo).toBe(want.ref);
      expect(data.date).toBe(want.date);
      if (want.receiver) expect(data.receiverName).toBe(want.receiver);
      if (want.contact) expect(data.receiverContact).toBe(want.contact);
      // the headline (where printed) agrees with the details: no false alarm
      expect(checkHeadlineAmount([text], data.amount).status).not.toBe('mismatch');
    });
  }

  it('the destination bank named on a Maya transfer is not taken as the issuer', () => {
    expect(parseReceipt('Bank transfer\nRecipient  MARIA SANTOS\nBank  BDO Unibank\nAmount  ₱2,000.00\nReference ID  4CCD 2075 53B8\nmaya').source).toBe('Maya');
    expect(parseReceipt('Bank of the Philippine Islands\nAmount PHP 1,000.00\nReference No. 1234567890').source).toBe('BPI');
  });

  it('ShopeePay\'s long Transaction ID is read when no "Reference No." is printed', () => {
    const { data, source } = parseReceipt('ShopeePay\nTransfer Successful\n₱350.00\nTransfer to  KIM LOPEZ\nTransaction ID  2611180918273645\nAmount  ₱350.00\nNov 18, 2026 06:22 PM');
    expect(source).toBe('ShopeePay');
    expect(data.receiverName).toBe('KIM LOPEZ');
    expect(data.transactionId).toBe('2611180918273645');
  });

  it('"sent to" inside a sentence is not a recipient label', () => {
    const text = 'Purchased (Updated) on\nSTARBUCKS ORTIGAS\nThe final amount has been sent to the merchant.\nP Share\nAmount P300.00';
    expect(parseReceipt(text).data.receiverName).toBe('STARBUCKS ORTIGAS');
  });
});

describe('dates printed day-first and with month names', () => {
  it('reads a day-first numeric date (a first number above 12 can only be the day)', () => {
    const d = parseReceiptDate('18/11/2026', '10:10');
    expect(d).toBeInstanceOf(Date);
    expect((d as Date).toISOString()).toBe('2026-11-18T02:10:00.000Z');   // 10:10 PH time
    expect((parseReceiptDate('11/18/2026', '3:30 PM') as Date).toISOString()).toBe('2026-11-18T07:30:00.000Z');
  });
  it('reads "18-Nov-2026"', () => {
    expect((parseReceiptDate('18-Nov-2026', '11:20:45 AM') as Date).toISOString()).toBe('2026-11-18T03:20:00.000Z');
  });
  it('still rejects an impossible date', () => {
    expect(parseReceiptDate('31/02/2026')).toBe('invalid');
    expect(parseReceiptDate('13/13/2026')).toBe('invalid');
  });
});

describe('typed details: a hyphen in a reference is printing only', () => {
  it('a BPI reference typed with hyphens has the right format', () => {
    const t = checkTransaction({ institution: 'BPI', type: 'Bank Transfer', amount: 500, date: '2026-11-18', time: '10:00', referenceNo: 'AB12-3456-7890', senderName: '', receiverName: '' } as never, [], new Date('2026-11-19T00:00:00Z'));
    expect(t.findings.find(f => f.label === 'Reference Format')?.passed).toBe(true);
  });
});
