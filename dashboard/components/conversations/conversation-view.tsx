'use client';

/**
 * One conversation, on one page: who and when, the one thing to try (the primary thing), what
 * worked, the recording (docked at the bottom while you read the words), the transcript, and
 * the numbers behind "More detail". Loads the transcript, the debrief, the list entry, people
 * and your usual pace in parallel; a debrief landing on the bus for this conversation refreshes it.
 */
import { ChevronLeft } from 'lucide-react';
import { m, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioPlayer, type PlayerHandle } from '@/components/conversations/audio-player';
import { ConversationHeader } from '@/components/conversations/conversation-header';
import { CoachSection } from '@/components/conversations/coach-section';
import { MoreDetail } from '@/components/conversations/more-detail';
import { Transcript } from '@/components/conversations/transcript';
import { Button, EmptyState, ICON, Panel, Skeleton, TextLink } from '@/components/ui';
import {
  findConversation, getDebrief, getProfile, getTranscript, listPeople, mediaUrl, recordingUrl,
  type DebriefPayload, type DebriefResult, type TranscriptResult,
} from '@/lib/api/client';
import type { Person } from '@/lib/bus/contracts';
import { useBus } from '@/lib/bus/use-bus';
import { flaggedMoments } from '@/lib/conversations/display';
import { LIBRARY_HREF } from '@/lib/conversations/links';
import { activeTurnIndex, audioPositionForTurn, conversationTime } from '@/lib/conversations/model';
import type { LibrarySession, SessionTranscript } from '@/lib/conversations/types';
import { motionPresets } from '@/lib/motion';

interface Loaded {
  transcript: TranscriptResult;
  debrief: DebriefResult;
  summary: LibrarySession | null;
  people: Person[];
  usualWpm: number | null;
}

export function ConversationView({ sessionId }: { sessionId: string | null }) {
  const { state } = useBus();
  const [load, setLoad] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const liveDebrief = state.debrief && state.debrief.session_id === sessionId ? state.debrief : null;
  const liveSession = state.session && state.session.id === sessionId ? state.session : null;
  const busKey = `${liveDebrief?.at ?? ''}|${liveSession?.endedAt ?? ''}`;

  useEffect(() => {
    if (!sessionId) return;
    let on = true;
    void Promise.all([
      getTranscript(sessionId),
      getDebrief(sessionId),
      findConversation(sessionId).catch(() => null),
      listPeople().then((p) => (p.ok ? p.data : [])).catch(() => []),
      getProfile().then((p) => (p.ok ? p.data.baseline_wpm ?? null : null)).catch(() => null),
    ]).then(([transcript, debrief, summary, people, usualWpm]) => {
      if (on) setLoad({ transcript, debrief, summary, people, usualWpm });
    });
    return () => { on = false; };
  }, [sessionId, attempt, busKey]);

  if (!sessionId) return <NotFound />;
  if (!load) return <ViewSkeleton />;
  if (load.transcript.kind === 'not_found') return <NotFound />;
  if (load.transcript.kind === 'error') return <Unreachable onRetry={() => setAttempt((a) => a + 1)} />;

  const debrief: DebriefPayload | null = liveDebrief
    ? { session_id: liveDebrief.session_id, data: liveDebrief.data, audio_url: liveDebrief.audio_url }
    : load.debrief.kind === 'ok' ? load.debrief.data : null;
  const stillGoing = !debrief && (liveSession ? liveSession.endedAt === null : load.transcript.data.duration_s === null);
  return (
    <Conversation key={load.transcript.data.session_id} t={load.transcript.data} debrief={debrief}
      debriefFailed={!debrief && load.debrief.kind === 'error'} stillGoing={stillGoing}
      summary={load.summary} people={load.people} usualWpm={load.usualWpm} onRetry={() => setAttempt((a) => a + 1)} />
  );
}

interface ConversationProps {
  t: SessionTranscript;
  debrief: DebriefPayload | null;
  debriefFailed: boolean;
  stillGoing: boolean;
  summary: LibrarySession | null;
  people: Person[];
  usualWpm: number | null;
  onRetry: () => void;
}

function Conversation({ t, debrief, debriefFailed, stillGoing, summary, people: initialPeople, usualWpm, onRetry }: ConversationProps) {
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  const player = useRef<PlayerHandle>(null);
  const [people, setPeople] = useState(initialPeople);
  const [personId, setPersonId] = useState(summary?.person_id ?? null);
  const [active, setActive] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const activeRef = useRef(-1);
  const src = useMemo(() => recordingUrl(t), [t]);
  const person = personId ? people.find((p) => p.person_id === personId) ?? null : null;
  const flags = useMemo(() => flaggedMoments(t.turns, debrief?.data ?? null), [t.turns, debrief]);
  const length = t.duration_s ?? summary?.duration_s ?? null;

  const onTime = useCallback((audioTime: number) => {
    const i = activeTurnIndex(t.turns, conversationTime(audioTime, t.audio_offset_s));
    if (i !== activeRef.current) {
      activeRef.current = i;
      setActive(i);
    }
  }, [t]);

  const seekTime = (convTime: number) => player.current?.playFrom(audioPositionForTurn({ start: convTime }, t.audio_offset_s));

  const block = (delay: number) => ({ variants: presets.enter, initial: 'hidden', animate: 'shown', transition: { delay: reduced ? 0 : delay } });

  return (
    <article className="qi-page" data-width="reading">
      <m.div {...block(0)}>
        <TextLink href={LIBRARY_HREF} tone="muted" className="-ml-1 inline-flex min-h-11 items-center gap-1 no-underline">
          <ChevronLeft {...ICON} size={16} aria-hidden />Conversations
        </TextLink>
        <ConversationHeader t={t} summary={summary} debrief={debrief} stillGoing={stillGoing} length={length}
          person={person} people={people}
          onTagged={(p) => { setPersonId(p.person_id); setPeople((list) => [...list.filter((x) => x.person_id !== p.person_id), p]); }} />
      </m.div>

      <m.div className="mt-8" {...block(0.06)}>
        <CoachSection debrief={debrief?.data ?? null} recap={mediaUrl(debrief?.audio_url)} stillGoing={stillGoing}
          failed={debriefFailed} onRetry={onRetry} hidden={summary !== null && !summary.kept} />
      </m.div>

      <m.section aria-labelledby="words" className="mt-12" {...block(0.12)}>
        <h2 id="words" className="mb-3 text-lead font-medium">What was said</h2>
        {!src && !stillGoing ? <p className="mb-4 text-body text-muted">No recording was kept for this one.</p> : null}
        {t.turns.length === 0 ? (
          <Panel><p className="text-body text-muted">{stillGoing ? 'The words appear here as the conversation goes on.' : 'No words were captured in this one.'}</p></Panel>
        ) : (
          // DOM order puts the player first (keyboard reaches it before the turns); column-reverse
          // places it after the words so `sticky bottom` docks it to the viewport while you read.
          <div className="flex flex-col-reverse">
            {src ? (
              <div className="sticky bottom-3 z-20 mt-6 rounded-panel bg-surface p-3 shadow-[var(--shadow-float),0_0_0_1px_var(--line)] sm:bottom-5 sm:p-4">
                <AudioPlayer ref={player} src={src} turns={t.turns} offset={t.audio_offset_s}
                  durationHint={length !== null ? length + t.audio_offset_s : null} onTime={onTime} onPlayingChange={setPlaying} />
              </div>
            ) : null}
            <Transcript turns={t.turns} other={person?.name ?? null} flags={flags} active={active} playing={playing}
              onSeek={src ? (turn) => player.current?.playFrom(audioPositionForTurn(turn, t.audio_offset_s)) : undefined} />
          </div>
        )}
      </m.section>

      {debrief ? (
        <div className="mt-10">
          <MoreDetail d={debrief.data} turns={t.turns} other={person?.name ?? null} durationS={length} usualWpm={usualWpm}
            onSeekTime={src ? seekTime : undefined} />
        </div>
      ) : null}
    </article>
  );
}

function ViewSkeleton() {
  return (
    <div className="qi-page" data-width="reading" role="status" aria-label="Loading the conversation">
      <Skeleton width={120} />
      <div className="mt-4"><Skeleton shape="block" height={36} width="80%" /></div>
      <div className="mt-3"><Skeleton width="45%" /></div>
      <div className="mt-8"><Skeleton shape="block" height={168} /></div>
      <div className="mt-12 grid gap-4">
        {[90, 72, 84, 60].map((w) => <div key={w}><Skeleton width={60} /><Skeleton width={`${w}%`} /></div>)}
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="qi-page" data-width="reading">
      <EmptyState mark="idle" action={<Button href={LIBRARY_HREF}>All conversations</Button>}>
        This conversation isn’t here. It may have been deleted, or the link is from somewhere else.
      </EmptyState>
    </div>
  );
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="qi-page" data-width="reading">
      <EmptyState mark="offline" action={<Button onClick={onRetry}>Try again</Button>}>
        Undertone on your laptop isn’t answering, so this conversation can’t load right now.
      </EmptyState>
    </div>
  );
}
