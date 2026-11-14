'use client';

/**
 * The shell's one status indicator. A word ("Listening", "Not listening", "Offline") with a
 * small mark; hover or tap shows the band and the phone in plain sentences and a way to Settings.
 * Reads the same live state as before: the bus for band and phone, GET /band/status for
 * "listening all day".
 */
import { useEffect, useState } from 'react';
import { TextLink } from '@/components/ui/text-link';
import { Popover } from '@/components/ui/tooltip';
import { getBandAlwaysOn } from '@/lib/api/client';
import { useBus } from '@/lib/bus/use-bus';

type Summary = 'listening' | 'idle' | 'offline' | 'connecting';

export function ShellStatus() {
  const { state } = useBus();
  const band = state.band;
  const connected = band?.connected ?? false;
  const micOn = band?.mic_on ?? false;
  const [alwaysOn, setAlwaysOn] = useState<boolean | null>(null);

  useEffect(() => {
    let current = true;
    getBandAlwaysOn().then((v) => {
      if (current) setAlwaysOn(v);
    });
    return () => {
      current = false;
    };
  }, [connected, micOn]);

  const listening = micOn || alwaysOn === true;
  const phone = Object.values(state.devices).find((d) => d.connected) ?? null;
  const summary: Summary =
    state.status === 'offline' ? 'offline' : state.status === 'connecting' ? 'connecting' : listening ? 'listening' : 'idle';

  const word = { listening: 'Listening', idle: 'Not listening', offline: 'Offline', connecting: 'Connecting' }[summary];
  const bandSentence = !band
    ? 'Undertone hasn’t heard from your band yet.'
    : !connected
      ? 'Your band isn’t connected.'
      : listening
        ? alwaysOn
          ? 'Your band is listening all day.'
          : 'Your band is listening.'
        : 'Your band is connected but not listening.';
  const phoneSentence = phone ? `Your phone (${phone.name}) is connected, so nudges can reach you.` : 'Your phone isn’t connected, so nudges can’t reach you.';
  const offlineSentence = 'Undertone can’t reach its server right now. It will keep trying.';

  return (
    <Popover
      label="Band and phone"
      openOnHover
      trigger={
        <button
          type="button"
          className="flex h-11 items-center gap-2 rounded-[4px] px-1 text-[13px] leading-[18px] text-muted transition-colors duration-150 hover:text-fg"
          aria-label={`${word}. Band and phone details`}
        >
          <Mark summary={summary} />
          <span className={summary === 'offline' ? 'text-warn' : undefined}>{word}</span>
        </button>
      }
    >
      <div className="grid gap-2">
        {summary === 'offline' ? <p>{offlineSentence}</p> : null}
        <p>{bandSentence}</p>
        <p className="text-muted">{phoneSentence}</p>
        <p className="pt-1 text-[13px] leading-[18px]">
          <TextLink href="/settings">Open settings</TextLink>
        </p>
      </div>
    </Popover>
  );
}

/** A 7 px circle: filled when listening, a ring otherwise, warn-coloured ring when offline. */
function Mark({ summary }: { summary: Summary }) {
  const filled = summary === 'listening';
  const tone = summary === 'offline' ? 'border-warn' : filled ? 'border-fg bg-fg' : 'border-muted';
  return <span aria-hidden className={`size-[7px] shrink-0 rounded-full border ${tone}`} />;
}
