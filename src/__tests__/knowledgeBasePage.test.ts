// Scam Knowledge Base page: data contract, list/selection logic, and the
// rendered markup (server-rendered with react-dom/server; no browser needed).
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KnowledgeBasePage from '../pages/KnowledgeBasePage';
import { ENTRIES } from '../data/scamKnowledge';
import { filterEntries, moveIndex, exampleSegments, exampleText } from '../services/kbList';
import { analyzeMessageText } from '../engine/messageAnalysis';

const render = (initialId?: string) => renderToStaticMarkup(createElement(KnowledgeBasePage, { initialId }));
const count = (html: string, re: RegExp) => (html.match(re) || []).length;

describe('Knowledge Base data contract', () => {
  it('has 10 entries, each with a quick rule, list hint, basis and ≤4 flags/tips', () => {
    expect(ENTRIES).toHaveLength(10);
    for (const e of ENTRIES) {
      expect(e.quickRule.length, e.id).toBeGreaterThan(10);
      expect(e.hint.length, e.id).toBeGreaterThan(5);
      expect(e.basis, e.id).toMatch(/advisor|guidance/i);
      expect(e.redFlags.length, e.id).toBeGreaterThanOrEqual(3);
      expect(e.redFlags.length, e.id).toBeLessThanOrEqual(4);
      expect(e.protect.length, e.id).toBeGreaterThanOrEqual(3);
      expect(e.protect.length, e.id).toBeLessThanOrEqual(4);
    }
  });
  it('no literal escape sequences leak into the copy (e.g. "\\u2019")', () => {
    for (const e of ENTRIES) {
      expect(JSON.stringify([e.name, e.hint, e.quickRule, e.summary, e.redFlags, e.protect, e.basis]), e.id).not.toMatch(/\\\\u[0-9a-f]{4}/i);
    }
  });
  it('the quick rules use the agreed safer wordings', () => {
    const rule = (id: string) => ENTRIES.find(e => e.id === id)!.quickRule;
    expect(rule('otp')).toBe('If anyone asks for your OTP or PIN, it is a scam.');
    expect(rule('proof')).toBe('A screenshot is not money — check your own app.');
    expect(rule('parcel')).toBe('Pay delivery or customs fees only through the courier’s official channel.');
  });
});

describe('rendered page', () => {
  it('renders all 10 scam types as tabs, with exactly one selected', () => {
    const html = render();
    expect(count(html, /role="tab"/g)).toBe(10);
    for (const e of ENTRIES) expect(html, e.id).toContain(`id="kb-tab-${e.id}"`);
    expect(count(html, /aria-selected="true"/g)).toBe(1);
  });
  it('first load already shows a scam in the detail pane (never empty)', () => {
    const html = render();
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain(`aria-labelledby="kb-tab-${ENTRIES[0].id}"`);
    expect(html).toContain(ENTRIES[0].quickRule);
  });
  it('selecting another entry shows its detail and marks its tab selected', () => {
    const e = ENTRIES.find(x => x.id === 'parcel')!;
    const html = render('parcel');
    expect(html).toMatch(/id="kb-tab-parcel"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="kb-tab-parcel"/);
    expect(html).toContain(`aria-labelledby="kb-tab-parcel"`);
    expect(html).toContain('Pay delivery or customs fees only through the courier’s official channel.');
    expect(html).toContain(e.redFlags[0].replace(/’/g, '’'));
  });
  it('only the selected tab is in the Tab order (roving tabindex)', () => {
    const html = render('otp');
    expect(count(html, /role="tab"[^>]*tabindex="0"|tabindex="0"[^>]*role="tab"/g)).toBe(1);
  });
  it('fake proof of payment offers Check Receipt, not the message example', () => {
    expect(render('proof')).toContain('Check a receipt instead');
    expect(render('otp')).toContain('Try this example in Check Message');
  });
  it('keeps the educational disclaimer and has no literal "\\u2019"', () => {
    const html = render();
    expect(html).toMatch(/Educational material, not live statistics/);
    expect(html).not.toContain('\\u2019');
    expect(html).toContain('you’ll see it named');
  });
});

describe('list logic', () => {
  it('filter matches name, hint and quick rule; nonsense matches nothing', () => {
    expect(filterEntries(ENTRIES, 'otp').map(e => e.id)).toContain('otp');
    expect(filterEntries(ENTRIES, 'customs').map(e => e.id)).toEqual(['parcel']);
    expect(filterEntries(ENTRIES, '  ')).toHaveLength(10);
    expect(filterEntries(ENTRIES, 'zzqqxx')).toEqual([]);
  });
  it('arrow keys wrap; Home/End jump; other keys do nothing', () => {
    expect(moveIndex('ArrowDown', 9, 10)).toBe(0);
    expect(moveIndex('ArrowUp', 0, 10)).toBe(9);
    expect(moveIndex('Home', 5, 10)).toBe(0);
    expect(moveIndex('End', 5, 10)).toBe(9);
    expect(moveIndex('a', 5, 10)).toBe(5);
  });
});

describe('typical message highlighting', () => {
  it('highlights exactly what the Message Analyzer flags, and every example has at least one highlight', () => {
    for (const e of ENTRIES) {
      const segs = exampleSegments(e);
      expect(segs.map(s => s.text).join(''), e.id).toBe(e.example);   // nothing lost or reordered
      const flagged = segs.filter(s => s.flagged).map(s => s.text);
      const r = analyzeMessageText(e.example);
      if (r.flags.length) expect(flagged.length, e.id).toBeGreaterThan(0);
      for (const f of flagged) expect(r.flags.some(fl => e.example.slice(fl.start, fl.end).includes(f) || f.includes(e.example.slice(fl.start, fl.end))), e.id).toBe(true);
    }
  });
  it('the prefilled example has no surrounding quotes and is still detected', () => {
    for (const e of ENTRIES.filter(x => x.tryIn === 'message')) {
      const t = exampleText(e);
      expect(t, e.id).not.toMatch(/^["“]|["”]$/);
      expect(analyzeMessageText(t).threatLevel, e.id).not.toBe('low');
    }
  });
});
