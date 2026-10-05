// ============================================================
// FraudSentry — Transaction Authenticity Engine
//
// Fuses three REAL evidence streams into one explainable result:
//   1. OCR text (services/ocr.ts)          → structured fields
//   2. Image forensics (imageForensics.ts) → tamper/integrity signals
//   3. Institution validation               → format checks on the
//      reference number / amount that were actually extracted.
//
// Two scorers look at the SAME evidence and are blended 50/50:
//   • Rule-based ("heuristic") score — the weighted sum of the findings
//     that did NOT pass, so every point is traceable to a named finding.
//   • Random Forest score — the evidence is turned into a feature vector
//     (buildFeatureVector) and voted on by the shared, trained forest
//     (engine/sharedModel.ts). This is the thesis algorithm running on
//     every real scan — keep this wiring intact.
// We never assert "this is fraud" from the fact that money moved;
// we assess the AUTHENTICITY of the evidence and explain why.
// ============================================================

import { EvidenceSource, ImageScanResult, OcrResult, ForensicReport, VerificationFinding, RiskLevel, ExtractedTransactionData } from '../types';
import { generateId, scoreToRiskLevel, clamp } from '../utils/helpers';
import { runOcr } from '../services/ocr';
import { analyzeForensics } from '../services/imageForensics';
import { parseReceiptMulti, amountFormattingSignal, isUnconfirmedTransaction } from '../services/receiptParser';
import { reconcileAmounts, checkReceiptDate } from '../services/consistencyChecks';
import { matchAgainstHistory, PriorScan } from '../services/historyMatch';
import { buildFeatureVector } from '../services/sampleDataset';
import { scoreWithSharedModel } from './sharedModel';

function finding(category: VerificationFinding['category'], label: string, detail: string, severity: RiskLevel, passed: boolean, weight: number): VerificationFinding {
  return { id: generateId('f'), category, label, detail, severity, passed, weight };
}

// Reference-number shape per institution (used only when a ref was read)
function validateReference(source: EvidenceSource, ref: string | null): VerificationFinding | null {
  if (!ref) return null;
  const clean = ref.replace(/\s/g, '');
  // Most PH e-wallet/bank refs are 10–16 alphanumeric chars
  const looksValid = /^[A-Z0-9]{8,20}$/i.test(clean);
  return finding('reference', 'Reference Number Format',
    looksValid ? `Reference "${clean}" matches the length/character pattern used by ${source !== 'Unknown' ? source : 'major institutions'}. Cross-check it inside your own app's history.`
               : `Reference "${clean}" has an unusual structure for a genuine transaction record. Verify it manually.`,
    looksValid ? 'low' : 'high', looksValid, 0.16);
}

export async function analyzeTransactionImage(
  file: File,
  opts?: {
    onStage?: (s: string) => void;
    ocrOverride?: OcrResult;
    extractedOverride?: ExtractedTransactionData;
    previewDataUrl?: string;
    /** earlier scans on this device — to catch a reused or edited copy of a receipt */
    history?: PriorScan[];
    /** clock used for the future-date check (tests) */
    now?: Date;
  },
): Promise<ImageScanResult> {
  const onStage = opts?.onStage;

  onStage?.('Running forensic analysis');
  const forensics: ForensicReport = await analyzeForensics(file);

  let ocr: OcrResult;
  let extracted: ExtractedTransactionData;
  let source: EvidenceSource;

  if (opts?.ocrOverride && opts?.extractedOverride) {
    // Re-analysis after the user edited the OCR fields
    ocr = opts.ocrOverride;
    extracted = opts.extractedOverride;
    source = (extracted.institution as EvidenceSource) || 'Unknown';
  } else {
    onStage?.('Extracting text (OCR)');
    ocr = await runOcr(file, onStage);
    const parsed = parseReceiptMulti(ocr.passes && ocr.passes.length ? ocr.passes : [ocr.text], file.name);
    extracted = parsed.data;
    source = parsed.source;
  }

  onStage?.('Scoring evidence');
  const findings: VerificationFinding[] = [];

  // ── Forensic signals feed directly in as findings ──
  for (const s of forensics.signals) {
    findings.push(finding('forensic', s.label, s.detail, s.severity, s.passed, s.weight));
  }

  // ── OCR quality finding ──
  if (!ocr.available) {
    findings.push(finding('text', 'Text Extraction',
      'The OCR engine could not be reached (the device may be offline). Fields were not auto-read — enter them manually for a complete assessment.',
      'medium', false, 0.10));
  } else {
    const ocrOk = ocr.confidence >= 60 && ocr.wordCount >= 4;
    findings.push(finding('text', 'OCR Text Confidence',
      ocrOk ? `Text was read with ${ocr.confidence}% mean confidence across ${ocr.wordCount} words (${ocr.pass} pass).`
            : `Text confidence is low (${ocr.confidence}%, ${ocr.wordCount} words). The screenshot may be blurry, low-resolution, or partially edited. Verify the extracted fields.`,
      ocrOk ? 'low' : 'medium', ocrOk, 0.10));
  }

  // ── Institution identification ──
  findings.push(finding('metadata', 'Institution Identification',
    source !== 'Unknown' ? `The evidence text identifies a ${source} record.`
                         : 'The originating bank or e-wallet could not be confirmed from the readable text. Treat the result with reduced confidence.',
    source !== 'Unknown' ? 'low' : 'medium', source !== 'Unknown', 0.06));

  // ── Reference presence + format ──
  if (extracted.referenceNo) {
    const refFinding = validateReference(source, extracted.referenceNo);
    if (refFinding) findings.push(refFinding);
  } else {
    findings.push(finding('reference', 'Reference Number Detection',
      'No reference or transaction number was read from this evidence. Many — but not all — receipts display one; its absence lowers how independently this can be verified, so confirm the payment inside your own account history.',
      'medium', false, 0.07));
  }

  // ── Amount presence ──
  findings.push(finding('text', 'Amount Detection',
    extracted.amount != null ? `An amount of ₱${extracted.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })} was read from the evidence.`
                             : 'No clearly formatted amount was detected. Confirm the figure manually before trusting the receipt.',
    extracted.amount != null ? 'low' : 'medium', extracted.amount != null, 0.06));

  // ── Recipient identity completeness ──
  // A genuine money transfer ALWAYS shows who was paid. If the receipt reads
  // clearly everywhere else (good OCR, amount/reference/date all found) but
  // names NO recipient at all, the field is genuinely blank — a severe
  // structural anomaly, not an OCR miss. Weighted heavily in that case.
  if (source !== 'Unknown' && !extracted.receiverName && !extracted.receiverContact) {
    const ocrReadable = (ocr?.confidence ?? 0) >= 65;
    const txnFieldsRead = (extracted.amount != null) || !!extracted.referenceNo || !!extracted.date;
    if (ocrReadable && txnFieldsRead) {
      findings.push(finding('text', 'No Recipient Identified',
        `The amount, reference number, and date on this receipt all read clearly — yet it names NO recipient at all (no name and no number). A genuine transfer always shows who was paid, so a blank recipient on an otherwise-readable receipt is a strong sign the image was fabricated or altered. Do not accept this as proof of payment.`,
        'critical', false, 0.50));
    } else {
      findings.push(finding('text', 'Recipient Details Missing',
        `This ${source} receipt has no readable recipient name or number. A complete receipt normally shows who was paid — its absence can mean the receipt was edited or left incomplete, though a poor-quality image can also cause it. Confirm the recipient directly before trusting this.`,
        'high', false, 0.18));
    }
  }

  // ── Unsent transaction passed off as proof (Maya "Confirm transaction") ──
  // Judged from the raw OCR text, so a manual field correction can't hide it.
  const ocrTexts = ocr.passes && ocr.passes.length ? ocr.passes : [ocr.text || ''];
  const unconfirmed = ocrTexts.some(t => isUnconfirmedTransaction(t));
  if (unconfirmed) {
    findings.push(finding('layout', 'Unconfirmed Transaction',
      'This screenshot is a confirmation/review screen shown BEFORE money is sent ("Confirm transaction" with Source and Destination). No transfer has happened yet — which is why there is no reference number. It cannot be proof of payment, and sending this instead of a completed receipt is a known scam move.',
      'critical', false, 0.60));
  }

  // ── Amount internal consistency (edited-amount tell) ──
  const amtSig = amountFormattingSignal(ocr && ocr.passes && ocr.passes.length ? ocr.passes : [ocr ? ocr.text : '']);
  if (amtSig.suspicious) {
    findings.push(finding('text', 'Amount Consistency Check', amtSig.detail, 'high', false, 0.46));
  }

  // ── Arithmetic: amount + fee must equal the total ──
  // An editor who changes the amount often forgets the total (or vice versa).
  const recon = reconcileAmounts(ocrTexts, extracted.amount);
  if (recon.status === 'consistent') {
    findings.push(finding('text', 'Amount Reconciliation', recon.detail, 'low', true, 0.40));
  } else if (recon.status === 'mismatch') {
    findings.push(finding('text', 'Amount Reconciliation', recon.detail, 'high', false, 0.40));
  }

  // ── Timestamp sanity: no receipt can be dated in the future ──
  const dateCheck = checkReceiptDate(extracted.date, extracted.time, opts?.now);
  if (dateCheck.status === 'ok') {
    findings.push(finding('timestamp', 'Receipt Date Plausibility', `The receipt date (${[extracted.date, extracted.time].filter(Boolean).join(' ')}) is a valid date that is not in the future.`, 'low', true, 0.50));
  } else if (dateCheck.status === 'future') {
    findings.push(finding('timestamp', 'Receipt Date Plausibility', dateCheck.detail, 'critical', false, 0.50));
  } else if (dateCheck.status === 'invalid') {
    findings.push(finding('timestamp', 'Receipt Date Plausibility', dateCheck.detail, 'medium', false, 0.15));
  }

  // ── Earlier scans: reused receipt / edited copy ──
  const hist = matchAgainstHistory(extracted, opts?.history ?? []);
  if (hist.kind === 'edited-copy') {
    findings.push(finding('reference', 'Earlier Scan Comparison', hist.detail, 'critical', false, 0.55));
  } else if (hist.kind === 'same-moment') {
    findings.push(finding('reference', 'Earlier Scan Comparison', hist.detail, 'high', false, 0.30));
  }

  // ── Score: rule findings + Random Forest, blended 50/50 ──
  const failed = findings.filter(f => !f.passed);
  const heuristicScore = clamp(failed.reduce((s, f) => s + f.weight, 0), 0, 1);
  const forestAnalysis = scoreWithSharedModel(
    buildFeatureVector(forensics, ocr, extracted, source, failed.length),
  );
  let riskScore = clamp(0.5 * heuristicScore + 0.5 * forestAnalysis.probability, 0, 1);
  // A definitive structural fact (no transfer exists yet) is not a
  // probability — never let the blend dilute it below Critical.
  if (unconfirmed) riskScore = Math.max(riskScore, 0.7);
  // Same for a future date or totals that don't add up: never below High.
  // (Both are read from stable multi-pass OCR, so a lone misread can't trigger them.)
  if (dateCheck.status === 'future' || recon.status === 'mismatch' || hist.kind === 'edited-copy') riskScore = Math.max(riskScore, 0.45);
  const riskLevel: RiskLevel = scoreToRiskLevel(riskScore);

  const legitimacyLabel =
    riskLevel === 'critical' ? 'Likely Fraudulent — Do Not Accept as Proof'
    : riskLevel === 'high'   ? 'Suspicious Evidence — Verify Independently'
    : riskLevel === 'medium' ? 'Some Inconsistencies — Verify Before Trusting'
    : 'No Tampering Indicators Found';

  // Confidence = how much evidence we actually had to work with
  const evidenceDepth = (ocr.available ? 1 : 0) + (extracted.referenceNo ? 1 : 0) + (extracted.amount != null ? 1 : 0) + (source !== 'Unknown' ? 1 : 0) + (forensics.elaThumbnail ? 1 : 0);
  const confidence = clamp(Math.round(45 + evidenceDepth * 9 + (ocr.confidence / 10)), 40, 96);

  const recommendedAction =
    riskLevel === 'critical' ? 'Do not release goods, services, or funds. Ask the sender to share their live in-app transaction history on a video call, and confirm the reference number directly inside your own bank/e-wallet app.'
    : riskLevel === 'high'   ? 'Hold the transaction. Independently verify the reference number and amount inside your own account before proceeding.'
    : riskLevel === 'medium' ? 'Proceed with caution. Cross-check the reference number and amount against your own received-funds history.'
    : 'No tampering indicators were found. As best practice, still confirm the funds actually landed in your account before releasing anything of value.';

  const reused = hist.kind === 'reused';
  const actionPlan = buildActionPlan(riskLevel, source, extracted, failed, reused);

  return {
    id: generateId('scan'),
    filename: file.name,
    fileSize: file.size,
    fileType: file.type || forensics.sniffType,
    source,
    riskScore,
    riskLevel,
    legitimacyLabel,
    confidence,
    ocr,
    forensics,
    extracted,
    findings,
    recommendedAction,
    actionPlan,
    heuristicScore,
    forestAnalysis,
    previewDataUrl: opts?.previewDataUrl,
    scannedAt: new Date().toISOString(),
  };
}

// Concrete, ordered next steps for a non-technical user, specific to what
// this scan actually found (not a generic warning).
function buildActionPlan(
  riskLevel: RiskLevel,
  source: EvidenceSource,
  extracted: ExtractedTransactionData,
  failed: VerificationFinding[],
  reused: boolean,
): string[] {
  const plan: string[] = [];
  const failedLabel = (l: string) => failed.some(f => f.label === l);
  const app = source === 'Unknown' ? 'your e-wallet/bank' : source;
  const ref = extracted.referenceNo;

  if (riskLevel === 'critical' || riskLevel === 'high') {
    plan.push('Do not release money, goods, or services based on this screenshot.');
    if (failedLabel('Unconfirmed Transaction')) {
      plan.push('This screenshot shows a payment that was never sent (a confirmation screen, before the "Send" button). Ask for the completed receipt, then check that the money actually arrived in your own account.');
    }
    plan.push(ref
      ? `Open your own ${app} app and search your received transactions for reference ${ref}. If it is not there, the payment did not reach you.`
      : `Ask the sender for the transaction reference number, then look it up inside your own ${app} app.`);
    if (reused) plan.push('This exact receipt was submitted before — ask why the same proof is being used twice before going any further.');
    if (failed.some(f => f.label === 'Earlier Scan Comparison')) plan.push('You scanned a receipt with the same details before, but the figures differ. Put both screenshots side by side, and trust only the amount that actually arrived in your own account.');
    if (failed.some(f => f.label === 'Amount Reconciliation')) plan.push('The amount, fee and total on this receipt do not add up. Compare the amount that actually arrived in your account with BOTH figures — an edited amount is the most common fake.');
    if (failed.some(f => f.label === 'Receipt Date Plausibility' && f.severity === 'critical')) plan.push('The receipt is dated in the future. Ask the sender to show the transaction live inside their app, and check the date and time in your own history.');
    if (failedLabel('No Recipient Identified')) plan.push('A genuine transfer receipt always names its recipient. Ask the sender to show the transaction inside their app on a live video call.');
    plan.push('If money was already lost, keep the screenshot and chat as evidence and report to your platform and local authorities (PNP-ACG hotline or nearest station).');
  } else if (riskLevel === 'medium') {
    plan.push(`Confirm the amount${extracted.amount == null ? '' : ` (₱${extracted.amount.toLocaleString()})`} actually arrived in your own ${app} account before releasing anything.`);
    if (ref) plan.push(`Match reference ${ref} against your received-funds history — the number must appear on YOUR side.`);
    if (reused) plan.push('This reference number was already used in an earlier scan — make sure you are not being shown the same receipt twice.');
    plan.push('Review the flagged items below; use "Correct text" if any field was misread, then re-analyze.');
  } else {
    plan.push(`Confirm the funds landed in your own ${app} account — the receipt looks clean, but only your own app proves receipt of money.`);
    if (ref) plan.push(`Quick check: search reference ${ref} in your received transactions.`);
    if (reused) plan.push('Note: this reference number appeared in an earlier scan — confirm it is not the same receipt being reused.');
    plan.push('Keep this analysis with the receipt in case you need a record later (Download report).');
  }
  return plan;
}
