export type ListeningState = 'listening' | 'idle' | 'offline';

export interface ListeningMarkProps {
  /** listening: teal, breathing. idle: a still ring. offline: a warn-coloured ring. */
  state?: ListeningState;
  /** sm sits beside a word (shell status); lg anchors an empty state or the Rehearse page. */
  size?: 'sm' | 'lg';
  /** Spoken label; omit when a visible word next to it says the same. */
  label?: string;
}

const CORE = { sm: 8, lg: 22 } as const;
const BOX = { sm: 20, lg: 88 } as const;

/**
 * The signature: a small teal orb that breathes while the band listens. Three rings swell and
 * fade in turn (CSS, transform and opacity only); under reduced motion it holds still.
 */
export function ListeningMark({ state = 'listening', size = 'sm', label }: ListeningMarkProps) {
  const core = CORE[size];
  return (
    <span className="qi-listen" data-state={state} data-size={size} style={{ width: BOX[size], height: BOX[size] }}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {size === 'lg' ? <span className="qi-listen-glow" /> : null}
      {[1, 2, 3].map((i) => (
        <span key={i} className="qi-listen-ring" data-i={i} style={{ width: core, height: core }} />
      ))}
      <span className="qi-listen-core" style={{ width: core, height: core }} />
    </span>
  );
}
