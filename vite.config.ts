/// <reference types="vitest/config" />
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import fs from "fs";
import crypto from "crypto";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
// vite-plugin-singlefile inlines every script/style into dist/index.html so the
// whole app ships as ONE self-contained file (no backend, nothing to host but
// static HTML — the basis of the RA 10173 "no data leaves the device" claim).
// `vite build --mode offline` (npm run build:offline) builds dist-offline/index.html
// with the OCR engine and its English + Filipino data embedded (~11 MB), so
// receipts can be scanned with no internet at all — e.g. on defense day.
// The normal build stays small and loads the same pinned Tesseract from jsDelivr.
const OCR_ID = "virtual:ocr-offline";
function ocrOfflineAssets(enabled: boolean): Plugin {
  const nm = (p: string) => path.resolve(__dirname, "node_modules", p);
  const text = (p: string) => JSON.stringify(fs.readFileSync(nm(p), "utf8"));
  const b64 = (p: string) => JSON.stringify(fs.readFileSync(nm(p)).toString("base64"));
  return {
    name: "fraudsentry-ocr-offline",
    resolveId: id => (id === OCR_ID ? "\0" + OCR_ID : null),
    load: id => {
      if (id !== "\0" + OCR_ID) return null;
      if (!enabled) return 'export const available = false, tesseractJs = "", workerJs = "", coreSimdLstmJs = "", engGzBase64 = "", filGzBase64 = "";';
      // embed only the exact pinned engine: its hash must equal TESSERACT_SRI in ocr.ts
      const want = fs.readFileSync(path.resolve(__dirname, "src/receipt-check/ocr/ocr.ts"), "utf8").match(/TESSERACT_SRI = '(sha384-[^']+)'/)?.[1];
      const got = "sha384-" + crypto.createHash("sha384").update(fs.readFileSync(nm("tesseract.js/dist/tesseract.min.js"))).digest("base64");
      if (want !== got) throw new Error(`node_modules/tesseract.js is not the pinned engine (${got} ≠ TESSERACT_SRI ${want})`);
      return [
        "export const available = true;",
        `export const tesseractJs = ${text("tesseract.js/dist/tesseract.min.js")};`,
        `export const workerJs = ${text("tesseract.js/dist/worker.min.js")};`,
        `export const coreSimdLstmJs = ${text("tesseract.js-core/tesseract-core-simd-lstm.wasm.js")};`,
        `export const engGzBase64 = ${b64("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz")};`,
        `export const filGzBase64 = ${b64("@tesseract.js-data/fil/4.0.0_best_int/fil.traineddata.gz")};`,
      ].join("\n");
    },
    // the embedded engine runs from blob: URLs, which the page's CSP must allow
    // The offline build also drops Google Fonts: the stylesheet blocks rendering,
    // so slow venue Wi-Fi could leave the page blank. System fonts are used instead.
    transformIndexHtml: html => (!enabled ? html : html
      .replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' blob:")
      .replace(/\s*<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, "")),
  };
}

export default defineConfig(({ mode }) => ({
  // relative paths, so the site works from a sub-folder (GitHub Pages: /FraudSentry/)
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile(), ocrOfflineAssets(mode === "offline")],
  build: mode === "offline" ? { outDir: "dist-offline", emptyOutDir: true, chunkSizeWarningLimit: 20000 } : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
