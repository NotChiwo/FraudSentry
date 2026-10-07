import { useState, useEffect, useRef } from 'react';
import Sidebar, { PageId, useIsMobile, NAV_GROUPS } from './components/layout/Sidebar';
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
import { useAppStore } from './store/useAppStore';
import { warmUpSharedModel } from './engine/sharedModel';
import { ShieldCheck, AlertTriangle } from 'lucide-react';

const PAGE_TITLE: Record<PageId, string> = Object.fromEntries(
  NAV_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label])),
) as Record<PageId, string>;

export default function App() {
  const [page, setPage] = useState<PageId>('home');
  const theme = useAppStore(s => s.theme);
  const hasConsented = useAppStore(s => s.hasConsented);
  const imageScans = useAppStore(s => s.imageScans);
  const messageScans = useAppStore(s => s.messageScans);
  const contentRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  // Train the demo Random Forest in the background once the app is open, so
  // the first scan doesn't stall the page while it trains.
  useEffect(() => {
    if (!hasConsented) return;
    const start = () => { void warmUpSharedModel(); };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(start, { timeout: 2500 }); else setTimeout(start, 800);
  }, [hasConsented]);

  useEffect(() => { document.title = `${PAGE_TITLE[page]} · FraudSentry`; }, [page]);

  const navigate = (p: string) => {
    setPage(p as PageId);
    contentRef.current?.scrollTo({ top: 0 });
    // move focus to the new page for keyboard / screen-reader users
    requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  };

  if (!hasConsented) return <ConsentGate />;

  const highRiskCount = [...imageScans, ...messageScans].filter(s =>
    'riskLevel' in s ? (s.riskLevel === 'critical' || s.riskLevel === 'high')
    : (s.threatLevel === 'critical' || s.threatLevel === 'high'),
  ).length;

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link" onClick={e => { e.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a>
      <Sidebar activePage={page} onNavigate={navigate} />

      <div ref={contentRef} className="app-content">
        <header className="app-topbar">
          {isMobile ? (
            <div className="topbar-brand"><span className="brand-mark sm" aria-hidden="true"><ShieldCheck size={15} /></span><span>{PAGE_TITLE[page]}</span></div>
          ) : (
            <span className="topbar-date">{new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          )}
          <div className="topbar-right">
            {highRiskCount > 0 && (
              <button type="button" className="risk-pill" onClick={() => navigate('reports')} aria-label={`${highRiskCount} high-risk results in your history`}>
                <AlertTriangle size={14} aria-hidden="true" /><span>{highRiskCount}<span className="hide-sm"> high-risk</span></span>
              </button>
            )}
            <span className="chip-quiet"><span className="dot-live" aria-hidden="true" /> On-device</span>
          </div>
        </header>

        <main id="main" ref={mainRef} tabIndex={-1} className="app-main" aria-label={PAGE_TITLE[page]}>
          <div key={page} className="page-enter">
            {page === 'home'      && <HomePage onNavigate={navigate} />}
            {page === 'scanner'   && <ScannerPage />}
            {page === 'analyzer'  && <MessageAnalyzerPage />}
            {page === 'cross'     && <CrossEvidencePage />}
            {page === 'model'     && <ModelPage />}
            {page === 'knowledge' && <KnowledgeBasePage onNavigate={navigate} />}
            {page === 'reports'   && <ReportsPage onNavigate={navigate} />}
            {page === 'privacy'   && <PrivacyPage />}
            {page === 'about'     && <AboutPage />}
          </div>
        </main>

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
