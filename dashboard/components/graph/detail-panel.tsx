'use client';

/**
 * The selected node, from GET /graph/node/{id}: label, kind, facts, neighbours, the
 * conversations it appears in (each links to its debrief) and a few real quotes.
 * A side column from 1024 px; a bottom sheet below that.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { KindSwatch } from '@/components/graph/node-shape';
import { getGraphNode, type GraphResult } from '@/lib/api/client';
import { conversationHref } from '@/lib/conversations/links';
import { duration, KIND_LABEL, nodeFacts, relativeDay } from '@/lib/graph/format';
import { buildAdjacency, groupByKind, NODE_KINDS, neighbourIds } from '@/lib/graph/model';
import type { GraphNode, GraphNodeDetail } from '@/lib/graph/types';

interface DetailPanelProps {
  nodeId: string;
  graph: GraphResult;
  now: number;
  reducedMotion: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}

type Load =
  | { state: 'loading' }
  | { state: 'ready'; detail: GraphNodeDetail }
  | { state: 'error'; message: string };

export function debriefHref(sessionId: string): string {
  return `/debrief?session=${encodeURIComponent(sessionId)}`;
}

export function DetailPanel({ nodeId, graph, now, reducedMotion, onSelect, onClose }: DetailPanelProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const known = graph.data.nodes.find((n) => n.id === nodeId) ?? null;

  useEffect(() => {
    let on = true;
    setLoad({ state: 'loading' });
    getGraphNode(nodeId, graph)
      .then((detail) => on && setLoad({ state: 'ready', detail }))
      .catch((e: unknown) => on && setLoad({ state: 'error', message: e instanceof Error ? e.message : 'Could not load this node.' }));
    return () => { on = false; };
  }, [nodeId, graph, attempt]);

  const node: GraphNode | null = load.state === 'ready' ? load.detail.node : known;
  // Until (or unless) the detail arrives, the neighbours we already know from the graph.
  const fallbackNeighbours = (() => {
    if (!known) return [];
    const ids = neighbourIds(buildAdjacency(graph.data.edges), known.id);
    return graph.data.nodes.filter((n) => ids.has(n.id));
  })();
  const neighbours = load.state === 'ready' ? load.detail.neighbours : fallbackNeighbours;

  return (
    <aside
      aria-labelledby="node-detail-heading"
      className={`fixed inset-x-0 bottom-0 z-30 max-h-[72vh] overflow-y-auto border-t-2 border-ink bg-paper px-4 pb-6 pt-3 shadow-[0_-8px_24px_oklch(0.2_0.012_60_/_0.12)]
        lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:border-t-0 lg:bg-transparent lg:p-0 lg:shadow-none ${reducedMotion ? '' : 'anim-sheet lg:animate-none'}`}
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-rule lg:hidden" aria-hidden />
      <div className="flex items-start justify-between gap-3 border-b border-ink pb-3">
        <div className="min-w-0">
          <div className="label flex items-center gap-2">
            {node && <KindSwatch kind={node.kind} open={node.meta.open !== false} />}
            {node ? KIND_LABEL[node.kind].one : 'Node'}
          </div>
          <h2 id="node-detail-heading" className="serif mt-1 break-words text-[clamp(28px,3vw,40px)] leading-[1.02] outline-none">
            {node?.label ?? nodeId}
          </h2>
          {node?.last_seen != null && <div className="mt-1 text-[12px] text-ink-2">Last {relativeDay(node.last_seen, now)}</div>}
        </div>
        <button type="button" className="btn btn-sm btn-quiet shrink-0" onClick={onClose} aria-label="Close the detail panel">
          Close <span className="num text-ink-3">esc</span>
        </button>
      </div>

      {node && <Facts node={node} />}

      {load.state === 'loading' && (
        <div className="mt-5 space-y-2" aria-live="polite">
          <span className="sr-only">Loading</span>
          {[80, 64, 72].map((w) => <div key={w} className="h-3 bg-well" style={{ width: `${w}%` }} />)}
        </div>
      )}
      {load.state === 'error' && (
        <div role="alert" className="mt-5 border-l-[3px] border-ink pl-3">
          <div className="label !text-ink">Could not load the conversations</div>
          <p className="mt-1 text-[13px] text-ink-2">{load.message}</p>
          <button type="button" className="btn btn-sm mt-2" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
        </div>
      )}

      {load.state === 'ready' && <Quotes detail={load.detail} />}
      {load.state === 'ready' && <Conversations detail={load.detail} now={now} />}
      <Neighbours nodes={neighbours} onSelect={onSelect} />
    </aside>
  );
}

function Facts({ node }: { node: GraphNode }) {
  const facts = nodeFacts(node);
  const headline = typeof node.meta.headline === 'string' ? node.meta.headline : null;
  const quote = node.kind === 'commitment' && typeof node.meta.quote === 'string' ? node.meta.quote : null;
  const sessionId = node.kind === 'conversation' ? node.id.replace(/^conversation:/, '') : null;
  return (
    <div className="mt-4">
      {headline && <p className="text-[16px] leading-snug">{headline}</p>}
      {quote && <blockquote className="serif border-l-[3px] border-[var(--k-commitment)] pl-4 text-[24px] italic leading-[1.1]">“{quote}”</blockquote>}
      {facts.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
          {facts.map((f) => (
            <div key={f.key} className="min-w-0 border-t border-rule pt-1.5">
              <dt className="label">{f.label}</dt>
              <dd className="num truncate text-[17px]">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {sessionId && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={debriefHref(sessionId)} className="btn btn-solid">Open the debrief</Link>
          <Link href={conversationHref(sessionId)} className="btn">Transcript and recording</Link>
        </div>
      )}
    </div>
  );
}

function Quotes({ detail }: { detail: GraphNodeDetail }) {
  const quotes = detail.quotes.slice(0, 4);
  if (quotes.length === 0) return null;
  return (
    <section className="mt-6" aria-label="Quotes">
      <h3 className="label border-b border-rule pb-1">In their words, and yours</h3>
      <ul>
        {quotes.map((q, i) => (
          <li key={`${q.session_id}-${q.ts}-${i}`} className="grid grid-cols-[46px_1fr] gap-x-3 border-b border-rule py-2.5">
            <span className={`label pt-1 ${q.speaker === 'me' ? '!text-ink' : ''}`}>{q.speaker === 'me' ? 'You' : 'Them'}</span>
            <q className={`text-[14px] leading-snug ${q.speaker === 'me' ? '' : 'text-ink-2'}`}>{q.text}</q>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Conversations({ detail, now }: { detail: GraphNodeDetail; now: number }) {
  if (detail.node.kind === 'conversation' || detail.conversations.length === 0) return null;
  return (
    <section className="mt-6" aria-label="Conversations">
      <h3 className="label border-b border-rule pb-1">Appears in {detail.conversations.length} conversation{detail.conversations.length === 1 ? '' : 's'}</h3>
      <ul>
        {detail.conversations.slice(0, 6).map((c) => {
          const when = Date.parse(c.started_at) / 1000;
          return (
            <li key={c.session_id} className="grid grid-cols-[84px_1fr] gap-x-3 border-b border-rule py-2.5">
              <span className="num pt-0.5 text-[12px] text-ink-2">{Number.isFinite(when) ? relativeDay(when, now) : '—'}<br />{duration(c.duration_s)}</span>
              <span className="min-w-0">
                <Link href={debriefHref(c.session_id)} className="block text-[13px] leading-snug hover:underline">{c.headline_fact || 'Open the debrief'}</Link>
                <Link href={conversationHref(c.session_id)} className="link mt-1 inline-block text-[12px]">Transcript and recording</Link>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Neighbours({ nodes, onSelect }: { nodes: GraphNode[]; onSelect: (id: string) => void }) {
  const groups = groupByKind(nodes);
  const kinds = NODE_KINDS.filter((k) => groups[k].length > 0 && k !== 'conversation');
  if (kinds.length === 0) return null;
  return (
    <section className="mt-6" aria-label="Connected to">
      <h3 className="label border-b border-rule pb-1">Connected to</h3>
      <div className="mt-2 space-y-2">
        {kinds.map((k) => (
          <div key={k} className="flex flex-wrap items-center gap-1.5">
            {groups[k].slice(0, 8).map((n) => (
              <button key={n.id} type="button" className="chip max-w-full hover:border-ink" onClick={() => onSelect(n.id)}>
                <KindSwatch kind={n.kind} size={11} open={n.meta.open !== false} />
                <span className="truncate">{n.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
