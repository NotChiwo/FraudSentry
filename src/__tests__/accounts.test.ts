// Local accounts (V9.0): hashed passwords, roles, lock-out, encrypted per-user
// data that only its owner (and an administrator) can open, and a
// tamper-evident activity log.
import { describe, it, expect } from 'vitest';
import {
  memoryKV, setupAdmin, signUp, login, changePassword, createUser, resetPassword, setRole, setDisabled, deleteUser,
  updateSettings, unlockAccount, listUsers, writeVault, readVault, adminReadVault, loadDirectory, vaultKey, DIRECTORY_KEY,
  usernameProblem, passwordProblem, MAX_ATTEMPTS, type Session,
} from '../services/accounts';
import { readLog, verifyLog, AUDIT_KEY } from '../services/auditLog';

const IT = { iterations: 1000 };   // fast in tests; the app uses 600 000
const T0 = new Date('2026-10-20T08:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const ok = async (p: ReturnType<typeof login>) => { const r = await p; if (!r.ok) throw new Error(r.reason); return r.session; };

async function device() {
  const kv = memoryKV();
  const admin = await setupAdmin(kv, 'Owner', 'sari-sari-2026', { ...IT, now: T0 });
  return { kv, admin };
}

describe('setting up and signing in', () => {
  it('the first account is the administrator; no password is stored', async () => {
    const { kv, admin } = await device();
    expect(admin).toMatchObject({ username: 'owner', role: 'admin', mustChangePassword: false });
    expect(admin.orgPrivate).not.toBeNull();
    const raw = kv.get(DIRECTORY_KEY)!;
    expect(raw).not.toContain('sari-sari-2026');
    const u = loadDirectory(kv)!.users[0];
    expect(Object.keys(u)).toEqual(expect.arrayContaining(['id', 'username', 'role', 'dateCreated', 'salt', 'verifier', 'wrappedDek', 'orgDek']));
    await expect(setupAdmin(kv, 'second', 'another-pass-1', IT)).rejects.toThrow(/already has an administrator/);
  });
  it('signs in with the right password (username is not case-sensitive), not with a wrong one', async () => {
    const { kv } = await device();
    const s = await ok(login(kv, ' OWNER ', 'sari-sari-2026', at(1)));
    expect(s.role).toBe('admin');
    const bad = await login(kv, 'owner', 'sari-sari-2025', at(2));
    expect(bad).toEqual({ ok: false, reason: 'wrong', attemptsLeft: MAX_ATTEMPTS - 1 });
    expect(await login(kv, 'nobody', 'whatever-123', at(2))).toEqual({ ok: false, reason: 'wrong', attemptsLeft: undefined });
  });
  it('5 wrong passwords lock the account; the lock grows and expires; a correct sign-in resets it', async () => {
    const { kv } = await device();
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await login(kv, 'owner', 'wrong-pass-1', at(1));
    const locked = await login(kv, 'owner', 'wrong-pass-1', at(1));
    expect(locked).toMatchObject({ ok: false, reason: 'locked', lockedUntil: at(6).toISOString() });
    expect(await login(kv, 'owner', 'sari-sari-2026', at(3))).toMatchObject({ ok: false, reason: 'locked' });   // even the right password
    for (let i = 0; i < MAX_ATTEMPTS; i++) await login(kv, 'owner', 'wrong-pass-1', at(7));
    expect(loadDirectory(kv)!.users[0].lockedUntil).toBe(at(17).toISOString());   // second lock-out: 10 minutes
    await ok(login(kv, 'owner', 'sari-sari-2026', at(18)));
    expect(loadDirectory(kv)!.users[0]).toMatchObject({ failedAttempts: 0, lockouts: 0, lockedUntil: null });
  });
  it('username and password rules', () => {
    expect(usernameProblem('ab')).toMatch(/3–32/);
    expect(usernameProblem('juan dela cruz')).toMatch(/letters, numbers/);
    expect(usernameProblem('juan.dc')).toBeNull();
    expect(passwordProblem('short1')).toMatch(/at least 8/);
    expect(passwordProblem('onlyletters')).toMatch(/letter and one number/);
    expect(passwordProblem('juan.dc-2026', 'juan.dc')).toMatch(/username/);
    expect(passwordProblem('kape-at-pandesal-7')).toBeNull();
  });
});

describe('administration', () => {
  it('admin creates a user with a temporary password that must be changed at first sign-in', async () => {
    const { kv, admin } = await device();
    await createUser(kv, admin, 'cashier1', 'temp-pass-01', 'user', IT);
    const s = await ok(login(kv, 'cashier1', 'temp-pass-01'));
    expect(s).toMatchObject({ role: 'user', mustChangePassword: true, orgPrivate: null });
    const s2 = await changePassword(kv, s, 'temp-pass-01', 'my-own-pass-22');
    expect(s2.mustChangePassword).toBe(false);
    expect((await login(kv, 'cashier1', 'temp-pass-01')).ok).toBe(false);
    await ok(login(kv, 'cashier1', 'my-own-pass-22'));
  });
  it('standard users cannot administer', async () => {
    const { kv, admin } = await device();
    await createUser(kv, admin, 'cashier1', 'temp-pass-01', 'user', IT);
    const s = await ok(login(kv, 'cashier1', 'temp-pass-01'));
    await expect(createUser(kv, s, 'x-user', 'temp-pass-02', 'admin', IT)).rejects.toThrow(/Only an administrator/);
    await expect(updateSettings(kv, s, { allowSignup: true })).rejects.toThrow(/Only an administrator/);
  });
  it('sign-up only when the administrator allows it', async () => {
    const { kv, admin } = await device();
    await expect(signUp(kv, 'walkin', 'walk-in-pass-1', IT)).rejects.toThrow(/turned off/);
    await updateSettings(kv, admin, { allowSignup: true, autoLockMinutes: 999 });
    expect(loadDirectory(kv)!.settings).toEqual({ allowSignup: true, autoLockMinutes: 240 });
    const s = await signUp(kv, 'walkin', 'walk-in-pass-1', IT);
    expect(s.role).toBe('user');
    await expect(signUp(kv, 'WALKIN', 'walk-in-pass-2', IT)).rejects.toThrow(/taken/);
  });
  it('reset a forgotten password without losing the user\'s data', async () => {
    const { kv, admin } = await device();
    await createUser(kv, admin, 'cashier1', 'temp-pass-01', 'user', IT);
    const s = await ok(login(kv, 'cashier1', 'temp-pass-01'));
    await writeVault(kv, s, { scans: ['r1'] });
    const id = listUsers(kv).find(u => u.username === 'cashier1')!.id;
    await resetPassword(kv, admin, id, 'new-temp-pass-9');
    const s2 = await ok(login(kv, 'cashier1', 'new-temp-pass-9'));
    expect(s2.mustChangePassword).toBe(true);
    expect(await readVault(kv, s2)).toEqual({ scans: ['r1'] });
  });
  it('roles, disabling, unlocking, deleting — and there is always an administrator', async () => {
    const { kv, admin } = await device();
    await createUser(kv, admin, 'manager', 'temp-pass-01', 'user', IT);
    const id = listUsers(kv).find(u => u.username === 'manager')!.id;
    await expect(setRole(kv, admin, admin.userId, 'user')).rejects.toThrow(/at least one administrator/);
    await expect(setDisabled(kv, admin, admin.userId, true)).rejects.toThrow(/own account/);
    await setRole(kv, admin, id, 'admin');
    const m = await ok(login(kv, 'manager', 'temp-pass-01'));
    expect(m.orgPrivate).not.toBeNull();                  // a promoted admin can open others' records
    await setDisabled(kv, admin, id, true);
    expect(await login(kv, 'manager', 'temp-pass-01')).toEqual({ ok: false, reason: 'disabled' });
    await setDisabled(kv, admin, id, false);
    for (let i = 0; i < MAX_ATTEMPTS; i++) await login(kv, 'manager', 'nope-nope-1');
    await unlockAccount(kv, admin, id);
    await ok(login(kv, 'manager', 'temp-pass-01'));
    await setRole(kv, admin, id, 'user');
    expect((await ok(login(kv, 'manager', 'temp-pass-01'))).orgPrivate).toBeNull();
    await deleteUser(kv, admin, id);
    expect(listUsers(kv).map(u => u.username)).toEqual(['owner']);
    expect(kv.get(vaultKey(id))).toBeNull();
  });
});

describe('encrypted per-user data', () => {
  it('a vault is unreadable without its owner\'s key, but the administrator can review it', async () => {
    const { kv, admin } = await device();
    await createUser(kv, admin, 'cashier1', 'temp-pass-01', 'user', IT);
    await createUser(kv, admin, 'cashier2', 'temp-pass-02', 'user', IT);
    const c1 = await ok(login(kv, 'cashier1', 'temp-pass-01'));
    const c2 = await ok(login(kv, 'cashier2', 'temp-pass-02'));
    await writeVault(kv, c1, { receipt: 'GCash ₱5,000.00 ref 8041241631871' });
    expect(kv.get(vaultKey(c1.userId))).not.toMatch(/GCash|8041241631871/);   // stored encrypted
    expect(await readVault(kv, c1)).toEqual({ receipt: 'GCash ₱5,000.00 ref 8041241631871' });
    await expect(readVault(kv, { ...c2, userId: c1.userId } as Session)).rejects.toThrow();   // another user's key fails
    expect(await adminReadVault(kv, admin, c1.userId)).toEqual({ receipt: 'GCash ₱5,000.00 ref 8041241631871' });
    await expect(adminReadVault(kv, c2, c1.userId)).rejects.toThrow(/Only an administrator/);
  });
});

describe('activity log', () => {
  it('records sign-ins and account changes, without passwords, in a hash chain that detects edits', async () => {
    const { kv, admin } = await device();
    await login(kv, 'owner', 'bad-pass-123', at(1));
    await ok(login(kv, 'owner', 'sari-sari-2026', at(2)));
    await createUser(kv, admin, 'cashier1', 'temp-pass-01', 'user', IT);
    const log = readLog(kv);
    expect(log.map(e => e.action)).toEqual(['setup', 'login-failed', 'login', 'user-created']);
    expect(JSON.stringify(log)).not.toMatch(/sari-sari-2026|bad-pass-123|temp-pass-01/);
    expect(await verifyLog(kv)).toEqual({ ok: true, entries: 4, brokenAt: null });
    const stored = JSON.parse(kv.get(AUDIT_KEY)!);
    stored.entries[1].detail = 'nothing happened';
    kv.set(AUDIT_KEY, JSON.stringify(stored));
    expect(await verifyLog(kv)).toEqual({ ok: false, entries: 4, brokenAt: 2 });
    stored.entries.splice(1, 1);
    kv.set(AUDIT_KEY, JSON.stringify(stored));
    expect((await verifyLog(kv)).ok).toBe(false);
  });
});
