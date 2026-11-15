/**
 * Plain-language shaping for the Coach page: what a coach listens for, and the wearer's habits,
 * in words a person reads at a glance. No ids, thresholds or condition strings reach the screen.
 * Pure; tested in coach.test.ts.
 */
import type { CoachQuestion, CoachSpec, HabitProfile, HapticPattern, NudgeRule } from '../bus/contracts';

export interface ListenLine {
  key: string;
  /** The words the phone shows: "Slow down". */
  words: string;
  haptic: HapticPattern;
  /** One plain sentence on when it happens. */
  when: string;
  /** True when it buzzes in an ordinary conversation; false when it is noted for the debrief. */
  buzzes: boolean;
}

const MAX_LINES = 5;

type Op = '>' | '>=' | '<' | '<=' | '==' | '!=';
interface Condition { scope: 'judge' | 'metrics' | 'motion'; path: string[]; op: Op; value: string }

/** "judge.hedging.p >= 0.8" -> its parts, or null for anything more complex. */
export function parseCondition(when: string): Condition | null {
  const m = when.trim().match(/^(judge|metrics|motion)\.([\w.]+)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
  if (!m) return null;
  return { scope: m[1] as Condition['scope'], path: m[2].split('.'), op: m[3] as Op, value: m[4].trim().replace(/^['"]|['"]$/g, '') };
}

const high = (op: Op) => op === '>' || op === '>=';

const METRIC: Record<string, [string, string]> = {
  wpm: ['When you start talking faster than your comfortable pace.', 'When you slow right down.'],
  monologue_s: ['When you have been talking for a long stretch without a pause for them.', 'When your turns get very short.'],
  fillers_per_min: ['When filler words start piling up.', 'When you go quiet on filler words.'],
  talk_ratio: ['When you are doing most of the talking.', 'When you are barely speaking.'],
  hand_energy: ['When your gestures get big.', 'When your hands go completely still.'],
  interruptions: ['When you keep cutting in.', 'When you hold back from cutting in.'],
  questions: ['When you have asked a lot of questions.', 'When you have not asked them anything yet.'],
  volume_db: ['When your voice gets loud.', 'When your voice drops too quiet.'],
};

const MOTION: Record<string, string> = {
  fidget_while_other_s: 'When your hands fidget while they are talking.',
  fidget_while_listening_s: 'When your hands fidget while they are talking.',
  hand_energy: 'When your gestures get big.',
  state: 'When your hands start fidgeting.',
};

/** The ten core judge questions, said both ways: [when it is true, when it is not]. */
const CORE: Record<string, [string, string]> = {
  interrupted: ['When you start talking over them.', 'When you let them finish.'],
  asked_question: ['When you ask them a question.', 'When you go a while without asking them anything.'],
  answered_the_question: ['When you answer what they asked.', 'When you drift away from what they asked.'],
  hedging: ['When you soften your point with hedges like “I think maybe”.', 'When you say things plainly.'],
  rambling: ['When an answer starts to wander.', 'When you stay on point.'],
  acknowledged: ['When you acknowledge what they said.', 'When you move on without acknowledging what they said.'],
  commitment_made: ['When you promise to do something.', 'When you leave without promising anything.'],
  clarity: ['When you explain things clearly.', 'When what you say gets hard to follow.'],
};

/** Score questions from the built-in coaches whose instructions do not read as a sentence. */
const SCORE: Record<string, string> = {
  bottom_line_first: 'When your answer arrives late instead of first.',
  listening_depth: 'When your replies skim past what they said.',
  clarity: 'When what you say gets hard to follow.',
};

const human = (id: string) => id.replace(/[_-]+/g, ' ').trim();

/** "describes" -> "describe", "has" -> "have": the verb after "you". */
function agree(verb: string): string {
  const lower = verb.toLowerCase();
  const irregular: Record<string, string> = { has: 'have', is: 'are', does: 'do', was: 'were' };
  if (irregular[lower]) return irregular[lower];
  if (/(ch|sh|ss|x|z)es$/.test(lower)) return verb.slice(0, -2);
  if (/ies$/.test(lower)) return `${verb.slice(0, -3)}y`;
  if (/[^s]s$/.test(lower)) return verb.slice(0, -1);
  return verb;
}

/**
 * The clause a judge question checks for, as a sentence about "you":
 * "Answer YES if the wearer describes an amount ... (for example ...)" -> "When you describe an amount ...".
 */
export function sentenceFromInstructions(instructions: string): string | null {
  const m = instructions.match(/answer\s+(?:yes|true)\s+(?:only\s+)?if\s+(.+?)(?:\.\s|\.$|;|$)/i);
  if (!m) return null;
  let clause = m[1]
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\bthe wearer's\b/gi, 'your')
    .replace(/\bthe other person's\b/gi, 'their')
    .replace(/\bthe other person\b/gi, 'they')
    .replace(/\bthe wearer\b\s+(\w+)/gi, (_, v: string) => `you ${agree(v)}`)
    .replace(/\bthe wearer\b/gi, 'you')
    .replace(/\s+/g, ' ')
    .trim();
  // Keep it to one easy line: stop at the first comma once the sentence already says something.
  const words = clause.split(' ');
  const but = clause.search(/,?\s+but\s/);
  if (but > 0) {
    // "tells a story ..., but never states how it turned out": the "but" carries the meaning
    const end = clause.slice(but + 5).search(/[,;]/);
    clause = end >= 0 ? clause.slice(0, but + 5 + end) : clause;
  } else if (words.length > 14) {
    const cut = clause.search(/,\s/);
    clause = cut > 20 ? clause.slice(0, cut) : words.slice(0, 14).join(' ');
  }
  if (!/^you\b|^your\b|^they\b|^their\b/i.test(clause)) return null;
  return `When ${clause.replace(/[,;:\s]+$/, '')}.`;
}

function judgeSentence(c: Condition, questions: Record<string, CoachQuestion>): string | null {
  const [id, field] = c.path;
  const q = questions[id];
  const yes = !(field === 'p' && !high(c.op));
  if (field === 'score') {
    if (SCORE[id]) return SCORE[id];
    return high(c.op) ? `When your ${human(id)} is strong.` : `When your ${human(id)} slips.`;
  }
  if (field === 'choice' || q?.type === 'choice') {
    const pick = c.value && c.value !== 'none' ? human(c.value) : null;
    return pick ? `When you come across as ${pick}.` : null;
  }
  if (q) {
    const s = sentenceFromInstructions(q.instructions);
    if (s && yes) return s;
  }
  if (CORE[id]) return CORE[id][yes ? 0 : 1];
  return null;
}

/** One plain sentence on when a rule buzzes. Falls back to a sentence built from its words. */
export function whenSentence(rule: NudgeRule, coach: Pick<CoachSpec, 'questions'>): string {
  const c = parseCondition(rule.when);
  let s: string | null = null;
  if (c?.scope === 'metrics') {
    const pair = METRIC[c.path[0]];
    s = pair ? pair[high(c.op) ? 0 : 1] : null;
  } else if (c?.scope === 'motion') {
    s = MOTION[c.path[0]] ?? null;
  } else if (c?.scope === 'judge') {
    s = judgeSentence(c, coach.questions ?? {});
  }
  return s ?? `When the coach notices it is time to ${rule.message.charAt(0).toLowerCase()}${rule.message.slice(1).replace(/[.!]+$/, '')}.`;
}

/**
 * What a coach listens for: its enabled rules, the one that buzzes first, at most five, one
 * line per distinct phrase on the phone.
 */
export function listensFor(coach: CoachSpec): ListenLine[] {
  const practice = coach.kind === 'personal';
  const focus = coach.nudge_policy?.focus_rule_id;
  const rules = [...coach.nudge_rules, ...coach.motion_rules].filter((r) => r.enabled !== false);
  rules.sort((a, b) => Number(b.id === focus) - Number(a.id === focus));
  const seen = new Set<string>();
  const lines: ListenLine[] = [];
  for (const r of rules) {
    const words = r.message.trim();
    if (!words || seen.has(words.toLowerCase())) continue;
    seen.add(words.toLowerCase());
    lines.push({ key: r.id, words, haptic: r.haptic, when: whenSentence(r, coach), buzzes: practice || r.id === focus });
    if (lines.length === MAX_LINES) break;
  }
  return lines;
}

/** The coach's goal as one sentence: the first sentence of what the builder wrote. */
export function goalSentence(goal: string): string {
  const clean = goal.replace(/\s+/g, ' ').trim();
  const m = clean.match(/^(.+?[.!?])(\s|$)/);
  const first = m ? m[1] : clean;
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** The goal cut to a short line for a list, at a word boundary. */
export function shortGoal(goal: string, max = 72): string {
  const first = goalSentence(goal);
  if (first.length <= max) return first;
  const cut = first.slice(0, max).replace(/[\s,;:]+\S*$/, '');
  return `${cut}…`;
}

// ---------- habits ----------

export type HabitDirection = 'better' | 'same' | 'worse';

export interface HabitLine {
  key: string;
  label: string;
  /** How often, in words: "A few times a conversation". */
  often: string;
  direction: HabitDirection;
  /** The direction in words: "Getting better". */
  trend: string;
}

/** `rate` is the mean number of times it came up per conversation. */
export function howOften(rate: number): string {
  if (rate >= 4) return 'Many times a conversation';
  if (rate >= 1.5) return 'A few times a conversation';
  if (rate >= 0.75) return 'About once a conversation';
  if (rate >= 0.3) return 'In some conversations';
  return 'Now and then';
}

export const TREND_WORDS: Record<HabitDirection, string> = {
  better: 'Getting better',
  same: 'Holding steady',
  worse: 'Happening more',
};

export function habitLines(profile: HabitProfile, max = 4): HabitLine[] {
  const seen = new Set<string>();
  return [...profile.recurring_issues]
    .sort((a, b) => b.rate - a.rate)
    // two rules can share a label ("Filler words"); keep the more frequent one
    .filter((r) => { const k = r.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max)
    .map((r) => ({ key: r.rule_id, label: r.label, often: howOften(r.rate), direction: r.trend, trend: TREND_WORDS[r.trend] ?? TREND_WORDS.same }));
}

/** Conversations needed before a coach built from your own habits says anything useful. */
export const PERSONAL_MIN_SESSIONS = 3;

export function canBuildPersonal(profile: HabitProfile | null): boolean {
  return profile !== null && profile.sessions >= PERSONAL_MIN_SESSIONS;
}

/** Coaches in the order the switch list shows them: active first, then built-in, then yours. */
export function orderCoaches(coaches: CoachSpec[], activeId: string | null): CoachSpec[] {
  const rank = (c: CoachSpec) => (c.id === activeId ? 0 : c.kind === 'prebuilt' ? 1 : c.kind === 'personal' ? 2 : 3);
  return [...coaches].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
