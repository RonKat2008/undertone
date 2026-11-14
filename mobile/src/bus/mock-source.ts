/**
 * Plays the scripted session on a loop. No network. Also answers director commands by
 * making up the matching events, so every screen can be rehearsed without a backend.
 * Shared verbatim between dashboard/lib/bus and mobile/src/bus.
 */
import type { BusEvent, HapticPattern } from './contracts';
import { DEBRIEF_AT, LOOP_LENGTH, PRACTICE_1, REGULAR_END, buildScript, type Scripted } from './mock-script';
import { PATTERNS } from './patterns';
import { PRACTICE_POLICY, REGULAR_POLICY, SAMPLE_DEBRIEF } from './sample';
import type { BusSource, DirectorCommand, SourceHandlers } from './types';

export interface MockOptions {
  /** Start this many seconds into the loop. */
  startAt?: number;
  /** After seeking, stop the clock (for screenshots). */
  freeze?: boolean;
  speed?: number;
}

const REASONS: Partial<Record<HapticPattern, string>> = {
  slow_down: '214 wpm, your normal is 160',
  interrupt: 'Started 0.6 s before they stopped',
  filler: 'You said “basically”',
  wrap_up: 'Speaking for 48 s without a pause',
  still: 'Fidgeting for 9 s while they spoke',
  success: 'A full answer with no crutch words',
};

export function createMockSource(options: MockOptions = {}): BusSource {
  const script: Scripted[] = buildScript();
  const speed = options.speed && options.speed > 0 ? options.speed : 1;
  let handlers: SourceHandlers | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin = 0; // wall ms at loop time 0
  let index = 0;
  let frozenAt: number | null = null;
  let budget = 3;
  let sessionOpen = false;
  let manualSessionStart: number | null = null;

  const now = () => Date.now();
  const loopTime = () => (frozenAt !== null ? frozenAt : ((now() - origin) / 1000) * speed);
  /** Seconds since the current session started, for events the director injects. */
  const sessionTs = () => {
    if (manualSessionStart !== null) return +((now() - manualSessionStart) / 1000).toFixed(1);
    const t = loopTime();
    const base = t >= PRACTICE_1 ? (t >= PRACTICE_1 + 14 ? PRACTICE_1 + 14 : PRACTICE_1) : 0;
    return +Math.max(0, t - base).toFixed(1);
  };

  function emit(event: BusEvent, at?: number): void {
    if (event.type === 'session.started') { sessionOpen = true; budget = event.policy.budget_per_session; }
    if (event.type === 'session.ended') sessionOpen = false;
    if (event.type === 'nudge') budget = event.budget_left;
    handlers?.onEvent(event, at);
  }

  function clear(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(): void {
    clear();
    if (frozenAt !== null || handlers === null) return;
    if (index >= script.length) {
      const wait = ((LOOP_LENGTH - loopTime()) * 1000) / speed;
      timer = setTimeout(() => seek(0), Math.max(0, wait));
      return;
    }
    const due = origin + (script[index].at * 1000) / speed;
    timer = setTimeout(() => {
      const t = loopTime();
      while (index < script.length && script[index].at <= t + 0.005) {
        emit(script[index].event);
        index++;
      }
      schedule();
    }, Math.max(0, due - now()));
  }

  function seek(t: number, freeze = false): void {
    clear();
    manualSessionStart = null;
    frozenAt = null;
    handlers?.onReset?.();
    origin = now() - (t * 1000) / speed;
    index = 0;
    while (index < script.length && script[index].at <= t) {
      emit(script[index].event, origin + (script[index].at * 1000) / speed);
      index++;
    }
    if (freeze) frozenAt = t;
    schedule();
  }

  /** Stop following the script; the director is driving now. */
  function goManual(): void {
    clear();
    index = script.length;
    frozenAt = loopTime();
  }

  function send(command: DirectorCommand): void {
    switch (command.cmd) {
      case 'replay':
        return seek(0);
      case 'seek':
        return seek(command.t);
      case 'start': {
        if (command.mode === 'practice') return seek(PRACTICE_1 - 0.3);
        return seek(0);
      }
      case 'stop': {
        if (!sessionOpen) return;
        const regular = loopTime() < PRACTICE_1 - 1 && manualSessionStart === null;
        goManual();
        emit({ type: 'band.status', connected: true, transport: 'ble', battery_pct: 81, mic_on: false });
        emit({ type: 'session.ended', session_id: 's-mock' });
        if (regular) emit({ type: 'debrief', session_id: 's-mock-regular', data: SAMPLE_DEBRIEF, audio_url: null });
        return;
      }
      case 'debrief':
        return seek(DEBRIEF_AT + 0.1, true);
      case 'nudge': {
        const spec = PATTERNS[command.pattern];
        if (!sessionOpen) {
          goManual();
          manualSessionStart = now();
          emit({ type: 'session.started', session_id: 's-mock-director', coach_id: 'interview', mode: 'regular', policy: REGULAR_POLICY, ts: 0 });
        }
        budget = Math.max(0, budget - 1);
        return emit({
          type: 'nudge', rule_id: command.pattern === 'slow_down' ? 'pace' : command.pattern, haptic: command.pattern,
          message: spec.action, reason: REASONS[command.pattern] ?? 'Fired from the director panel',
          confidence: command.pattern === 'interrupt' ? 0.91 : null, latency_ms: 900 + Math.round(Math.random() * 500),
          budget_left: budget, ts: sessionTs(),
        });
      }
      case 'status': {
        const haptic = command.verdict === 'good' ? 'status_good' : command.verdict === 'talking_too_much' ? 'status_talking' : 'status_ask';
        return emit({ type: 'status.reply', verdict: command.verdict, haptic, ts: sessionTs() });
      }
      case 'bookmark':
        return emit({ type: 'bookmark', source: 'phone', text: null, ts: sessionTs() });
      case 'signal':
        return emit({
          type: 'signal', kind: command.kind, ts: sessionTs(),
          detail: command.kind === 'nerves' ? 'Hands froze and pace jumped 28% inside 10 s' : 'Hands still and no question while they spoke for 20 s',
        });
      case 'motion':
        return emit({
          type: 'motion', state: command.state, speaker_context: 'me', confidence: 0.84, ts: sessionTs(),
          hand_energy: command.state === 'still' ? 0.06 : command.state === 'gesture' ? 0.5 : 0.82,
        });
    }
  }

  return {
    kind: 'mock',
    start(h) {
      handlers = h;
      h.onStatus('mock');
      seek(options.startAt ?? 0, options.freeze ?? false);
    },
    stop() {
      clear();
      handlers = null;
    },
    send,
  };
}

export { REGULAR_END, PRACTICE_POLICY };
