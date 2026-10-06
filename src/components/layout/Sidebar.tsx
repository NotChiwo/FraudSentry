import { useState, useEffect } from 'react';
import {
  Home, ScanLine, MessageSquareWarning, GitCompareArrows, BookOpen, History, Info, Lock,
  ShieldCheck, ChevronRight, Sun, Moon, Trees, MoreHorizontal, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export type PageId = 'home' | 'scanner' | 'analyzer' | 'cross' | 'model' | 'knowledge' | 'reports' | 'privacy' | 'about';

interface NavItem { id: PageId; label: string; icon: LucideIcon; sub: string }
interface NavGroup { title: string; items: NavItem[]; note?: string }

// Everyday tools first; thesis/research tools in their own, clearly labelled group.
export const NAV_GROUPS: NavGroup[] = [
  { title: 'Check', items: [
    { id: 'home',     label: 'Home',           icon: Home,                 sub: 'Start here' },
    { id: 'scanner',  label: 'Check Receipt',  icon: ScanLine,             sub: 'Is this payment proof real?' },
    { id: 'analyzer', label: 'Check Message',  icon: MessageSquareWarning, sub: 'Spot scam texts & links' },
    { id: 'reports',  label: 'History',        icon: History,              sub: 'Your checks, on this device' },
  ] },
  { title: 'Learn', items: [
    { id: 'knowledge', label: 'Scam Knowledge Base', icon: BookOpen, sub: 'Common PH scams' },
    { id: 'privacy',   label: 'Privacy & Data',      icon: Lock,     sub: 'What stays on your device' },
    { id: 'about',     label: 'About',               icon: Info,     sub: 'The project' },
  ] },
  { title: 'Research tools', note: 'Thesis demo', items: [
    { id: 'cross', label: 'Cross-Evidence',  icon: GitCompareArrows, sub: 'Receipt vs. conversation' },
    { id: 'model', label: 'Detection Model', icon: Trees,            sub: 'Random Forest & metrics' },
  ] },
];

const MOBILE_TABS: NavItem[] = [
  NAV_GROUPS[0].items[0], NAV_GROUPS[0].items[1], NAV_GROUPS[0].items[2], NAV_GROUPS[0].items[3],
];

export function useIsMobile(breakpoint = 860): boolean {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < breakpoint : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return isMobile;
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true"><ShieldCheck size={18} /></span>
      {!compact && (
        <span className="brand-text">
          <span className="brand-name">FraudSentry</span>
          <span className="brand-tag">Proof checker</span>
        </span>
      )}
    </div>
  );
}

function ThemeButton({ compact }: { compact?: boolean }) {
  const theme = useAppStore(s => s.theme);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const isDark = theme === 'dark';
  return (
    <button type="button" className="nav-util" onClick={toggleTheme} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
      {!compact && <span>{isDark ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}

interface Props { activePage: PageId; onNavigate: (page: PageId) => void }

export default function Sidebar({ activePage, onNavigate }: Props) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => { if (!isMobile) setMoreOpen(false); }, [isMobile]);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  if (isMobile) {
    const inTabs = MOBILE_TABS.some(t => t.id === activePage);
    const go = (id: PageId) => { setMoreOpen(false); onNavigate(id); };
    return (
      <>
        <nav className="tabbar" aria-label="Main">
          {MOBILE_TABS.map(t => {
            const Icon = t.icon;
            const active = activePage === t.id;
            return (
              <button key={t.id} type="button" className={`tab${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => go(t.id)}>
                <span className="tab-ico"><Icon size={21} /></span>
                <span className="tab-label">{t.id === 'scanner' ? 'Receipt' : t.id === 'analyzer' ? 'Message' : t.label}</span>
              </button>
            );
          })}
          <button type="button" className={`tab${!inTabs ? ' active' : ''}`} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
            <span className="tab-ico"><MoreHorizontal size={21} /></span>
            <span className="tab-label">More</span>
          </button>
        </nav>
        {moreOpen && (
          <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="More pages" onClick={e => e.stopPropagation()}>
              <div className="sheet-head">
                <Brand />
                <button type="button" className="icon-btn" aria-label="Close" onClick={() => setMoreOpen(false)}><X size={18} /></button>
              </div>
              {NAV_GROUPS.slice(1).map(g => (
                <div key={g.title} className="sheet-group">
                  <div className="nav-group-title">{g.title}{g.note && <span className="nav-group-note">{g.note}</span>}</div>
                  {g.items.map(it => {
                    const Icon = it.icon;
                    return (
                      <button key={it.id} type="button" className={`sheet-item${activePage === it.id ? ' active' : ''}`} onClick={() => go(it.id)}>
                        <Icon size={18} />
                        <span><span className="sheet-item-label">{it.label}</span><span className="sheet-item-sub">{it.sub}</span></span>
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="sheet-group"><ThemeButton /></div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sidebar">
      <div className="sidebar-head">
        <Brand compact={collapsed} />
        <button type="button" className="icon-btn sidebar-collapse" onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
          <ChevronRight size={15} style={{ transform: collapsed ? 'none' : 'rotate(180deg)' }} />
        </button>
      </div>
      <nav className="sidebar-nav" aria-label="Main">
        {NAV_GROUPS.map(g => (
          <div key={g.title} className="nav-group">
            {!collapsed && <div className="nav-group-title">{g.title}{g.note && <span className="nav-group-note">{g.note}</span>}</div>}
            {g.items.map(it => {
              const Icon = it.icon;
              const active = activePage === it.id;
              return (
                <button key={it.id} type="button" className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}
                  title={collapsed ? it.label : undefined} aria-label={collapsed ? it.label : undefined} onClick={() => onNavigate(it.id)}>
                  <Icon size={18} className="nav-ico" />
                  {!collapsed && <span className="nav-text"><span className="nav-label">{it.label}</span><span className="nav-sub">{it.sub}</span></span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      {!collapsed && (
        <div className="sidebar-note">
          <Lock size={14} aria-hidden="true" />
          <span>Checks run in this browser. Your screenshots and messages are never uploaded.</span>
        </div>
      )}
      <div className="sidebar-foot"><ThemeButton compact={collapsed} /></div>
    </aside>
  );
}
