// ============================================================
// The trained text model, as used by the message checker
//
// trainedTextModel.json holds the vocabulary, weights and bias produced by
// `npm run train:text` (tools/train-text-model.ts → trainTextModel.ts). A
// test retrains it from scratch and checks the result is identical, so the
// shipped weights are provably the output of that training run.
// ============================================================
import trained from './trainedTextModel.json';
import { scorer, type TextModel } from './logisticRegression';

export const TEXT_MODEL: TextModel = trained as TextModel;
const s = scorer(TEXT_MODEL);

/** How scam-like the trained model finds the text (0–1), and the words / phrases that weighed most. */
export function textModelScore(text: string): { probability: number; signals: { feature: string; weight: number }[] } {
  return { probability: s.probability(text), signals: s.contributions(text, 6) };
}

/** A feature as people read it: placeholders back to words. */
export function featureLabel(f: string): string {
  return f.replace(/__risklink__/g, '[suspicious link]').replace(/__shortlink__/g, '[short link]').replace(/__officiallink__/g, '[official link]')
    .replace(/__link__/g, '[link]').replace(/__phone__/g, '[phone number]').replace(/__amount__/g, '[amount]')
    .replace(/__code__/g, '[code]').replace(/__number__/g, '[long number]');
}
