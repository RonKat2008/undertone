/**
 * Layout maths. d3-force computes positions only; drawing is ours (components/graph).
 * The layout is deterministic: seeded start angles and a seeded random source, so the same
 * graph always settles the same way and a refetch does not reshuffle the picture.
 *
 * World space is centred on "me" at (0, 0). A View maps world to screen: s = p * k + (x, y).
 */
import {
  forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from 'd3-force';
import type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeKind } from './types';

export interface Point { x: number; y: number }
export type Positions = Record<string, Point>;
export interface View { k: number; x: number; y: number }

export interface SimNode extends SimulationNodeDatum {
  id: string;
  kind: GraphNodeKind;
  r: number;
}
export type SimLink = SimulationLinkDatum<SimNode> & { kind: GraphEdgeKind };

/** Base radius per kind; weight adds up to SIZE_RANGE on top. */
const BASE_R: Record<GraphNodeKind, number> = { me: 20, person: 9, topic: 7, commitment: 6, habit: 7, conversation: 4.5 };
const SIZE_RANGE: Record<GraphNodeKind, number> = { me: 0, person: 9, topic: 7, commitment: 3, habit: 6, conversation: 4 };
/** Rings out from the centre, as a share of the outer radius. */
const RING: Record<GraphNodeKind, number> = { me: 0, person: 0.38, conversation: 0.62, habit: 0.9, topic: 0.95, commitment: 1 };
const LINK_DISTANCE: Record<GraphEdgeKind, number> = { talked_with: 70, part_of: 46, about: 60, promised: 52, showed: 64 };

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 4;

export function nodeRadius(node: Pick<GraphNode, 'kind' | 'weight'>, kindMax: number): number {
  const share = kindMax > 0 ? Math.sqrt(Math.max(0, node.weight) / kindMax) : 0;
  return BASE_R[node.kind] + SIZE_RANGE[node.kind] * Math.min(1, share);
}

/** The outer ring grows with the number of nodes so a big graph does not crowd. */
export function outerRadius(count: number): number {
  return 150 + Math.sqrt(Math.max(0, count)) * 26;
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded generator (mulberry32) for d3's jiggle, so layouts repeat exactly. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LayoutOptions {
  /** Previous positions, so a filter change moves nodes a little instead of starting over. */
  seed?: Positions;
  ticks?: number;
}

export function createSimulation(nodes: readonly GraphNode[], edges: readonly GraphEdge[], options: LayoutOptions = {}): {
  simulation: Simulation<SimNode, SimLink>; simNodes: SimNode[];
} {
  const outer = outerRadius(nodes.length);
  const kindMax = new Map<GraphNodeKind, number>();
  for (const n of nodes) kindMax.set(n.kind, Math.max(kindMax.get(n.kind) ?? 0, n.weight));
  const simNodes: SimNode[] = nodes.map((n) => {
    const r = nodeRadius(n, kindMax.get(n.kind) ?? 0);
    if (n.kind === 'me') return { id: n.id, kind: n.kind, r, x: 0, y: 0, fx: 0, fy: 0 };
    const seeded = options.seed?.[n.id];
    if (seeded) return { id: n.id, kind: n.kind, r, x: seeded.x, y: seeded.y };
    const angle = (hash(n.id) / 4294967296) * Math.PI * 2;
    const dist = RING[n.kind] * outer;
    return { id: n.id, kind: n.kind, r, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
  });
  const ids = new Set(simNodes.map((n) => n.id));
  const links: SimLink[] = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
    .map((e) => ({ source: e.source, target: e.target, kind: e.kind }));

  const simulation = forceSimulation<SimNode, SimLink>(simNodes)
    .randomSource(seededRandom(nodes.length * 7919 + edges.length))
    .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => LINK_DISTANCE[l.kind]).strength(0.18))
    .force('charge', forceManyBody<SimNode>().strength((d) => -70 - d.r * 9).distanceMax(outer * 1.4))
    .force('collide', forceCollide<SimNode>().radius((d) => d.r + 9).strength(0.9))
    .force('radial', forceRadial<SimNode>((d) => RING[d.kind] * outer, 0, 0).strength((d) => (d.kind === 'me' ? 0 : 0.32)))
    .stop();
  return { simulation, simNodes };
}

export function readPositions(simNodes: readonly SimNode[]): Positions {
  const out: Positions = {};
  for (const n of simNodes) out[n.id] = { x: n.x ?? 0, y: n.y ?? 0 };
  return out;
}

/** Run the simulation to rest without drawing: the static layout. */
export function computeLayout(nodes: readonly GraphNode[], edges: readonly GraphEdge[], options: LayoutOptions = {}): Positions {
  const { simulation, simNodes } = createSimulation(nodes, edges, options);
  const ticks = options.ticks ?? (options.seed ? 120 : 320);
  simulation.tick(ticks);
  return readPositions(simNodes);
}

// ---------- view (zoom and pan) ----------
export const clampZoom = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** The view that fits every node (with its radius) inside the box, centred. */
export function fitView(positions: Positions, radii: Record<string, number>, width: number, height: number, padding = 28, maxK = 1.5): View {
  const ids = Object.keys(positions);
  if (ids.length === 0 || width <= 0 || height <= 0) return { k: 1, x: width / 2, y: height / 2 };
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const id of ids) {
    const p = positions[id];
    const r = radii[id] ?? 0;
    minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r);
    minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r + 14); // room for the label under a node
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const k = clampZoom(Math.min((width - padding * 2) / w, (height - padding * 2) / h, maxK));
  return { k, x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k };
}

/** Zoom by `factor`, keeping the screen point (sx, sy) fixed under the pointer. */
export function zoomAround(view: View, sx: number, sy: number, factor: number): View {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return { k, x: sx - (sx - view.x) * ratio, y: sy - (sy - view.y) * ratio };
}

export function toWorld(view: View, sx: number, sy: number): Point {
  return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
}

export function toScreen(view: View, p: Point): Point {
  return { x: p.x * view.k + view.x, y: p.y * view.k + view.y };
}

// ---------- labels ----------
export interface LabelCandidate {
  id: string;
  x: number; // world
  y: number;
  r: number;
  text: string;
  priority: number;
}

export interface Box { x: number; y: number; w: number; h: number }

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Approximate label size in screen px at 11px Geist. */
export function labelBox(c: LabelCandidate, view: View, charW = 6.3, lineH = 14): Box {
  const s = toScreen(view, c);
  const w = Math.min(c.text.length, 26) * charW + 4;
  return { x: s.x - w / 2, y: s.y + c.r * view.k + 3, w, h: lineH };
}

/**
 * Greedy: highest priority first; a label is kept only if its box clears every kept label
 * and every node other than its own. Returns the ids whose label should be drawn.
 */
export function placeLabels(candidates: readonly LabelCandidate[], view: View, nodes: readonly { id: string; x: number; y: number; r: number }[]): Set<string> {
  const nodeBoxes = nodes.map((n) => {
    const s = toScreen(view, n);
    const r = n.r * view.k;
    return { id: n.id, box: { x: s.x - r, y: s.y - r, w: r * 2, h: r * 2 } };
  });
  const kept: Box[] = [];
  const out = new Set<string>();
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const c of sorted) {
    const box = labelBox(c, view);
    if (kept.some((k) => overlaps(k, box))) continue;
    if (nodeBoxes.some((n) => n.id !== c.id && overlaps(n.box, box))) continue;
    kept.push(box);
    out.add(c.id);
  }
  return out;
}

/** Shorten a label for the canvas; the full text stays in the title and the panel. */
export function truncate(text: string, max = 26): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
