'use client';

import React from 'react';
import { Glyph } from '@/components/Glyph';
import type { HapticPattern } from '@/lib/bus/contracts';

const patterns: HapticPattern[] = [
  'tap', 'interrupt', 'filler', 'wrap_up', 'slow_down', 'still', 'success', 'approve',
  'status_good', 'status_talking', 'status_ask'
];

export default function StyleTile() {
  return (
    <div className="min-h-screen bg-[oklch(0.98_0.01_90)] text-[oklch(0.15_0.01_270)] p-8 md:p-16 lg:p-24 selection:bg-[oklch(0.9_0.0_0)] font-sans">
      
      <header className="mb-24 border-b border-[oklch(0.9_0.0_0)] pb-8">
        <h1 className="font-serif text-6xl md:text-8xl tracking-tight mb-4">Style Tile</h1>
        <p className="font-mono text-sm text-[oklch(0.5_0.0_0)] uppercase tracking-widest">Undertone Design System</p>
      </header>

      <section className="mb-24">
        <h2 className="font-mono text-xs uppercase tracking-widest text-[oklch(0.5_0.0_0)] mb-8">1. Palette (Paper & Ink)</h2>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-6">
          <Swatch label="Paper" color="bg-[oklch(0.98_0.01_90)]" border />
          <Swatch label="Paper Well" color="bg-[oklch(0.96_0.01_90)]" border />
          <Swatch label="Ink" color="bg-[oklch(0.15_0.01_270)] text-[oklch(0.98_0.01_90)]" />
          <Swatch label="Ink Mid" color="bg-[oklch(0.5_0.0_0)] text-white" />
          <Swatch label="Hairline" color="bg-[oklch(0.9_0.0_0)] text-[oklch(0.15_0.01_270)]" />
          <Swatch label="Other Speaker" color="bg-[oklch(0.6_0.02_60)] text-white" />
        </div>

        <h3 className="font-mono text-xs uppercase tracking-widest text-[oklch(0.5_0.0_0)] mt-16 mb-8">Semantic Pattern Colors</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-6">
          <Swatch label="Interrupt" color="bg-[oklch(0.6_0.2_25)] text-white" />
          <Swatch label="Wrap Up" color="bg-[oklch(0.7_0.18_70)] text-white" />
          <Swatch label="Filler" color="bg-[oklch(0.75_0.15_85)] text-white" />
          <Swatch label="Slow Down" color="bg-[oklch(0.6_0.15_250)] text-white" />
          <Swatch label="Still" color="bg-[oklch(0.6_0.15_300)] text-white" />
          <Swatch label="Success" color="bg-[oklch(0.65_0.15_150)] text-white" />
          <Swatch label="Tap/Approve" color="bg-[oklch(0.15_0.01_270)] text-[oklch(0.98_0.01_90)]" />
        </div>
      </section>

      <section className="mb-24 border-t border-[oklch(0.9_0.0_0)] pt-16">
        <h2 className="font-mono text-xs uppercase tracking-widest text-[oklch(0.5_0.0_0)] mb-12">2. Typography Scale</h2>
        
        <div className="space-y-16">
          <div>
            <div className="font-mono text-xs text-[oklch(0.5_0.0_0)] mb-4">Instrument Serif (Display)</div>
            <div className="font-serif text-7xl md:text-9xl leading-none tracking-tight">Let them finish.</div>
          </div>
          
          <div>
            <div className="font-mono text-xs text-[oklch(0.5_0.0_0)] mb-4">Geist (Interface Text)</div>
            <div className="font-sans text-xl md:text-3xl max-w-4xl leading-snug">
              The dashboard is the printed score; the phone is the metronome in your pocket.
            </div>
          </div>
          
          <div>
            <div className="font-mono text-xs text-[oklch(0.5_0.0_0)] mb-4">Geist Mono (Tabular Nums)</div>
            <div className="font-mono text-4xl md:text-6xl tabular-nums tracking-tight">
              184 wpm <span className="text-[oklch(0.5_0.0_0)] mx-4">·</span> 212 ms
            </div>
          </div>
        </div>
      </section>

      <section className="mb-24 border-t border-[oklch(0.9_0.0_0)] pt-16">
        <h2 className="font-mono text-xs uppercase tracking-widest text-[oklch(0.5_0.0_0)] mb-12">3. Haptic Glyphs Notation</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-y-12 gap-x-8">
          {patterns.map(pattern => (
            <div key={pattern} className="border border-[oklch(0.9_0.0_0)] p-8 flex flex-col items-center">
              <div className="font-mono text-xs uppercase tracking-widest mb-10 text-center w-full border-b border-[oklch(0.9_0.0_0)] pb-4">
                {pattern}
              </div>
              <div className="flex gap-16 items-end justify-center w-full h-32">
                <div className="flex flex-col items-center gap-6">
                  <div className="h-16 w-32 flex items-center justify-center">
                    <Glyph pattern={pattern} playing={false} className="w-full h-full text-[oklch(0.15_0.01_270)]" />
                  </div>
                  <span className="font-mono text-[10px] text-[oklch(0.5_0.0_0)] uppercase tracking-widest">Static</span>
                </div>
                <div className="flex flex-col items-center gap-6">
                  <div className="h-16 w-32 flex items-center justify-center">
                    {/* using a semantic color sample for playing state, though usually color maps to pattern */}
                    <Glyph pattern={pattern} playing={true} className="w-full h-full text-[oklch(0.6_0.2_25)]" />
                  </div>
                  <span className="font-mono text-[10px] text-[oklch(0.5_0.0_0)] uppercase tracking-widest">Playing</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-24 border-t border-[oklch(0.9_0.0_0)] pt-16">
        <h2 className="font-mono text-xs uppercase tracking-widest text-[oklch(0.5_0.0_0)] mb-12">4. Nudge Takeover Preview</h2>
        
        <div className="w-full bg-[oklch(0.6_0.2_25)] text-white py-24 px-8 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl">
          <div className="absolute inset-0 opacity-10 flex items-center justify-center pointer-events-none">
            <Glyph pattern="interrupt" playing={true} className="w-[150%] h-[150%]" />
          </div>
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="w-48 h-24 mb-10">
              <Glyph pattern="interrupt" playing={true} className="w-full h-full text-white" />
            </div>
            <h2 className="font-serif text-7xl md:text-9xl tracking-tight mb-8">Let them finish.</h2>
            <div className="font-mono text-sm uppercase tracking-widest opacity-80 flex items-center gap-4">
              <span>interrupted 0.91</span>
              <span>·</span>
              <span>slip → tap 1.2s</span>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}

function Swatch({ label, color, border = false }: { label: string, color: string, border?: boolean }) {
  return (
    <div className="flex flex-col">
      <div className={`aspect-square w-full mb-3 rounded-sm ${color} ${border ? 'border border-[oklch(0.9_0.0_0)]' : ''}`}></div>
      <div className="font-mono text-[10px] uppercase tracking-widest">{label}</div>
    </div>
  );
}
