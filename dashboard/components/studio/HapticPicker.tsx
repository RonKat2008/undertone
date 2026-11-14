'use client';

import React, { useState } from 'react';
import { Glyph } from '@/components/Glyph';
import type { HapticPattern } from '@/lib/bus/contracts';

export interface HapticDescriptor {
  pattern: HapticPattern;
  name: string;
  feel: string;
  intent: string;
  colorName: string;
}

export const HAPTIC_PATTERNS: HapticDescriptor[] = [
  { pattern: 'interrupt', name: 'Interrupt', feel: '2 sharp heavy taps', intent: 'Cut them off → "let them finish"', colorName: 'Vermilion' },
  { pattern: 'wrap_up', name: 'Wrap Up', feel: '3 rising taps', intent: 'Talking too long → "ask a question"', colorName: 'Amber' },
  { pattern: 'filler', name: 'Filler', feel: '1 short medium pulse', intent: 'Filler word or hedge → "pause"', colorName: 'Ochre' },
  { pattern: 'slow_down', name: 'Slow Down', feel: 'Long soft ramp', intent: 'Pace too fast → "slow down"', colorName: 'Blue' },
  { pattern: 'still', name: 'Still', feel: '2 soft slow pulses', intent: 'Fidgeting or restless hands → "hands calm"', colorName: 'Violet' },
  { pattern: 'success', name: 'Success', feel: 'Bright double tap', intent: 'Clear good moment / breakthrough', colorName: 'Green' },
  { pattern: 'tap', name: 'Tap', feel: '1 light tick', intent: 'Generic reminder or acknowledgment', colorName: 'Ink' },
  { pattern: 'approve', name: 'Approve', feel: '2 tiny ticks', intent: 'Awaiting wearer confirmation', colorName: 'Ink' },
  { pattern: 'status_good', name: 'Status: Good', feel: '1 slow, even buzz', intent: 'Answer to tap: pacing is sound', colorName: 'Ink' },
  { pattern: 'status_talking', name: 'Status: Talking', feel: '2 slow, even buzzes', intent: 'Answer to tap: talking too much', colorName: 'Ink' },
  { pattern: 'status_ask', name: 'Status: Ask', feel: '3 slow, even buzzes', intent: 'Answer to tap: ask a question', colorName: 'Ink' },
];

interface HapticPickerProps {
  value: HapticPattern;
  onChange: (pattern: HapticPattern) => void;
  disabled?: boolean;
}

export function HapticPicker({ value, onChange, disabled = false }: HapticPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredPattern, setHoveredPattern] = useState<HapticPattern | null>(null);

  const selectedDesc = HAPTIC_PATTERNS.find(p => p.pattern === value) || HAPTIC_PATTERNS[0];

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-2.5 py-1.5 border border-hairline hover:border-ink bg-paper hover:bg-paper-well transition-colors text-xs font-mono group"
        title="Choose haptic pattern"
      >
        <div className="w-5 h-5 flex items-center justify-center shrink-0">
          <Glyph pattern={value} playing={hoveredPattern === value} size="sm" />
        </div>
        <span className="font-sans font-medium text-ink">{selectedDesc.name}</span>
        <span className="text-[10px] text-ink-mid hidden sm:inline">({selectedDesc.feel})</span>
        <span className="text-ink-mid text-[10px] ml-1">▼</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-ink/10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full mt-1 z-50 w-80 max-h-96 overflow-y-auto bg-paper border border-ink shadow-none">
            <div className="p-2 border-b border-hairline bg-paper-well flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mid">Select Haptic Sensation</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="font-mono text-xs text-ink-mid hover:text-ink px-1"
              >
                ✕
              </button>
            </div>
            <div className="divide-y divide-hairline">
              {HAPTIC_PATTERNS.map((item) => {
                const isSelected = item.pattern === value;
                const isHovered = hoveredPattern === item.pattern;
                return (
                  <button
                    key={item.pattern}
                    type="button"
                    onMouseEnter={() => setHoveredPattern(item.pattern)}
                    onMouseLeave={() => setHoveredPattern(null)}
                    onClick={() => {
                      onChange(item.pattern);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left p-3 flex items-start gap-3 transition-colors ${
                      isSelected ? 'bg-paper-well border-l-2 border-ink' : 'hover:bg-paper-well'
                    }`}
                  >
                    <div className="w-8 h-8 shrink-0 flex items-center justify-center border border-hairline bg-paper">
                      <Glyph pattern={item.pattern} playing={isHovered || isSelected} size="sm" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-xs font-medium text-ink">{item.name}</span>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-mid">{item.colorName}</span>
                      </div>
                      <p className="font-mono text-[10px] text-ink-mid truncate mt-0.5">{item.feel}</p>
                      <p className="font-sans text-[11px] text-ink/80 italic mt-0.5">{item.intent}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
