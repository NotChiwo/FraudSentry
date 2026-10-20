// ============================================================
// FraudSentry — model registry (thesis RF_MODEL table, V9.1)
//
// Every forest trained on the Detection Model page is recorded with its
// name / version, settings, the data it learned from and its held-out
// metrics (accuracy, precision, recall, F1, ROC-AUC, confusion matrix,
// feature importance). Each scan records the model_id that scored it.
// The records hold numbers only — no receipt contents.
// ============================================================
import type { ModelDatasetSource } from '../engine/sharedModel';
import { DEMO_MODEL_ID, DEMO_MODEL_NAME } from '../engine/sharedModel';

export interface ModelRecord {
  id: string;
  name: string;
  version: number;
  datasetSource: ModelDatasetSource;
  nTrees: number;
  maxDepth: number;
  trainRows: number;
  testRows: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  rocAuc: number | null;
  confusion: { tp: number; fp: number; tn: number; fn: number };
  importances: number[];
  featureNames: string[];
  trainedAt: string;
  trainedBy: string | null;
  /** trained on the 10 evidence features, so live scans can use it */
  usableByScans: boolean;
  /** labelled-receipt models: the rows used, so the identical forest can be rebuilt */
  rowIds?: string[];
}

export const MAX_MODELS = 50;
export { DEMO_MODEL_ID, DEMO_MODEL_NAME };

const SOURCE_LABEL: Record<ModelDatasetSource, string> = { demo: 'demonstration data', labelled: 'labelled receipts', csv: 'uploaded CSV' };
export const sourceLabel = (s: ModelDatasetSource) => SOURCE_LABEL[s];

export const nextVersion = (models: ModelRecord[]) => models.reduce((m, r) => Math.max(m, r.version), 0) + 1;
export const defaultModelName = (version: number, source: ModelDatasetSource, rows: number) => `RF v${version} · ${SOURCE_LABEL[source]} (${rows} rows)`;

/** Add a record (newest first), keeping at most MAX_MODELS. */
export function withModel(models: ModelRecord[], rec: ModelRecord): ModelRecord[] {
  return [rec, ...models.filter(m => m.id !== rec.id)].slice(0, MAX_MODELS);
}

/** Can this record be put back into use for scans? (Only the forest's recipe is kept, not the forest.) */
export function canReactivate(rec: ModelRecord, availableRowIds: Set<string>): { ok: boolean; reason?: string } {
  if (!rec.usableByScans) return { ok: false, reason: 'Trained on other columns than the receipt evidence features.' };
  if (rec.datasetSource === 'demo') return { ok: true };
  if (rec.datasetSource === 'csv') return { ok: false, reason: 'Upload the same CSV again and retrain to use it.' };
  const missing = (rec.rowIds ?? []).filter(id => !availableRowIds.has(id)).length;
  return missing ? { ok: false, reason: `${missing} of its labelled receipts were deleted since.` } : { ok: true };
}
