import { useState, useEffect, useRef } from 'react';
import Sidebar, { PageId, useIsMobile, NAV_GROUPS, EXTRA_PAGE_TITLES, navFor } from './components/layout/Sidebar';
import ErrorBoundary from './components/common/ErrorBoundary';
import ConsentGate from './components/consent/ConsentGate';
import HomePage from './pages/HomePage';
import ScannerPage from './pages/ScannerPage';
import MessageAnalyzerPage from './pages/MessageAnalyzerPage';
import CrossEvidencePage from './pages/CrossEvidencePage';
import ModelPage from './pages/ModelPage';
import KnowledgeBasePage from './pages/KnowledgeBasePage';
import ReportsPage from './pages/ReportsPage';
import PrivacyPage from './pages/PrivacyPage';
import AboutPage from './pages/AboutPage';
import AlertsPage from './pages/AlertsPage';
import AlertToast from './components/alerts/AlertToast';
import { unreadCount } from './services/alerts';
import AuthGate, { ForcePasswordChange } from './components/auth/AuthGate';
import AdminPage from './pages/AdminPage';
import AccountPage from './pages/AccountPage';
import TransactionsPage from './pages/TransactionsPage';
import FraudReportsPage from './pages/FraudReportsPage';
import { useSession, sessionKV } from './store/useSession';
import { accountSettings } from './services/accounts';
import { App as NativeApp } from '@capacitor/app';
import { isAndroidApp } from './platform/native';
import { useAppStore } from './store/useAppStore';
import { warmUpSharedModel } from './engine/sharedModel';
import { restoreLabelledModel } from './services/trainingData';
import { ShieldCheck, Bell, UserCircle2, LogOut } from 'lucide-react';

const PAGE_TITLE: Record<PageId, string> = {
  ...Object.fromEntries(NAV_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label]))),
  ...EXTRA_PAGE_TITLES,
} as Record<PageId, string>;

/** Sign out after the administrator's chosen minutes without any input. */
function useAutoLock(active: boolean) {
  const signOut = useSession(s => s.signOut);
  useEffect(() => {
    if (!active) return;
    const minutes = accountSettings(sessionKV()).autoLockMinutes;
    if (!minutes) return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => { if (Date.now() - last > minutes * 60_000) void signOut('auto-lock'); }, 15_000);
    return () => { events.forEach(e => window.removeEventListener(e, bump)); clearInterval(t); };
  }, [active, signOut]);
}

export default function App() {
  const [page, setPage] = useState<PageId>('home');
  const theme = useAppStore(s => s.theme);
  const hasConsented = useAppStore(s => s.hasConsented);
  const unread = useAppStore(s => unreadCount(s.alerts));
  const session = useSession(s => s.session);
  const signOut = useSession(s => s.signOut);
  const isAdmin = session?.role === 'admin';
  useAutoLock(!!session);
  const contentRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const isMobile = useIsMobile();
  // The welcome / privacy-notice screen is shown once; after that it opens from
  // the footer, the Privacy page, or by adding #welcome to the address (demos).
  const [welcomeOpen, setWelcomeOpen] = useState(() => typeof location !== 'undefined' && location.hash === '#welcome');
  const openWelcome = () => { setWelcomeOpen(true); window.scrollTo({ top: 0 }); };
  useEffect(() => {
    const onHash = () => { if (location.hash === '#welcome') setWelcomeOpen(true); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const closeWelcome = () => {
    setWelcomeOpen(false);
    if (location.hash === '#welcome') history.replaceState(null, '', location.pathname + location.search);
  };

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  // Train the demo Random Forest in the background once the app is open, so
  // the first scan doesn't stall the page while it trains.
  useEffect(() => {
    if (!hasConsented) return;
    // a model you trained on your own labelled scans replaces the demo one
    const { labelledModel, trainingRows } = useAppStore.getState();
    if (labelledModel) void restoreLabelledModel(trainingRows, labelledModel);
    const start = () => { void warmUpSharedModel(); };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(start, { timeout: 2500 }); else setTimeout(start, 800);
  }, [hasConsented]);

  useEffect(() => { document.title = `${PAGE_TITLE[page]} · FraudSentry`; }, [page]);
  // a new sign-in starts on Home; standard users never stay on an administrator page
  useEffect(() => { setPage('home'); }, [session?.userId]);
  const allowed = (p: PageId) => p === 'account' || navFor(isAdmin).some(g => g.items.some(i => i.id === p));
  const shown: PageId = allowed(page) ? page : 'home';

  // Android back button: close an open sheet or dialog first (they close on Escape), then go
  // back to Home, then leave the app
  const shownRef = useRef<PageId>('home');
  shownRef.current = shown;
  useEffect(() => {
    if (!isAndroidApp()) return;
    const sub = NativeApp.addListener('backButton', () => {
      if (document.querySelector('.sheet-backdrop, [role="dialog"]')) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return; }
      if (shownRef.current !== 'home') { setPage('home'); return; }
      void NativeApp.minimizeApp();
    });
    return () => { void sub.then(h => h.remove()); };
  }, []);

  const navigate = (p: string) => {
    setPage(p as PageId);
    contentRef.current?.scrollTo({ top: 0 });
    // move focus to the new page for keyboard / screen-reader users
    requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  };

  if (!hasConsented || welcomeOpen) return <ConsentGate onClose={hasConsented ? closeWelcome : undefined} />;
  if (!session) return <AuthGate />;
  if (session.mustChangePassword) return <ForcePasswordChange />;

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link" onClick={e => { e.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a>
      <Sidebar activePage={shown} onNavigate={navigate} />

      <div ref={contentRef} className="app-content">
        <header className="app-topbar">
          {isMobile ? (
            <div className="topbar-brand"><span className="brand-mark sm" aria-hidden="true"><ShieldCheck size={15} /></span><span>{PAGE_TITLE[shown]}</span></div>
          ) : (
            <span className="topbar-date">{new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          )}
          <div className="topbar-right">
            <button type="button" className={`bell-btn${unread > 0 ? ' has-unread' : ''}`} onClick={() => navigate('alerts')}
              aria-label={unread > 0 ? `Alerts: ${unread} unread` : 'Alerts: none unread'} aria-current={shown === 'alerts' ? 'page' : undefined}>
              <Bell size={17} aria-hidden="true" />
              {unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
            </button>
            <button type="button" className={`user-chip${shown === 'account' ? ' active' : ''}`} onClick={() => navigate('account')} aria-label={`Your account: ${session.username}, ${isAdmin ? 'administrator' : 'user'}`}>
              <UserCircle2 size={17} aria-hidden="true" /><span className="hide-sm">{session.username}</span>{isAdmin && <span className="role-chip admin hide-sm">Admin</span>}
            </button>
            <button type="button" className="bell-btn" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><LogOut size={16} aria-hidden="true" /></button>
          </div>
        </header>

        <main id="main" ref={mainRef} tabIndex={-1} className="app-main" aria-label={PAGE_TITLE[shown]}>
          <ErrorBoundary key={shown} onHome={() => navigate('home')}>
          <div className="page-enter">
            {shown === 'home'      && <HomePage onNavigate={navigate} />}
            {shown === 'scanner'   && <ScannerPage />}
            {shown === 'analyzer'  && <MessageAnalyzerPage />}
            {shown === 'cross'     && <CrossEvidencePage />}
            {shown === 'model'     && <ModelPage />}
            {shown === 'knowledge' && <KnowledgeBasePage onNavigate={navigate} />}
            {shown === 'reports'   && <ReportsPage onNavigate={navigate} />}
            {shown === 'alerts'    && <AlertsPage onNavigate={navigate} />}
            {shown === 'transactions' && <TransactionsPage onNavigate={navigate} />}
            {shown === 'fraudreports' && <FraudReportsPage />}
            {shown === 'privacy'   && <PrivacyPage onShowWelcome={openWelcome} />}
            {shown === 'about'     && <AboutPage />}
            {shown === 'admin'     && <AdminPage />}
            {shown === 'account'   && <AccountPage onNavigate={navigate} />}
          </div>
          </ErrorBoundary>
        </main>

        <AlertToast onOpen={() => navigate('alerts')} />

        <footer className="site-footer">
          <div className="footer-row">
            <div className="footer-brand">
              <span className="brand-mark sm" aria-hidden="true"><ShieldCheck size={15} /></span>
              <div>
                <div className="footer-title">FraudSentry</div>
                <div className="footer-sub">Evidence-based payment-proof & scam checker</div>
              </div>
            </div>
            <nav className="footer-links" aria-label="Footer">
              <button type="button" onClick={() => navigate('privacy')}>Privacy & Data</button>
              <button type="button" onClick={() => navigate('knowledge')}>Knowledge Base</button>
              <button type="button" onClick={() => navigate('about')}>About</button>
              <button type="button" onClick={openWelcome}>Welcome screen</button>
            </nav>
          </div>
          <div className="footer-legal">
            © 2026 FraudSentry · BSCS thesis project · University of Perpetual Help System DALTA · Built with RA 10173 (Data Privacy Act) in mind
          </div>
        </footer>
      </div>
    </div>
  );
}
