# Testing — what is verified, and what is not

Everything listed as **verified** below was actually executed on 2026-10-01 (V7), re-run on 2026-10-05 (V7.1) and again on 2026-10-07 (V8) against this source / its built `dist/index.html`. Nothing here is estimated or simulated. Items that need real people are marked **pending** — they have **not** been done.

## 1. Automated unit & regression tests — `npm test` (vitest)

**155 / 155 passing** (V8.1).

| Suite | Tests | What it covers |
|---|---|---|
| `receiptParser.test.ts` | 29 | Issuer detection, field extraction and the Maya unsent-screen rule on **real OCR output** (redacted, see below); multi-pass merge (consensus reference, all-pass issuer detection, UI-label payees); synthetic edge cases |
| `messageAnalysis.test.ts` | 22 | PH scam rules, negated OTP warnings, bare-domain links, critical-flag floor, receipt ↔ conversation linkage incl. masked numbers / one-digit OCR errors / "to you" false-contradiction |
| `knowledgeBase.test.ts` | 22 | Every Knowledge Base example is detected with the right scam type; 11 ordinary messages stay Low |
| `model.test.ts` | 15 | Random Forest reproducibility, held-out metrics computed from real predictions, importances, the evidence-schema gate (PaySim / headerless / reordered rejected), shared-model wiring, feature vector; V8: background training (`fitAsync`) builds the identical forest, and warm-up gives identical live-scan scores |
| `consistencyChecks.test.ts` | 17 | Amount + fee = total on real receipts (incl. waived fee, "tFee" misread); edited-amount and edited-total copies of a real receipt flagged; a misread in one pass ignored; principal vs total; date parsing; future, impossible and skewed dates |
| `historyMatch.test.ts` | 8 | Same receipt rescanned → reused note only; a real receipt with its amount edited → edited copy; the 8 distinct real receipts never match each other; same recipient at the same minute; one-digit OCR tolerance on long references |
| `forensicSignals.test.ts` | 8 | V8 thresholds: a typical genuine chat-forwarded JPEG raises nothing; the highest genuine ELA value measured (17.5 %) is not flagged; progressive/EXIF noted but unscored; editor signature, renamed file and odd crop still fire; future-date wording mentions the device clock |
| `fieldLocator.test.ts` | 4 | Field highlights: amount (not total), multi-group reference, date and recipient mapped to word boxes; values not on the image are not outlined |
| `activity.test.ts` | 7 | Home-page numbers: all zero without history, last-7-days, risky count, day streak (incl. ending yesterday, reset after a gap), milestones earned only from real history |
| `receiptParserWallets.test.ts` | 8 | V8.1, **real OCR** (redacted): Maya merchant purchases (identified without the logo, merchant as payee, "Purchase date" preferred), Maya Meralco bill, older GCash Express Send ("Rel Mo" reference), GoTyme paying a Maya wallet. Uses a neutral filename so the issuer is not given away by the fixture name. **5 of 8 fail on the V8.0 parser.** |
| `frameQuality.test.ts` | 8 | Live-camera frame measures on synthetic frames: crisp vs blurred, brightness, motion, hints; a white receipt with text is "ready", not "glare" |
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

## 4. Static checks
- `npm run typecheck` → 0 errors.
- `npm audit --omit=dev` (shipped dependencies) → **0 vulnerabilities** on 2026-10-07; CI now runs it on every push.
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
