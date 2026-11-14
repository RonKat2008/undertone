import type { BusEvent, HapticCommand, HapticPattern, MotionState, SessionMode } from './contracts';

/** Things the director panel (and the Start/Stop, Bookmark buttons) can ask a source to do. */
export type DirectorCommand =
  | { cmd: 'start'; mode: SessionMode }
  | { cmd: 'stop' }
  | { cmd: 'nudge'; pattern: HapticPattern }
  | { cmd: 'status'; verdict: 'good' | 'talking_too_much' | 'ask_question' }
  | { cmd: 'bookmark' }
  | { cmd: 'signal'; kind: 'nerves' | 'checked_out' }
  | { cmd: 'motion'; state: MotionState }
  | { cmd: 'debrief' }
  | { cmd: 'replay' }
  | { cmd: 'seek'; t: number };

export type SourceStatus = 'mock' | 'connecting' | 'live' | 'offline';

export interface SourceHandlers {
  /** `at` is the wall-clock ms the event happened (defaults to now). */
  onEvent(event: BusEvent, at?: number): void;
  onStatus(status: SourceStatus): void;
  /** Phone only: a haptic command from /ws/device. */
  onHaptic?(cmd: HapticCommand): void;
  /** The source restarted its story (mock loop): clear view state. */
  onReset?(): void;
}

/** The one interface both the mock feed and the live socket implement. */
export interface BusSource {
  readonly kind: 'mock' | 'socket';
  start(handlers: SourceHandlers): void;
  stop(): void;
  send(command: DirectorCommand): void;
}
