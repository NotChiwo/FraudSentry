// Scam reference entries shown on the Knowledge Base page.
// Every example here is also run through the Message Analyzer by
// src/__tests__/knowledgeBase.test.ts, so the page never documents a scam
// the engine cannot recognise.
//
// quickRule / basis: each quick rule is worded to match a public advisory
// that was actually read (listed in `basis`) and the rule the Message
// Analyzer applies. Do not add claims or statistics without a source.
import type { LucideIcon } from 'lucide-react';
import {
  KeyRound, TrendingUp, Gift, ShoppingBag, Landmark, Briefcase,
  CircleDollarSign, ReceiptText, Package, Undo2,
} from 'lucide-react';

export interface ScamEntry {
  id: string;
  name: string;
  icon: LucideIcon;
  color: string;
  /** one short line under the name in the list */
  hint: string;
  /** the one sentence to remember */
  quickRule: string;
  summary: string;
  /** at most 4 short phrases */
  redFlags: string[];
  example: string;
  /** at most 4 short phrases */
  protect: string[];
  /** public advisories the quick rule is based on */
  basis: string;
  /** where "try it" should go: the Message Analyzer, or Check Receipt for screenshot-based scams */
  tryIn: 'message' | 'receipt';
}

// Order: everyday payment situations first, then the rest.
export const ENTRIES: ScamEntry[] = [
  {
    id: 'otp', name: 'OTP / Verification Scam', icon: KeyRound, color: '#ef4444',
    hint: 'Someone asks for your code',
    quickRule: 'If anyone asks for your OTP or PIN, it is a scam.',
    summary: 'Scammers pretend to be bank or e-wallet staff and ask for the one-time PIN (OTP) sent to your phone, then use it to take over your account.',
    redFlags: ['Asks you to read out or send a code', '"Your account will be locked" urgency', 'Claims to be bank or e-wallet support', 'The code’s own SMS says never share it'],
    example: '"This is GCash Support. We detected suspicious activity. Please confirm the 6-digit code we just sent to secure your account."',
    protect: ['Never share an OTP, PIN or MPIN', 'Hang up; call the official hotline yourself', 'Use only the official app'],
    basis: 'GCash, Maya and BSP advisories: they never ask for your OTP, PIN or MPIN.',
    tryIn: 'message',
  },
  {
    id: 'marketplace', name: 'Marketplace / Buy-Sell Scam', icon: ShoppingBag, color: '#10b981',
    hint: 'Pay-first or ship-now pressure',
    quickRule: 'Ship only after the money shows in your own account.',
    summary: 'A fake buyer pushes you to ship before the money arrives, or a fake seller takes payment and never ships.',
    redFlags: ['"Paid na, ship now" pressure', 'Proof is only a screenshot', 'Full payment demanded before meet-up', 'Price too good to be true'],
    example: '"I already paid, here’s the GCash screenshot. Please ship now, I need it today!"',
    protect: ['Check your own app before shipping', 'Prefer meet-up or cash on delivery', 'Walk away from pressure'],
    basis: 'GCash advisory on fake receipts: verify payments in your app’s Transactions tab before releasing items.',
    tryIn: 'message',
  },
  {
    id: 'proof', name: 'Fake Proof of Payment', icon: ReceiptText, color: '#ef4444',
    hint: 'A screenshot instead of money',
    quickRule: 'A screenshot is not money — check your own app.',
    summary: 'A buyer sends a screenshot instead of real money: an edited receipt, someone else’s receipt, or a payment that was never actually sent.',
    redFlags: ['"I already paid" with a push to ship', 'A confirm/review screen, no reference number', 'Amount or name doesn’t match your chat', 'Same reference used more than once'],
    example: '"Paid na po, here’s my screenshot! Please ship now, I need it today."',
    protect: ['Check that the money arrived in your own app', 'Search the reference in your received transactions', 'Run the screenshot through Check Receipt'],
    basis: 'GCash advisory on fake and AI-generated receipts: a transaction not in your app’s history is not valid.',
    tryIn: 'receipt',
  },
  {
    id: 'parcel', name: 'Parcel / Customs-Fee Scam', icon: Package, color: '#0ea5e9',
    hint: '"Pay a fee to release your parcel"',
    quickRule: 'Pay delivery or customs fees only through the courier’s official channel.',
    summary: 'A text or chat says a package is on hold and asks for a small customs, clearance or storage fee through a link or a personal account.',
    redFlags: ['A parcel you weren’t expecting', 'A fee to "release" the parcel', 'Link isn’t the courier’s official site', 'Pay to a personal account or e-wallet'],
    example: '"Your parcel is on hold at customs. Pay the ₱150 clearance fee to release it: lbc-ph.top/pay"',
    protect: ['Track only in the courier’s official app or site', 'Never pay through a messaged link', 'Never pay to a personal account'],
    basis: 'Bureau of Customs advisories: its staff don’t text or call asking for payment, and never collect through personal accounts or e-wallets.',
    tryIn: 'message',
  },
  {
    id: 'wrongsend', name: 'Wrong-Send / Refund Scam', icon: Undo2, color: '#f59e0b',
    hint: '"I sent it by mistake, please return"',
    quickRule: 'Don’t send money back on a stranger’s word. Report it to your bank or e-wallet first and follow their process.',
    summary: 'Money arrives "by mistake", then the sender asks you to return it — often to a different number. The money may come from a stolen account.',
    redFlags: ['Unexpected money, then a message right away', 'Return it to a different number', 'Emotional pressure or urgency', 'Avoids the e-wallet’s own support'],
    example: '"Hi po, na-send ko po sa inyo yung ₱2,000 by mistake. Paki-balik na lang po sa 0917 123 4567, salamat!"',
    protect: ['Report it to your bank or e-wallet first', 'Follow their process for any return', 'Never send to a different number'],
    basis: 'BSP guidance: report wrong transfers to your bank or e-wallet, which must investigate. (GCash and Maya say a receiver may be asked to return a genuine mistake — do it through their process.)',
    tryIn: 'message',
  },
  {
    id: 'prize', name: 'Prize / Raffle Scam', icon: Gift, color: '#6366f1',
    hint: '"You won — pay a fee to claim"',
    quickRule: 'If you have to pay to claim a prize, it is a scam.',
    summary: 'You are told you won a raffle you never joined, but must first pay a processing, delivery or tax fee. The prize does not exist.',
    redFlags: ['You won something you never joined', 'A fee before you can claim', 'Sent from an ordinary mobile number', 'Pressure to claim quickly'],
    example: '"Congratulations! You won ₱50,000 in our raffle. Send ₱500 processing fee to claim your prize now."',
    protect: ['Never pay to claim a prize', 'Check with the brand’s official page', 'Ignore fake permit numbers'],
    basis: 'DTI text-scam advisories: fake raffles ask winners to pay before claiming.',
    tryIn: 'message',
  },
  {
    id: 'investment', name: 'Investment Scam', icon: TrendingUp, color: '#f59e0b',
    hint: '"Guaranteed" daily returns',
    quickRule: 'No real investment can guarantee a profit — check that it is registered with the SEC.',
    summary: 'You are promised high, "guaranteed" returns. Small early payouts build trust before a bigger deposit disappears.',
    redFlags: ['"Guaranteed" or fixed daily returns', 'Recruit friends for bonuses', 'Fees to withdraw your own money', 'Not registered with the SEC'],
    example: '"Invest ₱5,000 today and earn ₱1,500 daily. 100% guaranteed, withdraw anytime!"',
    protect: ['Check SEC registration first', 'Treat "guaranteed" as a warning', 'Never pay to withdraw'],
    basis: 'SEC advisories on unregistered investment schemes promising guaranteed returns.',
    tryIn: 'message',
  },
  {
    id: 'job', name: 'Job Offer / Task Scam', icon: Briefcase, color: '#f97316',
    hint: 'Pay or deposit to "earn"',
    quickRule: 'A real job never asks you to pay or deposit to earn.',
    summary: 'An easy online job ("like videos", "complete tasks") pays small amounts first, then asks you to deposit your own money for bigger tasks.',
    redFlags: ['Deposit to "activate" or unlock tasks', 'Hired over chat with no interview', 'Pay far above the work', 'Earnings you can’t withdraw'],
    example: '"Earn ₱2,000/day completing simple tasks. Just deposit ₱1,000 to activate your premium account."',
    protect: ['Never pay to work', 'Research the company independently', 'Stop when earnings need a deposit'],
    basis: 'SEC and PNP Anti-Cybercrime Group advisories on "tasking" job scams.',
    tryIn: 'message',
  },
  {
    id: 'loan', name: 'Loan / Advance-Fee Scam', icon: CircleDollarSign, color: '#a855f7',
    hint: 'Fee before the loan is released',
    quickRule: 'Legitimate lenders don’t ask for fees before releasing your loan.',
    summary: 'An "instant approval" loan needs an upfront processing or insurance fee. After you pay, the loan never arrives.',
    redFlags: ['Approved with no credit check', 'Fee before release', 'Lender with no SEC authority', 'Contact only through chat apps'],
    example: '"Your ₱50,000 loan is approved! Pay ₱2,000 processing fee to release the funds to your account."',
    protect: ['Never pay to receive a loan', 'Ask for the SEC Certificate of Authority', 'Fees come out of the loan, not before'],
    basis: 'SEC advisories on advance-fee loan scams.',
    tryIn: 'message',
  },
  {
    id: 'phishing', name: 'Bank Phishing', icon: Landmark, color: '#3b82f6',
    hint: 'Fake bank link or "expiring points"',
    quickRule: 'Banks and e-wallets don’t send login or reward links by text — open the official app instead.',
    summary: 'A message imitates your bank and links to a fake page that steals your login and OTP. A common hook says your reward points "expire today".',
    redFlags: ['Link isn’t the bank’s real domain', 'Points "expire today — redeem now"', 'Odd domain like .help, .xyz, .top', 'Threat that your account is suspended'],
    example: '"BPI: 6,553 points in your account will expire today. Redeem now! Visit https://bdoa.help/rewards"',
    protect: ['Don’t tap links in texts', 'Open the official app yourself', 'Know the real domains (bpi.com.ph, gcash.com, maya.ph)'],
    basis: 'GCash and Maya advisories: they never send links by SMS, e-mail or chat.',
    tryIn: 'message',
  },
];
