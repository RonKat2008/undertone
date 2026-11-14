import type { CSSProperties } from 'react';

export interface SkeletonProps {
  /** 'text' is one line of body text; 'block' takes the given height; 'circle' stands in for an avatar. */
  shape?: 'text' | 'block' | 'circle';
  /** CSS width, e.g. '60%' or 240. */
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
}

/** Placeholder while content loads. Mirror the real layout's lines; never a spinner for page content. */
export function Skeleton({ shape = 'text', width = '100%', height }: SkeletonProps) {
  return <span className="qi-skeleton" data-shape={shape} style={{ width: shape === 'circle' ? height ?? 36 : width, height: shape === 'text' ? undefined : height ?? (shape === 'circle' ? 36 : 64) }} aria-hidden />;
}

/** A few text-line skeletons, the last one shorter, announced once as loading. */
export function SkeletonLines({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '55%' : '100%'} />
      ))}
    </div>
  );
}
