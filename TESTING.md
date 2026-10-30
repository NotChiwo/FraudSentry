# Testing — what is verified, and what is not

Everything listed as **verified** below was actually executed on 2026-10-01 (V7), re-run on 2026-10-05 (V7.1) and again on 2026-10-07 (V8) against this source / its built `dist/index.html`. Nothing here is estimated or simulated. Items that need real people are marked **pending** — they have **not** been done.

## 1. Automated unit & regression tests — `npm test` (vitest)

**291 / 291 passing** (V10.1).

The no-fee reconciliation (V8.3) raised no alarm on any of the 13 real-OCR fixtures. It was **not** re-run on the 62-receipt set, which is not in the repository; run `tools/compare-versions.mjs` on it before quoting a figure.

| Suite | Tests | What it covers |
|---|---|---|
| `receiptParser.test.ts` | 36 | Issuer detection, field extraction and the Maya unsent-screen rule on **real OCR output** (redacted, see below); multi-pass merge (consensus reference, all-pass issuer detection, UI-label payees); synthetic edge cases. V8.3: the transfer's destination is never the issuer (any bank), the 12 added institutions, SeaBank → MariBank, whole-word keywords |
| `messageAnalysis.test.ts` | 28 | PH scam rules, negated OTP warnings, bare-domain links, critical-flag floor, receipt ↔ conversation linkage incl. masked numbers / one-digit OCR errors / "to you" false-contradiction. V8.3: agency named + non-`.gov.ph` link, money-mule account rental, "scan QR to receive", re-registration phishing, official domains of the added banks |
| `knowledgeBase.test.ts` | 30 | Every Knowledge Base example (13) is detected with the right scam type; 16 ordinary messages stay Low |
| `model.test.ts` | 16 | Random Forest reproducibility, held-out metrics computed from real predictions, importances, the evidence-schema gate (PaySim / headerless / reordered rejected), shared-model wiring, feature vector; V8: background training (`fitAsync`) builds the identical forest, and warm-up gives identical live-scan scores; V8.3: soft voting agrees with `predict()` and the exact vote count |
| `consistencyChecks.test.ts` | 22 | Amount + fee = total on real receipts (incl. waived fee, "tFee" misread); edited-amount and edited-total copies of a real receipt flagged; a misread in one pass ignored; principal vs total; date parsing; future, impossible and skewed dates. V8.3: receipts with **no fee line** (edited total, total below amount, ≤ ₱50 gap not flagged, real OCR spacing) |
| `historyMatch.test.ts` | 8 | Same receipt rescanned → reused note only; a real receipt with its amount edited → edited copy; the 8 distinct real receipts never match each other; same recipient at the same minute; one-digit OCR tolerance on long references |
| `forensicSignals.test.ts` | 8 | V8 thresholds: a typical genuine chat-forwarded JPEG raises nothing; the highest genuine ELA value measured (17.5 %) is not flagged; progressive/EXIF noted but unscored; editor signature, renamed file and odd crop still fire; future-date wording mentions the device clock |
| `fieldLocator.test.ts` | 4 | Field highlights: amount (not total), multi-group reference, date and recipient mapped to word boxes; values not on the image are not outlined |
| `activity.test.ts` | 7 | Home-page numbers: all zero without history, last-7-days, risky count, day streak (incl. ending yesterday, reset after a gap), milestones earned only from real history |
| `receiptParserWallets.test.ts` | 8 | V8.1, **real OCR** (redacted): Maya merchant purchases (identified without the logo, merchant as payee, "Purchase date" preferred), Maya Meralco bill, older GCash Express Send ("Rel Mo" reference), GoTyme paying a Maya wallet. Uses a neutral filename so the issuer is not given away by the fixture name. **5 of 8 fail on the V8.0 parser.** |
| `frameQuality.test.ts` | 8 | Live-camera frame measures on synthetic frames: crisp vs blurred, brightness, motion, hints; a white receipt with text is "ready", not "glare" |
| `knowledgeBasePage.test.ts` | 13 | V8.2 Knowledge Base:
- data contract: 13 entries (V8.3), quick rule, hint and basis on each, 3–4 flags/tips, no literal escape codes, agreed quick-rule wording;
- server-rendered page: 13 tabs, exactly one selected, detail never empty, selecting another entry, roving tabindex, Check Receipt for fake proof, disclaimer kept;
- filter and arrow-key logic;
- highlights equal the analyzer's own matches;
- prefilled examples are still detected. |
| `forensics.test.ts` | 10 | V8.3: editor signatures in PNG `tEXt`/`zTXt`/`iTXt` and WebP XMP, PNG `eXIf`, screenshot tags not mistaken for editors, `image/jpg`/`image/pjpeg` aliases, the shared metadata-consistency feature |
| `hiddenFields.test.ts` | 13 | V8.4 hidden-detail detection: a clean receipt drawn in code (UI tints, pills, icon chips, green card) has no hidden areas; a reference pixelated with 6/10/14 px tiles and a pixelated name are found; black and ink-coloured cover boxes are found; the OCR of a **real** pixelated GCash receipt (name replaced) is judged "reference hidden" and its junk is no longer a name; no false alarm on any of the 13 real-OCR fixtures; region-on-reference and region-on-mobile-number mapping |
| `trainingData.test.ts` | 11 | V8.5 real-data training: a labelled scan becomes a numbers-only row (the exact scored vector; older scans rebuilt); readiness (≥20 rows, ≥5 per class); the exported CSV header is the evidence schema; training is deterministic (sync and background give the same forest); reopening the app rebuilds exactly the connected model and scans wait for it; too few rows never replace the model; store label / relabel / unlabel / clear |
| `bpiReceipts.test.ts` | 12 | V8.6, **real BPI OCR** (redacted: name letters substituted, account digits changed, date and confirmation number shifted together by 52 weeks): Confirmation No., "Transfer to" nickname / masked name / account, amounts, dates; weekday ↔ date is consistent on the genuine receipts; a third genuine receipt (Sep 2026) whose confirmation number is *not* its transfer time is read cleanly (the timing rule was removed in V10.2); the blurred copy's reference reads as hidden; privacy-notice versioning |
| `inkConsistency.test.ts` | 5 | V8.6 repaint hint on receipts drawn in code: one ink → consistent; amount line in a bluer ink → reported; a recurring design tint → not reported; non-amount lines never judged; too few words → unknown |
| `fraudReports.test.ts` | 7 | V9.2: period-only counts by kind, classification, risk and outcome; classification vs confirmed outcome (TP / FP / TN / FN, accuracy, precision, recall); breakdowns by app, type, warning sign, model, alerts; plain-language description (and "no checks"); summary vs detailed with typed transactions and CSV; all-users report with per-user counts; saved reports expire after 30 days |
| `evaluation.test.ts` | 12 | V9.1: ROC-AUC (perfect, guessing, reversed, ties, one class), ROC curve area = AUC, demo forest AUC > 0.85; McNemar exact binomial (hand-computed p), no or balanced disagreement, χ² with continuity correction; rules vs forest vs combined on the same held-out receipts with a significant improvement, rows without a rule score left out; a labelled scan keeps its rule score and floor; blend and classification threshold; model versions, names and which models can be reactivated |
| `transactions.test.ts` | 8 | V9.1: typed details (consistent → Low; wrong-shape or missing reference; future date ≥ High; edited copy of an earlier check); transaction type from receipt wording; "received / not received" sets a receipt's training label and pending removes it; typed-details transactions never train the model and raise an alert that is removed with them |
| `alerts.test.ts` | 13 | V8.7 alerts: a High receipt gives an alert with exactly the ERD fields, unread, dated when the check ran; the message names app, amount, reference and the strongest failed checks; the alert level (Low never; Medium only when chosen; Critical only); message and cross-evidence wording; one alert per check, newest first, capped at 100; store: risky checks create alerts and clean ones don't, read / unread / mark all / delete, deleting a check (or it leaving the 40-item history) deletes its alert, a Cross-Evidence run raises one alert, saved and reopened alerts keep their status and expired ones are dropped |
| `retention.test.ts` | 2 | V8.3: 30-day local-history expiry |
| `uploadValidation.test.ts` | 7 | **BUG-008** (0-byte image), too-small files, unsupported types, >10 MB, renamed non-images, PNG/JPEG/WEBP signatures |

**Do the tests actually catch bugs?** The 29 parser tests were also run against the **real V6 parser** (extracted from `FraudSentry-V6.html`): **12 fail** there (GoTyme misclassification, `000006ReferenceNo`, Maya references, unsent-screen detection, consensus reference, …) and all pass on V7.

> The Knowledge-Base / benign message sets are hand-written examples. They prove the analyzer is *consistent with its own documentation* and doesn't flag ordinary chat — they are **not** a measure of real-world detection accuracy.

### Real-OCR fixtures (privacy)
`src/__tests__/fixtures/real-ocr-redacted.json` holds 8 receipts as read by this app's own 3-pass OCR pipeline (`tools/ocr-corpus.mjs`, headless Chromium) — misreads, spacing and garbage lines intact. Personal data was removed with `tools/redact-corpus.cjs`: names and e-mails replaced, every 3+ digit run scrambled with a digit permutation that keeps 0 and 9 fixed (so `+63 9…` structure survives). The raw corpus and the real-name list are **not** in the repository.

## 2. Receipt-parser field accuracy on 62 real screenshots

62 real PH receipt screenshots (GCash, Maya, GoTyme, MariBank, BPI SMS; mostly the developer's own plus some public reposts) were OCR'd by the app's own pipeline and hand-labelled from the images (issuer app, principal amount, reference number; ambiguous or illegible fields were excluded, not guessed).

| Version | Issuer app | Amount | Reference no. |
|---|---|---|---|
| **V6** — its real parser on its real (2-pass) OCR | 47/61 (77%) | 53/59 (90%) | 41/60 (68%) |
| **V7** — final parser on fixed 3-pass OCR | 57/61 (93%) | 58/59 (98%) | 55/60 (92%) |
| **V7.1** — + principal-vs-total fix | **57/61 (93%)** | **59/59 (100%)** | **55/60 (92%)** |

What changed the numbers: GoTyme receipts no longer labelled GCash/Maya (8), Maya "Reference ID"s now read (12 — V6 read 0), GoTyme Trace IDs no longer swallow the next row, GCash references no longer absorb next-line digits, the revived OCR pass 1 fixed several amounts, consensus voting fixed disagreeing reference reads, bank-SMS tags (`[BPI]`) identify the issuer.

Remaining V7 misses (10): tiny, low-resolution reposts where Tesseract never read the reference/label at all (5), screens with no issuer marker in the text (4), and one Smart load screen where the parser took the total (₱1,020) instead of the amount (₱1,000). That one was fixed in V7.1.

**Read these numbers carefully:**
- The parser changes were developed **while looking at this same set**, so these are **in-sample** figures and likely optimistic. An unbiased accuracy figure for the thesis needs a **fresh, held-out** set of receipts that was not used during development.
- One person labelled the data; the sample is a convenience sample, not representative of all receipts.

### V7.1 consistency checks on the same 62 real receipts
Every one of these receipts is treated as genuine, so any alarm would be a false positive.

| Check | Result |
|---|---|
| Amount + fee = total | 27 reconciled · **0 mismatches** · 35 not applicable (no fee/total printed or unstable read) |
| Future / impossible date | 49 ok · **0 flagged** · 13 no readable date |
| Earlier-scan comparison (each receipt vs the other 61) | **0 edited-copy / same-moment alarms**; 8 "reused" notes, all of which are the 4 pairs of files that really are the same receipt (identical hand-labelled reference) |

This measures **false alarms only**. How often these checks catch real edited receipts has **not** been measured on a real set of fakes; the unit tests use real receipts with one figure changed. A fake built carefully (amount *and* total edited consistently, date untouched, never scanned before on this device) will not trip any of these.

### V8: genuine-receipt false positives in image forensics
`analyzeForensics` was run on all **63** images in the receipt folder (43 JPEG, 20 PNG), treating them as genuine. ELA hotspot % ranged **2.0–17.5** (median 6.4, 90th percentile 11.4). The ELA mean score was at most **8**, so the old `mean > 55` branch never fired.

| Check | V7.1 (old rule) | V8 (new rule) |
|---|---|---|
| ELA "high" (hotspots > 4.5 %) → now "medium hint" (> 20 %) | fired on **39 / 63** (16 / 20 PNG) | fires on **0 / 63** |
| Progressive JPEG | scored on 31 / 43 JPEGs | noted, weight 0 |
| EXIF missing | scored on 16 / 43 JPEGs | noted, weight 0 |

Real scans of clean GCash, GoTyme and MariBank receipts now score **0.00** on the rules (V7.1: 0.38–0.44). The Maya unsent screen still scores Critical (0.70).

**Caveats.**
- The new ELA threshold was chosen from genuine images only. Its catch rate on real edited receipts is **unmeasured**.
- The folder includes `fake.png` and `zzzzzz.png`, whose authenticity is unconfirmed. `fake.png` (hotspots 12.2 %) was flagged by the old rule and is not flagged by the new one. If it is a real fake, that is a lost detection, but the old rule could not separate it from genuine images either.

### V8: OCR output unchanged by the performance work
12 real receipts were re-OCR'd with the V8 pipeline (filters in a Web Worker) and compared with the saved V7.1 corpus. **12 / 12 were identical**: pass texts, confidences and order. The old pipeline re-run the same day was also 12 / 12 identical to the corpus, so it is deterministic. A first attempt that also up-scaled inside the worker (OffscreenCanvas) changed the output on all 12, so it was rejected.

### V8: field highlights on real OCR
On those 12 receipts, `locateFields` outlined the amount on 10 of 11 receipts where an amount was extracted, the reference on 8 / 9, the date on 7 / 10 and the recipient on 5 / 6.

### V8.1: 18 more real screenshots (GCash, GoTyme, Maya purchases/bills, MariBank, GCash Pay Bills)
18 screenshots supplied on 2026-10-07 were run through the app's real 3-pass OCR and hand-labelled from the images. The parser was then fixed **while looking at them**, so these are **in-sample** figures.

| Field | Before (V8.0) | After (V8.1) |
|---|---|---|
| Issuer app | 14 / 18 | **18 / 18** |
| Amount | 17 / 18 | 17 / 18 |
| Reference | 17 / 18 | **18 / 18** |
| Date | 12 / 17 | 15 / 17 |
| Time | 13 / 17 | 16 / 17 |
| Trace ID | 6 / 6 | 6 / 6 |
| Recipient / merchant (letters only) | 9 / 15 | 14 / 15 |

What's left is OCR-level:
- GCash Pay Bills (Pag-IBIG): the "Amount Paid / Fee" rows and the date are never read from that small, highlighter-marked image, so the parser reports the ₱7,505 headline total, not the ₱7,500 principal.
- One old GCash receipt's year is read as "2003".

Re-scored afterwards, the older 62-receipt set improved with no regressions: issuer **59/61**, amount **59/59**, reference **56/60**.

**Full engine on the 18 genuine screenshots (built app, Chromium):** all 18 are **Low**. The only findings are "no reference read" on #1 and #16, whose references are pixelated or covered in the image. No false "edited copy" alarm fired while all 18 were scanned into the same history.

### V8.1: live camera
Tested with Chromium's **fake camera** fed a real receipt as an MJPEG stream. This is a stand-in, **not a real camera**.

| Check | Result |
|---|---|
| Live stream starts | ✓ (390 px and 1280 px) |
| Hints from real frame measurements | ✓ ("Looks sharp — hold still", sharpness 867, brightness 243) |
| Auto-capture when sharp and steady | ✓ after ≈ 2.0–2.2 s |
| Capture scanned end-to-end | ✓ GoTyme · ₱100.00 · ITO260924081816006 · 24 Sep 2026 4:18 PM (full-resolution `takePhoto` capture) |
| Manual shutter with auto-capture off | ✓ |
| Camera released after capture | ✓ |
| axe-core on the camera screen | 0 violations |
| No camera / blocked (headless Chromium: `NotSupportedError`; headless WebKit: no camera API) | friendly message + "Use camera app instead", which opens the device camera/file picker (`capture="environment"`) in both |
| Check Message → camera → OCR text in the editor | ✓ |

**Not tested:**
- real phones (Android Chrome, iPhone Safari) and real laptop webcams;
- the permission prompt itself;
- the flashlight and camera switching (no such hardware in the test browser).

The sharpness threshold (120 on a 160 px frame) was calibrated on synthetic frames and the fake feed only. If auto-capture never fires on a particular camera, the manual shutter always works.

### V8.2: Scam Knowledge Base (Chromium, built app)
**Page scroll height**: the full scrollable content including the footer, measured as `.app-content.scrollHeight` with the first scam open.

| Viewport | Before (V8.1 accordion) | After (V8.2) |
|---|---|---|
| 390 × 844 | 2,590 px | list **1,349 px**; one scam's detail **1,445 px** (the intro is hidden in detail) |
| 768 × 1024 | 1,878 px | **1,293 px**; both panes end at 1,010 px of the 1,024 px viewport |
| 1280 × 800 | 1,658 px | **943 px**; both panes end at 795 px of the 800 px viewport. The rest is the footer, kept below the panes as agreed. |

**axe-core:**
- 0 violations at 390 px (list view) and 1280 px, in both themes;
- 0 on all 10 phone detail views in both themes, after fixing a missing `<h1>` that the first run found;
- 0 app-wide (42 views).

**Also measured:** no interactive element under 44 px and no text under 12 px on the page, at any of the three widths.

**Interaction checks — 22 / 22 passed:**
- **Keyboard:** Arrow ×2 moves focus and selection together, and the panel follows; End and Home work.
- **Filter:** a nonsense filter shows the "no results" state, and Clear filter (keyboard) restores all 10; "customs" leaves only Parcel.
- **Try-it:** it prefills without quotes and is labelled "Example message"; it does **not** auto-run; analyzing it shows a result but **History stays at 0**; an edited message **is** saved (0 → 1).
- **Fake proof:** "Check a receipt instead" opens Check Receipt.
- **768 px:** two panes.
- **Phone:** tap opens the detail and focus moves to its heading; `page.goBack()` (browser/Android back) returns to the list and **focus returns to the opened item**; the on-screen Back does the same.
- **No page errors.**

**Not verified:**
- a real Android back button or iOS swipe-back gesture (only `history.back()` / Playwright `goBack`);
- screen-reader announcements (only the ARIA structure was checked);
- WebKit/Firefox for this page specifically (the app-wide WebKit e2e run passed but doesn't open the Knowledge Base);
- whether the quick rules actually help users (that needs your usability testing).

## 3. End-to-end tests of the built file (Playwright)

`dist/index.html` driven through every module with **real receipts**: consent → BUG-008 / renamed-file rejection → GoTyme receipt scan (issuer, Trace ID, Random Forest card, action plan, PDF download) → Maya unsent screen (Critical) → Message Analyzer → Cross-Evidence linkage → Model page (demo model connects; PaySim model evaluated but **not** connected) → overflow check on 9 pages × 4 widths (375, 414, 768, 1280) → network audit → console errors.

| Engine | Result | First scan (OCR + forensics) |
|---|---|---|
| Chromium | **19 / 19** (V8.1 re-run; adds the verify-in-your-own-app banner check in V8) | ≈ 6.7 s |
| WebKit (Safari's engine) | **19 / 19** (V8.1 re-run) | ≈ 10.7 s |
| Firefox | **not tested** — Playwright's Firefox could not be launched on the test machine (`spawn UNKNOWN`) | — |

Network audit: the only external hosts contacted were `cdn.jsdelivr.net` (Tesseract) and Google Fonts. No receipt or text is uploaded anywhere.

The same OCR flow was also run against the original `FraudSentry-V6.html`: it **hangs forever in Chromium** (served over http and opened as a local file) because its CSP blocks Tesseract's WebAssembly — fixed in V7 (see CHANGELOG).

WebKit is a strong proxy for iPhone browsers but is **not** a real iOS Safari device test.

### V8: accessibility audit (axe-core 4, Chromium only)
- **Scope:** 9 pages × 2 widths (390, 1280) × 2 themes, plus the results screen after real scans of 3 receipts at both widths = 42 views.
- **Result: 0 axe violations.** On 2026-10-06 (V7.1) the same audit found 3 critical, 3 serious and 3 moderate rule types.
- **Also measured:** no horizontal overflow; no text element under 12 px; at most 2 interactive elements under 44 × 44 px per view at 390 px. Those are the off-screen skip link and a 20 px checkbox inside a 44 px label.
- **Not covered:** WebKit/Firefox axe runs, screen readers, keyboard-only walkthroughs, real phones. **This is not a WCAG conformance claim.**

### V8: main-thread responsiveness during a real scan
Long tasks (> 50 ms) measured with `PerformanceObserver` while scanning the same real receipt at 390 px under Chrome DevTools **4× CPU throttling**. The throttle approximates a slower phone CPU; it is **not** a real-device measurement.

| | Total blocked | Longest single block |
|---|---|---|
| V7.1 | 5,659 ms | 2,569 ms |
| V8, run 1 / run 2 | 1,387 / 1,515 ms | 484 / 528 ms |

Profiling showed where the V7.1 time went:
- The OCR enhance/binarise filters: about 1.9 s.
- Training the demo Random Forest on the first scan: about 1.2 s.
- React rendering the long results page.

## 3a. Comparing builds — `tools/compare-versions.mjs` (V8.3)

Answers "is the new build better than the old one?" on evidence **you** collect.

1. **Collect a fresh test set** not used while developing: genuine receipts (classmates, family — not the sets above) and fakes made by editing copies of them (change the amount or total, erase the recipient, paste a different reference; Canva / PicsArt / phone editors), plus scam and ordinary messages. Aim for 20–30 per group.
2. **Write `labels.csv` before running anything** (`file,truth,issuer,amount,reference`, truth = `genuine`/`fake`) and `messages.csv` (`id,truth,text`, truth = `scam`/`normal`).
3. Run:
   ```bash
   npm i -g playwright && npx playwright install chromium   # once
   npm run build
   node tools/compare-versions.mjs \
     --build V6=path/to/FraudSentry-V6.html --build V8.3=dist/index.html \
     --receipts my-receipts/ --labels labels.csv --messages messages.csv
   ```
   Run it once as-is (what users actually get: V6's OCR hangs) and once with `--bypass-csp` (every build gets working OCR, so you compare parsing and scoring). Pages are found by both their V6/V7 and V8 names.
4. Read `compare-out/summary.md`. A build is better only if it catches more fakes **without** more false alarms on genuine receipts. `compare-out/` is git-ignored: it holds the text read from your receipts.

**Verified 2026-10-15 — a smoke test of the harness, not an accuracy result** (3 synthetic screenshots, 6 messages, V8.2 vs V8.3, Tesseract served from a local mirror):
- Both builds read the issuer, amount and reference of the two genuine screenshots correctly, and both rate them Low.
- A screenshot whose total was changed to ₱15000.00 while the amount stayed ₱1,500.00 (GCash "Send Money" layout, no fee line): V8.2 **Low**, V8.3 **High** (no-fee reconciliation).
- Messages: scams flagged Medium+ 1/4 → 4/4 (fake LTO fine, account rental, "scan QR to receive"); both ordinary messages stay Low in both builds.

## 3b. Hidden-detail detection (V8.4)

**What triggered it:** a real GCash receipt with the name, mobile number and reference pixelated scored **Low** ("No signs of editing found") in V8.3. In V8.4 it scores **High**, "Details are hidden — cannot be verified". Both the pixel check (4 pixelated areas, on the mobile-number and reference lines) and the text check (reference label read, number unreadable) flag it.

**Synthetic evaluation, 2026-10-15.** Generated screenshots in three receipt styles (GCash-like, Maya-like dark, bank-like light) plus the app's own busy pages, each as PNG and as JPEG q75–80. The edited copies had the reference, the name, or name + phone + reference pixelated (tiles 6, 10, 14, 22 px) or boxed (black, white). The thresholds were **chosen on this same set** (zero false alarms first), so these are in-sample figures:

| Set | Result |
|---|---|
| Clean screenshots (34) | **0 flagged** |
| Mosaic, 6–14 px tiles (162) | **157 caught (97 %)** |
| Mosaic, 22 px tiles (54) | 26 caught (48 %); large tiles over small text fade to near-background tints |
| Black box (27) | 18 caught (67 %); all misses are on the black Maya-style background, where a black box is invisible |
| White box (27) | 0 by pixels. Left to the text check (a white box on a white card leaves no pixel trace) |

**Not measured, and needed before the defense:**
- the false-alarm rate on **real genuine** screenshots (the 62 + 18 sets are not in this repository; run `tools/compare-versions.mjs` on them);
- the catch rate on edits made with real phone editors (Canva, PicsArt, the gallery's markup tool).

**Known gaps:** blur (smooth, no tiles) is not detected by pixels. Only the text check can catch it, and only on the reference line. A box in a colour that matches the surrounding card is invisible by design.

## 3c. Real-data training and offline OCR (V8.5)

**Training on labelled scans, end to end in the built app (Chromium, 2026-10-18):**
1. Scan a receipt and label it Genuine on the result page. The saved row holds only `id, features, label, addedAt`, and its features equal the vector the forest scored.
2. History counts it (41 labelled: 21 genuine, 20 fake, with 40 pre-seeded rows).
3. Model page → "Use my labelled receipts" → Train. Live scans then use "trained on your labelled receipts" (29 training rows = 70 % of 41).
4. Reload the app. The same labelled model is in use again.

**Offline build, all network blocked (Chromium, `file://`, 2026-10-18):**

| Receipt | Online build | Offline build, no network |
|---|---|---|
| Synthetic GCash (PNG) | conf 95 · Low · GCash ₱1,500 · ref read | conf 95 · Low · same fields · 7.1 s |
| Real pixelated GCash (JPEG) | conf 78 · High (details hidden) | conf 78 · High · 7.0 s |
| Synthetic GCash (JPEG) | conf 94 · Low | conf 94 · Low · 6.2 s |

Network requests attempted by the offline build: **none**. Safari/WebKit and Firefox were **not** tested for the offline build. Test it on the actual defense laptop and browser beforehand, with Wi-Fi off.

## 3d. BPI receipts and the new checks (V8.6)

Three real BPI receipts were supplied: two genuine (2024 layout with a Fee row, 2026 layout) and a copy of the 2026 one with the date, confirmation number and recipient blurred. Three more edited copies were made from the 2026 one for this test, by painting new text over the date, the amount, or the confirmation number in a similar font. All were scanned in the built app (Chromium):

| Receipt | V8.5 | V8.6 | Caught by |
|---|---|---|---|
| 2024, genuine | High (false alarm) | **Low** | (confirmation time ✓, weekday ✓) |
| 2026, genuine | Low | **Low** | (confirmation time ✓, weekday ✓) |
| 2026, blurred copy | High | **High** | hidden details |
| 2026, date edited | Low | **High** | weekday + confirmation time (V10.2: weekday only, still High) |
| 2026, confirmation no. edited | Low | **High** | confirmation time (**V10.2: rule removed, now Low**, see below) |
| 2026, amount edited | Low | **Medium** | text colour hint |

Text-colour hint false alarms: **0 of 43** clean / genuine images (34 synthetic incl. busy app UI as PNG and JPEG; 2 real BPI; 1 real GCash; 6 others). The thresholds were set while looking at these images, so the figures are in-sample.

**Limits — say so at the defense:**
- The confirmation-time rule rests on two real BPI receipts. It is applied only to BPI numbers that decode to a plausible date.
- An amount retyped in exactly the app's own colour and font is not caught by any pixel check. Only the user's own account proves the amount.
- These numbers come from 3 real receipts and 3 hand-made edits, not a held-out set. Run `tools/compare-versions.mjs` on your own BPI receipts and fakes.

## 3e. Alerts in the built app (V8.7)

Run in the built app (Chromium, desktop 1280×900 and phone 390×844):

| Step | Result |
|---|---|
| Genuine BPI receipt (2026) | Low; **no alert**, no pop-up, bell "none unread" |
| Blurred BPI copy | High; **1 alert** + pop-up "High risk: Suspicious receipt"; bell "1 unread" |
| Scam SMS (fake GCash link + OTP request) | Critical; 2 alerts, bell "2 unread" |
| Alerts page | 2 rows, "2 unread · 2 total" |
| Mark one read / unread / mark all read | the bell count follows (1 → 2 → 0) |
| "View check" | opens History with that receipt highlighted; the alert becomes read |
| Reload | alerts and their status kept; old alerts don't pop up again |
| Delete the receipt check in History | its alert is deleted; the message alert stays |
| Phone layout | Alerts reachable from "More" and from the bell |

Page errors: none.

## 3f. Accounts in the built app (V9.0; removed in V10.1, kept for the record)

Run in the built app (Chromium), starting from a V8.7 device with one saved scam-message check:

| Step | Result |
|---|---|
| Open V9.0 | the updated privacy notice is shown again, then "Set up FraudSentry" says the existing check will move into the account |
| Administrator password `owner123` for user `owner` | rejected: "must not contain the username" |
| Create administrator | signed in after ~0.9–1.4 s of key derivation; the old alert is in Alerts |
| Browser storage afterwards | old plain history removed; vault holds no readable text; the password appears nowhere |
| Admin creates `Cashier1` | stored as `cashier1`, with a temporary password like `bayan-c26-bituin-32` |
| 5 wrong passwords for `cashier1` | "locked … Try again in 4:59"; the countdown applies to that username only |
| Admin unlocks; activity log "Verify integrity" | "All 10 entries are intact"; 5 failed sign-ins highlighted |
| Cashier signs in with the temporary password | forced to choose a new one |
| Cashier's menu | no Detection Model or Administration |
| Cashier checks a phishing SMS | Critical alert for the cashier only; the owner does not see it |
| Admin overview / records | 2 users, 2 checks, 2 alerts; the cashier's check listed read-only |
| Reload | signed out (keys exist only in memory) |
| `tools/compare-versions.mjs` V8.7 vs V9.0 on the 6 BPI receipts | identical results (detection unchanged) |

## 3g. Transactions and model evaluation in the built app (V9.1)

| Step | Result |
|---|---|
| Blurred BPI receipt | High · **Possibly fraudulent** · Bank Transfer · "Scored with RF v0 · demonstration (built-in)" |
| Mark "Not received" | saved with time; becomes a fake-labelled training row |
| Typed details: BPI ₱15,000, ref 1782743489365, Jun 29 2026 9:00 AM | High · Possibly fraudulent · main reason Confirmation Number Timing (the number encodes 10:31 PM) · alert raised (that rule was removed in V10.2) |
| Transactions page | 2 transactions, 1 not confirmed, 1 not received; survives sign-out and reload |
| Train on 61 labelled receipts | registered as "RF v1 · labelled receipts (61 rows)", ROC-AUC and ROC curve shown, now used by scans |
| Rules vs forest vs combined (seeded synthetic labels) | McNemar exact p = 0.031 → H₀ rejected (the test data was made to differ; this checks the mechanics, not a finding) |
| Switch back to the demonstration model | scans use RF v0 again |

## 3h. Reports in the built app (V9.2)

Run with V9.2 accounts. Since V10.1 there are no accounts, so the cashier, "all users" and per-user parts no longer apply; a report now always covers this device (see 3j).

| Step | Result |
|---|---|
| Cashier enters a ₱1,500 GCash payment and marks it received | stored in the cashier's vault |
| Owner enters ₱2,000 with ref 8041241631871, then ₱20,000 with the same ref | the second is an edited copy (Earlier Check Comparison): possibly fraudulent, alert |
| Owner marks the ₱20,000 not received and the ₱2,000 received; detailed report, all users | "3 checks … 1 (33.3%) was classified possibly fraudulent, involving ₱20,000.00 … the classification matched it in 3 (100%) …"; per-user table owner 2 / cashier1 1 |
| PDF | valid PDF, 2 pages: findings, key figures, classification vs outcome, by app / type / warning sign / user, every check |
| Sign out, reload, sign in | the saved report is still listed |
| Activity log | report generation and typed transactions logged |

## 3i. The apps (V10)

Run with V10.0, which still had the administrator sign-in. The V10.1 apps open straight to Home (see 3j).

**Desktop (Electron 43, run on Linux under a virtual display with Playwright):**

| Step | Result |
|---|---|
| Opens `app://fraudsentry/index.html` | secure context; `require` is undefined (no Node.js in the page) |
| `fetch('https://example.com')` from the page | blocked |
| Privacy notice → create administrator → scan the blurred BPI receipt | OCR from the built-in engine; High · Possibly fraudulent · alert |
| Close and reopen the app | accounts and encrypted vault kept; sign-in required |
| `electron-builder --linux AppImage` | `FraudSentry-10.0.0-x86_64.AppImage` (136 MB) built |

**Android:** the SDK cannot be downloaded in the development sandbox, so the APK is built and tested by the GitHub Actions **Apps** workflow:
- the APK is installed on an Android 14 emulator;
- through the WebView debugging socket, the check confirms the page loaded from `https://localhost` inside the app with Web Crypto available;
- it then accepts the notice and creates the administrator.

The same check was run against headless Chromium here: "Welcome to FraudSentry", secure context, signed in as owner.

**First CI run (2026-10-20, run 39460539320): all jobs passed.**
- APK 11 MB, Windows installer + portable exe, macOS dmg, Linux AppImage.
- Emulator: Android 14 with its WebView (Chrome 113). The page loaded from inside the app (without the INTERNET permission), was a secure context with Web Crypto, and showed "Welcome to FraudSentry". The administrator was created and signed in.

**Not yet tested on a physical phone:** do that before the defense, especially the camera and the share sheet.

## 3j. No login (V10.1)

| Step | Result |
|---|---|
| Open the built file, accept the privacy notice | opens on Home; no sign-in, password or setup screen |
| Check a phishing message | alert toast; listed in Alerts; still there after reload |
| Reports → Generate a summary report (Playwright, Chromium) | "Summary report · <period>", no scope or user columns; no page errors |
| Android emulator (Apps workflow, tag `v10.1.0`, run 39514746001) | the page loads inside the app and opens on Home |
| Release `v10.1.0` | APK, Windows installer and portable exe, macOS dmg, Linux AppImage and the offline HTML attached by the workflow |
| Hosted copy for iPhone (Netlify) | uploaded; **check it in Safari on a real iPhone** (the sandbox cannot reach netlify.app) |

## 3k. The confirmation-number timing rule was wrong (V10.2)

A genuine BPI receipt (Sep 2 2026, confirmation no. 1624503955753) was rated High because that number decodes to Jun 24 2021. The V8.6 rule ("a BPI confirmation number is the transfer time") had been built from two receipts only. It was removed.

Re-scan in the built app:

| Receipt | V10.1.2 | V10.2 |
|---|---|---|
| Sep 2026 genuine (692 px and 1170 px) | High | **Low** |
| 2024 / 2026 genuine | Low | Low |
| Blurred copy | High | High |
| Date edited | High | High |
| Amount repainted | Medium | Medium |
| Confirmation no. edited | High | Low |

**Lesson for the defense:** every rule tuned on a handful of receipts must be checked on a larger set of genuine receipts before it is trusted. See "Pending" below.

## 4. Static checks
- `npm run typecheck` → 0 errors.
- `npm audit --omit=dev` (shipped dependencies) → **0 vulnerabilities** on 2026-10-07; CI now runs it on every push. Re-checked 2026-10-20 with the Capacitor runtime packages added: 0.
- Build-time only (never shipped): `@capacitor/cli → xcode → uuid` (moderate) and, in `desktop/`, `electron-builder → … → sprintf-js` (moderate). Both are used only while building.
- `npm audit` → 0 vulnerabilities on 2026-10-01. On 2026-10-05 a new advisory (GHSA-vfj7-8cjw-p6xm, `braces`, "high") reports 3 findings via `vite-plugin-singlefile → micromatch → braces`. No patched `braces` exists yet. It is a **build-time only** dependency: it matches file-name globs from our own build config, and none of it is shipped in the built app. Re-check when a fixed version is released.
- Tesseract SRI hash recomputed from the npm tarball → matches.

## 5. Pending — requires real respondents (NOT done)
- **Usability testing** with target users.
- **ISO/IEC 25010 evaluation** by the 10 IT experts specified in the methodology.
- Real-device testing on iPhone Safari and Android Chrome (including the live camera, permission prompt, flashlight and camera switching); Firefox.
- A **held-out** receipt set for an unbiased parser-accuracy figure (see §2), and a set of real/simulated edited receipts to measure how often the forensic and consistency checks catch fakes.
- A Filipino-language review of the UI copy.

Do not fill these in with estimated values.

## 6. Known limitations (open, by design)
- The masked destination account number and asterisk-masked sender names on some GoTyme receipts OCR as different noise each time (e.g. `Deeeeee/803`). Not regex-patched on purpose — it needs better image preprocessing.
- The built-in Random Forest is trained on a seeded **demonstration** dataset; real thesis metrics require a real labelled evidence CSV.
