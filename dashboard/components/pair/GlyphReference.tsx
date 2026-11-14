'use client';

import React, { useState } from 'react';
import { Glyph, HapticPattern } from '@/components/Glyph';

interface PatternMeta {
  pattern: HapticPattern;
  name: string;
  category: 'Nudge' | 'Status' | 'System';
  feel: string;
  meaning: string;
  actionCue: string;
  colorHex: string;
  colorName: string;
}

const GLYPH_CATALOG: PatternMeta[] = [
  {
    pattern: 'tap',
    name: 'tap',
    category: 'System',
    feel: '1 light tick',
    meaning: 'Generic feedback or acknowledged tap',
    actionCue: 'Acknowledge',
    colorHex: 'currentColor',
    colorName: 'Ink',
  },
  {
    pattern: 'interrupt',
    name: 'interrupt',
    category: 'Nudge',
    feel: '2 sharp heavy taps, close together',
    meaning: 'You cut the other speaker off in mid-thought',
    actionCue: 'Let them finish',
    colorHex: '#E03C31',
    colorName: 'Vermilion',
  },
  {
    pattern: 'filler',
    name: 'filler',
    category: 'Nudge',
    feel: '1 short medium bar',
    meaning: 'Excessive filler words (um, like, basically) or hedging',
    actionCue: 'Pause silently',
    colorHex: '#B48A14',
    colorName: 'Ochre',
  },
  {
    pattern: 'wrap_up',
    name: 'wrap_up',
    category: 'Nudge',
    feel: '3 rising taps stepping up in height',
    meaning: 'Monologue length exceeded conversation budget',
    actionCue: 'Ask a question',
    colorHex: '#D97706',
    colorName: 'Amber',
  },
  {
    pattern: 'slow_down',
    name: 'slow_down',
    category: 'Nudge',
    feel: '1 long wedge rising slowly',
    meaning: 'Speaking pace accelerated above baseline pace',
    actionCue: 'Slow down',
    colorHex: '#2563EB',
    colorName: 'Blue',
  },
  {
    pattern: 'still',
    name: 'still',
    category: 'Nudge',
    feel: '2 soft slow pulses, far apart',
    meaning: 'Excessive fidgeting or hand tension while listening',
    actionCue: 'Hands calm',
    colorHex: '#7C3AED',
    colorName: 'Violet',
  },
  {
    pattern: 'success',
    name: 'success',
    category: 'Nudge',
    feel: 'Bright double (low bar then tall bar)',
    meaning: 'A clear good conversational moment (used sparingly)',
    actionCue: 'Reinforce flow',
    colorHex: '#16A34A',
    colorName: 'Green',
  },
  {
    pattern: 'approve',
    name: 'approve',
    category: 'System',
    feel: '2 tiny selection ticks',
    meaning: 'Pending action or app request waiting for approval',
    actionCue: 'Review item',
    colorHex: 'currentColor',
    colorName: 'Ink',
  },
  {
    pattern: 'status_good',
    name: 'status_good',
    category: 'Status',
    feel: '1 slow, even buzz',
    meaning: 'Reply to single tap: Balanced speaking ratio and steady pace',
    actionCue: 'Doing well',
    colorHex: 'currentColor',
    colorName: 'Ink',
  },
  {
    pattern: 'status_talking',
    name: 'status_talking',
    category: 'Status',
    feel: '2 slow, even buzzes',
    meaning: 'Reply to single tap: You have held the floor too long',
    actionCue: 'Talking too much',
    colorHex: 'currentColor',
    colorName: 'Ink',
  },
  {
    pattern: 'status_ask',
    name: 'status_ask',
    category: 'Status',
    feel: '3 slow, even buzzes',
    meaning: 'Reply to single tap: Yield the turn and pass conversational initiative',
    actionCue: 'Ask a question',
    colorHex: 'currentColor',
    colorName: 'Ink',
  },
];

export function GlyphReference() {
  const [playingSet, setPlayingSet] = useState<Record<string, boolean>>({});

  const togglePlay = (pattern: HapticPattern) => {
    setPlayingSet((prev) => {
      const nextState = !prev[pattern];
      const updated = { ...prev, [pattern]: nextState };
      if (nextState) {
        // Auto reset after 3 seconds if not toggled off
        setTimeout(() => {
          setPlayingSet((current) => ({ ...current, [pattern]: false }));
        }, 3000);
      }
      return updated;
    });
  };

  const handlePlayAll = () => {
    const allPlaying: Record<string, boolean> = {};
    GLYPH_CATALOG.forEach((item) => {
      allPlaying[item.pattern] = true;
    });
    setPlayingSet(allPlaying);
    setTimeout(() => {
      setPlayingSet({});
    }, 3500);
  };

  const handleStopAll = () => {
    setPlayingSet({});
  };

  const isAnyPlaying = Object.values(playingSet).some(Boolean);

  return (
    <div className="pt-2 pb-16">
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4 mb-6">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-ink-mid block mb-1">
            03 / Tactile Notation
          </span>
          <h3 className="font-serif text-2xl text-ink font-normal">Glyph Reference Score</h3>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-mid font-mono hidden sm:inline">
            Click any pattern to audition vibration rhythm
          </span>
          <button
            type="button"
            onClick={isAnyPlaying ? handleStopAll : handlePlayAll}
            className="px-3 py-1.5 border border-hairline hover:border-ink font-mono text-xs text-ink transition-colors cursor-pointer"
          >
            {isAnyPlaying ? 'Stop All Animations' : 'Audition All (3s)'}
          </button>
        </div>
      </div>

      <p className="text-sm text-ink-mid font-sans max-w-3xl leading-relaxed mb-6">
        Every conversational nudge maps rhythm to physical form. Bars sit on a shared baseline:
        width is duration, height is intensity, and gaps represent silence between successive motor pulses.
      </p>

      {/* Reference Table */}
      <div className="border-t border-hairline overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[680px]">
          <thead>
            <tr className="border-b border-hairline font-mono text-xs uppercase tracking-wider text-ink-mid">
              <th className="py-3 px-3 font-normal w-20 text-center">Score</th>
              <th className="py-3 px-4 font-normal w-36">Pattern</th>
              <th className="py-3 px-4 font-normal w-48">Feel & Pulse</th>
              <th className="py-3 px-4 font-normal">Meaning & Actionable Cue</th>
              <th className="py-3 px-4 font-normal w-28 text-right">Rhythm</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline font-sans text-sm">
            {GLYPH_CATALOG.map((item) => {
              const isPlaying = Boolean(playingSet[item.pattern]);

              return (
                <tr
                  key={item.pattern}
                  onClick={() => togglePlay(item.pattern)}
                  className="group hover:bg-paper-well/60 transition-colors cursor-pointer select-none"
                >
                  {/* Glyph visualization */}
                  <td className="py-3.5 px-3 text-center align-middle">
                    <div className="inline-flex items-center justify-center p-1 bg-white/40 border border-hairline/60 group-hover:border-ink/20 transition-colors">
                      <Glyph
                        pattern={item.pattern}
                        playing={isPlaying}
                        size="sm"
                      />
                    </div>
                  </td>

                  {/* Pattern Name + Category */}
                  <td className="py-3.5 px-4 align-middle">
                    <div className="font-mono text-sm font-semibold text-ink">
                      {item.name}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{
                          backgroundColor:
                            item.colorHex === 'currentColor' ? 'var(--ink)' : item.colorHex,
                        }}
                      />
                      <span className="font-mono text-[11px] text-ink-mid">
                        {item.colorName}
                      </span>
                    </div>
                  </td>

                  {/* Physical Feel */}
                  <td className="py-3.5 px-4 align-middle text-ink-mid text-xs font-mono">
                    {item.feel}
                  </td>

                  {/* Meaning & Cue */}
                  <td className="py-3.5 px-4 align-middle">
                    <div className="text-sm text-ink leading-snug">
                      {item.meaning}
                    </div>
                    <div className="mt-0.5 font-serif italic text-xs text-ink-mid">
                      Prompt: &ldquo;{item.actionCue}&rdquo;
                    </div>
                  </td>

                  {/* Play trigger button */}
                  <td className="py-3.5 px-4 align-middle text-right font-mono text-xs">
                    <span
                      className={`inline-block px-2.5 py-1 border transition-colors ${
                        isPlaying
                          ? 'border-ink bg-ink text-paper'
                          : 'border-hairline text-ink-mid group-hover:border-ink group-hover:text-ink'
                      }`}
                    >
                      {isPlaying ? 'Playing…' : 'Play'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between text-xs text-ink-mid font-mono">
        <span>Respects system prefers-reduced-motion settings.</span>
        <span>Hardware: LRA (Linear Resonant Actuator) 170Hz</span>
      </div>
    </div>
  );
}
