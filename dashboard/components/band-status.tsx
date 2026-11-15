'use client';

import { Watch } from 'lucide-react';
import type { ReactNode } from 'react';
import { ICON, ListeningMark, Skeleton, StatusWord, TextLink } from '@/components/ui';
import type { Load } from '@/components/settings/use-settings-data';
import type { BandResult } from '@/lib/api/settings';
import { batteryWords, plainError, type BandStatus } from '@/lib/api/settings-model';

export interface BandStatusProps {
  band: Load<BandResult>;
}

/** The band in plain words: connected, listening, battery, all-day listening; a link to Calibration. */
export function BandStatusPanel({ band }: BandStatusProps) {
  if (band.kind === 'loading') return <Skeleton shape="block" height={152} />;
  if (band.kind === 'error') {
    return <p role="alert" className="text-body text-danger">Couldn’t read the band. {plainError(band.error)}</p>;
  }
  if (band.data.kind === 'none') {
    return (
      <div className="flex items-start gap-4">
        <span aria-hidden className="settings-phone-icon grid size-12 shrink-0 place-items-center rounded-[14px]">
          <Watch {...ICON} size={22} />
        </span>
        <div className="min-w-0">
          <StatusWord tone="quiet">No band is attached to this laptop</StatusWord>
          <p className="mt-1 text-body text-muted text-pretty">
            Turn your band on, restart Undertone on this laptop with the band set up, then reload this page.
          </p>
        </div>
      </div>
    );
  }
  return band.data.kind === "ok" ? <BandFacts band={band.data.band} /> : null;
}

function BandFacts({ band }: { band: BandStatus }) {
  const listening = band.connected && (band.mic_on || band.always_on);
  const battery = batteryWords(band.battery_pct);
  const headline = !band.connected
    ? 'Your band isn’t connected. Turn it on and keep it near this laptop.'
    : listening
      ? 'Your band is on your wrist and listening.'
      : 'Your band is connected. It starts listening when you double-tap it.';

  return (
    <div className="grid gap-6">
      <div className="flex items-start gap-4">
        <span aria-hidden data-state={band.connected ? 'connected' : 'paired'}
          className="settings-phone-icon grid size-12 shrink-0 place-items-center rounded-[14px]">
          <Watch {...ICON} size={22} />
        </span>
        <div className="min-w-0">
          <StatusWord tone={band.connected ? 'neutral' : 'warn'} live>{band.connected ? 'Connected' : 'Not connected'}</StatusWord>
          <p className="mt-1 text-body text-muted text-pretty">{headline}</p>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <Fact term="Listening">
          <span className="inline-flex items-center gap-1.5">
            <ListeningMark state={listening ? 'listening' : 'idle'} />
            {listening ? 'Listening now' : 'Not listening'}
          </span>
        </Fact>
        <Fact term="Battery">
          <span className="block">{battery.word}</span>
          {band.battery_pct !== null ? (
            <span aria-hidden className="settings-battery mt-2" data-tone={battery.tone}>
              <span style={{ transform: `scaleX(${band.battery_pct / 100})` }} />
            </span>
          ) : null}
        </Fact>
        <Fact term="All-day listening">
          {band.always_on ? 'On. It listens all day.' : 'Off. It listens only after a double-tap.'}
        </Fact>
      </dl>

      <p className="text-body text-muted text-pretty">
        Teach Undertone your voice and how your hands move in <TextLink href="#calibration">Calibration</TextLink> above.
      </p>
    </div>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted">{term}</dt>
      <dd className="mt-1 text-body font-medium text-fg">{children}</dd>
    </div>
  );
}
