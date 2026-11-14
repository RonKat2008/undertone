'use client';

import React from 'react';
import { Metrics } from '@/lib/bus/contracts';

interface KeyMetricsProps {
  numbers: Pick<Metrics, 'talk_ratio' | 'interruptions' | 'questions' | 'fillers_per_min' | 'wpm'>;
  vsLastTime: string | null;
}

export function KeyMetrics({ numbers, vsLastTime }: KeyMetricsProps) {
  const talkPct = Math.round((numbers?.talk_ratio ?? 0.5) * 100);
  const interruptions = numbers?.interruptions ?? 0;
  const questions = numbers?.questions ?? 0;
  const fillers = typeof numbers?.fillers_per_min === 'number'
    ? numbers.fillers_per_min.toFixed(1)
    : '0.0';
  const wpm = Math.round(numbers?.wpm ?? 0);

  const metricItems = [
    {
      label: 'Talk Ratio',
      value: `${talkPct}%`,
      sub: `${100 - talkPct}% listener`,
    },
    {
      label: 'Interruptions',
      value: interruptions.toString(),
      sub: 'speech overlaps',
    },
    {
      label: 'Questions Asked',
      value: questions.toString(),
      sub: 'inquiries posed',
    },
    {
      label: 'Fillers / Min',
      value: fillers,
      sub: 'rate per minute',
    },
    {
      label: 'Rolling Pace',
      value: `${wpm}`,
      sub: 'words per minute',
    },
  ];

  return (
    <section className="py-10 border-b border-hairline space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-mid">
          Conversation Metrics
        </h3>
        <span className="font-mono text-[11px] text-ink-mid">
          5 Core Indicators
        </span>
      </div>

      {/* 5 numbers in an editorial hairline grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-hairline border-y border-hairline">
        {metricItems.map((item, idx) => (
          <div
            key={item.label}
            className={`py-5 px-3 sm:px-4 ${idx === 0 ? 'pl-0' : ''} ${
              idx === metricItems.length - 1 ? 'pr-0' : ''
            }`}
          >
            <div className="font-mono text-[10px] sm:text-[11px] uppercase tracking-wider text-ink-mid mb-2">
              {item.label}
            </div>
            <div className="font-mono text-3xl sm:text-4xl md:text-5xl font-normal tabular-nums text-ink tracking-tight">
              {item.value}
            </div>
            <div className="font-mono text-[11px] text-ink-mid mt-1">
              {item.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Quiet comparison with wearer's own past only */}
      <div className="pt-2 flex items-baseline gap-3 text-xs md:text-sm font-sans text-ink-mid">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink px-1.5 py-0.5 border border-hairline bg-paper-well shrink-0">
          vs Own Past
        </span>
        {vsLastTime ? (
          <p className="leading-relaxed">
            {vsLastTime}
          </p>
        ) : (
          <p className="italic text-ink-mid">
            First recorded session with this coach. Baseline will establish across future conversations.
          </p>
        )}
      </div>
    </section>
  );
}
