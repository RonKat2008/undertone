'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ProgressRing } from './ProgressRing';
import { MotionTrace } from './MotionTrace';
import { Glyph } from '@/components/Glyph';
import { useBus } from '@/lib/bus/use-bus';
import type { MotionState } from '@/lib/bus/contracts';

interface StepConfig {
  key: MotionState;
  title: string;
  durationS: number;
  instruction: string;
  expectedRange: string;
  targetGlyph: 'still' | 'tap';
  accentColor: string;
}

const STEPS: StepConfig[] = [
  {
    key: 'still',
    title: 'Hold Still',
    durationS: 5,
    instruction: 'Rest hands flat on the desk or table. Avoid finger tapping or wrist movement.',
    expectedRange: '< 0.08 g',
    targetGlyph: 'still',
    accentColor: 'var(--p-still, #7C3AED)',
  },
  {
    key: 'gesture',
    title: 'Gesture Naturally',
    durationS: 5,
    instruction: 'Speak and move hands freely as you would when explaining an idea in conversation.',
    expectedRange: '0.25 g – 0.65 g',
    targetGlyph: 'tap',
    accentColor: 'var(--ink, #111827)',
  },
  {
    key: 'fidget',
    title: 'Fidget & Tap',
    durationS: 5,
    instruction: 'Tap fingers rapidly on the table, click a pen, or shake your wrist to test fidget detection.',
    expectedRange: '> 0.80 g',
    targetGlyph: 'still',
    accentColor: 'var(--p-interrupt, #E03C31)',
  },
];

export function MotionCalibration() {
  const { injectEvent, setMotionState } = useBus();
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isCalibrated, setIsCalibrated] = useState<boolean>(false);
  const [elapsedInStep, setElapsedInStep] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const activeStep = STEPS[currentStepIdx];

  // Run the 5-second countdown loop per step
  useEffect(() => {
    if (!isRunning || isCalibrated) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const intervalMs = 50;
    timerRef.current = setInterval(() => {
      setElapsedInStep((prev) => {
        const next = prev + intervalMs / 1000;
        if (next >= activeStep.durationS) {
          // Current 5s step finished!
          if (currentStepIdx < STEPS.length - 1) {
            // Advance to next step
            setCurrentStepIdx((idx) => idx + 1);
            injectEvent({
              type: 'calibration',
              kind: 'motion',
              step: STEPS[currentStepIdx + 1].key,
              done: false,
            });
            // Update bus motion state simulation
            setMotionState(
              STEPS[currentStepIdx + 1].key,
              currentStepIdx + 1 === 1 ? 0.45 : 0.95
            );
            return 0;
          } else {
            // All 3 steps complete!
            setIsRunning(false);
            setIsCalibrated(true);
            injectEvent({
              type: 'calibration',
              kind: 'motion',
              step: 'calibrated',
              done: true,
            });
            setMotionState('still', 0.02);
            return activeStep.durationS;
          }
        }
        return next;
      });
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning, isCalibrated, currentStepIdx, activeStep, injectEvent, setMotionState]);

  const handleStart = () => {
    setIsCalibrated(false);
    setCurrentStepIdx(0);
    setElapsedInStep(0);
    setIsRunning(true);
    setMotionState('still', 0.02);
    injectEvent({
      type: 'calibration',
      kind: 'motion',
      step: 'still',
      done: false,
    });
  };

  const handlePause = () => {
    setIsRunning(false);
  };

  const handleResume = () => {
    setIsRunning(true);
  };

  const handleRerun = () => {
    handleStart();
  };

  const handleJumpToStep = (idx: number) => {
    setIsRunning(false);
    setCurrentStepIdx(idx);
    setElapsedInStep(0);
  };

  const stepProgress = Math.min(1, elapsedInStep / activeStep.durationS);
  const timeRemaining = Math.max(0, activeStep.durationS - elapsedInStep);

  return (
    <section className="flex flex-col pt-8">
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-2 mb-8">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-ink-mid mb-1">
            Stage 02 · 3-Axis Accelerometer Baseline
          </div>
          <h3 className="font-serif text-3xl md:text-4xl tracking-tight text-ink">
            Motion Calibration
          </h3>
        </div>
        <div className="font-mono text-xs">
          {isCalibrated ? (
            <span className="text-[oklch(0.65_0.15_150)] font-medium uppercase tracking-wider">
              Calibrated · Baseline Locked
            </span>
          ) : isRunning ? (
            <span className="text-ink font-medium uppercase tracking-wider">
              Step {currentStepIdx + 1} of 3 in progress
            </span>
          ) : (
            <span className="text-ink-mid uppercase tracking-wider">
              Three 5-second steps
            </span>
          )}
        </div>
      </div>

      {/* Steps Navigation Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 border border-hairline mb-8 divide-y md:divide-y-0 md:divide-x divide-hairline">
        {STEPS.map((s, idx) => {
          const isCurrent = idx === currentStepIdx && !isCalibrated;
          const isDone = isCalibrated || idx < currentStepIdx;
          return (
            <button
              key={s.key}
              onClick={() => handleJumpToStep(idx)}
              className={`p-4 text-left transition-colors flex flex-col justify-between ${
                isCurrent
                  ? 'bg-paper-well text-ink'
                  : 'bg-paper text-ink-mid hover:text-ink'
              }`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <span className="font-mono text-[10px] uppercase tracking-widest">
                  Step 0{idx + 1} · 5.0 s
                </span>
                {isDone && (
                  <span className="font-mono text-[10px] text-[oklch(0.65_0.15_150)] uppercase tracking-wider font-semibold">
                    Done
                  </span>
                )}
                {isCurrent && isRunning && (
                  <span className="font-mono text-[10px] text-blue-600 uppercase tracking-wider animate-pulse">
                    Live
                  </span>
                )}
              </div>
              <div className="font-sans text-base font-medium text-ink">
                {s.title}
              </div>
              <div className="font-mono text-xs text-ink-mid mt-1">
                Target: {s.expectedRange}
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Display: Active Calibration or Calibrated State */}
      {isCalibrated ? (
        /* Calibrated Completion State */
        <div className="border border-hairline bg-paper-well p-8 md:p-12 flex flex-col gap-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-hairline pb-8">
            <div className="flex items-start gap-5">
              <div className="w-12 h-12 flex items-center justify-center border border-hairline bg-paper">
                <Glyph pattern="still" playing={false} size="sm" color="var(--p-still)" />
              </div>
              <div>
                <div className="font-mono text-xs uppercase tracking-widest text-[oklch(0.65_0.15_150)] font-semibold mb-1">
                  Calibration Verified
                </div>
                <h4 className="font-serif text-3xl md:text-5xl text-ink tracking-tight">
                  Calibrated
                </h4>
                <p className="font-sans text-sm text-ink-mid max-w-lg mt-2 leading-relaxed">
                  All three 5-second motion regimes verified. Stillness noise floor, conversational
                  gesture envelope, and high-frequency fidget thresholds are locked.
                </p>
              </div>
            </div>

            <button
              onClick={handleRerun}
              className="bg-ink text-paper hover:bg-ink/90 font-mono text-xs uppercase tracking-widest px-6 py-4 transition-colors text-center shrink-0 focus-visible:outline-2"
            >
              Re-run Motion Calibration
            </button>
          </div>

          {/* Calibrated Thresholds Summary Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="border border-hairline p-5 bg-paper">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid mb-2">
                Stillness Floor
              </div>
              <div className="font-mono text-2xl tabular-nums font-semibold text-ink">
                0.04 g
              </div>
              <div className="font-mono text-xs text-ink-mid mt-1">
                Trigger: &lt; 0.08 g baseline
              </div>
            </div>

            <div className="border border-hairline p-5 bg-paper">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid mb-2">
                Gesture Envelope
              </div>
              <div className="font-mono text-2xl tabular-nums font-semibold text-ink">
                0.48 g
              </div>
              <div className="font-mono text-xs text-ink-mid mt-1">
                Band: 0.25 g – 0.65 g
              </div>
            </div>

            <div className="border border-hairline p-5 bg-paper">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid mb-2">
                Fidget Threshold
              </div>
              <div className="font-mono text-2xl tabular-nums font-semibold text-ink">
                0.85 g
              </div>
              <div className="font-mono text-xs text-ink-mid mt-1">
                Sustained &gt; 2.5 s activates &apos;still&apos;
              </div>
            </div>

            <div className="border border-hairline p-5 bg-paper">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid mb-2">
                Sampling Rate
              </div>
              <div className="font-mono text-2xl tabular-nums font-semibold text-ink">
                100 Hz
              </div>
              <div className="font-mono text-xs text-ink-mid mt-1">
                24-bit 3-axis IMU via BLE
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* In-Progress or Interactive Sequence */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Progress Ring & Instructions (5 cols) */}
          <div className="lg:col-span-5 border border-hairline p-6 md:p-8 bg-paper flex flex-col items-center text-center gap-6">
            <div className="w-full flex items-center justify-between border-b border-hairline pb-3 text-left">
              <span className="font-mono text-xs uppercase tracking-widest text-ink-mid">
                Step {currentStepIdx + 1} of 3
              </span>
              <span className="font-mono text-xs font-semibold text-ink uppercase tracking-wider">
                {activeStep.title}
              </span>
            </div>

            {/* SVG Progress Ring */}
            <div className="my-2">
              <ProgressRing
                progress={stepProgress}
                size={120}
                strokeWidth={4}
                timeRemaining={timeRemaining}
                color={activeStep.accentColor}
                completed={stepProgress >= 1}
              />
            </div>

            {/* Step Instruction */}
            <div className="space-y-2">
              <h4 className="font-serif text-2xl text-ink tracking-tight">
                {activeStep.title} (5 s)
              </h4>
              <p className="font-sans text-sm text-ink-mid leading-relaxed max-w-sm mx-auto">
                {activeStep.instruction}
              </p>
            </div>

            {/* Control Buttons */}
            <div className="w-full pt-4 flex flex-wrap items-center justify-center gap-3 border-t border-hairline">
              {!isRunning ? (
                <button
                  onClick={elapsedInStep > 0 ? handleResume : handleStart}
                  className="bg-ink text-paper hover:bg-ink/90 font-mono text-xs uppercase tracking-widest px-6 py-3 transition-colors focus-visible:outline-2"
                >
                  {elapsedInStep > 0 ? 'Resume Step' : 'Start Motion Calibration'}
                </button>
              ) : (
                <button
                  onClick={handlePause}
                  className="border border-ink text-ink hover:bg-ink hover:text-paper font-mono text-xs uppercase tracking-widest px-6 py-3 transition-colors"
                >
                  Pause
                </button>
              )}

              <button
                onClick={handleStart}
                className="border border-hairline text-ink-mid hover:text-ink font-mono text-xs uppercase tracking-widest px-4 py-3 transition-colors"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Right Column: Live Simulated SVG Motion Trace (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div className="border border-hairline p-6 md:p-8 bg-paper-well flex flex-col gap-6">
              <div className="flex items-center justify-between border-b border-hairline pb-3">
                <span className="font-mono text-xs uppercase tracking-widest text-ink-mid">
                  Live Inertial Feedback
                </span>
                <span className="font-mono text-xs tabular-nums text-ink-mid">
                  Window: 5.0 s
                </span>
              </div>

              {/* Motion Trace SVG Component */}
              <MotionTrace
                state={activeStep.key}
                active={isRunning}
                height={160}
              />

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 text-xs font-mono text-ink-mid border-t border-hairline">
                <div>
                  Expected range:{' '}
                  <span className="text-ink font-medium">{activeStep.expectedRange}</span>
                </div>
                <div>
                  State classifier:{' '}
                  <span className="uppercase text-ink font-medium">{activeStep.key}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
