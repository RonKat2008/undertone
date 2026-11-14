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
  // §2.4: listening is an ink dot in a breathing ring, connected a filled dot, off a hollow ring. Never a hue.
  const mark = listening || alwaysOn ? 'state-listening' : connected ? 'state-on' : '';
  return (
    <span className="text-s flex items-center gap-2" role="status" aria-label={`Band status: ${text}`}
      title={listening ? 'The band’s light is solid blue: the mic is on' : undefined}>
      <span className={`state ${mark}`} aria-hidden />
      <span className={connected ? 'text-ink' : 'text-ink-2'}>{text}</span>
      {battery && <span className="num-s text-ink-3">{battery}</span>}
    </span>
  );
}
