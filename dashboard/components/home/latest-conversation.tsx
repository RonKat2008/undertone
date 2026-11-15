'use client';

/** The newest conversation: who, when, what went well, how the talking was shared, and the one thing to try. */
import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Avatar, Button, CoachNote, KindDot, PaceBar, Panel, Prose, ShareBar, TextLink } from '@/components/ui';
import { mediaUrl, type DebriefPayload } from '@/lib/api/client';
import { PACE_RANGE, PACE_ZONE, durationWords, paceWords, relativeWhen, shareWords, type HomePerson } from '@/lib/api/home-model';
import type { SessionSummary } from '@/lib/bus/contracts';
import { Reveal } from './reveal';

export interface LatestConversationProps {
  latest: SessionSummary | null;
  debrief: DebriefPayload | null;
  people: HomePerson[];
}

function RecapButton({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  function toggle() {
    if (!audio.current) {
      audio.current = new Audio(src);
      audio.current.addEventListener('ended', () => setPlaying(false));
    }
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }
  return (
    <Button size="small" onClick={toggle} aria-pressed={playing}>
      {playing ? <Pause size={14} strokeWidth={1.5} aria-hidden /> : <Play size={14} strokeWidth={1.5} aria-hidden />}
      {playing ? 'Pause recap' : 'Play recap'}
    </Button>
  );
}

export function LatestConversation({ latest, debrief, people }: LatestConversationProps) {
  if (!latest) return null;
  const person = latest.person_id ? people.find((p) => p.personId === latest.person_id) ?? null : null;
  const name = person?.name ?? 'them';
  const d = debrief?.data;
  const tryNext = d?.if_then || d?.one_fix || null;
  const share = latest.numbers?.talk_ratio;
  const wpm = latest.numbers?.wpm;
  const recap = mediaUrl(debrief?.audio_url);
  const href = `/conversations/view?session=${encodeURIComponent(latest.session_id)}`;

  return (
    <section aria-labelledby="latest-title" className="relative">
      <span className="home-glow" style={{ '--glow': 'var(--kind-person)', width: 'min(520px, 100%)', height: 320, left: 0, top: 40 } as CSSProperties} aria-hidden />
      <Reveal className="mb-5 flex items-end justify-between gap-4">
        <h2 id="latest-title" className="font-voice text-[32px] leading-[38px]">Your latest conversation</h2>
        <TextLink href="/conversations" tone="muted" className="max-sm:hidden">All conversations</TextLink>
      </Reveal>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Reveal>
          <Panel className="grid h-full gap-5">
            <div className="flex items-center gap-3">
              {person ? <Avatar name={person.name} size="lg" /> : <span className="grid h-12 w-12 place-items-center"><KindDot kind="conversation" /></span>}
              <div className="grid">
                <span className="text-[17px] font-medium leading-[26px]">
                  {person ? person.name : 'A conversation'}
                  {person?.relationship ? <span className="font-normal text-muted">, {person.relationship}</span> : null}
                </span>
                <span className="text-[13px] leading-[18px] text-muted">
                  {[relativeWhen(latest.started_at), durationWords(latest.duration_s)].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
            {d?.strength ? (
              <div className="grid gap-1">
                <span className="text-[13px] font-medium leading-[18px] text-habit">What went well</span>
                <Prose size="body" as="p">{d.strength}</Prose>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {typeof share === 'number' ? (
                <div className="grid gap-1.5">
                  <span className="text-[13px] leading-[18px] text-muted">Who talked</span>
                  <ShareBar share={share} label={shareWords(share, name)} left="You" right={person?.name ?? 'Them'} />
                </div>
              ) : null}
              {typeof wpm === 'number' && wpm > 0 ? (
                <div className="grid gap-1.5">
                  <span className="text-[13px] leading-[18px] text-muted">Your pace: {paceWords(wpm).toLowerCase()}</span>
                  <PaceBar value={wpm} min={PACE_RANGE[0]} max={PACE_RANGE[1]} zone={PACE_ZONE} label={paceWords(wpm)} />
                </div>
              ) : null}
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
              <Button href={href} size="small">Open the debrief</Button>
              {recap ? <RecapButton src={recap} /> : null}
            </div>
          </Panel>
        </Reveal>
        {tryNext ? (
          <Reveal delay={0.1}>
            <CoachNote from="One thing to try next time" size="lead">{tryNext}</CoachNote>
          </Reveal>
        ) : null}
      </div>
    </section>
  );
}
