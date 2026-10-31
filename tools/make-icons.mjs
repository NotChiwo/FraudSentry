// Dev-only: render assets/icon.svg into the Android launcher icons, the
// Android splash images, the desktop app icon and the web/iPhone home-screen
// icons (public/icons), using headless Chromium
// (the same renderer as the app). Run after changing the icon:
//   node tools/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const chromium = pw.chromium ?? pw.default?.chromium;

const svg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
// the shield alone (white, transparent background) for adaptive-icon foregrounds and splashes
const shield = svg.replace(/<rect[^>]*\/>/, '').replace(/<defs>[\s\S]*<\/defs>/, '');
const res = path.join(root, 'android/app/src/main/res');
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(file, size, body, bg = 'transparent') {
  await page.setViewportSize({ width: size.w, height: size.h });
  await page.setContent(`<html><body style="margin:0;background:${bg};width:${size.w}px;height:${size.h}px;display:flex;align-items:center;justify-content:center">${body}</body></html>`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: bg === 'transparent' });
}
const img = (s, px, extra = '') => s.replace('<svg ', `<svg width="${px}" height="${px}" style="${extra}" `);

await render(path.join(root, 'assets/icon-1024.png'), { w: 1024, h: 1024 }, img(svg, 1024));
fs.copyFileSync(path.join(root, 'assets/icon-1024.png'), path.join(root, 'desktop/build/icon.png'));
for (const [d, k] of Object.entries(DENS)) {
  const legacy = Math.round(48 * k), fg = Math.round(108 * k);
  await render(path.join(res, `mipmap-${d}/ic_launcher.png`), { w: legacy, h: legacy }, img(svg, legacy));
  await render(path.join(res, `mipmap-${d}/ic_launcher_round.png`), { w: legacy, h: legacy }, img(svg.replace('rx="230"', 'rx="512"'), legacy));
  // adaptive foreground: the shield inside the 72dp safe zone of the 108dp layer
  await render(path.join(res, `mipmap-${d}/ic_launcher_foreground.png`), { w: fg, h: fg }, img(shield, Math.round(fg * 0.78)));
  for (const [o, [w, h]] of Object.entries({ port: [320, 480], land: [480, 320] })) {
    const W = Math.round(w * k), H = Math.round(h * k);
    await render(path.join(res, `drawable-${o}-${d}/splash.png`), { w: W, h: H }, img(svg, Math.round(Math.min(W, H) * 0.32)), '#0b1020');
  }
}
await render(path.join(res, 'drawable/splash.png'), { w: 480, h: 800 }, img(svg, 150), '#0b1020');
// home-screen icons for the website: square corners, because iOS and Android round them themselves
const square = svg.replace(' rx="230"', '');
for (const [name, px] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]])
  await render(path.join(root, 'public/icons', name), { w: px, h: px }, img(square, px));
await browser.close();
console.log('icons written');
