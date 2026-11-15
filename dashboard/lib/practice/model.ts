/**
 * Spoken practice with the coach: the wire shapes (mirrored from the "spoken practice" section of
 * contracts/events.ts), their boundary checks, and the plain-word helpers the screens use.
 * A measure that could not be taken is null and is left out on screen, never shown as zero.
 * Pure: no fetch, no React, no audio. Tested in model.test.ts.
 */

// ---------- wire shapes ----------
export type PracticeMeasure = 'pace' | 'fillers' | 'conciseness' | 'structure' | 'confidence' | 'responsiveness';
export type PracticeScoreSource = 'measured' | 'judged' | 'rules';
export type PracticeJudge = 'gemini' | 'rules';
export type PracticeSpeaker = 'coach' | 'you' | 'thinking' | 'waiting';
export type PracticeErrorCode = 'no_key' | 'agent_refused' | 'agent_lost' | 'mic_silent' | 'busy' | 'bad_message';

export type PracticeClientMessage = { type: 'playback_done' } | { type: 'end' };

export type PracticeServerMessage =
  | { type: 'practice.ready'; coach_name: string; planned_questions: number; previous_goals: PracticeGoal[] }
  | { type: 'practice.state'; state: PracticeSpeaker }
  | { type: 'practice.caption'; role: 'coach' | 'you'; text: string; question: number | null }
  | { type: 'practice.warning'; code: 'mic_quiet'; message: string }
  | { type: 'practice.scoring' }
  | { type: 'practice.result'; result: PracticeResult }
  | { type: 'practice.no_result'; message: string }
  | { type: 'practice.error'; code: PracticeErrorCode; message: string };

export interface PracticeAnswer {
  index: number;
  question: string;
  text: string;
  words: number;
  speaking_s: number | null;
  wpm: number | null;
  fillers: string[];
  fillers_per_min: number | null;
  hedges: string[];
  long_pauses: number | null;
  time_to_start_s: number | null;
}

export interface PracticeTotals {
  answers: number;
  words: number;
  speaking_s: number | null;
  wpm: number | null;
  filler_count: number;
  fillers_per_min: number | null;
  top_fillers: string[];
  hedges: number;
  long_pauses: number | null;
  mean_answer_s: number | null;
  mean_time_to_start_s: number | null;
}

export interface PracticeSubScore {
  measure: PracticeMeasure;
  label: string;
  score: number;
  source: PracticeScoreSource;
  detail: string;
}

export interface PracticeStrength {
  title: string;
  detail: string;
  from_answer: number | null;
}

export interface PracticeGoal {
  measure: PracticeMeasure;
  title: string;
  target: string;
  target_min: number | null;
  target_max: number | null;
  unit: string | null;
  actual: number | null;
  from_answer: number | null;
  evidence: string | null;
}

export interface PracticeGoalCheck {
  goal: PracticeGoal;
  now: number | null;
  met: boolean | null;
  detail: string;
}

export interface PracticeResult {
  id: string;
  coach_id: string;
  coach_name: string;
  started_at: string;
  duration_s: number;
  overall: number;
  summary: string;
  sub_scores: PracticeSubScore[];
  strengths: PracticeStrength[];
  goals: PracticeGoal[];
  previous_goals: PracticeGoalCheck[];
  answers: PracticeAnswer[];
  totals: PracticeTotals;
  judged_by: PracticeJudge;
  ended_early: boolean;
}

export interface PracticeResultSummary {
  id: string;
  coach_name: string;
  started_at: string;
  duration_s: number;
  overall: number;
  answers: number;
  goals_met: number | null;
  goals_checked: number;
}

export interface PracticeGoals {
  result_id: string | null;
  started_at: string | null;
  coach_name: string | null;
  overall: number | null;
  goals: PracticeGoal[];
}

// ---------- boundary checks ----------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);
const isStrOrNull = (v: unknown): boolean => v === null || isStr(v);
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isListOf = <T,>(v: unknown, item: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.every(item);

const MEASURES: readonly PracticeMeasure[] = ['pace', 'fillers', 'conciseness', 'structure', 'confidence', 'responsiveness'];
const SOURCES: readonly PracticeScoreSource[] = ['measured', 'judged', 'rules'];
const SPEAKERS: readonly PracticeSpeaker[] = ['coach', 'you', 'thinking', 'waiting'];
const ERROR_CODES: readonly PracticeErrorCode[] = ['no_key', 'agent_refused', 'agent_lost', 'mic_silent', 'busy', 'bad_message'];
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => isStr(v) && (list as readonly string[]).includes(v);

export function isPracticeGoal(v: unknown): v is PracticeGoal {
  return isObj(v) && oneOf(MEASURES, v.measure) && isStr(v.title) && isStr(v.target)
    && isNumOrNull(v.target_min) && isNumOrNull(v.target_max) && isStrOrNull(v.unit)
    && isNumOrNull(v.actual) && isNumOrNull(v.from_answer) && isStrOrNull(v.evidence);
}

export function isPracticeGoalCheck(v: unknown): v is PracticeGoalCheck {
  return isObj(v) && isPracticeGoal(v.goal) && isNumOrNull(v.now) && (v.met === null || typeof v.met === 'boolean') && isStr(v.detail);
}

export function isPracticeSubScore(v: unknown): v is PracticeSubScore {
  return isObj(v) && oneOf(MEASURES, v.measure) && isStr(v.label) && isNum(v.score) && oneOf(SOURCES, v.source) && isStr(v.detail);
}

export function isPracticeStrength(v: unknown): v is PracticeStrength {
  return isObj(v) && isStr(v.title) && isStr(v.detail) && isNumOrNull(v.from_answer);
}

function isAnswer(v: unknown): v is PracticeAnswer {
  return isObj(v) && isNum(v.index) && isStr(v.question) && isStr(v.text) && isNum(v.words)
    && isNumOrNull(v.wpm) && isStrList(v.fillers) && isNumOrNull(v.fillers_per_min);
}

function isTotals(v: unknown): v is PracticeTotals {
  return isObj(v) && isNum(v.answers) && isNum(v.words) && isNumOrNull(v.wpm) && isNum(v.filler_count) && isStrList(v.top_fillers);
}

export function isPracticeResult(v: unknown): v is PracticeResult {
  return isObj(v) && isStr(v.id) && isStr(v.coach_name) && isStr(v.started_at) && isNum(v.duration_s)
    && isNum(v.overall) && isStr(v.summary)
    && isListOf(v.sub_scores, isPracticeSubScore) && isListOf(v.strengths, isPracticeStrength)
    && isListOf(v.goals, isPracticeGoal) && isListOf(v.previous_goals, isPracticeGoalCheck)
    && isListOf(v.answers, isAnswer) && isTotals(v.totals) && typeof v.ended_early === 'boolean';
}

export function isPracticeResultSummary(v: unknown): v is PracticeResultSummary {
  return isObj(v) && isStr(v.id) && isStr(v.coach_name) && isStr(v.started_at) && isNum(v.duration_s)
    && isNum(v.overall) && isNum(v.answers) && isNumOrNull(v.goals_met) && isNum(v.goals_checked);
}

export const isPracticeResultList = (v: unknown): v is PracticeResultSummary[] => isListOf(v, isPracticeResultSummary);

export function isPracticeGoals(v: unknown): v is PracticeGoals {
  return isObj(v) && isStrOrNull(v.result_id) && isStrOrNull(v.started_at) && isStrOrNull(v.coach_name)
    && isNumOrNull(v.overall) && isListOf(v.goals, isPracticeGoal);
}

/** One JSON text frame from /ws/practice, or null when it is not a message this page knows. */
export function parseServerMessage(text: string): PracticeServerMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  return isServerMessage(v) ? v : null;
}

function isServerMessage(v: unknown): v is PracticeServerMessage {
  if (!isObj(v) || !isStr(v.type)) return false;
  switch (v.type) {
    case 'practice.ready':
      return isStr(v.coach_name) && isNum(v.planned_questions) && isListOf(v.previous_goals, isPracticeGoal);
    case 'practice.state':
      return oneOf(SPEAKERS, v.state);
    case 'practice.caption':
      return (v.role === 'coach' || v.role === 'you') && isStr(v.text) && isNumOrNull(v.question);
    case 'practice.warning':
      return isStr(v.code) && isStr(v.message);
    case 'practice.scoring':
      return true;
    case 'practice.result':
      return isPracticeResult(v.result);
    case 'practice.no_result':
      return isStr(v.message);
    case 'practice.error':
      return oneOf(ERROR_CODES, v.code) && isStr(v.message);
    default:
      return false;
  }
}

// ---------- plain words ----------
/** Where a sub-score came from, in words. */
export function sourceWords(source: PracticeScoreSource): string {
  if (source === 'judged') return 'Coach’s judgement';
  if (source === 'rules') return 'Estimated from your answers';
  return 'From your numbers';
}

export type CheckTone = 'met' | 'not_yet' | 'unknown';

/** Last time's goal, checked this time. */
export function checkWords(met: boolean | null): { tone: CheckTone; word: string } {
  if (met === true) return { tone: 'met', word: 'Met' };
  if (met === false) return { tone: 'not_yet', word: 'Not yet' };
  return { tone: 'unknown', word: 'Couldn’t measure' };
}

/** "Question 2 of about 5"; before the first question, "Getting started". */
export function questionWords(question: number | null, planned: number | null): string {
  if (question === null || question < 1) return 'Getting started';
  if (planned === null || planned < 1 || question > planned) return `Question ${question}`;
  return `Question ${question} of about ${planned}`;
}

/** "about 4 minutes", "under a minute". */
export function durationWords(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return 'under a minute';
  const min = Math.round(seconds / 60);
  return min === 1 ? 'about a minute' : `about ${min} minutes`;
}

const DAY_MS = 86_400_000;

/** "Today", "Yesterday", "3 days ago", or a short date. Empty when the date is unreadable. */
export function dayWords(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const start = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((start(now) - start(t)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export type ScoreBand = 'high' | 'mid' | 'low';

export function scoreBand(score: number): ScoreBand {
  if (score >= 70) return 'high';
  if (score >= 45) return 'mid';
  return 'low';
}

/** A few words that go with the overall score. */
export function scoreWords(score: number): string {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Strong';
  if (score >= 55) return 'Solid';
  if (score >= 40) return 'Getting there';
  return 'A starting point';
}

/** Clamp a score to 0-100 for drawing. */
export const clampScore = (v: number): number => Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0));

/** Overall scores oldest first, for the trend line (the list arrives newest first). */
export function trendValues(list: readonly PracticeResultSummary[]): number[] {
  return [...list].reverse().map((r) => clampScore(r.overall));
}

/** The trend line's vertical range: the scores' own range with room around it, inside 0-100. */
export function trendDomain(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 100];
  const lo = Math.max(0, Math.min(...values) - 10);
  const hi = Math.min(100, Math.max(...values) + 10);
  return [lo, hi];
}

/** The trend in words for screen readers. */
export function trendWords(values: readonly number[]): string {
  if (values.length < 2) return 'Not enough practices for a trend yet';
  const first = values[0];
  const last = values[values.length - 1];
  const diff = last - first;
  if (Math.abs(diff) < 3) return `Your scores have held steady over ${values.length} practices`;
  return diff > 0 ? `Your scores have gone up over ${values.length} practices` : `Your scores have gone down over ${values.length} practices`;
}

/** "Earlier goals: 2 of 3 met", or null when none were checked. */
export function goalsMetWords(s: PracticeResultSummary): string | null {
  if (s.goals_met === null || s.goals_checked < 1) return null;
  return `${s.goals_met} of ${s.goals_checked} earlier goals met`;
}

const QUOTES = /[“”"‘’]/;

/** Evidence as shown: wrapped in quotes unless it already quotes what was heard. Null when blank. */
export function evidenceWords(evidence: string | null): string | null {
  const e = evidence?.trim() ?? '';
  if (!e) return null;
  return QUOTES.test(e) ? e : `“${e}”`;
}

/** Where a goal or strength came from: "From answer 3". */
export function fromAnswerWords(n: number | null): string | null {
  return n === null || n < 1 ? null : `From answer ${n}`;
}
