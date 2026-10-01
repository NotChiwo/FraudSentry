// ============================================================
// FraudSentry — Fraud Message Analyzer Engine
//
// Pattern-based scam detection over the ACTUAL submitted text.
// Every flag is triggered by content genuinely present in the input
// (we record the exact character span so the UI can highlight it).
// There is no random or fabricated scoring.
//
// Link/phishing detection is grounded in published guidance:
//   • PH banks/e-wallets publish ONE official domain each and state
//     they NEVER send clickable login/reward links by SMS or chat
//     (e.g. BPI: "if it's not bpi.com.ph it is a scam").
//   • "Your points/rewards are expiring — redeem now" is a documented
//     phishing hook banks have warned about.
//   • Certain TLDs (.help, .top, .xyz, .cfd, .vip, .monster …) carry
//     very high phishing rates (Interisle / Spamhaus 2025 reporting).
// ============================================================

import {
  MessageFlag, MessageScanResult, MessagePlatform, ScamType, RiskLevel, LinkFinding,
  CrossEvidenceResult, ImageScanResult, EvidenceLinkage, FieldComparison, FieldMatchState,
} from '../types';
import { generateId, scoreToRiskLevel, maxRisk, RISK_RANK } from '../utils/helpers';

interface PatternRule {
  keyword: RegExp; reason: string; weight: number; scamType: ScamType; severity: RiskLevel;
  /** ignore the match when it is a warning ("never share your OTP"), not a request */
  skipIfNegated?: boolean;
}

// "never / do not / huwag …" in or just before a match turns a request into a warning.
const NEGATION = /\b(never|do not|don't|dont|huwag|wag|hindi)\b/i;

const RULES: PatternRule[] = [
  { keyword: /\b(otp|one[-\s]?time pin|verification code|security code)\b.{0,40}\b(share|send|reply|provide|ibigay|i-send)\b/i, reason: 'Asks you to share an OTP or verification code — legitimate banks never request this.', weight: 0.40, scamType: 'OTP Scam', severity: 'critical', skipIfNegated: true },
  // the far more common word order: "send me the OTP", "pakisend po ang code"
  { keyword: /\b(share|send|give|forward|reply with|confirm|read|tell|provide|ibigay|i-send|pakisend|paki-send|sabihin)\b.{0,30}\b(otp|one[-\s]?time pin|verification code|security code|mpin|\d[-\s]?digit (code|pin))\b/i, reason: 'Asks you to send or share an OTP / verification code — legitimate banks and e-wallets never request this, by any channel.', weight: 0.40, scamType: 'OTP Scam', severity: 'critical', skipIfNegated: true },
  { keyword: /\bdo not share\b.{0,20}\botp\b/i, reason: 'Copies official "do not share your OTP" wording to sound legitimate.', weight: 0.10, scamType: 'OTP Scam', severity: 'medium' },
  { keyword: /\b(your account (has been|is) (suspended|locked|restricted|blocked|deactivated))\b/i, reason: 'Uses urgency about account suspension — a common phishing pressure tactic.', weight: 0.30, scamType: 'Fake Bank Alert', severity: 'high' },
  { keyword: /\b(click|tap|pindutin)\s+(this|the|ang)?\s*link\b/i, reason: 'Instructs you to click a link — the primary phishing delivery method.', weight: 0.22, scamType: 'Phishing', severity: 'high' },
  { keyword: /\bverify\s+your\s+(account|identity|details|information)\b/i, reason: 'Requests account "verification" via a link or reply — a classic phishing hook.', weight: 0.25, scamType: 'Phishing', severity: 'high' },
  { keyword: /\b(unauthorized|suspicious)\s+(login|access|transaction|activity)\b/i, reason: 'Claims unauthorized activity to provoke a panicked response.', weight: 0.22, scamType: 'Fake Bank Alert', severity: 'high' },
  // ── Rewards / points expiry phishing (documented bank-impersonation hook) ──
  { keyword: /\b(points|rewards?|rebates?|miles|cashback)\b.{0,34}\b(expir\w+|forfeit\w+|mawawala|will be lost)\b/i, reason: 'Claims your bank points/rewards are expiring to pressure you. Banks have publicly warned that this "expiring points" hook is used to harvest account details — they do not convert points through messaged links.', weight: 0.30, scamType: 'Phishing', severity: 'high' },
  { keyword: /\b(redeem|claim|i-?claim)\b.{0,24}\b(points|rewards?|premyo|prize)\b/i, reason: 'Urges you to "redeem/claim" points or rewards immediately — a common phishing lure paired with a fake link.', weight: 0.16, scamType: 'Phishing', severity: 'medium' },
  { keyword: /\b(guaranteed|sigurado)\s+(profit|return|kita|income)\b/i, reason: 'Promises guaranteed profit — a hallmark of investment fraud.', weight: 0.35, scamType: 'Investment Scam', severity: 'critical' },
  { keyword: /\b(double|triple|i-double|i-triple)\s+(your\s+)?(money|investment|capital|pera)\b/i, reason: 'Promises unrealistic investment multipliers.', weight: 0.35, scamType: 'Investment Scam', severity: 'critical' },
  { keyword: /\b(crypto|forex|trading)\b.{0,30}\b(mentor|coach|guru|expert)\b/i, reason: 'Unsolicited trading "mentor" pitch — common in pig-butchering investment scams.', weight: 0.28, scamType: 'Investment Scam', severity: 'high' },
  // ── PH-specific: courier/parcel, wrong-send refund, task-job, budol ──
  { keyword: /\b(parcel|package|padala|shipment)\b.{0,40}\b(customs?|tax|clearance|storage)(\s+(clearance|processing|handling|release))?\s*(fee|charge|payment|bayad)\b/i, reason: 'Asks for a customs/clearance fee to release a parcel — a well-documented courier impersonation scam (fake LBC/J&T/DHL notices).', weight: 0.34, scamType: 'Parcel Scam', severity: 'critical' },
  { keyword: /\b(na-?hold|on hold|held)\b.{0,30}\b(parcel|package|padala)\b/i, reason: 'Claims a parcel is on hold to pressure a payment or a link click.', weight: 0.20, scamType: 'Parcel Scam', severity: 'medium' },
  { keyword: /\b(wrong|accidental(ly)?|na-?send ko po?|maling)\s*(send|transfer|padala)\b.{0,90}\b(refund|return|(paki)?balik|send back|i-?send)\b/i, reason: 'The "accidental wrong send — please return it" script: scammers send money from stolen accounts and ask you to "refund" it to a different number, making you the money mule.', weight: 0.36, scamType: 'Wrong-Send Refund Scam', severity: 'critical' },
  { keyword: /\b(part[-\s]?time|work from home|online)\s*(job|work|trabaho)\b.{0,50}\b(₱|php|earn|kita|daily|per (task|day))\b/i, reason: 'Unsolicited high-paying online job offer — task/commission job scams start this way and later require "activation" deposits.', weight: 0.26, scamType: 'Job Offer Scam', severity: 'high' },
  { keyword: /\b(deposit|top[-\s]?up|activation|membership)\s*(fee|amount|muna|first)\b.{0,40}\b(task|job|commission|earnings?|withdraw)\b/i, reason: 'Requires a deposit before you can "work" or withdraw earnings — the defining move of task-job scams.', weight: 0.34, scamType: 'Job Offer Scam', severity: 'critical' },
  { keyword: /\bmadali(ng)?\s+(pera|kita)\b|\beasy\s+money\b/i, reason: '"Easy money" framing — common opener for budol and recruitment scams.', weight: 0.16, scamType: 'Budol / Recruitment', severity: 'medium' },
  { keyword: /\b(work from home|part[-\s]?time)\b.{0,40}\b(₱|php|p)?\s?\d{3,6}\s*(\/|per)\s*(day|hour|araw)\b/i, reason: 'Advertises an unrealistic daily/hourly rate for vague remote work.', weight: 0.28, scamType: 'Job Offer Scam', severity: 'high' },
  { keyword: /\b(registration fee|training fee|application fee)\b/i, reason: 'Requests an upfront fee before employment — legitimate employers never charge job seekers.', weight: 0.30, scamType: 'Job Offer Scam', severity: 'high' },
  { keyword: /\b(pay|bayad|send payment)\b.{0,30}\b(first|in advance|muna|bago)\b.{0,20}\b(ship|deliver|padala)\b/i, reason: 'Demands payment before shipment with no buyer protection — common marketplace scam.', weight: 0.25, scamType: 'Marketplace Scam', severity: 'medium' },
  { keyword: /\b(loan|utang)\b.{0,30}\b(approved|guaranteed approval|walang collateral|no collateral)\b/i, reason: 'Guarantees loan approval regardless of credit — a common loan-scam hook.', weight: 0.28, scamType: 'Loan Scam', severity: 'high' },
  { keyword: /\bprocessing fee\b.{0,30}\bloan\b|\bloan\b.{0,30}\bprocessing fee\b/i, reason: 'Requests an upfront "processing fee" before releasing loan funds — an advance-fee scam.', weight: 0.32, scamType: 'Loan Scam', severity: 'high' },
  { keyword: /\b(this is|i am|ito si)\b.{0,20}\b(from|galing sa)\b.{0,20}\b(bank|gcash|maya|bsp|nbi|pnp|bdo|bpi)\b/i, reason: 'Claims to represent a bank or government office via informal chat/SMS — institutions do not verify this way.', weight: 0.24, scamType: 'Impersonation', severity: 'high' },
  { keyword: /\b(legal action|warrant|arrest|kaso)\b.{0,30}\b(unless|kung hindi|failure to|otherwise)\b/i, reason: 'Threatens legal consequences to force immediate compliance — a coercion tactic.', weight: 0.30, scamType: 'Impersonation', severity: 'high' },
  { keyword: /\b(confirm|update|i-confirm)\b.{0,20}\b(password|pin|mpin|login details|credentials)\b/i, reason: 'Requests your password, PIN, or login details — no legitimate service asks for these over chat/SMS.', weight: 0.40, scamType: 'Account Takeover', severity: 'critical' },
  { keyword: /\bremote (access|desktop|control)\b|\banydesk\b|\bteamviewer\b/i, reason: 'Requests remote-access software — used to take control of victims\' devices.', weight: 0.40, scamType: 'Account Takeover', severity: 'critical' },
  { keyword: /\bact now\b|\bexpires? (today|in \d+ (minutes|hours))\b|\bnow na\b|\bmadali\b/i, reason: 'Creates artificial time pressure to prevent careful verification.', weight: 0.12, scamType: 'None Detected', severity: 'medium' },
  { keyword: /\b(congratulations|congrats|binabati)\b.{0,24}\b(you('?| ha)ve (won|been selected)|you won|winner|panalo|nanalo|napili)\b/i, reason: 'Unsolicited "you have won" framing — a classic prize-scam opener.', weight: 0.26, scamType: 'Prize Scam', severity: 'high' },
  { keyword: /\b(claim|i-claim)\b.{0,20}\b(prize|reward|premyo|gift)\b.{0,30}\b(fee|bayad|deposit)\b/i, reason: 'Requires a fee to "claim" a prize — real prizes never require an upfront payment.', weight: 0.30, scamType: 'Prize Scam', severity: 'high' },
  // same request, fee mentioned first: "Send ₱500 processing fee to claim your prize"
  { keyword: /\b(fee|bayad|deposit)\b.{0,30}\b(claim|release|i-claim|makuha)\b.{0,20}\b(prize|reward|premyo|winnings|gift)\b/i, reason: 'Requires a fee to "claim" a prize — real prizes never require an upfront payment.', weight: 0.30, scamType: 'Prize Scam', severity: 'high' },
  { keyword: /\b100%\s*guaranteed\b|\bguaranteed\s+(returns?|payouts?|daily|weekly|monthly)\b/i, reason: 'Promises "guaranteed" returns — no real investment can guarantee a profit.', weight: 0.30, scamType: 'Investment Scam', severity: 'critical' },
  { keyword: /\b(earn|kikita|kumita|kita)\b.{0,12}(₱|php|p)\s?[\d,]{3,}(\.\d{2})?\s*(\/\s*(day|week)|a day|per day|daily|araw-araw|kada araw|a week|weekly)\b/i, reason: 'Promises a fixed, high income per day or week — the hook used by investment and task-job scams.', weight: 0.26, scamType: 'Investment Scam', severity: 'high' },
  { keyword: /\b(deposit|top[-\s]?up|pay|magbayad)\b.{0,25}\bto\s+(activate|unlock|upgrade)\b.{0,25}\b(account|tasks?|membership|vip|premium|earnings?|withdrawal)\b/i, reason: 'Requires a deposit to "activate" an account or unlock tasks/earnings — the defining move of task-job scams.', weight: 0.34, scamType: 'Job Offer Scam', severity: 'critical' },
  { keyword: /\b(by mistake|nagkamali|na-?wrong send|maling (number|numero)|wrong number)\b.{0,90}\b(refund|return|(paki-?)?balik|ibalik|send back|i-?send)\b/i, reason: 'The "accidental wrong send — please return it" script: scammers send money from stolen accounts and ask you to "refund" it to a different number, making you the money mule.', weight: 0.36, scamType: 'Wrong-Send Refund Scam', severity: 'critical' },
  // Medium on purpose: honest buyers say this too — the point is to verify first.
  { keyword: /\b(already paid|paid na( po)?|bayad na( po)?|nagbayad na|sent na( po)?)\b.{0,80}\b(ship|deliver|send the (item|order)|ipadala|i-?ship)\b/i, reason: 'Says payment is done and pushes you to ship right away — the classic fake-proof-of-payment setup. A screenshot proves nothing; check that the money is in YOUR account first.', weight: 0.22, scamType: 'Marketplace Scam', severity: 'medium' },
];

const SHORTENERS = /(bit\.ly|tinyurl\.com|t\.co|is\.gd|cutt\.ly|shorturl|rb\.gy|ow\.ly|buff\.ly|rebrand\.ly|short\.io|s\.id|linktr\.ee)/i;

// High-abuse TLDs (Interisle Phishing Landscape 2025 + Spamhaus + ANY.RUN).
const ABUSED_TLDS = /\.(help|xyz|top|xin|bond|shop|online|cfd|vip|pro|monster|world|win|lol|support|click|link|live|rest|buzz|icu|cc|sbs|fit|gq|tk|ml|ga|cf|zip|mov|country|stream|download|loan|work|review|quest|autos|beauty|hair|skin|mom|lat|cyou)(\/|$|:|\?)/i;

// Official Philippine bank / e-wallet domains (each publishes exactly one).
interface Brand { label: string; token: RegExp; domains: string[]; }
const BRANDS: Brand[] = [
  { label: 'BPI',           token: /\bbpi\b/i,                domains: ['bpi.com.ph'] },
  { label: 'BDO',           token: /\bbdo\b/i,                domains: ['bdo.com.ph'] },
  { label: 'GCash',         token: /\bg-?cash\b/i,            domains: ['gcash.com'] },
  { label: 'Maya',          token: /\b(maya|paymaya)\b/i,     domains: ['maya.ph', 'paymaya.com'] },
  { label: 'UnionBank',     token: /\bunion\s?bank\b/i,       domains: ['unionbankph.com', 'unionbank.com'] },
  { label: 'Metrobank',     token: /\bmetro\s?bank\b/i,       domains: ['metrobank.com.ph'] },
  { label: 'Landbank',      token: /\bland\s?bank\b/i,        domains: ['landbank.com'] },
  { label: 'Security Bank', token: /\bsecurity\s?bank\b/i,    domains: ['securitybank.com'] },
  { label: 'PNB',           token: /\bpnb\b/i,                domains: ['pnb.com.ph'] },
  { label: 'RCBC',          token: /\brcbc\b/i,               domains: ['rcbc.com'] },
  { label: 'GoTyme',        token: /\bgo\s?tyme\b/i,          domains: ['gotyme.com.ph'] },
  { label: 'PayPal',        token: /\bpaypal\b/i,             domains: ['paypal.com'] },
];

const ALL_OFFICIAL = BRANDS.flatMap(b => b.domains);
function isOfficialHost(host: string): boolean {
  return ALL_OFFICIAL.some(d => host === d || host.endsWith('.' + d));
}
function hostOf(raw: string): string {
  const url = raw.replace(/[.,)]+$/, '');
  try { return new URL(url.startsWith('http') ? url : 'http://' + url).hostname.toLowerCase(); }
  catch { return url.toLowerCase(); }
}

interface LinkAnalysis { links: LinkFinding[]; extraScore: number; phishing: boolean; }

// Brand names as they appear inside look-alike hosts ("gcash-verify.com", "mybpi-rewards.top").
const BRAND_IN_HOST = /(gcash|paymaya|maya|bpi|bdo|unionbank|metrobank|landbank|securitybank|pnb|rcbc|gotyme|paypal)/i;

// Links written with a scheme or "www.", PLUS bare domains ("lbc-ph.top/pay"),
// which scam SMS use constantly. A bare domain is only treated as a link when it
// is official, a shortener, on a high-abuse TLD, or a brand look-alike — so an
// ordinary mention like "shopee.ph" isn't flagged as phishing.
function extractLinks(text: string): string[] {
  const schemed = text.match(/https?:\/\/[^\s)>\]]+|www\.[^\s)>\]]+/gi) || [];
  const rest = schemed.reduce((t, u) => t.split(u).join(' '), text);
  const bare = (rest.match(/(?<![@\w.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s)>\]]*)?/gi) || [])
    .filter(u => {
      const host = hostOf(u);
      if (!host.includes('.') || /^\d+(\.\d+)+$/.test(host)) return false;
      return isOfficialHost(host) || SHORTENERS.test(host) || ABUSED_TLDS.test(host + '/') || BRAND_IN_HOST.test(host);
    });
  return [...schemed, ...bare];
}

function analyzeLinks(text: string): LinkAnalysis {
  const urls = extractLinks(text);
  const brandsInText = BRANDS.filter(b => b.token.test(text));
  const links: LinkFinding[] = [];
  let extra = 0;
  let phishing = false;

  for (const raw of urls) {
    const url = raw.replace(/[.,)]+$/, '');
    const host = hostOf(url);

    // 1) Official banking domain → reassuring, not a flag.
    if (isOfficialHost(host)) {
      links.push({ url, reason: 'Resolves to an official banking/e-wallet domain. Still only log in through the app, never through a messaged link.', severity: 'low' });
      continue;
    }

    // 2) Message names a bank/e-wallet, but the link is NOT its official site.
    //    This is the strongest, most defensible phishing signal: institutions
    //    publish one domain and never send login/reward links by SMS or chat.
    if (brandsInText.length) {
      const b = brandsInText[0];
      links.push({ url, reason: `The message references ${b.label}, but this link's domain "${host}" is not ${b.label}'s official site (${b.domains[0]}). ${b.label} does not send login or rewards links by SMS or chat — this is a phishing domain.`, severity: 'critical' });
      extra += 0.6; phishing = true; continue;
    }

    // 3) URL shortener hiding the true destination.
    if (SHORTENERS.test(url)) {
      links.push({ url, reason: 'URL shortener — hides the true destination, frequently used to mask phishing pages.', severity: 'high' });
      extra += 0.3; phishing = true; continue;
    }

    // 4) Raw IP address instead of a domain.
    if (/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(host)) {
      links.push({ url, reason: 'Raw IP-address link instead of a domain name — almost never used by legitimate institutions.', severity: 'high' });
      extra += 0.3; phishing = true; continue;
    }

    // 5) High-abuse TLD (.help, .top, .xyz, .cfd, .vip …).
    if (ABUSED_TLDS.test(host)) {
      const tld = host.slice(host.lastIndexOf('.'));
      links.push({ url, reason: `Hosted on "${tld}", a top-level domain with one of the highest phishing/abuse rates reported in 2025 — rarely used by legitimate businesses.`, severity: 'high' });
      extra += 0.3; phishing = true; continue;
    }

    // 6) Deceptive subdomain words (secure-login, verify-account, *-ph …).
    if (/\b(secure|login|signin|verify|account|update|confirm|wallet|rewards?)\b[-.]/i.test(host) || /-(ph|official|support|help)\./i.test(host)) {
      links.push({ url, reason: 'Domain uses bank-like words (secure / login / verify / account) to look trustworthy — a common phishing disguise. Check the real registered domain carefully.', severity: 'high' });
      extra += 0.24; phishing = true; continue;
    }

    // 7) Otherwise: a plain external link — informational only.
    links.push({ url, reason: 'External link present. Verify the exact domain before opening; never log in through links received by message.', severity: 'medium' });
    extra += 0.05;
  }

  return { links, extraScore: Math.min(0.85, extra), phishing };
}

function detectPlatformFromText(text: string): MessagePlatform {
  const lower = text.toLowerCase();
  if (/^(from|subject|to):/im.test(text)) return 'Email';
  if (lower.includes('messenger')) return 'Messenger';
  if (lower.includes('whatsapp')) return 'WhatsApp';
  if (lower.includes('telegram')) return 'Telegram';
  if (lower.includes('viber')) return 'Viber';
  if (lower.includes('discord')) return 'Discord';
  return 'Unknown';
}

function pickScamType(rules: PatternRule[], extra: { type: ScamType; weight: number }[]): ScamType {
  const w: Record<string, number> = {};
  for (const r of rules) { if (r.scamType === 'None Detected') continue; w[r.scamType] = (w[r.scamType] || 0) + r.weight; }
  for (const e of extra) { if (e.type === 'None Detected') continue; w[e.type] = (w[e.type] || 0) + e.weight; }
  const e = Object.entries(w).sort((a, b) => b[1] - a[1]);
  return (e[0]?.[0] as ScamType) || 'None Detected';
}

// Context notes that are true regardless of the risk score — e.g. a
// perfectly clean "payment received" message still proves nothing by itself.
function contextObservations(text: string): string[] {
  const notes: string[] = [];
  const lower = text.toLowerCase();
  const paymentConfirmation =
    /\b(successfully|success|received|sent|transferred|naipadala|natanggap|payment received|you (have|'?ve) sent)\b/.test(lower)
    && /(₱|php|\bp\b|amount|ref(?:erence)?|reference no)/.test(lower);
  const officialNotice =
    /\b(gcash|maya|paymaya|bpi|bdo|landbank|metrobank|unionbank|seabank|maribank|gotyme|security bank|pnb|chinabank|bsp)\b/i.test(text)
    && /\b(advisory|notice|notification|confirmation|alert|official|customer service|support)\b/i.test(text);
  const hasReference = /\bref(?:erence)?\.?\s*(?:no\.?|number|#)?\s*[:\-]?\s*[0-9]/i.test(text);

  if (paymentConfirmation) notes.push('This reads like a payment-confirmation message. Important: confirmation text can be typed, copied, or edited by anyone — on its own it does not prove a real transfer happened. Confirm the reference number inside your own official app, or use Cross-Evidence to compare it against the actual receipt.');
  if (officialNotice) notes.push('The message presents itself as an official bank or e-wallet notice. Genuine institutions deliver confirmations and alerts inside their own app — not as forwarded text or chat. Treat a pasted "official" message as unverified until you check the source directly.');
  if (hasReference && !paymentConfirmation) notes.push('A reference number is present. The only way to be certain a payment is real is to look up that reference inside your own GCash/banking app — not to trust the message that contains it.');
  return notes;
}

export function analyzeMessageText(rawText: string, platformHint?: MessagePlatform, ocrConfidence: number | null = null): MessageScanResult {
  const text = rawText.replace(/\r/g, '');
  const matched: { rule: PatternRule; start: number; end: number; excerpt: string }[] = [];

  for (const rule of RULES) {
    const re = new RegExp(rule.keyword.source, rule.keyword.flags.includes('g') ? rule.keyword.flags : rule.keyword.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      if (rule.skipIfNegated && NEGATION.test(text.slice(Math.max(0, m.index - 16), m.index) + m[0])) continue;
      matched.push({ rule, start: m.index, end: m.index + m[0].length, excerpt: m[0].slice(0, 70) });
      break; // one span per rule keeps highlights readable
    }
  }

  const { links, extraScore, phishing } = analyzeLinks(text);

  let riskScore = matched.reduce((s, m) => s + m.rule.weight, 0) + extraScore;
  riskScore = 1 - Math.exp(-riskScore * 1.35);   // saturating curve (strong single signals still register)
  riskScore = Math.min(1, riskScore);
  // A rule authored as CRITICAL (OTP/PIN request, remote-access app, customs
  // fee, wrong-send refund…) is a decisive scam marker on its own — the overall
  // verdict must not read "medium" next to a critical flag. Floor at High.
  if (matched.some(m => m.rule.severity === 'critical')) riskScore = Math.max(riskScore, 0.45);
  if (text.trim().length < 8) riskScore = 0;

  const threatLevel: RiskLevel = scoreToRiskLevel(riskScore);

  // Link-derived scam type (a critical phishing link should classify the message).
  const linkExtra: { type: ScamType; weight: number }[] = [];
  if (links.some(l => l.severity === 'critical')) linkExtra.push({ type: 'Phishing', weight: 0.6 });
  else if (links.some(l => l.severity === 'high')) linkExtra.push({ type: 'Phishing', weight: 0.32 });
  const scamType = pickScamType(matched.map(m => m.rule), linkExtra);

  const platform = platformHint && platformHint !== 'Unknown' ? platformHint : detectPlatformFromText(text);

  const flags: MessageFlag[] = matched.map(m => ({
    id: generateId('mf'), keyword: m.excerpt, reason: m.rule.reason,
    weight: m.rule.weight, start: m.start, end: m.end,
    severity: phishing && m.rule.scamType === 'Phishing' ? maxRisk(m.rule.severity, 'high') : m.rule.severity,
  }));

  const criticalLink = links.some(l => l.severity === 'critical');
  const confidence = text.trim().length < 8 ? 0
    : Math.round(Math.min(96, 58 + flags.length * 6 + links.filter(l => l.severity !== 'low').length * 7 + (criticalLink ? 8 : 0) + Math.min(text.length / 24, 10)));

  const phishingDomain = links.find(l => l.severity === 'critical')?.url;
  const explanation = text.trim().length < 8
    ? 'The submitted text is too short to analyze. Paste the full message for an accurate assessment.'
    : threatLevel === 'critical'
      ? `Strong indicators of a ${scamType} were found.${phishingDomain ? ' The message points to a link whose domain is not an official banking site — a phishing destination.' : ''} ${flags.length} fraud signal${flags.length === 1 ? '' : 's'}${links.filter(l => l.severity !== 'low').length ? ` and ${links.filter(l => l.severity !== 'low').length} suspicious link${links.filter(l => l.severity !== 'low').length === 1 ? '' : 's'}` : ''} match known scam scripts. Treat every instruction in this message as untrusted — do not open the link or enter any details.`
      : threatLevel === 'high'
        ? `Multiple credible fraud indicators consistent with a ${scamType.toLowerCase()} were found. Treat any links, code requests, or payment instructions as untrusted, and verify only through the official app or hotline.`
        : threatLevel === 'medium'
          ? 'Some language patterns associated with scams were found, though the message is not conclusively fraudulent. Verify the sender independently before acting.'
          : flags.length > 0
            ? 'Minor pressure language was found, but no strong scam indicators are present. Still verify the sender independently if money or personal data is involved.'
            : 'No known scam patterns were detected. As general practice, never share OTPs or passwords, and never send money based on unsolicited messages.';

  const recommendedActions =
    threatLevel === 'critical' ? [
      'Do not click the link, reply with codes, or send money.',
      'Open your bank/e-wallet only through its official app — never through a messaged link.',
      'Block and report the sender on the originating platform.',
      'If a bank or e-wallet was impersonated, report it through their official channel (e.g. BPI, GCash help center, BDO reportphish@bdo.com.ph).',
      'If money or details were already given, report to the PNP Anti-Cybercrime Group or NBI Cybercrime Division immediately.',
    ] : threatLevel === 'high' ? [
      'Do not act on this message. Verify through the official app or hotline of the institution named.',
      'Avoid opening any embedded links — confirm the exact domain first.',
      'Report the message as spam/phishing on the platform.',
    ] : threatLevel === 'medium' ? [
      'Independently verify the sender before responding.',
      'Do not share any personal, financial, or account information.',
    ] : [
      'No immediate action required.',
      'Continue practicing standard caution with unsolicited messages.',
    ];

  return {
    id: generateId('msg'), platform, sourceText: text, textExcerpt: text.slice(0, 240),
    threatLevel, scamType, riskScore, confidence, ocrConfidence, explanation,
    flags, links, recommendedActions,
    observations: text.trim().length < 8 ? [] : contextObservations(text),
    scannedAt: new Date().toISOString(),
  };
}

// ── Cross-evidence correlation ──────────────────────────────
// Step 1 — LINKAGE: do the receipt and the conversation describe the SAME
// transaction? Judged from identifiers both sides can carry (reference no.,
// recipient number, amount). Step 2 — RISK: combine the two risk levels.

interface FieldCheckResult { bothPresent: boolean; match: boolean; conflict: boolean }
const NOT_COMPARABLE: FieldCheckResult = { bothPresent: false, match: false, conflict: false };
const digitsOnly = (s: string | null | undefined) => (s ? s.replace(/\D/g, '') : '');

// Every peso amount the conversation mentions.
function amountsInMessage(text: string): number[] {
  const out: number[] = [];
  const add = (raw: string) => { const v = parseFloat(raw.replace(/,/g, '')); if (Number.isFinite(v) && v > 0) out.push(v); };
  const peso = /(?:₱|\bphp\b)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = peso.exec(text))) add(m[1]);
  const labelled = /\b(?:amount(?:\s+sent)?|total|sent|nagpadala|naipadala)\b[^0-9₱]{0,16}(?:₱|php\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
  while ((m = labelled.exec(text))) add(m[1]);
  return out;
}

// Reference number the conversation cites (spaces/dashes allowed inside, not newlines).
function referenceInMessage(text: string): string {
  const m = text.match(/\bref(?:erence)?\.?\s*(?:no\.?|number|#)?\s*[:\-]?\s*([0-9][0-9 \-]{6,})/i);
  return m ? digitsOnly(m[1]) : '';
}

// First PH mobile number in the conversation, normalised to 63XXXXXXXXXX.
function phoneInMessage(text: string): string {
  const m = text.match(/(?:\+?63|0)[ -]?9[\d \-]{8,}/);
  return m ? digitsOnly(m[0]).replace(/^0/, '63') : '';
}

// Recipient named in the conversation ("sent to Juan", "padala kay Maria").
// Function words right after "to" ("to you", "to confirm") are not names,
// and a name must start with a capital letter.
const NOT_A_NAME = /^(you|your|me|my|him|her|them|us|the|a|an|this|that|it|send|pay|confirm|check|verify|receive|get|ship|go|be|do|make|see|po|na)$/i;
function nameInMessage(text: string): string {
  const re = /\b(?:to|kay)\s+([A-Za-z][A-Za-z.•*]*(?:\s+[A-Z][A-Za-z.•*]*){0,3})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const first = m[1].split(/\s+/)[0];
    if (!NOT_A_NAME.test(first) && /^[A-Z]/.test(first)) return m[1].trim();
  }
  return '';
}

function compareAmount(receipt: number | null, message: number[]): FieldCheckResult {
  if (receipt == null || message.length === 0) return NOT_COMPARABLE;
  const tol = Math.max(1, receipt * 0.01);
  const match = message.some(v => Math.abs(v - receipt) <= tol);
  return { bothPresent: true, match, conflict: !match };
}

// Exact match, or a single differing digit on a long reference (one misread
// OCR character is far more likely than a coincidental near-identical number).
function compareReference(message: string, receipt: string): FieldCheckResult {
  if (!message || !receipt) return NOT_COMPARABLE;
  let match = message === receipt;
  if (!match && message.length === receipt.length && message.length >= 10) {
    let diff = 0;
    for (let i = 0; i < message.length; i++) if (message[i] !== receipt[i]) diff++;
    match = diff <= 1;
  }
  return { bothPresent: true, match, conflict: !match };
}

// Receipts often mask the number ("+63 9•••••8626") — then only the visible
// last 4 digits can be compared.
function comparePhone(message: string, receiptRaw: string | null): FieldCheckResult {
  const receipt = digitsOnly(receiptRaw);
  if (!message || receipt.length < 4) return NOT_COMPARABLE;
  const masked = /[•*]/.test(receiptRaw || '') || receipt.length < 10;
  const match = masked ? message.slice(-4) === receipt.slice(-4) : message.slice(-10) === receipt.slice(-10);
  return { bothPresent: true, match, conflict: !match };
}

function compareName(receiptName: string | null, messageName: string): FieldCheckResult {
  const a = (receiptName || '').toLowerCase().replace(/[^a-z]/g, '');
  const b = messageName.toLowerCase().replace(/[^a-z]/g, '');
  if (a.length < 3 || b.length < 3) return NOT_COMPARABLE;
  const match = a.startsWith(b.slice(0, 3)) || b.startsWith(a.slice(0, 3));
  return { bothPresent: true, match, conflict: !match };
}

export function assessLinkage(tx: ImageScanResult, msg: MessageScanResult): {
  linkage: EvidenceLinkage; comparison: FieldComparison[]; score: number; hardConflict: boolean; notes: string[];
} {
  const e = tx.extracted;
  const text = msg.sourceText || '';
  const msgAmounts = amountsInMessage(text);
  const msgRef = referenceInMessage(text);
  const msgPhone = phoneInMessage(text);
  const msgName = nameInMessage(text);

  const amount = compareAmount(e.amount, msgAmounts);
  const reference = compareReference(msgRef, digitsOnly(e.referenceNo));
  const phone = comparePhone(msgPhone, e.receiverContact);
  const name = compareName(e.receiverName, msgName);   // shown in the table only — too unreliable to decide linkage

  const state = (r: FieldCheckResult, onReceipt: boolean, inMessage: boolean): FieldMatchState =>
    r.bothPresent ? (r.match ? 'match' : 'conflict') : onReceipt ? 'receipt-only' : inMessage ? 'message-only' : 'absent';

  const comparison: FieldComparison[] = [
    { key: 'amount', label: 'Amount',
      receiptValue: e.amount == null ? null : `₱${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      messageValue: msgAmounts.length ? `₱${msgAmounts[0].toLocaleString(undefined, { minimumFractionDigits: 2 })}` : null,
      state: state(amount, e.amount != null, msgAmounts.length > 0) },
    { key: 'referenceNo', label: 'Reference No.', receiptValue: e.referenceNo, messageValue: msgRef || null,
      state: state(reference, !!e.referenceNo, !!msgRef) },
    { key: 'receiverContact', label: 'Recipient No.', receiptValue: e.receiverContact, messageValue: msgPhone ? `+${msgPhone}` : null,
      state: state(phone, !!e.receiverContact, !!msgPhone) },
    { key: 'receiverName', label: 'Recipient', receiptValue: e.receiverName, messageValue: msgName || null,
      state: state(name, !!e.receiverName, !!msgName) },
  ];

  const deciding = [amount, reference, phone];
  const strongMatch = reference.match || phone.match;            // unique identifiers
  const strongConflict = reference.conflict || phone.conflict;
  const anyMatch = deciding.some(r => r.match);
  const anyConflict = deciding.some(r => r.conflict);
  const anyComparable = deciding.some(r => r.bothPresent);

  const linkage: EvidenceLinkage = !anyComparable ? 'insufficient'
    : strongMatch ? (anyConflict ? 'contradictory' : 'linked')
    : (strongConflict || anyConflict) ? 'unrelated'
    : anyMatch ? 'linked' : 'unrelated';

  const notes: string[] = [];
  let score = 0;
  let hardConflict = false;
  if (linkage === 'contradictory') {
    hardConflict = true;
    score = 0.9;
    if (amount.conflict && e.amount != null) {
      const receiptAmt = e.amount;
      const claimed = msgAmounts.reduce((best, v) => Math.abs(v - receiptAmt) < Math.abs(best - receiptAmt) ? v : best);
      notes.push(`Amount conflict: the receipt shows PHP ${receiptAmt.toLocaleString()} but the message states PHP ${claimed.toLocaleString()}, even though both cite the same ${reference.match ? 'reference number' : 'recipient number'}. One of them was altered — a classic "paid small, claimed large" tactic.`);
    } else {
      notes.push('The receipt and the message refer to the same transaction (matching reference/number) but disagree on another identifier. That internal contradiction means one of them was altered.');
    }
  } else if (linkage === 'unrelated') {
    score = 0.42;
    const which = [reference.conflict ? 'reference numbers' : '', amount.conflict ? 'amounts' : '', phone.conflict ? 'recipient numbers' : '']
      .filter(Boolean).join(', ');
    notes.push('These two do not appear to be about the same transaction' + (which ? ` — their ${which} do not match, and nothing reliably links them.` : '.'));
    notes.push('A receipt can only serve as proof for the conversation it actually belongs to. An unrelated or recycled receipt is a common way to fake "proof of payment" — verify the reference directly in your own account.');
  }
  return { linkage, comparison, score, hardConflict, notes };
}

export function correlateEvidence(tx: ImageScanResult, msg: MessageScanResult): CrossEvidenceResult {
  const txR = tx.riskLevel, convR = msg.threatLevel;
  const link = assessLinkage(tx, msg);
  const riskNotes: string[] = [];
  let combinedScore = Math.max(tx.riskScore, msg.riskScore);

  if (RISK_RANK[convR] >= 2 && RISK_RANK[txR] <= 1) {
    combinedScore = Math.min(1, 0.55 + msg.riskScore * 0.4);
    riskNotes.push('The transaction evidence itself looks authentic, but the linked conversation matches a known scam pattern.');
    riskNotes.push(`This is a high-risk CONTEXT: a genuine-looking ${tx.source === 'Unknown' ? '' : tx.source + ' '}transfer is being used to advance a ${msg.scamType.toLowerCase()}.`);
    riskNotes.push('A real payment does not make the request legitimate — victims are often manipulated into sending genuine money.');
  } else if (RISK_RANK[txR] >= 2 && RISK_RANK[convR] >= 2) {
    combinedScore = Math.min(1, Math.max(tx.riskScore, msg.riskScore) + 0.15);
    riskNotes.push('Both the transaction evidence and the conversation show independent fraud indicators.');
    riskNotes.push('Tampering signals in the receipt combined with scam language in the chat strongly suggest a fabricated or coerced transaction.');
  } else if (RISK_RANK[txR] >= 2) {
    riskNotes.push('The transaction evidence shows tampering/authenticity concerns while the conversation appears ordinary.');
    riskNotes.push('Focus verification on the receipt: confirm the reference number directly in your own account.');
  }

  const rationale: string[] = [];
  combinedScore = Math.max(combinedScore, link.score);
  if (link.hardConflict) {
    combinedScore = Math.max(combinedScore, 0.9);
    rationale.push(...link.notes);
    rationale.push('Verdict: do NOT treat this as proof of payment. The receipt and the message contradict each other on the same transaction.');
  } else if (link.notes.length) {
    rationale.push(...link.notes, ...riskNotes);
  } else {
    if (riskNotes.length) rationale.push(...riskNotes);
    else rationale.push('Neither the transaction evidence nor the conversation triggered strong fraud indicators.');
    rationale.push('Note: matching details do not by themselves prove a payment is real. Confirm funds landed in your own account before releasing anything of value.');
  }

  const combinedRiskLevel = scoreToRiskLevel(combinedScore);
  const verdict =
    link.linkage === 'unrelated' ? 'Unrelated Evidence — Not the Same Transaction'
    : combinedRiskLevel === 'critical' ? 'High Fraud-Risk Context'
    : combinedRiskLevel === 'high'   ? 'Elevated Fraud-Risk Context'
    : combinedRiskLevel === 'medium' ? 'Mixed Signals — Verify Before Trusting'
    : 'No Strong Cross-Evidence Risk';

  return {
    id: generateId('cross'),
    transactionRiskLevel: txR, conversationRiskLevel: convR,
    combinedRiskLevel, combinedScore, verdict, rationale,
    linkage: link.linkage,
    fieldComparison: link.comparison,
    scannedAt: new Date().toISOString(),
  };
}
