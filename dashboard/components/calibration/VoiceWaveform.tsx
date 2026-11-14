'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';

interface VoiceWaveformProps {
  listening: boolean;
  className?: string;
  identifiedSpeaker?: 'me' | 'other' | null;
}

const LOCKED_BARS = [
  0.12, 0.22, 0.45, 0.65, 0.88, 0.94, 0.72, 0.54, 0.48, 0.62,
  0.78, 0.85, 0.68, 0.52, 0.41, 0.35, 0.31, 0.28, 0.38, 0.44,
  0.32, 0.25, 0.21, 0.18, 0.15, 0.12, 0.11, 0.09, 0.08, 0.07,
  0.06, 0.05,
];

const STATIC_ACTIVE_BARS = [
  0.2, 0.35, 0.6, 0.8, 0.9, 0.75, 0.6, 0.55, 0.7, 0.85,
  0.7, 0.5, 0.4, 0.35, 0.3, 0.45, 0.55, 0.4, 0.3, 0.25,
  0.2, 0.18, 0.15, 0.12, 0.1, 0.09, 0.08, 0.08, 0.07, 0.06,
  0.05, 0.05,
];

const AMBIENT_BARS = Array(32).fill(0.06);

export function VoiceWaveform({
  listening,
  className = '',
  identifiedSpeaker = null,
}: VoiceWaveformProps) {
  const barCount = 32;
  const [liveBars, setLiveBars] = useState<number[]>(() => Array(barCount).fill(0.08));
  const [liveDbfs, setLiveDbfs] = useState<number>(-18.5);
  const [livePitch, setLivePitch] = useState<number>(124);
  const animRef = useRef<number | null>(null);

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!listening) return;

    const isReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (isReduced) return;

    let t = 0;
    const update = () => {
      t += 0.08;
      const nextBars = Array.from({ length: barCount }, (_, i) => {
        const f1 = Math.exp(-Math.pow((i - 5) / 2.8, 2)) * (0.65 + Math.sin(t * 3 + i) * 0.25);
        const f2 = Math.exp(-Math.pow((i - 12) / 3.5, 2)) * (0.55 + Math.cos(t * 2.5 + i) * 0.2);
        const f3 = Math.exp(-Math.pow((i - 20) / 4.0, 2)) * (0.35 + Math.sin(t * 1.8) * 0.15);
        const noise = (Math.random() - 0.5) * 0.08;
        return Math.max(0.06, Math.min(1.0, f1 + f2 + f3 + noise));
      });

      setLiveBars(nextBars);
      setLiveDbfs(-18.5 + (Math.sin(t * 4) * 4.2 + (Math.random() - 0.5) * 1.5));
      setLivePitch(Math.round(124 + Math.sin(t * 2) * 8 + (Math.random() - 0.5) * 3));

      animRef.current = requestAnimationFrame(update);
    };

    animRef.current = requestAnimationFrame(update);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [listening, barCount]);

  // Derived state depending on listening and identifiedSpeaker
  const bars = useMemo(() => {
    if (!listening) {
      return identifiedSpeaker ? LOCKED_BARS : AMBIENT_BARS;
    }
    if (prefersReducedMotion) {
      return STATIC_ACTIVE_BARS;
    }
    return liveBars;
  }, [listening, identifiedSpeaker, prefersReducedMotion, liveBars]);

  const dbfs = !listening
    ? identifiedSpeaker
      ? -18.2
      : -56.4
    : prefersReducedMotion
    ? -19.5
    : liveDbfs;

  const pitch = !listening
    ? identifiedSpeaker
      ? identifiedSpeaker === 'me'
        ? 124
        : 198
      : 0
    : prefersReducedMotion
    ? 126
    : livePitch;

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Telemetry bar */}
      <div className="flex items-center justify-between font-mono text-xs uppercase tracking-wider text-ink-mid mb-2 border-b border-hairline pb-1.5">
        <span className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full inline-block ${
              listening ? 'bg-blue-600 animate-pulse' : identifiedSpeaker ? 'bg-green-600' : 'bg-hairline'
            }`}
            aria-hidden="true"
          />
          <span>Acoustic Spectrum (0.1–8.0 kHz)</span>
        </span>
        <span className="tabular-nums text-ink font-medium flex items-center gap-3">
          <span>{dbfs.toFixed(1)} dBFS</span>
          <span className="text-hairline">|</span>
          <span>{pitch > 0 ? `${pitch} Hz f₀` : 'No carrier'}</span>
        </span>
      </div>

      {/* Spectrum visualizer bars */}
      <div
        className="w-full h-24 bg-paper border border-hairline p-3 flex items-end justify-between gap-[3px]"
        aria-label="Acoustic frequency spectrum visualizer"
      >
        {bars.map((heightRatio, idx) => (
          <div
            key={idx}
            className="flex-1 bg-ink/80 transition-all duration-75 motion-reduce:transition-none"
            style={{
              height: `${Math.round(heightRatio * 100)}%`,
              minHeight: '2px',
              backgroundColor: identifiedSpeaker === 'me'
                ? 'var(--ink)'
                : identifiedSpeaker === 'other'
                ? 'var(--other)'
                : listening
                ? 'var(--ink)'
                : 'var(--hairline)',
            }}
          />
        ))}
      </div>

      {/* Axis markers */}
      <div className="flex justify-between font-mono text-[9px] text-ink-mid uppercase tracking-widest mt-1.5 px-1 select-none">
        <span>100 Hz</span>
        <span>1.2 kHz</span>
        <span>3.5 kHz</span>
        <span>8.0 kHz</span>
      </div>
    </div>
  );
}
