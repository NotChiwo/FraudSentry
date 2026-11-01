// The critical "no recipient" rule only fires when the receipt has no
// recipient field at all — not when the parser failed to read one.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { recipientLabelSeen } from '../receipt-check/reading/receiptParser';

describe('is there a recipient field on the receipt?', () => {
  it('labels banks and e-wallets use', () => {
    for (const t of ['Transfer to\nJuan (QR Code)', 'To   Ma*a Sa***s L.', 'Recipient   JUAN D.', 'Account Name   Juan Dela Cruz', 'Send to: 0917 000 0000', 'Destination  BDO', '3       To        N Ma*a Sa***s L.'])
      expect(recipientLabelSeen([t]), t).toBe(true);
  });
  it('a receipt with no recipient field at all', () => {
    expect(recipientLabelSeen(['Transfer successful!\nPHP 1,000.00\nRef No. 1016 642 566968\nOct 30, 2026 10:15 AM\nGo to Accounts'])).toBe(false);
  });
  it('every real bank-style fixture with a "To"/"Transfer to" layout has its field seen', () => {
    const dir = path.join(__dirname, 'fixtures');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, { passes: string[] }>;
      for (const [k, v] of Object.entries(fx)) {
        const t = v.passes.join('\n');
        if (/transfer\s+to|^\s*to\b/im.test(t)) expect(recipientLabelSeen(v.passes), `${f}:${k}`).toBe(true);
      }
    }
  });
});
