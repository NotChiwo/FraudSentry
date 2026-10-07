# Changelog

## V8.1 — 2026-10-07

### Live camera scanning (Check Receipt and Check Message)
- **"Scan with camera" opens a live viewfinder inside the app** (`getUserMedia`). It was previously a file picker labelled "Take photo". It works with phone cameras (rear camera preferred), laptop webcams and USB cameras.
- **Real-time picture quality** is measured on every sampled frame (`frameQuality.ts`): sharpness (Laplacian variance), light (mean luma) and steadiness (frame difference). It drives the hints ("Hold steady…", "Too dark…") and **auto-capture**, which fires once the picture has stayed sharp and steady for 1.2 s. There's also a manual shutter, an auto-capture toggle, camera switching (when there are 2+ cameras), the flashlight (when the device supports it) and keyboard control (Space/Enter to capture, Esc to close).
- **Full-resolution capture** via `ImageCapture.takePhoto()` where supported, otherwise the current video frame. The scan starts automatically after capture, and the camera is released.
- **Honest fallbacks:** camera blocked, no camera, an insecure page, or a browser without a live camera each get a specific message and a "Use camera app instead" button (the device's own camera / file picker).
- **(fix)** `public/_headers` had `Permissions-Policy: camera=()`, which **blocked the camera entirely on the hosted site**. It is now `camera=(self)`.
- **(fix)** The camera screen is rendered in a portal, so it covers the whole screen and doesn't sit under the top bar / tab bar.
- **(fix)** The Check Message screenshot drop area was a click-only `<div>` with no keyboard access. It now has real buttons.

### Receipt reading: more wallets (from 18 real screenshots)
- **Maya merchant purchase and bills receipts** are recognised from their wording ("The final amount has been sent to the merchant", "Amount has been sent to the biller", "Amount – Approved", "Purchased (Updated) on"). The green "maya" logo usually isn't read by OCR at all.
- **The merchant / biller under "Purchased on" / "Bills Payment for"** (STARBUCKS…, MERALCO) is taken as the payee. The parser now looks only at the left column, skips Maya's amount line above the merchant, and accepts an OCR'd "*" as a quote mark.
- **Maya's labelled "Purchase date"** (and the time under it) is preferred over the "updated on" header date.
- **Older GCash Express Send layout:** "Total Amount Paid/Sent" plus a 4-3-6 digit reference means GCash, and "Rel Mo" is read as an OCR'd "Ref No.".
- **Measured** (labels and fixes made while looking at these images, so **in-sample**):
  - 18 screenshots: app 14→**18**/18, reference 17→**18**/18, date 12→15/17, time 13→16/17, recipient 9→14/15, amount 17/18 (unchanged), Trace ID 6/6.
  - Older 62-receipt set (no regressions): app 57→**59**/61, reference 55→**56**/60, amount 59/59.
- **Full engine on all 18 genuine screenshots:** every one is Low risk. The only findings are "no reference read" on the two images whose reference is pixelated or covered.

### Tests
- **139 → 155**, adding:
  - real-OCR wallet tests (Maya purchase/bills, old GCash, GoTyme→Maya), which fail 5/8 on the previous parser;
  - camera frame-quality tests.

## V8 — 2026-10-07

A redesigned, faster app built on the 2026-10-06 audit (`docs/AUDIT-2026-10-06.md`). Every number below was measured; see TESTING.md.

### Faster scanning (the "laggy" feel)
- **Image preprocessing moved off the main thread.** The sharpen and Otsu filters for OCR passes 2 and 3 now run in a Web Worker (`ocrPreprocess.worker.ts`, shared math in `ocrFilters.ts`). Under 4× CPU throttling they had frozen the page for about 1.9 s per scan. The up-scale stays on the main thread on purpose: doing it in the worker changed the pixels slightly, and that changed Tesseract's output. With the upscale kept on the main thread, OCR output is **identical** to V7.1 on 12/12 real receipts (same text, confidences and pass order).
- **The demo Random Forest trains in the background.** It now trains one tree at a time during idle time after the app opens. Before, it trained in one go on the first scan and blocked for about 1.2 s. A test proves `fitAsync` builds exactly the same forest as `fit`.
- **Cheaper rendering.** No `backdrop-filter` on cards, no infinite blurred background animations, and no 80 ms page-transition delay.
- **Result:** main-thread blocking during a real scan (390 px, 4× throttle) went from 5,659 ms total / 2,569 ms longest to about 1,400–1,500 ms total / about 500 ms longest.

### New scan experience
- **Live scan view driven by real pipeline events.** It shows the current step (image check → engine start → three OCR passes with Tesseract's own % progress → scoring), the words found on pass 1 drawn on the receipt as they are found, a real elapsed timer, and **Cancel**.
- **Plain-language verdict.** An icon + text + colour verdict (never colour alone), a one-sentence reason, and a four-step risk meter. Every verdict carries a "This is not a payment confirmation, check your own app" banner.
- **Quick facts, top reasons, what to do next.** Amount, reference, app and date are shown up front, then up to 3 reasons and the next steps. On a Low verdict, minor items are labelled "notes", not "reasons".
- **"Where we read it."** The amount, reference, date and recipient are outlined on your screenshot, using word positions from OCR pass 1 (`fieldLocator.ts`).
- **"How this was decided" expander.** The rule score + Random Forest vote = final risk, every check with its weight, the ELA heatmap and OCR pass confidences. Jargon stays out of the main view.
- **More ways in, friendlier errors.** A Paste button (plus Ctrl+V), take-photo, retake tips on low OCR confidence, and friendly cancel/error states.

### Fewer false alarms on genuine receipts (audit findings)
- **ELA re-thresholded** from 4.5 % to 20 % hotspots, measured on 63 genuine images where hotspots ranged 2.0–17.5 %. It is now a medium-severity *hint* with weight 0.15. The old threshold flagged 39/63 genuine images as "high". How many real edits the new threshold catches is **not measured**.
- **Not scored any more:** progressive JPEG encoding and missing EXIF are noted but carry no weight. They fired on most genuine chat-forwarded images.
- **Reference format uses per-app rules.** A genuine 6-digit MariBank reference is no longer flagged "unusual".
- **Future-dated receipt** is now **High** (was Critical), and the message tells the user to check their phone's date first. A wrong device clock produced false Criticals.
- **"No Recipient Identified" fixes.** It no longer claims fields were read when they weren't, and it is skipped on an unsent "Confirm transaction" screen, where the Unconfirmed Transaction finding already explains it.
- **Effect on real scans:** clean GCash/GoTyme/MariBank receipts now score 0.00 on the rules (were 0.38–0.44). The Maya unsent screen is still Critical.

### Navigation, Home and History
- **Grouped sidebar:** Check (Home, Check Receipt, Check Message, History) · Learn · **Research tools** (Cross-Evidence, Detection Model, labelled "Thesis demo"). The NEW badges are gone.
- **Mobile bottom tab bar** with safe-area insets and a "More" sheet. This replaces the floating hamburger.
- **Home:** a new hero; activity numbers computed only from this device's history (total, last 7 days, risky results, day streak, small honest milestones; all zero until you check something); a "scam to know today" from the Knowledge Base; tools laid out 2 + 2 (no orphan card).
- **History (was Reports):** search, type and "high risk only" filters, delete one, delete all, and a plain "your data stays on this device" note.
- **Theme:** the first visit follows the device's light/dark setting.

### Accessibility (axe-core, Chromium)
- **0 violations in 42 views** (9 pages × 2 widths × 2 themes + the results screen for 3 real receipts). Before: 3 critical, 3 serious and 3 moderate rule types.
- **Fixes:** `<main>` landmark, skip link, focus moved to the page on navigation, labels on the select / sliders / icon buttons, no nested interactive elements, contrast tokens re-chosen (WCAG formula) in both themes, nothing under 12 px, body text 15 px (16 px on phones), 44 px targets, `aria-live` scan and result announcements, heading order fixed.
- **Not claimed:** WCAG conformance. Screen-reader, keyboard-only and real-device testing are still pending.

### Engineering
- **CI** runs `npm audit --omit=dev`. README no longer claims plain `npm audit` is clean (concern 4 from the audit).
- **Tests:** 118 → **139** (new suites: forensic thresholds, field locator, on-device activity; plus forest warm-up equivalence).

## V7.1 — 2026-10-05

New checks that catch the most common way a fake receipt is made: editing a figure on a genuine screenshot.

- **Amount reconciliation.** Amount + fee must equal the total (`1,000.00 / +Fee 10.00 / Total ₱1,010.00`). An editor who changes the amount and forgets the total, or the other way round, now gets a **High** finding. The fee and total have to read the same way in at least two OCR passes, so a single misread can't raise it. A waived fee ("PHP 15.00 FREE") counts as zero. On the 62 real receipts it reconciled 27, flagged none, and skipped the rest (no fee/total printed).
- **Receipt date plausibility.** A receipt dated after the moment it is checked gets a **Critical** finding (with 12 h grace for clock/time-zone skew; date-only receipts get 36 h). Impossible dates/times ("Feb 30", "13:75") get a Medium finding, because they can also be OCR misreads. No real receipt was flagged.
- **Earlier-scan comparison.** Every new receipt is compared with the local scan history. The same reference number with a **different amount** is flagged as an *edited copy* (Critical finding, risk never below High). The same recipient at the same minute with different figures is flagged as High. The same receipt again (same reference and amount) only adds a note, because it is often the user re-checking their own file. A long reference with one misread digit still counts as the same reference. Over the 62 real receipts this found the 4 pairs of genuinely duplicated files and nothing else.
- **(fix) Principal vs total.** When a load/bill receipt's "Amount" row is missed, the parser took the total (₱1,020) instead of the principal (₱1,000). If the total minus the fee is printed on the receipt, that value is now used. Amount accuracy on the 62-receipt set: 58/59 → 59/59 (in-sample).
- The action plan gives a concrete next step for each new finding. The Privacy page states that the history comparison runs only in the browser.
- Tests: 93 → **118**, with new `consistencyChecks` and `historyMatch` suites. The "edited" cases are real redacted OCR with one figure changed.

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
