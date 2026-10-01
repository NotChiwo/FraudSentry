import { useState, useEffect } from 'react';
import {
  LayoutDashboard, ScanLine, MessageSquareWarning, GitCompareArrows,
  BookOpen, FileText, Info, Lock, ShieldCheck, ChevronRight, Menu, X,
  Sun, Moon, Trees,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
}

const NAV = [
  { id: 'home',     label: 'Home',                icon: LayoutDashboard,       sub: 'Start here & activity'    },
  { id: 'scanner',  label: 'Transaction Check',   icon: ScanLine,              sub: 'Verify payment proof', isNew: true },
  { id: 'analyzer', label: 'Message Analyzer',    icon: MessageSquareWarning,  sub: 'Detect scam text',     isNew: true },
  { id: 'cross',    label: 'Cross-Evidence',      icon: GitCompareArrows,      sub: 'Correlate proof + chat', isNew: true },
  { id: 'model',    label: 'Detection Model',     icon: Trees,                 sub: 'Random Forest + metrics', isNew: true },
  { id: 'knowledge',label: 'Scam Knowledge Base', icon: BookOpen,              sub: 'Pattern reference'        },
  { id: 'reports',  label: 'Reports',             icon: FileText,              sub: 'Your scan records'        },
  { id: 'privacy',  label: 'Privacy & Data',      icon: Lock,                  sub: 'RA 10173 compliance'      },
  { id: 'about',    label: 'About',               icon: Info,                  sub: 'Project information'      },
];

// Real JS-driven responsive check — does NOT depend on Tailwind utility
// classes being generated, so the navigation reliably shows on desktop
// and becomes a drawer on phones.
function useIsMobile(breakpoint = 860): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return isMobile;
}

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showNew, setShowNew] = useState(true);
  const isMobile = useIsMobile();

  // The "NEW" badges are an introduction, not permanent chrome — fade them out.
  useEffect(() => {
    const t = setTimeout(() => setShowNew(false), 5000);
    return () => clearTimeout(t);
  }, []);
  const theme = useAppStore(s => s.theme);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const isDark = theme === 'dark';

  // On phones the drawer is always full width (never the 68px rail).
  const effectiveCollapsed = isMobile ? false : collapsed;

  // Close the mobile drawer whenever we switch back to desktop.
  useEffect(() => { if (!isMobile) setMobileOpen(false); }, [isMobile]);

  const panel = (
    <div style={{
      width: effectiveCollapsed ? 68 : 248,
      height: '100%', minHeight: '100vh',
      background: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--sidebar-border)',
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1)',
      position: 'relative', zIndex: 10, overflowY: 'auto', overflowX: 'hidden', flexShrink: 0,
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 180, background: 'radial-gradient(ellipse at 50% 0%, rgba(37,99,235,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />

      {/* Logo */}
      <div style={{
        padding: effectiveCollapsed ? '18px 14px' : '18px 16px',
        borderBottom: '1px solid var(--sidebar-border)',
        display: 'flex', alignItems: 'center', justifyContent: effectiveCollapsed ? 'center' : 'space-between',
        gap: 10, position: 'relative', zIndex: 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{
            width: 34, height: 34, flexShrink: 0,
            background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
            borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 18px rgba(37,99,235,0.45)',
          }}>
            <ShieldCheck size={17} color="#ffffff" />
          </div>
          {!effectiveCollapsed && (
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 14, fontWeight: 800, letterSpacing: '-0.01em',
                background: 'linear-gradient(135deg,#93c5fd,#a5b4fc)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', whiteSpace: 'nowrap',
              }}>FraudSentry</div>
              <div style={{ fontSize: 9, color: 'rgba(226,232,240,0.4)', fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', marginTop: 1 }}>
                Verification Platform
              </div>
            </div>
          )}
        </div>
        {/* Collapse / expand only matters on desktop; close button on mobile */}
        {isMobile ? (
          <button onClick={() => setMobileOpen(false)} aria-label="Close menu" style={{ background: 'none', border: 'none', color: 'rgba(226,232,240,0.5)', cursor: 'pointer', padding: 4, borderRadius: 6, display: 'flex' }}>
            <X size={16} />
          </button>
        ) : !collapsed ? (
          <button onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" style={{ background: 'none', border: 'none', color: 'rgba(226,232,240,0.3)', cursor: 'pointer', padding: 4, borderRadius: 6, display: 'flex' }}>
            <ChevronRight size={13} style={{ transform: 'rotate(180deg)' }} />
          </button>
        ) : (
          <button onClick={() => setCollapsed(false)} aria-label="Expand sidebar" style={{
            position: 'absolute', right: -10, top: 22, background: '#0d1220', border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 6, padding: '4px 3px', color: '#60a5fa', cursor: 'pointer', display: 'flex', zIndex: 20,
          }}>
            <ChevronRight size={11} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav style={{ padding: '10px 8px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2, position: 'relative', zIndex: 1 }}>
        {NAV.map(item => {
          const Icon = item.icon;
          const active = activePage === item.id;
          return (
            <button key={item.id} onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
              title={effectiveCollapsed ? item.label : undefined}
              className={`sidebar-nav-btn${active ? ' active' : ''}`}
              style={{ justifyContent: effectiveCollapsed ? 'center' : 'flex-start', padding: effectiveCollapsed ? '10px' : '9px 11px' }}
            >
              <div style={{ position: 'relative', flexShrink: 0, color: active ? 'var(--sidebar-active)' : 'rgba(226,232,240,0.45)' }}>
                <Icon size={16} />
                {item.isNew && showNew && !effectiveCollapsed && (
                  <span style={{ position: 'absolute', top: -6, right: -18, background: 'linear-gradient(135deg,#10b981,#059669)', color: 'white', fontSize: 7, fontWeight: 800, padding: '1px 4px', borderRadius: 99, letterSpacing: '0.04em', animation: 'fade-in 0.3s ease' }}>NEW</span>
                )}
              </div>
              {!effectiveCollapsed && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: active ? 700 : 500, lineHeight: 1.2 }}>{item.label}</div>
                  <div style={{ fontSize: 10, color: 'rgba(226,232,240,0.32)', marginTop: 1 }}>{item.sub}</div>
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Privacy reassurance */}
      {!effectiveCollapsed && (
        <div style={{ margin: '0 8px 8px', padding: '12px', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.18)', borderRadius: 10, position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
            <Lock size={11} color="#60a5fa" />
            <span style={{ fontSize: 10, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>On-Device</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'rgba(226,232,240,0.5)', lineHeight: 1.5 }}>
            Your uploads are processed in this browser. Nothing is sent to a server or stored online.
          </div>
        </div>
      )}

      {/* Theme toggle */}
      <div style={{ borderTop: '1px solid var(--sidebar-border)', padding: effectiveCollapsed ? '10px 8px' : '10px 10px', position: 'relative', zIndex: 1 }}>
        <button onClick={toggleTheme} title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'} style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: effectiveCollapsed ? '8px' : '8px 11px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8,
          color: 'rgba(226,232,240,0.5)', cursor: 'pointer', transition: 'all 0.2s', justifyContent: effectiveCollapsed ? 'center' : 'flex-start', fontFamily: 'inherit',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37,99,235,0.14)'; (e.currentTarget as HTMLButtonElement).style.color = '#93c5fd'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(226,232,240,0.5)'; }}
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
          {!effectiveCollapsed && <span style={{ fontSize: 12, fontWeight: 500 }}>{isDark ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>
      </div>
    </div>
  );

  // ---- Desktop: render the panel inline in the flex row ----
  if (!isMobile) {
    return <div style={{ flexShrink: 0 }}>{panel}</div>;
  }

  // ---- Mobile: floating hamburger + slide-in drawer ----
  return (
    <>
      <button onClick={() => setMobileOpen(true)} aria-label="Open menu" style={{
        position: 'fixed', top: 12, left: 12, zIndex: 60, background: 'rgba(13,18,32,0.92)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 9, padding: 8, color: '#94a3b8',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Menu size={17} />
      </button>
      {mobileOpen && (
        <>
          <div onClick={() => setMobileOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', zIndex: 50 }} />
          <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 55, boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}>{panel}</div>
        </>
      )}
    </>
  );
}
