'use client';

/**
 * Home: the knowledge graph of the wearer's conversations, and the data around it.
 * Window, kind filters, view and selected node live in the URL. Everything refetches by
 * itself when the bus says a conversation ended or its debrief is ready.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { DetailPanel } from '@/components/graph/detail-panel';
import { GraphCanvas } from '@/components/graph/graph-canvas';
import { KindSwatch } from '@/components/graph/node-shape';
import { NodeList } from '@/components/graph/node-list';
import { OpenPromises, RecentConversations, StatsStrip, TopHabits } from '@/components/graph/your-data';
import {
  getGraph, getProfile, getWeeklyReport, listSessions, type Fetched, type GraphResult,
} from '@/lib/api/client';
import type { HabitProfile, SessionSummary, WeeklyReport } from '@/lib/bus/contracts';
import { useBus } from '@/lib/bus/use-bus';
import { KIND_LABEL } from '@/lib/graph/format';
import { computeLayout, radiiFor } from '@/lib/graph/layout';
import { FILTER_KINDS, filterGraph, isEmptyGraph, searchNodes } from '@/lib/graph/model';
import type { FilterKind } from '@/lib/graph/types';
import { parseGraphUrl, toggleKind, WINDOWS, writeGraphUrl, type GraphUrlState } from '@/lib/graph/url';
import { useReducedMotion } from '@/lib/use-reduced-motion';

export function GraphHome() {
  const params = useSearchParams();
  const url = useMemo(() => parseGraphUrl(params.toString()), [params]);
  const reducedMotion = useReducedMotion();
  const { state } = useBus();
  const [graph, setGraph] = useState<GraphResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<Fetched<SessionSummary[]> | null>(null);
  const [profile, setProfile] = useState<Fetched<HabitProfile> | null>(null);
  const [weekly, setWeekly] = useState<Fetched<WeeklyReport> | null>(null);

  // A conversation ending, or its debrief landing, changes what there is to show.
  const busKey = `${state.session?.endedAt ?? ''}|${state.debrief?.at ?? ''}`;

  function update(patch: Partial<GraphUrlState>) {
    const next = { ...url, ...patch };
    window.history.replaceState(null, '', `${window.location.pathname}${writeGraphUrl(window.location.search, next)}`);
  }

  useEffect(() => {
    let on = true;
    setLoading(true);
    getGraph(url.days).then((g) => {
      if (!on) return;
      setGraph(g);
      setLoading(false);
    });
    return () => { on = false; };
  }, [url.days, busKey, attempt]);

  useEffect(() => {
    let on = true;
    listSessions().then((s) => on && setSessions(s));
    getProfile().then((p) => on && setProfile(p));
    getWeeklyReport().then((w) => on && setWeekly(w));
    return () => { on = false; };
  }, [busKey, attempt]);

  const full = graph?.data ?? null;
  const fullLayout = useMemo(() => (full ? computeLayout(full.nodes, full.edges) : {}), [full]);
  const slice = useMemo(() => (full ? filterGraph(full, url.kinds) : { nodes: [], edges: [] }), [full, url.kinds]);
  const layout = useMemo(() => {
    if (!full) return {};
    return slice.nodes.length === full.nodes.length ? fullLayout : computeLayout(slice.nodes, slice.edges, { seed: fullLayout });
  }, [full, slice, fullLayout]);
  const radii = useMemo(() => radiiFor(slice.nodes), [slice]);
  const matchList = useMemo(() => searchNodes(slice.nodes, query, 8), [slice, query]);
  const matches = useMemo(() => (query.trim() ? new Set(searchNodes(slice.nodes, query).map((n) => n.id)) : null), [slice, query]);
  const now = graph?.data.generated_at ?? 0;
  const selectedId = url.node && full?.nodes.some((n) => n.id === url.node) ? url.node : null;

  const select = (id: string | null) => update({ node: id });

  // Esc closes the panel and gives focus back to the node it came from.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      window.history.replaceState(null, '', `${window.location.pathname}${writeGraphUrl(window.location.search, { ...parseGraphUrl(window.location.search), node: null })}`);
      const node = document.querySelector<HTMLElement | SVGElement>(`[data-node-id="${CSS.escape(selectedId)}"]`);
      node?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && matchList[0]) {
      e.preventDefault();
      select(matchList[0].id);
    }
    if (e.key === 'Escape') setQuery('');
  }

  const kindCounts = useMemo(() => {
    const counts = Object.fromEntries(FILTER_KINDS.map((k) => [k, 0])) as Record<FilterKind, number>;
    for (const n of full?.nodes ?? []) if (n.kind !== 'me') counts[n.kind] += 1;
    return counts;
  }, [full]);

  const isError = graph?.source === 'unreachable' || graph?.source === 'invalid';
  const empty = graph !== null && !isError && isEmptyGraph(graph.data);
  const filteredAway = graph !== null && !isError && !empty && isEmptyGraph(slice);

  return (
    <div className="pt-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="label flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Last {url.days} days</span>
          </div>
          <h1 className="serif mt-1 text-[clamp(36px,5vw,64px)] leading-[0.95]">Who you talk to, and how.</h1>
        </div>
        <div role="group" aria-label="Time window" className="flex">
          {WINDOWS.map((d, i) => (
            <button key={d} type="button" aria-pressed={url.days === d} onClick={() => update({ days: d })}
              className={`btn btn-sm num ${i > 0 ? '-ml-px' : ''} ${i === 0 ? 'rounded-r-none' : i === WINDOWS.length - 1 ? 'rounded-l-none' : 'rounded-none'} ${url.days === d ? 'btn-solid' : ''}`}>
              {d} days
            </button>
          ))}
        </div>
      </header>

      {isError && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 border-l-[3px] border-ink bg-well/60 px-3 py-2">
          <span className="text-[13px]"><span className="label mr-2 !text-ink">Backend</span>{graph?.error ?? 'Cannot reach the backend.'}</span>
          <button type="button" className="btn btn-sm" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
        </div>
      )}

      <div className="mt-5">
        <StatsStrip stats={graph?.data.stats ?? { conversations: 0, people: 0, topics: 0, minutes_spoken: 0, open_commitments: 0 }} days={url.days} loading={loading} unknown={!graph || isError} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="relative w-full sm:w-[240px]">
          <span className="sr-only">Search the graph</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
            placeholder="Search people, topics, promises…" className="field text-[14px]" autoComplete="off" />
        </label>
        <div role="group" aria-label="Show kinds" className="flex flex-wrap gap-1.5">
          {FILTER_KINDS.map((k) => {
            const on = url.kinds.has(k);
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => update({ kinds: toggleKind(url.kinds, k) })}
                className={`chip transition-colors ${on ? 'border-ink' : 'text-ink-3 [&_svg]:opacity-30'} hover:border-ink`}>
                <KindSwatch kind={k} size={12} />
                {KIND_LABEL[k].many}
                <span className="num text-[11px] text-ink-3">{kindCounts[k]}</span>
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="View" className="flex sm:ml-auto">
          {(['graph', 'list'] as const).map((v, i) => (
            <button key={v} type="button" aria-pressed={url.view === v} onClick={() => update({ view: v })}
              className={`btn btn-sm ${i === 0 ? 'rounded-r-none' : '-ml-px rounded-l-none'} ${url.view === v ? 'btn-solid' : 'btn-quiet'}`}>
              {v === 'graph' ? 'Graph' : 'List'}
            </button>
          ))}
        </div>
      </div>

      {query.trim() && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-live="polite">
          <span className="label mr-1">{matchList.length ? `${matches?.size ?? 0} match${matches?.size === 1 ? '' : 'es'}` : 'No matches'}</span>
          {matchList.map((n) => (
            <button key={n.id} type="button" className="chip hover:border-ink" onClick={() => select(n.id)}>
              <KindSwatch kind={n.kind} size={11} open={n.meta.open !== false} />{n.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {url.view === 'graph' ? (
            <div className="relative h-[clamp(360px,62vh,680px)] border-y border-rule">
              {!graph && <GraphLoading />}
              {isError && <GraphUnavailable />}
              {empty && <GraphEmpty days={url.days} onWiden={url.days < 90 ? () => update({ days: 90 }) : null} />}
              {filteredAway && <FilteredAway onReset={() => update({ kinds: new Set(FILTER_KINDS) })} />}
              {graph && !isError && !empty && !filteredAway && (
                <GraphCanvas nodes={slice.nodes} edges={slice.edges} layout={layout} radii={radii} selectedId={selectedId}
                  matches={matches} reducedMotion={reducedMotion} now={now} onSelect={select} />
              )}
            </div>
          ) : (
            <div className="border-t border-rule pt-4">
              {!graph ? <GraphLoading />
                : isError ? <GraphUnavailable />
                : empty ? <GraphEmpty days={url.days} onWiden={url.days < 90 ? () => update({ days: 90 }) : null} />
                : <NodeList nodes={matches ? slice.nodes.filter((n) => matches.has(n.id)) : slice.nodes} selectedId={selectedId} now={now} onSelect={select} />}
            </div>
          )}
          <div className="mt-3 lg:hidden"><Legend compact /></div>
        </div>

        <div className="min-w-0">
          {selectedId && graph ? (
            <DetailPanel key={selectedId} nodeId={selectedId} graph={graph} now={now} reducedMotion={reducedMotion}
              onSelect={(id) => select(id)} onClose={() => select(null)} />
          ) : (
            <div className="hidden lg:block"><Legend /></div>
          )}
        </div>
      </div>

      <div className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-2 xl:grid-cols-3">
        <RecentConversations sessions={sessions} now={now} />
        <OpenPromises nodes={full?.nodes ?? []} loaded={graph !== null && !isError} now={now} onSelect={(id) => { update({ node: id }); window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' }); }} />
        <TopHabits profile={profile} weekly={weekly} />
      </div>
    </div>
  );
}

const LEGEND: { kind: Parameters<typeof KindSwatch>[0]['kind']; text: string }[] = [
  { kind: 'me', text: 'You, at the centre' },
  { kind: 'person', text: 'People you talk with; bigger, more often' },
  { kind: 'conversation', text: 'Conversations; bigger, longer' },
  { kind: 'topic', text: 'What you talked about' },
  { kind: 'commitment', text: 'Promises; filled while still open' },
  { kind: 'habit', text: 'Habits the coach keeps hearing' },
];

function Legend({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-ink-2" aria-label="Legend">
        {LEGEND.map((l) => <li key={l.kind} className="flex items-center gap-1.5"><KindSwatch kind={l.kind} size={12} />{KIND_LABEL[l.kind].one}</li>)}
      </ul>
    );
  }
  return (
    <section aria-label="How to read the graph" className="border-t border-ink pt-3">
      <h2 className="label !text-ink">How to read it</h2>
      <ul className="mt-3 space-y-2.5">
        {LEGEND.map((l) => (
          <li key={l.kind} className="grid grid-cols-[22px_1fr] items-center gap-x-2 text-[13px]">
            <KindSwatch kind={l.kind} size={l.kind === 'me' ? 20 : 16} />
            <span><span className="font-medium">{KIND_LABEL[l.kind].one}.</span> <span className="text-ink-2">{l.text}</span></span>
          </li>
        ))}
      </ul>
      <ul className="mt-5 space-y-1.5 border-t border-rule pt-3 text-[12px] text-ink-2">
        <li className="flex items-center gap-2"><EdgeSample stroke="var(--ink)" /> talked with, part of</li>
        <li className="flex items-center gap-2"><EdgeSample stroke="var(--k-topic)" /> about a topic</li>
        <li className="flex items-center gap-2"><EdgeSample stroke="var(--k-commitment)" dash="4 3" /> promised</li>
        <li className="flex items-center gap-2"><EdgeSample stroke="var(--k-habit-ink)" dash="1.5 3" /> showed a habit</li>
      </ul>
      <p className="mt-5 text-[12.5px] leading-snug text-ink-2">
        Hover or tab to a node to light up what it touches. Select one to see the conversations it came from and what was said.
        Live coaching lives on the phone; <Link href="/live" className="underline decoration-rule underline-offset-2 hover:decoration-ink">the live view</Link> is still here.
      </p>
    </section>
  );
}

function EdgeSample({ stroke, dash }: { stroke: string; dash?: string }) {
  return <svg width={28} height={6} aria-hidden><line x1={0} x2={28} y1={3} y2={3} stroke={stroke} strokeWidth={1.4} strokeDasharray={dash} /></svg>;
}

function GraphLoading() {
  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4" aria-busy aria-live="polite">
      <svg width={160} height={160} viewBox="-80 -80 160 160" aria-hidden>
        {[28, 50, 72].map((r) => <circle key={r} r={r} fill="none" stroke="var(--rule)" strokeDasharray="2 4" />)}
        <circle r={9} fill="var(--ink)" className="graph-breathe" />
      </svg>
      <p className="serif text-[24px] text-ink-3">Drawing your graph…</p>
    </div>
  );
}

function GraphEmpty({ days, onWiden }: { days: number; onWiden: (() => void) | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <svg width={64} height={64} viewBox="-32 -32 64 64" aria-hidden>
        <circle r={26} fill="none" stroke="var(--rule)" strokeDasharray="2 4" />
        <circle r={9} fill="var(--ink)" />
      </svg>
      <p className="serif mt-4 text-[30px] leading-tight">No conversations in the last {days} days.</p>
      <p className="mt-2 max-w-[44ch] text-[13px] text-ink-2">Wear the band. Each conversation joins the graph the moment it ends, with the people, topics and promises in it.</p>
      {onWiden && <button type="button" className="btn mt-4" onClick={onWiden}>Look back 90 days</button>}
    </div>
  );
}

function GraphUnavailable() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <svg width={64} height={64} viewBox="-32 -32 64 64" aria-hidden>
        <circle r={26} fill="none" stroke="var(--rule)" strokeDasharray="2 4" />
      </svg>
      <p className="serif mt-4 text-[30px] leading-tight">Nothing to draw until the backend answers.</p>
    </div>
  );
}

function FilteredAway({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <p className="serif text-[28px] leading-tight">Every kind is switched off.</p>
      <button type="button" className="btn mt-4" onClick={onReset}>Show everything</button>
    </div>
  );
}
