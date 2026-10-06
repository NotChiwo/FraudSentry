# FraudSentry

**An Online Transaction Fraud Detection System Using Random Forest Algorithm** — BSCS thesis project.

FraudSentry lets Filipino users check whether a GCash / Maya / GoTyme / MariBank / bank receipt screenshot, or a text message, looks fraudulent. Everything runs **inside the browser**: the whole app compiles into **one self-contained HTML file** with no backend, no database and no accounts. No receipt, message or result is ever sent to a server — the basis of the system's RA 10173 (Data Privacy Act) compliance.

---

## Modules

| Module | Page | Engine |
|---|---|---|
| **Check Receipt** — upload a receipt → OCR → field parsing → image forensics → risk score | `src/pages/ScannerPage.tsx` | `src/services/ocr.ts`, `receiptParser.ts`, `imageForensics.ts`, `fieldValidation.ts`, `src/engine/imageVerification.ts` |
| **Check Message** — PH scam-language & phishing-link detection | `src/pages/MessageAnalyzerPage.tsx` | `src/engine/messageAnalysis.ts` |
| **Cross-Evidence** — is this receipt really about this conversation? | `src/pages/CrossEvidencePage.tsx` | `correlateEvidence()` in `messageAnalysis.ts` |
| **Detection Model** — train / evaluate the Random Forest live | `src/pages/ModelPage.tsx` | `src/engine/randomForest.ts` (from scratch), `src/engine/sharedModel.ts` |

### How a receipt is scored
Two scorers look at the **same evidence** and are blended **50 / 50**:

1. **Rule-based findings** — each failed check (ELA hotspots, missing recipient, edited-amount formatting, unsent "Confirm transaction" screen, …) has a named weight.
   Internal-consistency checks (`src/services/consistencyChecks.ts`) look for an edited figure: amount + fee must equal the total, and the receipt cannot be dated in the future. `src/services/historyMatch.ts` compares the receipt with earlier scans on this device (same reference with a different amount means an edited copy).
2. **Random Forest** — the evidence becomes a 10-feature vector (`buildFeatureVector` in `src/services/sampleDataset.ts`) and is voted on by the shared forest (`src/engine/sharedModel.ts`).

Retraining on the Detection Model page replaces the forest used by every future scan — **but only if the training data uses the same 10 evidence features** (header: `ela_hotspot,has_exif,editor_trace,ocr_confidence,ref_present,ref_valid,institution_known,amount_present,failed_signals,metadata_consistency,label`). A model trained on unrelated columns (e.g. the PaySim dataset) is evaluated on the Model page but never wired into scans, because feeding receipt evidence into it would produce a meaningless number.

> The built-in training data is a **seeded demonstration dataset**, not real collected fraud data. The UI labels it as such everywhere it appears.

---

## Build & verify

```bash
npm install
npm run typecheck     # tsc --noEmit — must report 0 errors
npm test              # vitest — unit/regression suite
npm run build         # → dist/index.html (~1.31 MB, self-contained) + dist/_headers
npm audit --omit=dev  # shipped (runtime) dependencies: must report 0 vulnerabilities
```

Plain `npm audit` currently also lists a build-time-only advisory (`vite-plugin-singlefile → micromatch → braces`, no fix released yet). That code never ships in the built app. See TESTING.md §4.

`dist/index.html` can be opened directly from disk or hosted on any static host. `dist/_headers` sets the Content-Security-Policy and security headers on Netlify.

### Dependency constraints (do not blindly upgrade)
- `vite` stays on **7.x** — `@tailwindcss/vite` and `vite-plugin-singlefile` are tested against it; a past jump to vite 8 broke the build.
- `@vitejs/plugin-react` stays on **^4.7** (v5+/v6 target newer vite).
- `vitest` **≥ 4.1.11** (earlier versions carry a moderate advisory in `@vitest/mocker`).
- `xlsx` and `react-router-dom` were removed as unused (they caused most of an earlier audit's high-severity findings). Do not re-add without a real need.

### Tesseract (the only runtime dependency loaded from the network)
`src/services/ocr.ts` loads `tesseract.js@5.1.1` from jsDelivr with a pinned **Subresource Integrity** hash (`TESSERACT_SRI`). If the version or URL ever changes, recompute it from the real package:
```bash
npm pack tesseract.js@<version> && tar xzf tesseract.js-<version>.tgz
openssl dgst -sha384 -binary package/dist/tesseract.min.js | openssl base64 -A
```

### Content-Security-Policy
The CSP ships both as a `<meta>` tag in `index.html` (applies when the file is opened locally) and as a real header in `public/_headers`.
- `'unsafe-inline'` (script/style) — required because `vite-plugin-singlefile` inlines the whole bundle with no stable per-build hash.
- **`'wasm-unsafe-eval'` — required.** Tesseract's OCR engine is WebAssembly; without this keyword the browser refuses to compile it and every OCR feature fails. It allows WebAssembly compilation only, not JavaScript `eval()`.

---

## Testing

See **[TESTING.md](TESTING.md)** for what is verified, how, and what is still pending (usability testing and the ISO/IEC 25010 expert evaluation need real respondents and are **not** done).

Developer tools in `tools/` (never part of the build):
- `tools/ocr-corpus.html` + `tools/ocr-corpus.mjs` — run the app's real OCR pipeline in headless Chromium over a folder of screenshots to collect genuine, noisy OCR output for parser work.
- `tools/redact-corpus.cjs` — turn that output into privacy-safe test fixtures (names/e-mails replaced, digits scrambled, OCR noise kept). Keep the raw corpus and the name list **out of the repository**.

---

## Deliberate design decisions (don't "fix" these)
- **Issuer detection checks app-distinctive markers before a generic keyword loop** (`detectSourceFromText`). A flat "does the text mention GCash" check matches the *destination* bank and misclassifies receipts (e.g. a GoTyme receipt sending to GCash).
- **`/insta[prf]ay/`** — Tesseract misreads the InstaPay logo as "instaray" and, in this app's own pipeline, consistently as "instaFay". Both are real, repeated OCR outputs.
- **Consistency and history findings need a stable reading.** Fee and total must read the same in at least two OCR passes, dates get a 12–36 h grace period, and rescanning the same receipt only adds a note, never a finding. They are meant to have **no false alarms on genuine receipts**, not to catch every fake.
- **Maya "Confirm transaction" screens** are flagged as a Critical *Unconfirmed Transaction*: nothing has been sent yet, so it can never be proof of payment.
- Two OCR edge cases are intentionally **not** regex-patched (a masked account number and an asterisk-masked sender name that OCR reads as different noise each time). Fixing those needs better image preprocessing, not looser regexes.

---

© 2026 FraudSentry — BSCS Thesis Research Project · University of Perpetual Help System DALTA · Compliant with RA 10173
