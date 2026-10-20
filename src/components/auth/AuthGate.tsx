// Sign-in screens (thesis Module 1): first-run administrator setup, sign-in,
// optional self sign-up, and the forced password change after an
// administrator created the account or reset its password.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ShieldCheck, LogIn, UserPlus, KeyRound, Loader2, Eye, EyeOff, Info, Lock } from 'lucide-react';
import {
  hasAccounts, setupAdmin, login, signUp, changePassword, accountSettings, usernameProblem, passwordProblem, AccountError,
} from '../../services/accounts';
import { useSession, sessionKV } from '../../store/useSession';
import { useAppStore } from '../../store/useAppStore';

type Mode = 'setup' | 'login' | 'signup';

function Shell({ title, sub, children }: { title: string; sub: ReactNode; children: ReactNode }) {
  return (
    <div className="mesh-bg auth-shell">
      <div className="auth-box">
        <div className="auth-brand animate-fade-up">
          <span className="brand-mark auth-mark" aria-hidden="true"><ShieldCheck size={26} /></span>
          <h1>{title}</h1>
          <p>{sub}</p>
        </div>
        <div className="card auth-card animate-fade-up">{children}</div>
        <p className="auth-foot"><Lock size={13} aria-hidden="true" /> Accounts and data stay on this device. Nothing is sent to a server.</p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', autoComplete, hint, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; type?: 'text' | 'password'; autoComplete: string; hint?: string; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input-wrap">
        <input id={id} className="input-field" type={type === 'password' && !show ? 'password' : 'text'} value={value} autoComplete={autoComplete}
          autoCapitalize="none" spellCheck={false} autoFocus={autoFocus} onChange={e => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />
        {type === 'password' && (
          <button type="button" className="icon-btn sm auth-eye" onClick={() => setShow(v => !v)} aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {hint && <p id={`${id}-hint`} className="auth-hint">{hint}</p>}
    </div>
  );
}

const PASSWORD_HINT = 'At least 8 characters, with a letter and a number. A short sentence is easy to remember and hard to guess.';

function useCountdown(until: string | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const left = Math.max(0, Date.parse(until) - Date.now());
  return left === 0 ? null : `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
}

export default function AuthGate() {
  const kv = sessionKV();
  const signIn = useSession(s => s.signIn);
  const legacy = useAppStore(s => s.legacyUserData);
  const [mode, setMode] = useState<Mode>(() => (hasAccounts(kv) ? 'login' : 'setup'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the lock shown belongs to one username; typing another one clears it
  const [locked, setLocked] = useState<{ username: string; until: string } | null>(null);
  const lockedUntil = locked && locked.username === username.trim().toLowerCase() ? locked.until : null;
  const countdown = useCountdown(lockedUntil);
  const allowSignup = mode !== 'setup' && accountSettings(kv).allowSignup;
  const legacyCount = legacy ? legacy.imageScans.length + legacy.messageScans.length + legacy.crossChecks.length : 0;

  const go = (m: Mode) => { setMode(m); setError(null); setPassword(''); setConfirm(''); setLocked(null); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (mode !== 'login') {
      const p = usernameProblem(username) ?? passwordProblem(password, username) ?? (password !== confirm ? 'The two passwords are not the same.' : null);
      if (p) { setError(p); return; }
    }
    setBusy(true);
    try {
      if (mode === 'setup') await signIn(await setupAdmin(kv, username, password));
      else if (mode === 'signup') await signIn(await signUp(kv, username, password));
      else {
        const r = await login(kv, username, password);
        if (r.ok) await signIn(r.session);
        else if (r.reason === 'locked') { setLocked(r.lockedUntil ? { username: username.trim().toLowerCase(), until: r.lockedUntil } : null); setError('Too many wrong passwords. This account is locked for a while.'); }
        else if (r.reason === 'disabled') setError('This account is disabled. Ask your administrator.');
        else setError(`Wrong username or password.${r.attemptsLeft != null && r.attemptsLeft <= 2 ? ` ${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'try' : 'tries'} left before the account locks.` : ''}`);
      }
    } catch (err) {
      setError(err instanceof AccountError ? err.message : 'Something went wrong. Please try again.');
      if (!(err instanceof AccountError)) console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'setup' ? 'Set up FraudSentry' : mode === 'signup' ? 'Create your account' : 'Sign in to FraudSentry';
  const sub = mode === 'setup'
    ? 'Create the administrator account for this device. The administrator adds the other users, manages the detection model and can review the activity log.'
    : mode === 'signup' ? 'A standard account for checking receipts and messages on this device.' : 'Your history is encrypted and opens only with your password.';

  return (
    <Shell title={title} sub={sub}>
      <form onSubmit={submit} noValidate>
        <Field label="Username" value={username} onChange={setUsername} autoComplete="username" autoFocus
          hint={mode !== 'login' ? '3–32 characters: letters, numbers, dot, dash or underscore.' : undefined} />
        <Field label="Password" type="password" value={password} onChange={setPassword}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} hint={mode !== 'login' ? PASSWORD_HINT : undefined} />
        {mode !== 'login' && <Field label="Repeat password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />}

        {mode === 'setup' && (
          <div className="auth-note">
            <Info size={15} aria-hidden="true" />
            <span>
              <b>Write this password down.</b> It cannot be recovered: without it, the data on this device cannot be opened. You can later add a second administrator as a backup.
              {legacyCount > 0 && <> Your existing history ({legacyCount} check{legacyCount === 1 ? '' : 's'}) will move into this account.</>}
            </span>
          </div>
        )}

        {error && (!locked || lockedUntil) && <p className="auth-error" role="alert">{error}{countdown && <> Try again in <b>{countdown}</b>.</>}</p>}

        <button type="submit" className="btn-primary auth-submit" disabled={busy || !username || !password || !!countdown}>
          {busy ? <><Loader2 size={16} className="spin" /> {mode === 'login' ? 'Checking…' : 'Creating account…'}</>
            : mode === 'setup' ? <><ShieldCheck size={16} /> Create administrator</>
            : mode === 'signup' ? <><UserPlus size={16} /> Create account</>
            : <><LogIn size={16} /> Sign in</>}
        </button>
      </form>

      {mode === 'login' && (
        <div className="auth-alt">
          <span className="muted small">Forgot your password? Ask your administrator to reset it.</span>
          {allowSignup && <button type="button" className="btn-ghost" onClick={() => go('signup')}><UserPlus size={15} /> Create an account</button>}
        </div>
      )}
      {mode === 'signup' && (
        <div className="auth-alt"><button type="button" className="btn-ghost" onClick={() => go('login')}><LogIn size={15} /> I already have an account</button></div>
      )}
    </Shell>
  );
}

/** Shown after sign-in when the administrator set a temporary password. */
export function ForcePasswordChange() {
  const session = useSession(s => s.session)!;
  const update = useSession(s => s.update);
  const signOut = useSession(s => s.signOut);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = passwordProblem(next, session.username) ?? (next !== confirm ? 'The two passwords are not the same.' : null);
    if (p) { setError(p); return; }
    setBusy(true); setError(null);
    try { update(await changePassword(sessionKV(), session, current, next)); }
    catch (err) { setError(err instanceof AccountError ? err.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  };

  return (
    <Shell title="Choose your own password" sub={<>Hi <b>{session.username}</b>. You signed in with a temporary password from your administrator. Choose a new one that only you know.</>}>
      <form onSubmit={submit} noValidate>
        <Field label="Temporary password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
        <Field label="New password" type="password" value={next} onChange={setNext} autoComplete="new-password" hint={PASSWORD_HINT} />
        <Field label="Repeat new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="btn-primary auth-submit" disabled={busy || !current || !next}>
          {busy ? <><Loader2 size={16} className="spin" /> Saving…</> : <><KeyRound size={16} /> Save new password</>}
        </button>
      </form>
      <div className="auth-alt"><button type="button" className="btn-ghost" onClick={() => void signOut()}>Sign out</button></div>
    </Shell>
  );
}
