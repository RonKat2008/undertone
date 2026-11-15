'use client';

/**
 * The Insights map: who you talk to and about what, drawn in SVG. d3-force (lib/graph/layout.ts)
 * supplies positions; everything here is drawing and interaction.
 *
 * - Nodes take their kind's colour and are sized by weight within their kind.
 * - `focus` (a report's graph_focus, or a selection) lights a neighbourhood; the rest steps back.
 *   Hovering a node lights its own neighbours for as long as the pointer stays.
 * - anime.js: nodes rise in and edges draw in on first render, lit edges redraw when focus
 *   changes, and nodes ease to their new places when the layout changes. Views tween too.
 * - Wide screens: drag the background to pan, Ctrl/⌘ + scroll or pinch to zoom, buttons to zoom.
 *   "Reset view" shows only after the person has moved the map. Compact screens: taps only, so
 *   the page always scrolls past the map.
 * - The map is a picture for pointer users; keyboard and screen-reader users get everything from
 *   the list beside it, so nodes are not tab stops.
 */
import { animate, createScope, createTimeline, stagger, svg as animeSvg, type Scope } from 'animejs';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, ICON, initials, Tooltip } from '@/components/ui';
import { clampPan, edgePath, kindVar, lerpPositions, lerpView } from '@/components/graph/map-geometry';
import { DURATION_MS } from '@/lib/motion';
import { edgeKey, oneHopFocus, type FocusSet } from '@/lib/api/reports-model';
import {
  computeLayout, fitView, labelBox, placeLabels, radiiFor, truncate, zoomAround,
  type LabelCandidate, type Positions, type View,
} from '@/lib/graph/layout';
import type { GraphEdge, GraphNode, GraphNodeKind } from '@/lib/graph/types';
import './map.css';

export interface InsightMapProps {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** What to light. Null lights everything evenly. */
  focus: FocusSet | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Narrow screens: no pan or zoom gestures, taps only. */
  compact: boolean;
  reducedMotion: boolean;
  /** Changes when a different graph arrives (another range), to replay the entrance. */
  graphKey: string;
}

type Tone = 'focus' | 'near' | 'dim' | 'normal';

const DRAW_ORDER: GraphNodeKind[] = ['conversation', 'commitment', 'habit', 'topic', 'person', 'me'];
const ENTER_ORDER: GraphNodeKind[] = ['me', 'person', 'topic', 'habit', 'commitment', 'conversation'];
const LABEL_PRIORITY: Record<GraphNodeKind, number> = { me: 90, person: 50, topic: 30, habit: 34, commitment: 22, conversation: 4 };
const ZOOM_STEP = 1.35;
const DRAG_THRESHOLD = 4;
const MOVE_MS = 640;

type Gesture =
  | { type: 'pan'; pointerId: number; x0: number; y0: number; view0: View; moved: boolean; nodeId: string | null }
  | { type: 'pinch'; dist0: number; view0: View; cx: number; cy: number };

export function InsightMap({ nodes, edges, focus, selectedId, onSelect, compact, reducedMotion, graphKey }: InsightMapProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [userMoved, setUserMoved] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // ---------- layout, eased between graphs ----------
  // A new graph settles from the previous layout, so a range change moves nodes a little instead of reshuffling.
  const [settled, setSettled] = useState(() => ({ nodes, edges, positions: computeLayout(nodes, edges) }));
  let layout = settled.positions;
  if (settled.nodes !== nodes || settled.edges !== edges) {
    layout = computeLayout(nodes, edges, { seed: settled.positions });
    setSettled({ nodes, edges, positions: layout });
  }
  const radii = useMemo(() => radiiFor(nodes), [nodes]);
  const [positions, setPositions] = useState<Positions>(layout);
  const shownRef = useRef<Positions>(layout);

  useEffect(() => {
    const from = shownRef.current;
    if (reducedMotion || Object.keys(from).length === 0) {
      shownRef.current = layout;
      setPositions(layout);
      return;
    }
    const tween = { t: 0 };
    const anim = animate(tween, {
      t: 1, duration: MOVE_MS, ease: 'inOutCubic',
      onUpdate: () => {
        const p = lerpPositions(from, layout, tween.t);
        shownRef.current = p;
        setPositions(p);
      },
    });
    return () => { anim.pause(); };
  }, [layout, reducedMotion]);

  // ---------- size ----------
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

  // ---------- view: fits the focus until the person moves the map ----------
  const target = useMemo<View>(() => {
    if (size.w === 0) return { k: 1, x: 0, y: 0 };
    const pad = compact ? 20 : 40;
    const ids = focus && focus.nodes.size > 1 && focus.nodes.size < nodes.length * 0.7
      ? Object.keys(layout).filter((id) => focus.nodes.has(id))
      : Object.keys(layout);
    const subset: Positions = Object.fromEntries(ids.map((id) => [id, layout[id]]));
    return fitView(subset, radii, size.w, size.h, pad, nodes.length <= 1 ? 1 : 1.6);
  }, [focus, layout, radii, size.w, size.h, compact, nodes.length]);

  const [view, setView] = useState<View>(target);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const viewAnim = useRef<{ pause: () => unknown } | null>(null);

  const glideTo = useCallback((to: View) => {
    viewAnim.current?.pause();
    const from = viewRef.current;
    if (reducedMotion || from.k === 0) {
      setView(to);
      return;
    }
    const tween = { t: 0 };
    viewAnim.current = animate(tween, { t: 1, duration: MOVE_MS, ease: 'inOutCubic', onUpdate: () => setView(lerpView(from, to, tween.t)) });
  }, [reducedMotion]);

  const firstFit = useRef(true);
  useEffect(() => {
    if (size.w === 0 || userMoved) return;
    if (firstFit.current) {
      firstFit.current = false;
      setView(target);
      return;
    }
    glideTo(target);
  }, [target, userMoved, glideTo, size.w]);

  useEffect(() => () => { viewAnim.current?.pause(); }, []);

  const moveView = useCallback((next: View) => {
    viewAnim.current?.pause();
    setUserMoved(true);
    setView(clampPan(next, shownRef.current, size.w, size.h));
  }, [size.w, size.h]);

  const resetView = () => {
    setUserMoved(false);
    glideTo(target);
  };

  // Wheel zoom with Ctrl/⌘ (and trackpad pinch, which sends ctrlKey). Plain scrolling scrolls the page.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || compact) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      moveView(zoomAround(viewRef.current, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.008)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [compact, moveView]);

  // ---------- emphasis ----------
  const hoverFocus = useMemo(() => (hoverId ? oneHopFocus(hoverId, edges) : null), [hoverId, edges]);
  const lit = hoverFocus ?? focus;
  const toneOf = (id: string): Tone => {
    if (!lit) return 'normal';
    if (id === hoverId || id === selectedId) return 'focus';
    return lit.nodes.has(id) ? 'near' : 'dim';
  };
  const edgeLit = (e: GraphEdge) => lit !== null && lit.edges.has(edgeKey(e.source, e.target));

  // ---------- anime.js: entrance and lit-edge draw ----------
  const scopeRef = useRef<Scope | null>(null);
  useEffect(() => {
    const root = svgRef.current;
    if (!root || reducedMotion || nodes.length === 0) return;
    const scope = createScope({ root }).add(() => {
      const tl = createTimeline({ defaults: { ease: 'outCubic' } });
      tl.add('.ins-node-enter', { opacity: [0, 1], scale: [0.4, 1], duration: DURATION_MS.slow, delay: stagger(16, { from: 'first' }) }, 0);
      tl.add(animeSvg.createDrawable('.ins-edge-base'), { draw: ['0 0', '0 1'], duration: 520, delay: stagger(5) }, 120);
    });
    scopeRef.current = scope;
    return () => { scope.revert(); scopeRef.current = null; };
    // Replays only for a new graph, not for every hover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey, reducedMotion, nodes.length > 0]);

  const litKey = lit ? [...lit.edges].sort().join(',') : '';
  const litLayer = useRef<SVGGElement>(null);
  useEffect(() => {
    const root = litLayer.current;
    if (!root || reducedMotion || !litKey) return;
    const paths = root.querySelectorAll('path');
    if (paths.length === 0) return;
    const scope = createScope({ root }).add(() => {
      animate(animeSvg.createDrawable(paths), { draw: ['0 0', '0 1'], duration: 420, ease: 'outCubic', delay: stagger(14) });
    });
    return () => scope.revert();
  }, [litKey, reducedMotion]);

  // ---------- pointer ----------
  const local = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };
  const nodeAt = (target: EventTarget | null) => (target instanceof Element ? target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null : null);

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const p = local(e);
    if (compact) {
      gesture.current = { type: 'pan', pointerId: e.pointerId, x0: p.x, y0: p.y, view0: view, moved: false, nodeId: nodeAt(e.target) };
      return;
    }
    pointers.current.set(e.pointerId, p);
    svgRef.current?.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { type: 'pinch', dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1, view0: view, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    gesture.current = { type: 'pan', pointerId: e.pointerId, x0: p.x, y0: p.y, view0: view, moved: false, nodeId: nodeAt(e.target) };
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g) return;
    const p = local(e);
    if (compact) {
      if (g.type === 'pan' && Math.hypot(p.x - g.x0, p.y - g.y0) > DRAG_THRESHOLD) g.moved = true;
      return;
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, p);
    if (g.type === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (a && b) moveView(zoomAround(g.view0, g.cx, g.cy, Math.hypot(a.x - b.x, a.y - b.y) / g.dist0));
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    if (!g.moved && Math.hypot(p.x - g.x0, p.y - g.y0) < DRAG_THRESHOLD) return;
    g.moved = true;
    moveView({ ...g.view0, x: g.view0.x + p.x - g.x0, y: g.view0.y + p.y - g.y0 });
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
    if (g.moved) return;
    if (g.nodeId && g.nodeId !== 'me') onSelect(g.nodeId === selectedId ? null : g.nodeId);
    else if (!g.nodeId) onSelect(null);
  }

  // ---------- drawing ----------
  const ordered = useMemo(
    () => [...nodes].sort((a, b) => DRAW_ORDER.indexOf(a.kind) - DRAW_ORDER.indexOf(b.kind) || a.weight - b.weight),
    [nodes],
  );
  const enterRank = useMemo(() => {
    const sorted = [...nodes].sort((a, b) => ENTER_ORDER.indexOf(a.kind) - ENTER_ORDER.indexOf(b.kind) || b.weight - a.weight);
    return new Map(sorted.map((n, i) => [n.id, i]));
  }, [nodes]);
  const kindOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.kind])), [nodes]);
  const drawn = ordered.filter((n) => positions[n.id]);
  const geometry = drawn.filter((n) => toneOf(n.id) !== 'dim').map((n) => ({ id: n.id, x: positions[n.id].x, y: positions[n.id].y, r: radii[n.id] ?? 6 }));
  const candidates: LabelCandidate[] = drawn.flatMap((n) => {
    const tone = toneOf(n.id);
    if (tone === 'dim' || n.kind === 'me') return [];
    if (n.kind === 'conversation' && tone === 'normal' && view.k < 1.8) return [];
    if (n.kind === 'conversation' && tone === 'near' && n.id !== hoverId) return [];
    const boost = tone === 'focus' ? 400 : tone === 'near' ? 60 : 0;
    const p = positions[n.id];
    const text = truncate(n.label, 24);
    return [{ id: n.id, x: p.x, y: p.y, r: radii[n.id] ?? 6, text, priority: LABEL_PRIORITY[n.kind] + boost + Math.min(n.weight, 20) }];
  });
  const obstacles = compact ? [] : [{ x: size.w - 56, y: size.h - 60, w: 56, h: 60 }];
  const placed = placeLabels(candidates, view, geometry, { w: size.w, h: size.h, obstacles });
  const litEdges = lit ? edges.filter(edgeLit) : [];

  const kindColor = (id: string) => kindVar(kindOf.get(id) ?? 'topic');
  const edgeColor = (e: GraphEdge) => {
    const s = kindOf.get(e.source);
    const t = kindOf.get(e.target);
    if (s === 'me') return kindColor(e.target);
    if (t === 'me') return kindColor(e.source);
    if (s === 'conversation') return kindColor(e.target);
    return kindColor(e.source);
  };

  return (
    <div ref={boxRef} className="ins-map" data-compact={compact || undefined}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className="ins-map-svg"
        data-pannable={!compact || undefined}
        role="img"
        aria-label="Map of the people, topics, habits and promises in your conversations. The list beside it holds the same things."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHoverId(null)}
      >
        <defs>
          <radialGradient id="ins-me-glow">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <g aria-hidden data-dimmed={lit ? '' : undefined} className="ins-edges">
            {edges.map((e) => {
              const a = positions[e.source];
              const b = positions[e.target];
              if (!a || !b) return null;
              const k = `${e.source}>${e.target}>${e.kind}`;
              return (
                <path key={k} className="ins-edge-base" d={edgePath(a, b, k)} fill="none" stroke="var(--line-strong)"
                  strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray={e.kind === 'promised' ? '3 4' : undefined} />
              );
            })}
          </g>
          <g aria-hidden ref={litLayer} key={litKey} className="ins-edges-lit">
            {litEdges.map((e) => {
              const a = positions[e.source];
              const b = positions[e.target];
              if (!a || !b) return null;
              const k = `${e.source}>${e.target}>${e.kind}`;
              return (
                <path key={k} d={edgePath(a, b, k)} fill="none" stroke={edgeColor(e)} strokeOpacity={0.75}
                  strokeWidth={1.6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              );
            })}
          </g>
          {drawn.map((n) => (
            <MapNode
              key={n.id} node={n} x={positions[n.id].x} y={positions[n.id].y} r={radii[n.id] ?? 6} k={view.k}
              tone={toneOf(n.id)} selected={n.id === selectedId} rank={enterRank.get(n.id) ?? 0}
              onHover={(on) => setHoverId((h) => (on ? n.id : h === n.id ? null : h))}
            />
          ))}
        </g>
        <g aria-hidden className="ins-labels">
          {candidates.map((c) => {
            const side = placed.get(c.id);
            if (!side) return null;
            const box = labelBox(c, view, side);
            const tone = toneOf(c.id);
            return (
              <text key={c.id} x={box.x + box.w / 2} y={box.y + 11} textAnchor="middle" className="ins-label"
                data-tone={tone} data-kind={kindOf.get(c.id)}>
                {c.text}
              </text>
            );
          })}
        </g>
      </svg>

      {!compact && nodes.length > 1 ? (
        <div className="ins-map-controls">
          {userMoved ? (
            <Button size="small" variant="quiet" onClick={resetView}>
              <RotateCcw {...ICON} size={15} aria-hidden />Reset view
            </Button>
          ) : null}
          <div className="ins-zoom">
            <Tooltip content="Zoom in" side="left">
              <Button size="small" variant="ghost" iconOnly aria-label="Zoom in"
                onClick={() => moveView(zoomAround(view, size.w / 2, size.h / 2, ZOOM_STEP))}>
                <Plus {...ICON} size={16} aria-hidden />
              </Button>
            </Tooltip>
            <Tooltip content="Zoom out" side="left">
              <Button size="small" variant="ghost" iconOnly aria-label="Zoom out"
                onClick={() => moveView(zoomAround(view, size.w / 2, size.h / 2, 1 / ZOOM_STEP))}>
                <Minus {...ICON} size={16} aria-hidden />
              </Button>
            </Tooltip>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface MapNodeProps {
  node: GraphNode;
  x: number;
  y: number;
  r: number;
  k: number;
  tone: Tone;
  selected: boolean;
  rank: number;
  onHover: (on: boolean) => void;
}

/** One node: an outer group placed by React, an entrance group anime.js owns, and a body CSS styles. */
function MapNode({ node, x, y, r, k, tone, selected, rank, onHover }: MapNodeProps) {
  const color = kindVar(node.kind);
  const kept = node.kind === 'commitment' && node.meta.open === false;
  const showInitials = node.kind === 'person' && r * k >= 11;
  return (
    <g transform={`translate(${x} ${y})`} data-node-id={node.id} className="ins-node-hit"
      onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      <title>{node.kind === 'me' ? 'You' : node.label}</title>
      <g className="ins-node-enter" style={{ ['--rank' as string]: rank }}>
        <g className="ins-node" data-tone={tone} data-kind={node.kind} data-selected={selected || undefined} style={{ ['--node' as string]: color }}>
          <circle r={Math.max(r + 6, 14 / k)} fill="transparent" />
          {node.kind === 'me' ? (
            <>
              <circle r={r * 2.6} fill="url(#ins-me-glow)" className="ins-me-glow" />
              <circle r={r + 5} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <circle r={r} className="ins-node-body" fill="var(--accent)" />
              <text className="ins-me-text" textAnchor="middle" dy="0.35em" fontSize={r * 0.62}>You</text>
            </>
          ) : (
            <>
              <circle r={r + 7} className="ins-node-halo" />
              <circle r={r} className="ins-node-body" data-kept={kept || undefined} vectorEffect="non-scaling-stroke" />
              {showInitials ? (
                <text className="ins-node-initials" textAnchor="middle" dy="0.35em" fontSize={Math.min(r * 0.78, 12)}>{initials(node.label)}</text>
              ) : null}
            </>
          )}
        </g>
      </g>
    </g>
  );
}

