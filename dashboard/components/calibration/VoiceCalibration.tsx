'use client';

import React, { useState, useEffect, useRef } from 'react';
import { VoiceWaveform } from './VoiceWaveform';
import { swapSpeakers } from '@/lib/api/client';
import { useBus } from '@/lib/bus/use-bus';
import type { Speaker } from '@/lib/bus/contracts';

type VoiceStep = 'idle' | 'prompt' | 'listening' | 'analyzing' | 'identified';

export function VoiceCalibration() {
  const { injectEvent } = useBus();
  const [step, setStep] = useState<VoiceStep>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [activeSpeaker, setActiveSpeaker] = useState<Speaker>('me');
  const [isSwapping, setIsSwapping] = useState<boolean>(false);
  const [swapSuccessMessage, setSwapSuccessMessage] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number>(0.984);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle simulated calibration countdown
  useEffect(() => {
    if (step === 'listening') {
      const durationMs = 4000;
      const intervalMs = 50;
      let elapsed = 0;

      timerRef.current = setInterval(() => {
        elapsed += intervalMs;
        const p = Math.min(1, elapsed / durationMs);
        setProgress(p);

        if (p >= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setStep('analyzing');
          // Brief analysis pause
          setTimeout(() => {
            setStep('identified');
            setActiveSpeaker('me');
            setConfidence(0.988);
            injectEvent({
              type: 'calibration',
              kind: 'speaker',
              step: 'identified',
              done: true,
            });
          }, 900);
        }
      }, intervalMs);

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [step, injectEvent]);

  const handleStart = () => {
    setProgress(0);
    setSwapSuccessMessage(null);
    setStep('listening');
  };

  const handleReset = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(0);
    setStep('idle');
    setSwapSuccessMessage(null);
  };

  const handleSwapSpeakers = async () => {
    setIsSwapping(true);
    setSwapSuccessMessage(null);
    try {
      await swapSpeakers('current_session');
      const nextSpeaker: Speaker = activeSpeaker === 'me' ? 'other' : 'me';
      setActiveSpeaker(nextSpeaker);
      setSwapSuccessMessage(
        nextSpeaker === 'me'
          ? 'Swapped: Wristband channel 1 is assigned to Wearer (Me).'
          : 'Swapped: Wristband channel 1 is assigned to Other Speaker.'
      );
    } catch (err) {
      console.error('Failed to swap speakers:', err);
    } finally {
      setIsSwapping(false);
    }
  };

  return (
    <section className="flex flex-col border-b border-hairline pb-12">
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-2 mb-8">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-ink-mid mb-1">
            Stage 01 · Acoustic Separation
          </div>
          <h3 className="font-serif text-3xl md:text-4xl tracking-tight text-ink">
            Voice Calibration
          </h3>
        </div>
        <div className="font-mono text-xs text-ink-mid">
          {step === 'identified' ? (
            <span className="text-[oklch(0.65_0.15_150)] font-medium uppercase tracking-wider">
              Profile locked · Ready
            </span>
          ) : step === 'listening' ? (
            <span className="text-blue-600 font-medium uppercase tracking-wider animate-pulse">
              Listening & Sampling...
            </span>
          ) : step === 'analyzing' ? (
            <span className="text-amber-600 font-medium uppercase tracking-wider">
              Isolating vocal tract...
            </span>
          ) : (
            <span className="uppercase tracking-wider">Awaiting calibration</span>
          )}
        </div>
      </div>

      {/* Main Flow Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Prompt & Visualizer (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="border border-hairline bg-paper-well p-6 md:p-8">
            <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid mb-3">
              Prompt Step
            </div>
            <p className="font-serif text-2xl md:text-3xl text-ink leading-snug tracking-tight mb-4">
              &ldquo;Say your name and what you worked on today.&rdquo;
            </p>
            <p className="font-sans text-sm text-ink-mid max-w-xl leading-relaxed">
              Undertone isolates your near-field vocal resonance from ambient room reflections
              and conversational partners. Speak at your natural conversational volume.
            </p>
          </div>

          {/* Audio Waveform/Spectrum */}
          <VoiceWaveform
            listening={step === 'listening'}
            identifiedSpeaker={step === 'identified' ? activeSpeaker : null}
            className="w-full"
          />

          {/* Progress bar during listening */}
          {step === 'listening' && (
            <div className="space-y-1.5">
              <div className="flex justify-between font-mono text-xs text-ink-mid tabular-nums">
                <span>Sampling voice envelope</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="w-full h-1 bg-hairline overflow-hidden">
                <div
                  className="h-full bg-ink transition-all duration-75 motion-reduce:transition-none"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Action buttons when not yet identified */}
          {step !== 'identified' && (
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                onClick={handleStart}
                disabled={step === 'listening' || step === 'analyzing'}
                className="bg-ink text-paper hover:bg-ink/90 disabled:opacity-50 font-mono text-xs uppercase tracking-widest px-6 py-3 transition-colors focus-visible:outline-2"
              >
                {step === 'listening' ? 'Recording sample...' : 'Start Voice Test'}
              </button>
              {step === 'listening' && (
                <button
                  onClick={handleReset}
                  className="border border-hairline text-ink-mid hover:text-ink font-mono text-xs uppercase tracking-widest px-4 py-3 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Speaker Identification & Swap Controls (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="border border-hairline p-6 md:p-8 flex flex-col gap-6 bg-paper">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <span className="font-mono text-xs uppercase tracking-widest text-ink-mid">
                Acoustic Identity
              </span>
              <span className="font-mono text-xs tabular-nums text-ink font-medium">
                {step === 'identified' ? 'CONF: 0.988' : 'UNVERIFIED'}
              </span>
            </div>

            {/* Identification Card */}
            {step === 'identified' ? (
              <div className="flex flex-col gap-5">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mid block mb-1">
                      Assigned Speaker
                    </span>
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-block px-3 py-1 font-mono text-xs uppercase tracking-widest font-semibold ${
                          activeSpeaker === 'me'
                            ? 'bg-ink text-paper'
                            : 'bg-[oklch(0.6_0.02_60)] text-paper'
                        }`}
                      >
                        {activeSpeaker === 'me' ? 'Wearer (Me)' : 'Other Speaker'}
                      </span>
                      <span className="font-mono text-xs text-ink-mid tabular-nums">
                        Channel {activeSpeaker === 'me' ? '01' : '02'}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mid block mb-1">
                      Confidence
                    </span>
                    <span className="font-mono text-2xl tabular-nums font-semibold text-ink">
                      {(confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Technical profile characteristics */}
                <div className="border-t border-hairline pt-4 space-y-2 text-xs font-mono">
                  <div className="flex justify-between text-ink-mid">
                    <span>Fundamental Frequency (f₀)</span>
                    <span className="text-ink tabular-nums">
                      {activeSpeaker === 'me' ? '124 Hz' : '198 Hz'}
                    </span>
                  </div>
                  <div className="flex justify-between text-ink-mid">
                    <span>Formants (F₁ / F₂)</span>
                    <span className="text-ink tabular-nums">
                      {activeSpeaker === 'me' ? '512 Hz / 1,480 Hz' : '640 Hz / 1,920 Hz'}
                    </span>
                  </div>
                  <div className="flex justify-between text-ink-mid">
                    <span>Signal-to-Noise Ratio</span>
                    <span className="text-ink tabular-nums">24.2 dB (Near-field)</span>
                  </div>
                </div>

                {/* Swap Feedback Notification */}
                {swapSuccessMessage && (
                  <div className="bg-paper-well border border-hairline p-3 font-mono text-xs text-ink">
                    {swapSuccessMessage}
                  </div>
                )}

                {/* Swap Control Button */}
                <div className="pt-2 flex flex-col gap-3">
                  <button
                    onClick={handleSwapSpeakers}
                    disabled={isSwapping}
                    className="w-full border border-ink text-ink hover:bg-ink hover:text-paper font-mono text-xs uppercase tracking-widest py-3 px-4 transition-colors disabled:opacity-50 text-center focus-visible:outline-2"
                  >
                    {isSwapping ? 'Swapping attribution...' : 'Swap Speakers'}
                  </button>
                  <p className="font-sans text-[11px] text-ink-mid leading-relaxed">
                    If Undertone detected your conversational partner as the wearer, tap{' '}
                    <span className="font-mono text-ink">Swap Speakers</span> to invert the microphone
                    channel mapping.
                  </p>
                </div>

                {/* Recalibrate button */}
                <div className="border-t border-hairline pt-4">
                  <button
                    onClick={handleStart}
                    className="text-ink-mid hover:text-ink font-mono text-xs uppercase tracking-wider underline underline-offset-4"
                  >
                    Re-record voice sample
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center flex flex-col items-center justify-center gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-ink-mid">
                  No Voice Signature Found
                </span>
                <p className="font-sans text-xs text-ink-mid max-w-xs leading-relaxed">
                  Start the voice test to establish your baseline vocal tract profile and confirm speaker
                  attribution.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
