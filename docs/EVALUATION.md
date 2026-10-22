# Measuring FraudSentry on real receipts (for the defense)

This produces the figures Chapter 4 needs: how often FraudSentry **catches an edited receipt**, how often it **wrongly flags a genuine one**, how well it **reads the fields**, and a **real labelled CSV** to train the Random Forest so results no longer say "RF v0 · demonstration (built-in)".

Everything runs on your own computer. Your receipts never go into the repository. Keep every folder below **outside** the repo folder.

## What you need
- Node 22 and this repo with `npm ci` done.
- Playwright: `npm i -g playwright`, then `npx playwright install chromium`.
- An offline build: `npm run build:offline` (creates `dist-offline/index.html`).
- **Genuine** receipt screenshots in one folder, as PNG or JPG. Aim for at least 25, across GCash, Maya, GoTyme and BPI if you have them. Use real screenshots straight from the phone, not photos of a screen.

## 1. Make the edited copies

```
node tools/make-edited-set.mjs --genuine ~/fs-eval/genuine --out ~/fs-eval/set
```

For each genuine receipt this writes eight files and a `labels.csv`:

| File | Truth | What was done |
|---|---|---|
| `name.png` | genuine | the original |
| `name-forwarded.jpg` | genuine | re-saved the way Messenger or Viber does it (smaller, JPEG) |
| `name-amount.png` | fake | amount **and** total changed to the same new figure |
| `name-amount-only.png` | fake | amount changed, total left alone |
| `name-date.png` | fake | the day of the date changed |
| `name-ref-pixelated.png` | fake | reference number pixelated |
| `name-ref-covered.png` | fake | reference number covered with a box in the text colour |
| `name-name-covered.png` | fake | recipient name covered with a black box |

If the tool cannot find a field on a receipt (for example, no date), it skips that edit and tells you which one. It never guesses. **Open a few edited images.** If one looks obviously broken, delete it and remove its row from `labels.csv` before scoring.

These are **simulated** edits made by a script. Say so in the paper. If you can, add 10–20 fakes edited by hand (a phone photo editor, or Canva or Photoshop) to the same folder, each with a `fake` row in `labels.csv`, because a person's edit is harder to catch.

## 2. Score the build

```
node tools/compare-versions.mjs --build FraudSentry=dist-offline/index.html \
  --receipts ~/fs-eval/set --labels ~/fs-eval/set/labels.csv \
  --fresh-per-receipt --features --out ~/fs-eval/results
```

- `--fresh-per-receipt` scans each file in a fresh browser profile. Without it, a fake can be caught only because its genuine original was scanned just before ("Earlier Scan Comparison"), which inflates the catch rate.
- One scan takes about 10–15 seconds, so 200 files take about 45 minutes.

`results/summary.md` gives you:
- **Fakes caught** (High or Critical) and **fakes at least warned** (Medium or higher). This is the detection rate.
- **False alarms** on genuine receipts (High or Critical), plus genuine receipts shown as Low.
- Issuer, amount and reference **read correctly**, which is your field accuracy.

`results/results.csv` has one row per file, with the risk level, scores and the checks that failed. Use it for the per-edit-type table (join it with the `edit` column of `labels.csv`).

## 3. Train the Random Forest on real data

`--features` also writes `results/features-FraudSentry.csv`. It holds the exact evidence each scan was scored on plus your genuine/fake label. Only numbers are stored: no names and no reference numbers.

In the app, open **Model → Upload labelled CSV**, choose that file, and train. It needs at least 20 rows, with at least 5 genuine and 5 fake. From then on, results say which trained model scored them, and the Model page shows accuracy, ROC-AUC and the McNemar test (rules vs forest vs combined) on held-out rows of **your** data.

**On defense day:** a model trained from an uploaded CSV lives only until the app is closed or reloaded. After that, scans go back to the demonstration model. Upload the CSV again just before you present. Alternatively, train from receipts scanned **inside** the app and labelled under Transactions ("received" / "not received"); that model is kept after a restart.

For honest numbers, split your genuine receipts **before** step 1: one folder to train on and a separate folder to test on. Make edited copies of each folder separately, train on the first and report on the second. A receipt the model was trained on must not be in the test set.

## Rules that keep the figures honest
- Write `labels.csv` before scoring (the tool does this) and never change a label after seeing a result.
- If you change the code after seeing results on a set, that set is no longer a held-out test. Collect new receipts or say so.
- With about 25 receipts per group, 1–2 receipts is noise. Report counts ("21/25"), not only percentages.

## What a first run showed (one genuine GCash receipt, 2026-10-22)
This was a smoke test of the tools, not a thesis figure. Scored with `--fresh-per-receipt`:
- Both genuine copies (the original and the chat re-save) were rated Low.
- A changed amount with the total left alone, a covered name, a covered reference and a pixelated reference were all rated High. The two reference cases were Low until V10.1.x fixed it: OCR read the hidden number as letters ("Ref No. INE"), and the check now treats a reference with no digits as hidden.
- A **careful** amount edit (amount and total both changed) and a changed **date** were rated Low. A screenshot cannot prove a payment; only the money arriving in your own account can. That is why every result tells the user to check their own app. Expect your paper's detection rate to be well below 100 %, and say why.
