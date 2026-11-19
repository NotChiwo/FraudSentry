// ============================================================
// Text model: turning a message into features
//
// 1. Normalise: lower case; replace things whose exact value does not
//    matter by a placeholder token, so the model learns the KIND of thing:
//      a link on a shortener      → __shortlink__
//      a link on a risky domain   → __risklink__   (.xyz .top .vip … or a
//                                    brand name inside a look-alike domain)
//      any other link             → __link__
//      a PH mobile number         → __phone__
//      a peso amount              → __amount__
//      a 4–8 digit code           → __code__
//      a long number (reference)  → __number__
// 2. Split into words (letters, digits, apostrophes, hyphens).
// 3. Features = the words (unigrams) and each pair of neighbouring words
//    (bigrams, "send_otp", "account_suspended"), each counted once per
//    message (binary bag of words).
// ============================================================

const RISKY_TLD = /\.(xyz|top|vip|cfd|help|online|site|icu|club|live|info|monster|buzz|shop|click|link|net)\b/;
const SHORTENER = /\b(bit\.ly|tinyurl\.com|cutt\.ly|is\.gd|rb\.gy|s\.id|t\.co|goo\.gl|ow\.ly)\b/;
const URL = /\b((?:https?:\/\/|www\.)\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ph|net|org|xyz|top|vip|cfd|help|online|site|icu|club|live|info|ly|gd|id|me|io|gl|co|monster|buzz|shop|click|link)(?:\/\S*)?)/gi;
const BRAND_IN_HOST = /(gcash|maya|bdo|bpi|metrobank|unionbank|landbank|securitybank|shopee|lazada|gotyme|rcbc|pnb|dswd|sss|lbc|netflix|easytrip|ub)/;
const OFFICIAL_HOST = /(^|\.)(gcash\.com|maya\.ph|bdo\.com\.ph|bpi\.com\.ph|metrobank\.com\.ph|unionbankph\.com|landbank\.com|securitybank\.com|shopee\.ph|gotyme\.com\.ph|rcbc\.com|pnb\.com\.ph|lazada\.com\.ph|gov\.ph)$/;

function linkToken(raw: string): string {
  const host = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (SHORTENER.test(host)) return ' __shortlink__ ';
  if (OFFICIAL_HOST.test(host)) return ' __officiallink__ ';
  if (RISKY_TLD.test(host) || (BRAND_IN_HOST.test(host) && /-/.test(host))) return ' __risklink__ ';
  return ' __link__ ';
}

export function normalise(text: string): string {
  return text
    .replace(URL, m => linkToken(m))
    .toLowerCase()
    .replace(/(\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g, ' __phone__ ')
    .replace(/(₱|php\s?|p)\s?\d{1,3}(,\d{3})*(\.\d{2})?\b|\b\d{1,3}(,\d{3})+(\.\d{2})?\b|\b\d+(\.\d+)?k\b|\b\d+\s?pesos\b/g, ' __amount__ ')
    .replace(/\b\d{9,}\b/g, ' __number__ ')
    .replace(/\b\d{4,8}\b/g, ' __code__ ');
}

export function tokens(text: string): string[] {
  return normalise(text).match(/__[a-z]+__|[a-zñ0-9][a-zñ0-9'-]*/g) ?? [];
}

// Common function words (English and Tagalog) carry no meaning on their own,
// so they are not features by themselves; they still count inside two-word
// phrases ("send the", "na ako", "ng [amount]").
export const STOPWORDS = new Set((
  'a an the and or but if of to in on at by for from with as is are was were be been am it its this that these those ' +
  'i you he she we they me him her us them my your his our their do does did will would can could should has have had ' +
  'not no so too very just also than then there here what which who when where how all any some up out about into over ' +
  'ang ng mga sa si ni na pa po ko mo ka ako ikaw siya kami tayo kayo sila ito iyan yan yun yung iyon ay at para lang din ' +
  'rin naman nga ba kasi pag kung may mag nang ni nyo niyo ninyo natin namin nila kanina'
).split(' '));

/** The message's features: unigrams (not function words) and bigrams, each once. */
export function features(text: string): string[] {
  const t = tokens(text);
  const out = new Set(t.filter(w => !STOPWORDS.has(w)));
  for (let i = 0; i + 1 < t.length; i++) out.add(`${t[i]} ${t[i + 1]}`);
  return [...out];
}
