/**
 * Phone-only mock of ALWAYS-ON listening (`?demo=1&always=1` on web, or the Director panel's
 * "Always-on demo" switch). No network. One cycle, then it loops with a fresh session id:
 *
 *    0 s   band connected, mic on, always_on: true. Idle: "Listening".
 *    8 s   a conversation opens by itself (no tap): session.started.
 *   10-27  a short hallway chat; one live `slow_down` nudge at 21 s.
 *   29 s   it closes by itself: session.ended. Back to listening.
 *   32 s   the debrief arrives: in-app notice; History gains the conversation.
 *   46 s   loop (no view reset, so History keeps growing like a real day).
 *
 * The shared mock (mock-source.ts) stays verbatim with the dashboard; this file is not synced.
 */
import type { BusEvent, Debrief, HapticPattern, Speaker } from './contracts';
import type { Scripted } from './mock-script';
import { PATTERNS } from './patterns';
import { INTERVIEW_COACH, REGULAR_POLICY, SAMPLE_DEBRIEF } from './sample';
import type { BusSource, DirectorCommand, SourceHandlers } from './types';

export const AO_OPEN_AT = 8;
export const AO_CLOSE_AT = 29;
export const AO_DEBRIEF_AT = 32;
export const AO_LOOP = 46;
const BASELINE = 160;

/** `always_on` is the proposed optional field on band.status; the shared contract type lacks it. */
function band(mic_on: boolean, battery_pct: number): BusEvent {
  return { type: 'band.status', connected: true, transport: 'ble', battery_pct, mic_on, always_on: true } as BusEvent;
}

export const AO_LINES: { speaker: Speaker; start: number; end: number; wpm: number; fillers: string[]; text: string }[] = [
  { speaker: 'other', start: 1, end: 4.5, wpm: 150, fillers: [], text: 'Hey, have you got a minute about the launch slides?' },
  { speaker: 'me', start: 5, end: 13.5, wpm: 205, fillers: ['basically'], text: 'Sure, so basically the deck is done but I want to move the pricing slide up and cut the two competitor pages because nobody reads them.' },
  { speaker: 'other', start: 14, end: 16.5, wpm: 148, fillers: [], text: 'Makes sense. Can I see it before four?' },
  { speaker: 'me', start: 17, end: 19.5, wpm: 162, fillers: [], text: 'Yes. I’ll send it by three.' },
];

export const AO_DEBRIEF: Debrief = {
  ...SAMPLE_DEBRIEF,
  headline_fact: 'A 21-second hallway chat: you hit 205 wpm explaining the deck, then slowed right down.',
  numbers: { talk_ratio: 0.64, interruptions: 0, questions: 0, fillers_per_min: 2.9, wpm: 184 },
  vs_last_time: null,
};

function conversation(n: number): Scripted[] {
  const id = `s-ao-${n}`;
  const t0 = AO_OPEN_AT;
  const out: Scripted[] = [
    { at: t0, event: { type: 'session.started', session_id: id, coach_id: INTERVIEW_COACH.id, mode: 'regular', policy: REGULAR_POLICY, ts: 0 } },
  ];
  AO_LINES.forEach((line, i) => {
    const words = line.text.split(' ');
    const steps = Math.max(2, Math.floor((line.end - line.start) / 0.6));
    for (let k = 1; k < steps; k++) {
      out.push({ at: t0 + line.start + ((line.end - line.start) * k) / steps,
        event: { type: 'transcript.partial', speaker: line.speaker, text: words.slice(0, Math.max(1, Math.round((words.length * k) / steps))).join(' ') } });
    }
    out.push({ at: t0 + line.end, event: { type: 'turn.final', turn_id: `${id}-t${i + 1}`, speaker: line.speaker, text: line.text, start: line.start, end: line.end, wpm: line.wpm, fillers: line.fillers } });
  });
  for (let s = 1; s <= AO_CLOSE_AT - t0 - 1; s++) {
    const mine = AO_LINES.find((l) => l.speaker === 'me' && s >= l.start && s <= l.end);
    out.push({ at: t0 + s, event: {
      type: 'metrics', talk_ratio: s < 5 ? 0 : 0.64, interruptions: 0, questions: 0, fillers_per_min: s < 6 ? 0 : 2.9,
      wpm: mine ? mine.wpm : s < 5 ? 0 : 184, baseline_wpm: BASELINE, monologue_s: mine ? s - mine.start : 0,
      volume_db: mine ? -18 : -29, volume_state: 'ok', hand_energy: mine ? 0.5 : 0.2,
    } });
  }
  out.push({ at: t0 + 13, event: {
    type: 'nudge', rule_id: 'pace', haptic: 'slow_down', message: 'Slow down', reason: '205 wpm, your normal is 160',
    confidence: null, latency_ms: 1040, budget_left: 2, ts: 13,
  } });
  out.push({ at: t0 + 19.6, event: { type: 'bookmark', source: 'promise', text: 'I’ll send it by three.', ts: 19.6 } });
  out.push({ at: AO_CLOSE_AT, event: { type: 'session.ended', session_id: id } });
  out.push({ at: AO_DEBRIEF_AT, event: { type: 'debrief', session_id: id, data: AO_DEBRIEF, audio_url: null } });
  return out;
}

export function buildAlwaysOnCycle(n: number): Scripted[] {
  return [{ at: 0, event: band(true, 84) }, ...conversation(n)].sort((a, b) => a.at - b.at);
}

export interface AlwaysOnOptions { startAt?: number; speed?: number }

export function createAlwaysOnMockSource(options: AlwaysOnOptions = {}): BusSource {
  const speed = options.speed && options.speed > 0 ? options.speed : 1;
  let handlers: SourceHandlers | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cycle = 1;
  let script = buildAlwaysOnCycle(cycle);
  let origin = 0;
  let index = 0;
  let open: { id: string; startedAt: number } | null = null;
  let budget = REGULAR_POLICY.budget_per_session;

  const now = () => Date.now();
  const loopTime = () => ((now() - origin) / 1000) * speed;
  const sessionTs = () => (open ? +((now() - open.startedAt) / 1000).toFixed(1) : 0);

  function emit(event: BusEvent): void {
    if (event.type === 'session.started') { open = { id: event.session_id, startedAt: now() }; budget = event.policy.budget_per_session; }
    if (event.type === 'session.ended') open = null;
    if (event.type === 'nudge') budget = event.budget_left;
    handlers?.onEvent(event);
  }

  function clear(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(): void {
    clear();
    if (!handlers) return;
    if (index >= script.length) {
      timer = setTimeout(() => nextCycle(), Math.max(0, ((AO_LOOP - loopTime()) * 1000) / speed));
      return;
    }
    const due = origin + (script[index].at * 1000) / speed;
    timer = setTimeout(() => {
      const t = loopTime();
      while (index < script.length && script[index].at <= t + 0.005) emit(script[index++].event);
      schedule();
    }, Math.max(0, due - now()));
  }

  /** Move the clock to `t` without replaying what came before (the view keeps its history). */
  function jump(t: number): void {
    clear();
    origin = now() - (t * 1000) / speed;
    index = script.findIndex((s) => s.at >= t);
    if (index < 0) index = script.length;
    schedule();
  }

  function nextCycle(): void {
    cycle += 1;
    script = buildAlwaysOnCycle(cycle);
    jump(0);
  }

  function nudge(pattern: HapticPattern): void {
    if (!open) return; // always-on: nothing buzzes between conversations
    budget = Math.max(0, budget - 1);
    emit({ type: 'nudge', rule_id: pattern === 'slow_down' ? 'pace' : pattern, haptic: pattern, message: PATTERNS[pattern].action,
      reason: 'Fired from the director panel', confidence: null, latency_ms: 900, budget_left: budget, ts: sessionTs() });
  }

  function send(command: DirectorCommand): void {
    switch (command.cmd) {
      case 'replay': handlers?.onReset?.(); cycle += 1; script = buildAlwaysOnCycle(cycle); return jump(0);
      case 'seek': return jump(Math.max(0, Math.min(AO_LOOP, command.t)));
      case 'start': return open ? undefined : jump(AO_OPEN_AT); // "a conversation opens now"
      case 'stop': return open ? jump(AO_CLOSE_AT) : undefined; // "it closes now"
      case 'debrief': return jump(open ? AO_CLOSE_AT : AO_DEBRIEF_AT);
      case 'nudge': return nudge(command.pattern);
      case 'status': {
        const haptic = command.verdict === 'good' ? 'status_good' : command.verdict === 'talking_too_much' ? 'status_talking' : 'status_ask';
        return emit({ type: 'status.reply', verdict: command.verdict, haptic, ts: sessionTs() });
      }
      case 'bookmark': return open ? emit({ type: 'bookmark', source: 'phone', text: null, ts: sessionTs() }) : undefined;
      case 'signal':
        return emit({ type: 'signal', kind: command.kind, ts: sessionTs(), detail: command.kind === 'nerves' ? 'Hands froze and pace jumped 28% inside 10 s' : 'Hands still and no question while they spoke for 20 s' });
      case 'motion':
        return emit({ type: 'motion', state: command.state, speaker_context: 'me', confidence: 0.84, ts: sessionTs(),
          hand_energy: command.state === 'still' ? 0.06 : command.state === 'gesture' ? 0.5 : 0.82 });
    }
  }

  return {
    kind: 'mock',
    start(h) {
      handlers = h;
      h.onStatus('mock');
      emit(band(true, 84));
      emit({ type: 'device.status', device_id: 'd-demo', name: 'iPhone', connected: true });
      emit({ type: 'coach.activated', coach: INTERVIEW_COACH });
      const t = Math.max(0, Math.min(AO_LOOP, options.startAt ?? 0));
      // starting mid-conversation: open it first so the view is not stranded
      if (t > AO_OPEN_AT && t < AO_CLOSE_AT) jump(AO_OPEN_AT); else jump(t);
    },
    stop() {
      clear();
      handlers = null;
    },
    send,
  };
}
