// Copies the offline single-file build (npm run build:offline in the project
// root) into desktop/app/, which is what the desktop app loads.
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', 'dist-offline', 'index.html');
if (!fs.existsSync(src)) {
  console.error('dist-offline/index.html not found: run "npm run build:offline" in the project root first.');
  process.exit(1);
}
fs.mkdirSync(path.join(__dirname, 'app'), { recursive: true });
fs.copyFileSync(src, path.join(__dirname, 'app', 'index.html'));
console.log('desktop/app/index.html updated');
