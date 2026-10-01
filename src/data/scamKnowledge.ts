// Scam reference entries shown on the Knowledge Base page.
// Every example here is also run through the Message Analyzer by
// src/__tests__/knowledgeBase.test.ts, so the page never documents a scam
// the engine cannot recognise.
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
  summary: string;
  redFlags: string[];
  example: string;
  protect: string[];
}

export const ENTRIES: ScamEntry[] = [
  {
    id: 'otp', name: 'OTP / Verification Scam', icon: KeyRound, color: '#ef4444',
    summary: 'Scammers trick you into revealing a one-time PIN (OTP) sent to your phone, then use it to take over your account or approve a transfer.',
    redFlags: ['Someone asks you to read out a code "to verify" you', 'Urgency: "do it now or your account will be locked"', 'The code\u2019s own SMS literally says never to share it', 'Caller claims to be from your bank / e-wallet support'],
    example: '"This is GCash Support. We detected suspicious activity. Please confirm the 6-digit code we just sent to secure your account."',
    protect: ['Never share an OTP — no legitimate staff will ever ask for it', 'Banks and e-wallets do not call to ask for codes', 'If unsure, hang up and call the official hotline yourself'],
  },
  {
    id: 'investment', name: 'Investment Scam', icon: TrendingUp, color: '#f59e0b',
    summary: 'You\u2019re promised unusually high, "guaranteed" returns from crypto, forex, or a "double your money" scheme. Early small payouts build trust before the larger deposit disappears.',
    redFlags: ['"Guaranteed" or fixed daily/weekly returns', 'Pressure to recruit friends for bonuses', 'Withdrawals suddenly require more "fees" or "taxes"', 'Unregistered platform, no verifiable company details'],
    example: '"Invest \u20b15,000 today and earn \u20b11,500 daily. 100% guaranteed, withdraw anytime!"',
    protect: ['No legitimate investment guarantees high fixed returns', 'Check if the entity is registered with the SEC', 'Be suspicious when you must pay fees to withdraw your own money'],
  },
  {
    id: 'prize', name: 'Prize / Raffle Scam', icon: Gift, color: '#6366f1',
    summary: 'You\u2019re told you won a prize, but must first pay a "processing", "delivery", or "tax" fee to claim it. The prize never exists.',
    redFlags: ['You won a contest you never joined', 'A fee is required before you can receive a "free" prize', 'Claims tied to a famous brand but from a personal number', 'Deadline pressure to pay quickly'],
    example: '"Congratulations! You won \u20b150,000 in our raffle. Send \u20b1500 processing fee to claim your prize now."',
    protect: ['Real prizes never require an upfront payment', 'Verify directly with the official brand or promo', 'Paying a small fee to unlock a big reward is the classic trap'],
  },
  {
    id: 'marketplace', name: 'Marketplace / Buy-Sell Scam', icon: ShoppingBag, color: '#10b981',
    summary: 'In online buying and selling, a fake buyer "overpays" and asks for a refund, or a fake seller takes payment and never ships. Forged payment screenshots are common.',
    redFlags: ['Buyer sends a "proof of payment" screenshot you can\u2019t see in your own account', 'Seller insists on full payment before meet-up with no track record', 'Pressure to ship before funds clear', 'Deal is too cheap to be true'],
    example: '"I already paid, here\u2019s the GCash screenshot. Please ship now, I need it today!"',
    protect: ['Always confirm money landed in your own account — not from a screenshot', 'Prefer meet-up or cash-on-delivery for high-value items', 'A screenshot is not proof of received funds'],
  },
  {
    id: 'phishing', name: 'Bank Phishing', icon: Landmark, color: '#3b82f6',
    summary: 'A message imitates your bank and links to a fake login page that steals your username, password, and OTP. A common 2025\u20132026 hook claims your reward points are "expiring today" so you rush to a fake "redeem" page.',
    redFlags: ['Link domain is not the bank\\u2019s real one (e.g. bdoa.help instead of bpi.com.ph)', 'Claims your points / rewards will "expire today" \u2014 redeem now', 'Odd domain extension such as .help, .xyz, .top, .cfd, .vip', 'Threats that your account will be suspended or a generic greeting'],
    example: '"BPI: 6,553 points in your account will expire today. Redeem now! Visit https://bdoa.help/rewards"',
    protect: ['Banks send NO clickable login/reward links by SMS or chat \u2014 open the official app instead', 'Know the real domains: BPI bpi.com.ph \u00b7 BDO bdo.com.ph \u00b7 GCash gcash.com \u00b7 Maya maya.ph', 'If the URL is not the exact official domain, it is a scam \u2014 reward points are never "converted" via a link'],
  },
  {
    id: 'job', name: 'Job Offer Scam', icon: Briefcase, color: '#f97316',
    summary: 'A "too-good" remote job (often "liking videos" or "completing tasks") pays small amounts first, then asks you to deposit your own money for "bigger" tasks.',
    redFlags: ['Pay to start, or deposit to "unlock" higher earnings', 'Recruitment over chat apps with no real interview', 'Vague company, salary far above the work', 'Earnings shown but withdrawals blocked'],
    example: '"Earn \u20b12,000/day completing simple tasks. Just deposit \u20b11,000 to activate your premium account."',
    protect: ['Legitimate jobs never ask you to pay to work', 'Research the company independently', 'Walk away when "earnings" require your own deposit'],
  },
  {
    id: 'loan', name: 'Loan / Advance-Fee Scam', icon: CircleDollarSign, color: '#a855f7',
    summary: 'An "instant approval" loan requires an upfront "processing fee" or "insurance" before release. After you pay, the loan never arrives.',
    redFlags: ['Guaranteed approval with no credit check', 'Upfront fee required before release', 'Unregistered lender, pressure to pay fast', 'Contact only through chat apps'],
    example: '"Your \u20b150,000 loan is approved! Pay \u20b12,000 processing fee to release the funds to your account."',
    protect: ['Legitimate lenders deduct fees from the loan, not before', 'Verify the lender is registered/licensed', 'Never pay to receive a loan'],
  },
  {
    id: 'proof', name: 'Fake Proof of Payment', icon: ReceiptText, color: '#ef4444',
    summary: 'A "buyer" sends a screenshot instead of real money: an edited receipt, someone else’s old receipt, or a payment that was never actually sent (a "Confirm transaction" review screen captured before pressing Send).',
    redFlags: ['Pressure to ship or release goods immediately "because I already paid"', 'The screenshot shows a confirm/review screen with no reference number', 'The amount or recipient on the receipt does not match your conversation', 'The same receipt (same reference number) shows up more than once'],
    example: '"Paid na po, here’s my screenshot! Please ship now, I need it today."',
    protect: ['A screenshot is never proof — open YOUR OWN app and check that the money arrived', 'Search the reference number in your received transactions', 'Use Cross-Evidence to compare the receipt with the chat before releasing anything'],
  },
  {
    id: 'parcel', name: 'Parcel / Customs-Fee Scam', icon: Package, color: '#0ea5e9',
    summary: 'A text or chat claims a package is "on hold" and asks for a small customs, clearance, or storage fee through a link. The courier name is real; the message and link are not.',
    redFlags: ['You were not expecting a package', 'A fee is needed to "release" the parcel', 'The link is not the courier’s official website', 'Short deadline: "pay today or the parcel will be returned"'],
    example: '"Your parcel is on hold at customs. Pay the ₱150 clearance fee to release it: lbc-ph.top/pay"',
    protect: ['Track parcels only through the courier’s official app or website', 'Couriers do not ask for fees through random links', 'Never enter card or e-wallet details on a messaged link'],
  },
  {
    id: 'wrongsend', name: 'Wrong-Send / Refund Scam', icon: Undo2, color: '#f59e0b',
    summary: 'Money from a stolen or scam-funded account is sent to you "by mistake", then the sender asks you to "refund" it to a DIFFERENT number. Returning it that way can make you the money mule — and the original payment may later be reversed.',
    redFlags: ['An unexpected incoming transfer followed quickly by a message', 'The refund must go to a different number or account', 'Emotional pressure or urgency ("pang-tuition ko po yan")', 'Refusal to go through the e-wallet’s own support'],
    example: '"Hi po, na-send ko po sa inyo yung ₱2,000 by mistake. Paki-balik na lang po sa 0917 123 4567, salamat!"',
    protect: ['Do not send money back yourself — report it to your e-wallet or bank support', 'Let the provider reverse a genuine mistake through official channels', 'Never "refund" to a number other than the one that sent it'],
  },
];
