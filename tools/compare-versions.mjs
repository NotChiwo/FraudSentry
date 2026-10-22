// Dev-only: compare two (or more) FraudSentry builds on the SAME evidence.
//
//   node tools/compare-versions.mjs \
//     --build V6=path/to/FraudSentry-V6.html \
//     --build V7=releases/FraudSentry-V7.html \
//     --receipts path/to/receipt-folder  [--labels labels.csv] \
//     [--messages messages.csv] [--out compare-out] \
//     [--timeout 180] [--bypass-csp] [--tesseract-mirror dir] [--headed]
//
// Each build is opened as a local file in headless Chromium and driven the way
// a user would: accept the consent screen, open Transaction Check, upload a
// receipt, press "Verify authenticity". The result is read back from the app's
// own scan history in localStorage, so the script does not depend on any one
// version's page layout. Every build gets a fresh browser profile.
//
// labels.csv (write it BEFORE running — never adjust it after seeing results):
//   file,truth,issuer,amount,reference
//   gcash-01.png,genuine,GCash,1500.00,8041241631871
//   gcash-01-edited.png,fake,GCash,,
//   truth = genuine | fake. issuer/amount/reference may be left blank; a blank
//   field is simply not scored. For an edited fake, leave the fields blank (or
//   give what the receipt now SHOWS if you want to score reading accuracy).
//
// messages.csv:
//   id,truth,text
//   sms-01,scam,"Your GCash account is suspended. Verify at gcash-verify.top"
//   chat-07,normal,"Sige po, bukas ko na kukunin"
//   truth = scam | normal
//
// Output (in --out, default ./compare-out — keep it OUT of the repo, it holds
// the text read from your receipts):
//   results.csv   one row per build × file
//   summary.md    the comparison: field accuracy, catch rate, false alarms,
//                 message accuracy, and every file where the builds disagree.
//
// Options:
//   --bypass-csp        ignore each build's Content-Security-Policy. V6's CSP
//                       blocks Tesseract's WebAssembly, so its OCR hangs. Run
//                       once WITHOUT this flag (what users really got) and once
//                       WITH it (to compare the parsers/scoring on equal OCR).
//   --tesseract-mirror  a folder whose node_modules holds tesseract.js@5.1.1,
//                       tesseract.js-core and @tesseract.js-data/{eng,fil};
//                       requests to cdn.jsdelivr.net are answered from it, so
//                       runs work offline and are not affected by CDN hiccups.
//                         npm i --prefix <dir> tesseract.js@5.1.1 \
//                           tesseract.js-core@5.1.1 @tesseract.js-data/eng@1.0.0 \
//                           @tesseract.js-data/fil@1.0.0 --ignore-scripts
//   --timeout           seconds to wait for one scan before recording "timeout".
//   --fresh-per-receipt scan every receipt in its own fresh browser profile, so no
//                       receipt is judged against the history of the ones before
//                       it ("Earlier Scan Comparison"). Use it for an evaluation
//                       set made with tools/make-edited-set.mjs, where every fake
//                       is a copy of a genuine receipt in the same folder.
//   --features          also write features-<build>.csv: the evidence vector each
//                       scan was scored on + your label, ready for the Model page's
//                       "Upload labelled CSV" (real training data for the forest).
//
// Requires playwright (not a project dependency): npm i -g playwright
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- args ----
function parseArgs(argv) {
  const a = { builds: [], timeout: 180, out: 'compare-out', bypassCsp: false, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--build') {
      const s = v(); const eq = s.indexOf('=');
      if (eq < 1) die(`--build expects NAME=path, got "${s}"`);
      a.builds.push({ name: s.slice(0, eq), file: path.resolve(s.slice(eq + 1)) });
    } else if (k === '--receipts') a.receipts = path.resolve(v());
    else if (k === '--labels') a.labels = path.resolve(v());
    else if (k === '--messages') a.messages = path.resolve(v());
    else if (k === '--out') a.out = path.resolve(v());
    else if (k === '--timeout') a.timeout = Number(v());
    else if (k === '--tesseract-mirror') a.mirror = path.resolve(v());
    else if (k === '--bypass-csp') a.bypassCsp = true;
    else if (k === '--features') a.features = true;
    else if (k === '--fresh-per-receipt') a.fresh = true;
    else if (k === '--headed') a.headed = true;
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\nimport ')[0]); process.exit(0); }
    else die(`unknown option ${k} (see --help)`);
  }
  if (!a.builds.length) die('give at least one --build NAME=path');
  for (const b of a.builds) if (!fs.existsSync(b.file)) die(`build not found: ${b.file}`);
  if (!a.receipts && !a.messages) die('give --receipts <dir> and/or --messages <csv>');
  return a;
}
function die(msg) { console.error(`compare-versions: ${msg}`); process.exit(1); }

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

// ----------------------------------------------------------------- csv ----
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ------------------------------------------------------ browser driving ----
const MIME = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.json': 'application/json', '.traineddata': 'application/octet-stream' };

// cdn.jsdelivr.net/npm/<pkg>[@ver]/<path>  →  <mirror>/node_modules/<pkg>/<path>
function mirrorPath(mirror, url) {
  const m = new URL(url).pathname.match(/^\/npm\/((?:@[^/]+\/)?[^/@]+)(?:@[^/]+)?\/(.+)$/);
  if (!m) return null;
  const p = path.join(mirror, 'node_modules', m[1], m[2]);
  return p.startsWith(path.join(mirror, 'node_modules')) && fs.existsSync(p) ? p : null;
}

async function newContext(browser, args) {
  const ctx = await browser.newContext({ bypassCSP: args.bypassCsp, viewport: { width: 1280, height: 900 } });
  // Accept the RA 10173 consent screen up front (same store key V5–V7 use);
  // acceptConsent() below still clicks through it for builds that differ.
  await ctx.addInitScript(() => {
    try {
      const k = 'fraudsentry-v5-store';
      if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ state: { hasConsented: true }, version: 0 }));
    } catch { /* ignore */ }
  });
  if (args.mirror) {
    await ctx.route('https://cdn.jsdelivr.net/npm/**', async route => {
      const p = mirrorPath(args.mirror, route.request().url());
      if (!p) return route.fulfill({ status: 404, body: 'not in mirror' });
      await route.fulfill({
        status: 200, body: fs.readFileSync(p),
        headers: { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'access-control-allow-origin': '*' },
      });
    });
  }
  return ctx;
}

async function acceptConsent(page) {
  const box = page.locator('input[type=checkbox]').first();
  if (await box.isVisible().catch(() => false)) {
    await box.check().catch(() => {});
    const btn = page.getByRole('button', { name: /continue|agree|accept|proceed|i understand/i }).first();
    await btn.click({ timeout: 3000 }).catch(() => {});
  }
}

// Click the first button matching one of the labels, most specific first, so a
// loose fallback ("Analyze") can't hit the sidebar's "Message Analyzer" link.
async function clickButton(page, labels) {
  for (const name of labels) {
    const b = page.getByRole('button', { name }).first();
    if (await b.isVisible().catch(() => false)) { await b.click(); return true; }
  }
  return false;
}

// Page names changed between versions (V7 "Transaction Check" → V8 "Check
// Receipt"), so each page is found by any of its known labels.
const NAV = {
  receipt: [/^\s*check receipt/i, /transaction check/i],
  message: [/^\s*check message/i, /message analy[sz]er/i],
};

// V9+ builds have local accounts: the tool uses its own account on each
// build's (separate) browser storage, creating it as administrator first time.
const TOOL_USER = 'compare-tool', TOOL_PASSWORD = 'same-evidence-both-builds-9';
async function signInIfAsked(page) {
  const user = page.getByRole('textbox', { name: 'Username', exact: true });
  if (!await user.isVisible({ timeout: 1500 }).catch(() => false)) return;
  const setup = await page.getByRole('button', { name: /create administrator/i }).isVisible().catch(() => false);
  await user.fill(TOOL_USER);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(TOOL_PASSWORD);
  if (setup) await page.getByRole('textbox', { name: 'Repeat password', exact: true }).fill(TOOL_PASSWORD);
  await page.getByRole('button', { name: setup ? /create administrator/i : /^sign in/i }).click();
  await page.locator('.user-chip').waitFor({ timeout: 30000 });
}

async function openPage(page, build, labels) {
  await page.goto(pathToFileURL(build.file).href);
  await acceptConsent(page);
  await signInIfAsked(page);
  if (!await clickButton(page, labels)) throw new Error(`no navigation button matching ${labels.join(' / ')}`);
}

// The app's persisted history, wherever (and under whatever key) a build keeps it.
// V9+ keeps it encrypted in the tool account's vault, which the tool opens
// with its own password (PBKDF2 → AES-KW → AES-GCM, as services/vaultCrypto.ts).
async function readHistory(page) {
  return page.evaluate(async ([user, password]) => {
    const out = { imageScans: [], messageScans: [] };
    const add = st => {
      if (Array.isArray(st?.imageScans)) out.imageScans.push(...st.imageScans);
      if (Array.isArray(st?.messageScans)) out.messageScans.push(...st.messageScans);
    };
    for (let i = 0; i < localStorage.length; i++) {
      try { add(JSON.parse(localStorage.getItem(localStorage.key(i)))?.state); } catch { /* not ours */ }
    }
    try {
      const dir = JSON.parse(localStorage.getItem('fraudsentry-accounts') || 'null');
      const me = dir?.users?.find(u => u.username === user);
      const vault = me && localStorage.getItem(`fraudsentry-vault-${me.id}`);
      if (vault) {
        const b = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
        // the key is derived once per page (PBKDF2 is deliberately slow)
        if (globalThis.__fsCompare?.wrapped !== me.wrappedDek) {
          const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
          const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b(me.salt), iterations: me.iterations }, base, 512));
          const kek = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-KW', false, ['unwrapKey']);
          globalThis.__fsCompare = { wrapped: me.wrappedDek, dek: await crypto.subtle.unwrapKey('raw', b(me.wrappedDek), kek, 'AES-KW', { name: 'AES-GCM', length: 256 }, false, ['decrypt']) };
        }
        const dek = globalThis.__fsCompare.dek;
        const v = JSON.parse(vault);
        add(JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(v.iv) }, dek, b(v.ct)))));
      }
    } catch { /* no vault yet */ }
    return out;
  }, [TOOL_USER, TOOL_PASSWORD]);
}

async function waitForNew(page, key, seen, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const h = await readHistory(page);
    const fresh = h[key].find(s => s && s.id && !seen.has(s.id));
    if (fresh) return fresh;
    // upload rejected by the app's own validation (empty / renamed / too small …)
    const rejected = await page.getByText(/not a (valid|supported)|unsupported|too small|empty file|couldn.t read/i).first().isVisible().catch(() => false);
    if (rejected && Date.now() - t0 > 3000) return { __status: 'rejected' };
    await page.waitForTimeout(500);
  }
  return { __status: 'timeout' };
}

async function scanReceipt(page, build, file, timeoutMs) {
  await openPage(page, build, NAV.receipt);
  const seen = new Set((await readHistory(page)).imageScans.map(s => s.id));
  await page.locator('input[type=file]:not([capture])').first().setInputFiles(file);
  await page.waitForTimeout(300);
  if (!await clickButton(page, [/verify authenticity/i, /scan receipt|start scan|check receipt/i])) return { scan: { __status: 'no-scan-button' }, seconds: 0 };
  const t0 = Date.now();
  const scan = await waitForNew(page, 'imageScans', seen, timeoutMs);
  return { scan, seconds: (Date.now() - t0) / 1000 };
}

async function analyzeMessage(page, build, text) {
  await openPage(page, build, NAV.message);
  const seen = new Set((await readHistory(page)).messageScans.map(s => s.id));
  await page.locator('textarea').first().fill(text);
  if (!await clickButton(page, [/analy[sz]e message/i, /^\s*analy[sz]e\s*$/i])) return { __status: 'no-analyze-button' };
  return waitForNew(page, 'messageScans', seen, 15000);
}

// -------------------------------------------------------------- scoring ----
const norm = s => (s ?? '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
const FLAGGED = new Set(['high', 'critical']);
const WARNED = new Set(['medium', 'high', 'critical']);
const pct = (n, d) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : '—');

function scoreReceipt(row, label) {
  if (!label || row.status !== 'ok') return {};
  const r = {};
  if (label.issuer) r.issuerOk = norm(row.source) === norm(label.issuer);
  if (label.amount) r.amountOk = row.amount !== '' && Math.abs(Number(row.amount) - Number(label.amount.replace(/,/g, ''))) < 0.005;
  if (label.reference) r.referenceOk = norm(row.reference) === norm(label.reference);
  return r;
}

function summarise(args, builds, rows, labels, msgRows, messages) {
  const L = new Map(labels.map(l => [l.file, l]));
  const out = [];
  out.push(`# FraudSentry build comparison`, '');
  out.push(`- Generated: ${new Date().toISOString()}`);
  out.push(`- Builds: ${builds.map(b => `**${b.name}** (\`${path.basename(b.file)}\`)`).join(', ')}`);
  if (args.fresh) out.push('- Each receipt scanned in a fresh profile (no earlier-scan history)');
  out.push(`- CSP: ${args.bypassCsp ? '**bypassed** (equal-OCR comparison — not what users experience)' : 'enforced (what users actually get)'}`);
  out.push(`- Tesseract: ${args.mirror ? 'served from local mirror' : 'loaded from jsDelivr'}`, '');

  if (rows.length) {
    out.push('## Receipts', '');
    out.push('| Metric | ' + builds.map(b => b.name).join(' | ') + ' |');
    out.push('|---|' + builds.map(() => '---|').join(''));
    const per = builds.map(b => rows.filter(r => r.build === b.name));
    const line = (name, f) => out.push(`| ${name} | ${per.map(f).join(' | ')} |`);
    line('Scans completed', rs => pct(rs.filter(r => r.status === 'ok').length, rs.length));
    line('Timed out / hung', rs => String(rs.filter(r => r.status === 'timeout').length));
    line('OCR engine ran', rs => pct(rs.filter(r => r.ocr_available === 'true').length, rs.length));
    line('Median seconds per scan', rs => {
      const s = rs.filter(r => r.status === 'ok').map(r => Number(r.seconds)).sort((a, b) => a - b);
      return s.length ? s[Math.floor(s.length / 2)].toFixed(1) : '—';
    });
    if (labels.length) {
      for (const [k, name] of [['issuerOk', 'Issuer read correctly'], ['amountOk', 'Amount read correctly'], ['referenceOk', 'Reference read correctly']]) {
        line(name, rs => {
          const sc = rs.map(r => scoreReceipt(r, L.get(r.file))[k]).filter(v => v !== undefined);
          return pct(sc.filter(Boolean).length, sc.length);
        });
      }
      const of = (rs, truth) => rs.filter(r => L.get(r.file)?.truth?.toLowerCase() === truth);
      line('**Fakes caught** (High/Critical)', rs => { const f = of(rs, 'fake'); return pct(f.filter(r => FLAGGED.has(r.risk_level)).length, f.length); });
      line('Fakes at least warned (Medium+)', rs => { const f = of(rs, 'fake'); return pct(f.filter(r => WARNED.has(r.risk_level)).length, f.length); });
      line('**False alarms** on genuine (High/Critical)', rs => { const g = of(rs, 'genuine'); return pct(g.filter(r => FLAGGED.has(r.risk_level)).length, g.length); });
      line('Genuine shown as Low', rs => { const g = of(rs, 'genuine'); return pct(g.filter(r => r.risk_level === 'low').length, g.length); });
      out.push('', 'A scan that timed out or failed counts against field accuracy as unscored and never as "caught".');
    } else {
      out.push('', '_No --labels file given, so accuracy, catch rate and false alarms were not scored._');
    }

    if (builds.length >= 2) {
      const [a, b] = builds;
      const byFile = new Map();
      for (const r of rows) { if (!byFile.has(r.file)) byFile.set(r.file, {}); byFile.get(r.file)[r.build] = r; }
      const diffs = [];
      for (const [file, m] of byFile) {
        const x = m[a.name], y = m[b.name];
        if (!x || !y) continue;
        const keys = ['status', 'risk_level', 'source', 'amount', 'reference'];
        if (keys.some(k => (x[k] ?? '') !== (y[k] ?? ''))) diffs.push({ file, x, y });
      }
      out.push('', `## Where ${a.name} and ${b.name} disagree (${diffs.length} file${diffs.length === 1 ? '' : 's'})`, '');
      if (diffs.length) {
        out.push(`| File | Truth | ${a.name} | ${b.name} |`, '|---|---|---|---|');
        const cell = r => r.status !== 'ok' ? `_${r.status}_` : `${r.risk_level} · ${r.source || '?'} · ₱${r.amount || '?'} · ${r.reference || 'no ref'}`;
        for (const d of diffs) out.push(`| ${d.file} | ${L.get(d.file)?.truth || '?'} | ${cell(d.x)} | ${cell(d.y)} |`);
      }
    }
  }

  if (msgRows.length) {
    const M = new Map(messages.map(m => [m.id, m]));
    out.push('', '## Messages', '');
    out.push('| Metric | ' + builds.map(b => b.name).join(' | ') + ' |');
    out.push('|---|' + builds.map(() => '---|').join(''));
    const per = builds.map(b => msgRows.filter(r => r.build === b.name));
    const of = (rs, t) => rs.filter(r => M.get(r.id)?.truth?.toLowerCase() === t);
    const line = (name, f) => out.push(`| ${name} | ${per.map(f).join(' | ')} |`);
    line('Scams flagged (Medium+)', rs => { const s = of(rs, 'scam'); return pct(s.filter(r => WARNED.has(r.threat_level)).length, s.length); });
    line('Scams flagged High/Critical', rs => { const s = of(rs, 'scam'); return pct(s.filter(r => FLAGGED.has(r.threat_level)).length, s.length); });
    line('Normal messages kept Low', rs => { const n = of(rs, 'normal'); return pct(n.filter(r => r.threat_level === 'low').length, n.length); });
  }

  out.push('', '---', 'Read with care: with ~25 items per group a difference of 1–2 is noise, so quote the counts, not only the percentages. Self-made fakes are easier than a scammer\'s careful work. If you change the code after seeing these results, this set is no longer a held-out test.');
  return out.join('\n') + '\n';
}

// ----------------------------------------------------------------- main ----
const args = parseArgs(process.argv.slice(2));
const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;
fs.mkdirSync(args.out, { recursive: true });

const receiptFiles = args.receipts
  ? fs.readdirSync(args.receipts).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort()
  : [];
const labels = args.labels ? parseCsv(fs.readFileSync(args.labels, 'utf8')) : [];
const messages = args.messages ? parseCsv(fs.readFileSync(args.messages, 'utf8')) : [];
if (labels.length) {
  const missing = receiptFiles.filter(f => !labels.some(l => l.file === f));
  if (missing.length) console.warn(`warning: ${missing.length} receipt(s) have no label row: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
}

const launch = { headless: !args.headed };
if (!args.mirror && process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY };
const browser = await chromium.launch(launch);

const rows = [], msgRows = [];
for (const build of args.builds) {
  let ctx = await newContext(browser, args);
  let page = await ctx.newPage();
  console.log(`\n== ${build.name}: ${build.file}`);
  for (const [i, f] of receiptFiles.entries()) {
    if (args.fresh && i > 0) { await ctx.close(); ctx = await newContext(browser, args); page = await ctx.newPage(); }
    const row = { build: build.name, file: f };
    try {
      const { scan, seconds } = await scanReceipt(page, build, path.join(args.receipts, f), args.timeout * 1000);
      row.seconds = seconds.toFixed(1);
      if (scan.__status) row.status = scan.__status;
      else Object.assign(row, {
        status: 'ok',
        risk_level: scan.riskLevel ?? '',
        risk_score: scan.riskScore != null ? Number(scan.riskScore).toFixed(3) : '',
        rule_score: scan.heuristicScore != null ? Number(scan.heuristicScore).toFixed(3) : '',
        forest_probability: scan.forestAnalysis?.probability != null ? Number(scan.forestAnalysis.probability).toFixed(3) : '',
        source: scan.source ?? '',
        amount: scan.extracted?.amount ?? '',
        reference: scan.extracted?.referenceNo ?? '',
        receiver: scan.extracted?.receiverName ?? '',
        ocr_available: String(scan.ocr?.available ?? ''),
        ocr_confidence: scan.ocr?.confidence ?? '',
        failed_findings: (scan.findings ?? []).filter(x => !x.passed).map(x => x.label).join('; '),
        // the exact evidence vector the forest scored (V8.5+), for --features
        _features: scan.forestAnalysis?.features ?? null,
        _featureNames: scan.forestAnalysis?.featureNames ?? null,
      });
    } catch (e) {
      row.status = 'error';
      row.error = String(e?.message || e).split('\n')[0];
    }
    rows.push(row);
    console.log(`${f.padEnd(40)} ${row.status.padEnd(8)} ${(row.risk_level || '').padEnd(8)} ${row.source || ''} ₱${row.amount || '-'} ref=${row.reference || '-'} ${row.seconds || ''}s`);
  }
  for (const m of messages) {
    const row = { build: build.name, id: m.id };
    try {
      const r = await analyzeMessage(page, build, m.text);
      if (r.__status) row.status = r.__status;
      else Object.assign(row, { status: 'ok', threat_level: r.threatLevel ?? '', risk_score: Number(r.riskScore ?? 0).toFixed(3), scam_type: r.scamType ?? '' });
    } catch (e) { row.status = 'error'; row.error = String(e?.message || e).split('\n')[0]; }
    msgRows.push(row);
    console.log(`msg ${m.id.padEnd(36)} ${row.status.padEnd(8)} ${row.threat_level || ''} ${row.scam_type || ''}`);
  }
  await ctx.close();
}
await browser.close();

const rcols = ['build', 'file', 'status', 'seconds', 'risk_level', 'risk_score', 'rule_score', 'forest_probability', 'source', 'amount', 'reference', 'receiver', 'ocr_available', 'ocr_confidence', 'failed_findings', 'error'];
fs.writeFileSync(path.join(args.out, 'results.csv'), [rcols.join(','), ...rows.map(r => rcols.map(c => csvCell(r[c])).join(','))].join('\n') + '\n');
if (msgRows.length) {
  const mcols = ['build', 'id', 'status', 'threat_level', 'risk_score', 'scam_type', 'error'];
  fs.writeFileSync(path.join(args.out, 'messages.csv'), [mcols.join(','), ...msgRows.map(r => mcols.map(c => csvCell(r[c])).join(','))].join('\n') + '\n');
}
// --features: one training CSV per build, from receipts whose truth you labelled.
// Header = the build's own feature names + label (1 = fake, 0 = genuine); the
// Model page's "Upload labelled CSV" accepts it and connects it to live scans.
if (args.features) {
  if (!labels.length) console.warn('--features needs --labels (the truth column is the training label)');
  const L = new Map(labels.map(l => [l.file, l.truth?.toLowerCase()]));
  for (const b of args.builds) {
    const rs = rows.filter(r => r.build === b.name && r.status === 'ok' && r._features && (L.get(r.file) === 'genuine' || L.get(r.file) === 'fake'));
    if (!rs.length) { console.warn(`--features: ${b.name} recorded no feature vectors (needs V8.5 or later)`); continue; }
    const file = path.join(args.out, `features-${b.name.replace(/[^\w.-]+/g, '_')}.csv`);
    const head = [...rs[0]._featureNames, 'label'].map(csvCell).join(',');
    fs.writeFileSync(file, [head, ...rs.map(r => [...r._features, L.get(r.file) === 'fake' ? 1 : 0].join(','))].join('\n') + '\n');
    const fakes = rs.filter(r => L.get(r.file) === 'fake').length;
    console.log(`Wrote ${file} (${rs.length} rows: ${rs.length - fakes} genuine, ${fakes} fake)`);
  }
}

const summary = summarise(args, args.builds, rows, labels, msgRows, messages);
fs.writeFileSync(path.join(args.out, 'summary.md'), summary);
console.log(`\n${summary}\nWrote ${path.join(args.out, 'results.csv')} and summary.md`);
