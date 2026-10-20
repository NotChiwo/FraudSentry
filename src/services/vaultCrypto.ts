// ============================================================
// FraudSentry — on-device cryptography for accounts (Web Crypto API)
//
// Passwords are never stored. PBKDF2-SHA-256 (600 000 iterations, random
// 16-byte salt) turns a password into 512 bits:
//   • the first 256 bits are the key-encryption key (KEK, AES-KW), which
//     unlocks the user's data key;
//   • the last 256 bits, hashed with SHA-256, are the stored password
//     verifier (the "hashed password" of the USER table).
// Each user's history is encrypted with their own random data key (DEK,
// AES-GCM 256). The DEK is stored twice: wrapped with the user's KEK, and
// encrypted with the organisation's public key (RSA-OAEP 2048), so an
// administrator — who alone can unlock the organisation's private key —
// can review any user's records and reset forgotten passwords.
// Pure functions over Web Crypto; nothing here touches storage.
// ============================================================

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('This browser cannot encrypt data (Web Crypto is unavailable). Open FraudSentry in an up-to-date browser.');
  return s;
};

export const DEFAULT_ITERATIONS = 600_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export const randomBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  return toB64(await subtle().digest('SHA-256', data));
}
export async function sha256Hex(text: string): Promise<string> {
  const h = new Uint8Array(await subtle().digest('SHA-256', enc.encode(text)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface DerivedKeys { kek: CryptoKey; verifier: string }

/** Password → key-encryption key + verifier (see header). */
export async function deriveKeys(password: string, saltB64: string, iterations = DEFAULT_ITERATIONS): Promise<DerivedKeys> {
  const base = await subtle().importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations }, base, 512));
  const kek = await subtle().importKey('raw', bits.slice(0, 32), 'AES-KW', false, ['wrapKey', 'unwrapKey']);
  return { kek, verifier: await sha256(bits.slice(32)) };
}

/** Constant-time comparison of two base64 strings of equal length. */
export function sameVerifier(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const newSalt = () => toB64(randomBytes(16));

export async function generateDek(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
}
export async function wrapDek(dek: CryptoKey, kek: CryptoKey): Promise<string> {
  return toB64(await subtle().wrapKey('raw', dek, kek, 'AES-KW'));
}
/** Throws if the KEK is wrong (AES-KW integrity check). */
export async function unwrapDek(wrapped: string, kek: CryptoKey): Promise<CryptoKey> {
  return subtle().unwrapKey('raw', fromB64(wrapped), kek, 'AES-KW', { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
}

export interface Sealed { iv: string; ct: string }

export async function encryptJson(value: unknown, key: CryptoKey): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(ct) };
}
export async function decryptJson<T>(sealed: Sealed, key: CryptoKey): Promise<T> {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.ct));
  return JSON.parse(dec.decode(pt)) as T;
}

// ── organisation key pair (administrator access) ─────────────
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' } as const;

export async function generateOrgKeys(): Promise<CryptoKeyPair> {
  return subtle().generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
}
export async function exportPublicKey(k: CryptoKey): Promise<string> {
  return toB64(await subtle().exportKey('spki', k));
}
export async function importPublicKey(spki: string): Promise<CryptoKey> {
  return subtle().importKey('spki', fromB64(spki), RSA, false, ['encrypt']);
}
/** Encrypt a user's DEK for the organisation (only the admin can open it). */
export async function sealDekForOrg(dek: CryptoKey, orgPublic: CryptoKey): Promise<string> {
  const raw = await subtle().exportKey('raw', dek);
  return toB64(await subtle().encrypt(RSA, orgPublic, raw));
}
export async function openDekWithOrg(sealed: string, orgPrivate: CryptoKey): Promise<CryptoKey> {
  const raw = await subtle().decrypt(RSA, orgPrivate, fromB64(sealed));
  return subtle().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
}
/** The organisation's private key, encrypted with an administrator's DEK. */
export async function wrapOrgPrivate(orgPrivate: CryptoKey, adminDek: CryptoKey): Promise<Sealed> {
  const iv = randomBytes(12);
  return { iv: toB64(iv), ct: toB64(await subtle().wrapKey('pkcs8', orgPrivate, adminDek, { name: 'AES-GCM', iv })) };
}
export async function unwrapOrgPrivate(sealed: Sealed, adminDek: CryptoKey): Promise<CryptoKey> {
  return subtle().unwrapKey('pkcs8', fromB64(sealed.ct), adminDek, { name: 'AES-GCM', iv: fromB64(sealed.iv) }, RSA, true, ['decrypt']);
}
