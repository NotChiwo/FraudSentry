// ============================================================
// FraudSentry — local user accounts (thesis Module 1 + Module 7)
//
// Accounts live on this device only; there is no server. The account
// directory (USER table) holds, per user: id, username, role
// (admin / user), creation date, the PBKDF2 salt and password verifier,
// and the user's wrapped data keys — never a password. See vaultCrypto.ts.
//
//   • The first account created on a device is the administrator.
//   • Administrators create users (with a temporary password that must be
//     changed at first sign-in), change roles, disable, reset passwords,
//     delete, and choose whether people may sign up by themselves.
//   • 5 wrong passwords in a row lock the account for 5 minutes, doubling
//     for each further lock-out (max 60 minutes).
//   • Each user's history, alerts and settings are encrypted with that
//     user's own key ("vault"); see readVault / writeVault.
// ============================================================
import {
  deriveKeys, newSalt, sameVerifier, generateDek, wrapDek, unwrapDek, encryptJson, decryptJson,
  generateOrgKeys, exportPublicKey, importPublicKey, sealDekForOrg, openDekWithOrg, wrapOrgPrivate, unwrapOrgPrivate,
  randomBytes, DEFAULT_ITERATIONS, type Sealed,
} from './vaultCrypto';
import { appendLog } from './auditLog';

export interface KV { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }

export const browserKV: KV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { localStorage.setItem(k, v); },
  remove: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export function memoryKV(init: Record<string, string> = {}): KV & { data: Record<string, string> } {
  const data = { ...init };
  return { data, get: k => (k in data ? data[k] : null), set: (k, v) => { data[k] = v; }, remove: k => { delete data[k]; } };
}

export type Role = 'admin' | 'user';

export interface UserRecord {
  id: string;
  username: string;
  role: Role;
  dateCreated: string;
  lastLogin: string | null;
  salt: string;
  iterations: number;
  /** SHA-256 of the password-derived verifier bits (the stored "hashed password") */
  verifier: string;
  /** the user's data key, wrapped with their password-derived key */
  wrappedDek: string;
  /** the user's data key, encrypted with the organisation's public key */
  orgDek: string;
  /** administrators only: the organisation's private key, encrypted with this admin's data key */
  orgPrivate?: Sealed;
  failedAttempts: number;
  lockouts: number;
  lockedUntil: string | null;
  disabled: boolean;
  mustChangePassword: boolean;
}

export interface AccountSettings {
  /** may people create their own (standard user) account on the sign-in screen? */
  allowSignup: boolean;
  /** sign out after this many minutes without activity (0 = never) */
  autoLockMinutes: number;
}

export interface Directory {
  version: 1;
  orgPublicKey: string;
  users: UserRecord[];
  settings: AccountSettings;
}

export interface Session {
  userId: string;
  username: string;
  role: Role;
  dek: CryptoKey;
  /** administrators only */
  orgPrivate: CryptoKey | null;
  mustChangePassword: boolean;
}

export const DIRECTORY_KEY = 'fraudsentry-accounts';
export const vaultKey = (userId: string) => `fraudsentry-vault-${userId}`;
export const MAX_ATTEMPTS = 5;
export const BASE_LOCK_MINUTES = 5;
export const MAX_LOCK_MINUTES = 60;
export const DEFAULT_SETTINGS: AccountSettings = { allowSignup: false, autoLockMinutes: 15 };

export class AccountError extends Error {}

// ── directory ────────────────────────────────────────────────
export function loadDirectory(kv: KV): Directory | null {
  try {
    const raw = kv.get(DIRECTORY_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Directory;
    if (d?.version !== 1 || !Array.isArray(d.users) || !d.orgPublicKey) return null;
    return { ...d, settings: { ...DEFAULT_SETTINGS, ...d.settings } };
  } catch { return null; }
}
function saveDirectory(kv: KV, d: Directory) { kv.set(DIRECTORY_KEY, JSON.stringify(d)); }
export const hasAccounts = (kv: KV) => (loadDirectory(kv)?.users.length ?? 0) > 0;

/** The public part of the directory (what the admin pages show). */
export type PublicUser = Pick<UserRecord, 'id' | 'username' | 'role' | 'dateCreated' | 'lastLogin' | 'disabled' | 'mustChangePassword' | 'failedAttempts' | 'lockedUntil'>;
export function listUsers(kv: KV): PublicUser[] {
  return (loadDirectory(kv)?.users ?? []).map(({ id, username, role, dateCreated, lastLogin, disabled, mustChangePassword, failedAttempts, lockedUntil }) =>
    ({ id, username, role, dateCreated, lastLogin, disabled, mustChangePassword, failedAttempts, lockedUntil }));
}
export const accountSettings = (kv: KV): AccountSettings => loadDirectory(kv)?.settings ?? DEFAULT_SETTINGS;

// ── rules ────────────────────────────────────────────────────
export const normaliseUsername = (u: string) => u.trim().toLowerCase();

export function usernameProblem(u: string): string | null {
  const n = normaliseUsername(u);
  if (n.length < 3 || n.length > 32) return 'Username must be 3–32 characters.';
  if (!/^[a-z0-9._-]+$/.test(n)) return 'Use only letters, numbers, dot, dash or underscore.';
  return null;
}
export function passwordProblem(p: string, username = ''): string | null {
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 128) return 'Password must be at most 128 characters.';
  if (!/[a-z]/i.test(p) || !/\d/.test(p)) return 'Use at least one letter and one number.';
  if (username && p.toLowerCase().includes(normaliseUsername(username))) return 'The password must not contain the username.';
  return null;
}

const newId = () => `u-${[...randomBytes(8)].map(b => b.toString(16).padStart(2, '0')).join('')}`;

async function makeUser(username: string, password: string, role: Role, orgPublic: CryptoKey, iterations: number, now: Date, dek?: CryptoKey) {
  const salt = newSalt();
  const { kek, verifier } = await deriveKeys(password, salt, iterations);
  const key = dek ?? await generateDek();
  const record: UserRecord = {
    id: newId(), username: normaliseUsername(username), role, dateCreated: now.toISOString(), lastLogin: null,
    salt, iterations, verifier, wrappedDek: await wrapDek(key, kek), orgDek: await sealDekForOrg(key, orgPublic),
    failedAttempts: 0, lockouts: 0, lockedUntil: null, disabled: false, mustChangePassword: false,
  };
  return { record, dek: key };
}

const sessionFor = (u: UserRecord, dek: CryptoKey, orgPrivate: CryptoKey | null): Session =>
  ({ userId: u.id, username: u.username, role: u.role, dek, orgPrivate, mustChangePassword: u.mustChangePassword });

function check(cond: unknown, msg: string): asserts cond { if (!cond) throw new AccountError(msg); }

function requireAdmin(kv: KV, s: Session): Directory {
  const d = loadDirectory(kv);
  check(d, 'No accounts on this device.');
  const me = d.users.find(u => u.id === s.userId);
  check(me && me.role === 'admin' && !me.disabled && s.orgPrivate, 'Only an administrator can do this.');
  return d;
}

// ── setup / sign-up / sign-in ────────────────────────────────
/** First run: create the administrator (and the organisation key pair). */
export async function setupAdmin(kv: KV, username: string, password: string, opts: { iterations?: number; now?: Date } = {}): Promise<Session> {
  check(!hasAccounts(kv), 'This device already has an administrator.');
  check(!usernameProblem(username), usernameProblem(username)!);
  check(!passwordProblem(password, username), passwordProblem(password, username)!);
  const now = opts.now ?? new Date();
  const org = await generateOrgKeys();
  const { record, dek } = await makeUser(username, password, 'admin', org.publicKey, opts.iterations ?? DEFAULT_ITERATIONS, now);
  record.orgPrivate = await wrapOrgPrivate(org.privateKey, dek);
  record.lastLogin = now.toISOString();
  saveDirectory(kv, { version: 1, orgPublicKey: await exportPublicKey(org.publicKey), users: [record], settings: { ...DEFAULT_SETTINGS } });
  await appendLog(kv, 'setup', record.username, 'administrator account created', now);
  return sessionFor(record, dek, org.privateKey);
}

/** Self sign-up of a standard user (only when the administrator allows it). */
export async function signUp(kv: KV, username: string, password: string, opts: { iterations?: number; now?: Date } = {}): Promise<Session> {
  const d = loadDirectory(kv);
  check(d, 'Ask the administrator to set up FraudSentry first.');
  check(d.settings.allowSignup, 'Sign-up is turned off. Ask the administrator for an account.');
  const problem = usernameProblem(username) ?? passwordProblem(password, username);
  check(!problem, problem!);
  check(!d.users.some(u => u.username === normaliseUsername(username)), 'That username is taken.');
  const now = opts.now ?? new Date();
  const { record, dek } = await makeUser(username, password, 'user', await importPublicKey(d.orgPublicKey), opts.iterations ?? DEFAULT_ITERATIONS, now);
  record.lastLogin = now.toISOString();
  d.users.push(record);
  saveDirectory(kv, d);
  await appendLog(kv, 'signup', record.username, '', now);
  return sessionFor(record, dek, null);
}

export type LoginResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'wrong' | 'disabled' | 'locked'; lockedUntil?: string; attemptsLeft?: number };

// verifies a password against a record; spends the same time for unknown users
async function passwordMatches(u: UserRecord | undefined, password: string): Promise<{ ok: boolean; kek?: CryptoKey }> {
  const { kek, verifier } = await deriveKeys(password, u?.salt ?? 'AAAAAAAAAAAAAAAAAAAAAA==', u?.iterations ?? DEFAULT_ITERATIONS);
  return u && sameVerifier(verifier, u.verifier) ? { ok: true, kek } : { ok: false };
}

export async function login(kv: KV, username: string, password: string, now = new Date()): Promise<LoginResult> {
  const d = loadDirectory(kv);
  const name = normaliseUsername(username);
  const u = d?.users.find(x => x.username === name);
  if (u?.lockedUntil && Date.parse(u.lockedUntil) > now.getTime()) {
    await appendLog(kv, 'login-failed', name, 'account is locked', now);
    return { ok: false, reason: 'locked', lockedUntil: u.lockedUntil };
  }
  const m = await passwordMatches(u, password);
  if (!d || !u || !m.ok) {
    if (d && u) {
      u.failedAttempts += 1;
      if (u.failedAttempts >= MAX_ATTEMPTS) {
        const minutes = Math.min(MAX_LOCK_MINUTES, BASE_LOCK_MINUTES * 2 ** u.lockouts);
        u.lockouts += 1;
        u.failedAttempts = 0;
        u.lockedUntil = new Date(now.getTime() + minutes * 60_000).toISOString();
        saveDirectory(kv, d);
        await appendLog(kv, 'locked-out', u.username, `${MAX_ATTEMPTS} wrong passwords; locked ${minutes} min`, now);
        return { ok: false, reason: 'locked', lockedUntil: u.lockedUntil };
      }
      saveDirectory(kv, d);
    }
    await appendLog(kv, 'login-failed', name || null, u ? 'wrong password' : 'unknown username', now);
    return { ok: false, reason: 'wrong', attemptsLeft: u ? MAX_ATTEMPTS - u.failedAttempts : undefined };
  }
  if (u.disabled) {
    await appendLog(kv, 'login-failed', u.username, 'account is disabled', now);
    return { ok: false, reason: 'disabled' };
  }
  const dek = await unwrapDek(u.wrappedDek, m.kek!);
  const orgPrivate = u.role === 'admin' && u.orgPrivate ? await unwrapOrgPrivate(u.orgPrivate, dek) : null;
  u.failedAttempts = 0; u.lockouts = 0; u.lockedUntil = null; u.lastLogin = now.toISOString();
  saveDirectory(kv, d);
  await appendLog(kv, 'login', u.username, u.role, now);
  return { ok: true, session: sessionFor(u, dek, orgPrivate) };
}

export async function changePassword(kv: KV, s: Session, current: string, next: string, now = new Date()): Promise<Session> {
  const d = loadDirectory(kv);
  const u = d?.users.find(x => x.id === s.userId);
  check(d && u, 'Account not found.');
  check((await passwordMatches(u, current)).ok, 'The current password is wrong.');
  check(current !== next, 'Choose a new password that is different from the current one.');
  const problem = passwordProblem(next, u.username);
  check(!problem, problem!);
  u.salt = newSalt();
  const { kek, verifier } = await deriveKeys(next, u.salt, u.iterations);
  u.verifier = verifier;
  u.wrappedDek = await wrapDek(s.dek, kek);
  u.mustChangePassword = false;
  saveDirectory(kv, d);
  await appendLog(kv, 'password-changed', u.username, '', now);
  return { ...s, mustChangePassword: false };
}

// ── administration ───────────────────────────────────────────
export async function createUser(kv: KV, admin: Session, username: string, tempPassword: string, role: Role, opts: { iterations?: number; now?: Date } = {}): Promise<PublicUser> {
  const d = requireAdmin(kv, admin);
  const problem = usernameProblem(username) ?? passwordProblem(tempPassword, username);
  check(!problem, problem!);
  check(!d.users.some(u => u.username === normaliseUsername(username)), 'That username is taken.');
  const now = opts.now ?? new Date();
  const { record, dek } = await makeUser(username, tempPassword, role, await importPublicKey(d.orgPublicKey), opts.iterations ?? d.users[0].iterations, now);
  record.mustChangePassword = true;
  if (role === 'admin') record.orgPrivate = await wrapOrgPrivate(admin.orgPrivate!, dek);
  d.users.push(record);
  saveDirectory(kv, d);
  await appendLog(kv, 'user-created', admin.username, `${record.username} (${role})`, now);
  return listUsers(kv).find(u => u.id === record.id)!;
}

function target(d: Directory, id: string) {
  const u = d.users.find(x => x.id === id);
  check(u, 'Account not found.');
  return u;
}
const otherActiveAdmins = (d: Directory, id: string) => d.users.filter(u => u.role === 'admin' && !u.disabled && u.id !== id).length;

export async function resetPassword(kv: KV, admin: Session, userId: string, tempPassword: string, now = new Date()): Promise<void> {
  const d = requireAdmin(kv, admin);
  const u = target(d, userId);
  const problem = passwordProblem(tempPassword, u.username);
  check(!problem, problem!);
  const dek = await openDekWithOrg(u.orgDek, admin.orgPrivate!);
  u.salt = newSalt();
  const { kek, verifier } = await deriveKeys(tempPassword, u.salt, u.iterations);
  u.verifier = verifier;
  u.wrappedDek = await wrapDek(dek, kek);
  u.mustChangePassword = true;
  u.failedAttempts = 0; u.lockouts = 0; u.lockedUntil = null;
  saveDirectory(kv, d);
  await appendLog(kv, 'password-reset', admin.username, u.username, now);
}

export async function setRole(kv: KV, admin: Session, userId: string, role: Role, now = new Date()): Promise<void> {
  const d = requireAdmin(kv, admin);
  const u = target(d, userId);
  if (u.role === role) return;
  if (role === 'user') {
    check(otherActiveAdmins(d, u.id) > 0, 'There must always be at least one administrator.');
    delete u.orgPrivate;
  } else {
    const dek = await openDekWithOrg(u.orgDek, admin.orgPrivate!);
    u.orgPrivate = await wrapOrgPrivate(admin.orgPrivate!, dek);
  }
  u.role = role;
  saveDirectory(kv, d);
  await appendLog(kv, 'role-changed', admin.username, `${u.username} → ${role}`, now);
}

export async function setDisabled(kv: KV, admin: Session, userId: string, disabled: boolean, now = new Date()): Promise<void> {
  const d = requireAdmin(kv, admin);
  const u = target(d, userId);
  check(u.id !== admin.userId, 'You cannot disable your own account.');
  if (disabled && u.role === 'admin') check(otherActiveAdmins(d, u.id) > 0, 'There must always be at least one administrator.');
  u.disabled = disabled;
  saveDirectory(kv, d);
  await appendLog(kv, disabled ? 'user-disabled' : 'user-enabled', admin.username, u.username, now);
}

export async function unlockAccount(kv: KV, admin: Session, userId: string, now = new Date()): Promise<void> {
  const d = requireAdmin(kv, admin);
  const u = target(d, userId);
  u.failedAttempts = 0; u.lockouts = 0; u.lockedUntil = null;
  saveDirectory(kv, d);
  await appendLog(kv, 'user-enabled', admin.username, `${u.username} unlocked`, now);
}

export async function deleteUser(kv: KV, admin: Session, userId: string, now = new Date()): Promise<void> {
  const d = requireAdmin(kv, admin);
  const u = target(d, userId);
  check(u.id !== admin.userId, 'You cannot delete your own account.');
  if (u.role === 'admin') check(otherActiveAdmins(d, u.id) > 0, 'There must always be at least one administrator.');
  d.users = d.users.filter(x => x.id !== userId);
  saveDirectory(kv, d);
  kv.remove(vaultKey(userId));
  await appendLog(kv, 'user-deleted', admin.username, u.username, now);
}

export async function updateSettings(kv: KV, admin: Session, patch: Partial<AccountSettings>, now = new Date()): Promise<AccountSettings> {
  const d = requireAdmin(kv, admin);
  const next = { ...d.settings, ...patch };
  next.autoLockMinutes = Math.max(0, Math.min(240, Math.round(next.autoLockMinutes)));
  d.settings = next;
  saveDirectory(kv, d);
  await appendLog(kv, 'settings-changed', admin.username, Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', '), now);
  return next;
}

// ── encrypted per-user data ("vaults") ───────────────────────
export async function writeVault<T>(kv: KV, s: Session, data: T): Promise<void> {
  kv.set(vaultKey(s.userId), JSON.stringify(await encryptJson(data, s.dek)));
}
export async function readVault<T>(kv: KV, s: Session): Promise<T | null> {
  const raw = kv.get(vaultKey(s.userId));
  return raw ? decryptJson<T>(JSON.parse(raw) as Sealed, s.dek) : null;
}
/** Administrators: open another user's records (read-only). */
export async function adminReadVault<T>(kv: KV, admin: Session, userId: string): Promise<T | null> {
  const d = requireAdmin(kv, admin);
  const u = target(d, userId);
  if (u.id === admin.userId) return readVault<T>(kv, admin);
  const raw = kv.get(vaultKey(userId));
  if (!raw) return null;
  return decryptJson<T>(JSON.parse(raw) as Sealed, await openDekWithOrg(u.orgDek, admin.orgPrivate!));
}

/** A readable temporary password for a new or reset account, e.g. "kape-7m4q-ulan-29". */
export function generateTempPassword(): string {
  const words = ['kape', 'ulan', 'araw', 'bayan', 'dagat', 'ilog', 'bundok', 'puno', 'tala', 'hangin', 'bituin', 'lupa'];
  const r = randomBytes(6);
  const alnum = 'abcdefghjkmnpqrstuvwxyz23456789';
  return `${words[r[0] % words.length]}-${alnum[r[1] % alnum.length]}${r[2] % 10}${alnum[r[3] % alnum.length]}-${words[r[4] % words.length]}-${10 + (r[5] % 90)}`;
}
