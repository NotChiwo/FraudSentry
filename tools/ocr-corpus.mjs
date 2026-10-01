// Dev-only: builds a corpus of REAL OCR output by running the app's own OCR
// pipeline in headless Chromium on every image in a folder.
//   node tools/ocr-corpus.mjs <imageDir> <outDir>
// Requires `playwright` (installed separately, not a project dependency) and
// a running dev server: npx vite --port 5199
// The output contains whatever text is on the receipts — keep it OUT of the repo.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [, , imgDir, outDir] = process.argv;
if (!imgDir || !outDir) { console.error('usage: node tools/ocr-corpus.mjs <imageDir> <outDir>'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const files = fs.readdirSync(imgDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5199/tools/ocr-corpus.html');
await page.waitForFunction(() => window.__ready === true);
for (const f of files) {
  const out = path.join(outDir, f + '.json');
  if (fs.existsSync(out)) continue;
  await page.setInputFiles('#f', path.join(imgDir, f));
  const t0 = Date.now();
  const res = await page.evaluate(() => window.__runOcr());
  fs.writeFileSync(out, JSON.stringify({ file: f, ...res }, null, 2));
  console.log(`${f}  conf=${res.confidence} pass=${res.pass} words=${res.wordCount} ${Date.now() - t0}ms`);
}
await browser.close();
