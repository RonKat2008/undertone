'use client';

import React, { useState, useEffect, useRef } from 'react';

interface BetterVersionData {
  original: string;
  rewritten: string;
  audio_url: string | null;
}

interface HearBetterVersionProps {
  betterVersion: BetterVersionData | null;
}

export function HearBetterVersion({ betterVersion }: HearBetterVersionProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isPlaying) {
      const startTime = Date.now();
      const durationMs = 4000; // 4-second simulated sentence

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const pct = Math.min(100, (elapsed / durationMs) * 100);
        setProgress(pct);

        if (pct >= 100) {
          setIsPlaying(false);
          setProgress(0);
          if (timerRef.current) clearInterval(timerRef.current);
        }
      }, 50);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      setProgress(0);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } else {
      setProgress(0);
      setIsPlaying(true);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && betterVersion?.rewritten) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(betterVersion.rewritten);
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        utterance.onend = () => {
          setIsPlaying(false);
          setProgress(0);
        };
        window.speechSynthesis.speak(utterance);
      }
    }
  };

  if (!betterVersion) {
    return (
      <section className="py-10 space-y-4">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-mid">
          Hear the Better Version
        </h3>
        <p className="font-sans text-sm text-ink-mid italic border border-dashed border-hairline py-6 text-center">
          No weak answers required revision in this session.
        </p>
      </section>
    );
  }

  return (
    <section className="py-10 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-mid">
            Hear the Better Version
          </h3>
          <p className="font-sans text-xs text-ink-mid mt-0.5">
            Comparing the weakest answer directly against an authoritative rewrite
          </p>
        </div>
        <span className="font-mono text-[11px] text-ink-mid">
          Behavioral Coaching Rewrite
        </span>
      </div>

      {/* Two-column side-by-side comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-hairline border-y border-hairline">
        {/* Original answer */}
        <div className="py-6 md:pr-8 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mid">
              As Spoken (Weakest Answer)
            </span>
            <span className="text-[10px] font-mono text-[oklch(0.75_0.15_85)] uppercase">
              Hesitant phrasing
            </span>
          </div>

          <blockquote className="font-sans text-base sm:text-lg text-ink-mid leading-relaxed italic bg-paper-well/40 p-4 border-l-2 border-hairline">
            &ldquo;{betterVersion.original}&rdquo;
          </blockquote>

          <p className="font-sans text-xs text-ink-mid">
            Observation: Multiple fillers and hedging weakened the conclusion.
          </p>
        </div>

        {/* Rewritten answer with simulated play control */}
        <div className="py-6 md:pl-8 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink font-semibold">
              Clearer Alternative (Rewritten)
            </span>
            <span className="text-[10px] font-mono text-ink uppercase tracking-wider">
              Direct & Grounded
            </span>
          </div>

          <blockquote className="font-sans text-base sm:text-lg text-ink font-medium leading-relaxed bg-paper-well p-4 border-l-2 border-ink">
            &ldquo;{betterVersion.rewritten}&rdquo;
          </blockquote>

          {/* Simulated Play Control */}
          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <button
                onClick={togglePlay}
                className="font-mono text-xs px-4 py-2 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors flex items-center gap-2.5 focus-visible:ring-2 focus-visible:ring-ink"
                aria-label={isPlaying ? 'Pause simulated audio' : 'Play rewritten version audio'}
              >
                {isPlaying ? (
                  <>
                    <span className="w-2.5 h-2.5 bg-current" />
                    <span>Stop playback</span>
                  </>
                ) : (
                  <>
                    <span className="w-0 h-0 border-y-[4px] border-y-transparent border-l-[7px] border-l-current" />
                    <span>Play rewritten version (0:04)</span>
                  </>
                )}
              </button>

              <span className="font-mono text-xs tabular-nums text-ink-mid">
                {isPlaying ? 'Simulating delivery...' : 'Synthetic voice preview'}
              </span>
            </div>

            {/* Playback progress bar */}
            {isPlaying && (
              <div className="w-full bg-hairline h-1 relative overflow-hidden">
                <div
                  className="bg-ink h-full transition-all duration-75"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
