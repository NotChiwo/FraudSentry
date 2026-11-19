// Which payment apps the receipt reader supports, and how well that support
// is backed. "Tested" apps have real (redacted) receipts in the automated
// tests; the others are read from their known layouts and wording
// (paymentApps.test.ts) but have not yet been checked on real screenshots.
import type { EvidenceSource } from '../../shared/types';
import { KNOWN_SOURCES } from './receiptParser';

/** Apps with real, redacted receipts in src/__tests__/fixtures. */
export const TESTED_ON_REAL_RECEIPTS: EvidenceSource[] = ['GCash', 'Maya', 'GoTyme', 'BPI', 'MariBank'];

/** Every other bank or e-wallet the reader recognises. */
export const LAYOUT_BASED: EvidenceSource[] = KNOWN_SOURCES.filter(s => !TESTED_ON_REAL_RECEIPTS.includes(s) && s !== 'Online Banking');

export type SupportLevel = 'tested' | 'layout' | 'unknown';
export function supportLevel(source: EvidenceSource): SupportLevel {
  if (TESTED_ON_REAL_RECEIPTS.includes(source)) return 'tested';
  return LAYOUT_BASED.includes(source) ? 'layout' : 'unknown';
}
