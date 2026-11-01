// Two common PH scams the analyzer used to miss, and ordinary messages that
// look a bit like them but must stay low.
import { describe, it, expect } from 'vitest';
import { analyzeMessageText } from '../message-check/messageAnalysis';

const level = (m: string) => analyzeMessageText(m).threatLevel;

describe('task-job and "new number" scams', () => {
  it('an unsolicited "you are hired" task job with daily pay and Telegram', () => {
    const r = analyzeMessageText('Good day! You are hired as online part-time. Earn 500-3000 daily, just like videos. Message us on Telegram @hr_ph');
    expect(r.scamType).toBe('Job Offer Scam');
    expect(['high', 'critical']).toContain(r.threatLevel);
  });
  it('a family member on a "new number" asking for money', () => {
    const r = analyzeMessageText('Ma, nasira phone ko, bagong number ko to. Pa-send naman 2k sa gcash ko 09981234567 emergency lang');
    expect(r.scamType).toBe('Impersonation');
    expect(r.threatLevel).not.toBe('low');
  });
});

describe('ordinary messages stay low', () => {
  for (const m of [
    'Hi! This is my new number, pa-save na lang po. Salamat!',
    'Nasira phone ko kahapon kaya di ako nakareply, sorry!',
    'Earn 500 points daily when you shop with your SM Advantage card.',
    'We are hiring! Visit our office in Makati for a part-time cashier job, walk-in interviews Mon-Fri.',
    'Like and follow our page for updates on new products!',
    'Contact us on WhatsApp for orders.',
    'Your OTP is 482913. Do not share this code with anyone. GCash will never ask for your OTP.',
    'Reminder: your Meralco bill of P2,345.67 is due on Nov 5. Pay via GCash or Maya.',
  ]) it(m, () => expect(level(m)).toBe('low'));
});
