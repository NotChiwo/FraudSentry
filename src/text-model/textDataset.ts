// ============================================================
// FraudSentry — the text model's training data (synthetic, seeded)
//
// A labelled set of Philippine SMS / chat messages, generated from
// templates in English, Tagalog and Taglish with randomly filled slots
// (bank or e-wallet, amount, link, phone number, name, courier …) and small
// variations (letter case, "po", punctuation, typos). Label 1 = scam,
// 0 = legitimate. Each message keeps its category and template id.
//
// The legitimate side deliberately includes the messages that LOOK risky
// but are not: real OTP texts ("never share this code"), bank and e-wallet
// transaction notices with amounts, official links, delivery updates, and
// everyday buy-and-sell chat. The scam side includes scams with no link at
// all (wrong-send refunds, "new number", task jobs), so the model cannot
// just learn "link = scam".
//
// Synthetic data proves the training method and what the model learns; it
// is not a substitute for real collected messages (see HANDWRITTEN_TEST
// in handwrittenTest.ts for messages written separately, never trained on).
// Names, numbers and links are made up.
// ============================================================
import { makeRng } from '../random-forest/randomForest';

export interface TextSample { text: string; label: 0 | 1; category: string; template: string; /** the label was flipped on purpose (label noise) */ flipped?: boolean }

const BRANDS = ['GCash', 'Maya', 'BDO', 'BPI', 'Metrobank', 'UnionBank', 'Landbank', 'Security Bank', 'ShopeePay', 'GoTyme', 'RCBC', 'PNB'];
const OFFICIAL: Record<string, string> = {
  GCash: 'gcash.com', Maya: 'maya.ph', BDO: 'bdo.com.ph', BPI: 'bpi.com.ph', Metrobank: 'metrobank.com.ph', UnionBank: 'unionbankph.com',
  Landbank: 'landbank.com', 'Security Bank': 'securitybank.com', ShopeePay: 'shopee.ph', GoTyme: 'gotyme.com.ph', RCBC: 'rcbc.com', PNB: 'pnb.com.ph',
};
const TLDS = ['xyz', 'top', 'vip', 'cfd', 'help', 'online', 'site', 'icu', 'club', 'live', 'info', 'com-ph.net'];
const SLUG_WORDS = ['verify', 'secure', 'login', 'update', 'support', 'rewards', 'claim', 'online', 'help', 'ph', 'account', 'promo'];
const SHORTENERS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 'rb.gy', 's.id'];
const FIRST = ['Juan', 'Maria', 'Jose', 'Ana', 'Mark', 'Liza', 'Carlo', 'Grace', 'Ramon', 'Bea', 'Tony', 'Nina', 'Rico', 'Joy', 'Paolo', 'Kim', 'Ella', 'Jun'];
const LAST = ['Dela Cruz', 'Santos', 'Reyes', 'Garcia', 'Bautista', 'Lim', 'Tan', 'Cruz', 'Diaz', 'Mendoza', 'Ramos', 'Torres'];
const COURIERS = ['LBC', 'J&T Express', 'Ninja Van', 'Flash Express', 'PHLPost', '2GO', 'Lalamove'];
const ITEMS = ['iPhone 13', 'rice cooker', 'electric fan', 'school shoes', 'gaming chair', 'Lazada parcel', 'laptop bag', 'aircon', 'bike', 'perfume set', 'phone case', 'milk tea set'];
const STORES = ['SM', 'Jollibee', 'Mercury Drug', 'Puregold', 'Shopee', 'Lazada', 'Meralco', 'Globe', 'Smart', 'PLDT'];
const RELATIVES = ['Ma', 'Pa', 'Tita', 'Kuya', 'Ate', 'Bes', 'Pre', 'Lola', 'Insan'];

/** One generator: a seeded random source and slot fillers. */
function makeFill(seed: number) {
  const rng = makeRng(seed);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rng() * a.length)];
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rng() * 10)).join('');
  const alnum = (n: number) => Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(rng() * 31)]).join('');
  const amount = (lo: number, hi: number) => {
    const v = Math.round((lo + rng() * (hi - lo)) / 10) * 10;
    const s = v.toLocaleString('en-US');
    return pick([`P${s}`, `PHP ${s}`, `₱${s}`, `P${s}.00`, `${s} pesos`]);
  };
  const phone = () => pick(['09', '+639', '639']) + pick(['17', '18', '27', '55', '66', '77', '95', '98', '20', '61']) + pick(['', ' ', '-']) + digits(3) + pick(['', ' ', '-']) + digits(4);
  const name = () => `${pick(FIRST)} ${pick(LAST)}`;
  const brand = () => pick(BRANDS);
  const scamLink = (b?: string) => {
    const slug = (b ?? brand()).toLowerCase().replace(/\s+/g, '');
    return pick([
      `http://${slug}-${pick(SLUG_WORDS)}.${pick(TLDS)}/${pick(SLUG_WORDS)}`,
      `https://${pick(SLUG_WORDS)}-${slug}.${pick(TLDS)}`,
      `${pick(SHORTENERS)}/${alnum(6)}`,
      `https://${pick(SHORTENERS)}/${alnum(7)}`,
      `www.${slug}${pick(['ph', '-ph', 'online', 'help'])}.${pick(TLDS)}`,
    ]);
  };
  const officialLink = (b: string) => pick([`https://www.${OFFICIAL[b]}`, `${OFFICIAL[b]}`, `https://${OFFICIAL[b]}/help`]);
  const code = () => digits(6);
  const time = () => pick(['within 24 hours', 'today', 'within 2 hours', 'before 5PM today', 'ngayong araw', 'in 30 minutes', 'by midnight']);
  return { rng, pick, digits, alnum, amount, phone, name, brand, scamLink, officialLink, code, time };
}
type Fill = ReturnType<typeof makeFill>;
type Template = { id: string; make: (f: Fill) => string };

// ── Scam templates ─────────────────────────────────────────
const SCAM: Record<string, Template[]> = {
  'Phishing link': [
    { id: 'ph1', make: f => { const b = f.brand(); return `${b}: Your account has been suspended due to unusual activity. Verify your identity at ${f.scamLink(b)} ${f.time()} to avoid permanent deactivation.`; } },
    { id: 'ph2', make: f => { const b = f.brand(); return `[${b}] Your ${f.pick(['points', 'rewards', 'GCredit', 'cashback'])} worth ${f.amount(500, 8000)} will expire ${f.time()}. Redeem now: ${f.scamLink(b)}`; } },
    { id: 'ph3', make: f => { const b = f.brand(); return `Dear ${b} client, we detected a login from a new device. If this was not you, click this link to secure your account: ${f.scamLink(b)}`; } },
    { id: 'ph4', make: f => { const b = f.brand(); return `${b} ALERT: Hindi pa verified ang account mo. I-update ang iyong details dito ${f.scamLink(b)} para hindi ma-block.`; } },
    { id: 'ph5', make: f => `Your ${f.brand()} KYC is incomplete. Complete your verification at ${f.scamLink()} or your wallet will be limited ${f.time()}.` },
  ],
  'OTP request': [
    { id: 'otp1', make: () => `Hi po, na-send ko po by mistake yung code sa number niyo. Pakisend na lang po yung 6-digit code na natanggap niyo, salamat po.` },
    { id: 'otp2', make: f => { const b = f.brand(); return `This is ${b} customer service. To process your refund of ${f.amount(1000, 20000)}, please reply with the OTP we just sent to your number.`; } },
    { id: 'otp3', make: f => `Good day! For verification of your ${f.brand()} account, kindly send the verification code you received. Our agent ${f.name()} will assist you.` },
    { id: 'otp4', make: f => `Bes pa-send naman ng OTP na dumating sa phone mo, para sa ${f.pick(['load', 'GCash', 'account ko', 'order ko'])} lang, nagkamali ako ng number.` },
    { id: 'otp5', make: f => `${f.brand()}: Your account will be locked. Provide your MPIN and OTP to our verification officer at ${f.phone()} to keep it active.` },
  ],
  'Prize / raffle': [
    { id: 'pr1', make: f => `CONGRATULATIONS! Your number won ${f.amount(10000, 100000)} in the ${f.pick(['GCash', 'Maya', 'Shopee', 'DTI', 'Jollibee'])} anniversary raffle. To claim, send the processing fee of ${f.amount(300, 2000)} to ${f.phone()}.` },
    { id: 'pr2', make: f => `Ikaw ay nanalo ng ${f.pick(['brand new motorcycle', 'P50,000 cash', 'iPhone 15', 'grocery package'])}! Text ${f.name()} sa ${f.phone()} para ma-claim ang premyo. DTI permit no. ${f.digits(5)}.` },
    { id: 'pr3', make: f => `You have been selected as a lucky winner of ${f.amount(5000, 75000)}. Claim your prize here: ${f.scamLink()} Offer valid ${f.time()} only.` },
  ],
  'Task / job scam': [
    { id: 'job1', make: f => `Earn ${f.amount(500, 3000)} daily by liking videos and following pages from home! No experience needed. Message us on Telegram ${f.pick(['@', 't.me/'])}${f.alnum(8)} to start your first task.` },
    { id: 'job2', make: f => `Hi! We are hiring part-time online staff, ${f.amount(800, 2500)}/day, 10-30 mins lang. Interested? Add our HR on WhatsApp ${f.phone()}.` },
    { id: 'job3', make: f => `Hello, I am ${f.name()} from ${f.pick(['Lazada', 'Shopee', 'TikTok', 'Amazon'])} recruitment. Simple order tasks, get commission instantly. First task free, then top-up ${f.amount(200, 1000)} to unlock higher commission.` },
    { id: 'job4', make: f => `Kailangan ng home-based encoder, sahod ${f.amount(15000, 40000)}/month. Magbayad lang ng ${f.amount(300, 1500)} registration fee para sa training kit.` },
  ],
  'Wrong-send refund': [
    { id: 'ws1', make: f => `Hi po, I accidentally sent you ${f.amount(1000, 10000)} sa GCash niyo. Pwede po pakibalik sa number na ito ${f.phone()}? Pambayad ko po sana sa ospital, salamat po.` },
    { id: 'ws2', make: f => `Good evening, nagkamali po ako ng send ng ${f.amount(500, 8000)}. Paki-return na lang po sa ${f.phone()} kasi para sa tuition ng anak ko. God bless po.` },
    { id: 'ws3', make: f => `Sir/Ma'am, ${f.amount(2000, 15000)} was wrongly transferred to your ${f.brand()} account. Please send it back to ${f.phone()} ${f.time()} or we will file a case.` },
  ],
  'Parcel / customs fee': [
    { id: 'pc1', make: f => `${f.pick(COURIERS)}: Your parcel is on hold due to unpaid customs fee of ${f.amount(100, 600)}. Pay ${f.time()} at ${f.scamLink()} or it will be returned to sender.` },
    { id: 'pc2', make: f => `PHLPost: We tried to deliver your package but the address is incomplete. Update your address and pay the ${f.amount(50, 200)} redelivery fee: ${f.scamLink()}` },
    { id: 'pc3', make: f => `May padala po kayo galing abroad na naka-hold sa customs. Magbayad ng clearance fee na ${f.amount(1500, 9000)} sa ${f.phone()} para ma-release.` },
  ],
  'Loan scam': [
    { id: 'ln1', make: f => `Approved ka na sa ${f.amount(10000, 100000)} loan! No collateral, 0% interest. Magbayad lang ng ${f.amount(300, 2000)} processing fee para ma-release ngayon.` },
    { id: 'ln2', make: f => `Need cash fast? Get up to ${f.amount(20000, 50000)} in 5 minutes, no requirements. Apply here ${f.scamLink()} and pay the insurance fee first.` },
  ],
  'Investment scam': [
    { id: 'iv1', make: f => `Invest ${f.amount(1000, 5000)} today and get ${f.amount(10000, 50000)} after 7 days! Guaranteed return, legit and DTI registered. Message ${f.name()} at ${f.phone()}.` },
    { id: 'iv2', make: f => `Double your money in 24 hours with our crypto trading bot. Minimum ${f.amount(500, 3000)}. Join our Telegram group now, limited slots only!` },
    { id: 'iv3', make: f => `Paluwagan with 30% weekly interest, sure kita! Pay-in ${f.amount(1000, 10000)} sa ${f.brand()} ${f.phone()}, payout every Friday.` },
  ],
  'Impersonation / new number': [
    { id: 'im1', make: f => `${f.pick(RELATIVES)}, bago kong number ito. Nasira phone ko. Pwede pa-send muna ng ${f.amount(1000, 5000)} sa ${f.brand()} ko ${f.phone()}, emergency lang, babayaran ko bukas.` },
    { id: 'im2', make: f => `Hi ${f.pick(RELATIVES)}! This is my new number. I'm in trouble and need ${f.amount(2000, 10000)} right now, please send to ${f.phone()} and don't tell anyone yet.` },
    { id: 'im3', make: f => `Good day, this is from the office of ${f.pick(['Mayor', 'Congressman', 'Senator', 'Governor'])} ${f.pick(LAST)}. You are a beneficiary of ${f.amount(5000, 20000)} ayuda. Send ${f.amount(200, 800)} for processing to ${f.phone()}.` },
    { id: 'im4', make: f => `DSWD: You are qualified for the ${f.amount(3000, 15000)} cash assistance. Register now at ${f.scamLink('dswd')} ${f.time()}.` },
  ],
  'Marketplace scam': [
    { id: 'mk1', make: f => `Reserved na po sa inyo yung ${f.pick(ITEMS)}, pero kailangan muna ng ${f.amount(500, 3000)} downpayment via ${f.brand()} bago ko i-ship. Marami pong nag-iinquire.` },
    { id: 'mk2', make: f => `Hello buyer, I already sent the payment for your ${f.pick(ITEMS)}. Please check your email and click the link to receive the money: ${f.scamLink()}` },
    { id: 'mk3', make: f => `Sir pa-confirm na po ng payment, na-send ko na ${f.amount(1000, 30000)} via ${f.brand()}, screenshot attached. Pa-ship na po agad, rush lang po.` },
  ],
};

// ── Legitimate templates ───────────────────────────────────
const LEGIT: Record<string, Template[]> = {
  'Real OTP notice': [
    { id: 'lo1', make: f => `${f.code()} is your ${f.brand()} verification code. Never share this code with anyone, including ${f.brand()} employees.` },
    { id: 'lo2', make: f => `Your one-time PIN is ${f.code()}. It expires in 5 minutes. Do not share your OTP with anyone.` },
    { id: 'lo3', make: f => `${f.brand()}: Use ${f.code()} to log in. Huwag ibigay ang code na ito kahit kanino. If you did not request this, ignore this message.` },
  ],
  'Transaction notice': [
    { id: 'lt1', make: f => `You have received ${f.amount(100, 20000)} from ${f.name().toUpperCase()}. Your new balance is ${f.amount(200, 50000)}. Ref. No. ${f.digits(13)}.` },
    { id: 'lt2', make: f => `${f.brand()}: You have sent ${f.amount(100, 10000)} to ${f.phone()} on ${f.pick(['Nov', 'Oct', 'Dec'])} ${1 + Math.floor(f.rng() * 28)}. Ref No. ${f.digits(12)}.` },
    { id: 'lt3', make: f => `Your payment of ${f.amount(300, 8000)} to ${f.pick(STORES)} was successful. Ref ${f.digits(10)}. Thank you for using ${f.brand()}.` },
    { id: 'lt4', make: f => `${f.brand()}: A purchase of ${f.amount(100, 15000)} was made using your card ending ${f.digits(4)}. If you did not make this, call the number on the back of your card.` },
  ],
  'Official advisory': [
    { id: 'la1', make: f => { const b = f.brand(); return `${b} will never ask for your OTP, MPIN or password. Report suspicious messages through the official app or ${f.officialLink(b)}.`; } },
    { id: 'la2', make: f => { const b = f.brand(); return `${b} scheduled maintenance on Sunday, 1AM to 4AM. Some services may be unavailable. Thank you for your patience.`; } },
    { id: 'la3', make: f => { const b = f.brand(); return `Mag-ingat sa mga scam! Hindi kailanman hihingin ng ${b} ang iyong OTP o MPIN sa text, tawag o chat.`; } },
  ],
  'Delivery update': [
    { id: 'ld1', make: f => `${f.pick(COURIERS)}: Your parcel ${f.alnum(10).toUpperCase()} is out for delivery today. Please prepare the exact amount if COD.` },
    { id: 'ld2', make: f => `Hi! Your order of ${f.pick(ITEMS)} has been shipped and will arrive in 2-3 days. Track it in the app.` },
    { id: 'ld3', make: f => `Rider po ito ng ${f.pick(COURIERS)}, nasa labas na po ako ng gate niyo, COD ${f.amount(200, 3000)} po.` },
  ],
  'Buy and sell chat': [
    { id: 'lb1', make: f => `Hi, available pa po ba yung ${f.pick(ITEMS)}? Pwede po meet-up sa ${f.pick(['SM', 'Robinsons', 'MRT station', 'Ayala'])} bukas?` },
    { id: 'lb2', make: f => `Sent na po yung bayad ${f.amount(300, 5000)}, pa-check na lang po. Salamat!` },
    { id: 'lb3', make: f => `Received po, salamat sa pag-order! Ipapadala ko po bukas ng umaga ang ${f.pick(ITEMS)}.` },
    { id: 'lb4', make: f => `Magkano po last price ng ${f.pick(ITEMS)}? COD po ba or meet-up?` },
  ],
  'Personal chat': [
    { id: 'lp1', make: f => `${f.pick(RELATIVES)}, pauwi na ako. Pasabay naman ng ${f.pick(['tinapay', 'ulam', 'gamot', 'load'])} pag dumaan ka.` },
    { id: 'lp2', make: f => `Happy birthday ${f.pick(FIRST)}! Ingat palagi and God bless. Kita tayo sa Sabado.` },
    { id: 'lp3', make: f => `Nabayaran ko na yung kuryente, ${f.amount(800, 4000)}. Ikaw na sa tubig ha.` },
    { id: 'lp4', make: f => `Meeting moved to ${f.pick(['2PM', '3PM', '10AM'])} tomorrow, same room. Please bring the printed report.` },
    { id: 'lp5', make: () => `Thanks for lunch kanina! Next time ako naman manlibre.` },
  ],
  'Real job posting': [
    { id: 'lj1', make: f => `We are hiring ${f.pick(['service crew', 'cashiers', 'a sales associate', 'warehouse staff', 'a part-time tutor'])} for our ${f.pick(['Makati', 'Quezon City', 'Pasig', 'Cebu', 'Davao'])} branch. Walk-in applicants welcome ${f.pick(['Mon to Fri', 'weekdays', 'Monday to Saturday'])}, bring your resume.` },
    { id: 'lj2', make: f => `Hi ${f.pick(FIRST)}, thank you for applying. Your interview is scheduled on ${f.pick(['Monday', 'Tuesday', 'Thursday'])} at ${f.pick(['9AM', '1PM', '3PM'])} at our office. Please bring a valid ID.` },
    { id: 'lj3', make: f => `Job opening: ${f.pick(['admin assistant', 'IT support', 'bookkeeper', 'delivery rider'])}. Send your CV to our HR email. We never charge any fee from applicants.` },
  ],
  'Errands and offices': [
    { id: 'le1', make: f => `Nakapag-renew na ako ng ${f.pick(['lisensya sa LTO', 'passport sa DFA', 'NBI clearance', 'barangay clearance'])} kanina, ang haba ng pila pero ok na.` },
    { id: 'le2', make: f => `I went to the ${f.pick(['LTO', 'SSS', 'BIR', 'city hall', 'Pag-IBIG'])} office ${f.pick(['this morning', 'yesterday', 'last week'])} to ${f.pick(['pay the fine', 'update my records', 'file my papers', 'get my ID'])}. All done.` },
    { id: 'le3', make: f => `Paid the ${f.pick(['parking ticket', 'association dues', 'tuition', 'water bill'])} already, ${f.amount(200, 5000)}. Receipt is with me.` },
  ],
  'Legit promo / bill': [
    { id: 'lm1', make: f => `${f.pick(['Globe', 'Smart', 'PLDT', 'Meralco', 'Converge'])}: Your bill of ${f.amount(500, 5000)} is due on the 15th. Pay through the official app to avoid interruption.` },
    { id: 'lm2', make: f => `${f.pick(STORES)}: Enjoy 20% off this weekend in all branches. See the app for details. Text STOP to unsubscribe.` },
    { id: 'lm3', make: f => `Your ${f.pick(['load', 'promo', 'data plan'])} of ${f.amount(50, 999)} has been successfully registered. Valid for 30 days.` },
  ],
};

// small, realistic variations so the same template does not repeat word for word
function vary(text: string, f: Fill): string {
  let t = text;
  if (f.rng() < 0.15) t = t.toUpperCase();
  else if (f.rng() < 0.12) t = t.toLowerCase();
  if (f.rng() < 0.2) t = t.replace(/\.(\s|$)/, f.pick(['!', '!!', '.', ' po.']) + '$1');
  if (f.rng() < 0.15) t = f.pick(['Hi! ', 'Hello, ', 'Good day! ', 'Gud pm. ', '']) + t;
  if (f.rng() < 0.1) { const i = Math.floor(f.rng() * t.length); t = t.slice(0, i) + t.slice(i + 1); }   // a typo
  return t.replace(/\s{2,}/g, ' ').trim();
}

export const SCAM_CATEGORIES = Object.keys(SCAM);
export const LEGIT_CATEGORIES = Object.keys(LEGIT);
export const TEMPLATE_COUNT = Object.values(SCAM).flat().length + Object.values(LEGIT).flat().length;

/**
 * The synthetic dataset: `size` messages, half scam and half legitimate,
 * spread evenly over the categories, then shuffled. Seeded: the same seed
 * always gives the same messages. `labelNoise` flips that share of labels
 * (real labels are never perfect).
 */
export function generateTextDataset(size = 2400, seed = 42, labelNoise = 0.02): TextSample[] {
  const f = makeFill(seed);
  const out: TextSample[] = [];
  const seen = new Set<string>();
  const half = Math.floor(size / 2);
  const side = (groups: Record<string, Template[]>, label: 0 | 1, n: number) => {
    const cats = Object.keys(groups);
    let tries = 0;
    for (let i = 0; i < n && tries < n * 20; tries++) {
      const category = cats[i % cats.length];
      const t = f.pick(groups[category]);
      const text = vary(t.make(f), f);
      if (seen.has(text)) continue;   // no duplicate messages (they would leak between train and test)
      seen.add(text);
      out.push({ text, label, category, template: t.id });
      i++;
    }
  };
  side(SCAM, 1, half);
  side(LEGIT, 0, size - half);
  for (const s of out) if (f.rng() < labelNoise) { s.label = (1 - s.label) as 0 | 1; s.flipped = true; }
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(f.rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** The dataset as CSV (text, label, category, template), for the panel / a spreadsheet. */
export function datasetToCsv(rows: TextSample[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return ['text,label,category,template', ...rows.map(r => [q(r.text), r.label, q(r.category), r.template].join(','))].join('\n');
}
