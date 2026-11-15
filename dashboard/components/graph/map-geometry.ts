/**
 * Small drawing helpers for the Insights map: edge curves, pan bounds and colours by kind.
 * Layout maths stays in lib/graph/layout.ts.
 */
import { hash, type Point, type Positions, type View } from '@/lib/graph/layout';
import type { GraphNodeKind } from '@/lib/graph/types';

/** The design-system kind for a graph node kind ("commitment" is a promise). */
export function kindVar(kind: GraphNodeKind): string {
  if (kind === 'me') return 'var(--accent)';
  if (kind === 'commitment') return 'var(--kind-promise)';
  return `var(--kind-${kind})`;
}

/** A gentle curve from a to b; the bend side is stable per edge so a redraw never flips it. */
export function edgePath(a: Point, b: Point, seed: string): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const bend = ((hash(seed) % 2) ? 1 : -1) * 0.12;
  const cx = (a.x + b.x) / 2 - dy * bend;
  const cy = (a.y + b.y) / 2 + dx * bend;
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}

/** Interpolate between two layouts; nodes new to `to` grow out from where they will settle. */
export function lerpPositions(from: Positions, to: Positions, t: number): Positions {
  const out: Positions = {};
  for (const id of Object.keys(to)) {
    const b = to[id];
    const a = from[id] ?? b;
    out[id] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return out;
}

export function lerpView(a: View, b: View, t: number): View {
  return { k: a.k + (b.k - a.k) * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Keep at least `keep` px of the drawing inside the box, so the map can never be lost off screen. */
export function clampPan(view: View, positions: Positions, w: number, h: number, keep = 96): View {
  const ids = Object.keys(positions);
  if (ids.length === 0 || w <= 0) return view;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const id of ids) {
    const p = positions[id];
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const left = minX * view.k + view.x;
  const right = maxX * view.k + view.x;
  const top = minY * view.k + view.y;
  const bottom = maxY * view.k + view.y;
  let { x, y } = view;
  const kx = Math.min(keep, (right - left) / 2 + 24);
  const ky = Math.min(keep, (bottom - top) / 2 + 24);
  if (right < kx) x += kx - right;
  if (left > w - kx) x -= left - (w - kx);
  if (bottom < ky) y += ky - bottom;
  if (top > h - ky) y -= top - (h - ky);
  return x === view.x && y === view.y ? view : { ...view, x, y };
}
