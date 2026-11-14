/**
 * Pure graph helpers: validation at the API boundary, filtering, neighbour lookup, search,
 * the time window and stats. No React, no DOM; unit-tested in model.test.ts.
 */
import type {
  FilterKind, GraphEdge, GraphNode, GraphNodeDetail, GraphNodeKind, GraphStats, KnowledgeGraph,
} from './types';

export const NODE_KINDS: readonly GraphNodeKind[] = ['me', 'person', 'topic', 'commitment', 'habit', 'conversation'];
export const FILTER_KINDS: readonly FilterKind[] = ['person', 'topic', 'commitment', 'habit', 'conversation'];
const EDGE_KINDS = ['talked_with', 'about', 'promised', 'showed', 'part_of'];

export interface GraphSlice {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type Adjacency = ReadonlyMap<string, ReadonlySet<string>>;

// ---------- validation ----------
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isGraphNode(v: unknown): v is GraphNode {
  return isObject(v) && typeof v.id === 'string' && typeof v.label === 'string'
    && (NODE_KINDS as readonly unknown[]).includes(v.kind) && isNum(v.weight)
    && (v.last_seen === null || isNum(v.last_seen)) && isObject(v.meta);
}

export function isGraphEdge(v: unknown): v is GraphEdge {
  return isObject(v) && typeof v.source === 'string' && typeof v.target === 'string'
    && EDGE_KINDS.includes(v.kind as string) && isNum(v.weight);
}

export function isKnowledgeGraph(v: unknown): v is KnowledgeGraph {
  if (!isObject(v) || !Array.isArray(v.nodes) || !Array.isArray(v.edges) || !isObject(v.stats)) return false;
  return v.nodes.every(isGraphNode) && v.edges.every(isGraphEdge) && typeof v.sample === 'boolean';
}

export function isNodeDetail(v: unknown): v is GraphNodeDetail {
  return isObject(v) && isGraphNode(v.node) && Array.isArray(v.neighbours) && v.neighbours.every(isGraphNode)
    && Array.isArray(v.conversations) && Array.isArray(v.quotes)
    && v.quotes.every((q) => isObject(q) && typeof q.text === 'string' && typeof q.session_id === 'string');
}

// ---------- structure ----------
export function buildAdjacency(edges: readonly GraphEdge[]): Adjacency {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const set = adj.get(a) ?? new Set<string>();
    set.add(b);
    adj.set(a, set);
  };
  for (const e of edges) {
    if (e.source === e.target) continue;
    add(e.source, e.target);
    add(e.target, e.source);
  }
  return adj;
}

export function neighbourIds(adj: Adjacency, id: string): ReadonlySet<string> {
  return adj.get(id) ?? new Set<string>();
}

/** Drop nodes of switched-off kinds, and every edge that loses an end. "me" always stays. */
export function filterGraph(graph: GraphSlice, kinds: ReadonlySet<FilterKind>): GraphSlice {
  const nodes = graph.nodes.filter((n) => n.kind === 'me' || kinds.has(n.kind));
  const keep = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { nodes, edges };
}

export function groupByKind(nodes: readonly GraphNode[]): Record<GraphNodeKind, GraphNode[]> {
  const groups = Object.fromEntries(NODE_KINDS.map((k) => [k, [] as GraphNode[]])) as Record<GraphNodeKind, GraphNode[]>;
  for (const n of nodes) groups[n.kind].push(n);
  for (const k of NODE_KINDS) groups[k].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  return groups;
}

export function maxWeight(nodes: readonly GraphNode[], kind: GraphNodeKind): number {
  return nodes.reduce((m, n) => (n.kind === kind ? Math.max(m, n.weight) : m), 0);
}

// ---------- search ----------
export function normaliseText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Labels that match the query: whole-label prefix first, then word prefix, then substring. */
export function searchNodes(nodes: readonly GraphNode[], query: string, limit = 50): GraphNode[] {
  const q = normaliseText(query);
  if (!q) return [];
  const scored: { node: GraphNode; score: number }[] = [];
  for (const node of nodes) {
    const label = normaliseText(node.label);
    let score = -1;
    if (label.startsWith(q)) score = 3;
    else if (label.split(/[\s\-–—_/:'’"“”]+/).some((w) => w.startsWith(q))) score = 2;
    else if (label.includes(q)) score = 1;
    if (score > 0) scored.push({ node, score });
  }
  scored.sort((a, b) => b.score - a.score || b.node.weight - a.node.weight || a.node.label.localeCompare(b.node.label));
  return scored.slice(0, limit).map((s) => s.node);
}

// ---------- emphasis (hover / selection / search) ----------
export type Emphasis = 'focus' | 'near' | 'dim' | 'normal';

/**
 * How strongly to draw a node. A hovered (or else selected) node is "focus", its neighbours
 * "near", everything else "dim". With no focus, a search dims the non-matches.
 */
export function emphasisFor(
  id: string, adj: Adjacency, focusId: string | null, matches: ReadonlySet<string> | null,
): Emphasis {
  if (focusId) {
    if (id === focusId) return 'focus';
    return neighbourIds(adj, focusId).has(id) ? 'near' : 'dim';
  }
  if (matches) return matches.has(id) ? 'focus' : 'dim';
  return 'normal';
}

export function edgeIsLit(e: GraphEdge, focusId: string | null): boolean {
  return focusId !== null && (e.source === focusId || e.target === focusId);
}

// ---------- time window and stats ----------
const DAY = 86400;

/**
 * Keep the conversations seen within `days` of `now`, plus every node they touch, plus "me".
 * Used for the built-in sample; the real backend applies its own window.
 */
export function windowGraph(graph: KnowledgeGraph, days: number, now: number): KnowledgeGraph {
  const cutoff = now - days * DAY;
  const adj = buildAdjacency(graph.edges);
  const keep = new Set<string>();
  for (const n of graph.nodes) {
    if (n.kind === 'me') keep.add(n.id);
    if (n.kind === 'conversation' && n.last_seen !== null && n.last_seen >= cutoff) {
      keep.add(n.id);
      for (const id of neighbourIds(adj, n.id)) keep.add(id);
    }
  }
  const nodes = graph.nodes.filter((n) => keep.has(n.id));
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { ...graph, nodes, edges, stats: computeStats(nodes) };
}

export function computeStats(nodes: readonly GraphNode[]): GraphStats {
  let seconds = 0;
  const stats: GraphStats = { conversations: 0, people: 0, topics: 0, minutes_spoken: 0, open_commitments: 0 };
  for (const n of nodes) {
    if (n.kind === 'conversation') {
      stats.conversations += 1;
      const d = Number(n.meta.duration_s ?? 0);
      const r = Number(n.meta.talk_ratio ?? 0);
      if (Number.isFinite(d) && Number.isFinite(r)) seconds += d * r;
    } else if (n.kind === 'person') stats.people += 1;
    else if (n.kind === 'topic') stats.topics += 1;
    else if (n.kind === 'commitment' && n.meta.open === true) stats.open_commitments += 1;
  }
  return { ...stats, minutes_spoken: Math.round(seconds / 60) };
}

/** Only "me" and nothing else: the wearer has no conversations in this window. */
export function isEmptyGraph(graph: GraphSlice): boolean {
  return graph.nodes.filter((n) => n.kind !== 'me').length === 0;
}
