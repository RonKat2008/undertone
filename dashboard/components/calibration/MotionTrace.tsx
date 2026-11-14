'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { MotionState } from '@/lib/bus/contracts';

interface MotionTraceProps {
  state: MotionState;
  active: boolean;
  height?: number;
  className?: string;
  energyLevel?: number; // optional manual override
}

const IDLE_POINTS = Array(60).fill(0);

export function MotionTrace({
  state,
  active,
  height = 140,
  className = '',
  energyLevel,
}: MotionTraceProps) {
  const [livePoints, setLivePoints] = useState<number[]>(() => Array(60).fill(0));
  const [liveVal, setLiveVal] = useState<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const timeRef = useRef<number>(0);

  // Memoized static points for prefers-reduced-motion
  const staticReducedMotionPoints = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => {
      if (state === 'still') {
        return Math.sin(i * 0.3) * 0.03;
      } else if (state === 'gesture') {
        return Math.sin(i * 0.2) * 0.45 + Math.cos(i * 0.1) * 0.1;
      } else {
        return Math.sin(i * 1.5) * 0.7;
      }
    });
  }, [state]);

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!active) return;

    const isReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (isReduced) return;

    let lastTick = performance.now();

    const loop = (now: number) => {
      const dt = (now - lastTick) / 1000;
      lastTick = now;
      timeRef.current += dt;

      const t = timeRef.current;
      let val = 0;

      if (energyLevel !== undefined) {
        val = energyLevel + (Math.random() - 0.5) * 0.04;
      } else if (state === 'still') {
        val = Math.sin(t * 8) * 0.025 + (Math.random() - 0.5) * 0.02;
      } else if (state === 'gesture') {
        val =
          Math.sin(t * 2.8) * 0.42 +
          Math.cos(t * 1.4) * 0.15 +
          (Math.random() - 0.5) * 0.05;
      } else if (state === 'fidget') {
        val =
          Math.sin(t * 18) * 0.5 +
          Math.sin(t * 31) * 0.35 +
          (Math.random() - 0.5) * 0.35;
      }

      val = Math.max(-1.4, Math.min(1.4, val));

      setLiveVal(Math.abs(val));
      setLivePoints((prev) => [...prev.slice(1), val]);

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [state, active, energyLevel]);

  // Derived points & telemetry values
  const points = !active
    ? IDLE_POINTS
    : prefersReducedMotion
    ? staticReducedMotionPoints
    : livePoints;

  const currentVal = !active
    ? 0
    : prefersReducedMotion
    ? (state === 'still' ? 0.03 : state === 'gesture' ? 0.48 : 0.95)
    : liveVal;

  // SVG coordinate mapping
  const width = 300;
  const h = 120;
  const centerY = h / 2;
  const scaleY = 42; // 1.0g = 42px

  const pathD = points
    .map((val, idx) => {
      const x = (idx / (points.length - 1)) * width;
      const y = centerY - val * scaleY;
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const strokeColor =
    state === 'still'
      ? 'var(--p-still, #7C3AED)'
      : state === 'gesture'
      ? 'var(--ink, #111827)'
      : 'var(--p-interrupt, #E03C31)';

  return (
    <div className={`relative flex flex-col ${className}`}>
      {/* Header telemetry readout */}
      <div className="flex items-center justify-between font-mono text-xs uppercase tracking-wider text-ink-mid mb-2 border-b border-hairline pb-1.5">
        <span className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full inline-block transition-colors duration-200"
            style={{ backgroundColor: active ? strokeColor : 'var(--hairline)' }}
            aria-hidden="true"
          />
          <span>IMU 3-Axis Accelerometer Trace</span>
        </span>
        <span className="tabular-nums text-ink font-medium">
          {currentVal.toFixed(2)} g{' '}
          <span className="text-ink-mid font-normal">
            ({state === 'still' ? 'Calm' : state === 'gesture' ? 'Natural' : 'Jitter'})
          </span>
        </span>
      </div>

      {/* SVG Canvas */}
      <div
        className="w-full bg-paper border border-hairline relative overflow-hidden"
        style={{ height }}
      >
        <svg
          viewBox={`0 0 ${width} ${h}`}
          preserveAspectRatio="none"
          className="w-full h-full block"
          aria-label={`Motion trace showing ${state} state at ${currentVal.toFixed(2)} g`}
        >
          {/* Grid lines */}
          <line
            x1="0"
            y1={centerY - scaleY}
            x2={width}
            y2={centerY - scaleY}
            stroke="var(--hairline)"
            strokeDasharray="2 2"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1={centerY}
            x2={width}
            y2={centerY}
            stroke="var(--hairline)"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1={centerY + scaleY}
            x2={width}
            y2={centerY + scaleY}
            stroke="var(--hairline)"
            strokeDasharray="2 2"
            strokeWidth="1"
          />

          {/* Trace Line */}
          <path
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-colors duration-300"
          />

          {/* Current reading head point */}
          {points.length > 0 && (
            <circle
              cx={width}
              cy={centerY - points[points.length - 1] * scaleY}
              r="3"
              fill={strokeColor}
            />
          )}
        </svg>

        {/* Amplitude scale indicators */}
        <div className="absolute top-1 right-2 font-mono text-[9px] text-ink-mid tabular-nums select-none pointer-events-none">
          +1.0g
        </div>
        <div className="absolute top-[48%] right-2 -translate-y-1/2 font-mono text-[9px] text-ink-mid tabular-nums select-none pointer-events-none">
          0.0g
        </div>
        <div className="absolute bottom-1 right-2 font-mono text-[9px] text-ink-mid tabular-nums select-none pointer-events-none">
          -1.0g
        </div>
      </div>
    </div>
  );
}
