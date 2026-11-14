export interface SparklineProps {
  /** Oldest first. Two or more points; fewer renders nothing. */
  values: number[];
  /** Says the trend in words for screen readers: "Fewer filler words over the last two weeks". */
  label: string;
  width?: number;
  height?: number;
  /** Fix the vertical range, e.g. [0, 1] for shares; defaults to the data's own range. */
  domain?: [number, number];
}

const PAD = 1.5;

/** A word-sized trend line in one colour (inherits text colour; muted by default). No axes, no dots. */
export function Sparkline({ values, label, width = 56, height = 16, domain }: SparklineProps) {
  if (values.length < 2) return null;
  const [lo, hi] = domain ?? [Math.min(...values), Math.max(...values)];
  const span = hi - lo || 1;
  const step = (width - PAD * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = PAD + i * step;
    const y = PAD + (1 - (Math.min(Math.max(v, lo), hi) - lo) / span) * (height - PAD * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg className="qi-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
