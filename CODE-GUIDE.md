# FraudSentry code guide

This is a map of the source code for explaining the system: where each module lives, what each file does, and what to open when someone asks "show me how X works".

**One file to run, many files to read.** `npm run build` compiles everything in `src/` into one offline HTML file (`releases/FraudSentry-V10.2-offline.html`), which is what you open, and what the Android and desktop apps wrap. That file is generated and compressed, so explain the **source** in `src/`.

```
src/
├─ main.tsx · App.tsx      start-up, page switching, top bar
├─ receipt-check/          MODULE: fraud detection on payment receipts
├─ message-check/          MODULE: scam message analysis
├─ cross-evidence/         MODULE: receipt vs. conversation
├─ random-forest/          MODULE: the Random Forest classifier
├─ alerts/                 MODULE: fraud alerts
├─ transactions/           MODULE: transactions and their real outcome
├─ reports/                MODULE: fraud detection reports (PDF / CSV)
├─ history/                History page (every check on this device)
├─ knowledge-base/         Scam Knowledge Base page
├─ app/                    Home, About, Privacy, welcome notice, navigation
├─ shared/                 data store, types, helpers used by every module
├─ styles/                 all CSS
└─ __tests__/              automated tests (304)
```

---

## How one receipt check flows through the code

1. **`receipt-check/ReceiptCheckPage.tsx`:** the user uploads or photographs a receipt.
   - `checks/uploadValidation.ts` rejects non-images, empty files and files that are too big.
2. **`receipt-check/verifyReceipt.ts` → `analyzeTransactionImage()`** runs the whole check:
   1. **OCR:** `ocr/ocr.ts` → `runOcr()` reads the text with Tesseract, in three passes over cleaned-up copies of the image (`ocr/ocrFilters.ts`).
   2. **Reading the fields:** `reading/receiptParser.ts` → `parseReceiptMulti()` finds the bank/e-wallet, amount, reference, date and time and recipient; `transactionTypeOf()`, `transactionDirectionOf()` (sent or received) and `payeeOf()` (the biller or merchant) say what kind of payment it is.
   3. **Image checks** (`checks/`):
      - `imageForensics.ts`: error-level analysis (ELA), metadata and editor traces;
      - `hiddenFields.ts`, `obscuredRegions.ts`: blurred, pixelated or covered details;
      - `inkConsistency.ts`: a number re-typed in a slightly different colour;
      - `consistencyChecks.ts`: amount + fee = total, real non-future date, weekday matches the date;
      - `historyMatch.ts`: the same reference was already checked with another amount.
   4. **Rule score:** every failed check adds its weight.
   5. **Random Forest:** `random-forest/sampleDataset.ts` → `buildFeatureVector()` turns the evidence into 10 numbers, and `random-forest/sharedModel.ts` → `scoreWithSharedModel()` returns the forest's fraud probability.
   6. **Final score** = ½ rules + ½ forest, never below the floor a definitive finding sets (for example, hidden details ⇒ at least High). The risk level comes from that score: Low / Medium / High / Critical. **Classification:** High or Critical means *possibly fraudulent*; anything lower means *legitimate*.
3. **`shared/store.ts`** saves the result in the local history and, when it is High or above, calls **`alerts/alerts.ts`** → `alertForReceipt()`.
4. **`alerts/AlertToast.tsx`** shows the pop-up; the bell and **`alerts/AlertsPage.tsx`** list it.

---

## Modules

### Receipt Check: `src/receipt-check/`
| File | What it does |
|---|---|
| `ReceiptCheckPage.tsx` | The page: upload, live progress, verdict, fields read, reasons, next steps |
| `CameraScanner.tsx` | Live camera with framing and blur/glare hints (`checks/frameQuality.ts`) |
| `verifyReceipt.ts` | **The engine:** runs every check and computes the score (start here) |
| `ocr/` | Text recognition (Tesseract) and image pre-processing |
| `reading/receiptParser.ts` | Reads fields from the OCR text for GCash, Maya, BPI, BDO, GoTyme, MariBank and others |
| `reading/fieldValidation.ts` | Is each field plausible? (reference format per bank, amount, date) |
| `reading/fieldLocator.ts` | Where on the screenshot each field was read (for the highlights) |
| `checks/` | The individual fraud checks listed in the flow above |

### Random Forest: `src/random-forest/`
| File | What it does |
|---|---|
| `randomForest.ts` | **The algorithm, written from scratch:** bootstrap sampling, √n random features per split, Gini impurity, majority vote, feature importance; `trainTestSplit()`, `computeMetrics()` |
| `sampleDataset.ts` | The 10 evidence features, and the seeded demonstration dataset |
| `sharedModel.ts` | The forest the checks use, and switching it when a new model is trained |
| `trainingData.ts` | Training on labelled receipts; `compareApproaches()` (rules vs. forest vs. both) |
| `evaluation.ts` | `rocAuc()`, `rocCurve()`, `mcnemar()` (the hypothesis test) |
| `modelRegistry.ts` | Every trained model with its name, version and metrics (RF_MODEL) |
| `DetectionModelPage.tsx`, `ModelCards.tsx` | The page: train, metrics, confusion matrix, ROC curve, model history, hypothesis test |

### Alerts: `src/alerts/`
| File | What it does |
|---|---|
| `alerts.ts` | When an alert is created (High+ by default), its message, read / unread. The fields follow the ERD's ALERT table: `id`, `resultId`, `userId`, `message`, `riskLevel`, `status`, `dateGenerated` |
| `AlertsPage.tsx` | The Alerts page: filter, mark read / unread, view the check, alert-level setting |
| `AlertToast.tsx` | The pop-up when a new alert is raised |

### Transactions: `src/transactions/`
| File | What it does |
|---|---|
| `TransactionsPage.tsx` | Every payment checked, filters, CSV export, and the typed-details form |
| `transactionCheck.ts` | Checks a transaction from typed details only (reference format, date, earlier checks) |
| `TrainingLabel.tsx` | "Did the money arrive?": the transaction's status, which is also its training label |

### Reports: `src/reports/`
| File | What it does |
|---|---|
| `fraudReports.ts` | Builds a summary or detailed report for a period, including classification vs. the real outcome |
| `pdfReports.ts` | PDF output: the per-receipt and per-message reports, and period reports |
| `ReportsPage.tsx` | The page: choose type and period, view, download, reopen saved reports |

### Message Check, Cross-Evidence, Knowledge Base
| File | What it does |
|---|---|
| `message-check/messageAnalysis.ts` | Scam-language patterns (PH-specific), phishing-link checks; `analyzeMessageText()`, and `correlateEvidence()` for Cross-Evidence |
| `message-check/MessageCheckPage.tsx` | The page: paste or screenshot a message, see highlighted signs |
| `cross-evidence/CrossEvidencePage.tsx` | Receipt + conversation: do the amount, reference and recipient agree? |
| `knowledge-base/` | The Scam Knowledge Base page and its entries |

### Shared and app-wide
| File | What it does |
|---|---|
| `shared/store.ts` | The saved data (history, alerts, reports, settings) and the 30-day expiry (RA 10173) |
| `shared/types.ts` | The shape of every record (scan result, alert, transaction …) |
| `shared/helpers.ts` | Formatting, risk levels, the classification threshold, file saving |
| `app/` | Home, About, Privacy, the welcome / consent notice, sidebar, `nativeApp.ts` (Android / desktop differences) |

---

## What to open for common panel questions

| Question | Open |
|---|---|
| "Show us the Random Forest." | `random-forest/randomForest.ts`: `class RandomForest`, `fit()`, `predictProba()` |
| "What features does the model use?" | `random-forest/sampleDataset.ts`: `FEATURE_SPECS`, `buildFeatureVector()` |
| "How is the final risk decided?" | `receipt-check/verifyReceipt.ts`: the score section near the end of `analyzeTransactionImage()` |
| "How do you get accuracy, precision, recall, F1, ROC-AUC?" | `random-forest/randomForest.ts` → `computeMetrics()`, and `random-forest/evaluation.ts` |
| "How did you test the hypothesis?" | `random-forest/trainingData.ts` → `compareApproaches()`, and `evaluation.ts` → `mcnemar()` |
| "How does the alert system work?" | `alerts/alerts.ts`, then `shared/store.ts` (`addImageScan` creates the alert) |
| "How do you read the receipt?" | `receipt-check/ocr/ocr.ts` → `runOcr()`, then `reading/receiptParser.ts` |
| "How do you detect edited receipts?" | `receipt-check/checks/` (one file per kind of edit) |
| "Where is the data stored? Is it private?" | `shared/store.ts`: in the device only, 30-day expiry, no server |
| "Is it tested?" | `src/__tests__/`; run `npm test` (304 tests) |
