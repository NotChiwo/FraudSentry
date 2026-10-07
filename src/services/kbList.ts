// Pure helpers for the Scam Knowledge Base page (unit-tested).
import type { ScamEntry } from '../data/scamKnowledge';
import { analyzeMessageText } from '../engine/messageAnalysis';

/** Case-insensitive match on name, list hint, summary and quick rule. */
export function filterEntries(entries: ScamEntry[], query: string): ScamEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(e => [e.name, e.hint, e.summary, e.quickRule].some(s => s.toLowerCase().includes(q)));
}

/** Roving-focus movement in a vertical tab list. Returns the new index (or the same one). */
export function moveIndex(key: string, index: number, count: number): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowDown': case 'ArrowRight': return (index + 1) % count;
    case 'ArrowUp': case 'ArrowLeft': return (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return index;
  }
}

/** The example without its surrounding quotation marks (what gets prefilled). */
export function exampleText(e: ScamEntry): string {
  return e.example.replace(/^["“]\s*/, '').replace(/\s*["”]$/, '');
}

export interface Segment { text: string; flagged: boolean }

/**
 * The example split into plain and flagged parts, using the Message
 * Analyzer's OWN matches (flag start/end) — so the highlighted words are
 * exactly what the analyzer reacts to, not a hand-made list.
 */
export function exampleSegments(e: ScamEntry): Segment[] {
  const text = e.example;
  const spans = analyzeMessageText(text).flags
    .map(f => [f.start, f.end] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]);
  }
  const out: Segment[] = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) out.push({ text: text.slice(pos, a), flagged: false });
    out.push({ text: text.slice(a, b), flagged: true });
    pos = b;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), flagged: false });
  return out;
}
