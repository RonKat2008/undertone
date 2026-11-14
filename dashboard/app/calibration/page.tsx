'use client';

import React from 'react';
import { VoiceCalibration } from '@/components/calibration/VoiceCalibration';
import { MotionCalibration } from '@/components/calibration/MotionCalibration';
import { useBus } from '@/lib/bus/use-bus';

export default function CalibrationPage() {
  const { state } = useBus();

  const battery = state?.bandStatus?.battery_pct ?? 100;
  const transport = state?.bandStatus?.transport ?? 'ble';
  const micOn = state?.bandStatus?.mic_on ?? true;

  return (
    <div className="min-h-screen bg-paper text-ink p-6 sm:p-8 md:p-12 lg:p-16 max-w-7xl mx-auto font-sans">
      {/* Editorial Header */}
      <header className="mb-12 border-b border-hairline pb-8">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-ink-mid mb-2">
              Undertone Wristband Calibration
            </div>
            <h1 className="font-serif text-5xl sm:text-6xl md:text-7xl tracking-tight text-ink leading-none">
              Calibration
            </h1>
            <p className="font-sans text-base md:text-lg text-ink-mid mt-3 max-w-2xl leading-relaxed">
              Guided acoustic speaker isolation and 3-axis inertial motion thresholds.
              Calibrate once before wearing Undertone in live conversations.
            </p>
          </div>

          {/* Technical Telemetry Marginalia */}
          <div className="border border-hairline p-4 bg-paper-well text-xs font-mono space-y-1.5 shrink-0 min-w-[240px]">
            <div className="flex justify-between items-center text-ink-mid">
              <span>Wristband</span>
              <span className="text-ink font-medium uppercase">{transport} · Connected</span>
            </div>
            <div className="flex justify-between items-center text-ink-mid">
              <span>Battery</span>
              <span className="text-ink tabular-nums">{battery}%</span>
            </div>
            <div className="flex justify-between items-center text-ink-mid">
              <span>Acoustic Mic</span>
              <span className="text-ink flex items-center gap-1.5">
                {micOn && (
                  <span
                    className="w-2 h-2 rounded-full bg-blue-600 inline-block"
                    title="Mic Active"
                  />
                )}
                16 kHz PCM
              </span>
            </div>
            <div className="flex justify-between items-center text-ink-mid">
              <span>IMU Sensor</span>
              <span className="text-ink">100 Hz 3-Axis</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Flow: Stage 1 (Voice) & Stage 2 (Motion) */}
      <main className="space-y-12">
        {/* Stage 1: Voice Calibration */}
        <VoiceCalibration />

        {/* Stage 2: Motion Calibration */}
        <MotionCalibration />

        {/* Marginalia / Technical Footnote */}
        <footer className="border-t border-hairline pt-8 mt-12 text-xs text-ink-mid font-mono flex flex-col md:flex-row justify-between gap-4">
          <div className="max-w-xl">
            Calibration parameters are cached locally and synchronized with the Undertone wristband
            firmware via BLE. Acoustic profiles update dynamically across long sessions.
          </div>
          <div className="tabular-nums">
            Firmware v1.4.2 · Undertone Score Engine
          </div>
        </footer>
      </main>
    </div>
  );
}
