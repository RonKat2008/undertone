import type { ReactNode } from 'react';

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export interface ShareBarProps {
  /** Your share of the talking, 0-1. Shown as a proportion, never as a number. */
  share: number;
  /** Says the share in words for screen readers and the legend: "You talked a little more than Sam". */
  label: string;
  /** Legend under the bar: left and right words, e.g. "You" and "Sam". */
  left?: ReactNode;
  right?: ReactNode;
}

/** Who did the talking: your part in teal, theirs in the person hue. */
export function ShareBar({ share, label, left = 'You', right = 'Them' }: ShareBarProps) {
  const s = clamp01(share);
  return (
    <div className="qi-bar" role="img" aria-label={label}>
      <div className="qi-bar-track">
        <span className="qi-bar-fill" data-tone="person" />
        <span className="qi-bar-fill" data-tone="accent" style={{ transform: `scaleX(${s})` }} />
      </div>
      <div className="qi-bar-legend" aria-hidden><b>{left}</b><b>{right}</b></div>
    </div>
  );
}

export interface PaceBarProps {
  /** Where you were, in the same units as min/max (e.g. words a minute). Never printed. */
  value: number;
  min: number;
  max: number;
  /** The comfortable zone, drawn in the habit hue. */
  zone: [number, number];
  /** Says it in words: "A little fast, just above your comfortable pace". */
  label: string;
  /** Legend words under the ends, e.g. "Slower" and "Faster". */
  low?: ReactNode;
  high?: ReactNode;
}

/** Where something sat against a comfortable range: a track, a green zone, a teal marker. */
export function PaceBar({ value, min, max, zone, label, low = 'Slower', high = 'Faster' }: PaceBarProps) {
  const span = max - min || 1;
  const at = clamp01((value - min) / span);
  const z0 = clamp01((zone[0] - min) / span);
  const z1 = clamp01((zone[1] - min) / span);
  return (
    <div className="qi-bar" role="img" aria-label={label}>
      <div className="qi-bar-track" data-has-marker="">
        <span className="qi-bar-zone" style={{ left: `${z0 * 100}%`, width: `${(z1 - z0) * 100}%` }} />
        {/* the wrapper is as wide as the track, so translateX(n%) moves the marker n% along it */}
        <span className="qi-bar-runner" style={{ transform: `translateX(${at * 100}%)` }}>
          <span className="qi-bar-marker" />
        </span>
      </div>
      <div className="qi-bar-legend" aria-hidden><span>{low}</span><span>{high}</span></div>
    </div>
  );
}
