import { describe, it, expect } from 'vitest';
import { validateImageFile, checkImageBasics, sniffImageSignature, MAX_IMAGE_BYTES } from '../services/uploadValidation';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_SIG = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const fileOf = (sig: number[], size: number, name: string, type: string) => {
  const bytes = new Uint8Array(size);
  bytes.set(sig.slice(0, size));
  return new File([bytes], name, { type });
};

describe('upload validation', () => {
  it('BUG-008: rejects a 0-byte file even with a valid image MIME type', async () => {
    const f = new File([], 'receipt.png', { type: 'image/png' });
    expect(f.size).toBe(0);
    expect(await validateImageFile(f)).toMatch(/empty/);
  });
  it('rejects a file too small to be a screenshot', async () => {
    expect(await validateImageFile(fileOf(PNG_SIG, 40, 'tiny.png', 'image/png'))).toMatch(/too small/);
  });
  it('rejects unsupported types', async () => {
    expect(await validateImageFile(new File(['%PDF-1.7 ...'.repeat(20)], 'r.pdf', { type: 'application/pdf' }))).toMatch(/isn't supported/);
  });
  it('rejects files over 10 MB without reading them', () => {
    const big = { type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1, name: 'big.jpg' } as File;
    expect(checkImageBasics(big)).toMatch(/too large/);
  });
  it('rejects a renamed non-image (extension says .png, bytes say text)', async () => {
    const f = new File(['this is just a text file pretending to be an image'.repeat(5)], 'receipt.png', { type: 'image/png' });
    expect(await validateImageFile(f)).toMatch(/contents don't match/);
  });
  it('accepts real PNG, JPEG and WEBP signatures', async () => {
    expect(await validateImageFile(fileOf(PNG_SIG, 500, 'a.png', 'image/png'))).toBeNull();
    expect(await validateImageFile(fileOf(JPEG_SIG, 500, 'a.jpg', 'image/jpeg'))).toBeNull();
    expect(await validateImageFile(fileOf(WEBP_SIG, 500, 'a.webp', 'image/webp'))).toBeNull();
  });
  it('signature sniffing', () => {
    expect(sniffImageSignature(new Uint8Array(PNG_SIG))).toBe('png');
    expect(sniffImageSignature(new Uint8Array(JPEG_SIG))).toBe('jpeg');
    expect(sniffImageSignature(new Uint8Array(WEBP_SIG))).toBe('webp');
    expect(sniffImageSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // %PDF
  });
});
