// ============================================================
// FraudSentry — Domain Types
// Evidence-based fraud verification: real OCR + image forensics
// + text scam-pattern analysis + cross-evidence correlation.
// ============================================================

export type ThemeMode = 'dark' | 'light';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ScanStatus = 'idle' | 'preprocessing' | 'ocr' | 'forensics' | 'analyzing' | 'complete' | 'error';

// ── OCR ─────────────────────────────────────────────────────
export interface OcrResult {
  text: string;            // best-pass extracted text
  confidence: number;      // 0–100, Tesseract mean word confidence
  pass: 'original' | 'enhanced' | 'binarised'; // which preprocessing pass won
  passes?: string[];       // text from every pass that ran, best-confidence first (for field-level merge)
  passConfidences?: number[]; // mean confidence of each entry in `passes`
  wordCount: number;
  engine: string;          // e.g. "Tesseract 5 (eng+fil)" or "unavailable"
  durationMs: number;
  available: boolean;      // false if OCR engine could not load (offline)
}

// ── Image Forensics (all computed client-side, no fabrication) ──
export interface ForensicSignal {
  id: string;
  label: string;
  value: string;           // human-readable measured value
  detail: string;          // what it means
  severity: RiskLevel;
  passed: boolean;
  weight: number;          // contribution to risk if not passed
}

export interface ForensicReport {
  width: number;
  height: number;
  aspectRatio: string;
  fileSizeBytes: number;
  declaredType: string;
  sniffType: string;       // magic-byte detected type
  hasExif: boolean;
  editorSoftware: string | null;  // Software tag if present
  jpegProgressive: boolean | null;
  elaScore: number;        // 0–100 mean error-level magnitude (higher = more recompression/edits)
  elaHotspotPct: number;   // % of image flagged as high-error region
  elaThumbnail: string | null; // dataURL of ELA heatmap
  signals: ForensicSignal[];
}

// ── Transaction Verification ────────────────────────────────
export type EvidenceSource =
  | 'GCash' | 'Maya' | 'BPI' | 'BDO' | 'UnionBank' | 'Metrobank'
  | 'Landbank' | 'Security Bank' | 'GoTyme' | 'RCBC' | 'PNB'
  | 'MariBank' | 'SeaBank' | 'CIMB'
  | 'Online Banking' | 'Unknown';

export interface ExtractedTransactionData {
  senderName: string | null;
  receiverName: string | null;
  receiverContact: string | null;
  amount: number | null;
  date: string | null;
  time: string | null;
  referenceNo: string | null;
  transactionId: string | null;
  institution: string | null;
}

export interface VerificationFinding {
  id: string;
  category: 'layout' | 'timestamp' | 'reference' | 'integrity' | 'text' | 'metadata' | 'forensic';
  label: string;
  detail: string;
  severity: RiskLevel;
  passed: boolean;
  weight: number;          // % contribution to overall risk score
}

// Random Forest vote on one scan's evidence (engine/sharedModel.ts)
export interface ForestAnalysis {
  probability: number;        // mean tree vote for "fraudulent" (0–1)
  votesFraud: number;         // trees that voted fraudulent
  totalTrees: number;
  datasetSource: 'demo' | 'csv';
  trainedAt: string;
  featureNames: string[];
}

export interface ImageScanResult {
  id: string;
  filename: string;
  fileSize: number;
  fileType: string;
  source: EvidenceSource;
  riskScore: number;          // 0–1, evidence-derived
  riskLevel: RiskLevel;
  legitimacyLabel: string;
  confidence: number;          // 0–100 overall assessment confidence
  ocr: OcrResult;
  forensics: ForensicReport;
  extracted: ExtractedTransactionData;
  findings: VerificationFinding[];
  recommendedAction: string;
  actionPlan?: string[];       // ordered, scan-specific next steps
  heuristicScore?: number;     // 0–1 rule-based findings score (before blending)
  forestAnalysis?: ForestAnalysis; // Random Forest vote (blended 50/50 into riskScore)
  previewDataUrl?: string;     // small preview retained for the report
  scannedAt: string;
}

// ── Fraud Message Analyzer ──────────────────────────────────
export type MessagePlatform =
  | 'SMS' | 'Messenger' | 'Facebook' | 'WhatsApp'
  | 'Telegram' | 'Discord' | 'Viber' | 'Email' | 'Unknown';

export type ScamType =
  | 'Phishing' | 'OTP Scam' | 'Fake Bank Alert' | 'Investment Scam'
  | 'Job Offer Scam' | 'Marketplace Scam' | 'Loan Scam' | 'Prize Scam'
  | 'Impersonation' | 'Account Takeover' | 'Parcel Scam'
  | 'Wrong-Send Refund Scam' | 'Budol / Recruitment' | 'None Detected';

export interface MessageFlag {
  id: string;
  keyword: string;         // matched excerpt
  reason: string;
  weight: number;
  start: number;           // char index in source text (for highlighting)
  end: number;
  severity: RiskLevel;
}

export interface LinkFinding {
  url: string;
  reason: string;
  severity: RiskLevel;
}

export interface MessageScanResult {
  id: string;
  platform: MessagePlatform;
  sourceText: string;      // full text analyzed (kept for highlighting + report)
  textExcerpt: string;
  threatLevel: RiskLevel;
  scamType: ScamType;
  riskScore: number;       // 0–1
  confidence: number;
  ocrConfidence: number | null; // null if pasted text
  explanation: string;
  flags: MessageFlag[];
  links: LinkFinding[];
  recommendedActions: string[];
  observations: string[];  // context notes (e.g. "confirmation text can be typed by anyone")
  scannedAt: string;
}

// ── Cross-evidence correlation ──────────────────────────────
// How a receipt and a conversation relate, judged from shared identifiers
export type EvidenceLinkage = 'linked' | 'contradictory' | 'unrelated' | 'insufficient';
export type FieldMatchState = 'match' | 'conflict' | 'receipt-only' | 'message-only' | 'absent';
export interface FieldComparison {
  key: 'amount' | 'referenceNo' | 'receiverContact' | 'receiverName';
  label: string;
  receiptValue: string | null;
  messageValue: string | null;
  state: FieldMatchState;
}

export interface CrossEvidenceResult {
  id: string;
  transactionRiskLevel: RiskLevel;
  conversationRiskLevel: RiskLevel;
  combinedRiskLevel: RiskLevel;
  combinedScore: number;   // 0–1
  verdict: string;
  rationale: string[];
  linkage?: EvidenceLinkage;
  fieldComparison?: FieldComparison[];
  scannedAt: string;
}

// ── Dashboard stats (100% derived from local scan history) ──
export interface DashboardStats {
  totalScans: number;
  imagesScanned: number;
  messagesScanned: number;
  highRiskCount: number;
  flaggedCount: number;
  cleanCount: number;
  avgOcrConfidence: number;
}

export interface NavItem {
  label: string;
  path: string;
  description: string;
}
