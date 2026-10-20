// Administration (thesis Module 7): users and roles, an overview of every
// user's checks and alerts, the tamper-evident activity log, and settings.
// Administrators only (the page is not offered to standard users, and every
// action is re-checked in services/accounts.ts).
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, Users, ScrollText, Settings, LayoutDashboard, UserPlus, KeyRound, Trash2, Ban, CheckCircle2, Unlock,
  ShieldAlert, Download, RefreshCw, Copy, Eye, X, Loader2,
} from 'lucide-react';
import {
  listUsers, createUser, resetPassword, setRole, setDisabled, deleteUser, unlockAccount, updateSettings, accountSettings,
  adminReadVault, generateTempPassword, passwordProblem, AccountError, type PublicUser, type Role,
} from '../services/accounts';
import { readLog, verifyLog, type AuditEntry, type LogCheck } from '../services/auditLog';
import { useSession, sessionKV } from '../store/useSession';
import { userDataFromSaved, type UserData } from '../store/useAppStore';
import { getSharedModelMeta } from '../engine/sharedModel';
import { unreadCount } from '../services/alerts';
import { formatDateTime, formatRelativeTime, downloadBlob } from '../utils/helpers';
import type { RiskLevel } from '../types';

type Tab = 'overview' | 'users' | 'log' | 'settings';
const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'log', label: 'Activity log', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings },
];
const LEVEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const risky = (l: RiskLevel) => l === 'high' || l === 'critical';

function errText(e: unknown) { return e instanceof AccountError ? e.message : 'Something went wrong. Please try again.'; }

export default function AdminPage() {
  const session = useSession(s => s.session)!;
  const [tab, setTab] = useState<Tab>('overview');
  const [users, setUsers] = useState<PublicUser[]>(() => listUsers(sessionKV()));
  const refresh = useCallback(() => setUsers(listUsers(sessionKV())), []);

  if (session.role !== 'admin' || !session.orgPrivate) {
    return <div className="page"><div className="card empty-state"><h2>Administrators only</h2><p>Ask your administrator if you need access.</p></div></div>;
  }
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div className="page-head-ico"><ShieldCheck size={22} /></div>
        <div>
          <h1>Administration</h1>
          <p>Manage who can use FraudSentry on this device, review their checks and alerts, and see the activity log. Signed in as <b>{session.username}</b> (administrator).</p>
        </div>
      </div>
      <div className="chip-row admin-tabs" role="tablist" aria-label="Administration sections">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`filter-btn${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            <t.icon size={15} aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS.find(t => t.id === tab)!.label}>
        {tab === 'overview' && <Overview users={users} />}
        {tab === 'users' && <UsersTab users={users} refresh={refresh} />}
        {tab === 'log' && <LogTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

// ── overview ─────────────────────────────────────────────────
interface UserStats { user: PublicUser; data: UserData | null; error?: string }

function useAllUserData(users: PublicUser[]) {
  const session = useSession(s => s.session)!;
  const [stats, setStats] = useState<UserStats[] | null>(null);
  useEffect(() => {
    let live = true;
    setStats(null);
    void Promise.all(users.map(async (user): Promise<UserStats> => {
      try { return { user, data: userDataFromSaved(await adminReadVault<Partial<UserData>>(sessionKV(), session, user.id)) }; }
      catch { return { user, data: null, error: 'could not be opened' }; }
    })).then(s => { if (live) setStats(s); });
    return () => { live = false; };
  }, [users, session]);
  return stats;
}

function Overview({ users }: { users: PublicUser[] }) {
  const stats = useAllUserData(users);
  const meta = getSharedModelMeta();
  const [viewing, setViewing] = useState<UserStats | null>(null);
  if (!stats) return <p className="muted"><Loader2 size={15} className="spin" /> Opening everyone's records…</p>;
  const sum = (f: (d: UserData) => number) => stats.reduce((n, s) => n + (s.data ? f(s.data) : 0), 0);
  const checks = sum(d => d.imageScans.length + d.messageScans.length + d.crossChecks.length);
  const flagged = sum(d => d.imageScans.filter(r => risky(r.riskLevel)).length + d.messageScans.filter(m => risky(m.threatLevel)).length + d.crossChecks.filter(c => risky(c.combinedRiskLevel)).length);
  const alerts = sum(d => d.alerts.length), unread = sum(d => unreadCount(d.alerts));
  return (
    <>
      <div className="admin-stats">
        <Stat label="Users" value={users.length} sub={`${users.filter(u => u.role === 'admin').length} admin · ${users.filter(u => u.disabled).length} disabled`} />
        <Stat label="Checks (last 30 days)" value={checks} sub={`${sum(d => d.imageScans.length)} receipts · ${sum(d => d.messageScans.length)} messages`} />
        <Stat label="High / Critical" value={flagged} sub={checks ? `${Math.round((flagged / checks) * 100)}% of checks` : '—'} />
        <Stat label="Alerts" value={alerts} sub={`${unread} unread`} />
      </div>
      <section className="card admin-card">
        <h2 className="section-title">Per user</h2>
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>User</th><th>Role</th><th>Receipts</th><th>Messages</th><th>High / Critical</th><th>Unread alerts</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.user.id}>
                  <td><b>{s.user.username}</b>{s.user.disabled && <span className="tag-muted"> disabled</span>}</td>
                  <td>{s.user.role === 'admin' ? 'Administrator' : 'User'}</td>
                  {s.data ? <>
                    <td>{s.data.imageScans.length}</td><td>{s.data.messageScans.length}</td>
                    <td>{s.data.imageScans.filter(r => risky(r.riskLevel)).length + s.data.messageScans.filter(m => risky(m.threatLevel)).length}</td>
                    <td>{unreadCount(s.data.alerts)}</td>
                  </> : <td colSpan={4} className="muted">{s.error ?? 'no records'}</td>}
                  <td>{s.user.lastLogin ? formatRelativeTime(s.user.lastLogin) : 'never'}</td>
                  <td>{s.data && <button type="button" className="btn-ghost" onClick={() => setViewing(s)} aria-label={`View ${s.user.username}'s records`}><Eye size={15} /> Records</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card admin-card">
        <h2 className="section-title">Detection model in use</h2>
        <p className="muted small" style={{ margin: 0 }}>
          {meta.datasetSource === 'demo' ? 'Demonstration-trained' : meta.datasetSource === 'labelled' ? 'Trained on labelled receipts from this device' : 'Trained on an uploaded evidence CSV'}
          {' · '}{meta.nTrees} trees · depth {meta.maxDepth} · {meta.trainRows} training rows · since {formatDateTime(meta.trainedAt)}. Manage it on the Detection Model page.
        </p>
      </section>
      {viewing?.data && <RecordsDrawer stats={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return <div className="card admin-stat"><span className="admin-stat-label">{label}</span><span className="admin-stat-value">{value}</span><span className="muted small">{sub}</span></div>;
}

function RecordsDrawer({ stats, onClose }: { stats: UserStats; onClose: () => void }) {
  const d = stats.data!;
  const rows = [
    ...d.imageScans.map(r => ({ id: r.id, when: r.scannedAt, kind: 'Receipt', level: r.riskLevel, title: [r.source !== 'Unknown' ? r.source : null, r.extracted.referenceNo ? `ref ${r.extracted.referenceNo}` : null].filter(Boolean).join(' · ') || r.filename })),
    ...d.messageScans.map(m => ({ id: m.id, when: m.scannedAt, kind: 'Message', level: m.threatLevel, title: `${m.scamType} · ${m.platform}` })),
    ...d.crossChecks.map(c => ({ id: c.id, when: c.scannedAt, kind: 'Cross-Evidence', level: c.combinedRiskLevel, title: c.verdict })),
  ].sort((a, b) => b.when.localeCompare(a.when));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet admin-drawer" role="dialog" aria-modal="true" aria-label={`${stats.user.username}'s records`} onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="section-title" style={{ margin: 0 }}>{stats.user.username}'s records <span className="muted small">(read-only)</span></h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        {rows.length === 0 ? <p className="muted">No checks in the last 30 days.</p> : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>When</th><th>Type</th><th>Risk</th><th>Details</th><th>Alert</th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const alert = d.alerts.find(a => a.resultId === r.id);
                  return (
                    <tr key={r.id}>
                      <td>{formatDateTime(r.when)}</td><td>{r.kind}</td>
                      <td><span className={`sev-chip sev-${r.level === 'low' ? 'ok' : r.level}`}>{LEVEL[r.level]}</span></td>
                      <td style={{ overflowWrap: 'anywhere' }}>{r.title}</td>
                      <td>{alert ? (alert.status === 'unread' ? 'Unread' : 'Read') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── users ────────────────────────────────────────────────────
function UsersTab({ users, refresh }: { users: PublicUser[]; refresh: () => void }) {
  const session = useSession(s => s.session)!;
  const [username, setUsername] = useState('');
  const [role, setRoleSel] = useState<Role>('user');
  const [temp, setTemp] = useState(generateTempPassword);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; password?: string } | null>(null);

  const run = async (fn: () => Promise<unknown>, done: string, password?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: done, password }); refresh(); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
    finally { setBusy(false); }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    let pw = temp;
    while (passwordProblem(pw, username)) pw = generateTempPassword();
    const name = username.trim().toLowerCase();
    void run(() => createUser(sessionKV(), session, username, pw, role), `Account “${name}” created. Give them this temporary password; they must change it when they first sign in:`, pw)
      .then(() => { setUsername(''); setTemp(generateTempPassword()); });
  };

  return (
    <>
      <section className="card admin-card">
        <h2 className="section-title"><UserPlus size={18} /> Add a user</h2>
        <form className="admin-form" onSubmit={add}>
          <label>Username<input className="input-field" value={username} onChange={e => setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} placeholder="e.g. cashier1" /></label>
          <label>Role
            <select className="input-field" value={role} onChange={e => setRoleSel(e.target.value as Role)}>
              <option value="user">User — checks receipts and messages</option>
              <option value="admin">Administrator — also manages users and the model</option>
            </select>
          </label>
          <label>Temporary password
            <span className="admin-temp"><input className="input-field mono" value={temp} onChange={e => setTemp(e.target.value)} spellCheck={false} />
              <button type="button" className="icon-btn sm" onClick={() => setTemp(generateTempPassword())} aria-label="Generate another password"><RefreshCw size={15} /></button></span>
          </label>
          <button type="submit" className="btn-primary" disabled={busy || !username.trim()}>{busy ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />} Create account</button>
        </form>
        {msg && <Message msg={msg} />}
      </section>

      <section className="card admin-card">
        <h2 className="section-title"><Users size={18} /> Accounts on this device</h2>
        <ul className="admin-users">
          {users.map(u => <UserRow key={u.id} u={u} me={u.id === session.userId} busy={busy} run={run} />)}
        </ul>
      </section>
    </>
  );
}

function Message({ msg }: { msg: { ok: boolean; text: string; password?: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`admin-msg${msg.ok ? '' : ' bad'}`} role={msg.ok ? 'status' : 'alert'}>
      <span>{msg.text}</span>
      {msg.password && (
        <span className="admin-pw">
          <code className="mono">{msg.password}</code>
          <button type="button" className="btn-ghost" onClick={() => { void navigator.clipboard?.writeText(msg.password!).then(() => setCopied(true)); }}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</button>
        </span>
      )}
    </div>
  );
}

function UserRow({ u, me, busy, run }: { u: PublicUser; me: boolean; busy: boolean; run: (fn: () => Promise<unknown>, done: string, pw?: string) => Promise<void> }) {
  const session = useSession(s => s.session)!;
  const kv = sessionKV();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = !!u.lockedUntil && Date.parse(u.lockedUntil) > Date.now();
  const reset = () => {
    let pw = generateTempPassword();
    while (passwordProblem(pw, u.username)) pw = generateTempPassword();
    void run(() => resetPassword(kv, session, u.id, pw), `New temporary password for “${u.username}” (they must change it at sign-in):`, pw);
  };
  return (
    <li className="admin-user">
      <div className="admin-user-main">
        <b>{u.username}</b>{me && <span className="tag-muted"> (you)</span>}
        <span className={`role-chip ${u.role}`}>{u.role === 'admin' ? 'Administrator' : 'User'}</span>
        {u.disabled && <span className="role-chip off">Disabled</span>}
        {locked && <span className="role-chip off">Locked until {new Date(u.lockedUntil!).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</span>}
        {u.mustChangePassword && <span className="tag-muted">must change password</span>}
        <div className="muted small">Created {formatDateTime(u.dateCreated)} · last sign-in {u.lastLogin ? formatRelativeTime(u.lastLogin) : 'never'}</div>
      </div>
      <div className="admin-user-actions">
        {!me && <button type="button" className="btn-ghost" disabled={busy} onClick={reset}><KeyRound size={14} /> Reset password</button>}
        {!me && <button type="button" className="btn-ghost" disabled={busy}
          onClick={() => void run(() => setRole(kv, session, u.id, u.role === 'admin' ? 'user' : 'admin'), `“${u.username}” is now ${u.role === 'admin' ? 'a user' : 'an administrator'}.`)}>
          <ShieldAlert size={14} /> {u.role === 'admin' ? 'Make user' : 'Make admin'}</button>}
        {locked && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void run(() => unlockAccount(kv, session, u.id), `“${u.username}” is unlocked.`)}><Unlock size={14} /> Unlock</button>}
        {!me && <button type="button" className="btn-ghost" disabled={busy}
          onClick={() => void run(() => setDisabled(kv, session, u.id, !u.disabled), `“${u.username}” is ${u.disabled ? 'enabled' : 'disabled'}.`)}>
          {u.disabled ? <><CheckCircle2 size={14} /> Enable</> : <><Ban size={14} /> Disable</>}</button>}
        {!me && (confirmDelete ? (
          <span className="confirm-row">
            <span>Delete “{u.username}” and their records?</span>
            <button type="button" className="btn-ghost danger" disabled={busy} onClick={() => void run(() => deleteUser(kv, session, u.id), `“${u.username}” was deleted.`)}>Delete</button>
            <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
          </span>
        ) : <button type="button" className="btn-ghost danger" disabled={busy} onClick={() => setConfirmDelete(true)} aria-label={`Delete ${u.username}`}><Trash2 size={14} /></button>)}
      </div>
    </li>
  );
}

// ── activity log ─────────────────────────────────────────────
const ACTION_LABEL: Partial<Record<AuditEntry['action'], string>> = {
  setup: 'Set up', login: 'Signed in', 'login-failed': 'Sign-in failed', 'locked-out': 'Locked out', logout: 'Signed out', 'auto-lock': 'Auto-locked',
  signup: 'Signed up', 'user-created': 'User created', 'user-deleted': 'User deleted', 'role-changed': 'Role changed', 'user-disabled': 'User disabled',
  'user-enabled': 'User enabled', 'password-changed': 'Password changed', 'password-reset': 'Password reset', 'settings-changed': 'Settings changed',
  'receipt-checked': 'Receipt checked', 'message-checked': 'Message checked', 'cross-checked': 'Cross-Evidence', 'history-cleared': 'History cleared',
  'alerts-cleared': 'Alerts cleared', 'model-trained': 'Model trained', 'labels-cleared': 'Labels cleared', 'report-generated': 'Report generated',
  'transaction-entered': 'Transaction entered',
};
const SECURITY = new Set(['login-failed', 'locked-out', 'user-disabled', 'user-deleted', 'role-changed', 'password-reset']);

function LogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>(() => readLog(sessionKV()));
  const [q, setQ] = useState('');
  const [onlySecurity, setOnlySecurity] = useState(false);
  const [check, setCheck] = useState<LogCheck | null>(null);
  const shown = useMemo(() => [...entries].reverse().filter(e =>
    (!onlySecurity || SECURITY.has(e.action)) &&
    (!q.trim() || `${e.actor ?? ''} ${ACTION_LABEL[e.action] ?? e.action} ${e.detail}`.toLowerCase().includes(q.trim().toLowerCase()))), [entries, q, onlySecurity]);
  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = ['seq,time,action,user,detail,hash', ...entries.map(e => [e.seq, e.at, e.action, esc(e.actor ?? ''), esc(e.detail), e.hash].join(','))].join('\n') + '\n';
    downloadBlob(csv, `fraudsentry-activity-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };
  return (
    <section className="card admin-card">
      <div className="row-between">
        <h2 className="section-title" style={{ margin: 0 }}><ScrollText size={18} /> Activity log</h2>
        <div className="chip-row">
          <button type="button" className="btn-secondary" onClick={() => { setEntries(readLog(sessionKV())); void verifyLog(sessionKV()).then(setCheck); }}><ShieldCheck size={15} /> Verify integrity</button>
          <button type="button" className="btn-ghost" onClick={exportCsv} disabled={!entries.length}><Download size={15} /> CSV</button>
        </div>
      </div>
      {check && (
        <p className={`admin-msg${check.ok ? '' : ' bad'}`} role="status">
          {check.ok ? `All ${check.entries} entries are intact: none has been edited, removed or re-ordered.` : `The log was altered at entry #${check.brokenAt}: that entry or one before it was edited or removed outside FraudSentry.`}
        </p>
      )}
      <div className="history-tools" style={{ marginTop: 12 }}>
        <input type="search" className="input-field" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by user, action or detail…" aria-label="Filter the activity log" />
        <div className="chip-row"><button type="button" className={`filter-btn${onlySecurity ? ' active' : ''}`} aria-pressed={onlySecurity} onClick={() => setOnlySecurity(v => !v)}>Security events only</button></div>
      </div>
      <p className="muted small">{shown.length} of {entries.length} entries. Each entry carries the hash of the one before it, so changes outside the app are detected. Entries hold no receipt or message contents.</p>
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>#</th><th>When</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {shown.slice(0, 300).map(e => (
              <tr key={e.seq} className={SECURITY.has(e.action) ? 'sec' : undefined}>
                <td className="muted">{e.seq}</td><td>{formatDateTime(e.at)}</td><td>{e.actor ?? '—'}</td>
                <td>{ACTION_LABEL[e.action] ?? e.action}</td><td style={{ overflowWrap: 'anywhere' }}>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 300 && <p className="muted small">Showing the newest 300. Download the CSV for all entries.</p>}
    </section>
  );
}

// ── settings ─────────────────────────────────────────────────
function SettingsTab() {
  const session = useSession(s => s.session)!;
  const [settings, setSettings] = useState(() => accountSettings(sessionKV()));
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (patch: Partial<typeof settings>) => {
    try { setSettings(await updateSettings(sessionKV(), session, patch)); setMsg('Saved.'); }
    catch (e) { setMsg(errText(e)); }
  };
  return (
    <section className="card admin-card admin-settings">
      <h2 className="section-title"><Settings size={18} /> Settings</h2>
      <label className="admin-toggle">
        <input type="checkbox" checked={settings.allowSignup} onChange={e => void save({ allowSignup: e.target.checked })} />
        <span><b>Allow sign-up on the sign-in screen.</b> Anyone with this device can then create a standard user account. Off: only administrators add users.</span>
      </label>
      <label className="admin-field">
        <b>Sign out automatically after</b>
        <select className="input-field" value={settings.autoLockMinutes} onChange={e => void save({ autoLockMinutes: Number(e.target.value) })}>
          {[5, 15, 30, 60].map(m => <option key={m} value={m}>{m} minutes without activity</option>)}
          <option value={0}>Never (not recommended on a shared device)</option>
        </select>
      </label>
      {msg && <p className="muted small" role="status">{msg}</p>}
      <p className="muted small">History, alerts and labels are kept for 30 days (RA 10173 data minimisation). Each user's records are encrypted with their own key; administrators can open them for review.</p>
    </section>
  );
}
