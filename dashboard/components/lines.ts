/**
 * Court-record line numbering (DESIGN.md §6.3). Every turn is broken into fixed-measure lines,
 * 25 lines to a page, so a moment can be cited as page:line ("3:12") and the citation agrees
 * between the Live log and the debrief transcript. The wrap is ours, not the browser's.
 */
import type { TurnView } from '@/lib/bus/reducer';

export const LINES_PER_PAGE = 25;
/** Characters per transcript line. About 60 at 19 px Ronzino fills c1-c7 at 1440. */
export const MEASURE = 60;

export interface Line {
  /** 1-based across the whole conversation */
  n: number;
  page: number;
  line: number;
  text: string;
  turn: number;
}

export function wrap(text: string, measure = MEASURE): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= measure) cur += ` ${w}`;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

export function position(n: number): { page: number; line: number } {
  return { page: Math.floor((n - 1) / LINES_PER_PAGE) + 1, line: ((n - 1) % LINES_PER_PAGE) + 1 };
}

export function cite(n: number): string {
  const p = position(n);
  return `${p.page}:${p.line}`;
}

/** Lines for every turn, plus the first line number of each turn. */
export function layout(turns: TurnView[]): { lines: Line[]; first: number[] } {
  const lines: Line[] = [];
  const first: number[] = [];
  turns.forEach((t, i) => {
    first.push(lines.length + 1);
    for (const text of wrap(t.text)) {
      const n = lines.length + 1;
      lines.push({ n, ...position(n), text, turn: i });
    }
  });
  return { lines, first };
}

/** The line a moment in the conversation belongs to: the first line of the turn being spoken then. */
export function lineAt(turns: TurnView[], first: number[], ts: number): number | null {
  if (!turns.length) return null;
  let idx = 0;
  for (let i = 0; i < turns.length; i++) if (turns[i].start <= ts) idx = i;
  return first[idx] ?? null;
}

/**
 * Subtitle rule (§6.4): at most two lines of about 42 characters, bottom-weighted.
 * The newest words fill the bottom line first; when the partial outgrows two lines the oldest words drop.
 */
export function subtitle(text: string, measure = 42): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= measure) cur = `${w} ${cur}`;
    else {
      lines.unshift(cur);
      if (lines.length === 2) return lines;
      cur = w;
    }
  }
  if (cur) lines.unshift(cur);
  return lines.slice(-2);
}
