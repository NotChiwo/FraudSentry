import { describe, it, expect } from 'vitest';
import { ENTRIES } from '../data/scamKnowledge';
import { analyzeMessageText } from '../engine/messageAnalysis';
import type { ScamType } from '../types';

// The Knowledge Base must never document a scam the analyzer can't recognise.
const EXPECTED: Record<string, ScamType> = {
  otp: 'OTP Scam',
  investment: 'Investment Scam',
  prize: 'Prize Scam',
  marketplace: 'Marketplace Scam',
  phishing: 'Phishing',
  job: 'Job Offer Scam',
  loan: 'Loan Scam',
  proof: 'Marketplace Scam',
  parcel: 'Parcel Scam',
  wrongsend: 'Wrong-Send Refund Scam',
};

describe('every Knowledge Base example is detected', () => {
  for (const e of ENTRIES) {
    it(`${e.name}`, () => {
      const r = analyzeMessageText(e.example);
      expect(r.flags.length + r.links.filter(l => l.severity !== 'low').length, e.example).toBeGreaterThan(0);
      expect(r.threatLevel, e.example).not.toBe('low');
      expect(r.scamType, e.example).toBe(EXPECTED[e.id]);
    });
  }
  it('every entry has an expected scam type mapped', () => {
    expect(ENTRIES.map(e => e.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});

// Ordinary messages a Filipino user might paste. None should be called a scam.
const BENIGN = [
  'Hi! Is the bike still available? I can pick it up Saturday afternoon.',
  'Your GCash OTP is 482913. Never share it with anyone, including GCash employees.',
  'BPI: Do not share your OTP with anyone. BPI will never ask for it.',
  'Paalala: Huwag ibigay ang OTP sa kahit sino.',
  'Salamat po! Order received, ship ko po bukas ng umaga.',
  'Magkano po shipping to Cebu? Pwede po COD?',
  'Thank you for shopping! Use promo code SAVE10 on your next order at shopee.ph',
  'Meeting moved to 3pm tomorrow, see you at the office.',
  'Happy birthday! Ingat ka palagi.',
  'Your Meralco bill of PHP 2,450.00 is due on Oct 15. Pay via the Meralco app.',
  'Hello po, ok lang po ba kung bukas ko na lang bayaran? Wala pa po sweldo.',
];

describe('benign messages are not flagged as scams', () => {
  for (const t of BENIGN) {
    it(t.slice(0, 50), () => {
      const r = analyzeMessageText(t);
      expect(r.threatLevel, `${t} → ${r.flags.map(f => f.keyword).join(' | ')}`).toBe('low');
    });
  }
});
