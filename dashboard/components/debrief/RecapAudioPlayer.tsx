'use client';

import React, { useState, useEffect, useRef } from 'react';

interface RecapAudioPlayerProps {
  audioUrl?: string | null;
  summaryText?: string;
}

export function RecapAudioPlayer({
  audioUrl,
  summaryText = "Session recap: You interrupted 3 times in the first 5 minutes. Structure was strong. One fix: pause before answering. When they finish speaking, count to 2 before starting.",
}: RecapAudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<1.0 | 1.25 | 1.5>(1.0);
  const totalDuration = 20; // 20-second spoken recap
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Handle timer progression
  useEffect(() => {
    if (isPlaying) {
      const intervalMs = 200 / playbackRate;
      timerRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          const next = prev + 0.2;
          if (next >= totalDuration) {
            setIsPlaying(false);
            if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
              window.speechSynthesis.cancel();
            }
            return totalDuration;
          }
          return next;
        });
      }, intervalMs);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, playbackRate, totalDuration]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.pause();
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    } else {
      if (currentTime >= totalDuration) {
        setCurrentTime(0);
      }
      setIsPlaying(true);
      if (audioUrl && audioRef.current) {
        audioRef.current.play().catch(() => {});
      } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        } else {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(summaryText);
          utterance.rate = playbackRate;
          utterance.pitch = 1.0;
          utterance.onend = () => {
            setIsPlaying(false);
            setCurrentTime(totalDuration);
          };
          window.speechSynthesis.speak(utterance);
        }
      }
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = Math.round(pct * totalDuration * 10) / 10;
    setCurrentTime(newTime);
  };

  const cycleRate = () => {
    const rates: (1.0 | 1.25 | 1.5)[] = [1.0, 1.25, 1.5];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    setPlaybackRate(rates[nextIdx]);
  };

  const formatTime = (secs: number) => {
    const s = Math.floor(secs);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  };

  // 24 waveform bar representations
  const bars = [18, 35, 60, 42, 75, 90, 65, 40, 85, 70, 50, 60, 80, 95, 70, 45, 60, 78, 55, 30, 48, 65, 40, 25];

  return (
    <section className="py-8 border-b border-hairline space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-widest text-ink-mid">
            Spoken Recap
          </span>
          <span className="font-mono text-[11px] text-ink-mid">
            (20 Seconds)
          </span>
        </div>
        <div className="font-mono text-xs tabular-nums text-ink">
          {formatTime(currentTime)} / {formatTime(totalDuration)}
        </div>
      </div>

      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="none" />}

      {/* Styled Hardware Audio Console */}
      <div className="border border-hairline bg-paper-well p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
        {/* Play / Pause button */}
        <button
          onClick={togglePlay}
          className="w-12 h-12 shrink-0 border border-ink flex items-center justify-center hover:bg-ink hover:text-paper transition-colors focus-visible:ring-2 focus-visible:ring-ink"
          aria-label={isPlaying ? 'Pause audio recap' : 'Play 20-second audio recap'}
        >
          {isPlaying ? (
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-4 h-4 fill-current ml-0.5" viewBox="0 0 24 24">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        {/* Waveform Scrubber */}
        <div className="flex-1 w-full space-y-2">
          <div
            className="h-10 w-full flex items-end gap-[3px] sm:gap-1 cursor-pointer py-1 select-none"
            onClick={handleSeek}
            title="Click to scrub recap"
          >
            {bars.map((heightPct, idx) => {
              const barProgress = (idx / bars.length) * totalDuration;
              const isPast = currentTime >= barProgress;
              const isCurrent = isPlaying && Math.abs(currentTime - barProgress) < 1.0;
              return (
                <div
                  key={idx}
                  className="flex-1 bg-ink transition-all duration-75"
                  style={{
                    height: `${heightPct}%`,
                    opacity: isPast ? 0.95 : 0.2,
                    transform: isCurrent ? 'scaleY(1.15)' : 'scaleY(1)',
                  }}
                />
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-ink-mid">
            <span>00:00 START</span>
            <span>00:10 INTERACTION SUMMARY</span>
            <span>00:20 CUE PLAN</span>
          </div>
        </div>

        {/* Rate switch */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={cycleRate}
            className="px-2 py-1 border border-hairline font-mono text-xs tabular-nums text-ink hover:border-ink transition-colors"
            title="Toggle playback speed"
          >
            {playbackRate.toFixed(2).replace(/\.00$/, '')}×
          </button>
        </div>
      </div>
    </section>
  );
}
