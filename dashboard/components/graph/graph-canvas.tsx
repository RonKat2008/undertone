'use client';

/**
 * The network, drawn in SVG. d3-force only supplies positions (lib/graph/layout.ts).
 * Hover or focus lights a node and its neighbours; click or Enter selects; drag moves a node
 * (and pins it); drag the background to pan; Ctrl/⌘ + wheel or pinch to zoom; buttons for both.
 * With reduced motion there is no entrance animation and dragging moves only the one node.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { NodeShape } from '@/components/graph/node-shape';
import { describeNode } from '@/lib/graph/format';
import {
  createSimulation, fitView, placeLabels, readPositions, toScreen, toWorld, truncate, zoomAround,
  type LabelCandidate, type Positions, type SimLink, type SimNode, type View,
} from '@/lib/graph/layout';
import { buildAdjacency, edgeIsLit, emphasisFor, type Emphasis } from '@/lib/graph/model';
import type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeKind } from '@/lib/graph/types';
import type { Simulation } from 'd3-force';

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: Positions;
  radii: Record<string, number>;
  selectedId: string | null;
  matches: ReadonlySet<string> | null;
  reducedMotion: boolean;
  now: number;
  onSelect: (id: string | null) => void;
}

const DRAW_ORDER: GraphNodeKind[] = ['conversation', 'commitment', 'habit', 'topic', 'person', 'me'];
const LABEL_PRIORITY: Record<GraphNodeKind, number> = { me: 90, person: 40, topic: 30, habit: 26, commitment: 22, conversation: 4 };
const NODE_OPACITY: Record<Emphasis, number> = { focus: 1, near: 1, normal: 1, dim: 0.13 };
const EDGE_STYLE: Record<GraphEdgeKind, { stroke: string; dash?: string }> = {
  talked_with: { stroke: 'var(--ink)' },
  part_of: { stroke: 'var(--ink-2)' },
  about: { stroke: 'var(--k-topic)' },
  promised: { stroke: 'var(--k-commitment)', dash: '4 3' },
  showed: { stroke: 'var(--k-habit-ink)', dash: '1.5 3' },
};
const DRAG_THRESHOLD = 4;
const ZOOM_STEP = 1.3;

type Gesture =
  | { type: 'node'; id: string; pointerId: number; x0: number; y0: number; moved: boolean }
  | { type: 'pan'; pointerId: number; x0: number; y0: number; view0: View; moved: boolean }
  | { type: 'pinch'; dist0: number; view0: View; cx: number; cy: number };

export function GraphCanvas({ nodes, edges, layout, radii, selectedId, matches, reducedMotion, now, onSelect }: GraphCanvasProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [positions, setPositions] = useState<Positions>(layout);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const simRef = useRef<{ simulation: Simulation<SimNode, SimLink>; simNodes: SimNode[] } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const adj = useMemo(() => buildAdjacency(edges), [edges]);
  const ordered = useMemo(() => [...nodes].sort((a, b) => DRAW_ORDER.indexOf(a.kind) - DRAW_ORDER.indexOf(b.kind) || a.weight - b.weight), [nodes]);
  const focusId = hoverId ?? selectedId;

  // A new graph or filter brings a new layout: take it and refit.
  useEffect(() => {
    setPositions(layout);
  }, [layout]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.abs(s.w - width) < 1 && Math.abs(s.h - height) < 1 ? s : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (size.w > 0) setView(fitView(layout, radii, size.w, size.h, size.w < 500 ? 16 : 32));
  }, [layout, radii, size.w, size.h]);
  useEffect(fit, [fit]);

  // The live simulation, only for dragging with motion allowed. Idle (alpha 0) until a drag.
  useEffect(() => {
    if (reducedMotion) return;
    const sim = createSimulation(nodes, edges, { seed: layout });
    sim.simulation.alpha(0).on('tick', () => setPositions(readPositions(sim.simNodes)));
    simRef.current = sim;
    return () => {
      sim.simulation.stop();
      simRef.current = null;
    };
  }, [nodes, edges, layout, reducedMotion]);

  // Wheel zoom needs a non-passive listener. Plain wheel scrolls the page; Ctrl/⌘ (and trackpad pinch) zooms.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      setView((v) => zoomAround(v, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01)));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Bring a node selected from elsewhere (list, search, panel) into view.
  useEffect(() => {
    if (!selectedId || size.w === 0) return;
    const p = layout[selectedId];
    if (!p) return;
    setView((v) => {
      const s = toScreen(v, p);
      const margin = 40;
      if (s.x > margin && s.x < size.w - margin && s.y > margin && s.y < size.h - margin) return v;
      return { ...v, x: size.w / 2 - p.x * v.k, y: size.h / 2 - p.y * v.k };
    });
  }, [selectedId, layout, size.w, size.h]);

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  function moveNode(id: string, sx: number, sy: number) {
    const w = toWorld(view, sx, sy);
    const sim = simRef.current;
    const simNode = sim?.simNodes.find((n) => n.id === id);
    if (sim && simNode && simNode.kind !== 'me') {
      simNode.fx = w.x;
      simNode.fy = w.y;
      sim.simulation.alphaTarget(0.2).restart();
    } else if (!sim) {
      setPositions((p) => ({ ...p, [id]: w }));
    }
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    svgRef.current?.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { type: 'pinch', dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1, view0: view, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    const target = (e.target as Element).closest('[data-node-id]');
    const id = target?.getAttribute('data-node-id');
    gesture.current = id
      ? { type: 'node', id, pointerId: e.pointerId, x0: p.x, y0: p.y, moved: false }
      : { type: 'pan', pointerId: e.pointerId, x0: p.x, y0: p.y, view0: view, moved: false };
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (g.type === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const factor = Math.hypot(a.x - b.x, a.y - b.y) / g.dist0;
      setView(zoomAround(g.view0, g.cx, g.cy, factor));
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    const dist = Math.hypot(p.x - g.x0, p.y - g.y0);
    if (!g.moved && dist < DRAG_THRESHOLD) return;
    g.moved = true;
    if (g.type === 'pan') setView({ ...g.view0, x: g.view0.x + p.x - g.x0, y: g.view0.y + p.y - g.y0 });
    else moveNode(g.id, p.x, p.y);
  }

  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (g.type === 'node') {
      simRef.current?.simulation.alphaTarget(0);
      if (!g.moved) onSelect(g.id === selectedId ? null : g.id);
    } else if (!g.moved) {
      onSelect(null);
    }
  }

  function onNodeKey(e: KeyboardEvent<SVGGElement>, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(id);
    }
  }

  // Labels: drawn in screen space at a fixed size; collisions resolved greedily by priority.
  const drawn = ordered.filter((n) => positions[n.id]);
  const geometry = drawn.map((n) => ({ id: n.id, x: positions[n.id].x, y: positions[n.id].y, r: radii[n.id] ?? 6 }));
  const candidates: LabelCandidate[] = drawn.flatMap((n) => {
    const em = emphasisFor(n.id, adj, focusId, matches);
    if (em === 'dim') return [];
    const showsConversation = n.kind !== 'conversation' || em !== 'normal' || view.k > 1.7;
    if (!showsConversation) return [];
    const boost = em === 'focus' ? 200 : em === 'near' ? 60 : 0;
    const p = positions[n.id];
    return [{ id: n.id, x: p.x, y: p.y, r: radii[n.id] ?? 6, text: truncate(n.label), priority: LABEL_PRIORITY[n.kind] + boost + Math.min(n.weight, 20) }];
  });
  const labelled = placeLabels(candidates, view, geometry);
  const byId = new Map(drawn.map((n) => [n.id, n]));

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className="block cursor-grab touch-none select-none active:cursor-grabbing"
        aria-label={`Knowledge graph, ${nodes.length} nodes. Tab through the nodes, Enter opens one.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <g aria-hidden>
            {edges.map((e) => {
              const a = positions[e.source];
              const b = positions[e.target];
              if (!a || !b) return null;
              const lit = edgeIsLit(e, focusId);
              const dim = (focusId !== null || matches !== null) && !lit;
              const style = EDGE_STYLE[e.kind];
              return (
                <line key={`${e.source}>${e.target}>${e.kind}`} className="graph-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={style.stroke} strokeDasharray={style.dash} vectorEffect="non-scaling-stroke"
                  strokeWidth={lit ? 1.6 : 1} opacity={lit ? 0.85 : dim ? 0.05 : 0.2} />
              );
            })}
          </g>
          {drawn.map((n, i) => {
            const p = positions[n.id];
            const r = radii[n.id] ?? 6;
            const em = emphasisFor(n.id, adj, focusId, matches);
            const selected = n.id === selectedId;
            return (
              <g key={n.id} data-node-id={n.id} className="graph-node" transform={`translate(${p.x} ${p.y})`}
                opacity={NODE_OPACITY[em]} tabIndex={0} role="button" aria-pressed={selected}
                aria-label={`${n.label}. ${describeNode(n, now)}`}
                style={{ cursor: 'pointer' }}
                onPointerEnter={() => setHoverId(n.id)} onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                onFocus={() => setHoverId(n.id)} onBlur={() => setHoverId((h) => (h === n.id ? null : h))}
                onKeyDown={(e) => onNodeKey(e, n.id)}>
                <title>{n.label}</title>
                <circle r={Math.max(r + 6, 12 / view.k)} fill="transparent" />
                <circle className="focus-ring" r={r + 7} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" opacity={0} />
                {selected && <circle r={r + (n.kind === 'me' ? 9 : 5)} fill="none" stroke="var(--ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                <g className={reducedMotion ? undefined : 'anim-node'} style={reducedMotion ? undefined : { animationDelay: `${Math.min(i * 12, 420)}ms` }}>
                  <NodeShape kind={n.kind} r={r} open={n.meta.open !== false} strong={em === 'focus'} />
                </g>
              </g>
            );
          })}
        </g>
        <g aria-hidden className="pointer-events-none">
          {[...labelled].map((id) => {
            const n = byId.get(id);
            const p = positions[id];
            if (!n || !p) return null;
            const s = toScreen(view, p);
            const r = (radii[id] ?? 6) * view.k;
            const strong = id === focusId || n.kind === 'me' || n.kind === 'person';
            return (
              <text key={id} x={s.x} y={s.y + r + 13} textAnchor="middle" fontSize={11} fill={strong ? 'var(--ink)' : 'var(--ink-2)'}
                fontWeight={id === focusId ? 600 : strong ? 500 : 400} stroke="var(--paper)" strokeWidth={3.5} strokeLinejoin="round" paintOrder="stroke">
                {truncate(n.label)}
              </text>
            );
          })}
        </g>
      </svg>
      <div className="absolute right-2 top-2 flex flex-col border border-ink bg-paper">
        <button type="button" className="h-8 w-8 border-b border-rule text-[16px] leading-none hover:bg-well" aria-label="Zoom in"
          onClick={() => setView((v) => zoomAround(v, size.w / 2, size.h / 2, ZOOM_STEP))}>+</button>
        <button type="button" className="h-8 w-8 border-b border-rule text-[16px] leading-none hover:bg-well" aria-label="Zoom out"
          onClick={() => setView((v) => zoomAround(v, size.w / 2, size.h / 2, 1 / ZOOM_STEP))}>−</button>
        <button type="button" className="caps h-8 w-8 !text-[9px] hover:bg-well" aria-label="Fit the whole graph" onClick={fit}>Fit</button>
      </div>
      <p className="caps pointer-events-none absolute bottom-2 left-3 hidden !text-[9.5px] !text-ink-3 md:block">
        Drag to move · ⌘/Ctrl + scroll to zoom · click a node to open it
      </p>
    </div>
  );
}
