'use client';

import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { Dumbbell, Mic, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, ICON, ListeningMark, Page, Panel, Prose, Section, StatusWord, TextLink } from '@/components/ui';
import { getBandAlwaysOn } from '@/lib/api/client';
import { clock, detections, handsOf, nudgeLog, paceOf, type MotionChange, type StateWord } from '@/lib/api/live';
import type { SessionMode, Speaker } from '@/lib/bus/contracts';
import { isLive, type BusState } from '@/lib/bus/reducer';
import { useBus, useNow } from '@/lib/bus/use-bus';
import { motionPresets } from '@/lib/motion';
import { DetectionLegend, Detections } from './detections';
import { LiveMeters } from './live-meters';
import { NUDGE_MOMENT_MS, NudgeMoment } from './nudge-moment';
import { Transcript } from './transcript';
import { VoiceWave, type Voice } from './voice-wave';

/** A turn this recent (ms) still counts as someone speaking. */
const SPEAKING_MS = 3000;
/** Nudges replayed when the page connects are history, not a moment. */
const CATCH_UP_MS = 1500;

type ShownWord = StateWord | 'Finished';
const WORD_CLASS: Record<ShownWord, string> = { Listening: 'text-fg', Steady: 'text-habit', Rushing: 'text-coach', Finished: 'text-muted' };

/** Hand movement changes, remembered across renders without an effect (the reducer keeps only the latest). */
function useMotionChanges(state: BusState): MotionChange[] {
  const sessionId = state.session?.id ?? null;
  const key = state.motion ? `${state.motion.ts}:${state.motion.state}` : null;
  const [seen, setSeen] = useState<{ session: string | null; key: string | null; list: MotionChange[] }>({ session: sessionId, key: null, list: [] });
  if (seen.session !== sessionId) {
    setSeen({ session: sessionId, key: null, list: [] });
  } else if (key !== seen.key && state.motion) {
    const prev = seen.list.at(-1)?.state ?? 'still';
    const list = state.motion.state === prev ? seen.list
      : [...seen.list, { id: `hands:${key}`, ts: state.motion.ts, state: state.motion.state, whileThey: state.motion.speaker_context === 'other' }].slice(-20);
    setSeen({ session: sessionId, key, list });
  }
  return seen.list;
}

/** Who is speaking right now: a partial in progress, or a turn that only just ended. */
function speakingNow(state: BusState, now: number): Speaker | null {
  if (state.partial?.text) return state.partial.speaker ?? 'other';
  const last = state.turns.at(-1);
  if (!last || !state.session) return null;
  return now - (state.session.startedAt + last.end * 1000) < SPEAKING_MS ? last.speaker : null;
}

export function LiveScreen() {
  const { state, send } = useBus();
  const now = useNow(250);
  const [mountedAt] = useState(() => Date.now());
  const [asked, setAsked] = useState<{ mode: SessionMode; at: number } | null>(null);
  const motion = useMotionChanges(state);
  const items = useMemo(() => detections(state, motion), [state, motion]);

  const session = state.session;
  const running = isLive(state);
  const hasSession = session !== null && (running || state.turns.length > 0);
  const startedHere = asked !== null && session !== null && session.startedAt >= asked.at - 1000;
  const starting = asked !== null && !running && now - asked.at < 8000 && !(session && session.startedAt >= asked.at - 1000);

  const fresh = state.lastNudge && state.lastNudge.at > mountedAt + CATCH_UP_MS && now - state.lastNudge.at < NUDGE_MOMENT_MS ? state.lastNudge : null;

  function start(mode: SessionMode) {
    setAsked({ mode, at: Date.now() });
    send({ cmd: 'start', mode });
  }

  if (state.status === 'offline') {
    return (
      <Page title="Live">
        <Panel>
          <EmptyState mark="offline" action={<Button onClick={() => window.location.reload()}>Try again</Button>}>
            Undertone on this laptop isn’t answering, so nothing can be heard live right now.
          </EmptyState>
        </Panel>
      </Page>
    );
  }

  if (!hasSession || !session) {
    return <Idle state={state} starting={starting} onStart={start} />;
  }

  const speaker = speakingNow(state, now);
  const pace = paceOf(state.metrics, session.policy, speaker === 'me');
  const word: ShownWord = running ? pace.word : 'Finished';
  const voice: Voice = !running ? 'idle' : speaker === 'me' ? 'me' : speaker === 'other' ? 'them' : 'quiet';
  // session time can run ahead of the wall clock (a replay at speed), so take the later of the two
  const elapsed = Math.max(((session.endedAt ?? now) - session.startedAt) / 1000, state.turns.at(-1)?.end ?? 0, state.marks.at(-1)?.ts ?? 0);
  const practice = session.mode === 'practice';
  const modeWords = practice ? 'Practice round' : startedHere ? 'Rehearsal' : 'Live conversation';
  const buzzes = nudgeLog(state.marks);
  const prompt = practice ? state.coach?.drill.prompts[Math.max(0, state.practice.round - 1) % Math.max(1, state.coach.drill.prompts.length)] : null;

  return (
    <Page title="Live" width="wide"
      action={running ? <Button variant="quiet" onClick={() => send({ cmd: 'stop' })}><Square {...ICON} size={14} aria-hidden />Stop</Button> : undefined}>
      <NudgeMoment nudge={fresh} />
      {!running && <Ended state={state} />}

      <section aria-label="Right now" className="grid items-center gap-x-10 gap-y-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatusWord tone={running ? 'moment' : 'quiet'} live>{modeWords}</StatusWord>
            <span className="text-caption tabular text-muted">{clock(elapsed)}</span>
            {buzzes.length > 0 && (
              <span className="text-caption tabular truncate text-muted">
                Last buzz “{buzzes[buzzes.length - 1].words}” at {clock(buzzes[buzzes.length - 1].ts)}
              </span>
            )}
          </div>
          <StateWordView word={word} />
          {speaker && running ? <p className="text-body text-muted">{speaker === 'me' ? 'You are speaking' : 'They are speaking'}</p> : <p className="text-body text-muted">{running ? 'Nobody is speaking right now' : ' '}</p>}
          {prompt ? <Prose size="body" className="mt-3 text-coach">“{prompt}”</Prose> : null}
        </div>
        <VoiceWave voice={voice} className="justify-self-center sm:justify-self-end sm:w-[360px]" />
      </section>

      <Panel className="mt-8">
        <LiveMeters pace={pace} share={state.turns.length > 0 ? state.metrics?.talk_ratio ?? null : null} hands={handsOf(state)} />
      </Panel>

      <div className="mt-[var(--gap-section)] grid gap-x-8 gap-y-[var(--gap-section)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0"><Section title="Transcript">
          <Panel>
            <Transcript turns={state.turns} partial={running ? state.partial : null} fillers={state.coach?.filler_words ?? []} />
          </Panel>
        </Section></div>
        <div className="min-w-0"><Section title="Detections" aside={<DetectionLegend />}>
          <Panel>
            <div className="max-h-[min(56vh,560px)] overflow-y-auto [scrollbar-width:thin]">
              <Detections items={items} />
            </div>
          </Panel>
        </Section></div>
      </div>
    </Page>
  );
}

function StateWordView({ word }: { word: ShownWord }) {
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  return (
    <h2 className="relative mt-2 h-[clamp(64px,10vw,112px)] overflow-hidden" aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span key={word} variants={presets.enter} initial="hidden" animate="shown" exit="gone"
          className={`block text-[clamp(56px,9vw,104px)] font-medium leading-none tracking-[-0.035em] ${WORD_CLASS[word]}`}>
          {word}
        </m.span>
      </AnimatePresence>
    </h2>
  );
}

function Ended({ state }: { state: BusState }) {
  const id = state.session?.id;
  const practice = state.session?.mode === 'practice';
  const ready = state.debrief !== null && state.debrief.session_id === id;
  return (
    <Panel tone="moment" className="mb-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-lead font-medium text-fg">{practice ? 'Round finished' : 'Conversation ended'}</p>
          <p className="text-body text-muted">{ready ? 'Your debrief is ready.' : practice ? 'Start another round when you are ready.' : 'Your coach is writing the debrief. It takes a moment.'}</p>
        </div>
        {id && !practice ? (
          <Button variant="primary" href={`/conversations/view?session=${encodeURIComponent(id)}`}>{ready ? 'Read the debrief' : 'Open the conversation'}</Button>
        ) : null}
      </div>
    </Panel>
  );
}

function Idle({ state, starting, onStart }: { state: BusState; starting: boolean; onStart: (mode: SessionMode) => void }) {
  const [alwaysOn, setAlwaysOn] = useState<boolean | null>(null);
  useEffect(() => {
    let on = true;
    void getBandAlwaysOn().then((v) => { if (on) setAlwaysOn(v); });
    return () => { on = false; };
  }, []);
  const connected = state.band?.connected ?? false;
  const listening = connected && ((state.band?.mic_on ?? false) || alwaysOn === true);
  const coach = state.coach;
  return (
    <Page title="Live" width="wide">
      <Panel className="relative overflow-hidden">
        <div className="flex flex-col items-center gap-6 px-2 py-10 text-center sm:py-16">
          {listening ? <ListeningMark state="listening" size="lg" /> : <VoiceWave voice="idle" className="w-[240px]" />}
          <div className="grid max-w-[52ch] gap-3">
            <h2 className="text-display font-medium text-balance text-fg">{listening ? 'Listening for a conversation' : 'Start a rehearsal'}</h2>
            <p className="text-lead text-pretty text-muted">
              {listening
                ? 'When the band hears someone talking, the conversation shows up here as it happens. You can also rehearse at the laptop.'
                : connected
                  ? 'Your band is connected but not listening. Rehearse at the laptop, and watch what you say and what the coach notices appear here as you speak.'
                  : 'Put the band on and start a rehearsal. What you say and what the coach notices appear here as you speak.'}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="primary" loading={starting} onClick={() => onStart('regular')}><Mic {...ICON} size={16} aria-hidden />Start a rehearsal</Button>
            <Button onClick={() => onStart('practice')} disabled={starting}><Dumbbell {...ICON} size={16} aria-hidden />Practice round</Button>
          </div>
          <p className="text-caption text-muted">
            {coach ? <>Coaching with {coach.name}. <TextLink href="/coach" tone="muted">Change coach</TextLink></> : <TextLink href="/coach" tone="muted">Choose a coach</TextLink>}
          </p>
        </div>
      </Panel>
    </Page>
  );
}
