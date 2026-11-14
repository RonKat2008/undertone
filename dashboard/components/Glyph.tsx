'use client';

import React from 'react';

// Re-export or redefine HapticPattern if it's strictly needed from contracts, 
// but since we are copying it here based on requirements to not edit other files:
export type HapticPattern =
  | 'tap'
  | 'interrupt'
  | 'filler'
  | 'wrap_up'
  | 'slow_down'
  | 'still'
  | 'success'
  | 'approve'
  | 'status_good'
  | 'status_talking'
  | 'status_ask';

export interface GlyphProps {
  pattern: HapticPattern;
  playing?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  color?: string;
  className?: string;
}

const patternColors: Partial<Record<HapticPattern, string>> = {
  interrupt: '#E03C31',
  wrap_up: '#D97706',
  filler: '#B48A14',
  slow_down: '#2563EB',
  still: '#7C3AED',
  success: '#16A34A',
  tap: 'currentColor',
  approve: 'currentColor',
  status_good: 'currentColor',
  status_talking: 'currentColor',
  status_ask: 'currentColor',
};

const sizeClasses = {
  xs: 'w-4 h-4',
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
  xl: 'w-16 h-16',
};

const KEYFRAMES = `
@media (prefers-reduced-motion: no-preference) {
  .glyph-playing .g-tap { animation: g-tap 1.2s infinite; transform-origin: 50% 80px; }
  .glyph-playing .g-int-1 { animation: g-tap 1.2s infinite; transform-origin: 50% 80px; }
  .glyph-playing .g-int-2 { animation: g-tap 1.2s infinite 0.15s; transform-origin: 50% 80px; }
  .glyph-playing .g-fill { animation: g-tap 1.5s infinite; transform-origin: 50% 80px; }
  .glyph-playing .g-wrap-1 { animation: g-tap 1.8s infinite; transform-origin: 50% 80px; }
  .glyph-playing .g-wrap-2 { animation: g-tap 1.8s infinite 0.2s; transform-origin: 50% 80px; }
  .glyph-playing .g-wrap-3 { animation: g-tap 1.8s infinite 0.4s; transform-origin: 50% 80px; }
  .glyph-playing .g-slow { animation: g-wipe 2.5s infinite; }
  .glyph-playing .g-still-1 { animation: g-pulse 4s infinite; transform-origin: 50% 80px; }
  .glyph-playing .g-still-2 { animation: g-pulse 4s infinite 2s; transform-origin: 50% 80px; }
  .glyph-playing .g-succ-1 { animation: g-tap 1.5s infinite; transform-origin: 50% 80px; }
  .glyph-playing .g-succ-2 { animation: g-tap 1.5s infinite 0.25s; transform-origin: 50% 80px; }
  .glyph-playing .g-app-1 { animation: g-tap 1.2s infinite; transform-origin: 50% 80px; }
  .glyph-playing .g-app-2 { animation: g-tap 1.2s infinite 0.1s; transform-origin: 50% 80px; }
  
  .glyph-playing .g-sg { animation: g-buzz 2s infinite; transform-origin: 50% 80px; }
  .glyph-playing .g-st-1 { animation: g-buzz 2.5s infinite; transform-origin: 50% 80px; }
  .glyph-playing .g-st-2 { animation: g-buzz 2.5s infinite 0.6s; transform-origin: 50% 80px; }
  .glyph-playing .g-sa-1 { animation: g-buzz 3.5s infinite; transform-origin: 50% 80px; }
  .glyph-playing .g-sa-2 { animation: g-buzz 3.5s infinite 0.6s; transform-origin: 50% 80px; }
  .glyph-playing .g-sa-3 { animation: g-buzz 3.5s infinite 1.2s; transform-origin: 50% 80px; }
}

@keyframes g-tap {
  0%, 100% { transform: scaleY(0.5); opacity: 0.3; }
  15% { transform: scaleY(1.1); opacity: 1; }
  30% { transform: scaleY(0.5); opacity: 0.3; }
}
@keyframes g-pulse {
  0%, 100% { transform: scaleY(0.7); opacity: 0.3; }
  50% { transform: scaleY(1.05); opacity: 0.8; }
}
@keyframes g-wipe {
  0%, 100% { clip-path: inset(0 100% 0 0); opacity: 0.3; }
  50%, 60% { clip-path: inset(0 0 0 0); opacity: 1; }
}
@keyframes g-buzz {
  0%, 100% { transform: scaleY(0.6); opacity: 0.3; }
  10%, 30% { transform: scaleY(1.05); opacity: 1; }
  40% { transform: scaleY(0.6); opacity: 0.3; }
}
`;

export function Glyph({
  pattern,
  playing = false,
  size = 'md',
  color,
  className = '',
}: GlyphProps) {
  const fillColor = color || patternColors[pattern] || 'currentColor';
  const sizeClass = sizeClasses[size] || sizeClasses.md;
  const containerClasses = [sizeClass, playing ? 'glyph-playing' : '', className].filter(Boolean).join(' ');

  // The base canvas is 100x100. Baseline is typically around y=80.
  // Rendering different SVG shapes per pattern:
  let shapes = null;
  switch (pattern) {
    case 'tap':
      shapes = <rect className="g-tap" x="40" y="60" width="20" height="20" rx="2" fill={fillColor} />;
      break;
    case 'interrupt':
      shapes = (
        <>
          <rect className="g-int-1" x="30" y="20" width="15" height="60" rx="2" fill={fillColor} />
          <rect className="g-int-2" x="55" y="20" width="15" height="60" rx="2" fill={fillColor} />
        </>
      );
      break;
    case 'filler':
      shapes = <rect className="g-fill" x="30" y="40" width="40" height="40" rx="2" fill={fillColor} />;
      break;
    case 'wrap_up':
      shapes = (
        <>
          <rect className="g-wrap-1" x="15" y="60" width="20" height="20" rx="2" fill={fillColor} />
          <rect className="g-wrap-2" x="40" y="40" width="20" height="40" rx="2" fill={fillColor} />
          <rect className="g-wrap-3" x="65" y="20" width="20" height="60" rx="2" fill={fillColor} />
        </>
      );
      break;
    case 'slow_down':
      shapes = <polygon className="g-slow" points="10,80 90,30 90,80" fill={fillColor} />;
      break;
    case 'still':
      shapes = (
        <>
          <rect className="g-still-1" x="10" y="70" width="30" height="10" rx="5" fill={fillColor} />
          <rect className="g-still-2" x="60" y="70" width="30" height="10" rx="5" fill={fillColor} />
        </>
      );
      break;
    case 'success':
      shapes = (
        <>
          <rect className="g-succ-1" x="25" y="60" width="20" height="20" rx="2" fill={fillColor} />
          <rect className="g-succ-2" x="55" y="20" width="20" height="60" rx="2" fill={fillColor} />
        </>
      );
      break;
    case 'approve':
      shapes = (
        <>
          <rect className="g-app-1" x="30" y="60" width="15" height="20" rx="2" fill={fillColor} />
          <rect className="g-app-2" x="55" y="60" width="15" height="20" rx="2" fill={fillColor} />
        </>
      );
      break;
    case 'status_good':
      shapes = <rect className="g-sg" x="20" y="40" width="60" height="40" rx="2" fill={fillColor} />;
      break;
    case 'status_talking':
      shapes = (
        <>
          <rect className="g-st-1" x="10" y="40" width="35" height="40" rx="2" fill={fillColor} />
          <rect className="g-st-2" x="55" y="40" width="35" height="40" rx="2" fill={fillColor} />
        </>
      );
      break;
    case 'status_ask':
      shapes = (
        <>
          <rect className="g-sa-1" x="5" y="40" width="25" height="40" rx="2" fill={fillColor} />
          <rect className="g-sa-2" x="37.5" y="40" width="25" height="40" rx="2" fill={fillColor} />
          <rect className="g-sa-3" x="70" y="40" width="25" height="40" rx="2" fill={fillColor} />
        </>
      );
      break;
    default:
      // Fallback in case of unexpected pattern
      shapes = <rect x="40" y="40" width="20" height="20" fill={fillColor} />;
  }

  return (
    <svg 
      className={containerClasses}
      viewBox="0 0 100 100" 
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <style>{KEYFRAMES}</style>
      {shapes}
    </svg>
  );
}
