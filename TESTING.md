# Testing — what is verified, and what is not

Everything listed as **verified** below was actually executed on 2026-10-01 against this source / its built `dist/index.html`. Nothing here is estimated or simulated. Items that need real people are marked **pending** — they have **not** been done.

## 1. Automated unit & regression tests — `npm test` (vitest)

**93 / 93 passing.**

| Suite | Tests | What it covers |
|---|---|---|
| `receiptParser.test.ts` | 29 | Issuer detection, field extraction and the Maya unsent-screen rule on **real OCR output** (redacted, see below); multi-pass merge (consensus reference, all-pass issuer detection, UI-label payees); synthetic edge cases |
| `messageAnalysis.test.ts` | 22 | PH scam rules, negated OTP warnings, bare-domain links, critical-flag floor, receipt ↔ conversation linkage incl. masked numbers / one-digit OCR errors / "to you" false-contradiction |
| `knowledgeBase.test.ts` | 22 | Every Knowledge Base example is detected with the right scam type; 11 ordinary messages stay Low |
| `model.test.ts` | 13 | Random Forest reproducibility, held-out metrics computed from real predictions, importances, the evidence-schema gate (PaySim / headerless / reordered rejected), shared-model wiring, feature vector |
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
| **V7** — final parser on fixed 3-pass OCR | **57/61 (93%)** | **58/59 (98%)** | **55/60 (92%)** |

What changed the numbers: GoTyme receipts no longer labelled GCash/Maya (8), Maya "Reference ID"s now read (12 — V6 read 0), GoTyme Trace IDs no longer swallow the next row, GCash references no longer absorb next-line digits, the revived OCR pass 1 fixed several amounts, consensus voting fixed disagreeing reference reads, bank-SMS tags (`[BPI]`) identify the issuer.

Remaining V7 misses (10): tiny, low-resolution reposts where Tesseract never read the reference/label at all (5), screens with no issuer marker in the text (4), and one Smart load screen where the parser takes the total (₱1,020) instead of the amount (₱1,000).

**Read these numbers carefully:**
- The parser changes were developed **while looking at this same set**, so these are **in-sample** figures and likely optimistic. An unbiased accuracy figure for the thesis needs a **fresh, held-out** set of receipts that was not used during development.
- One person labelled the data; the sample is a convenience sample, not representative of all receipts.

## 3. End-to-end tests of the built file (Playwright)

`dist/index.html` driven through every module with **real receipts**: consent → BUG-008 / renamed-file rejection → GoTyme receipt scan (issuer, Trace ID, Random Forest card, action plan, PDF download) → Maya unsent screen (Critical) → Message Analyzer → Cross-Evidence linkage → Model page (demo model connects; PaySim model evaluated but **not** connected) → overflow check on 9 pages × 4 widths (375, 414, 768, 1280) → network audit → console errors.

| Engine | Result | First scan (OCR + forensics) |
|---|---|---|
| Chromium | **18 / 18** | ≈ 11.5 s |
| WebKit (Safari's engine) | **18 / 18** | ≈ 16.8 s |
| Firefox | **not tested** — Playwright's Firefox could not be launched on the test machine (`spawn UNKNOWN`) | — |

Network audit: the only external hosts contacted were `cdn.jsdelivr.net` (Tesseract) and Google Fonts. No receipt or text is uploaded anywhere.

The same OCR flow was also run against the original `FraudSentry-V6.html`: it **hangs forever in Chromium** (served over http and opened as a local file) because its CSP blocks Tesseract's WebAssembly — fixed in V7 (see CHANGELOG).

WebKit is a strong proxy for iPhone browsers but is **not** a real iOS Safari device test.

## 4. Static checks
- `npm run typecheck` → 0 errors.
- `npm audit` → 0 vulnerabilities.
- Tesseract SRI hash recomputed from the npm tarball → matches.

## 5. Pending — requires real respondents (NOT done)
- **Usability testing** with target users.
- **ISO/IEC 25010 evaluation** by the 10 IT experts specified in the methodology.
- Real-device testing on iPhone Safari and Android Chrome; Firefox.
- A **held-out** receipt set for an unbiased parser-accuracy figure (see §2).

Do not fill these in with estimated values.

## 6. Known limitations (open, by design)
- The masked destination account number and asterisk-masked sender names on some GoTyme receipts OCR as different noise each time (e.g. `Deeeeee/803`). Not regex-patched on purpose — it needs better image preprocessing.
- The built-in Random Forest is trained on a seeded **demonstration** dataset; real thesis metrics require a real labelled evidence CSV.
