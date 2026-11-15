'use client';

import { useEffect, useRef } from 'react';
import { smoothLevel } from '@/lib/practice/audio';
import type { PracticeSpeaker } from '@/lib/practice/model';
import { useReducedMotion } from '@/lib/use-reduced-motion';

export interface VoiceOrbProps {
  /** Who is speaking: amber for the coach, teal for you, a slow turn while thinking. */
  speaker: PracticeSpeaker | 'idle';
  /** Live loudness 0-1 of a voice, read every frame. */
  level?: (who: 'coach' | 'you') => number;
  size?: 'md' | 'lg';
}

/**
 * The living voice: a lit orb that swells with the real audio level of whoever is speaking
 * (the playback analyser for the coach, the microphone analyser for you). Transform and opacity
 * only, driven through one CSS variable; still under reduced motion.
 */
export function VoiceOrb({ speaker, level, size = 'lg' }: VoiceOrbProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || !level) return;
    let shown = 0;
    let raf = 0;
    const tick = () => {
      const measured = speaker === 'coach' || speaker === 'you' ? level(speaker) : 0;
      shown = smoothLevel(shown, measured);
      el.style.setProperty('--pr-level', shown.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.style.setProperty('--pr-level', '0');
    };
  }, [speaker, level, reduced]);

  return (
    <div ref={ref} className="pr-orb" data-speaker={speaker} data-size={size} aria-hidden>
      <span className="pr-orb-halo" />
      <span className="pr-orb-ring" data-i="1" />
      <span className="pr-orb-ring" data-i="2" />
      <span className="pr-orb-ring" data-i="3" />
      <span className="pr-orb-spin" />
      <span className="pr-orb-core" />
    </div>
  );
}
