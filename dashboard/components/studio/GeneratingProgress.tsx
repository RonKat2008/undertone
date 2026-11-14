'use client';

import React, { useEffect, useState } from 'react';

interface GeneratingProgressProps {
  goal: string;
}

const GENERATION_STEPS = [
  { label: 'Analyzing conversational goal and setting behavioral anchors', duration: 400 },
  { label: 'Synthesizing judge queries (noul, choice classifications, and 5-tier scoring)', duration: 600 },
  { label: 'Mapping trigger conditions to tactile haptic patterns (interrupt, wrap_up, still)', duration: 600 },
  { label: 'Configuring focus habit policy, session buzz budget, and minimum spacing', duration: 500 },
  { label: 'Drafting debrief rubric and interactive practice partner persona', duration: 400 },
];

export function GeneratingProgress({ goal }: GeneratingProgressProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 50);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let accumulated = 0;
    const timers: NodeJS.Timeout[] = [];

    GENERATION_STEPS.forEach((step, index) => {
      accumulated += step.duration;
      const t = setTimeout(() => {
        setCurrentStep(index + 1);
      }, accumulated);
      timers.push(t);
    });

    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="my-12 p-8 border border-ink bg-paper-well animate-in fade-in duration-300">
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-hairline pb-4 mb-6">
        <div>
          <span className="font-mono text-xs uppercase tracking-widest text-ink-mid">
            Authoring Coach Spec
          </span>
          <h3 className="font-serif text-2xl text-ink mt-1 italic">
            &ldquo;I want to {goal}&rdquo;
          </h3>
        </div>
        <div className="font-mono tabular-nums text-sm text-ink-mid">
          {elapsedMs} ms <span className="text-ink">· compiling</span>
        </div>
      </div>

      <div className="space-y-4 font-mono text-xs">
        {GENERATION_STEPS.map((step, idx) => {
          const isDone = currentStep > idx;
          const isCurrent = currentStep === idx;
          return (
            <div
              key={idx}
              className={`flex items-start gap-4 transition-opacity duration-300 ${
                isDone
                  ? 'text-ink opacity-100'
                  : isCurrent
                  ? 'text-ink opacity-90'
                  : 'text-ink-mid/40 opacity-40'
              }`}
            >
              <span className="tabular-nums shrink-0 font-medium w-6">
                {isDone ? '✓' : isCurrent ? '→' : `0${idx + 1}`}
              </span>
              <span className="flex-1 font-sans text-sm">
                {step.label}
              </span>
              {isDone && (
                <span className="text-[10px] uppercase tracking-wider text-ink-mid shrink-0 font-mono">
                  Ready
                </span>
              )}
              {isCurrent && (
                <span className="text-[10px] uppercase tracking-wider text-ink shrink-0 font-mono animate-pulse">
                  Writing…
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
