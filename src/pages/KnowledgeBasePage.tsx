import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ShieldCheck, AlertTriangle, ArrowLeft, ChevronRight, Search, X, MessageSquareWarning, ScanLine, Lightbulb, Info } from 'lucide-react';
import { ENTRIES, ScamEntry } from '../data/scamKnowledge';
import { filterEntries, moveIndex, exampleSegments, exampleText } from '../services/kbList';
import { useAppStore } from '../store/useAppStore';

const NARROW = 720;   // below this: list → detail (single column); at/above: two panes

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < NARROW : false);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener('resize', on); on();
    return () => window.removeEventListener('resize', on);
  }, []);
  return narrow;
}

export default function KnowledgeBasePage({ onNavigate, initialId }: { onNavigate?: (p: string) => void; initialId?: string }) {
  const [selectedId, setSelectedId] = useState(initialId ?? ENTRIES[0].id);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'detail'>('list');   // used below NARROW only
  const narrow = useNarrow();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const detailHeadRef = useRef<HTMLHeadingElement>(null);
  const shown = useMemo(() => filterEntries(ENTRIES, query), [query]);
  const selected = ENTRIES.find(e => e.id === selectedId) ?? ENTRIES[0];
  const showList = !narrow || view === 'list';
  const showDetail = !narrow || view === 'detail';

  // Phone back button / swipe-back closes the detail view instead of leaving
  // the page: opening a detail pushes a history entry; popstate returns to the list.
  useEffect(() => {
    const onPop = () => {
      setView(v => {
        if (v === 'detail') requestAnimationFrame(() => tabRefs.current[selectedIdRef.current]?.focus());
        return 'list';
      });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  // leaving the page while the detail entry is on the stack: make that entry inert
  useEffect(() => () => {
    if (history.state?.kbDetail) history.replaceState(null, '');
  }, []);
  // going wide while in detail: drop the pushed entry's meaning
  useEffect(() => { if (!narrow) setView('list'); }, [narrow]);

  const openDetail = (id: string) => {
    setSelectedId(id);
    if (narrow) {
      setView('detail');
      history.pushState({ kbDetail: id }, '');
      requestAnimationFrame(() => {
        document.querySelector('.app-content')?.scrollTo({ top: 0 });
        detailHeadRef.current?.focus({ preventScroll: true });
      });
    }
  };
  const backToList = () => {
    if (history.state?.kbDetail) history.back();   // popstate handler restores the list + focus
    else { setView('list'); requestAnimationFrame(() => tabRefs.current[selectedId]?.focus()); }
  };

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const next = moveIndex(e.key, index, shown.length);
    if (next === index || next < 0) return;
    e.preventDefault();
    const id = shown[next].id;
    if (!narrow) setSelectedId(id);   // two panes: selection follows focus
    tabRefs.current[id]?.focus();
  };
  // the tab that takes Tab-key focus: the selected one if visible, else the first shown
  const focusableId = shown.some(e => e.id === selectedId) ? selectedId : shown[0]?.id;

  const tryIt = (e: ScamEntry) => {
    if (e.tryIn === 'receipt') { onNavigate?.('scanner'); return; }
    useAppStore.getState().setPendingExample(exampleText(e));
    onNavigate?.('analyzer');
  };

  return (
    <div className="page kb-page">
      {/* on phones the detail view drops the page intro so the scam fills the screen */}
      {!showList && <h1 className="sr-only">Scam Knowledge Base</h1>}
      {showList && (<>
      <div className="page-head">
        <div className="page-head-ico"><BookOpen size={22} /></div>
        <div>
          <h1>Scam Knowledge Base</h1>
          <p>Ten scam patterns to know, each with one rule to remember. Educational material, not live statistics.</p>
        </div>
      </div>

      <div className="kb-note">
        <Info size={17} aria-hidden="true" />
        <span>These are the patterns Check Message looks for. When a message you check matches one, you’ll see it named in the result with the exact phrases highlighted.</span>
      </div>
      </>)}

      <div className={`kb-grid${narrow ? ' narrow' : ''}`}>
        {showList && (
          <section className="kb-list card" aria-label="Scam types">
            <label className="kb-search">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Filter scam types</span>
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter scams…" />
              {query && <button type="button" className="icon-btn sm" aria-label="Clear search text" onClick={() => setQuery('')}><X size={16} /></button>}
            </label>
            {shown.length === 0 ? (
              <div className="kb-empty" role="status">
                <p>No scam types match “{query}”.</p>
                <button type="button" className="btn-ghost" onClick={() => setQuery('')}>Clear filter</button>
              </div>
            ) : (
              <div className="kb-tabs" role={narrow ? 'list' : 'tablist'} aria-orientation={narrow ? undefined : 'vertical'} aria-label="Scam types">
                {shown.map((e, i) => {
                  const Icon = e.icon;
                  const sel = e.id === selectedId;
                  return (
                    <span key={e.id} role={narrow ? 'listitem' : 'none'} className="kb-item">
                    <button
                      ref={el => { tabRefs.current[e.id] = el; }}
                      id={`kb-tab-${e.id}`}
                      type="button"
                      role={narrow ? undefined : 'tab'}
                      aria-selected={narrow ? undefined : sel}
                      aria-controls={narrow ? undefined : 'kb-panel'}
                      tabIndex={narrow || e.id === focusableId ? 0 : -1}
                      className={`kb-tab${sel ? ' sel' : ''}`}
                      onClick={() => openDetail(e.id)}
                      onKeyDown={ev => onTabKey(ev, i)}
                    >
                      <span className="kb-ico" style={{ color: e.color, background: `${e.color}1f` }} aria-hidden="true"><Icon size={18} /></span>
                      <span className="kb-tab-text"><span className="kb-tab-name">{e.name}</span><span className="kb-tab-hint">{e.hint}</span></span>
                      {narrow && <ChevronRight size={18} className="kb-chev" aria-hidden="true" />}
                    </button>
                    </span>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {showDetail && (
          <section id="kb-panel" className="kb-detail card" role={narrow ? 'region' : 'tabpanel'} aria-labelledby={narrow ? 'kb-detail-title' : `kb-tab-${selected.id}`}>
            {narrow && (
              <button type="button" className="btn-ghost kb-back" onClick={backToList}><ArrowLeft size={17} /> All scams</button>
            )}
            <Detail entry={selected} headRef={detailHeadRef} onTry={tryIt} />
          </section>
        )}
      </div>
      {/* announce selection changes without moving focus */}
      <div className="sr-only" aria-live="polite">{`${selected.name}. ${selected.quickRule}`}</div>
    </div>
  );
}

function Detail({ entry: e, headRef, onTry }: { entry: ScamEntry; headRef: React.RefObject<HTMLHeadingElement | null>; onTry: (e: ScamEntry) => void }) {
  const Icon = e.icon;
  const segments = useMemo(() => exampleSegments(e), [e]);
  return (
    <div key={e.id} className="kb-detail-inner">
      <div className="kb-detail-head">
        <span className="kb-ico lg" style={{ color: e.color, background: `${e.color}1f` }} aria-hidden="true"><Icon size={22} /></span>
        <h2 ref={headRef} id="kb-detail-title" tabIndex={-1}>{e.name}</h2>
      </div>
      <p className="kb-summary">{e.summary}</p>

      <div className="kb-rule">
        <Lightbulb size={20} aria-hidden="true" />
        <div><span className="kb-rule-label">Quick rule</span><p>{e.quickRule}</p></div>
      </div>

      <div className="kb-cols">
        <div>
          <h3 className="kb-h"><AlertTriangle size={16} aria-hidden="true" /> Red flags</h3>
          <ul className="kb-items flags">{e.redFlags.slice(0, 4).map(r => <li key={r}>{r}</li>)}</ul>
        </div>
        <div>
          <h3 className="kb-h ok"><ShieldCheck size={16} aria-hidden="true" /> Protect yourself</h3>
          <ul className="kb-items protect">{e.protect.slice(0, 4).map(r => <li key={r}>{r}</li>)}</ul>
        </div>
      </div>

      <h3 className="kb-h plain">Typical message <span className="kb-h-note">— highlighted words are what Check Message flags</span></h3>
      <blockquote className="kb-example" style={{ borderLeftColor: e.color }}>
        {segments.map((s, i) => s.flagged ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>)}
      </blockquote>

      <div className="kb-actions">
        {e.tryIn === 'message'
          ? <button type="button" className="btn-secondary" onClick={() => onTry(e)}><MessageSquareWarning size={17} /> Try this example in Check Message</button>
          : <button type="button" className="btn-secondary" onClick={() => onTry(e)}><ScanLine size={17} /> Check a receipt instead</button>}
      </div>
      <p className="kb-basis">Based on: {e.basis}</p>
    </div>
  );
}
