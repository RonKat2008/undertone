/**
 * The practice session as the screen sees it: a reducer over the socket's messages and the
 * page's own events (start, mic refused, socket closed). Immutable; tested in session.test.ts.
 */
import type { PracticeErrorCode, PracticeGoal, PracticeResult, PracticeServerMessage, PracticeSpeaker } from './model';

export type PracticePhase = 'before' | 'connecting' | 'live' | 'scoring' | 'result' | 'no_result' | 'error';

/** Failures the page itself detects, besides the backend's own codes. */
export type LocalFailure = 'insecure' | 'mic_denied' | 'no_mic' | 'mic_failed' | 'unreachable' | 'closed';
export type FailureCode = PracticeErrorCode | LocalFailure;

export interface Caption {
  key: number;
  role: 'coach' | 'you';
  text: string;
  question: number | null;
}

export interface PracticeSession {
  phase: PracticePhase;
  speaker: PracticeSpeaker;
  coachName: string | null;
  planned: number | null;
  question: number | null;
  /** The coach's latest words (the question on screen). */
  coachLine: string | null;
  captions: Caption[];
  previousGoals: PracticeGoal[];
  warning: string | null;
  result: PracticeResult | null;
  noResult: string | null;
  failure: FailureCode | null;
  /** The address tried, for "can't reach" messages. */
  address: string | null;
  /** The wearer pressed End; waiting for the score. */
  ending: boolean;
}

export const MAX_CAPTIONS = 8;

export const INITIAL_SESSION: PracticeSession = {
  phase: 'before', speaker: 'waiting', coachName: null, planned: null, question: null, coachLine: null,
  captions: [], previousGoals: [], warning: null, result: null, noResult: null, failure: null, address: null, ending: false,
};

export type SessionAction =
  | { type: 'start' }
  | { type: 'server'; message: PracticeServerMessage }
  | { type: 'end_requested' }
  | { type: 'fail'; code: LocalFailure; address?: string }
  | { type: 'reset' };

const FINISHED: readonly PracticePhase[] = ['result', 'no_result', 'error', 'before'];

/** Whether the session has reached an end state (a closing socket is then expected, not a failure). */
export const isFinished = (phase: PracticePhase): boolean => FINISHED.includes(phase);

export function reduceSession(s: PracticeSession, a: SessionAction): PracticeSession {
  switch (a.type) {
    case 'start':
      return { ...INITIAL_SESSION, phase: 'connecting' };
    case 'reset':
      return INITIAL_SESSION;
    case 'end_requested':
      return isFinished(s.phase) ? s : { ...s, ending: true };
    case 'fail':
      if (isFinished(s.phase)) return s;
      return { ...s, phase: 'error', failure: a.code, address: a.address ?? s.address };
    case 'server':
      return reduceMessage(s, a.message);
  }
}

function reduceMessage(s: PracticeSession, m: PracticeServerMessage): PracticeSession {
  if (isFinished(s.phase)) return s;
  switch (m.type) {
    case 'practice.ready':
      return { ...s, phase: 'live', coachName: m.coach_name, planned: m.planned_questions, previousGoals: m.previous_goals };
    case 'practice.state':
      return { ...s, speaker: m.state, warning: m.state === 'you' ? null : s.warning };
    case 'practice.caption':
      return addCaption(s, m.role, m.text, m.question);
    case 'practice.warning':
      return { ...s, warning: m.message };
    case 'practice.scoring':
      return { ...s, phase: 'scoring', speaker: 'thinking' };
    case 'practice.result':
      return { ...s, phase: 'result', result: m.result };
    case 'practice.no_result':
      return { ...s, phase: 'no_result', noResult: m.message };
    case 'practice.error':
      return { ...s, phase: 'error', failure: m.code };
  }
}

function addCaption(s: PracticeSession, role: 'coach' | 'you', text: string, question: number | null): PracticeSession {
  const clean = text.trim();
  if (!clean) return s;
  const last = s.captions[s.captions.length - 1];
  // A growing caption (the same turn, sent again with more words) replaces the last one.
  const grows = last && last.role === role && last.question === question && clean.startsWith(last.text);
  const key = grows ? last.key : (last?.key ?? 0) + 1;
  const kept = grows ? s.captions.slice(0, -1) : s.captions;
  const captions = [...kept, { key, role, text: clean, question }].slice(-MAX_CAPTIONS);
  if (role === 'you') return { ...s, captions };
  return { ...s, captions, coachLine: clean, question: question ?? s.question };
}

/** What went wrong, in plain words. */
export function failureWords(code: FailureCode, address: string | null): string {
  switch (code) {
    case 'no_key': return 'The coach’s voice isn’t set up on this laptop yet, so practice can’t start.';
    case 'agent_refused': return 'The coach’s voice couldn’t start. Give it a moment and try again.';
    case 'agent_lost': return 'The connection to the coach’s voice dropped partway through.';
    case 'mic_silent': return 'Your coach couldn’t hear anything from your microphone. Check it’s on and not muted, then try again.';
    case 'busy': return 'A practice is already running in another window. Finish that one first.';
    case 'bad_message': return 'This page and Undertone stopped understanding each other. Try again.';
    case 'insecure': return 'The microphone only works on this laptop’s own address (localhost) or over https.';
    case 'mic_denied': return 'The browser didn’t allow the microphone. Allow it in the address bar, then try again.';
    case 'no_mic': return 'No microphone was found. Plug one in or turn it on, then try again.';
    case 'mic_failed': return 'The microphone couldn’t start. Close other apps that might be using it, then try again.';
    case 'unreachable': return address ? `Can’t reach Undertone at ${address}. Check it’s running, then try again.` : 'Can’t reach Undertone. Check it’s running, then try again.';
    case 'closed': return 'The connection to Undertone closed before the practice finished.';
  }
}

/** Who is speaking, in a word or two. */
export function speakerWords(speaker: PracticeSpeaker, coachName: string | null): string {
  if (speaker === 'coach') return `${coachName ?? 'Your coach'} is asking`;
  if (speaker === 'you') return 'You’re answering';
  if (speaker === 'thinking') return `${coachName ?? 'Your coach'} is thinking`;
  return 'Your turn when you’re ready';
}
