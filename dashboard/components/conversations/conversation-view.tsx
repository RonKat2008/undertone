'use client';

/**
 * One recorded conversation: header, the recording, and the transcript as a script.
 * The turn playing is lit and kept in view; clicking a turn (or Enter on it) plays from there.
 * Transcript text is untrusted speech and is only ever rendered as text.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AudioPlayer, type PlayerHandle } from '@/components/conversations/audio-player';
import { debriefHref } from '@/components/graph/detail-panel';
import {
  findConversation, getTranscript, listPeople, recordingUrl, type TranscriptResult,
} from '@/lib/api/client';
import type { Person } from '@/lib/bus/contracts';
import { useBus } from '@/lib/bus/use-bus';
import {
  activeTurnIndex, audioPositionForTurn, clockTime, conversationTime, dayKey, fillerCount, longDate, reasonLabel,
  relativeDayName, speakerLabel, splitFillers, timeOfDay, transcriptText,
} from '@/lib/conversations/model';
import { LIBRARY_HREF } from '@/lib/conversations/links';
import type { LibrarySession, SessionTranscript, TranscriptTurn } from '@/lib/conversations/types';
import { duration } from '@/lib/graph/format';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const libraryHref = LIBRARY_HREF;

type Load = { state: 'loading' } | TranscriptResult;

export function ConversationView({ sessionId }: { sessionId: string | null }) {
  const { state } = useBus();
  const [load, setLoad] = useState<Load>({ state: 'loading' } as Load);
  const [summary, setSummary] = useState<LibrarySession | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [attempt, setAttempt] = useState(0);
  // The debrief landing can bring a transcript for a conversation that just ended.
  const busKey = state.debrief?.session_id === sessionId ? state.debrief?.at ?? '' : '';

  useEffect(() => {
    if (!sessionId) return;
    let on = true;
    setLoad({ state: 'loading' } as Load);
    getTranscript(sessionId).then((r) => on && setLoad(r));
    findConversation(sessionId).then((s) => on && setSummary(s)).catch(() => on && setSummary(null));
    listPeople().then((p) => on && setPeople(p.ok ? p.data : [])).catch(() => undefined);
    return () => { on = false; };
  }, [sessionId, attempt, busKey]);

  if (!sessionId) return <NotFound reason="No conversation was named in the link." />;
  if ('state' in load) return <Loading />;
  if (load.kind === 'not_found') return <NotFound reason="The backend has no conversation with this id. It may have been deleted, or the link is from another wearer’s band." />;
  if (load.kind === 'error') return <Unreachable message={load.message} onRetry={() => setAttempt((a) => a + 1)} />;

  const person = summary?.person_id ? people.find((p) => p.person_id === summary.person_id)?.name ?? null : null;
  return <Loaded t={load.data} summary={summary} person={person} />;
}

function Loaded({ t, summary, person }: { t: SessionTranscript; summary: LibrarySession | null; person: string | null }) {
  const reducedMotion = useReducedMotion();
  const player = useRef<PlayerHandle>(null);
  const [active, setActive] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const src = useMemo(() => recordingUrl(t), [t]);
  const activeRef = useRef(-1);

  const onTime = useCallback((audioTime: number) => {
    const i = activeTurnIndex(t.turns, conversationTime(audioTime, t.audio_offset_s));
    if (i !== activeRef.current) {
      activeRef.current = i;
      setActive(i);
    }
  }, [t]);

  // Keep the playing turn in view, below the sticky player.
  useEffect(() => {
    if (!playing || active < 0) return;
    const el = document.querySelector<HTMLElement>(`[data-turn-index="${active}"]`);
    el?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [active, playing, reducedMotion]);

  const day = dayKey(t.started_at);
  const today = dayKey(new Date().toISOString());
  const dayName = relativeDayName(day, today);
  const length = t.duration_s ?? summary?.duration_s ?? null;
  const headline = summary?.headline_fact || 'A recorded conversation';
  const fillers = fillerCount(t.turns);
  const heading = `${headline}\n${longDate(day, today)}, ${timeOfDay(t.started_at)}${person ? ` · with ${person}` : ''}`;
  const filtered = summary ? reasonLabel(summary) : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(transcriptText(t, heading));
      setCopied('done');
    } catch {
      setCopied('failed');
    }
    window.setTimeout(() => setCopied('idle'), 2400);
  }

  const seekTo = (turn: TranscriptTurn) => player.current?.playFrom(audioPositionForTurn(turn, t.audio_offset_s));

  return (
    <article className="pt-6">
      <nav aria-label="Breadcrumb" className="label flex flex-wrap items-center gap-x-2">
        <Link href={libraryHref} className="hover:text-ink">Conversations</Link>
        <span aria-hidden className="text-ink-3">/</span>
        <span className="!text-ink">{dayName ?? longDate(day, today)}, {timeOfDay(t.started_at)}</span>
      </nav>

      <header className="mt-2 border-b border-ink pb-5">
        <h1 className="display-l max-w-[26ch]">{headline}</h1>
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
          <Fact label="When" value={`${longDate(day, today)} · ${timeOfDay(t.started_at)}`} />
          <Fact label="Length" value={length !== null ? duration(length) : '—'} mono />
          <Fact label="With" value={person ?? (summary?.mode === 'practice' ? 'Practice, on your own' : 'Not tagged')} muted={!person} />
          {summary?.coach_name && <Fact label="Coach" value={summary.coach_name} />}
        </dl>
        {filtered && <p className="mt-4 text-[13px] text-ink-2"><span className="label mr-2">Filtered out</span>{filtered}. It stays out of your graph and habits unless you keep it from the library.</p>}
      </header>

      <div className="mt-6 grid gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <aside className="sticky top-0 z-10 -mx-4 border-b border-rule bg-paper px-4 pb-4 pt-3 md:-mx-8 md:px-8 lg:order-2 lg:top-4 lg:mx-0 lg:self-start lg:border-b-0 lg:border-t lg:border-t-ink lg:bg-transparent lg:px-0 lg:pt-4">
          {src
            ? <AudioPlayer ref={player} src={src} turns={t.turns} offset={t.audio_offset_s} durationHint={length !== null ? length + t.audio_offset_s : null} onTime={onTime} onPlayingChange={setPlaying} />
            : <NoRecording hasWords={t.turns.length > 0} />}
          <div className="mt-4 hidden flex-wrap gap-2 lg:flex">
            <Actions sessionId={t.session_id} debrief={!filtered} onCopy={copy} copied={copied} canCopy={t.turns.length > 0} />
          </div>
        </aside>

        <section aria-labelledby="transcript-heading" className="min-w-0 lg:order-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-ink pb-2">
            <h2 id="transcript-heading" className="label !text-ink">Transcript<span className="num ml-2 text-ink-3">{t.turns.length} turns</span></h2>
            {fillers > 0 && (
              <span className="text-[11.5px] text-ink-2"><span className="filler">um</span> dotted: a filler, <span className="num">{fillers}</span> of yours</span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 lg:hidden">
            <Actions sessionId={t.session_id} debrief={!filtered} onCopy={copy} copied={copied} canCopy={t.turns.length > 0} />
          </div>
          {t.turns.length === 0
            ? <NoWords />
            : (
              <ol className="mt-1">
                {t.turns.map((turn, i) => (
                  <Turn key={turn.turn_id} turn={turn} index={i} active={i === active} playable={src !== null} onPlay={() => seekTo(turn)} />
                ))}
              </ol>
            )}
        </section>
      </div>
    </article>
  );
}

function Fact({ label, value, mono, muted }: { label: string; value: string; mono?: boolean; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className={`mt-0.5 text-[16px] ${mono ? 'num' : ''} ${muted ? 'text-ink-3' : ''}`}>{value}</dd>
    </div>
  );
}

interface ActionsProps {
  sessionId: string;
  /** Filtered-out captures have no debrief. */
  debrief: boolean;
  onCopy: () => void;
  copied: 'idle' | 'done' | 'failed';
  canCopy: boolean;
}

function Actions({ sessionId, debrief, onCopy, copied, canCopy }: ActionsProps) {
  return (
    <>
      {debrief && <Link href={debriefHref(sessionId)} className="btn btn-sm btn-solid">Open the debrief</Link>}
      <button type="button" className="btn btn-sm" onClick={onCopy} disabled={!canCopy}>
        {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy transcript'}
      </button>
      <span className="sr-only" aria-live="polite">{copied === 'done' ? 'Transcript copied' : copied === 'failed' ? 'Could not copy the transcript' : ''}</span>
    </>
  );
}

function Turn({ turn, index, active, playable, onPlay }: { turn: TranscriptTurn; index: number; active: boolean; playable: boolean; onPlay: () => void }) {
  const me = turn.speaker === 'me';
  const segments = splitFillers(turn.text, me ? turn.fillers : []);
  const label = `${speakerLabel(turn.speaker)} at ${clockTime(turn.start)}`;
  const body = segments.map((s, i) => (s.filler ? <span key={i} className="filler">{s.text}</span> : s.text));
  return (
    <li data-turn-index={index}
      {...(playable ? {
        role: 'button', tabIndex: 0, 'aria-label': `${label}. Play from here.`, 'aria-current': active ? ('true' as const) : undefined,
        onClick: onPlay,
        onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); onPlay(); } },
      } : {})}
      className={`turn group grid grid-cols-[50px_minmax(0,1fr)] gap-x-3 border-b border-rule py-3 pl-2 sm:grid-cols-[72px_minmax(0,1fr)] sm:gap-x-4 sm:pl-3 ${playable ? 'cursor-pointer hover:bg-well/60' : ''} ${active ? 'is-active' : ''}`}>
      <div className="pt-[3px]">
        <div className={`label ${me ? '!text-ink' : ''}`}>{speakerLabel(turn.speaker)}</div>
        <div className="num mt-0.5 text-[11px] text-ink-3">{clockTime(turn.start)}</div>
        {me && turn.wpm > 0 && <div className="num text-[10.5px] text-ink-3">{Math.round(turn.wpm)} wpm</div>}
      </div>
      <p className={`max-w-[68ch] text-[15.5px] leading-[1.55] ${me ? '' : 'text-ink-2'}`}>
        {body}
        {playable && <span aria-hidden className="label ml-2 whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">▸ play</span>}
      </p>
    </li>
  );
}

function NoRecording({ hasWords }: { hasWords: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-ink-3">
        <svg width="16" height="14" viewBox="0 0 16 14"><path d="M1 7h14" stroke="var(--ink-3)" strokeWidth="1.4" /></svg>
      </span>
      <div>
        <p className="display-s">No recording was kept for this conversation.</p>
        <p className="mt-1 text-[12.5px] text-ink-2">{hasWords ? 'The words are below. ' : ''}Recordings are kept only when the band hears a real conversation.</p>
      </div>
    </div>
  );
}

function NoWords() {
  return (
    <div className="py-12">
      <svg width="56" height="14" viewBox="0 0 56 14" aria-hidden>{[0, 1, 2, 3, 4, 5, 6].map((i) => <rect key={i} x={i * 8} y={6} width={4} height={2} fill="var(--rule)" />)}</svg>
      <p className="display-m mt-3">No words were captured.</p>
      <p className="mt-2 max-w-[48ch] text-[13px] text-ink-2">The band heard something but nothing it could transcribe, often a moment too short or too far away.</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="pt-6" aria-busy aria-live="polite">
      <div className="label">Conversations</div>
      <p className="display-l caret mt-2 text-ink-3">Fetching the conversation…</p>
      <div className="mt-8 space-y-4 border-t border-ink pt-5">
        {[92, 70, 84, 58, 76].map((w, i) => (
          <div key={w} className="grid grid-cols-[72px_1fr] gap-x-4" style={{ opacity: 1 - i * 0.15 }}>
            <div className="h-3 w-10 bg-well" />
            <div className="h-3 bg-well" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function NotFound({ reason }: { reason: string }) {
  return (
    <div className="pt-16">
      <div className="label">Conversations · not found</div>
      <p className="display-l mt-2 max-w-[18ch]">This conversation isn’t here.</p>
      <p className="mt-4 max-w-[52ch] text-[14px] text-ink-2">{reason}</p>
      <Link href={libraryHref} className="btn mt-6">All conversations</Link>
    </div>
  );
}

function Unreachable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="pt-16">
      <div role="alert" className="max-w-[60ch] border-l-[3px] border-ink pl-5">
        <div className="label flex items-center gap-2 !text-ink"><span className="state state-fault" aria-hidden />Backend</div>
        <p className="display-m mt-1">The conversation could not be fetched.</p>
        <p className="mt-3 text-[13.5px] text-ink-2">{message.replace(/\.$/, '')}. Check that the laptop backend is running, then try again.</p>
        <div className="mt-5 flex gap-2">
          <button type="button" className="btn btn-solid" onClick={onRetry}>Try again</button>
          <Link href={libraryHref} className="btn btn-quiet">All conversations</Link>
        </div>
      </div>
    </div>
  );
}
