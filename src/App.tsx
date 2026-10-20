import { useState, useEffect, useRef } from 'react';
import Sidebar, { PageId, useIsMobile, NAV_GROUPS } from './components/layout/Sidebar';
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
import TransactionsPage from './pages/TransactionsPage';
import FraudReportsPage from './pages/FraudReportsPage';
import { App as NativeApp } from '@capacitor/app';
import { isAndroidApp } from './platform/native';
import { useAppStore } from './store/useAppStore';
import { warmUpSharedModel } from './engine/sharedModel';
import { restoreLabelledModel } from './services/trainingData';
import { ShieldCheck, Bell } from 'lucide-react';

const PAGE_TITLE: Record<PageId, string> = {
  ...Object.fromEntries(NAV_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label]))),
} as Record<PageId, string>;


export default function App() {
  const [page, setPage] = useState<PageId>('home');
  const theme = useAppStore(s => s.theme);
  const hasConsented = useAppStore(s => s.hasConsented);
  const unread = useAppStore(s => unreadCount(s.alerts));
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
  const shown: PageId = page;

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
            <span className="chip-quiet"><span className="dot-live" aria-hidden="true" /> On-device</span>
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
