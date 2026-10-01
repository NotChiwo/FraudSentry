// Dev-only: builds REDACTED test fixtures from a real OCR corpus.
//   node tools/redact-corpus.cjs <config.json> <corpusDir> <out.json>
//
// The corpus comes from tools/ocr-corpus.mjs (real output of the app's own OCR
// pipeline). Every bit of OCR noise is kept — misreads, spacing, garbage lines,
// line order — but personal data is removed:
//   • names/strings listed in the config are replaced,
//   • e-mail addresses are replaced,
//   • every 3+ digit run (account numbers, phones, references) is scrambled
//     with a digit permutation that keeps 0 and 9 fixed, so number STRUCTURE
//     survives ("+63 9xx…", "09xx…", leading zeros) while the digits change.
//     Money amounts (digits next to "." or ",") and 20xx years are kept.
//
// config.json (keep it OUT of the repo — it contains the real names):
//   { "picks": { "fixture_key": "corpusFilePrefix", ... },
//     "names": [["REAL NAME", "PLACEHOLDER"], ...] }
const fs = require('fs');

const [, , configPath, corpusDir, outPath] = process.argv;
if (!configPath || !corpusDir || !outPath) {
  console.error('usage: node tools/redact-corpus.cjs <config.json> <corpusDir> <out.json>');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = (config.names || []).map(([from, to]) => [new RegExp(esc(from), 'g'), to]);
names.push([/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g, 'juan.sample@example.com']);

const PERM = '0478162359';
const scramble = d => PERM[Number(d)];
function redact(t) {
  for (const [re, v] of names) t = t.replace(re, v);
  return t.replace(/(?<![\d.,])\d{3,}(?![\d.,]\d)/g, m => (/^20\d\d$/.test(m) ? m : m.replace(/\d/g, scramble)));
}

const files = fs.readdirSync(corpusDir);
const out = {};
for (const [key, prefix] of Object.entries(config.picks)) {
  const f = files.find(x => x.startsWith(prefix));
  if (!f) { console.error('no corpus file for', key, prefix); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(`${corpusDir}/${f}`, 'utf8'));
  // keep only the app-assigned screenshot suffix (e.g. Android's "_Maya") — never the original name
  out[key] = { filename: key + (f.includes('_Maya') ? '_Maya.jpg' : '.jpg'), passes: j.passes.map(redact) };
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log('wrote', Object.keys(out).length, 'fixtures');
