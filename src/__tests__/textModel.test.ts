// The trained text model (V10.5): proof that it was trained, that the
// shipped weights are exactly the output of the training run, and that it
// learned something that generalises.
import { describe, it, expect } from 'vitest';
import trained from '../text-model/trainedTextModel.json';
import savedReport from '../text-model/trainingReport.json';
import { trainTextModel, stratifiedSplit, TEXT_SEED, DATASET_SIZE, LABEL_NOISE } from '../text-model/trainTextModel';
import { generateTextDataset, datasetToCsv } from '../text-model/textDataset';
import { features, normalise, STOPWORDS } from '../text-model/textFeatures';
import { fit, scorer } from '../text-model/logisticRegression';
import { textModelScore, featureLabel } from '../text-model/textModel';
import { HANDWRITTEN_TEST } from '../text-model/handwrittenTest';
import { analyzeMessageText } from '../message-check/messageAnalysis';

const rules = (t: string) => analyzeMessageText(t, undefined, null, { textModel: false }).riskScore;
const run = trainTextModel(rules);

describe('training is real and reproducible', () => {
  it('retraining from scratch gives exactly the shipped model and report', () => {
    expect(run.model).toEqual(trained);
    expect(JSON.parse(JSON.stringify(run.report))).toEqual(savedReport);
  });
  it('the untrained model knows nothing (50 %, loss ln 2); training lowers the loss', () => {
    const h = run.report.history;
    expect(h[0].trainLoss).toBeCloseTo(Math.log(2), 6);
    expect(run.report.test.untrained.accuracy).toBeCloseTo(0.5, 2);
    expect(h[h.length - 1].trainLoss).toBeLessThan(h[0].trainLoss / 5);
    for (let i = 1; i < h.length; i++) expect(h[i].trainLoss).toBeLessThanOrEqual(h[i - 1].trainLoss + 1e-3);
  });
  it('more training data → better test scores (learning curve)', () => {
    const lc = run.report.learningCurve;
    expect(lc[lc.length - 1].f1).toBeGreaterThan(lc[0].f1 + 0.1);
  });
  it('a different seed gives a different (but similarly good) model: the weights come from the data', () => {
    const data = generateTextDataset(800, 7, 0);
    const [tr, va] = stratifiedSplit(data, [0.8, 0.2], 7);
    const m = fit(tr, va).model;
    expect(m.weights).not.toEqual(trained.weights.slice(0, m.weights.length));
    expect(scorer(m).probability('Your GCash account is suspended. Verify now at gcash-verify.xyz')).toBeGreaterThan(0.5);
  });
});

describe('it generalises', () => {
  it('test set: much better than the untrained model and the rules alone', () => {
    const t = run.report.test;
    expect(t.trained.accuracy).toBeGreaterThan(0.95);
    expect(t.trained.f1).toBeGreaterThan(t.rulesOnly!.f1 + 0.1);
  });
  it('hand-written messages (never trained on, not from the templates): rules + model beat rules alone', () => {
    const h = run.report.handwritten;
    expect(h.trained.accuracy).toBeGreaterThan(0.85);
    expect(h.combined!.accuracy).toBeGreaterThan(h.rulesOnly!.accuracy + 0.1);
    expect(h.combined!.fp).toBeLessThanOrEqual(2);
  });
  it('5-fold cross-validation is stable', () => {
    expect(run.report.crossValidation.meanF1).toBeGreaterThan(0.95);
    expect(run.report.crossValidation.sdF1).toBeLessThan(0.03);
  });
  it('no hand-written message appears in the training data', () => {
    const texts = new Set(generateTextDataset(DATASET_SIZE, TEXT_SEED, LABEL_NOISE).map(r => r.text.toLowerCase()));
    expect(HANDWRITTEN_TEST.filter(r => texts.has(r.text.toLowerCase()))).toEqual([]);
  });
});

describe('what it learned', () => {
  it('links, phone numbers, fees and "account" push towards scam; "never share", ref numbers and COD towards legitimate', () => {
    const scam = run.report.topScam.map(t => t.feature), legit = run.report.topLegitimate.map(t => t.feature);
    expect(scam).toEqual(expect.arrayContaining(['__phone__', '__risklink__', '__shortlink__', 'fee', 'account']));
    expect(legit).toEqual(expect.arrayContaining(['ref', 'cod', 'never']));
    expect([...scam, ...legit].filter(f => STOPWORDS.has(f))).toEqual([]);
  });
  it('features: placeholders for links, phones, amounts, codes; unigrams and bigrams', () => {
    expect(normalise('Pay P1,500 at bit.ly/x1 or bdo-login.xyz, call 0917 555 0142, code 123456')).toMatch(/__amount__.*__shortlink__.*__risklink__.*__phone__.*__code__/);
    expect(features('Send the OTP now')).toEqual(expect.arrayContaining(['send', 'otp', 'now', 'send the', 'the otp', 'otp now']));
    expect(featureLabel('ng __amount__')).toBe('ng [amount]');
  });
  it('the dataset is balanced, de-duplicated and exportable', () => {
    const d = generateTextDataset(DATASET_SIZE, TEXT_SEED, LABEL_NOISE);
    expect(new Set(d.map(r => r.text)).size).toBe(d.length);
    expect(Math.abs(d.filter(r => r.label === 1).length - d.length / 2)).toBeLessThan(d.length * 0.03);
    expect(datasetToCsv(d.slice(0, 2)).split('\n')[0]).toBe('text,label,category,template');
  });
});

describe('in the message checker', () => {
  it('a scam the rules miss is raised by the model, with the phrases that weighed', () => {
    const t = 'Pre-approved ka sa Cash Loan na P30,000! Walang interest. Send ka lang ng 499 for the release fee.';
    const rulesOnly = analyzeMessageText(t, undefined, null, { textModel: false });
    const both = analyzeMessageText(t);
    expect(both.riskScore).toBeGreaterThanOrEqual(rulesOnly.riskScore);
    expect(both.textModel!.probability).toBeGreaterThan(0.5);
    expect(both.textModel!.signals.length).toBeGreaterThan(0);
  });
  it('never lowers what the rules flagged; ordinary messages stay low', () => {
    const scam = 'Your GCash account is suspended. Verify at http://gcash-verify.xyz and send the OTP.';
    expect(analyzeMessageText(scam).riskScore).toBeGreaterThanOrEqual(analyzeMessageText(scam, undefined, null, { textModel: false }).riskScore);
    for (const t of ['Sent na po yung bayad, pa-check na lang po. Salamat!', 'Pre, tara basketball mamaya 6pm.', '482915 is your GCash code. Never share it with anyone.'])
      expect(analyzeMessageText(t).threatLevel).toBe('low');
  });
  it('the shipped model scores like the trained one', () => {
    expect(textModelScore(HANDWRITTEN_TEST[0].text).probability).toBeCloseTo(scorer(run.model).probability(HANDWRITTEN_TEST[0].text), 10);
  });
});
