/**
 * The scripted mock session (about 100 s, then it loops). It follows plan.md section 9:
 *
 *   0-63 s   Regular mode: a case interview. Interrupting, fillers, a long answer and fidgeting
 *            appear only as quiet marks. Speeding up earns the ONE live nudge, `slow_down`.
 *            One single tap ("How am I doing?" -> talking too much), one promise bookmark,
 *            one `nerves` and one `checked_out` signal. Then the debrief.
 *   70-82 s  Practice round 1: five `filler` nudges on the wearer's crutch words.
 *   84-95 s  Practice round 2: two `filler` nudges, then one `success`. Score 5 -> 2.
 *
 * Shared verbatim between dashboard/lib/bus and mobile/src/bus.
 */
import type { BusEvent, JudgeAnswer, Metrics, MotionState, Speaker, VolumeState } from './contracts';
import { INTERVIEW_COACH, PERSONAL_COACH, PRACTICE_POLICY, REGULAR_POLICY, SAMPLE_DEBRIEF } from './sample';

export interface Scripted {
  at: number; // seconds from the start of the loop
  event: BusEvent;
}

export const REGULAR_END = 63;
export const DEBRIEF_AT = 64.5;
export const PRACTICE_1 = 70;
export const PRACTICE_2 = 84;
export const LOOP_LENGTH = 104;
export const BASELINE_WPM = 160;

type Key = [number, number];

function lerp(keys: Key[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
    }
  }
  return keys[keys.length - 1][1];
}

/** Small deterministic wobble so traces look measured, not drawn. */
function wobble(t: number, amount: number): number {
  return Math.sin(t * 2.3) * amount * 0.6 + Math.sin(t * 5.1 + 1) * amount * 0.4;
}

interface Turn {
  id: string;
  speaker: Speaker;
  start: number;
  end: number;
  text: string;
  wpm: number;
  fillers: string[];
  judge?: { results: Record<string, JudgeAnswer>; latency_ms: number };
}

const noul = (p: number): JudgeAnswer => ({ kind: 'noul', p, confidence: Math.max(p, 1 - p) });
const choice = (c: string, conf: number, others: Record<string, number>): JudgeAnswer => ({
  kind: 'choice', choice: c, probabilities: { [c]: conf, ...others }, confidence: conf,
});
const score = (s: number, conf: number): JudgeAnswer => ({ kind: 'score', score: s, max: 5, confidence: conf });

const TURNS: Turn[] = [
  { id: 't01', speaker: 'other', start: 0.6, end: 7.5, wpm: 158, fillers: [],
    text: 'Here’s the case. Our client is a regional coffee chain, about eighty stores. Profits fell twenty percent in two years. Where would you start?' },
  { id: 't02', speaker: 'me', start: 8, end: 13, wpm: 150, fillers: ['um', 'like'],
    text: 'Um, okay. Is the drop across all stores, or, like, just a few of them?',
    judge: { latency_ms: 212, results: {
      interrupted: noul(0.04), asked_question: noul(0.96), question_type: choice('closed', 0.71, { open: 0.24, leading: 0.05 }),
      hedging: noul(0.41), tone: choice('nervous', 0.62, { confident: 0.2, warm: 0.18 }), clarity: score(3.6, 0.7), commitment_made: noul(0.02),
    } } },
  { id: 't03', speaker: 'other', start: 13.6, end: 19.6, wpm: 152, fillers: [],
    text: 'Mostly the newer ones. The stores we opened in the last three years are the ones dragging, and the rent on—' },
  { id: 't04', speaker: 'me', start: 19, end: 27, wpm: 176, fillers: ['basically'],
    text: 'Right, so it’s cannibalisation. The new stores are basically stealing customers from the old ones, and that’s the whole story.',
    judge: { latency_ms: 187, results: {
      interrupted: noul(0.91), asked_question: noul(0.03), question_type: choice('none', 0.94, { closed: 0.06 }),
      hedging: noul(0.12), tone: choice('confident', 0.58, { defensive: 0.3, nervous: 0.12 }), clarity: score(3.1, 0.66),
      acknowledged: noul(0.22), commitment_made: noul(0.01),
    } } },
  { id: 't05', speaker: 'other', start: 27.8, end: 33.2, wpm: 149, fillers: [],
    text: 'Maybe. I hadn’t finished. Rent on the new sites is also far above plan. What would you want to see next?' },
  { id: 't06', speaker: 'me', start: 33.6, end: 52, wpm: 201, fillers: ['honestly', 'basically'],
    text: 'I’d split it into revenue and cost. On revenue I’d look at same-store sales, then traffic against ticket size, then the mix of drinks and food, and on cost I’d go through rent, labour and beans store by store, and honestly I think you’d find it’s the rent, because if the new sites are in premium locations then the fixed costs are way higher and the volume just isn’t there yet, and that would explain basically everything you’re seeing in the numbers.',
    judge: { latency_ms: 243, results: {
      interrupted: noul(0.03), asked_question: noul(0.05), question_type: choice('none', 0.92, { closed: 0.08 }),
      answered_the_question: noul(0.83), hedging: noul(0.84), rambling: noul(0.88),
      tone: choice('nervous', 0.74, { confident: 0.16, flat: 0.1 }), clarity: score(2.4, 0.72),
      bottom_line_first: score(2, 0.69), commitment_made: noul(0.02),
    } } },
  { id: 't07', speaker: 'other', start: 52.6, end: 56.2, wpm: 150, fillers: [],
    text: 'That’s a lot. Can you send me that breakdown as one page?' },
  { id: 't08', speaker: 'me', start: 56.6, end: 60.4, wpm: 166, fillers: [],
    text: 'Yes. I’ll send you the deck tonight.',
    judge: { latency_ms: 164, results: {
      interrupted: noul(0.02), asked_question: noul(0.02), answered_the_question: noul(0.97), hedging: noul(0.05),
      tone: choice('confident', 0.81, { warm: 0.19 }), clarity: score(4.7, 0.9), commitment_made: noul(0.95),
    } } },
];

const SEGMENTS: { from: number; to: number; state: MotionState; who: Speaker | null }[] = [
  { from: 0, to: 2, state: 'still', who: null },
  { from: 2, to: 7.8, state: 'fidget', who: 'other' },
  { from: 7.8, to: 13.5, state: 'gesture', who: 'me' },
  { from: 13.5, to: 19, state: 'still', who: 'other' },
  { from: 19, to: 27.6, state: 'gesture', who: 'me' },
  { from: 27.6, to: 33.5, state: 'still', who: 'other' },
  { from: 33.5, to: 42.5, state: 'gesture', who: 'me' },
  { from: 42.5, to: 49.5, state: 'still', who: 'me' },
  { from: 49.5, to: 52.5, state: 'gesture', who: 'me' },
  { from: 52.5, to: 56.5, state: 'still', who: 'other' },
  { from: 56.5, to: REGULAR_END, state: 'gesture', who: 'me' },
];

const ENERGY: Key[] = [
  [0, 0.3], [2, 0.66], [7, 0.68], [8.5, 0.5], [13, 0.52], [14.5, 0.18], [19, 0.15], [20.5, 0.6], [27, 0.58],
  [28.5, 0.08], [33, 0.06], [34.5, 0.5], [41, 0.46], [43, 0.1], [48.5, 0.08], [50.5, 0.42], [52, 0.45],
  [53.5, 0.28], [56, 0.3], [57.5, 0.5], [63, 0.46],
];
const TALK: Key[] = [[0, 0], [8, 0], [13, 0.42], [19, 0.3], [27, 0.52], [33.5, 0.44], [52, 0.68], [56.5, 0.64], [63, 0.66]];
const WPM: Key[] = [
  [7.9, 0], [8.5, 150], [13, 152], [19, 150], [23, 172], [27, 176], [33.5, 170], [38, 178], [42, 196],
  [46, 214], [49, 206], [52, 184], [56.5, 176], [63, 168],
];
const FILLERS: Key[] = [[8, 0], [13, 9], [19, 6.2], [27, 7.5], [33.5, 6], [52, 5.2], [63, 5]];

function speakingMe(t: number): Turn | undefined {
  return TURNS.find((x) => x.speaker === 'me' && t >= x.start && t <= x.end);
}

function metricsAt(t: number): Metrics {
  const mine = speakingMe(t);
  const loudStretch = t > 41 && t < 51;
  const volume = mine ? (loudStretch ? -12.5 : -18) + wobble(t, 1.2) : -29 + wobble(t, 1);
  const state: VolumeState = volume > -14 ? 'loud' : 'ok';
  return {
    talk_ratio: +lerp(TALK, t).toFixed(3),
    interruptions: t >= 20 ? 1 : 0,
    questions: t >= 13 ? 1 : 0,
    fillers_per_min: +lerp(FILLERS, t).toFixed(1),
    wpm: Math.max(0, Math.round(lerp(WPM, t) + (t > 8.5 ? wobble(t, 3) : 0))),
    baseline_wpm: BASELINE_WPM,
    monologue_s: mine ? +(t - mine.start).toFixed(1) : 0,
    volume_db: +volume.toFixed(1),
    volume_state: mine ? state : 'ok',
    hand_energy: +Math.min(1, Math.max(0, lerp(ENERGY, t) + wobble(t, 0.03))).toFixed(2),
  };
}

function pushTurn(out: Scripted[], turn: Turn, offset = 0): void {
  const words = turn.text.split(' ');
  const span = turn.end - turn.start;
  const steps = Math.max(2, Math.floor(span / 0.6));
  for (let i = 1; i < steps; i++) {
    const n = Math.max(1, Math.round((words.length * i) / steps));
    out.push({ at: offset + turn.start + (span * i) / steps,
      event: { type: 'transcript.partial', speaker: turn.speaker, text: words.slice(0, n).join(' ') } });
  }
  out.push({ at: offset + turn.end, event: {
    type: 'turn.final', turn_id: turn.id, speaker: turn.speaker, text: turn.text,
    start: turn.start, end: turn.end, wpm: turn.wpm, fillers: turn.fillers,
  } });
  if (turn.judge) {
    out.push({ at: offset + turn.end + turn.judge.latency_ms / 1000, event: {
      type: 'judge', turn_id: turn.id, results: turn.judge.results, latency_ms: turn.judge.latency_ms, source: 'decisions',
    } });
  }
}

function regular(out: Scripted[]): void {
  out.push({ at: 0, event: { type: 'band.status', connected: true, transport: 'ble', battery_pct: 82, mic_on: true } });
  out.push({ at: 0, event: { type: 'device.status', device_id: 'd-demo', name: 'iPhone', connected: true } });
  out.push({ at: 0, event: { type: 'coach.activated', coach: INTERVIEW_COACH } });
  out.push({ at: 0, event: { type: 'session.started', session_id: 's-mock-regular', coach_id: 'interview', mode: 'regular', policy: REGULAR_POLICY, ts: 0 } });
  for (const turn of TURNS) pushTurn(out, turn);

  for (let t = 1; t <= REGULAR_END; t++) out.push({ at: t, event: { type: 'metrics', ...metricsAt(t) } });
  for (let t = 0.5; t < REGULAR_END; t += 1) {
    const seg = SEGMENTS.find((s) => t >= s.from && t < s.to) ?? SEGMENTS[0];
    out.push({ at: t, event: {
      type: 'motion', state: seg.state, hand_energy: metricsAt(t).hand_energy, speaker_context: seg.who,
      confidence: +(0.8 + wobble(t, 0.06)).toFixed(2), ts: t,
    } });
  }

  // Quiet marks: rules that fired but are not allowed to buzz in regular mode.
  const quiet = (at: number, rule_id: string, haptic: 'still' | 'filler' | 'interrupt' | 'wrap_up', message: string, reason: string) =>
    out.push({ at, event: { type: 'nudge.quiet', rule_id, haptic, message, reason, ts: at } });
  quiet(7.2, 'fidget_listening', 'still', 'Hands calm', 'Fidgeting for 5 s while they spoke');
  quiet(13.4, 'filler', 'filler', 'Pause', '“um” and “like” in one short question');
  quiet(27.4, 'interrupt', 'interrupt', 'Let them finish', 'Started 0.6 s before they stopped');
  quiet(49.8, 'long_turn', 'wrap_up', 'Ask a question', 'Speaking for 16 s without a pause');

  out.push({ at: 30.5, event: { type: 'bookmark', source: 'phone', text: null, ts: 30.5 } });
  out.push({ at: 33, event: { type: 'signal', kind: 'checked_out', detail: 'Hands still and no question while they spoke for 5 s', ts: 33 } });
  out.push({ at: 44.6, event: { type: 'signal', kind: 'nerves', detail: 'Hands froze and pace jumped 31% inside 10 s', ts: 44.6 } });

  // The one live nudge of the conversation.
  out.push({ at: 46.2, event: {
    type: 'nudge', rule_id: 'pace', haptic: 'slow_down', message: 'Slow down',
    reason: '214 wpm, your normal is 160', confidence: null, latency_ms: 1180, budget_left: 2, ts: 46.2,
  } });

  // Single tap on the band: "How am I doing?"
  out.push({ at: 54, event: { type: 'status.reply', verdict: 'talking_too_much', haptic: 'status_talking', ts: 54 } });

  out.push({ at: 61, event: { type: 'bookmark', source: 'promise', text: 'I’ll send you the deck tonight.', ts: 61 } });
  out.push({ at: REGULAR_END, event: { type: 'band.status', connected: true, transport: 'ble', battery_pct: 81, mic_on: false } });
  out.push({ at: REGULAR_END, event: { type: 'session.ended', session_id: 's-mock-regular' } });
  out.push({ at: DEBRIEF_AT, event: { type: 'debrief', session_id: 's-mock-regular', data: SAMPLE_DEBRIEF, audio_url: null } });
}

interface Round {
  start: number;
  id: string;
  text: string;
  /** [seconds into the round, the crutch word] */
  slips: [number, string][];
  success?: { at: number; reason: string };
  length: number;
}

const ROUNDS: Round[] = [
  { start: PRACTICE_1, id: 'p1', length: 12,
    text: 'So, basically, I’m a second-year studying economics, and I, like, got into consulting through a case club. Basically I enjoy problems that are, like, messy, and basically I want to do that full time.',
    slips: [[2.1, 'basically'], [4.6, 'like'], [6.4, 'basically'], [8.3, 'like'], [9.9, 'basically']] },
  { start: PRACTICE_2, id: 'p2', length: 11,
    text: 'I’m a second-year studying economics. I got into consulting through a case club. I enjoy, like, messy problems. I want to do that full time, basically.',
    slips: [[5.2, 'like'], [8.6, 'basically']],
    success: { at: 9.8, reason: '5 crutch words, then 2' } },
];

function practice(out: Scripted[], round: Round): void {
  const t0 = round.start;
  if (round.id === 'p1') out.push({ at: t0 - 0.2, event: { type: 'coach.activated', coach: PERSONAL_COACH } });
  out.push({ at: t0 - 0.1, event: { type: 'band.status', connected: true, transport: 'ble', battery_pct: 81, mic_on: true } });
  out.push({ at: t0, event: { type: 'session.started', session_id: `s-mock-${round.id}`, coach_id: 'personal', mode: 'practice', policy: PRACTICE_POLICY, ts: 0 } });
  const speakEnd = round.length - 1.6;
  pushTurn(out, { id: `${round.id}-t1`, speaker: 'me', start: 1, end: speakEnd, text: round.text, wpm: 156,
    fillers: round.slips.map((s) => s[1]) }, t0);
  for (const [dt, word] of round.slips) {
    out.push({ at: t0 + dt, event: {
      type: 'nudge', rule_id: 'crutch', haptic: 'filler', message: 'Pause', reason: `You said “${word}”`,
      confidence: null, latency_ms: 640 + Math.round(Math.abs(wobble(dt, 260))), budget_left: 99, ts: dt,
    } });
  }
  for (let s = 1; s < round.length; s++) {
    const slipsSoFar = round.slips.filter((x) => x[0] <= s).length;
    out.push({ at: t0 + s, event: {
      type: 'metrics', talk_ratio: 1, interruptions: 0, questions: 0,
      fillers_per_min: +((slipsSoFar / Math.max(s, 4)) * 60).toFixed(1),
      wpm: Math.round(154 + wobble(s, 5)), baseline_wpm: BASELINE_WPM, monologue_s: s < speakEnd ? s - 1 : 0,
      volume_db: +(-18 + wobble(s, 1.2)).toFixed(1), volume_state: 'ok', hand_energy: +(0.48 + wobble(s, 0.06)).toFixed(2),
    } });
    out.push({ at: t0 + s + 0.5, event: {
      type: 'motion', state: 'gesture', hand_energy: +(0.48 + wobble(s + 0.5, 0.06)).toFixed(2),
      speaker_context: 'me', confidence: 0.82, ts: s + 0.5,
    } });
  }
  if (round.success) {
    out.push({ at: t0 + round.success.at, event: {
      type: 'nudge', rule_id: 'round_improved', haptic: 'success', message: 'Cleaner round', reason: round.success.reason,
      confidence: null, latency_ms: 710, budget_left: 99, ts: round.success.at,
    } });
  }
  out.push({ at: t0 + round.length - 0.05, event: { type: 'band.status', connected: true, transport: 'ble', battery_pct: 81, mic_on: false } });
  out.push({ at: t0 + round.length, event: { type: 'session.ended', session_id: `s-mock-${round.id}` } });
}

export function buildScript(): Scripted[] {
  const out: Scripted[] = [];
  regular(out);
  for (const round of ROUNDS) practice(out, round);
  return out.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map((x) => x.e);
}
