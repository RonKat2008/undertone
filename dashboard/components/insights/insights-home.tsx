'use client';

/**
 * Insights: the report for the chosen view on one side and the map on the other (map first and
 * compact on narrow screens). The view, the range and the selection live in the URL
 * (?view=people&days=7&node=person:alex) so any state can be shared or bookmarked.
 *
 * Data: GET /graph for the map, one GET /reports/* for the view, and GET /reports/person|topic/{id}
 * for an open person or topic. Each report's graph_focus decides what the map lights.
 */
import { m, useReducedMotion } from 'motion/react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { InsightMap } from '@/components/graph/insight-map';
import { Button, EmptyState, KindDot, Page, Panel, SegmentedControl, Skeleton, TextLink, toast } from '@/components/ui';
import { getGraph, type GraphResult } from '@/lib/api/client';
import {
  clearRelationship, getByPerson, getByTopic, getHabitsReport, getOverview, getPersonReport, getPromisesReport,
  getTopicReport, setPromiseOpen, setRelationship, type RelationshipState, type ReportResult,
} from '@/lib/api/reports';
import {
  focusSet, habitFocus, nodeKey, oneHopFocus, parseInsightsUrl, promiseFocus, RANGES, viewForNode, writeInsightsUrl,
  type ByPersonReport, type ByTopicReport, type GraphFocus, type HabitsReport, type InsightsUrlState, type InsightView,
  type OverviewReport, type PersonReport, type PromisesReport, type RangeDays, type RelationshipKind, type ReportPromise,
  type TopicReport,
} from '@/lib/api/reports-model';
import { motionPresets } from '@/lib/motion';
import type { GraphNode } from '@/lib/graph/types';
import { HabitDetail, HabitsList } from './habits-view';
import { OverviewView } from './overview-view';
import { PeopleList, PersonDetail } from './people-view';
import { PromisesView } from './promises-view';
import { DetailSkeleton, LoadFailure, ReportSkeleton, conversationHref } from './shared';
import { TopicDetail, TopicsList } from './topics-view';
import { useLoad } from './use-load';
import { ViewSwitcher } from './view-switcher';

type ListData =
  | { view: 'overview'; r: ReportResult<OverviewReport> }
  | { view: 'people'; r: ReportResult<ByPersonReport> }
  | { view: 'topics'; r: ReportResult<ByTopicReport> }
  | { view: 'habits'; r: ReportResult<HabitsReport> }
  | { view: 'promises'; r: ReportResult<PromisesReport> };

type DetailData = { kind: 'person'; r: ReportResult<PersonReport> } | { kind: 'topic'; r: ReportResult<TopicReport> };

async function loadList(view: InsightView, days: number, signal: AbortSignal): Promise<ListData> {
  switch (view) {
    case 'overview': return { view, r: await getOverview(days, signal) };
    case 'people': return { view, r: await getByPerson(days, signal) };
    case 'topics': return { view, r: await getByTopic(days, signal) };
    case 'habits': return { view, r: await getHabitsReport(days, signal) };
    case 'promises': return { view, r: await getPromisesReport(days, signal) };
  }
}

const ME: GraphNode = { id: 'me', kind: 'me', label: 'You', weight: 0, last_seen: null, meta: {} };
const WIDE_QUERY = '(min-width: 900px)';
const RANGE_OPTIONS = RANGES.map((d) => ({ value: String(d), label: `${d} days` }));

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => { const mq = window.matchMedia(WIDE_QUERY); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb); },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

export function InsightsHome() {
  const params = useSearchParams();
  const url = parseInsightsUrl(params);
  const { view, days, node } = url;
  const wide = useWide();
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  const [now] = useState(() => Date.now() / 1000);

  const navigate = useCallback((patch: Partial<InsightsUrlState>, mode: 'push' | 'replace' = 'push') => {
    const next = { ...parseInsightsUrl(window.location.search), ...patch };
    const qs = writeInsightsUrl(window.location.search, next);
    const href = `${window.location.pathname}${qs}`;
    if (mode === 'push') window.history.pushState(null, '', href);
    else window.history.replaceState(null, '', href);
  }, []);
  const hrefFor = (patch: Partial<InsightsUrlState>) => `/insights${writeInsightsUrl(params.toString(), { ...url, ...patch })}`;

  // ---------- data ----------
  const graph = useLoad<GraphResult>(`graph:${days}`, () => getGraph(days));
  const list = useLoad<ListData>(`${view}:${days}`, (signal) => loadList(view, days, signal));
  const detailKind = node?.startsWith('person:') && view === 'people' ? 'person' : node?.startsWith('topic:') && view === 'topics' ? 'topic' : null;
  const detail = useLoad<DetailData>(detailKind && node ? `${node}:${days}` : null, async (signal) => (
    detailKind === 'person'
      ? { kind: 'person', r: await getPersonReport(nodeKey(node ?? ''), days, signal) }
      : { kind: 'topic', r: await getTopicReport(nodeKey(node ?? ''), days, signal) }
  ));

  // ---------- promises: optimistic, rolled back on failure ----------
  const [promiseOverride, setPromiseOverride] = useState<Record<string, boolean>>({});
  const isOpen = useCallback((p: ReportPromise) => promiseOverride[p.id] ?? p.open, [promiseOverride]);
  const togglePromise = (p: ReportPromise) => {
    const before = promiseOverride[p.id];
    const next = !(before ?? p.open);
    setPromiseOverride((o) => ({ ...o, [p.id]: next }));
    setPromiseOpen(p.id, next).then(
      () => { toast(next ? 'Reopened' : 'Marked done'); graph.quiet(); },
      () => {
        setPromiseOverride((o) => {
          const rest = { ...o };
          if (before === undefined) delete rest[p.id]; else rest[p.id] = before;
          return rest;
        });
        toast.error(next ? "Couldn't reopen that promise. Check your laptop is on, then try again." : "Couldn't mark that promise done. Check your laptop is on, then try again.");
      },
    );
  };

  // ---------- relationships: corrected in place ----------
  const [relOverride, setRelOverride] = useState<Record<string, RelationshipState>>({});
  const [relBusy, setRelBusy] = useState<string | null>(null);
  const relationshipOf = useCallback((personId: string) => relOverride[personId], [relOverride]);
  const changeRelationship = (personId: string, kind: Exclude<RelationshipKind, 'unknown'> | null) => {
    const before = relOverride[personId];
    if (kind) setRelOverride((o) => ({ ...o, [personId]: { kind, confidence: 1, source: 'user' } }));
    setRelBusy(personId);
    const call = kind ? setRelationship(personId, kind) : clearRelationship(personId);
    call.then(
      (rel) => {
        setRelOverride((o) => ({ ...o, [personId]: rel }));
        toast(kind ? 'Saved' : 'Undertone will decide from now on');
      },
      () => {
        setRelOverride((o) => {
          const rest = { ...o };
          if (before === undefined) delete rest[personId]; else rest[personId] = before;
          return rest;
        });
        toast.error("Couldn't save that. Check your laptop is on, then try again.");
      },
    ).finally(() => setRelBusy(null));
  };

  // ---------- selection ----------
  const open = (nodeId: string) => navigate({ view: viewForNode(nodeId) ?? view, node: nodeId });
  const select = (nodeId: string | null) => (nodeId === null ? navigate({ node: null }) : open(nodeId));
  const back = () => navigate({ node: null });

  // ---------- what the map lights ----------
  const g = graph.result;
  const graphReady = g !== null && (g.source === 'live' || g.source === 'empty');
  const nodes = useMemo(() => {
    if (!g || !graphReady) return [];
    return g.data.nodes.length > 0 ? g.data.nodes : [ME];
  }, [g, graphReady]);
  const edges = useMemo(() => (g && graphReady ? g.data.edges : []), [g, graphReady]);
  const listData = list.result;
  const habitSel = node && listData?.view === 'habits' && listData.r.kind === 'ok' ? listData.r.data.habits.find((h) => h.habit.node_id === node) ?? null : null;
  const promiseList = listData?.view === 'promises' && listData.r.kind === 'ok' ? [...listData.r.data.open, ...listData.r.data.done] : [];
  const promiseSel = node ? promiseList.find((p) => p.id === node) ?? null : null;

  const focus = useMemo(() => {
    let src: GraphFocus | null = null;
    const d = detail.result;
    if (node && d && d.r.kind === 'ok') src = d.r.data.graph_focus;
    else if (habitSel) src = habitFocus(habitSel);
    else if (promiseSel) src = promiseFocus(promiseSel);
    else if (node && nodes.some((n) => n.id === node) && !(d && d.r.kind !== 'ok')) return oneHopFocus(node, edges);
    else if (listData && listData.r.kind === 'ok') src = listData.r.data.graph_focus;
    return focusSet(src);
  }, [node, detail.result, habitSel, promiseSel, nodes, edges, listData]);

  // ---------- render ----------
  const listFailed = listData?.r.kind === 'error' && listData.r.unreachable;
  const graphFailed = g?.source === 'unreachable';
  if (listFailed && graphFailed) {
    return (
      <InsightsFrame days={days} view={view} onDays={(d) => navigate({ days: d }, 'replace')} onView={(v) => navigate({ view: v, node: null })}>
        <Panel className="col-span-full">
          <LoadFailure unreachable what="your insights" onRetry={() => { graph.retry(); list.retry(); }} />
        </Panel>
      </InsightsFrame>
    );
  }

  const selectedConversation = node?.startsWith('conversation:') ? nodes.find((n) => n.id === node) ?? null : null;
  const onlyMe = graphReady && nodes.length <= 1;

  const mapPanel = (
    <Panel padding="none" className="relative h-[300px] overflow-hidden min-[900px]:sticky min-[900px]:top-6 min-[900px]:h-[min(640px,calc(100dvh-120px))]">
      {g === null ? (
        <div className="grid h-full place-items-center p-6"><Skeleton shape="block" height="100%" /></div>
      ) : !graphReady ? (
        <EmptyState mark="offline" action={<Button size="small" onClick={graph.retry}>Try again</Button>}>
          The map can&apos;t load right now.
        </EmptyState>
      ) : (
        <InsightMap nodes={nodes} edges={edges} focus={focus} selectedId={node} onSelect={select} compact={!wide}
          reducedMotion={reduced} graphKey={`${days}:${nodes.length}`} />
      )}
      {onlyMe ? (
        <p className="pointer-events-none absolute inset-x-0 bottom-5 text-center text-caption text-muted">Just you, for now.</p>
      ) : null}
      {selectedConversation ? (
        <m.div variants={presets.enter} initial="hidden" animate="shown"
          className="qi-float absolute inset-x-3 bottom-3 grid gap-1 p-4 min-[900px]:right-auto min-[900px]:max-w-[320px]">
          <p className="flex items-center gap-2 text-caption text-muted"><KindDot kind="conversation" />{selectedConversation.label}</p>
          {typeof selectedConversation.meta.headline === 'string' ? <p className="text-body">{selectedConversation.meta.headline}</p> : null}
          <TextLink href={conversationHref(nodeKey(selectedConversation.id))}>Open the conversation</TextLink>
        </m.div>
      ) : null}
    </Panel>
  );

  const contentKey = `${view}:${detailKind && node ? node : habitSel ? node : 'list'}`;
  return (
    <InsightsFrame days={days} view={view} onDays={(d) => navigate({ days: d }, 'replace')} onView={(v) => navigate({ view: v, node: null })}>
      <div className="min-w-0 min-[900px]:order-2">{mapPanel}</div>
      <m.div key={contentKey} variants={presets.enter} initial="hidden" animate="shown" className="min-w-0 min-[900px]:order-1">
        <ReportColumn
          list={listData} detail={detailKind ? detail.result : undefined} habitSel={habitSel} days={days} now={now} node={node}
          onRetry={() => { list.retry(); detail.retry(); }} onOpen={open} onSelect={open} onBack={back} hrefFor={hrefFor}
          isOpen={isOpen} onTogglePromise={togglePromise} relationship={relationshipOf} relBusy={relBusy} onRelationship={changeRelationship}
          onSelectPromise={(p) => navigate({ node: p.id === node ? null : p.id }, 'replace')}
        />
      </m.div>
    </InsightsFrame>
  );
}

function InsightsFrame({ days, view, onDays, onView, children }: {
  days: RangeDays; view: InsightView; onDays: (d: RangeDays) => void; onView: (v: InsightView) => void; children: ReactNode;
}) {
  return (
    <Page title="Insights" width="wide"
      action={<SegmentedControl label="Time range" options={RANGE_OPTIONS} value={String(days)} onValueChange={(v) => onDays(Number(v) as RangeDays)} />}>
      <div className="grid gap-6">
        <ViewSwitcher value={view} onChange={onView} />
        <div className="grid items-start gap-6 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">{children}</div>
      </div>
    </Page>
  );
}

interface ReportColumnProps {
  list: ListData | null;
  detail: DetailData | null | undefined;
  habitSel: HabitsReport['habits'][number] | null;
  days: number;
  now: number;
  node: string | null;
  onRetry: () => void;
  onOpen: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  onBack: () => void;
  hrefFor: (patch: Partial<InsightsUrlState>) => string;
  isOpen: (p: ReportPromise) => boolean;
  onTogglePromise: (p: ReportPromise) => void;
  relationship: (personId: string) => RelationshipState | undefined;
  relBusy: string | null;
  onRelationship: (personId: string, kind: Exclude<RelationshipKind, 'unknown'> | null) => void;
  onSelectPromise: (p: ReportPromise) => void;
}

function ReportColumn(props: ReportColumnProps) {
  const { list, detail, habitSel, days, now, node, onRetry, onOpen, onSelect, onBack, hrefFor, isOpen, onTogglePromise } = props;

  // An open person or topic.
  if (detail !== undefined) {
    if (detail === null) return <DetailSkeleton />;
    if (detail.r.kind === 'error') return <LoadFailure unreachable={detail.r.unreachable} what="this report" onRetry={onRetry} />;
    if (detail.r.kind === 'not_found') {
      return (
        <EmptyState mark="idle" action={<Button onClick={onBack}>{detail.kind === 'person' ? 'Show everyone' : 'Show all topics'}</Button>}>
          {`Nothing about this ${detail.kind} in the last ${days} days. Try a longer range.`}
        </EmptyState>
      );
    }
    if (detail.kind === 'person') {
      return (
        <PersonDetail data={detail.r.data} now={now} onBack={onBack} onOpen={onOpen} relationship={props.relationship}
          relationshipBusy={props.relBusy === detail.r.data.person.person_id} onRelationship={props.onRelationship}
          isOpen={isOpen} onTogglePromise={onTogglePromise} />
      );
    }
    return <TopicDetail data={detail.r.data} days={days} now={now} onBack={onBack} onOpen={onOpen} isOpen={isOpen} onTogglePromise={onTogglePromise} />;
  }

  if (list === null) return <ReportSkeleton />;
  if (list.r.kind !== 'ok') {
    return <LoadFailure unreachable={list.r.kind === 'error' && list.r.unreachable} what="this report" onRetry={onRetry} />;
  }
  switch (list.view) {
    case 'overview':
      return <OverviewView data={list.r.data} days={days} onOpen={onOpen} hrefFor={hrefFor} />;
    case 'people':
      return <PeopleList data={list.r.data} days={days} now={now} selectedId={node} onSelect={onSelect} relationship={props.relationship} />;
    case 'topics':
      return <TopicsList data={list.r.data} days={days} now={now} selectedId={node} onSelect={onSelect} />;
    case 'habits':
      return habitSel
        ? <HabitDetail habit={habitSel} onBack={onBack} onOpen={onOpen} />
        : <HabitsList data={list.r.data} days={days} selectedId={node} onSelect={onSelect} />;
    case 'promises':
      return (
        <PromisesView data={list.r.data} days={days} now={now} selectedId={node} onSelect={props.onSelectPromise}
          isOpen={isOpen} onToggle={onTogglePromise} />
      );
  }
}
