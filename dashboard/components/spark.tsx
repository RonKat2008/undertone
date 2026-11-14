/** A small trace. No axes, no library: just the line and, optionally, a shaded band. */
interface SparkProps {
  values: number[];
  width: number;
  height: number;
  min: number;
  max: number;
  /** Shaded horizontal band, in data units. */
  band?: [number, number];
  /** A reference line, in data units. */
  line?: number;
  stroke?: string;
  /** How many samples the full width holds (so the trace grows from the left). */
  capacity?: number;
  className?: string;
}

export function Spark({ values, width, height, min, max, band, line, stroke = 'var(--ink)', capacity, className }: SparkProps) {
  const n = Math.max(capacity ?? values.length, 2);
  const y = (v: number) => height - ((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * height;
  const x = (i: number) => (i / (n - 1)) * width;
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length ? values[values.length - 1] : null;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} style={{ overflow: 'visible' }} aria-hidden>
      {band && <rect x={0} width={width} y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} fill="var(--well)" />}
      {line !== undefined && <line x1={0} x2={width} y1={y(line)} y2={y(line)} stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="2 3" />}
      {values.length > 1 && <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />}
      {last !== null && <circle cx={x(values.length - 1)} cy={y(last)} r={2.5} fill={stroke} />}
    </svg>
  );
}
