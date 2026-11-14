'use client';

import React from 'react';

interface ProgressRingProps {
  progress: number; // 0 to 1
  size?: number;
  strokeWidth?: number;
  timeRemaining?: number; // seconds
  color?: string;
  trackColor?: string;
  completed?: boolean;
  className?: string;
}

export function ProgressRing({
  progress,
  size = 96,
  strokeWidth = 3,
  timeRemaining,
  color = 'currentColor',
  trackColor = 'var(--hairline, #e2e2e0)',
  completed = false,
  className = '',
}: ProgressRingProps) {
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  const strokeDashoffset = circumference - clampedProgress * circumference;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(clampedProgress * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90 transform"
        aria-hidden="true"
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress stroke */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="square"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-[stroke-dashoffset] duration-150 ease-linear motion-reduce:transition-none"
        />
      </svg>

      {/* Center readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none pointer-events-none">
        {completed ? (
          <span className="font-mono text-xs uppercase tracking-widest text-ink font-medium">
            Done
          </span>
        ) : timeRemaining !== undefined ? (
          <>
            <span className="font-mono text-xl tabular-nums font-semibold tracking-tight text-ink leading-none">
              {timeRemaining.toFixed(1)}
              <span className="text-xs font-normal text-ink-mid ml-0.5">s</span>
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-mid mt-0.5">
              remaining
            </span>
          </>
        ) : (
          <span className="font-mono text-base tabular-nums font-medium text-ink">
            {Math.round(clampedProgress * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}
