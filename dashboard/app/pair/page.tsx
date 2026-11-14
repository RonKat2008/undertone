'use client';

import React from 'react';
import { QrPanel } from '@/components/pair/QrPanel';
import { DeviceList } from '@/components/pair/DeviceList';
import { AppAccessList } from '@/components/pair/AppAccessList';
import { GlyphReference } from '@/components/pair/GlyphReference';

export default function PairPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
      {/* Editorial Header */}
      <header className="border-b border-hairline pb-8 mb-10">
        <div className="flex items-center gap-2 mb-2 font-mono text-xs uppercase tracking-widest text-ink-mid">
          <span>Undertone</span>
          <span>/</span>
          <span>System & Devices</span>
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl text-ink font-normal tracking-tight mb-4">
          Pair & Devices
        </h1>
        <p className="text-base sm:text-lg text-ink-mid max-w-2xl font-sans leading-relaxed">
          Link your iPhone to serve as your pocket metronome, inspect live peripheral links, manage third-party haptic permissions, and audition the tactile notation score.
        </p>
      </header>

      {/* Main Sections */}
      <div className="space-y-12">
        {/* Section 1: Pairing QR & Code */}
        <section aria-labelledby="section-pairing">
          <QrPanel initialCode="UT-4829" />
        </section>

        {/* Section 2: Connected Devices (Phones & Band) */}
        <section aria-labelledby="section-devices">
          <DeviceList />
        </section>

        {/* Section 3: Connected Third-Party Apps & Pending Requests */}
        <section aria-labelledby="section-apps">
          <AppAccessList />
        </section>

        {/* Section 4: Compact Reference of all 11 Glyphs */}
        <section aria-labelledby="section-glyphs">
          <GlyphReference />
        </section>
      </div>
    </div>
  );
}
