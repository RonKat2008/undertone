'use client';

/**
 * "More detail", closed by default: the numbers said as sentences (talk share, pace, fillers,
 * questions), the better version of one answer, the coach's notes, and the moments you marked
 * or promises you made. No per-turn pace, no charts with units.
 */
import { Handshake, Bookmark } from 'lucide-react';
import type { ReactNode } from 'react';
import { Disclosure, ICON, PaceBar, Prose, ShareBar } from '@/components/ui';
import type { Debrief } from '@/lib/bus/contracts';
import { fillerWords, paceWords, paceZone, questionsWords, talkShareWords } from '@/lib/conversations/display';
import { clockTime, fillerCount } from '@/lib/conversations/model';
import type { TranscriptTurn } from '@/lib/conversations/types';

interface MoreDetailProps {
  d: Debrief;
  turns: readonly TranscriptTurn[];
  other: string | null;
  durationS: number | null;
  /** Your usual pace from the habit profile, when known. */
  usualWpm: number | null;
  /** Plays the recording from a conversation time, when there is one. */
  onSeekTime?: (t: number) => void;
}

const PACE_MIN = 80;
const PACE_MAX = 240;

export function MoreDetail({ d, turns, other, durationS, usualWpm, onSeekTime }: MoreDetailProps) {
  const n = d.numbers;
  const marked = fillerCount(turns as TranscriptTurn[]);
  const notes = (d.notes ?? []).filter((x) => x.trim());
  const bookmarks = d.bookmarks ?? [];
  const hasShare = Number.isFinite(n?.talk_ratio) && (n.talk_ratio > 0 || turns.length > 0);
  const hasPace = Number.isFinite(n?.wpm) && n.wpm > 0;
  return (
    <Disclosure summary="More detail">
      <div className="grid gap-8 pt-3">
        <div className="grid gap-6">
          {hasShare ? (
            <Fact text={talkShareWords(n.talk_ratio, other)}>
              <ShareBar share={n.talk_ratio} label={talkShareWords(n.talk_ratio, other)} left="You" right={other ?? 'Them'} />
            </Fact>
          ) : null}
          {hasPace ? (
            <Fact text={paceWords(n.wpm, usualWpm)}>
              <PaceBar value={n.wpm} min={PACE_MIN} max={PACE_MAX} zone={paceZone(usualWpm)} label={paceWords(n.wpm, usualWpm)} />
            </Fact>
          ) : null}
          <p className="text-body">
            {fillerWords(marked, n?.fillers_per_min ?? 0, durationS)} {questionsWords(n?.questions ?? 0, n?.interruptions ?? 0)}
          </p>
          {d.vs_last_time ? <p className="text-body text-muted">{d.vs_last_time}</p> : null}
        </div>

        {d.better_version ? (
          <Group title="A better way to say it">
            <p className="text-body text-muted">You said: “{d.better_version.original.trim()}”</p>
            <Prose size="body" className="mt-2">Try: <mark>{d.better_version.rewritten.trim()}</mark></Prose>
          </Group>
        ) : null}

        {notes.length > 0 ? (
          <Group title="Notes">
            <ul className="grid gap-1.5">
              {notes.map((note, i) => <li key={i} className="flex gap-3 text-body"><span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-coach" />{note}</li>)}
            </ul>
          </Group>
        ) : null}

        {bookmarks.length > 0 ? (
          <Group title="Moments and promises">
            <ul className="grid gap-4">
              {bookmarks.map((b, i) => {
                const promise = b.source === 'promise';
                const Icon = promise ? Handshake : Bookmark;
                return (
                  <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
                    <span data-kind={promise ? 'promise' : 'conversation'} className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-[color-mix(in_oklch,var(--kind)_18%,transparent)] text-[var(--kind)]">
                      <Icon {...ICON} size={14} aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-body">“{b.snippet.trim()}”</p>
                      <p className="text-caption text-muted">
                        {promise ? 'A promise you made' : 'You marked this'}
                        {' · '}
                        {onSeekTime ? (
                          <button type="button" className="qi-link tabular" onClick={() => onSeekTime(b.ts)}>Play from {clockTime(b.ts)}</button>
                        ) : <span className="tabular">{clockTime(b.ts)}</span>}
                      </p>
                      {b.what_happened ? <p className="mt-1 text-body text-muted">{b.what_happened}</p> : null}
                      {b.follow_up ? <p className="mt-1 text-body">Follow up: {b.follow_up}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Group>
        ) : null}
      </div>
    </Disclosure>
  );
}

function Fact({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="grid max-w-[520px] gap-2.5">
      <p className="text-body">{text}</p>
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-body font-medium">{title}</h3>
      {children}
    </section>
  );
}
