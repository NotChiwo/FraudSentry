# Changelog

## V7 — 2026-10-01

V7 was rebuilt from the newest real TypeScript source available (V5, June 2026) and brought up to the V6 build (whose source was not available) by diffing the V6 bundle module by module. Every V6 feature is carried over; the items below marked **(fix)** are defects found in V6 during this work, verified against the original `FraudSentry-V6.html` where applicable.

### Critical fixes
- **(fix) OCR was blocked by the app's own Content-Security-Policy.** V6's CSP lacked `'wasm-unsafe-eval'`, so the browser refused to compile Tesseract's WebAssembly engine. Reproduced on the original V6 file in Chromium (served over http *and* opened as a local file): Transaction Check, Cross-Evidence and message-screenshot OCR spun forever. Added `'wasm-unsafe-eval'` (allows WebAssembly compilation only — not JavaScript `eval`) to both the `<meta>` CSP and `public/_headers`.
- **(fix) OCR could hang forever.** Any engine failure that never settled its promise left the scan spinner running indefinitely. Added watchdog time limits (90 s start-up, 60 s per pass) that fall back to the honest "text engine didn't load — Retry" path.
- **(fix) OCR pass 1 of 3 never ran.** The original image was handed to Tesseract as an `<img>` whose `blob:` URL had already been revoked, so the unprocessed pass silently failed on every scan (only the two processed passes ran). Now passed as a canvas; all three passes run.
- **(fix) "Retry scan" could never recover after a failed OCR load** — the failed loader promise stayed cached. Failed loads are now discarded.
- **(fix) A Random Forest trained on unrelated data was wired into live scans.** Retraining on any CSV (e.g. the PaySim dataset) replaced the model every receipt scan used, feeding receipt evidence into trees whose features mean "account balance" etc., and labelling the meaningless result "Trained on uploaded data". Retrained models now connect to live scans only when the CSV uses the 10 evidence features (checked by header); otherwise they're evaluated on the Model page with a clear "not connected" notice. The live-classification sliders are likewise only shown for evidence-schema models.

### Receipt parser — measured on 62 hand-labelled real receipts: issuer 77% → 93%, amount 90% → 98%, reference 68% → 92% (V6 → V7, in-sample; see TESTING.md)
- GoTyme-app receipts were labelled GCash/Maya (the destination-bank bug). Added the issuer-distinctive check: InstaPay logo + `Trace ID` + GoTyme. The InstaPay logo matches `/insta[prf]ay/` — this app's own OCR reads it as **"instaFay"**, not only the documented "instaray".
- Maya "Confirm transaction" (unsent) screens → **Critical "Unconfirmed Transaction"** finding, floored at Critical; the payer's own number under "Source" is no longer reported as the receiver.
- Maya `Reference ID` (e.g. `6262 1027 8803`, `4CCD 2075 53B8`) is now read — previously 0 of 12 real Maya receipts had their reference extracted.
- GoTyme 6-digit Trace IDs no longer run on into the next row (`000006ReferenceNo`).
- Disagreeing OCR passes: references are chosen by consensus (closest to all reads), passes arrive best-confidence first, and the issuer is detected from all passes together (a faint "Sent via GCash" read by one pass now beats two passes that only saw the destination bank).
- Bank SMS tags (`[BPI] You have transferred…`) identify the issuer; payee detection skips on-screen buttons ("Share") and "Reference …" rows; "Ref Mo." OCR confusion accepted.
- From V6: GCash markers (GLoan / Send Money / Pay Bills), payee under "Successfully sent to" headlines, dot-grouped thousands, minus-sign debits, bill amounts, references must contain a digit and can't cross lines.

### Message Analyzer
- From V6: parcel/customs-fee, on-hold parcel, wrong-send refund, task-job, deposit-to-work and "easy money" rules; "What to keep in mind" observations.
- New: "send/confirm the OTP" word order; negated warnings ("never share your OTP") are no longer flagged as OTP requests (also fixes a V5 false positive); bare-domain links (`lbc-ph.top/pay`) are inspected; a critical-severity rule floors the verdict at High; Taglish "by mistake … paki-balik"; fee-before-claim prize wording; "100% guaranteed"; fixed daily-income promises; deposit-to-activate task scams; "paid na … ship now" (medium — verify first).
- Every Knowledge Base example is now detected (enforced by a test), and 11 ordinary messages stay Low.

### Cross-Evidence
- From V6: receipt ↔ conversation linkage (linked / contradictory / unrelated / insufficient) and the detail-comparison table.
- **(fix)** Names ("to you", nicknames, OCR noise) could flip a matching receipt to "contradictory — one of them was altered". Names are now display-only.
- **(fix)** Masked receipt numbers (`+63 9•••••4290`) always "conflicted" with the full number in a chat — now compared on the visible last 4 digits.
- One misread digit in a long reference no longer breaks the link.

### Transaction Check UI
- From V6: Random Forest card (probability, tree votes, rule score), "What to do next" action plan, clipboard paste, OCR-unavailable Retry card, low-OCR warning, collapsible forensic view, per-field read confidence, reference-number disclaimer, scan-frame animation.
- **(fix)** The action plan's "reused receipt" step could never appear (it looked for a finding that didn't exist).
- **(fix)** Finding weights were shown as "+X% risk", but since the 50/50 blend they're rule-score weights — relabelled, here and in the PDF.
- **(fix)** PDF report printed garbage for "₱" and the "•" in masked names/numbers; it now also includes the score breakdown and action plan.
- Upload validation (all three pages): **BUG-008 fixed** (0-byte files rejected), minimum size, and real PNG/JPEG/WEBP signature check (renamed non-images rejected). Cross-Evidence previously never size-checked the conversation image at all.

### Everything else
- V6 home redesign, motion system (respects reduced-motion), responsive page gutters; fixed the mobile menu button covering the top-bar date and the hero orb pushing the call-to-action below the fold; Model-page grids no longer squeeze on phones.
- Knowledge Base: added Fake Proof of Payment, Parcel/Customs-Fee and Wrong-Send/Refund entries.
- "How FraudSentry decides" no longer claims the score is a plain sum of weights.
- Dependencies trimmed to what is used (removed xlsx, react-router-dom, recharts, framer-motion, react-hook-form, react-hot-toast, date-fns, clsx, tailwind-merge, jspdf-autotable); `tsc` reports 0 errors (V5 source had 2); `npm audit` 0 vulnerabilities.
- Added a real automated test suite (vitest) and `tools/` for building privacy-safe OCR fixtures.
