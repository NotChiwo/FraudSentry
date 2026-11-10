// Features the thesis describes: class-level performance (10.1.3.16), the
// dataset breakdown (10.1.3.11), and the data-dictionary settings
// retain_scan_results and notification_option (Tables 1.3.4, 1.3.5).
import { describe, it, expect } from 'vitest';
import { classLevel } from '../random-forest/evaluation';
import { generateDemoDataset } from '../random-forest/sampleDataset';
import { trainTestSplit } from '../random-forest/randomForest';
import { historyToSave, EMPTY_USER_DATA, useAppStore } from '../shared/store';
import type { ImageScanResult } from '../shared/types';

describe('class-level performance (thesis 10.1.3.16)', () => {
  it('reproduces the thesis table from the confusion matrix 65 / 5 / 12 / 49', () => {
    const c = classLevel({ tn: 65, fp: 5, fn: 12, tp: 49 });
    expect(c.legitimate.precision).toBeCloseTo(0.844, 3);
    expect(c.legitimate.recall).toBeCloseTo(0.929, 3);
    expect(c.legitimate.f1).toBeCloseTo(0.884, 3);
    expect(c.legitimate.support).toBe(70);
    expect(c.fraudulent.precision).toBeCloseTo(0.907, 3);
    expect(c.fraudulent.recall).toBeCloseTo(0.803, 3);
    expect(c.fraudulent.f1).toBeCloseTo(0.852, 3);
    expect(c.fraudulent.support).toBe(61);
  });
  it('an empty class scores 0 instead of dividing by zero', () => {
    expect(classLevel({ tn: 0, fp: 0, fn: 3, tp: 2 }).legitimate).toEqual({ precision: 0, recall: 0, f1: 0, support: 0 });
  });
});

describe('dataset breakdown (thesis 10.1.3.11)', () => {
  it('440 samples: 235 legitimate, 205 fraudulent; 309 training, 131 testing', () => {
    const ds = generateDemoDataset();
    expect(ds.y.length).toBe(440);
    expect(ds.y.filter(v => v === 1).length).toBe(205);
    const s = trainTestSplit(ds, 0.3, 42);
    expect([s.train.y.length, s.test.y.length]).toEqual([309, 131]);
  });
});

describe('retain_scan_results: "Keep my checks on this device"', () => {
  const scan = { id: 'r1', scannedAt: new Date().toISOString() } as unknown as ImageScanResult;
  const data = { ...EMPTY_USER_DATA, imageScans: [scan], alertLevel: 'medium' as const };
  it('on: the history is saved', () => {
    expect(historyToSave({ ...data, keepHistory: true }).imageScans).toHaveLength(1);
  });
  it('off: nothing from the history is written to the device, the alert setting is', () => {
    const saved = historyToSave({ ...data, keepHistory: false });
    expect(saved.imageScans).toEqual([]);
    expect(saved.alertLevel).toBe('medium');
  });
});

describe('notification_option: pop-up alerts', () => {
  it('defaults on and can be turned off; keep-history defaults on', () => {
    const s = useAppStore.getState();
    expect(s.alertPopups).toBe(true);
    expect(s.keepHistory).toBe(true);
    s.setAlertPopups(false);
    expect(useAppStore.getState().alertPopups).toBe(false);
    s.setAlertPopups(true);
  });
});
