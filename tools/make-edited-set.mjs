// Dev-only: build a labelled evaluation set from GENUINE receipt screenshots.
//
//   node tools/make-edited-set.mjs --genuine path/to/genuine-folder --out eval-set
//
// For every genuine screenshot it writes, into --out:
//   <name>.<ext>               the original, unchanged                → genuine
//   <name>-forwarded.jpg       re-saved like a chat app does (75 %,
//                              JPEG quality 70)                        → genuine
//   <name>-amount.png          amount AND total changed to the same
//                              new value (a careful faker)             → fake
//   <name>-amount-only.png     only the first amount changed, the
//                              total left as it was (a careless faker) → fake
//   <name>-date.png            the day of the date changed             → fake
//   <name>-ref-pixelated.png   reference number pixelated              → fake
//   <name>-ref-covered.png     reference number covered with a box
//                              in the text colour                      → fake
//   <name>-name-covered.png    recipient name covered with a black box → fake
//   labels.csv                 file,truth,issuer,amount,reference,edit — ready for
//                              tools/compare-versions.mjs --labels. It is written
//                              BEFORE any scoring, from how each file was made.
//
// Then score a build on the set (see docs/EVALUATION.md):
//   node tools/compare-versions.mjs --build V10=dist-offline/index.html \
//     --receipts eval-set --labels eval-set/labels.csv --features --out eval-out
//
// Fields are found with Tesseract (the same engine the app uses) and edited in
// headless Chromium's canvas: the new digits are drawn in the receipt's own
// text colour, at the measured text height, over the old ones. An edit whose
// field is not found on a receipt is skipped and reported, never guessed.
// These are SIMULATED edits, made by a script; say so when you report figures
// from them, and add hand-made edits (Photoshop, phone editors) if you can.
//
// Keep --out OUT of the repository: it holds your real receipts.
// Requires playwright (not a project dependency): npm i -g playwright
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createWorker } from 'tesseract.js';

const EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i;
const REF_LABEL = /^(re[fl](erence)?\.?|trace|confirmation|transaction)$/i;

function die(msg) { console.error(`make-edited-set: ${msg}`); process.exit(1); }
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--genuine') a.genuine = path.resolve(v());
    else if (k === '--out') a.out = path.resolve(v());
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\nimport ')[0]); process.exit(0); }
    else die(`unknown option ${k} (see --help)`);
  }
  if (!a.genuine || !a.out) die('give --genuine <folder> and --out <folder>');
  if (!fs.existsSync(a.genuine)) die(`folder not found: ${a.genuine}`);
  if (path.resolve(a.out) === path.resolve(a.genuine)) die('--out must be a different folder');
  return a;
}
async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const req = createRequire(path.join(root, 'noop.js'));
    return await import(pathToFileURL(req.resolve('playwright')).href);
  } catch {
    die('playwright is not installed. Run: npm i -g playwright  (then: npx playwright install chromium)');
  }
}
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// ------------------------------------------------------------ fields ----
const box = w => ({ x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/;   // "2,525.00", "₱2525.00", "P215.00"

/** Locate the fields to edit from Tesseract's lines/words. */
function findFields(lines) {
  const f = { amounts: [], ref: null, refText: '', day: null, name: null, issuer: '' };
  const all = lines.map(l => l.text).join('\n');
  f.issuer = /gcash/i.test(all) ? 'GCash' : /maya/i.test(all) ? 'Maya' : /gotyme/i.test(all) ? 'GoTyme' : /\bbpi\b/i.test(all) ? 'BPI' : '';
  for (const [li, l] of lines.entries()) {
    const ws = l.words;
    for (const w of ws) {
      const m = w.text.match(AMOUNT);
      if (m) f.amounts.push({ ...box(w), digits: m[0], value: m[0].replace(/,/g, '') });
    }
    const refAt = ws.findIndex(w => REF_LABEL.test(w.text));
    if (!f.ref && refAt >= 0) {
      const val = ws.slice(refAt + 1).filter(w => /\d{3,}/.test(w.text) && !/:/.test(w.text));
      // value groups that sit together (a reference split "8041 241 631871"), before the date
      const run = [];
      for (const w of val) { if (run.length && w.bbox.x0 - run[run.length - 1].bbox.x1 > 3 * (w.bbox.y1 - w.bbox.y0)) break; run.push(w); }
      if (run.length) {
        f.ref = { x0: run[0].bbox.x0, y0: Math.min(...run.map(w => w.bbox.y0)), x1: run[run.length - 1].bbox.x1, y1: Math.max(...run.map(w => w.bbox.y1)) };
        f.refText = run.map(w => w.text).join('');
      }
    }
    const mAt = ws.findIndex(w => MONTH.test(w.text));
    if (!f.day && mAt >= 0 && /^\d{1,2},?$/.test(ws[mAt + 1]?.text ?? '')) {
      // the comma's tail makes the day's box taller than its digits: take the digit height from the year
      const year = ws[mAt + 2] && /^\d{4}$/.test(ws[mAt + 2].text) ? ws[mAt + 2].bbox : null;
      f.day = { ...box(ws[mAt + 1]), text: ws[mAt + 1].text, digitH: year ? year.y1 - year.y0 : null };
    }
    if (!f.name && /^\+?63/.test(ws[0]?.text ?? '') && li > 0 && /[a-z]/i.test(lines[li - 1].text)) {
      const n = lines[li - 1].words;
      f.name = { x0: Math.min(...n.map(w => w.bbox.x0)), y0: Math.min(...n.map(w => w.bbox.y0)), x1: Math.max(...n.map(w => w.bbox.x1)), y1: Math.max(...n.map(w => w.bbox.y1)) };
    }
  }
  // the transfer amount: the value printed most often (amount + total), else the first
  const count = new Map();
  for (const a of f.amounts) count.set(a.value, (count.get(a.value) ?? 0) + 1);
  f.mainValue = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return f;
}

/** Same length, different leading digit: 2,525.00 → 3,525.00 (keeps the layout). */
function bumpAmount(digits) {
  const i = digits.search(/[1-9]/);
  const d = Number(digits[i]);
  return digits.slice(0, i) + String(d === 9 ? 1 : d + 1) + digits.slice(i + 1);
}
/** A different, still valid day: 16, → 18,  (29 → 26). */
function bumpDay(text) {
  const n = Number(text.replace(',', ''));
  const next = String(n >= 28 ? n - 3 : n + 2).padStart(text.startsWith('0') ? 2 : 1, '0');
  return next + (text.endsWith(',') ? ',' : '');
}

// --------------------------------------------------- canvas edits ----
// Runs inside Chromium. ops: rewrite / pixelate / cover; then encode.
async function editInPage({ src, ops, type, quality, scale }) {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const W = c.width, H = c.height;
  const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const clamp = (b, pad = 0) => ({ x0: Math.max(0, b.x0 - pad), y0: Math.max(0, b.y0 - pad), x1: Math.min(W, b.x1 + pad), y1: Math.min(H, b.y1 + pad) });
  // background: median colour of a 3 px ring outside the box; ink: the pixels farthest from it
  const colours = b => {
    const r = clamp(b, 3), d = ctx.getImageData(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0).data, w = r.x1 - r.x0;
    const ring = [], inside = [];
    for (let i = 0; i < d.length; i += 4) {
      const x = (i / 4) % w + r.x0, y = Math.floor(i / 4 / w) + r.y0, p = [d[i], d[i + 1], d[i + 2]];
      (x < b.x0 || x >= b.x1 || y < b.y0 || y >= b.y1 ? ring : inside).push(p);
    }
    const med = ch => ring.map(p => p[ch]).sort((a, z) => a - z)[ring.length >> 1];
    const bg = [med(0), med(1), med(2)];
    const far = Math.max(...inside.map(p => dist(p, bg)));
    const inkPx = inside.filter(p => dist(p, bg) > 0.7 * far);
    const ink = [0, 1, 2].map(ch => Math.round(inkPx.reduce((s, p) => s + p[ch], 0) / inkPx.length));
    return { bg, ink };
  };
  const rgb = p => `rgb(${p[0]},${p[1]},${p[2]})`;
  const FONT = 'Arial, Helvetica, sans-serif';
  for (const op of ops) {
    const b = op.box;
    if (op.kind === 'pixelate') {
      const r = clamp(b, 2);
      for (let y = r.y0; y < r.y1; y += op.tile) for (let x = r.x0; x < r.x1; x += op.tile) {
        const w = Math.min(op.tile, r.x1 - x), h = Math.min(op.tile, r.y1 - y), d = ctx.getImageData(x, y, w, h).data;
        const s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
        const n = d.length / 4; ctx.fillStyle = rgb(s.map(v => Math.round(v / n))); ctx.fillRect(x, y, w, h);
      }
    } else if (op.kind === 'cover') {
      const { ink } = colours(b);
      ctx.fillStyle = op.colour === 'black' ? '#000' : rgb(ink);
      const r = clamp(b, 3); ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    } else if (op.kind === 'rewrite') {
      const { bg, ink } = colours(b);
      const far = dist(ink, bg);
      const inkShare = (x0, x1) => {
        const xa = Math.max(0, Math.floor(x0)), xb = Math.min(W, Math.ceil(x1));
        if (xb <= xa) return 0;
        const d = ctx.getImageData(xa, b.y0, xb - xa, b.y1 - b.y0).data;
        let n = 0; for (let i = 0; i < d.length; i += 4) if (dist([d[i], d[i + 1], d[i + 2]], bg) > 0.5 * far) n++;
        return n / (d.length / 4);
      };
      // fit the size to the box height from the font's real ink extent (a comma's tail included),
      // then pick the weight whose ink share matches the original in the same place
      let best = null;
      for (const wt of [400, 500, 600, 700, 800]) {
        ctx.font = `${wt} 100px ${FONT}`;
        const m = ctx.measureText(op.text), dm = ctx.measureText('0123456789');
        const size = op.digitH ? 100 * op.digitH / dm.actualBoundingBoxAscent
          : 100 * (b.y1 - b.y0) / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
        const k = size / 100, tw = m.width * k, asc = m.actualBoundingBoxAscent * k;
        const x0 = op.align === 'right' ? b.x1 - tw : b.x0;
        const t = document.createElement('canvas'); t.width = Math.ceil(tw) + 2; t.height = b.y1 - b.y0;
        const tc = t.getContext('2d'); tc.font = `${wt} ${size}px ${FONT}`; tc.textBaseline = 'alphabetic'; tc.fillText(op.text, 0, asc);
        const d = tc.getImageData(0, 0, t.width, t.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
        const score = Math.abs(n / (d.length / 4) - inkShare(x0, x0 + t.width));
        if (!best || score < best.score) best = { wt, size, tw, asc, x0, score };
      }
      // right-aligned amounts keep a "₱" in front; a same-length amount covers the old digits exactly
      const cx0 = op.align === 'right' ? best.x0 : b.x0, cx1 = op.align === 'right' ? b.x1 : Math.max(b.x1, b.x0 + best.tw);
      ctx.fillStyle = rgb(bg);
      ctx.fillRect(Math.floor(cx0) - 2, b.y0 - 2, Math.ceil(cx1 - cx0) + 4, b.y1 - b.y0 + 4);
      ctx.font = `${best.wt} ${best.size}px ${FONT}`; ctx.fillStyle = rgb(ink); ctx.textBaseline = 'alphabetic';
      ctx.fillText(op.text, best.x0, b.y0 + best.asc);
    }
  }
  let out = c;
  if (scale && scale !== 1) {
    out = document.createElement('canvas'); out.width = Math.round(W * scale); out.height = Math.round(H * scale);
    const o = out.getContext('2d'); o.imageSmoothingQuality = 'high'; o.drawImage(c, 0, 0, out.width, out.height);
  }
  return out.toDataURL(type, quality);
}

// -------------------------------------------------------------- main ----
const args = parseArgs(process.argv.slice(2));
const files = fs.readdirSync(args.genuine).filter(f => EXT.has(path.extname(f).toLowerCase())).sort();
if (!files.length) die(`no .png/.jpg/.webp files in ${args.genuine}`);
fs.mkdirSync(args.out, { recursive: true });

const worker = await createWorker('eng', 1, {
  langPath: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../node_modules/@tesseract.js-data/eng/4.0.0_best_int'),
  gzip: true,
  cachePath: fs.mkdtempSync(path.join(os.tmpdir(), 'fs-tess-')),   // not the working folder
});
const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;
const browser = await chromium.launch();
const page = await browser.newPage();

const labels = [], skipped = [];
for (const f of files) {
  const base = path.basename(f, path.extname(f)), file = path.join(args.genuine, f);
  const buf = fs.readFileSync(file);
  const mime = { '.png': 'image/png', '.webp': 'image/webp' }[path.extname(f).toLowerCase()] ?? 'image/jpeg';
  const src = `data:${mime};base64,${buf.toString('base64')}`;
  const { data } = await worker.recognize(file, {}, { blocks: true });
  const lines = data.blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines));
  const fl = findFields(lines);
  const truthFields = { issuer: fl.issuer, amount: fl.mainValue ?? '', reference: fl.refText };

  fs.copyFileSync(file, path.join(args.out, f));
  labels.push({ file: f, truth: 'genuine', ...truthFields, edit: 'none' });

  const write = async (name, ops, { type = 'image/png', quality, scale } = {}) => {
    const url = await page.evaluate(editInPage, { src, ops, type, quality, scale });
    fs.writeFileSync(path.join(args.out, name), Buffer.from(url.split(',')[1], 'base64'));
  };
  await write(`${base}-forwarded.jpg`, [], { type: 'image/jpeg', quality: 0.7, scale: 0.75 });
  labels.push({ file: `${base}-forwarded.jpg`, truth: 'genuine', ...truthFields, edit: 'chat re-save' });

  const fake = async (suffix, edit, ops) => {
    if (!ops) { skipped.push(`${f}: ${edit} (field not found)`); return; }
    await write(`${base}-${suffix}.png`, ops);
    labels.push({ file: `${base}-${suffix}.png`, truth: 'fake', issuer: '', amount: '', reference: '', edit });
  };
  const main = fl.amounts.filter(a => a.value === fl.mainValue);
  // right-aligned, so a "₱" in front (read by OCR or not) is kept
  const rewrite = a => ({ kind: 'rewrite', box: a, text: bumpAmount(a.digits), align: 'right' });
  await fake('amount', 'amount and total changed', main.length ? main.map(rewrite) : null);
  await fake('amount-only', 'amount changed, total not', main.length > 1 ? [rewrite(main[0])] : null);
  await fake('date', 'day of the date changed', fl.day ? [{ kind: 'rewrite', box: fl.day, text: bumpDay(fl.day.text), align: 'left', digitH: fl.day.digitH }] : null);
  await fake('ref-pixelated', 'reference pixelated', fl.ref ? [{ kind: 'pixelate', box: fl.ref, tile: Math.max(6, Math.round((fl.ref.y1 - fl.ref.y0) / 2)) }] : null);
  await fake('ref-covered', 'reference covered (text colour)', fl.ref ? [{ kind: 'cover', box: fl.ref, colour: 'ink' }] : null);
  await fake('name-covered', 'name covered (black box)', fl.name ? [{ kind: 'cover', box: fl.name, colour: 'black' }] : null);
  console.log(`${f}: ${labels.filter(l => l.file.startsWith(base)).length} files  (${fl.issuer || 'issuer ?'}, ₱${fl.mainValue ?? '?'}, ref ${fl.refText || '?'})`);
}
await browser.close(); await worker.terminate();

const cols = ['file', 'truth', 'issuer', 'amount', 'reference', 'edit'];
fs.writeFileSync(path.join(args.out, 'labels.csv'), [cols.join(','), ...labels.map(l => cols.map(k => csvCell(l[k])).join(','))].join('\n') + '\n');
const g = labels.filter(l => l.truth === 'genuine').length;
console.log(`\nWrote ${labels.length} files (${g} genuine, ${labels.length - g} fake) and labels.csv to ${args.out}`);
if (skipped.length) console.log(`Skipped (field not found, nothing guessed):\n  ${skipped.join('\n  ')}`);
console.log('Check a few edited images by eye: an edit that looks obviously wrong should be deleted (and its labels.csv row removed) before scoring.');
