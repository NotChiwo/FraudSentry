import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { scanPng, scanWebp, findEditor, declaredTypeMatches } from '../services/imageForensics';
import { metadataConsistency } from '../services/sampleDataset';

// Minimal PNG builder: signature + chunks (CRC is not checked by the scanner).
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  return out;
}
function png(...chunks: Uint8Array[]): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk('IHDR', new Uint8Array(13)), ...chunks, chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const latin = (s: string) => new Uint8Array([...s].map(c => c.charCodeAt(0)));
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

describe('PNG metadata (most receipt screenshots are PNG)', () => {
  it('finds an editor in a tEXt "Software" chunk', async () => {
    const m = await scanPng(png(chunk('tEXt', latin('Software\0Adobe Photoshop 25.0 (Windows)'))));
    expect(m.software).toBe('Adobe Photoshop 25.0 (Windows)');
  });
  it('finds an editor in compressed zTXt', async () => {
    const m = await scanPng(png(chunk('zTXt', cat(latin('Comment\0\0'), new Uint8Array(deflateSync(Buffer.from('Edited with Canva')))))));
    expect(m.software).toBe('Canva');
  });
  it('finds XMP CreatorTool in an iTXt chunk', async () => {
    const xmp = '<x:xmpmeta><rdf:Description xmp:CreatorTool="GIMP 2.10"/></x:xmpmeta>';
    const m = await scanPng(png(chunk('iTXt', cat(latin('XML:com.adobe.xmp\0\0\0\0\0'), new TextEncoder().encode(xmp)))));
    expect(m.software).toBe('GIMP 2.10');
  });
  it('a plain phone screenshot (no text chunks) has no editor, and eXIf counts as EXIF', async () => {
    expect((await scanPng(png())).software).toBeNull();
    expect((await scanPng(png(chunk('eXIf', new Uint8Array(8))))).hasExif).toBe(true);
  });
  it('device screenshot tags are not mistaken for editors', async () => {
    const m = await scanPng(png(chunk('iTXt', cat(latin('XML:com.adobe.xmp\0\0\0\0\0'), latin('<exif:UserComment>Screenshot</exif:UserComment> Adobe XMP Core 6.0')))));
    expect(m.software).toBeNull();
  });
});

describe('WebP metadata', () => {
  it('reads the XMP chunk', () => {
    const xmp = latin('<xmp:CreatorTool>PicsArt</xmp:CreatorTool>');
    const head = cat(latin('RIFF'), new Uint8Array(4), latin('WEBP'));
    const c = new Uint8Array(8 + xmp.length); c.set(latin('XMP '), 0); new DataView(c.buffer).setUint32(4, xmp.length, true); c.set(xmp, 8);
    expect(scanWebp(cat(head, c)).software).toBe('PicsArt');
  });
});

describe('declared type vs real bytes', () => {
  it('treats image/jpg and image/pjpeg as JPEG (not a spoofed file)', () => {
    expect(declaredTypeMatches('image/jpg', 'image/jpeg')).toBe(true);
    expect(declaredTypeMatches('image/pjpeg', 'image/jpeg')).toBe(true);
    expect(declaredTypeMatches('', 'image/png')).toBe(true);
  });
  it('flags a real mismatch', () => {
    expect(declaredTypeMatches('image/png', 'image/jpeg')).toBe(false);
    expect(declaredTypeMatches('image/png', 'unknown')).toBe(false);
  });
});

describe('editor names', () => {
  it('recognises common phone editors', () => {
    for (const n of ['Snapseed', 'PicsArt', 'Photopea', 'Meitu', 'PhotoRoom']) expect(findEditor(`Software: ${n}`)).toBe(n);
  });
});

describe('metadata-consistency feature (shared by training data and live scans)', () => {
  it('starts at 100 and subtracts each failed metadata check', () => {
    const none = { containerMismatch: false, editor: false, oddGeometry: false };
    expect(metadataConsistency(none)).toBe(100);
    expect(metadataConsistency({ ...none, editor: true })).toBe(60);
    expect(metadataConsistency({ containerMismatch: true, editor: true, oddGeometry: true })).toBe(0);
  });
});
