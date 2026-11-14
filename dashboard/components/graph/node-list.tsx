'use client';

/** The graph as a list: the keyboard and small-screen alternative to the canvas. */
import { KindSwatch } from '@/components/graph/node-shape';
import { describeNode, KIND_LABEL, weightLabel } from '@/lib/graph/format';
import { groupByKind, NODE_KINDS } from '@/lib/graph/model';
import type { GraphNode } from '@/lib/graph/types';

interface NodeListProps {
  nodes: GraphNode[];
  selectedId: string | null;
  now: number;
  onSelect: (id: string) => void;
}

export function NodeList({ nodes, selectedId, now, onSelect }: NodeListProps) {
  const groups = groupByKind(nodes.filter((n) => n.kind !== 'me'));
  const kinds = NODE_KINDS.filter((k) => groups[k].length > 0);
  if (kinds.length === 0) return <p className="py-10 text-center text-ink-3">Nothing matches.</p>;
  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
      {kinds.map((k) => (
        <section key={k} aria-labelledby={`list-${k}`}>
          <h3 id={`list-${k}`} className="caps flex items-center gap-2 border-b border-ink pb-1.5 !text-ink">
            <KindSwatch kind={k} /> {KIND_LABEL[k].many} <span className="num text-ink-3">{groups[k].length}</span>
          </h3>
          <ul>
            {groups[k].map((n) => {
              const selected = n.id === selectedId;
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => onSelect(n.id)} aria-pressed={selected}
                    className={`grid w-full grid-cols-[1fr_auto] items-baseline gap-x-3 border-b border-rule py-2 text-left hover:bg-well/70 ${selected ? 'bg-well' : ''}`}>
                    <span className="min-w-0">
                      <span className={`block truncate text-[14px] ${selected ? 'font-semibold' : ''}`}>{n.label}</span>
                      <span className="block text-[11.5px] text-ink-2">{describeNode(n, now)}</span>
                    </span>
                    <span className="num text-[12px] text-ink-2">{weightLabel(n)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
