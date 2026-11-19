// V10.3: the history is kept in the on-device database until the user
// deletes it (the panel asked for every earlier case to stay findable).
// Nothing expires and nothing is pushed out by newer checks.
import { describe, it, expect } from 'vitest';
import { userDataToSave, userDataFromSaved, EMPTY_USER_DATA, useAppStore } from '../shared/store';
import type { ImageScanResult } from '../shared/types';

const day = 864e5;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString();
const scan = (id: string, daysAgo: number) => ({ id, scannedAt: at(daysAgo), riskLevel: 'low', findings: [], extracted: {}, ocr: { passes: [] }, forensics: { signals: [] }, source: 'GCash' }) as unknown as ImageScanResult;

describe('nothing in the history expires', () => {
  it('a check from 400 days ago is saved and loaded back', () => {
    const data = { ...EMPTY_USER_DATA, imageScans: [scan('new', 0), scan('old', 400)] };
    expect(userDataToSave(data).imageScans.map(s => s.id)).toEqual(['new', 'old']);
    expect(userDataFromSaved(data).imageScans.map(s => s.id)).toEqual(['new', 'old']);
  });
  it('an entry whose date cannot be read is kept too', () => {
    const odd = { ...scan('odd', 0), scannedAt: 'not a date' };
    expect(userDataFromSaved({ imageScans: [odd] }).imageScans).toHaveLength(1);
  });
  it('newer checks never push older ones out (there used to be a 40-check limit)', () => {
    useAppStore.setState({ imageScans: [], alerts: [] });
    for (let i = 0; i < 120; i++) useAppStore.getState().addImageScan(scan(`r${i}`, 0));
    expect(useAppStore.getState().imageScans).toHaveLength(120);
  });
});
