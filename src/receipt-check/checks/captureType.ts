// ============================================================
// FraudSentry — a screenshot, or a photo of a screen?
//
// A screenshot is the app's own pixels: its backgrounds and cards are
// perfectly flat colour, even after a chat app re-compresses it. A camera
// photo of a phone never is: sensor noise, glare, the angle and whatever is
// behind the phone make almost no 8×8 block perfectly flat.
//
// Measured 2026-11-01 (share of 8×8 blocks with brightness std. dev. < 0.5,
// image scaled to 800 px): real screenshots 0.13–0.37 (the lowest is a crop
// that is mostly a photo advert), rendered receipt screens 0.62–0.89 (light,
// dark, gradient; PNG and JPEG down to quality 0.45 at 45 % size), a real
// photo of a phone 0.009. Only ONE real photo was available: the cut-off sits
// far from every screenshot, so a screenshot is not mistaken for a photo.
//
// On a photo, the pixel checks built for screenshots (error levels, re-typed
// text colour, blurred areas) are not used, and a field that could not be
// read is not treated as missing from the receipt.
// ============================================================

export type CaptureKind = 'screenshot' | 'photo';

/** Below this share of perfectly flat blocks, the image is a camera photo. */
export const PHOTO_FLAT_SHARE = 0.05;

/** Share of 8×8 blocks whose brightness is perfectly flat (std. dev. < 0.5). Pure, over RGBA pixels. */
export function flatBlockShare(data: ArrayLike<number>, w: number, h: number): number {
  const B = 8;
  let blocks = 0, flat = 0;
  for (let by = 0; by + B <= h; by += B) {
    for (let bx = 0; bx + B <= w; bx += B) {
      let s = 0, s2 = 0;
      for (let y = 0; y < B; y++) {
        for (let x = 0; x < B; x++) {
          const i = ((by + y) * w + bx + x) * 4;
          const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          s += L; s2 += L * L;
        }
      }
      const m = s / 64;
      if (Math.sqrt(Math.max(0, s2 / 64 - m * m)) < 0.5) flat++;
      blocks++;
    }
  }
  return blocks ? flat / blocks : 0;
}

/** Taken with the in-app camera, or too few flat blocks to be a screenshot: a photo. */
export function captureKindOf(flatShare: number, fromCamera = false): CaptureKind {
  return fromCamera || flatShare < PHOTO_FLAT_SHARE ? 'photo' : 'screenshot';
}
