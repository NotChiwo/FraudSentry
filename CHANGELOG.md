# Changelog

## V10.2.0 — 2026-10-30

### Source code organised by module (no change to how the app works)
- **One folder per module** in `src/`: `receipt-check/`, `message-check/`, `cross-evidence/`, `random-forest/`, `alerts/`, `transactions/`, `reports/`, `history/` and `knowledge-base/`, plus `app/`, `shared/` and `styles/`. Before, files were spread over `pages/`, `services/`, `engine/` and `components/`.
- **Clearer names:**
  - `ScannerPage` → `ReceiptCheckPage`
  - `MessageAnalyzerPage` → `MessageCheckPage`
  - `ModelPage` → `DetectionModelPage`
  - `ReportsPage` (which was the History page) → `HistoryPage`
  - `FraudReportsPage` → `ReportsPage`
  - `imageVerification` → `verifyReceipt`
  - `reportGenerator` → `pdfReports`
  - `useAppStore.ts` → `shared/store.ts`
- **CSS:** all files are in `styles/`. Class names left from the removed admin pages were renamed (`admin-card` → `panel`, `admin-table` → `data-table` …), and the form error message got the style it was missing.
- **Comments:** every file starts with a plain-language note of what it does. Version and bug tags were removed from comments.
- **New [CODE-GUIDE.md](CODE-GUIDE.md):** what each folder and file does, how one receipt check flows through the code, and what to open for common panel questions.


### Genuine BPI receipts no longer flagged by the "confirmation number timing" rule
- **The bug:** a genuine BPI transfer (Sep 2 2026, PHP 12,000) was rated **High / possibly fraudulent**. The only failed check was "Confirmation Number Timing".
- **Why:** the V8.6 rule assumed a BPI confirmation number is the transfer time in milliseconds. That held on the two receipts it was built from, but this one (1624503955753 decodes to Jun 24 2021) shows it does not hold for BPI receipts in general.
- **The fix:** the rule is removed from receipt checks and from typed-details checks. The weekday ↔ date check stays, because it rests on how the app prints the date, not on a guess about the number.
- **What it costs:** a receipt where *only* the confirmation number was edited is no longer caught by this rule. That catch was never reliable.
- **Re-scanned in the built app:**

  | Receipt | Result |
  |---|---|
  | New BPI receipt (692 and 1170 px) | Low |
  | Genuine 2024 and 2026 BPI receipts | Low |
  | Blurred copy | High |
  | Date edited | High (weekday) |
  | Amount repainted | Medium |
  | Confirmation number edited | Low (see above) |
- **Regression test:** the new receipt's OCR (redacted) is now a test fixture: every field must be read and the weekday must be consistent.

Tests: 296 → **290**: the timing-rule tests were removed, and the new receipt test was added.

## V10.1.2 — 2026-10-22

### Genuine GCash receipts no longer flagged as "blurred or pixelated"
- **The bug:** a genuine GCash Express Send receipt was rated HIGH risk, "7 parts of this receipt are blurred or pixelated". All 7 hits were app content, not edits: the photo ad banner GCash shows under the reference line, and the iOS battery icon.
- **The fix:** a pixelated or covered area now only counts when the strip around it is flat app UI (its 3 commonest colours fill at least 60 % of it). A redaction is laid over text on a card; a photo or an icon is many colours. On the reported screenshot (828, 1179 and 1290 px wide) the false hits scored at most 0.49, while a pixelated name and reference on the same screenshot scored at least 0.75, so real mosaics are still caught.
- GCash's own name masking (`JO•••••E O.`) was never the cause and is still not flagged.
- **Regression tests:** two crops of that screenshot with no personal data (the ad banner and the battery icon) must give no hidden areas, and a pixelated reference next to the ad banner must still be found.

Tests: 291 → **296**.

## V10.1.1 — 2026-10-21

### Ready for the defense
- **Intel Macs:** the release now has a macOS build for Intel (`…-x64.dmg`) next to the Apple-chip one (`…-arm64.dmg`).
- **How to open it:** new [docs/OPENING-THE-APP.md](docs/OPENING-THE-APP.md) with step-by-step instructions for Windows, macOS, Linux, Android and iPhone (hosted page at fraudsentry-bscs.netlify.app), including how to get past the warnings for unsigned apps. The README points to the release downloads instead of the 30-day Actions artifacts.
- **TESTING.md:** new section 3j for the no-login version; the V9.2 and V10.0 sections that used accounts are marked as such.
- No change to detection, alerts or the app's screens.

## V10.1 — 2026-10-21

### Login and administration removed
FraudSentry is a one-person tool again: it opens straight to Home after the privacy notice. No sign-in, no accounts, no admin.
- **Removed:** sign-in and setup screens, administrator / user roles, lock-out, auto sign-out, the Administration page (users, activity log, settings), the Your account page, per-user encrypted vaults, and "all users" reports.
- **Kept:** alerts, Transactions (with "did the money arrive?"), Reports, the Model page extras (registry, ROC-AUC, McNemar test), and the Android and desktop apps.
- **Storage:** the history (checks, typed transactions, alerts, reports) is saved in this browser / app again, still with the 30-day expiry. History that V9.0–V10.0 had held back for a first administrator is loaded again. History that was already moved into an encrypted account vault in V9.0–V10.0 cannot be opened without that account, and is left untouched.
- The privacy notice says "No account, no tracking" again, and is shown once more (notice version 4).

- **Leftovers tidied:** alerts no longer carry a user id, reports are always for this device (no scope, user or "by user" columns), and the unused sign-in and administration styles are gone.

Tests: 306 → **291** (the account, session and all-users report tests were removed with the feature).

## V10.0 — 2026-10-20

### FraudSentry as installable apps
Both apps wrap the offline single-file build (OCR built in), so they work with no internet. See README → "Installable apps".
- **Android app** (Capacitor 8, `com.fraudsentry.app`):
  - No INTERNET permission: Android guarantees nothing can be sent anywhere.
  - Camera permission only, for the live receipt camera; `allowBackup` off.
  - Edge-to-edge layout with safe areas.
  - Hardware back button: closes an open panel, then returns to Home, then leaves the app.
  - PDFs and CSVs go to the share sheet, because a WebView cannot download. All saving now goes through `src/platform/native.ts`.
  - New launcher icon (adaptive, brand gradient) and splash screens.
- **Desktop app** (Electron 43, Windows / macOS / Linux):
  - Every http(s) request is blocked; sandboxed, with context isolation and no Node.js in the page.
  - No navigation away and no new windows; https links open in the browser.
  - Only camera permission; a single instance.
  - Served from an `app://` secure origin, so the data persists and Web Crypto works.
- **GitHub Actions "Apps" workflow** builds the APK, the Windows installer and portable exe, the macOS dmg and the Linux AppImage on every push. It smoke-tests the APK on an Android 14 emulator: the page must load inside the app, Web Crypto must be available, and creating the administrator must work. A `v*` tag publishes everything to a GitHub Release.
- Dependencies are pinned to releases at least two weeks old: Capacitor 8.5.2 / app 8.1.2 / filesystem 8.1.4 / share 8.0.3, Electron 43.7.7, electron-builder 26.15.3.

## V9.2 — 2026-10-20

### Fraud detection reports (thesis Module 5, REPORT table)
- **New Reports page.** Generate a **summary** or **detailed** report for today, the last 7 or 30 days, this month or a custom range. Administrators can report on **all users** of the device; the report then includes a per-user breakdown.
- **What a report contains:**
  - **Counts:** checks by kind (receipts, typed transactions, messages, cross-evidence), the classification (possibly fraudulent / legitimate), risk levels, and payment outcomes (pending / received / not received).
  - **Classification vs what really happened:** caught, missed, false alarms and correct results, with accuracy, precision and recall, based on the outcomes users confirmed in their own accounts.
  - **Totals and breakdowns:** the claimed amount in flagged payments; breakdowns by bank / e-wallet, transaction type, most common warning signs, and which models scored the receipts; alerts.
  - **A plain-language description** of the findings (REPORT.description).
  - **Detailed reports only:** a table of every check in the period.
- **Saved and reopenable.** Reports are stored in the generating user's encrypted vault (`report_id`, `user_id`, `report_type`, `description`, `generated_date`), expire after 30 days with the history, and can be reopened, downloaded as **PDF** or **CSV**, or deleted.
- Report periods use Philippine dates (UTC+8), as do the Transactions date filters.
- The receipt PDF now also prints the classification, the model that scored it and the confirmed outcome.
- Generating a report is written to the activity log.

Tests: 299 → **306** (`fraudReports.test.ts`).

## V9.1 — 2026-10-20

### Transactions (thesis Module 2)
- **New Transactions page.** It lists every payment checked on this device, from a screenshot or from typed details, with:
  - amount, app or bank, transaction type, reference, recipient and transaction date;
  - risk level and classification;
  - outcome (see below).

  You can filter by outcome, classification, app/bank, type and date range, search, and export the filtered list as CSV.
- **Did the money arrive?** After checking their own account, the user marks each receipt **Received** or **Not received** (TRANSACTION.status: pending / received / not received, with the time it was marked). On a receipt, that real outcome **is its training label**: received = genuine, not received = fake. This replaces the separate "Genuine / Fake" buttons, so labelling happens as part of normal use.
- **Check typed details.** For when the buyer only sends "sent na po, ref …", with no screenshot. The details are checked:
  - the reference is present and has that app's format;
  - the date is real and not in the future;
  - for BPI, the confirmation number matches the stated time;
  - the reference is compared with earlier checks: a reused reference, or the same reference with another amount (an edited copy).

  It is clearly marked rules-only, because image forensics and the Random Forest need an image. Risky results raise an alert.
- **Transaction type** is read from each receipt's wording: Send Money, Bank Transfer (including OCR's "instaFay" for InstaPay), QR Payment, Bill Payment, Purchase, Cash In, Cash Out. It is correct on all 16 real receipts in the test fixtures.

### Fraud results (FRAUD_RESULT)
- Every result now has a **classification**: *Possibly fraudulent* (High or Critical, risk ≥ 0.45) or *Legitimate*, shown on the result page and in Transactions.
- Every scan records **which model scored it** (`model_id`, `model_name`).
- The score floors set by definitive findings (hidden details, future date, BPI timing …) are now kept as `scoreFloor`, so an evaluation can replay exactly how a result was scored.

### Model management (RF_MODEL)
- **Model registry.** Every forest trained on the Model page is recorded with:
  - name and version (auto "RF v3 · labelled receipts (61 rows)" or your own name);
  - data source, trees / depth, train / test rows;
  - accuracy, precision, recall, F1, **ROC-AUC** and the confusion matrix;
  - feature importance, date and who trained it.

  The page shows the model in use. You can switch back to an earlier labelled-receipt model (rebuilt exactly from the same rows) or to the built-in demonstration model.
- **ROC-AUC and ROC curve** on the Model page, computed from the forest's probabilities on the held-out 30 %.
- **Hypothesis test: does the Random Forest improve detection?**
  - On labelled receipts, the same held-out 30 % is classified by the rules alone, by the forest alone, and by FraudSentry's combination.
  - Each approach gets accuracy, precision, recall, F1, ROC-AUC and TP / FP / TN / FN.
  - **McNemar's test** (exact binomial for fewer than 25 disagreements, χ² with continuity correction otherwise) reports whether H₀ (no difference) is rejected at α = 0.05.
  - It uses receipts whose outcome was marked from V9.1 on, because they keep their rule score.

Tests: 279 → **299** (`evaluation.test.ts`, `transactions.test.ts`).

## V9.0 — 2026-10-20

### Local accounts (thesis Module 1) and administration (Module 7)
Everything still runs on the device with no server. Accounts, keys and data never leave it.
- **Sign-in.** The first account created on a device is the **administrator**. Administrators add users, with a temporary password that must be changed at first sign-in. They can also allow self sign-up, which is off by default.
- **Passwords are never stored.** PBKDF2-SHA-256 with 600 000 iterations and a random salt produces a key that unlocks the user's data. The directory keeps only a verifier hash, the "hashed password" of the USER table.
- **Each user's history is encrypted** (AES-GCM 256), using their own key. History, alerts and the alert setting live in that user's encrypted "vault", and nothing personal is left in plain browser storage.
  - Users cannot see each other's checks.
  - The administrator can open them for review. Every user's key is also sealed with the organisation's RSA-OAEP key, which only administrators can unlock.
  - The same mechanism lets the administrator reset a forgotten password **without losing the user's data**.
- **Lock-out:** 5 wrong passwords lock an account for 5 minutes, doubling for each further lock-out, up to 60 minutes. The sign-in screen shows a countdown. An administrator can unlock early.
- **Automatic sign-out** after 15 minutes without activity (adjustable from 5 minutes up to never). Reloading the page also signs out, because the keys exist only in memory.
- **Roles:** standard users get Home, Check Receipt, Check Message, History, Alerts, Cross-Evidence and the learning pages. Administrators additionally get the **Detection Model** and **Administration** pages, and every admin action is re-checked against the role. There is always at least one active administrator.
- **Administration page:**
  - **Overview:** users, checks, high/critical results and unread alerts, per user and in total, plus the model in use.
  - Read-only **records** of any user.
  - **Users:** create, reset password, make admin/user, disable/enable, unlock, delete.
  - **Activity log.**
  - **Settings:** sign-up and auto sign-out.
- **Tamper-evident activity log.** It records:
  - sign-ins, failed sign-ins, lock-outs and sign-outs;
  - account and setting changes;
  - every check, with its result id and risk level only;
  - history and label deletions;
  - model training.

  Each entry stores the SHA-256 of the previous one. **Verify integrity** reports the first entry that was edited, removed or re-ordered outside the app. The log can be exported as CSV, and it holds no receipt or message contents.
- **Upgrading from V8.x:** history saved in plain storage moves into the first administrator's vault, then is removed from plain storage.
- The privacy notice was updated: it now explains local accounts and administrator review, and is shown once more (notice version 3).
- `tools/compare-versions.mjs` signs in to V9+ builds with its own account, and reads results from that account's vault with its own password.

Tests: 264 → **279** (`accounts.test.ts`, `session.test.ts`; alerts persistence tests rewritten for vaults).

## V8.7 — 2026-10-20

### Alerts (thesis §9.5.1, Notification & Alert Management)
- **Fraud alerts.** A check that comes back **High or Critical** (adjustable: Critical only / High and Critical / Medium and above) generates an alert. Its fields follow the ERD's ALERT table: `id` (alert_id), `resultId` (result_id), `userId` (user_id, empty until user accounts exist), `message`, `riskLevel` (risk_level), `status` (unread / read) and `dateGenerated` (date_generated).
- **The message says why:** the app, amount and reference, the strongest failed checks, and what to do. For example: "BPI receipt for ₱15,000.00. Main reason: Hidden or Blocked-Out Details. Do not release goods or money until the payment shows in your own account."
- **Notice when it happens.** A pop-up names the risk level and opens the Alerts page. The topbar bell and the sidebar show the unread count. This replaces the old "high-risk" pill, which counted results and couldn't be cleared.
- **Alerts page:** filter All / Unread / Read, mark one read or unread, "Mark all as read", "View check" (opens History at that check, highlighted, and marks the alert read), delete one, delete all.
- **Alert history follows the checks.** Alerts are saved with the history on this device. An alert is removed together with its check: deleting it, "Delete all", or the 30-day expiry. A Cross-Evidence run saves three records but raises **one** alert (for the combined result).
- No email or SMS: those need a server, and nothing leaves the device. Alerts are in-app only.

Tests: 252 → **264** (`alerts.test.ts`).

## V8.6 — 2026-10-18

### BPI online-banking receipts
Tested on three real BPI receipts: two genuine ones (2024 and 2026 layouts) and a copy of the 2026 one with the date, confirmation number and recipient name **blurred**.
- **(fix) False alarm on a genuine BPI receipt.** The 2024 receipt scored **High**: "Confirmation No." wasn't read as the reference, and the recipient under "Transfer to" wasn't found, so the app claimed the receipt "names NO recipient". It is now **Low**, with every field read.
- **(fix)** On the 2026 layout, the headline "Transfer successful!" was taken as the recipient's name.
- **Reading BPI receipts:** "Confirmation No." is the reference. The "Transfer to" block is read: the nickname "Juan (QR Code)", the bank's masked legal name "V•• JE•••O …" (OCR dots are read as mask bullets), and the masked account `xxxxxxxxxxx627`.
- **New check — confirmation number ↔ time.** A BPI confirmation number is the moment of the transfer in milliseconds since 1970. On both genuine receipts it decodes to 2–3 seconds before the time shown (1710966602347 → Mar 21 2024 04:30:02, shown 04:30:05). Editing the date, the time or the number breaks this, which makes the result at least **High**. Only applied to BPI numbers that decode to a plausible date.
- **New check — weekday ↔ date.** "Monday, Jun 29 2026" must really be a Monday. It applies to any receipt that prints a weekday. A mismatch makes the result at least **High**.
- **New hint — text colour consistency.** A number typed over by an editor is usually a slightly different tint from the app's own text. The amount and long-reference lines are compared with the receipt's other text of the same size and darkness, with an allowance that adapts to each image's noise. A tint that recurs elsewhere is treated as a design colour. A suspicious line is outlined, and the result is at least **Medium** (a hint, not proof).
- Hidden-detail wording now says "blurred or pixelated": blur is caught too, as on the blurred BPI copy.
- After hidden details are found, a time read without its date (usually from the blurred date line) is no longer shown.

**Measured (real BPI receipts plus edited copies made for this test; not a held-out set):**

| Receipt | V8.5 | V8.6 |
|---|---|---|
| BPI 2024, genuine | **High** (false alarm) | Low |
| BPI 2026, genuine | Low (wrong recipient) | Low (all fields right) |
| BPI 2026, blurred copy | High | High: details hidden |
| BPI 2026 with the date edited | Low | **High**: weekday + confirmation time |
| BPI 2026 with the confirmation no. edited | Low | **High**: confirmation time |
| BPI 2026 with the amount edited | Low | **Medium**: colour hint, line outlined |

The colour hint raised **no false alarm on any of 43 clean / genuine images** (34 synthetic screenshots incl. busy app UI, 2 real BPI, 1 real GCash, 6 others).

### Welcome screen
- **(fix) The welcome / privacy-notice screen was shown only once.** After that, the app always opened on the dashboard. The notice now has a version: when it changes, which it did in V8.5–V8.6 (training labels, 30-day expiry), everyone sees it once more. It can also be opened any time from the footer ("Welcome screen") or the Privacy page, or by adding `#welcome` to the address (handy for a demo). "Back to FraudSentry" returns without re-accepting.

Tests: 231 → **252** (`bpiReceipts.test.ts` with redacted real BPI OCR, `inkConsistency.test.ts`).

## V8.5 — 2026-10-18

### Train the Random Forest on real receipts
Until now every scan was scored by a forest trained on the seeded **demonstration** dataset, so the Model page's metrics described made-up data.
- **Label your scans.** The result page and every History receipt have **Genuine / Fake** buttons. A labelled scan keeps only the 10 numeric evidence values the forest scored and the label: no name, number, amount, reference or text. Labels aren't removed by the 30-day history expiry or "Delete all" (they have their own "Delete labels").
- **Exact features.** Each scan now records the exact vector the forest scored (`forestAnalysis.features`), so training and scanning always use identical features. Scans saved before V8.5 are rebuilt from their evidence.
- **Model page → "Use my labelled receipts".** It needs at least 20 receipts, with at least 5 of each kind. Training uses the usual seeded 70/30 split and reports metrics on the held-out 30 %.
- **Kept after restart.** The connected model is rebuilt from the same rows when the app reopens (same rows + seeded split = the identical forest), and scans wait for it. The demo model never quietly comes back.
- **History → "Download training CSV".** `tools/compare-versions.mjs --features` writes the same kind of CSV for a whole labelled folder in one run.

### Offline build: OCR without internet (for defense day)
- **`npm run build:offline` → `releases/FraudSentry-V8.5-offline.html` (11.4 MB).** It embeds the pinned Tesseract engine, its SIMD WebAssembly core and the English + Filipino data, and drops Google Fonts. Tested with **all network access blocked**: three receipts read exactly as online (confidence 95 / 78 / 94, same risk levels), ~6–8 s per scan, and **no network request made**.
- The build fails if the embedded engine doesn't match `TESSERACT_SRI`. CI now builds it on every push.
- The normal build is unchanged (1.36 MB; Tesseract from jsDelivr; none of the offline code is included).

Tests: 220 → **231** (`trainingData.test.ts`). End-to-end in the built app: label a scan, train on the Model page, reload, and the labelled model is still the one used.

## V8.4 — 2026-10-15

### Hidden details are now caught (pixelated or covered fields)
A real GCash receipt with the recipient name, mobile number and reference number pixelated came out **Low — "No signs of editing found"**. Nothing checked for blocked-out details, and the parser built a fake name (`FRel iL =" …`) and mobile number out of the mosaic noise. That receipt is now **High — "Details are hidden — cannot be verified"**.

- **Pixel check (`obscuredRegions.ts`):**
  - **Mosaics.** Pixelation leaves small, flat, roughly square tiles in an *in-between* shade of the local background and ink, with hard edges, and several different shades side by side. Anti-aliased text never has a flat in-between patch. UI tints, pills and cards are ruled out by their shape and by having a single shade.
  - **Cover boxes.** A flat, detail-free bar the height of a text line, in a redaction colour: black, white on a non-white background, or the ink colour of text on the same line.
  - Hidden areas are outlined in red on "Where we read it".
- **Text check (`hiddenFields.ts`).** OCR reads the "Ref No." label but only junk where the number should be (`"Bf “Ew 9904 Bb`). This also catches covers the pixels can't show, such as a white box on a white card.
- **Scoring.** Either signal adds the **Hidden or Blocked-Out Details** finding and sets the risk to at least **High**. A receipt with its reference hidden can't be checked, so it must not be accepted. The action plan says to ask for the full, unedited screenshot. It is not called Critical, because people also blur their own receipts before posting them.
- **Parser.** Quote marks, `®`, `=`, `|` … are no longer accepted in a recipient name. A mobile number read through a mosaic is dropped instead of shown.
- **Honest wording.** A Low result now says "No problems found by these checks" and "That doesn't prove the receipt is genuine", instead of "No signs of editing found".

**Measured (synthetic, and tuned on that same set, so in-sample):**
- 34 clean screenshots, including busy app UI, as PNG and chat-compressed JPEG: **0 flagged**.
- 270 edited copies:
  - mosaics with 6–14 px tiles: **97 %** caught;
  - 22 px tiles over small text: 48 %;
  - black boxes: 67 % (the misses are on a black background, where a box is invisible);
  - white boxes: 0 % by pixels. These rely on the text check.
- The real pixelated GCash receipt: flagged by both checks.
- **Not measured: the false-alarm rate on real genuine screenshots.** Run `tools/compare-versions.mjs` on your genuine set before quoting the detector at the defense.

Tests: 207 → **220** (`hiddenFields.test.ts`: images drawn in code, the real pixelated receipt's OCR with the name replaced, and no false alarm on any of the 13 real-OCR fixtures).

## V8.3 — 2026-10-15

### New: compare two builds on the same evidence
- **`tools/compare-versions.mjs`** runs two or more built HTML files (V6, V7, V8 …) headlessly over the same receipts and messages and scores them against a labels file you write beforehand. It reports issuer / amount / reference accuracy, **fakes caught**, **false alarms on genuine receipts** and message accuracy, plus a table of every file where the builds disagree. Results are read from each build's own saved history, and pages are found by their old and new names, so it works across versions. `--bypass-csp` gives every build working OCR; `--tesseract-mirror` serves Tesseract from a local npm copy. See TESTING.md §3a.

### Receipts
- **Amount reconciliation without a fee line.** GCash "Send Money" receipts print only Amount and Total Amount Sent, so V7.1's check (amount + fee = total) never ran on them. Now, when no fee is printed, a total below the amount, or more than ₱50 above it, is a mismatch. A smaller gap may be an unread fee. It is judged only when the amount sits on an "Amount" row. No alarm on any of the 13 real-OCR fixtures.
- **The destination is never the issuer — for every bank.** Bank names after "To:", "Destination", "Recipient bank", "Transfer to" … are ignored when choosing the issuer. The earliest remaining mention wins, and keywords match whole words only ("Aubrey" is not AUB). Previously only GoTyme had this protection.
- **More institutions:** Chinabank, EastWest, PSBank, AUB, Tonik, UNO Digital Bank, UnionDigital, OFBank, ShopeePay, GrabPay, Coins.ph and PalawanPay. **SeaBank → MariBank**: SeaBank Philippines rebranded as MariBank in 2025, so both names identify MariBank.
- **Editor signatures in PNG and WebP.** Only JPEG metadata was read before, but most receipt screenshots are PNG. Now PNG `tEXt` / `zTXt` / `iTXt` / `eXIf` and WebP `EXIF` / `XMP` are read too. More editors are recognised (Photopea, Meitu, PhotoRoom, Fotor, Affinity Photo, Adobe Express).
- **(fix)** `image/jpg` and `image/pjpeg` (non-standard JPEG types some phones report) were flagged as a renamed file.

### Messages
- **Fake government notices.** A message naming the LTO, MMDA, DSWD, SSS, PhilHealth, Pag-IBIG, BIR, NBI, PNP … that links anywhere except a `.gov.ph` site is critical, classified as Government Impersonation. New rules: "unpaid traffic violation / toll / fine", "license suspension / alarm block", ayuda by link or for a fee.
- **Money-mule recruitment:** offers to rent, borrow or buy a GCash / Maya / bank account. This is a crime under RA 12010 (AFASA).
- **"Scan this QR to receive"**: receiving money never requires a QR scan or your MPIN.
- **SIM / e-wallet "re-registration" links** (the DICT advisory pattern).
- **Official domains** were added for MariBank, CIMB, Chinabank, EastWest, PSBank, AUB, Tonik, UNO, UnionDigital, OFBank and Coins.ph, each checked against the institution's own site. ShopeePay and GrabPay were left out on purpose: `shopee.ph` and `grab.com` are the shopping and ride sites, not banking domains.
- **Knowledge Base: 10 → 13 entries.** New: Fake Government Notice (LTO / Ayuda), Account Rental / Money Mule, and "Scan to Receive" QR. Each has a quick rule and the advisory it is based on. The page header now counts its entries.

### Random Forest
- **Soft voting.** The probability is the mean leaf probability (as scikit-learn does), not the share of 0/1 votes. The "N/M trees" figure is now the exact vote count.
- **(fix) Train/scan mismatch in `metadata_consistency`.** It was random noise in the demo training data but `100 − ELA − 25·editor` at scan time. It now has one definition used by both, built from metadata checks: spoofed container, editor signature, non-screen geometry. It no longer repeats ELA, and it leaves out progressive JPEG / EXIF, which V8 measured as normal on genuine images.

### Privacy and robustness
- **Local history is deleted after 30 days** (RA 10173 data minimisation). The Privacy page and consent screen say so. The saved-data store is versioned. This also bounds the earlier-scan comparison and the Home streak to 30 days.
- A crashing page shows "Try again / Back to Home" instead of blanking the app.
- `noUnusedLocals` / `noUnusedParameters` are on; three dead imports were removed.
- Tests: 168 → **207**.

## V8.2 — 2026-10-07

### Scam Knowledge Base: master–detail redesign
- **Two panes from 720 px** (list 300 px, 240 px below 1024 px), each scrolling inside itself. Below 720 px it becomes list → detail, with an "All scams" Back button. The phone/browser back button and swipe-back also return to the list (history state + popstate), and focus goes back to the item that was opened. On phones the page intro is hidden while a detail is open, so the scam fills the screen.
- **Faster to scan:**
  - a one-sentence **quick rule** for every scam;
  - at most 4 short red flags and tips, with icons;
  - trigger words highlighted in the typical message, using the Message Analyzer's **own** matches (flag start/end), not a hand-made list;
  - a filter box with a "no results" state.
- **"Try this example in Check Message"** prefills the example, labelled "Example message". It is **not** run automatically, and analyzing the unchanged example is **not** saved to History, so it doesn't count toward Home activity. Once the text is edited it becomes a normal check. **Fake Proof of Payment** offers "Check a receipt instead".
- **Quick rules checked against public advisories** (each entry shows a "Based on" line): GCash, Maya and BSP (OTP and links), the GCash fake-receipt advisory, the Bureau of Customs (parcel fees), BSP, GCash and Maya on wrong transfers, DTI (raffle texts), SEC (investment, task jobs, advance-fee loans), and PNP-ACG (task scams).
  - **Wrong-send** uses "Don't send money back on a stranger's word. Report it to your bank or e-wallet first and follow their process." The proposed "Don't refund it yourself" was **not** used, because GCash and Maya (as summarised by GMA News) tell receivers to return a genuine mistake when asked.
- **Accessibility:**
  - vertical tabs with roving tabindex, Arrow/Home/End keys, `aria-selected` / `aria-controls`, a labelled tabpanel, and a live region announcing the selected scam;
  - on phones a plain list of buttons, since no panel is on screen there;
  - 44 px targets, nothing under 12 px, 15 px detail text (16 px on phones), and reduced motion respected.
- **(fix)** The info banner showed a literal `you\u2019ll`, and the phishing entry showed a literal `\u2019` (double-escaped). Both now use real apostrophes, and a test guards against it.
- **Data:** `ScamEntry` gains `hint`, `quickRule`, `basis` and `tryIn` for all 10 entries, now in everyday-first order. The `example` texts are unchanged.
- **Tests:** 155 → **168** (`knowledgeBasePage.test.ts`, 13 tests).

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
