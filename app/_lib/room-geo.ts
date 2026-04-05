/**
 * room-geo.ts — Shared room geometry helpers.
 *
 * Single source of truth for all geometric computation used by both the
 * Room Layout Builder and the Design page Room Top View.  Keeping one
 * implementation ensures the two views always render identically.
 */

import type { RoomSegment, SegmentDirection } from "./room-types";

// ─── Core types ───────────────────────────────────────────────────────────────

export type Point = [number, number];

export interface CanvasTransform {
  scale: number; offX: number; offY: number; minX: number; minY: number;
}

// ─── Vertex chain ─────────────────────────────────────────────────────────────

/**
 * Compute polygon vertices from segment chain. First vertex is at `origin` (default [0,0]).
 * If a segment has anchorX/anchorY the chain "teleports" to that position instead of
 * continuing from the previous segment's end.  pts[i+1] is always the END of segment[i].
 */
export function computePoints(segs: RoomSegment[], origin: Point = [0, 0]): Point[] {
  const pts: Point[] = [origin];
  for (const s of segs) {
    const prev = pts[pts.length - 1];
    const [x, y] = (s.anchorX !== undefined && s.anchorY !== undefined)
      ? [s.anchorX, s.anchorY] : prev;
    if (s.dxIn !== undefined && s.dyIn !== undefined) {
      pts.push([x + s.dxIn, y + s.dyIn]);
    } else {
      switch (s.direction) {
        case "right": pts.push([x + s.lengthIn, y]); break;
        case "left":  pts.push([x - s.lengthIn, y]); break;
        case "down":  pts.push([x, y + s.lengthIn]); break;
        case "up":    pts.push([x, y - s.lengthIn]); break;
      }
    }
  }
  return pts;
}

/**
 * Returns the actual start position of segment i.
 * For anchored (free-standing) segments this is anchorX/Y.
 * For chained segments this is pts[i] (the accumulated chain position).
 */
export function segStart(segs: RoomSegment[], pts: Point[], i: number): Point {
  const s = segs[i];
  if (s.anchorX !== undefined && s.anchorY !== undefined) return [s.anchorX, s.anchorY];
  return pts[i];
}

/** True when the last endpoint of the chain closes back to the first segment's start. */
export function isClosed(segs: RoomSegment[], pts: Point[]): boolean {
  if (segs.length < 3 || pts.length <= segs.length) return false;
  const firstStart = segStart(segs, pts, 0);
  const lastEnd    = pts[pts.length - 1];
  return Math.abs(firstStart[0] - lastEnd[0]) < 0.5 &&
         Math.abs(firstStart[1] - lastEnd[1]) < 0.5;
}

// ─── Segment property helpers ─────────────────────────────────────────────────

/** Actual Euclidean length in inches (correct for slanted/curved). */
export function segLength(seg: RoomSegment): number {
  if (seg.dxIn !== undefined && seg.dyIn !== undefined) {
    return Math.sqrt(seg.dxIn * seg.dxIn + seg.dyIn * seg.dyIn);
  }
  return seg.lengthIn;
}

/** Angle in degrees: 0=right, 90=down, 180=left, 270=up. */
export function segAngleDeg(seg: RoomSegment): number {
  if (seg.dxIn !== undefined && seg.dyIn !== undefined) {
    return Math.atan2(seg.dyIn, seg.dxIn) * 180 / Math.PI;
  }
  switch (seg.direction) {
    case "right": return 0;
    case "down":  return 90;
    case "left":  return 180;
    case "up":    return 270;
  }
}

/** True when a segment is not perfectly orthogonal. */
export function segIsSlanted(seg: RoomSegment): boolean {
  if (seg.dxIn === undefined || seg.dyIn === undefined) return false;
  return Math.abs(seg.dxIn) > 0.1 && Math.abs(seg.dyIn) > 0.1;
}

/** True when a segment has a breakpoint (two sub-legs). */
export function segHasBreakpoint(seg: RoomSegment): boolean {
  return seg.breakDxIn !== undefined && seg.breakDyIn !== undefined;
}

/** True when a segment has a bezier curve control point. */
export function segHasCurve(seg: RoomSegment): boolean {
  return seg.cpDxIn !== undefined && seg.cpDyIn !== undefined;
}

/** Resolve segment dx/dy vector (even for legacy direction-based segments). */
export function segDxDy(seg: RoomSegment): [number, number] {
  if (seg.dxIn !== undefined && seg.dyIn !== undefined) return [seg.dxIn, seg.dyIn];
  const l = seg.lengthIn;
  switch (seg.direction) {
    case "right": return [l,  0];
    case "down":  return [0,  l];
    case "left":  return [-l, 0];
    case "up":    return [0, -l];
  }
}

/** 8-direction compass symbol for display. */
export function dirSymbol(seg: RoomSegment): string {
  const a = ((segAngleDeg(seg)) % 360 + 360) % 360;
  if (a < 22.5 || a >= 337.5) return "→";
  if (a < 67.5)  return "↘";
  if (a < 112.5) return "↓";
  if (a < 157.5) return "↙";
  if (a < 202.5) return "←";
  if (a < 247.5) return "↖";
  if (a < 292.5) return "↑";
  return "↗";
}

/** Set segment to a specific angle (degrees), keeping length. */
export function setSegAngle(seg: RoomSegment, angleDeg: number): RoomSegment {
  const len = Math.max(1, segLength(seg));
  const rad = angleDeg * Math.PI / 180;
  return { ...seg, dxIn: len * Math.cos(rad), dyIn: len * Math.sin(rad), lengthIn: Math.round(len) };
}

/** Set segment to a specific length, keeping direction. */
export function setSegLen(seg: RoomSegment, newLen: number): RoomSegment {
  const len = Math.max(1, newLen);
  if (seg.dxIn !== undefined && seg.dyIn !== undefined) {
    const oldLen = Math.sqrt(seg.dxIn * seg.dxIn + seg.dyIn * seg.dyIn);
    if (oldLen > 0.01) {
      const s = len / oldLen;
      return { ...seg, dxIn: seg.dxIn * s, dyIn: seg.dyIn * s, lengthIn: Math.round(len) };
    }
  }
  return { ...seg, lengthIn: Math.round(len) };
}

/** Snap segment to an orthogonal direction, keeping current length. */
export function snapOrthogonal(seg: RoomSegment, dir: SegmentDirection): RoomSegment {
  const len = Math.max(1, Math.round(segLength(seg)));
  const map: Record<SegmentDirection, [number, number]> = {
    right: [len, 0], down: [0, len], left: [-len, 0], up: [0, -len],
  };
  const [dx, dy] = map[dir];
  return { ...seg, dxIn: dx, dyIn: dy, direction: dir, lengthIn: len };
}

// ─── Magnetic snap ────────────────────────────────────────────────────────────

export const SNAP_PX = 20; // screen-pixel radius for magnetic snap

export interface SnapTarget { id: string; pt: Point; }

/** Collect all vertex + anchor positions as snap targets. */
export function buildSnapTargets(segs: RoomSegment[], pts: Point[]): SnapTarget[] {
  const targets: SnapTarget[] = [];
  for (let i = 0; i < pts.length; i++) {
    targets.push({ id: `v:${i}`, pt: pts[i] });
  }
  for (const s of segs) {
    if (s.anchorX !== undefined && s.anchorY !== undefined) {
      targets.push({ id: `a:${s.id}`, pt: [s.anchorX, s.anchorY] });
    }
  }
  return targets;
}

/** Find closest snap target within SNAP_PX screen pixels. Returns snapped Point or null. */
export function findSnap(
  xIn: number, yIn: number,
  targets: SnapTarget[], excludeId: string, scale: number,
): Point | null {
  const threshIn = SNAP_PX / scale;
  let best: Point | null = null;
  let bestD = threshIn;
  for (const t of targets) {
    if (t.id === excludeId) continue;
    const d = Math.sqrt((t.pt[0] - xIn) ** 2 + (t.pt[1] - yIn) ** 2);
    if (d < bestD) { bestD = d; best = t.pt; }
  }
  return best;
}

// ─── Quadratic Bézier helpers ─────────────────────────────────────────────────

/** Evaluate quadratic bezier point at t ∈ [0,1]. */
export function qBez(t: number, p0: Point, p1: Point, p2: Point): Point {
  const mt = 1 - t;
  return [mt*mt*p0[0]+2*mt*t*p1[0]+t*t*p2[0], mt*mt*p0[1]+2*mt*t*p1[1]+t*t*p2[1]];
}

/** Evaluate quadratic bezier tangent vector at t (not normalized). */
export function qBezTan(t: number, p0: Point, p1: Point, p2: Point): Point {
  const mt = 1 - t;
  return [2*mt*(p1[0]-p0[0])+2*t*(p2[0]-p1[0]), 2*mt*(p1[1]-p0[1])+2*t*(p2[1]-p1[1])];
}

export const BEZIER_SAMPLES = 64;

/** Build cumulative arc-length table for a quadratic bezier. */
export function bezierArcTable(p0: Point, p1: Point, p2: Point): { t: number; s: number }[] {
  const table: { t: number; s: number }[] = [{ t: 0, s: 0 }];
  let prev = p0;
  for (let i = 1; i <= BEZIER_SAMPLES; i++) {
    const ti   = i / BEZIER_SAMPLES;
    const curr = qBez(ti, p0, p1, p2);
    const ds   = Math.sqrt((curr[0]-prev[0])**2 + (curr[1]-prev[1])**2);
    table.push({ t: ti, s: table[table.length-1].s + ds });
    prev = curr;
  }
  return table;
}

/** Given an arc-length table and target arc length s, return bezier parameter t. */
export function arcLengthToT(table: { t: number; s: number }[], s: number): number {
  const total = table[table.length-1].s;
  if (s <= 0) return 0;
  if (s >= total) return 1;
  let lo = 0, hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid].s <= s) lo = mid; else hi = mid;
  }
  const span = table[hi].s - table[lo].s;
  const frac = span < 0.0001 ? 0 : (s - table[lo].s) / span;
  return table[lo].t + frac * (table[hi].t - table[lo].t);
}

// ─── Canvas transform ─────────────────────────────────────────────────────────

/**
 * Compute the canvas transform so all room geometry fits within
 * (canvasW × canvasH) at the given zoom level, with canvasPad margin.
 * Anchored segment positions and bezier control points are included in
 * the bounding box so nothing gets clipped.
 */
export function computeTransform(
  segs: RoomSegment[], zoom = 1, origin: Point = [0, 0],
  canvasW: number, canvasH: number, canvasPad: number,
): CanvasTransform {
  const pts = computePoints(segs, origin);
  const allPts: Point[] = [...pts];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.anchorX !== undefined && s.anchorY !== undefined) {
      allPts.push([s.anchorX, s.anchorY]);
    }
    if (s.cpDxIn !== undefined && s.cpDyIn !== undefined) {
      const [sx, sy] = segStart(segs, pts, i);
      allPts.push([sx + s.cpDxIn, sy + s.cpDyIn]);
    }
  }
  const xs     = allPts.map(p => p[0]);
  const ys     = allPts.map(p => p[1]);
  const minX   = Math.min(...xs), maxX = Math.max(...xs);
  const minY   = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = Math.max(maxX - minX, 1);
  const rangeY = Math.max(maxY - minY, 1);
  const drawW  = canvasW - canvasPad * 2;
  const drawH  = canvasH - canvasPad * 2;
  const scale  = Math.min(drawW / rangeX, drawH / rangeY) * zoom;
  const offX   = canvasW / 2 - (rangeX / 2) * scale;
  const offY   = canvasH / 2 - (rangeY / 2) * scale;
  return { scale, offX, offY, minX, minY };
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

/**
 * Signed area via shoelace formula (anchor-aware).
 * Positive = CCW winding; negative = CW.
 * Used to determine the "inward" normal direction for closet footprints.
 */
export function computeSignedArea(segs: RoomSegment[], pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < segs.length; i++) {
    const [x1, y1] = segStart(segs, pts, i);
    const [x2, y2] = pts[i + 1];
    s += x1 * y2 - x2 * y1;
  }
  // Close: last end → first start
  if (pts.length > 1 && segs.length > 0) {
    const [lx, ly] = pts[pts.length - 1];
    const [fx, fy] = segStart(segs, pts, 0);
    s += lx * fy - fx * ly;
  }
  return s;
}

/**
 * Factory: returns a wallPt(segIdx, alongIn, depthIn) → [svgX, svgY] function.
 * depthIn > 0 projects toward the "inward" side (per normalSign).
 * Pass negative depthIn (via footprintFlipped) to project the other way.
 * Handles straight, breakpoint, and bezier-curved segments.
 */
export function makeWallPtFn(
  segs: RoomSegment[],
  pts: Point[],
  normalSign: number,
  tx: (x: number) => number,
  ty: (y: number) => number,
): (segIdx: number, alongIn: number, depthIn: number) => [number, number] {
  return function wallPt(segIdx, alongIn, depthIn) {
    const [wx1, wy1] = segStart(segs, pts, segIdx);
    if (segIdx + 1 >= pts.length) return [tx(wx1), ty(wy1)];
    const [wx2, wy2] = pts[segIdx + 1];
    const seg = segs[segIdx];

    // Bezier curve
    if (seg.cpDxIn !== undefined && seg.cpDyIn !== undefined) {
      const p0: Point = [wx1, wy1];
      const p1: Point = [wx1 + seg.cpDxIn, wy1 + seg.cpDyIn];
      const p2: Point = [wx2, wy2];
      const table = bezierArcTable(p0, p1, p2);
      const t     = arcLengthToT(table, alongIn);
      const [bx, by]   = qBez(t, p0, p1, p2);
      const [tdx, tdy] = qBezTan(t, p0, p1, p2);
      const tlen = Math.sqrt(tdx*tdx + tdy*tdy) || 1;
      const nx = -tdy / tlen * normalSign, ny = tdx / tlen * normalSign;
      return [tx(bx + nx * depthIn), ty(by + ny * depthIn)];
    }

    // Breakpoint (two straight sub-legs)
    if (seg.breakDxIn !== undefined && seg.breakDyIn !== undefined) {
      const bx = wx1 + seg.breakDxIn, by = wy1 + seg.breakDyIn;
      const leg1Len = Math.sqrt(seg.breakDxIn**2 + seg.breakDyIn**2);
      const leg2dx  = wx2 - bx, leg2dy = wy2 - by;
      const leg2Len = Math.sqrt(leg2dx**2 + leg2dy**2);
      if (leg1Len > 0.01 && alongIn <= leg1Len) {
        const ux = seg.breakDxIn / leg1Len, uy = seg.breakDyIn / leg1Len;
        const nx = -uy * normalSign, ny = ux * normalSign;
        return [tx(wx1 + ux*alongIn + nx*depthIn), ty(wy1 + uy*alongIn + ny*depthIn)];
      }
      const rem = alongIn - leg1Len;
      if (leg2Len < 0.01) return [tx(bx), ty(by)];
      const ux = leg2dx / leg2Len, uy = leg2dy / leg2Len;
      const nx = -uy * normalSign, ny = ux * normalSign;
      return [tx(bx + ux*rem + nx*depthIn), ty(by + uy*rem + ny*depthIn)];
    }

    // Straight
    const wlen = Math.sqrt((wx2-wx1)**2 + (wy2-wy1)**2);
    if (wlen < 0.01) return [tx(wx1), ty(wy1)];
    const ux = (wx2-wx1) / wlen, uy = (wy2-wy1) / wlen;
    const nx = -uy * normalSign, ny = ux * normalSign;
    return [tx(wx1 + ux*alongIn + nx*depthIn), ty(wy1 + uy*alongIn + ny*depthIn)];
  };
}

/**
 * Build SVG path data for the room perimeter.
 * Handles straight, breakpoint, and bezier-curved segments.
 * Emits M (moveto) for anchored segments to break the chain in the path.
 */
export function buildRoomPath(
  segs: RoomSegment[],
  pts: Point[],
  closed: boolean,
  tx: (x: number) => number,
  ty: (y: number) => number,
): string {
  if (pts.length < 2) return "";
  const [s0x, s0y] = segStart(segs, pts, 0);
  let d = `M ${tx(s0x).toFixed(1)} ${ty(s0y).toFixed(1)}`;
  for (let i = 0; i < segs.length && i + 1 < pts.length; i++) {
    const seg = segs[i];
    const [sx, sy] = segStart(segs, pts, i);
    const [ex, ey] = pts[i + 1];
    // Anchored segment breaks the chain — moveto its start before drawing
    if (i > 0 && seg.anchorX !== undefined) {
      d += ` M ${tx(sx).toFixed(1)} ${ty(sy).toFixed(1)}`;
    }
    if (seg.cpDxIn !== undefined && seg.cpDyIn !== undefined) {
      const cpx = tx(sx + seg.cpDxIn), cpy = ty(sy + seg.cpDyIn);
      d += ` Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${tx(ex).toFixed(1)} ${ty(ey).toFixed(1)}`;
    } else if (seg.breakDxIn !== undefined && seg.breakDyIn !== undefined) {
      const bx = tx(sx + seg.breakDxIn), by = ty(sy + seg.breakDyIn);
      d += ` L ${bx.toFixed(1)} ${by.toFixed(1)} L ${tx(ex).toFixed(1)} ${ty(ey).toFixed(1)}`;
    } else {
      d += ` L ${tx(ex).toFixed(1)} ${ty(ey).toFixed(1)}`;
    }
  }
  if (closed) d += " Z";
  return d;
}
