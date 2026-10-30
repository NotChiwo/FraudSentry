# FraudSentry

**An Online Transaction Fraud Detection System Using Random Forest Algorithm** — BSCS thesis project.

FraudSentry lets Filipino users check whether a GCash / Maya / GoTyme / MariBank / bank receipt screenshot, or a text message, looks fraudulent. Everything runs **inside the browser**: the whole app compiles into **one self-contained HTML file** with no backend, no database and no accounts. No receipt, message or result is ever sent to a server — the basis of the system's RA 10173 (Data Privacy Act) compliance.

---

## Modules

The source in `src/` has one folder per module. See **[CODE-GUIDE.md](CODE-GUIDE.md)** for what each file does and what to show when explaining it.

| Module | Folder | Page | Main logic |
|---|---|---|---|
| **Receipt Check**: upload a receipt → OCR → field reading → image checks → risk score | `src/receipt-check/` | `ReceiptCheckPage.tsx` | `verifyReceipt.ts`, `ocr/`, `reading/`, `checks/` |
| **Message Check**: PH scam-language & phishing-link detection | `src/message-check/` | `MessageCheckPage.tsx` | `messageAnalysis.ts` |
| **Cross-Evidence**: is this receipt really about this conversation? | `src/cross-evidence/` | `CrossEvidencePage.tsx` | `correlateEvidence()` in `message-check/messageAnalysis.ts` |
| **Random Forest**: the algorithm, training, evaluation, model registry, hypothesis test | `src/random-forest/` | `DetectionModelPage.tsx` | `randomForest.ts` (from scratch), `sharedModel.ts` |
| **Alerts**: an alert for every High / Critical check, unread / read, history | `src/alerts/` | `AlertsPage.tsx` | `alerts.ts` |
| **Transactions**: every payment checked and whether the money arrived | `src/transactions/` | `TransactionsPage.tsx` | `transactionCheck.ts` |
| **Reports**: summary / detailed reports for a period, PDF / CSV | `src/reports/` | `ReportsPage.tsx` | `fraudReports.ts`, `pdfReports.ts` |
| History, Knowledge Base, Home / About / Privacy | `src/history/`, `src/knowledge-base/`, `src/app/` | | |

### How a receipt is scored
Two scorers look at the **same evidence** and are blended **50 / 50**:

1. **Rule-based findings** — each failed check (ELA hotspots, missing recipient, edited-amount formatting, unsent "Confirm transaction" screen, …) has a named weight.
   Internal-consistency checks (`src/receipt-check/checks/consistencyChecks.ts`) look for an edited figure: amount + fee must equal the total, and the receipt cannot be dated in the future. `src/receipt-check/checks/historyMatch.ts` compares the receipt with earlier scans on this device (same reference with a different amount means an edited copy).
2. **Random Forest** — the evidence becomes a 10-feature vector (`buildFeatureVector` in `src/random-forest/sampleDataset.ts`) and is voted on by the shared forest (`src/random-forest/sharedModel.ts`).

Retraining on the Detection Model page replaces the forest used by every future scan — **but only if the training data uses the same 10 evidence features** (header: `ela_hotspot,has_exif,editor_trace,ocr_confidence,ref_present,ref_valid,institution_known,amount_present,failed_signals,metadata_consistency,label`). A model trained on unrelated columns (e.g. the PaySim dataset) is evaluated on the Model page but never wired into scans, because feeding receipt evidence into it would produce a meaningless number.

> The built-in training data is a **seeded demonstration dataset**, not real collected fraud data. The UI labels it as such everywhere it appears.

---

## Build & verify

```bash
npm install
npm run typecheck     # tsc --noEmit — must report 0 errors
npm test              # vitest — unit/regression suite
npm run build         # → dist/index.html (~1.36 MB, self-contained) + dist/_headers
npm run build:offline # → dist-offline/index.html (~11.4 MB): OCR works with no internet
npm audit --omit=dev  # shipped (runtime) dependencies: must report 0 vulnerabilities
```

Plain `npm audit` currently also lists a build-time-only advisory (`vite-plugin-singlefile → micromatch → braces`, no fix released yet). That code never ships in the built app. See TESTING.md §4.

`dist/index.html` can be opened directly from disk or hosted on any static host. `dist/_headers` sets the Content-Security-Policy and security headers on Netlify.

### Dependency constraints (do not blindly upgrade)
- `vite` stays on **7.x** — `@tailwindcss/vite` and `vite-plugin-singlefile` are tested against it; a past jump to vite 8 broke the build.
- `@vitejs/plugin-react` stays on **^4.7** (v5+/v6 target newer vite).
- `vitest` **≥ 4.1.11** (earlier versions carry a moderate advisory in `@vitest/mocker`).
- `xlsx` and `react-router-dom` were removed as unused (they caused most of an earlier audit's high-severity findings). Do not re-add without a real need.

### Offline build (use this on defense day)
`npm run build:offline` (released as `releases/FraudSentry-V10.2-offline.html`) embeds the Tesseract engine, its WebAssembly core and the English + Filipino language data, and drops Google Fonts. It was verified with **all network access blocked**: receipts read the same as online and no request is made. It is ~11 MB because of the embedded engine.
- The page's CSP adds `blob:` to `script-src` in this build only: the embedded engine is started from `blob:` URLs. The build fails if the embedded `tesseract.min.js` does not match `TESSERACT_SRI`.
- A page opened from disk (`file://`) can't let a worker load other `blob:` URLs, so the worker's own source carries the fetch shim (serving the language data), the core and the worker script. Language data can't be handed to `createWorker` directly, because tesseract.js 5.1.1's `initialize` joins the data instead of the language codes.
- Only the SIMD core is embedded (every current Chrome, Edge, Firefox and Safari 16.4+ has SIMD). Without SIMD, the core is fetched from jsDelivr as in the normal build.

## Installable apps (V10)

Both apps wrap the **offline build**, so OCR is built in and nothing needs the internet.

| App | How to get it | Built by |
|---|---|---|
| **Android** (`.apk`) | [Latest release](https://github.com/NotChiwo/FraudSentry/releases/latest) → `FraudSentry-android.apk`. Copy it to the phone and open it; allow "Install unknown apps" for the file manager or browser you open it with. | Capacitor 8 (`android/`, `capacitor.config.json`) |
| **Windows** (installer and portable `.exe`) | Release → `FraudSentry-Setup-….exe` or `FraudSentry-Portable-….exe`. It is unsigned: SmartScreen → More info → Run anyway. | Electron 43 (`desktop/`) |
| **macOS** (`.dmg`) | Release → `…-arm64.dmg` (Apple chip) or `…-x64.dmg` (Intel). It is unsigned: right-click → Open the first time. | Electron |
| **Linux** (`.AppImage`) | Release → `FraudSentry-…-x86_64.AppImage`. Make it executable (`chmod +x`) and run it. | Electron |
| **iPhone / iPad** | No app: open the hosted page in Safari, then Share → Add to Home Screen. | the offline HTML, hosted on Netlify |

Step-by-step instructions for every device: [docs/OPENING-THE-APP.md](docs/OPENING-THE-APP.md).

Every push also builds them under Actions → **Apps** → Artifacts (kept 30 days). Publishing a GitHub Release with a new tag like `v10.1.1` attaches all of them, plus the offline HTML, to that release permanently.

**Android app**
- It has **no INTERNET permission**, so Android itself guarantees the app cannot send anything anywhere.
- It requests only the **camera** (for the live receipt camera).
- `allowBackup` is off, so the history never goes into cloud or adb backups.
- The hardware back button closes an open panel, then returns to Home, then leaves the app.
- PDFs and CSVs open the Android **share sheet** ("Save to Files", Drive, Messenger …), because a WebView cannot download.
- CI installs the APK on an Android 14 emulator and drives the app's WebView: the page must load from inside the app, and the welcome screen must open (`tools/android-smoke.sh`).

**Desktop app**
- Every http(s) request is blocked, and the page runs sandboxed without Node.js.
- It cannot navigate away or open windows; https links open in the normal browser.
- Only the camera may be requested.
- The history lives in the app's own profile folder.
- PDFs and CSVs open a normal Save dialog.

Build locally:
```bash
npm run android:sync     # offline build → android/ (then open in Android Studio: npm run android:open)
npm run android:apk      # needs the Android SDK (ANDROID_HOME) and JDK 21
npm run desktop:start    # run the desktop app
npm run desktop:dist     # installers for the current OS → desktop/dist/
npm run icons            # re-render the launcher / splash / desktop icons from assets/icon.svg
```

### Tesseract (the only runtime dependency loaded from the network in the normal build)
`src/receipt-check/ocr/ocr.ts` loads `tesseract.js@5.1.1` from jsDelivr with a pinned **Subresource Integrity** hash (`TESSERACT_SRI`). If the version or URL ever changes, recompute it from the real package:
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
- `tools/compare-versions.mjs --features` — also writes `features-<build>.csv`: the evidence vector each receipt was scored on plus your label, ready for the Model page's "Upload labelled CSV" (real training data for the forest).
- `tools/compare-versions.mjs` — run two built versions (e.g. V6 vs V8.3) over the same receipts and messages and score them against your own labels: fakes caught, false alarms on genuine receipts, field accuracy, message accuracy. How to use it: TESTING.md §3a.

---

## Deliberate design decisions (don't "fix" these)
- **Issuer detection checks app-distinctive markers before a generic keyword loop** (`detectSourceFromText`). A flat "does the text mention GCash" check matches the *destination* bank and misclassifies receipts (e.g. a GoTyme receipt sending to GCash).
- **`/insta[prf]ay/`** — Tesseract misreads the InstaPay logo as "instaray" and, in this app's own pipeline, consistently as "instaFay". Both are real, repeated OCR outputs.
- **Consistency and history findings need a stable reading.** Fee and total must read the same in at least two OCR passes, dates get a 12–36 h grace period, and rescanning the same receipt only adds a note, never a finding. They are meant to have **no false alarms on genuine receipts**, not to catch every fake.
- **Maya "Confirm transaction" screens** are flagged as a Critical *Unconfirmed Transaction*: nothing has been sent yet, so it can never be proof of payment.
- Two OCR edge cases are intentionally **not** regex-patched (a masked account number and an asterisk-masked sender name that OCR reads as different noise each time). Fixing those needs better image preprocessing, not looser regexes.

---

© 2026 FraudSentry — BSCS Thesis Research Project · University of Perpetual Help System DALTA · Compliant with RA 10173
