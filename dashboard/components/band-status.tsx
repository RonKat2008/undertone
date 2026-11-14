'use client';

/**
 * The band, in one line: connected or not, listening or not, and "Listening all day" when
 * GET /band/status says `always_on`. Live state comes from the bus; the always-on flag is
 * re-read whenever the band's status changes (no polling).
 */
import { useEffect, useState } from 'react';
import { getBandAlwaysOn } from '@/lib/api/client';
import { useBus } from '@/lib/bus/use-bus';

export function BandStatus() {
  const { state } = useBus();
  const band = state.band;
  const [alwaysOn, setAlwaysOn] = useState<boolean | null>(null);
  const connected = band?.connected ?? false;
  const listening = band?.mic_on ?? false;

  useEffect(() => {
    let on = true;
    getBandAlwaysOn().then((v) => on && setAlwaysOn(v));
    return () => { on = false; };
  }, [connected, listening]);

  const text = !band ? 'Band: waiting' : !connected ? 'Band off' : alwaysOn ? 'Listening all day' : listening ? 'Listening' : 'Connected, not listening';
  const battery = band?.connected && band.battery_pct !== null ? `${Math.round(band.battery_pct)}%` : null;
  return (
    <span className="flex items-center gap-2 text-[12px]" role="status" aria-label={`Band status: ${text}`}
      title={listening ? 'The band’s light is solid blue: the mic is on' : undefined}>
      <span className={`inline-block h-2 w-2 rounded-full ${listening || alwaysOn ? 'live-dot bg-mic' : connected ? 'bg-ink' : 'border border-ink-3'}`} aria-hidden />
      <span className="caps !text-ink">{text}</span>
      {battery && <span className="num text-ink-2">{battery}</span>}
    </span>
  );
}
