// ============================================================
// FraudSentry — Receipt Field Parser  (accuracy-hardened)
//
// Parses STRUCTURED fields out of real OCR text using patterns
// tuned for Philippine e-wallet / bank receipts (GCash, Maya,
// GoTyme, BPI, BDO, UnionBank, Metrobank, Landbank, etc.).
//
// Two receipt layouts are handled:
//   • LABEL-VALUE banks (GoTyme/BPI/BDO…): "Account Name  JUAN DELA CRUZ"
//   • GCash "Sent" receipts: the receiver's NAME sits at the top with no
//     label (often masked, e.g. "LI••A R."), the receiver's PHONE is just
//     below it, "Sent via GCash" follows, and the 13-digit Reference No.
//     (shown spaced like "8041 241 631871") is the key legitimacy check.
//
// Rules: never guess; any field we cannot read returns null.
// ============================================================

import { EvidenceSource, ExtractedTransactionData } from '../types';
import { correctPrincipal } from './consistencyChecks';

const SOURCE_KEYWORDS: Record<Exclude<EvidenceSource, 'Unknown'>, string[]> = {
  GCash: ['gcash', 'g-cash'], Maya: ['maya', 'paymaya'],
  BPI: ['bpi', 'bank of the philippine islands'], BDO: ['bdo', 'banco de oro'],
  UnionBank: ['unionbank', 'union bank', 'ub online'], Metrobank: ['metrobank', 'metro bank'],
  Landbank: ['landbank', 'land bank'], 'Security Bank': ['security bank', 'securitybank'],
  GoTyme: ['gotyme', 'go tyme'], RCBC: ['rcbc', 'rizal commercial'], PNB: ['pnb', 'philippine national bank'],
  MariBank: ['maribank', 'mari bank'], SeaBank: ['seabank', 'sea bank'], CIMB: ['cimb'],
  'Online Banking': ['online banking', 'ibanking', 'internet banking'],
};

// Tesseract misreads the "InstaPay" logo text: real receipts have come back as
// "instaray" (p→r) and, consistently in this app's own multi-pass pipeline,
// "instaFay" (P→F). Both are real, repeated OCR outputs — not typos.
const INSTAPAY_RE = /insta[prf]ay/;

// Maya's PRE-SEND review screen ("Confirm transaction" with Source/Destination
// rows). Nothing has been sent yet — there is no reference number because no
// transfer exists — so it can never be proof of payment.
export function isUnconfirmedTransaction(text: string): boolean {
  const hay = text.toLowerCase();
  return /confirm\s+transaction/.test(hay) && /\bsource\b/.test(hay) && /\bdestination\b/.test(hay);
}

export function detectSourceFromText(text: string, filename = ''): EvidenceSource {
  const hay = (text + ' ' + filename).toLowerCase();
  // Issuer-distinctive markers FIRST — they identify which app produced the
  // screenshot. A plain "does the text mention X" check would instead match
  // the DESTINATION bank/wallet (a GoTyme receipt sending to GCash says
  // "G-Xchange, Inc (GCash)"), which was the original misclassification bug.
  // Do not collapse this back into a flat keyword loop.
  if (/sent\s+via\s+gcash/.test(hay)) return 'GCash';
  // GCash bank-transfer boilerplate ("…an update about this transaction in
  // your GCash Inbox") — survives even when the faint "Sent via GCash" line doesn't
  if (/your\s+gcash\s+inbox/.test(hay)) return 'GCash';
  // Bank SMS confirmations start with the bank's tag ("[BPI] You have
  // transferred PHP 490.00 to GCash/G-Xchange…") — the issuer is the tag, not
  // the destination named later in the message.
  { const tag = hay.match(/(^|\n)\s*\[(bpi|bdo|unionbank|metrobank|landbank|rcbc|pnb|security bank)\]/);
    if (tag) return ({ bpi: 'BPI', bdo: 'BDO', unionbank: 'UnionBank', metrobank: 'Metrobank', landbank: 'Landbank', rcbc: 'RCBC', pnb: 'PNB', 'security bank': 'Security Bank' } as Record<string, EvidenceSource>)[tag[2]]; }
  if (INSTAPAY_RE.test(hay) && /trace\s*id/.test(hay) && /go\s?tyme/.test(hay)) return 'GoTyme';
  if (isUnconfirmedTransaction(hay)) return 'Maya';
  if (/express\s+send/.test(hay) && !/maya|maribank|seabank/.test(hay)) return 'GCash';
  if (/\b(gloan|gcash\s+send\s+money|gcash\s+pay\s+bills)\b/.test(hay)) return 'GCash';
  if (/maribank|mari\s?bank|m[a@]ri\s?b[a@4][rn]k/.test(hay)) return 'MariBank';
  if (/transfer\s+result/.test(hay) && /transfer\s+(method|fee)/.test(hay)) return 'MariBank';
  if (/seabank|sea\s?bank/.test(hay)) return 'SeaBank';
  for (const [source, kws] of Object.entries(SOURCE_KEYWORDS)) {
    if (kws.some(k => hay.includes(k))) return source as EvidenceSource;
  }
  // GCash fallback — the small grey "Sent via GCash" line is often misread by
  // OCR, so also accept fuzzy spellings and GCash-specific receipt wording
  // (the green carbon-footprint footer + "Total Amount Sent" only appear on GCash).
  if (/\bg[\s.]?cash\b/.test(hay) || /\b(6cash|gcosh|gcoash|gcash)\b/.test(hay)) return 'GCash';
  if (/(carbon footprint|going digital|gco2e|gco₂e)/.test(hay) && /(total amount sent|sent via|ref\.?\s*no)/.test(hay)) return 'GCash';
  return 'Unknown';
}

const NAME_STOPWORDS = [
  'bank', 'gcash', 'maya', 'gotyme', 'inbox', 'transaction', 'receipt', 'complete',
  'transfer', 'successful', 'update', 'account', 'number', 'amount', 'total', 'date',
  'fee', 'reference', 'sent', 'via', 'instantly', 'credited', 'about', 'your', 'this',
  'paymaya', 'wallet', 'balance', 'available', 'status', 'details', 'confirmation', 'going', 'digital',
];

function looksLikeName(raw: string): boolean {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s.length < 3 || s.length > 42) return false;
  if (/[@\d]/.test(s)) return false;
  if (!/^[A-Z]/.test(s)) return false;
  if (!/^[A-Za-z.\-'’ ]+$/.test(s)) return false;
  const low = s.toLowerCase();
  if (NAME_STOPWORDS.some(w => low.includes(w))) return false;
  if (s.includes(' ')) return true;
  return /^[A-Z]{4,}$/.test(s);
}

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/[^A-Za-z.\-'’ ]+$/g, '').trim();
}

// A short ALL-CAPS line that continues a name onto the next row
// (e.g. a long account name printed as "JUAN / MIGUEL / DELACRUZ" stacked).
function isNameFragment(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 22) return false;
  if (/\d/.test(t)) return false;
  if (/receipt|sent|amount|total|date|bank|account|ref|transfer|fee|method|via|gcash|maya|maribank|instapay|pesonet|php|₱|complete|successful|result|number/i.test(t)) return false;
  return /^[A-Z][A-Z.'’-]+$/.test(t);     // one all-caps word
}

function valueForLabel(lines: string[], labels: string[], maxFollow = 3): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const low = line.toLowerCase();
    if (low.includes('receipt sent')) continue;
    for (const label of labels) {
      const at = low.indexOf(label);
      if (at === -1) continue;
      const after = cleanName(line.slice(at + label.length).replace(/^[\s:.\-–—]+/, ''));
      const parts: string[] = [];
      if (looksLikeName(after) || isNameFragment(after)) parts.push(after);
      // gather continuation rows (stacked name fragments, or a name just below the label)
      for (let j = i + 1; j <= i + maxFollow && j < lines.length; j++) {
        const cand = cleanName(lines[j]);
        if (isNameFragment(cand)) { parts.push(cand); continue; }
        if (!parts.length && looksLikeName(cand) && cand.split(' ').length <= 3) { parts.push(cand); continue; }
        break;
      }
      if (parts.length) {
        const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
        if (looksLikeName(joined) || isNameFragment(joined)) return joined;
      }
    }
  }
  return null;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

// ── Phone numbers (PH mobile) — used as the receiver's contact on GCash ──
// GCash partially masks the number (e.g. "+63 9•••••8626"). A mask is privacy,
// NOT a sign of fraud, so we show it exactly as on the receipt. OCR renders the
// bullets very inconsistently — it drops them ("639 8626"), or reads them as
// repeated letters ("+63 Qeeeee8626") or dots — so we don't try to match the
// bullet characters. Instead we detect the fixed STRUCTURE (the +63/9 prefix and
// the visible last 4 digits) and rebuild the canonical "+63 9•••••XXXX".
const PHONE_RE = /(\+?63[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{4}|\b09\d{2}[\s-]?\d{3}[\s-]?\d{4}\b)/;
// A number printed under a "Source"/"From" label is the PAYER's own account,
// not the recipient's (e.g. Maya's confirm screen: "Source  My Wallet /
// +63 906 …"). Never report it as the receiver's contact.
const PAYER_LABEL = /^\s*(source|from|sender|paid\s+by)\b/i;
function extractPhone(text: string): string | null {
  // 1) fully visible number
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PHONE_RE);
    if (!m) continue;
    if (PAYER_LABEL.test(lines[i]) || (i > 0 && PAYER_LABEL.test(lines[i - 1]))) continue;
    return m[1].replace(/[\s-]+/g, ' ').trim();
  }
  if (PHONE_RE.test(text)) return null;   // only payer numbers were visible
  // 2) masked GCash mobile — only attempt on GCash-style receipts to avoid
  //    mis-reading other digit groups as a phone number.
  const gcashContext = /sent\s+via|total\s+amount\s+sent|gcash|carbon footprint|going digital/i.test(text);
  if (!gcashContext) return null;
  // "63" (opt +/space), an optional "9", a short masked gap (anything non-digit),
  // then exactly the visible last 4 digits.
  const m = text.match(/\+?\s*63\s*9?[^\d\n]{0,16}(\d{4})(?!\d)/);
  if (m) return `+63 9•••••${m[1]}`;
  return null;
}

// GCash shows recipient NAMES in uppercase; the masked middle letters are bullets.
// OCR renders those bullets as lowercase letters or hyphens, so within an
// otherwise-uppercase name we restore lowercase letters / dashes back to "•".
// Receipts that mask with explicit characters (e.g. MariBank's "Pi****i P.")
// are shown EXACTLY as printed.
function reconstructMaskedName(s: string, gcashStyle = false): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (/[*]/.test(clean)) return clean;          // explicit asterisk mask → show as-is
  if (!gcashStyle) return clean;
  const upper = (clean.match(/[A-Z]/g) || []).length;
  const lower = (clean.match(/[a-z]/g) || []).length;
  const hasDash = /[-–—]/.test(clean);
  if (upper >= 2 && upper > lower && (lower > 0 || hasDash)) {
    return clean
      .replace(/[a-z]/g, '•')
      .replace(/([A-Z0-9•])[-–—]([A-Z0-9•])/g, '$1•$2');
  }
  return clean;
}

// "From <name>" / "To <name>" receipts (MariBank, InstaPay, many banks). The
// label sits at the start of the line; the name may be on the same line or just
// below it, and may be masked with asterisks/bullets.
function fromToName(lines: string[], keyword: 'from' | 'to'): string | null {
  const labelRe = new RegExp(`^\\s*${keyword}\\b[:.\\s]*(.*)$`, 'i');
  const tidy = (v: string) => v
    .replace(/^[^A-Za-z]+/, '')                 // leading icon/punctuation
    .replace(/^[A-Z©@®0-9]\s+(?=[A-Z])/, '')    // a lone icon letter mis-read before the name
    .replace(/\s+/g, ' ').trim();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRe);
    if (!m) continue;
    const same = tidy(m[1]);
    if (maskedNameLike(same)) return reconstructMaskedName(same, false);
    for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
      const v = tidy(lines[j]);
      if (maskedNameLike(v)) return reconstructMaskedName(v, false);
    }
  }
  return null;
}

// ── GCash receiver name: the line just above the phone / "Sent via GCash" ──
function maskedNameLike(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 28) return false;
  if (/sent\s+via|gcash|amount|total|ref\b|php|₱|reference|transaction|receipt|bank|acct|method|fee/i.test(t)) return false;
  if (/^(source|destination|purpose|from|to)\b/i.test(t)) return false; // a label row, not a name
  if (/^[+\d(]/.test(t)) return false;                 // not a phone/number line
  if (/\d{3,}/.test(t)) return false;                  // names don't contain long number runs
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  return letters >= 2 && /^[A-Za-z]/.test(t);          // starts with a letter, has letters
}
function nameAbovePhone(lines: string[]): string | null {
  // Anchor on the phone line (always present on GCash) or a "Sent via" line.
  let anchor = lines.findIndex(l => /sent\s+via/i.test(l));
  if (anchor === -1) anchor = lines.findIndex(l => PHONE_RE.test(l));
  if (anchor === -1) return null;
  for (let i = anchor - 1; i >= 0 && i >= anchor - 3; i--) {
    if (PHONE_RE.test(lines[i])) continue;             // skip the phone line itself
    const cand = lines[i].replace(/[•·∙*°●∘º]/g, '•').replace(/\s+/g, ' ').trim();
    if (maskedNameLike(cand)) return reconstructMaskedName(cand, true);
  }
  return null;
}

// Wallet "success" screens (GCash/Maya purchases, bills, Send Money) print the
// payee on the line(s) right under a headline like "Successfully sent to" or
// "Paid bill", with no "Account Name" label.
function payeeAfterHeadline(lines: string[]): string | null {
  const headline = /^(successfully\s+(sent\s+to|paid\s+for?)|payment\s+received|purchased|paid\s+bill)\b/i;
  for (let i = 0; i < lines.length; i++) {
    if (!headline.test(lines[i])) continue;
    for (let j = i + 1; j <= Math.min(i + 4, lines.length - 1); j++) {
      const v = lines[j].trim();
      if (!v || v.length <= 2) continue;
      if (/(php|₱)\s*-?\s*[\d,]/i.test(v)) break;              // reached the amount line
      if (/^(gcash|maya|paymaya)$/i.test(v)) continue;          // the wallet's own logo text
      // on-screen buttons/status under the headline (an icon often OCRs as a stray letter: "P Share")
      if (/^(\S\s+)?(share|repeat|add to favorites|get help|done|close|completed|processing|download|save|back|ok)\b/i.test(v)) continue;
      if (/^(amount|total|fee|ref(erence)?|date|payment|purchase|transaction|account)\b/i.test(v)) break;
      if (/^[A-Za-z][A-Za-z0-9 .,'&()\-]{2,40}$/.test(v)) return v;
    }
  }
  return null;
}

function extractAmount(text: string): number | null {
  // Some receipts group thousands with dots ("3.500.00") — normalise to commas.
  const norm = text.replace(/\b(\d{1,3})(?:\.(\d{3}))+(\.\d{2})\b/g, m => {
    const parts = m.split('.');
    const cents = parts.pop();
    return parts.join(',') + '.' + cents;
  });
  const toNum = (s: string) => { const v = parseFloat(s.replace(/,/g, '')); return isNaN(v) ? null : v; };
  // Debit screens print the amount with a minus sign ("- ₱400.00").
  const money = '(?:php|₱|p)?\\s*-?\\s*([\\d,]+\\.\\d{2})';
  const labelled = (kw: string): number | null => {
    const m = norm.match(new RegExp(`${kw}[^\\d₱p]{0,12}${money}`, 'i'));
    return m ? toNum(m[1]) : null;
  };
  const principal = labelled('amount\\s*(?:sent|paid|received|due|to\\s*send)?')
                 ?? labelled('transfer\\s*amount')
                 ?? labelled('bill\\s*amount')
                 ?? labelled('you\\s*(?:sent|paid|have\\s*transferred)');
  if (principal != null) return principal;
  const total = labelled('total\\s*amount') ?? labelled('total');
  if (total != null) return total;
  const all = [...norm.matchAll(new RegExp(money, 'gi'))]
    .map(m => toNum(m[1])).filter((n): n is number => n != null);
  if (all.length) return Math.max(...all);
  return null;
}

export function parseReceipt(rawText: string, filename = ''): { data: ExtractedTransactionData; source: EvidenceSource } {
  const text = rawText.replace(/\u00a0/g, ' ');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const source = detectSourceFromText(text, filename);

  const amount = correctPrincipal([text], extractAmount(text));
  const receiverContact = extractPhone(text);

  // Reference / transaction numbers.
  //  • Spaced-digit pattern FIRST (GCash "Ref No. 8041 241 631871") — the
  //    keyword anchor prevents the phone number from being mis-captured.
  //  • Then alphanumeric refs for other institutions.
  const refRaw = firstMatch(text, [
    // Maya "Reference ID  6262 1027 8803" / "4CCD 2075 53B8": groups of four
    // alphanumerics. Must contain a digit so a stray word can't match.
    /ref(?:erence)?\s*id\b\s*[:.\-]?\s*((?=[A-Z0-9 ]*\d)[A-Z0-9]{4}(?: [A-Z0-9]{4}){1,4})(?![A-Z0-9])/i,
    // spaces only (not newlines) inside the digit run, so a reference can't
    // swallow digits from the following line
    /ref(?:erence)?\.?\s*(?:[nm]o\.?|number|#|id)?\s*[:.\-]?\s*(\d[\d ]{8,22}\d)/i,
    // an alphanumeric reference must contain at least one digit — stops plain
    // words (e.g. the label "REFERENCE NUMBER" itself) being captured
    /ref(?:erence)?\.?\s*(?:no\.?|number|#|id|code)?\s*[:.\-]?\s*((?=[A-Z]*\d)[A-Z0-9]{6,24})/i,
  ]);
  const referenceNo = refRaw ? refRaw.replace(/\s+/g, '') : null;

  const txnRaw = firstMatch(text, [
    // ≥5 chars (GoTyme Trace IDs are 6 digits, e.g. "000006"); a space inside
    // is only allowed before another digit, and never a newline — otherwise a
    // short ID runs on into the next row's label ("000006ReferenceNo").
    /(?:transaction|txn|trace|trans)\s*(?:no\.?|number|id|#|code)\s*[:.\-]?\s*([A-Z0-9](?:[A-Z0-9]| (?=\d)){3,22}[A-Z0-9])(?![A-Z0-9])/i,
  ]);
  const transactionId = txnRaw ? txnRaw.replace(/\s+/g, '') : null;

  const date = firstMatch(text, [
    /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4})/i,
    /\b(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*\d{4})/i,
    /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/,
    /\b(\d{4}-\d{2}-\d{2})\b/,
  ]);
  const time = firstMatch(text, [
    /\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm))\b/i,
    /(?:time|at)\s*[:.\-]?\s*(\d{1,2}:\d{2}(?::\d{2})?)\b/i,
  ]);

  // Parties — label-driven for banks; GCash falls back to the top-of-receipt name.
  let receiverName = valueForLabel(lines, [
    'account name', 'recipient name', 'recipient', 'receiver', 'beneficiary',
    'pay to', 'send money to', 'send to', 'received by', 'credit to', 'payee',
  ]);
  if (!receiverName) receiverName = fromToName(lines, 'to');
  if (!receiverName) receiverName = payeeAfterHeadline(lines);
  if (!receiverName) receiverName = nameAbovePhone(lines);

  let senderName = valueForLabel(lines, [
    'account holder', 'sender name', 'sender', 'sent by', 'paid by',
    'source account', 'debited from', 'from account',
  ]);
  if (!senderName) senderName = fromToName(lines, 'from');

  return {
    data: {
      senderName: senderName || null,
      receiverName: receiverName || null,
      receiverContact: receiverContact || null,
      amount,
      date: date ? date.replace(/\s+/g, ' ').trim() : null,
      time: time ? time.replace(/\s+/g, ' ').trim() : null,
      referenceNo: referenceNo || null,
      transactionId: transactionId || null,
      institution: source !== 'Unknown' ? source : null,
    },
    source,
  };
}

// ── Multi-pass field merge ────────────────────────────────────────────────
// Each OCR pass reads different fields best (the sharp pass nails the reference
// number; the binarised pass nails the names). So we parse EVERY pass and, for
// each field, keep the strongest value — by validation, voting across passes,
// and a name-quality score. This is the "compare each field and adjust" step.

function nameQuality(s: string): number {
  const t = s.trim();
  let score = 0;
  if (/\s/.test(t)) score += 2;                                   // multi-part name
  if (/^[A-Z]/.test(t)) score += 1;                               // starts uppercase
  if (/^[A-Z][A-Za-z.'’-]*(\s+[A-Z][A-Za-z.'’-]*)+$/.test(t.replace(/[•*]/g, 'X'))) score += 2; // clean "Word Word"
  score += Math.min((t.match(/[•*]/g) || []).length, 4);          // explicit masks are faithful
  if (/^[a-z]/.test(t)) score -= 2;                               // lowercase start = likely mangled
  if (!/\s/.test(t) && t.replace(/[^A-Za-z]/g, '').length > 5) score -= 2; // one long blob ("JUANDLC")
  score += (t.match(/[A-Za-z]/g) || []).length * 0.05;
  return score;
}

function pickName(cands: (string | null)[]): string | null {
  const vals = cands.filter((v): v is string => !!v && v.trim().length > 0);
  if (!vals.length) return null;
  const votes = new Map<string, number>();
  for (const v of vals) votes.set(v, (votes.get(v) || 0) + 1);
  return [...vals].sort((a, b) => {
    const q = nameQuality(b) - nameQuality(a);
    if (Math.abs(q) > 0.001) return q;
    return (votes.get(b)! - votes.get(a)!);
  })[0];
}

function mode<T>(cands: (T | null | undefined)[]): T | null {
  const vals = cands.filter((v): v is T => v !== null && v !== undefined);
  if (!vals.length) return null;
  const m = new Map<string, { v: T; n: number }>();
  for (const v of vals) {
    const k = String(v);
    const e = m.get(k);
    if (e) e.n++; else m.set(k, { v, n: 1 });
  }
  return [...m.values()].sort((a, b) => b.n - a.n)[0].v;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// Reference numbers are THE legitimacy check, and the OCR passes often
// disagree by a single misread digit ("…539162" vs "…530162"). Choose:
//   1. a value read identically by more passes than any other;
//   2. otherwise the CONSENSUS read — the one closest (total edit distance)
//      to all the other reads, so even a truncated read ("300460753962")
//      votes for the digits it did get right;
//   3. remaining ties → the earliest pass (passes arrive best-confidence first),
//      then the more complete read.
function pickReference(cands: (string | null)[]): string | null {
  const vals = cands.filter((v): v is string => !!v);
  if (!vals.length) return null;
  const votes = new Map<string, number>();
  for (const v of vals) votes.set(v, (votes.get(v) || 0) + 1);
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 1 || ranked[0][1] > ranked[1][1]) return ranked[0][0];
  const distinct = [...votes.keys()];
  const cost = (v: string) => vals.reduce((s, o) => s + editDistance(v, o), 0);
  return distinct
    .map((v, order) => ({ v, order, cost: cost(v), len: v.replace(/\D/g, '').length }))
    .sort((a, b) => a.cost - b.cost || a.order - b.order || b.len - a.len)[0].v;
}

export function parseReceiptMulti(texts: string[], filename = ''): { data: ExtractedTransactionData; source: EvidenceSource } {
  const list = (texts || []).filter(t => t && t.trim().length > 0);
  if (list.length <= 1) return parseReceipt(list[0] || '', filename);

  const parsed = list.map(t => parseReceipt(t, filename));
  const D = parsed.map(p => p.data);
  // Issuer from ALL passes together, not a per-pass vote: a faint "Sent via
  // GCash" line may be read by only one pass, while the others see just the
  // destination bank — a majority vote would then pick the destination.
  const source: EvidenceSource = detectSourceFromText(list.join('\n'), filename);

  const data: ExtractedTransactionData = {
    senderName: pickName(D.map(d => d.senderName)),
    receiverName: pickName(D.map(d => d.receiverName)),
    receiverContact: mode(D.map(d => d.receiverContact)),
    amount: correctPrincipal(list, mode(D.map(d => d.amount))),
    date: mode(D.map(d => d.date)),
    time: mode(D.map(d => d.time)),
    referenceNo: pickReference(D.map(d => d.referenceNo)),
    transactionId: mode(D.map(d => d.transactionId)),
    institution: source !== 'Unknown' ? source : null,
  };
  return { data, source };
}

// ── Edited-amount detector ────────────────────────────────────────────────
// Flags when the SAME value is written two different ways on one receipt
// (e.g. "4,500.00" in one field and "4500.00" in another). Genuine receipts
// format every amount identically, so this mismatch is a real edit tell. It
// uses the most common reading across OCR passes, so an occasional dropped
// comma from OCR noise does not raise a false alarm.
function rawAmountStr(text: string, kw: string): string | null {
  const m = text.match(new RegExp(`${kw}[^\\d₱p]{0,12}(?:php|₱|p)?\\s*([\\d,]+\\.\\d{2})`, 'i'));
  return m ? m[1] : null;
}
const hasGrouping = (s: string) => /^\d{1,3}(,\d{3})+\.\d{2}$/.test(s);
const missingGrouping = (s: string) => /^\d{4,}\.\d{2}$/.test(s);
function modeStr(arr: string[]): string | null {
  if (!arr.length) return null;
  const m = new Map<string, number>();
  for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
export function amountFormattingSignal(texts: string[]): { suspicious: boolean; detail: string } {
  const list = (texts || []).filter(t => t && t.trim());
  const amts: string[] = [], totals: string[] = [];
  for (const t of list) {
    const a = rawAmountStr(t, 'amount\\s*(?:sent|paid|received)?');
    const tot = rawAmountStr(t, 'total\\s*amount');
    if (a) amts.push(a);
    if (tot) totals.push(tot);
  }
  const a = modeStr(amts), tot = modeStr(totals);
  if (!a || !tot) return { suspicious: false, detail: '' };
  const va = parseFloat(a.replace(/,/g, '')), vt = parseFloat(tot.replace(/,/g, ''));
  if (isNaN(va) || isNaN(vt) || va !== vt || va < 1000) return { suspicious: false, detail: '' };
  if ((hasGrouping(a) && missingGrouping(tot)) || (hasGrouping(tot) && missingGrouping(a))) {
    return {
      suspicious: true,
      detail: `The amount appears two different ways on this receipt — "${a}" and "${tot}". A genuine GCash receipt formats every amount identically, so this mismatch can indicate the amount text was edited. Verify the figure inside your own account.`,
    };
  }
  return { suspicious: false, detail: '' };
}
