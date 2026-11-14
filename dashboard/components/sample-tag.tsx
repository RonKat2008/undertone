/** One switch for every "sample" label in the dashboard. */
export const SHOW_SAMPLE_LABELS = true;

export function SampleTag({ show = true, className }: { show?: boolean; className?: string }) {
  if (!SHOW_SAMPLE_LABELS || !show) return null;
  return <span className={`sample-tag ${className ?? ''}`} title="Sample data, not from a real session">sample</span>;
}
