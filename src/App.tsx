import { useState, useEffect, useRef } from 'react';
import Sidebar from './components/layout/Sidebar';
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
import { ShieldCheck } from 'lucide-react';

type Page = 'home' | 'scanner' | 'analyzer' | 'cross' | 'model' | 'knowledge' | 'reports' | 'privacy' | 'about';

function PageTransition({ children, pageKey }: { children: React.ReactNode; pageKey: string }) {
  const [key, setKey] = useState(pageKey);
  const [show, setShow] = useState(true);
  useEffect(() => {
    if (pageKey !== key) {
      setShow(false);
      const t = setTimeout(() => { setKey(pageKey); setShow(true); }, 80);
      return () => clearTimeout(t);
    }
  }, [pageKey, key]);
  return (
    <div style={{ opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(8px)', transition: 'opacity 0.28s ease, transform 0.28s ease' }}>
      {children}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const theme = useAppStore(s => s.theme);
  const hasConsented = useAppStore(s => s.hasConsented);
  const imageScans = useAppStore(s => s.imageScans);
  const messageScans = useAppStore(s => s.messageScans);
  const isDark = theme === 'dark';
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const navigate = (p: string) => {
    setPage(p as Page);
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!hasConsented) return <ConsentGate />;

  const highRiskCount = [...imageScans, ...messageScans].filter(s =>
    'riskLevel' in s ? (s.riskLevel === 'critical' || s.riskLevel === 'high')
    : (s.threatLevel === 'critical' || s.threatLevel === 'high')
  ).length;

  return (
    <div className="mesh-bg" style={{ height: '100vh', display: 'flex', overflow: 'hidden' }}>
      <Sidebar activePage={page} onNavigate={navigate} />

      <div ref={contentRef} style={{ flex: 1, minWidth: 0, height: '100%', overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Top bar */}
        <div className="app-topbar" style={{
          position: 'sticky', top: 0, zIndex: 30, background: 'var(--topbar-bg)',
          backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--topbar-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
        }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 500 }}>
            {new Date().toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {highRiskCount > 0 && (
              <button onClick={() => navigate('reports')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.24)', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px #ef4444' }} />
                <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>{highRiskCount} high-risk in your history</span>
              </button>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, background: 'var(--bg-input)', border: '1px solid var(--border-input)', borderRadius: 7, padding: '3px 9px' }}>
              No Account Required
            </div>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <PageTransition pageKey={page}>
            {page === 'home'      && <HomePage onNavigate={navigate} />}
            {page === 'scanner'   && <ScannerPage />}
            {page === 'analyzer'  && <MessageAnalyzerPage />}
            {page === 'cross'     && <CrossEvidencePage />}
            {page === 'model'     && <ModelPage />}
            {page === 'knowledge' && <KnowledgeBasePage />}
            {page === 'reports'   && <ReportsPage />}
            {page === 'privacy'   && <PrivacyPage />}
            {page === 'about'     && <AboutPage />}
          </PageTransition>
        </div>

        {/* Footer */}
        <footer className="site-footer">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ShieldCheck size={15} color="#ffffff" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>FraudSentry</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Evidence-Based Fraud Verification Platform</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {[{ label: 'Privacy & Data', id: 'privacy' }, { label: 'About', id: 'about' }, { label: 'Knowledge Base', id: 'knowledge' }].map(l => (
                <button key={l.id} onClick={() => navigate(l.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit', transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-light)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                  {l.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
              <div>© 2026 FraudSentry — BSCS Thesis Research Project</div>
              <div style={{ marginTop: 2 }}>University of Perpetual Help System DALTA · Compliant with RA 10173</div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
