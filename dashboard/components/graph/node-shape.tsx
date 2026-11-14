/**
 * The notation for a node kind: a shape and a colour, always together, so the graph reads
 * in greyscale too. Drawn centred on (0, 0).
 *   me           solid ink disc with an outer ring
 *   person       clay disc
 *   topic        slate diamond
 *   commitment   green triangle; filled while open, outlined once kept
 *   habit        ochre hexagon
 *   conversation small grey square, like a page
 */
import type { GraphNodeKind } from '@/lib/graph/types';

interface NodeShapeProps {
  kind: GraphNodeKind;
  r: number;
  /** Commitments only: open promises are filled. */
  open?: boolean;
  /** Thicker outline for the focused node. */
  strong?: boolean;
}

function polygon(sides: number, r: number, rotate: number): string {
  return Array.from({ length: sides }, (_, i) => {
    const a = rotate + (i / sides) * Math.PI * 2;
    return `${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
  }).join(' ');
}

export function NodeShape({ kind, r, open = true, strong = false }: NodeShapeProps) {
  const sw = strong ? 2 : 1;
  switch (kind) {
    case 'me':
      return (
        <g>
          <circle r={r + 5} fill="none" stroke="var(--ink)" strokeWidth={1} />
          <circle r={r} fill="var(--ink)" />
        </g>
      );
    case 'person':
      return <circle r={r} fill="var(--k-person)" stroke="var(--ink)" strokeWidth={sw} strokeOpacity={strong ? 1 : 0.35} />;
    case 'topic':
      return <polygon points={polygon(4, r * 1.2, -Math.PI / 2)} fill="var(--k-topic)" stroke="var(--ink)" strokeWidth={sw} strokeOpacity={strong ? 1 : 0.3} />;
    case 'commitment':
      return (
        <polygon points={polygon(3, r * 1.3, -Math.PI / 2)} transform={`translate(0 ${(r * 0.25).toFixed(2)})`}
          fill={open ? 'var(--k-commitment)' : 'var(--paper)'} stroke="var(--k-commitment)" strokeWidth={open ? sw : 1.5} strokeLinejoin="round" />
      );
    case 'habit':
      return <polygon points={polygon(6, r * 1.1, 0)} fill="var(--k-habit)" stroke="var(--k-habit-ink)" strokeWidth={sw} />;
    case 'conversation':
      return <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={1} fill="var(--well)" stroke="var(--k-conversation)" strokeWidth={sw} />;
  }
}

/** A small, standalone swatch of a kind for legends, chips and lists. */
export function KindSwatch({ kind, size = 14, open = true }: { kind: GraphNodeKind; size?: number; open?: boolean }) {
  const r = kind === 'me' ? size / 2 - 5 : kind === 'conversation' ? size * 0.3 : size * 0.36;
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden className="shrink-0" style={{ overflow: 'visible' }}>
      <NodeShape kind={kind} r={Math.max(2, r)} open={open} />
    </svg>
  );
}
