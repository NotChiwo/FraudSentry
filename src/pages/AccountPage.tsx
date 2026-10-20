// Your account: who is signed in, change password, sign out.
import { useState, type FormEvent } from 'react';
import { UserCircle2, KeyRound, LogOut, Loader2, ShieldCheck } from 'lucide-react';
import { changePassword, passwordProblem, listUsers, AccountError } from '../services/accounts';
import { useSession, sessionKV } from '../store/useSession';
import { formatDateTime } from '../utils/helpers';

export default function AccountPage({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const session = useSession(s => s.session)!;
  const update = useSession(s => s.update);
  const signOut = useSession(s => s.signOut);
  const me = listUsers(sessionKV()).find(u => u.id === session.userId);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = passwordProblem(next, session.username) ?? (next !== confirm ? 'The two new passwords are not the same.' : null);
    if (p) { setMsg({ ok: false, text: p }); return; }
    setBusy(true); setMsg(null);
    try {
      update(await changePassword(sessionKV(), session, current, next));
      setCurrent(''); setNext(''); setConfirm('');
      setMsg({ ok: true, text: 'Password changed. Use the new one next time you sign in.' });
    } catch (err) { setMsg({ ok: false, text: err instanceof AccountError ? err.message : 'Something went wrong. Please try again.' }); }
    finally { setBusy(false); }
  };

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div className="page-head-ico"><UserCircle2 size={22} /></div>
        <div>
          <h1>Your account</h1>
          <p>Your account exists only on this device. Your history and alerts are encrypted with a key that only your password (or an administrator) can unlock.</p>
        </div>
      </div>
      <section className="card admin-card">
        <dl className="account-facts">
          <div><dt>Username</dt><dd>{session.username}</dd></div>
          <div><dt>Role</dt><dd>{session.role === 'admin' ? 'Administrator' : 'User'}</dd></div>
          {me && <div><dt>Created</dt><dd>{formatDateTime(me.dateCreated)}</dd></div>}
        </dl>
        <div className="chip-row">
          {session.role === 'admin' && onNavigate && <button type="button" className="btn-secondary" onClick={() => onNavigate('admin')}><ShieldCheck size={15} /> Administration</button>}
          <button type="button" className="btn-ghost danger" onClick={() => void signOut()}><LogOut size={15} /> Sign out</button>
        </div>
      </section>
      <section className="card admin-card">
        <h2 className="section-title"><KeyRound size={18} /> Change password</h2>
        <form className="admin-form one-col" onSubmit={submit} noValidate>
          <label>Current password<input className="input-field" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} /></label>
          <label>New password<input className="input-field" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} /></label>
          <label>Repeat new password<input className="input-field" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
          <p className="muted small" style={{ margin: 0 }}>At least 8 characters, with a letter and a number, and not containing your username.</p>
          <button type="submit" className="btn-primary" disabled={busy || !current || !next}>{busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />} Change password</button>
        </form>
        {msg && <p className={`admin-msg${msg.ok ? '' : ' bad'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      </section>
    </div>
  );
}
