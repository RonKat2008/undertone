/**
 * Plain-language shaping for the Live page: the state word, pace, talk share, hands, and the
 * "Detections" stream built from bus events. No ids, confidence, latency or dBFS reach the
 * screen. Pure; tested in live.test.ts.
 */
import type { JudgeAnswer, Metrics, MotionState, NudgePolicy } from '../bus/contracts';
import type { BusState, Mark, TurnView } from '../bus/reducer';

// ---------- state word, pace, share, hands ----------

export type StateWord = 'Listening' | 'Steady' | 'Rushing';

/** The pace a wearer is taken to have before the backend learns theirs. */
export const DEFAULT_BASELINE_WPM = 150;
const DEFAULT_TOLERANCE = 0.25;
/** A turn this long without a break counts as a long turn. */
export const LONG_TURN_S = 45;

export interface Pace {
  word: StateWord;
  wpm: number | null;
  baseline: number;
  /** True while the backend is still learning the wearer's own pace. */
  learning: boolean;
  min: number;
  max: number;
  zone: [number, number];
  label: string;
}

/** The upper edge of the comfortable zone: the wearer's usual pace plus the coach's tolerance. */
export function upperEdge(baseline: number, policy: Pick<NudgePolicy, 'tolerance'> | null | undefined): number {
  return baseline * (1 + (policy?.tolerance || DEFAULT_TOLERANCE));
}

/**
 * `speaking` says whether the wearer is talking right now (their latest words, or a partial from
 * them). Without that, or without a pace, the word is "Listening".
 */
export function paceOf(metrics: Pick<Metrics, 'wpm' | 'baseline_wpm'> | null, policy: Pick<NudgePolicy, 'tolerance'> | null | undefined, speaking: boolean): Pace {
  const baseline = metrics?.baseline_wpm ?? DEFAULT_BASELINE_WPM;
  const learning = metrics?.baseline_wpm == null;
  const upper = upperEdge(baseline, policy);
  const wpm = metrics && metrics.wpm > 0 ? metrics.wpm : null;
  const word: StateWord = wpm === null || !speaking ? 'Listening' : wpm > upper ? 'Rushing' : 'Steady';
  const label = wpm === null
    ? 'No pace yet'
    : wpm > upper ? 'Faster than your comfortable pace'
      : wpm < baseline * 0.75 ? 'Slower than usual, which is fine'
        : 'Inside your comfortable pace';
  return { word, wpm, baseline, learning, min: baseline * 0.4, max: baseline * 1.7, zone: [baseline * 0.75, upper], label };
}

/** Talk share in words, for the ShareBar label. */
export function shareWords(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return 'Nobody has spoken yet';
  if (ratio >= 0.7) return 'You are doing most of the talking';
  if (ratio >= 0.55) return 'You are talking a little more than them';
  if (ratio > 0.45) return 'You are sharing the talking evenly';
  if (ratio > 0.3) return 'They are talking a little more than you';
  return 'They are doing most of the talking';
}

export type HandsWord = 'still' | 'moving' | 'fidgeting';

export const HANDS_WORD: Record<MotionState, HandsWord> = { still: 'still', gesture: 'moving', fidget: 'fidgeting' };

export function handsOf(state: Pick<BusState, 'motion'>): HandsWord | null {
  return state.motion ? HANDS_WORD[state.motion.state] : null;
}

// ---------- the detections stream ----------

/**
 * What colour a detection carries:
 *   slip:    a habit the coach is watching (amber, the coach's voice)
 *   good:    a good moment of yours (teal)
 *   buzz:    the phone buzzed (teal, filled)
 *   promise: a promise or bookmark (promise blue)
 *   body:    hands and body (conversation violet)
 *   them:    about the other person (person coral)
 *   signal:  nerves or checked out (warn)
 */
export type DetectionTone = 'slip' | 'good' | 'buzz' | 'promise' | 'body' | 'them' | 'signal';

export interface Detection {
  id: string;
  /** Session seconds. */
  ts: number;
  tone: DetectionTone;
  /** Short words: "Filler word: um". */
  text: string;
}

const JUDGE_WORDS: Record<string, { yes?: [string, DetectionTone]; no?: [string, DetectionTone] }> = {
  interrupted: { yes: ['Talked over them', 'slip'] },
  hedging: { yes: ['Hedging', 'slip'] },
  rambling: { yes: ['Rambling', 'slip'] },
  asked_question: { yes: ['Asked a question', 'good'] },
  acknowledged: { yes: ['Acknowledged them', 'good'] },
  answered_the_question: { no: ['Did not answer the question', 'slip'] },
  // promises arrive as their own bookmark event
  commitment_made: {},
};

const QUESTION_TYPE: Record<string, [string, DetectionTone]> = {
  open: ['Good question', 'good'],
  leading: ['Leading question', 'slip'],
};

const TONE_WORDS: Record<string, [string, DetectionTone]> = {
  confident: ['Sounds confident', 'good'],
  warm: ['Sounds warm', 'good'],
  nervous: ['Sounds nervous', 'signal'],
  defensive: ['Sounds defensive', 'slip'],
  flat: ['Sounds flat', 'slip'],
};

const YES = 0.5;
const sentence = (id: string) => {
  const s = id.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** What the judge heard in one of your turns, as words. Unknown questions use their name in plain words. */
export function judgeDetections(turn: TurnView): Detection[] {
  const results = turn.judge?.results;
  if (!results || turn.speaker !== 'me') return [];
  const out: Detection[] = [];
  const add = (key: string, text: string, tone: DetectionTone) => out.push({ id: `${turn.turn_id}:${key}`, ts: turn.end, tone, text });
  for (const [key, a] of Object.entries(results) as [string, JudgeAnswer][]) {
    if (a.kind === 'noul') {
      const known = JUDGE_WORDS[key];
      if (known) {
        const hit = a.p >= YES ? known.yes : known.no;
        if (hit) add(key, hit[0], hit[1]);
      } else if (a.p >= YES) {
        add(key, sentence(key), 'slip');
      }
    } else if (a.kind === 'choice') {
      const hit = key === 'question_type' ? QUESTION_TYPE[a.choice] : key === 'tone' ? TONE_WORDS[a.choice] : null;
      if (hit) add(key, hit[0], hit[1]);
    } else if (a.kind === 'score' && key === 'clarity' && a.score <= Math.ceil(a.max / 2) - 1) {
      add(key, 'Hard to follow', 'slip');
    }
  }
  return out;
}

/** Fillers, rushing and long turns, read from one finished turn. */
export function turnDetections(turn: TurnView, upper: number | null): Detection[] {
  if (turn.speaker !== 'me') return [];
  const out: Detection[] = turn.fillers.map((w, i) => ({ id: `${turn.turn_id}:f${i}`, ts: turn.end, tone: 'slip' as const, text: `Filler word: ${w.toLowerCase()}` }));
  if (upper !== null && turn.wpm > upper) out.push({ id: `${turn.turn_id}:fast`, ts: turn.end, tone: 'slip', text: 'Rushing' });
  if (turn.end - turn.start >= LONG_TURN_S) out.push({ id: `${turn.turn_id}:long`, ts: turn.end, tone: 'slip', text: 'Long turn' });
  return out;
}

const STATUS_PREFIX = 'You asked how it is going';

/** Buzzes, bookmarks, promises, signals and "How am I doing?" answers. Quiet marks repeat what the turns already show. */
export function markDetection(mark: Mark): Detection | null {
  switch (mark.kind) {
    case 'nudge': return { id: mark.id, ts: mark.ts, tone: 'buzz', text: `Buzzed: ${mark.title}` };
    case 'status': return { id: mark.id, ts: mark.ts, tone: 'good', text: `${STATUS_PREFIX}: ${mark.title.toLowerCase()}` };
    case 'bookmark': return mark.rule_id === 'promise'
      ? { id: mark.id, ts: mark.ts, tone: 'promise', text: 'Promise made' }
      : { id: mark.id, ts: mark.ts, tone: 'promise', text: 'Bookmarked' };
    case 'signal': return { id: mark.id, ts: mark.ts, tone: 'signal', text: mark.rule_id === 'nerves' ? 'Sounds nervous' : 'Seems checked out' };
    default: return null;
  }
}

export interface MotionChange { id: string; ts: number; state: MotionState; whileThey: boolean }

export function motionDetection(c: MotionChange): Detection | null {
  if (c.state === 'still') return null;
  const text = c.state === 'fidget' ? (c.whileThey ? 'Hands: fidgeting while they talk' : 'Hands: fidgeting') : 'Hands: moving';
  return { id: c.id, ts: c.ts, tone: 'body', text };
}

export const MAX_DETECTIONS = 40;

/** Everything detected so far, newest first. */
export function detections(state: Pick<BusState, 'turns' | 'marks' | 'metrics' | 'session'>, motion: MotionChange[] = []): Detection[] {
  const upper = state.metrics?.baseline_wpm != null ? upperEdge(state.metrics.baseline_wpm, state.session?.policy) : null;
  const all: Detection[] = [];
  for (const t of state.turns) all.push(...turnDetections(t, upper), ...judgeDetections(t));
  for (const m of state.marks) {
    const d = markDetection(m);
    if (d) all.push(d);
  }
  for (const c of motion) {
    const d = motionDetection(c);
    if (d) all.push(d);
  }
  // stable: by time, then the order they were added
  return all.map((d, i) => ({ d, i })).sort((a, b) => b.d.ts - a.d.ts || b.i - a.i).slice(0, MAX_DETECTIONS).map((x) => x.d);
}

/** Nudges that buzzed, oldest first: "Slow down" at 0:42. */
export function nudgeLog(marks: Mark[]): { id: string; words: string; ts: number }[] {
  return marks.filter((m) => m.kind === 'nudge').map((m) => ({ id: m.id, words: m.title, ts: m.ts }));
}

/** Split text around the filler words so the screen can light them up. */
export function splitFillers(text: string, words: string[]): { text: string; filler: boolean }[] {
  const list = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!list.length) return [{ text, filler: false }];
  const re = new RegExp(`\\b(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  return text.split(re).filter((p) => p !== '').map((p) => ({ text: p, filler: list.includes(p.toLowerCase()) }));
}

/** m:ss, or h:mm:ss past an hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
