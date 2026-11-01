// ============================================================
// Upload validation — shared by every page that accepts an image.
//
// Three checks, cheapest first:
//   1. Declared type is PNG / JPEG / WEBP.
//   2. Size is within limits — including a MINIMUM (a 0-byte
//      file with an image MIME type used to pass and then fail deep inside
//      OCR/forensics with a confusing error).
//   3. The file's first bytes really are a PNG / JPEG / WEBP signature. The
//      browser's file.type comes from the file EXTENSION, so a renamed text or
//      PDF file would otherwise be accepted as an "image".
// ============================================================
import { formatBytes } from '../../shared/helpers';

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10 MB
// The smallest valid PNG/JPEG/WEBP files are a few dozen bytes; anything below
// this cannot contain a readable receipt.
export const MIN_IMAGE_BYTES = 100;

/** Synchronous checks (type + size). Returns an error message or null. */
export function checkImageBasics(file: File): string | null {
  if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    return 'This is an iPhone HEIC photo, which browsers can’t read. Take a screenshot of the receipt instead, or export the photo as JPG (on iPhone: Settings → Camera → Formats → Most Compatible).';
  }
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "That file type isn't supported. Please upload a receipt as a PNG, JPG, or WEBP image — a normal phone screenshot works perfectly.";
  }
  if (file.size === 0) return 'That file is empty (0 bytes). Please choose the screenshot again.';
  if (file.size < MIN_IMAGE_BYTES) return `That file is too small (${formatBytes(file.size)}) to be a real screenshot. Please choose the original image.`;
  if (file.size > MAX_IMAGE_BYTES) return `File is too large (${formatBytes(file.size)}). Maximum allowed is 10 MB.`;
  return null;
}

export type SniffedImageType = 'png' | 'jpeg' | 'webp' | null;

/** Identify the real image format from the file's magic bytes. */
export function sniffImageSignature(b: Uint8Array): SniffedImageType {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46   // "RIFF"
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'; // "WEBP"
  return null;
}

/**
 * A camera photo over the size limit (50–108 MP phone cameras make JPEGs over
 * 10 MB) is scaled down to at most 3000 px instead of being refused. It is a
 * photo anyway (the pixel checks for screenshots are skipped on photos), so
 * re-encoding loses nothing the checks use. Browser only; null if it can't.
 */
export async function shrinkLargePhoto(file: File): Promise<File | null> {
  if (file.size <= MAX_IMAGE_BYTES || !ACCEPTED_IMAGE_TYPES.includes(file.type) || typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.9));
    return blob && blob.size <= MAX_IMAGE_BYTES ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified }) : null;
  } catch {
    return null;
  }
}

/** Full validation (async — reads the first 12 bytes). Returns an error message or null. */
export async function validateImageFile(file: File): Promise<string | null> {
  const basic = checkImageBasics(file);
  if (basic) return basic;
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  } catch {
    return 'That file could not be read. Please choose the screenshot again.';
  }
  if (!sniffImageSignature(head)) {
    return "That file isn't a real PNG, JPG, or WEBP image (its contents don't match its name). Please upload the original screenshot.";
  }
  return null;
}
