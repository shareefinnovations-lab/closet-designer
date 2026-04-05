"use client";
// app/room-layout/page.tsx — Room Layout Builder
//
// The room is defined as a polygon of vertices connected by wall segments.
// Each segment supports arbitrary angles (slanted walls) via dxIn/dyIn.
// "Has Closet" is a per-wall toggle, completely independent of room geometry.
// Vertices are draggable to reshape the room interactively.

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { RoomLayout, RoomSegment, SegmentDirection } from "@/app/_lib/room-types";
import type { Config } from "@/app/elevation/_lib/types";

// ─── ID counter ───────────────────────────────────────────────────────────────

let _id = 1;
function nextId(): string { return String(_id++); }
function seedId(segs: RoomSegment[]): void {
  const nums = segs.map(s => Number(s.id)).filter(n => !isNaN(n) && n > 0);
  const max  = nums.reduce((m, n) => Math.max(m, n), 0);
  if (max >= _id) _id = max + 1;
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

type Point = [number, number];

/** Compute polygon vertices from segment chain. First vertex is at `origin` (default [0,0]). */
function computePoints(segs: RoomSegment[], origin: Point = [0, 0]): Point[] {
  const pts: Point[] = [origin];
  for (const s of segs) {
    const [x, y] = pts[pts.length - 1];
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

function isClosed(pts: Point[]): boolean {
  if (pts.length < 4) return false; // need at least 3 segments to form a polygon
  return Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 0.5 &&
         Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 0.5;
}

/** Actual geometric length of a segment in inches. */
function segLength(seg: RoomSegment): number {
  if (seg.dxIn !== undefined && seg.dyIn !== undefined) {
    return Math.sqrt(seg.dxIn * seg.dxIn + seg.dyIn * seg.dyIn);
  }
  return seg.lengthIn;
}

/** Angle of a segment in degrees (0° = right/east, 90° = down/south). */
function segAngleDeg(seg: RoomSegment): number {
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
function segIsSlanted(seg: RoomSegment): boolean {
  if (seg.dxIn === undefined || seg.dyIn === undefined) return false;
  const eps = 0.1;
  return Math.abs(seg.dxIn) > eps && Math.abs(seg.dyIn) > eps;
}

/** True when a segment has a breakpoint (two sub-legs). */
function segHasBreakpoint(seg: RoomSegment): boolean {
  return seg.breakDxIn !== undefined && seg.breakDyIn !== undefined;
}

/** Resolve segment's dx/dy vector (even for legacy direction-based segments). */
function segDxDy(seg: RoomSegment): [number, number] {
  if (seg.dxIn !== undefined && seg.dyIn !== undefined) return [seg.dxIn, seg.dyIn];
  const l = seg.lengthIn;
  switch (seg.direction) {
    case "right": return [l,  0];
    case "down":  return [0,  l];
    case "left":  return [-l, 0];
    case "up":    return [0, -l];
  }
}

/** True when a segment has a bezier curve control point. */
function segHasCurve(seg: RoomSegment): boolean {
  return seg.cpDxIn !== undefined && seg.cpDyIn !== undefined;
}

// ─── Quadratic Bézier helpers ─────────────────────────────────────────────────

/** Evaluate quadratic bezier point at t ∈ [0,1]. */
function qBez(t: number, p0: Point, p1: Point, p2: Point): Point {
  const mt = 1 - t;
  return [mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
          mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]];
}

/** Evaluate quadratic bezier tangent vector at t (NOT normalized). */
function qBezTan(t: number, p0: Point, p1: Point, p2: Point): Point {
  const mt = 1 - t;
  return [2 * mt * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]),
          2 * mt * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])];
}

const BEZIER_SAMPLES = 64;

/**
 * Build a cumulative arc-length lookup table for a quadratic bezier.
 * Returns array of {t, s} with s = cumulative arc length at t.
 */
function bezierArcTable(p0: Point, p1: Point, p2: Point): { t: number; s: number }[] {
  const table: { t: number; s: number }[] = [{ t: 0, s: 0 }];
  let prev = p0;
  for (let i = 1; i <= BEZIER_SAMPLES; i++) {
    const ti   = i / BEZIER_SAMPLES;
    const curr = qBez(ti, p0, p1, p2);
    const ds   = Math.sqrt((curr[0] - prev[0]) ** 2 + (curr[1] - prev[1]) ** 2);
    table.push({ t: ti, s: table[table.length - 1].s + ds });
    prev = curr;
  }
  return table;
}

/** Given an arc-length table and target arc length s, return the bezier parameter t. */
function arcLengthToT(table: { t: number; s: number }[], s: number): number {
  const total = table[table.length - 1].s;
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

/** 8-direction compass symbol for display. */
function dirSymbol(seg: RoomSegment): string {
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
function setSegAngle(seg: RoomSegment, angleDeg: number): RoomSegment {
  const len = Math.max(1, segLength(seg));
  const rad = angleDeg * Math.PI / 180;
  const dx  = len * Math.cos(rad);
  const dy  = len * Math.sin(rad);
  return { ...seg, dxIn: dx, dyIn: dy, lengthIn: Math.round(len) };
}

/** Set segment to a specific length, keeping direction. */
function setSegLen(seg: RoomSegment, newLen: number): RoomSegment {
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
function snapOrthogonal(seg: RoomSegment, dir: SegmentDirection): RoomSegment {
  const len = Math.max(1, Math.round(segLength(seg)));
  const map: Record<SegmentDirection, [number, number]> = {
    right: [len, 0], down: [0, len], left: [-len, 0], up: [0, -len],
  };
  const [dx, dy] = map[dir];
  return { ...seg, dxIn: dx, dyIn: dy, direction: dir, lengthIn: len };
}

// ─── Segment factory ──────────────────────────────────────────────────────────

function makeSeg(dir: SegmentDirection, length: number): RoomSegment {
  return {
    id: nextId(), label: "", lengthIn: length, direction: dir,
    usable: true,
    selectedForDesign: false,  // Has Closet defaults to OFF — geometry ≠ closet usage
    canHaveCabinetry: true,
    hasWindow: false, hasDoor: false, hasObstacle: false, notes: "",
  };
}

function makeDefault(wallWidthIn = 120, depth = 84): RoomSegment[] {
  _id = 1;
  return [
    makeSeg("right", wallWidthIn),
    makeSeg("down",  depth),
    makeSeg("left",  wallWidthIn),
    makeSeg("up",    depth),
  ];
}

// ─── Wall labels ──────────────────────────────────────────────────────────────

const WALL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function wallLetter(index: number): string { return WALL_LETTERS[index] ?? String(index + 1); }
function wallLabel(index: number): string  { return `Wall ${wallLetter(index)}`; }
function segLabel(_seg: RoomSegment, index: number): string { return wallLabel(index); }

// ─── Canvas transform ────────────────────────────────────────────────────────

interface CanvasTransform {
  scale: number; offX: number; offY: number; minX: number; minY: number;
}

const CANVAS_W   = 520;
const CANVAS_H   = 380;
const CANVAS_PAD = 54;

function computeTransform(segs: RoomSegment[], zoom = 1, origin: Point = [0, 0]): CanvasTransform {
  const pts  = computePoints(segs, origin);
  // Include bezier control points so curved walls fit in the viewport
  const allPts: Point[] = [...pts];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.cpDxIn !== undefined && s.cpDyIn !== undefined) {
      allPts.push([pts[i][0] + s.cpDxIn, pts[i][1] + s.cpDyIn]);
    }
  }
  const xs   = allPts.map(p => p[0]);
  const ys   = allPts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = Math.max(maxX - minX, 1);
  const rangeY = Math.max(maxY - minY, 1);
  const drawW  = CANVAS_W - CANVAS_PAD * 2;
  const drawH  = CANVAS_H - CANVAS_PAD * 2;
  const baseScale = Math.min(drawW / rangeX, drawH / rangeY);
  const scale     = baseScale * zoom;
  // Keep room centered regardless of zoom level
  const offX = CANVAS_W / 2 - (rangeX / 2) * scale;
  const offY = CANVAS_H / 2 - (rangeY / 2) * scale;
  return { scale, offX, offY, minX, minY };
}

// ─── Design overlay types ─────────────────────────────────────────────────────

interface TopViewPanel   { id: number; xIn: number; }
interface TopViewSection { id: number; depthIn: number; }
interface TopViewRun {
  wallId:   string;
  startIn:  number;
  endIn:    number;
  panels:   TopViewPanel[];
  sections: TopViewSection[];
}

const TV_PANEL_W = 0.75;

// ─── PerimeterCanvas ─────────────────────────────────────────────────────────
// Interactive SVG floor-plan view.
// Vertex handles (blue circles): drag to reshape room end-vertices.
// Breakpoint handles (amber diamonds): drag to move a kink point.
// Curve handles (teal circles): drag to reshape bezier arc control point.

function PerimeterCanvas({
  segments, selectedId, onSelect, designRuns, onVertexDrag, onBreakpointDrag, onCurveDrag, zoom, originPt,
}: {
  segments:         RoomSegment[];
  selectedId:       string | null;
  onSelect:         (id: string) => void;
  designRuns:       TopViewRun[];
  onVertexDrag:     (vertexIdx: number, xIn: number, yIn: number) => void;
  onBreakpointDrag: (segIdx: number, dxIn: number, dyIn: number) => void;
  onCurveDrag:      (segIdx: number, dxIn: number, dyIn: number) => void;
  zoom:             number;
  originPt:         Point;
}) {
  const svgRef     = useRef<SVGSVGElement>(null);
  const lockRef    = useRef<CanvasTransform | null>(null);
  const cbRef      = useRef(onVertexDrag);
  const bpCbRef    = useRef(onBreakpointDrag);
  const cvCbRef    = useRef(onCurveDrag);
  const lockBpRef  = useRef<{ segIdx: number; ptX: number; ptY: number } | null>(null);
  const lockCvRef  = useRef<{ segIdx: number; ptX: number; ptY: number } | null>(null);
  const [draggingVertex,     setDraggingVertex]     = useState<number | null>(null);
  const [draggingBreakpoint, setDraggingBreakpoint] = useState<number | null>(null);
  const [draggingCurve,      setDraggingCurve]      = useState<number | null>(null);

  useEffect(() => { cbRef.current   = onVertexDrag; });
  useEffect(() => { bpCbRef.current = onBreakpointDrag; });
  useEffect(() => { cvCbRef.current = onCurveDrag; });

  // Vertex drag
  useEffect(() => {
    if (draggingVertex === null) return;
    const vertexIdx = draggingVertex;
    function onMove(e: PointerEvent) {
      if (!lockRef.current || !svgRef.current) return;
      const { scale, offX, offY, minX, minY } = lockRef.current;
      const rect = svgRef.current.getBoundingClientRect();
      cbRef.current(vertexIdx, (e.clientX - rect.left - offX) / scale + minX, (e.clientY - rect.top - offY) / scale + minY);
    }
    function onUp() { setDraggingVertex(null); lockRef.current = null; }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup",   onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [draggingVertex]);

  // Breakpoint drag
  useEffect(() => {
    if (draggingBreakpoint === null) return;
    const segIdx = draggingBreakpoint;
    function onMove(e: PointerEvent) {
      if (!lockRef.current || !svgRef.current || !lockBpRef.current) return;
      const { scale, offX, offY, minX, minY } = lockRef.current;
      const rect = svgRef.current.getBoundingClientRect();
      const xIn = (e.clientX - rect.left - offX) / scale + minX;
      const yIn = (e.clientY - rect.top  - offY) / scale + minY;
      bpCbRef.current(segIdx, xIn - lockBpRef.current.ptX, yIn - lockBpRef.current.ptY);
    }
    function onUp() { setDraggingBreakpoint(null); lockBpRef.current = null; }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup",   onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [draggingBreakpoint]);

  // Curve control drag
  useEffect(() => {
    if (draggingCurve === null) return;
    const segIdx = draggingCurve;
    function onMove(e: PointerEvent) {
      if (!lockRef.current || !svgRef.current || !lockCvRef.current) return;
      const { scale, offX, offY, minX, minY } = lockRef.current;
      const rect = svgRef.current.getBoundingClientRect();
      const xIn = (e.clientX - rect.left - offX) / scale + minX;
      const yIn = (e.clientY - rect.top  - offY) / scale + minY;
      cvCbRef.current(segIdx, xIn - lockCvRef.current.ptX, yIn - lockCvRef.current.ptY);
    }
    function onUp() { setDraggingCurve(null); lockCvRef.current = null; }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup",   onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [draggingCurve]);

  if (segments.length === 0) {
    return (
      <div style={{
        height: `${CANVAS_H}px`, display: "flex", alignItems: "center",
        justifyContent: "center", color: "#bbb", fontSize: "13px",
        border: "1px dashed #ddd", borderRadius: "8px", backgroundColor: "#fafaf8",
      }}>
        Add a wall to start building the room shape.
      </div>
    );
  }

  const xform  = lockRef.current ?? computeTransform(segments, zoom, originPt);
  const { scale, offX, offY, minX, minY } = xform;
  const pts    = computePoints(segments, originPt);
  const closed = isClosed(pts);

  const tx = (x: number) => offX + (x - minX) * scale;
  const ty = (y: number) => offY + (y - minY) * scale;

  const signedArea = (() => {
    const n = pts.length - 1;
    let s = 0;
    for (let i = 0; i < n; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
    return s;
  })();
  const normalSign = signedArea >= 0 ? 1 : -1;

  /**
   * Map (alongIn, depthIn) → SVG canvas coords.
   * Handles straight, breakpoint, and bezier-curved segments.
   */
  function wallPt(segIdx: number, alongIn: number, depthIn: number): [number, number] {
    const [wx1, wy1] = pts[segIdx];
    if (segIdx + 1 >= pts.length) return [tx(wx1), ty(wy1)];
    const [wx2, wy2] = pts[segIdx + 1];
    const seg = segments[segIdx];

    // Bezier curve
    if (seg.cpDxIn !== undefined && seg.cpDyIn !== undefined) {
      const p0: Point = [wx1, wy1];
      const p1: Point = [wx1 + seg.cpDxIn, wy1 + seg.cpDyIn];
      const p2: Point = [wx2, wy2];
      const table = bezierArcTable(p0, p1, p2);
      const t     = arcLengthToT(table, alongIn);
      const [bx, by]   = qBez(t, p0, p1, p2);
      const [tdx, tdy] = qBezTan(t, p0, p1, p2);
      const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
      const nx = -tdy / tlen * normalSign, ny = tdx / tlen * normalSign;
      return [tx(bx + nx * depthIn), ty(by + ny * depthIn)];
    }

    // Breakpoint (two straight sub-legs)
    if (seg.breakDxIn !== undefined && seg.breakDyIn !== undefined) {
      const bx = wx1 + seg.breakDxIn, by = wy1 + seg.breakDyIn;
      const leg1Len = Math.sqrt(seg.breakDxIn ** 2 + seg.breakDyIn ** 2);
      const leg2dx  = wx2 - bx, leg2dy = wy2 - by;
      const leg2Len = Math.sqrt(leg2dx ** 2 + leg2dy ** 2);
      if (leg1Len > 0.01 && alongIn <= leg1Len) {
        const ux = seg.breakDxIn / leg1Len, uy = seg.breakDyIn / leg1Len;
        const nx = -uy * normalSign, ny = ux * normalSign;
        return [tx(wx1 + ux * alongIn + nx * depthIn), ty(wy1 + uy * alongIn + ny * depthIn)];
      }
      const rem = alongIn - leg1Len;
      if (leg2Len < 0.01) return [tx(bx), ty(by)];
      const ux = leg2dx / leg2Len, uy = leg2dy / leg2Len;
      const nx = -uy * normalSign, ny = ux * normalSign;
      return [tx(bx + ux * rem + nx * depthIn), ty(by + uy * rem + ny * depthIn)];
    }

    // Straight
    const wlen = Math.sqrt((wx2 - wx1) ** 2 + (wy2 - wy1) ** 2);
    if (wlen < 0.01) return [tx(wx1), ty(wy1)];
    const ux = (wx2 - wx1) / wlen, uy = (wy2 - wy1) / wlen;
    const nx = -uy * normalSign, ny = ux * normalSign;
    return [tx(wx1 + ux * alongIn + nx * depthIn), ty(wy1 + uy * alongIn + ny * depthIn)];
  }

  function ptStr(...coords: [number, number][]): string {
    return coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  }

  /** Build SVG path data for the room perimeter, respecting curves and breakpoints. */
  function buildRoomPath(): string {
    if (pts.length < 2) return "";
    let d = `M ${tx(pts[0][0]).toFixed(1)} ${ty(pts[0][1]).toFixed(1)}`;
    for (let i = 0; i < segments.length && i + 1 < pts.length; i++) {
      const seg = segments[i];
      const [ex, ey] = pts[i + 1];
      if (seg.cpDxIn !== undefined && seg.cpDyIn !== undefined) {
        const cpx = tx(pts[i][0] + seg.cpDxIn), cpy = ty(pts[i][1] + seg.cpDyIn);
        d += ` Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${tx(ex).toFixed(1)} ${ty(ey).toFixed(1)}`;
      } else if (seg.breakDxIn !== undefined && seg.breakDyIn !== undefined) {
        const bx = tx(pts[i][0] + seg.breakDxIn), by = ty(pts[i][1] + seg.breakDyIn);
        d += ` L ${bx.toFixed(1)} ${by.toFixed(1)} L ${tx(ex).toFixed(1)} ${ty(ey).toFixed(1)}`;
      } else {
        d += ` L ${tx(ex).toFixed(1)} ${ty(ey).toFixed(1)}`;
      }
    }
    if (closed) d += " Z";
    return d;
  }

  return (
    <svg ref={svgRef} width={CANVAS_W} height={CANVAS_H}
      style={{
        display: "block", backgroundColor: "#fafaf8",
        borderRadius: "8px", border: "1px solid #e8e4de",
        cursor: (draggingVertex !== null || draggingBreakpoint !== null || draggingCurve !== null) ? "grabbing" : "default",
        userSelect: "none", touchAction: "none",
      }}>

      {/* Room fill — uses path to support curves */}
      {closed && (
        <path d={buildRoomPath()} fill="rgba(22,163,74,0.04)" />
      )}

      {/* Closet footprints */}
      {designRuns.map(run => {
        const segIdx = segments.findIndex(s => s.id === run.wallId);
        if (segIdx === -1 || segIdx + 1 >= pts.length || run.sections.length === 0) return null;
        return (
          <g key={run.wallId} pointerEvents="none">
            {run.sections.map((sec, si) => {
              const leftIn  = si === 0 ? run.startIn : run.panels[si - 1].xIn + TV_PANEL_W;
              const rightIn = si === run.panels.length ? run.endIn : run.panels[si].xIn;
              if (rightIn <= leftIn) return null;
              const a = wallPt(segIdx, leftIn, 0);   const b = wallPt(segIdx, rightIn, 0);
              const c = wallPt(segIdx, rightIn, sec.depthIn); const d = wallPt(segIdx, leftIn, sec.depthIn);
              return <polygon key={sec.id} points={ptStr(a,b,c,d)} fill="rgba(195,155,100,0.28)" stroke="#c4935a" strokeWidth={0.75} />;
            })}
            {run.panels.map((panel, pi) => {
              const lD = run.sections[pi]?.depthIn ?? 12, rD = run.sections[pi+1]?.depthIn ?? 12;
              const maxD = Math.max(lD, rD);
              const a = wallPt(segIdx, panel.xIn, 0); const b = wallPt(segIdx, panel.xIn + TV_PANEL_W, 0);
              const c = wallPt(segIdx, panel.xIn + TV_PANEL_W, maxD); const d = wallPt(segIdx, panel.xIn, maxD);
              return <polygon key={panel.id} points={ptStr(a,b,c,d)} fill="#b8956a" stroke="#8b6437" strokeWidth={0.5} />;
            })}
            {(() => {
              const d0 = run.sections[0]?.depthIn ?? 12;
              const dN = run.sections[run.sections.length - 1]?.depthIn ?? 12;
              const la = wallPt(segIdx, run.startIn, 0);
              const lb = wallPt(segIdx, run.startIn + TV_PANEL_W, 0);
              const lc = wallPt(segIdx, run.startIn + TV_PANEL_W, d0);
              const ld = wallPt(segIdx, run.startIn, d0);
              const ra = wallPt(segIdx, run.endIn - TV_PANEL_W, 0);
              const rb = wallPt(segIdx, run.endIn, 0);
              const rc = wallPt(segIdx, run.endIn, dN);
              const rd = wallPt(segIdx, run.endIn - TV_PANEL_W, dN);
              return <>
                <polygon points={ptStr(la,lb,lc,ld)} fill="#b8956a" stroke="#8b6437" strokeWidth={0.75} />
                <polygon points={ptStr(ra,rb,rc,rd)} fill="#b8956a" stroke="#8b6437" strokeWidth={0.75} />
              </>;
            })()}
          </g>
        );
      })}

      {/* Open shape indicator */}
      {!closed && pts.length > 1 && (
        <line
          x1={tx(pts[pts.length - 1][0])} y1={ty(pts[pts.length - 1][1])}
          x2={tx(pts[0][0])}              y2={ty(pts[0][1])}
          stroke="#dc2626" strokeWidth={1} strokeDasharray="5,3" opacity={0.35}
        />
      )}

      {/* Wall segments — path for curves/breakpoints, line for straight */}
      {segments.map((seg, i) => {
        if (i + 1 >= pts.length) return null;
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[i + 1];
        const isSel    = seg.id === selectedId;
        const hasClos  = seg.selectedForDesign;
        const color    = isSel ? "#2563eb" : hasClos ? "#15803d" : "#94a3b8";
        const strokeW  = isSel ? 4 : hasClos ? 3.5 : 2;
        const hasBreak = segHasBreakpoint(seg);
        const hasCurve = segHasCurve(seg);
        const sx1 = tx(x1), sy1 = ty(y1), sx2 = tx(x2), sy2 = ty(y2);

        // Build wall path
        let wallPathD: string;
        if (hasCurve) {
          const cpx = tx(x1 + seg.cpDxIn!), cpy = ty(y1 + seg.cpDyIn!);
          wallPathD = `M ${sx1} ${sy1} Q ${cpx} ${cpy} ${sx2} ${sy2}`;
        } else if (hasBreak) {
          const bx = tx(x1 + seg.breakDxIn!), by = ty(y1 + seg.breakDyIn!);
          wallPathD = `M ${sx1} ${sy1} L ${bx} ${by} L ${sx2} ${sy2}`;
        } else {
          wallPathD = `M ${sx1} ${sy1} L ${sx2} ${sy2}`;
        }

        // Label at midpoint of start→end chord
        const midX = (sx1 + sx2) / 2, midY = (sy1 + sy2) / 2;
        const dxL = sx2 - sx1, dyL = sy2 - sy1;
        const slen = Math.sqrt(dxL * dxL + dyL * dyL) || 1;
        const nx = -dyL / slen, ny = dxL / slen;
        const lx = midX + nx * 16, ly = midY + ny * 16;

        return (
          <g key={seg.id} onClick={() => onSelect(seg.id)} style={{ cursor: "pointer" }}>
            {/* Wide transparent hit target */}
            <path d={wallPathD} fill="none" stroke="transparent" strokeWidth={18} />
            {/* Visible wall */}
            <path d={wallPathD} fill="none"
              stroke={color} strokeWidth={strokeW} strokeLinecap="round"
              opacity={seg.usable ? 1 : 0.5} />
            {isSel && (
              <path d={wallPathD} fill="none"
                stroke="#2563eb" strokeWidth={10} strokeLinecap="round" opacity={0.12} />
            )}
            <text x={lx} y={ly - 3} textAnchor="middle"
              fontSize={9} fill={color} fontWeight="800" pointerEvents="none">
              {segLabel(seg, i)}
            </text>
            <text x={lx} y={ly + 8} textAnchor="middle"
              fontSize={8} fill={color} opacity={0.8} pointerEvents="none">
              {Math.round(segLength(seg))}"{seg.hasWindow ? " W" : ""}{seg.hasDoor ? " D" : ""}{hasBreak ? " ⌙" : ""}{hasCurve ? " ⌒" : ""}
            </text>
          </g>
        );
      })}

      {/* Draggable vertex handles */}
      {pts.map(([x, y], i) => {
        if (closed && i === pts.length - 1) return null;
        const isDragging = i === draggingVertex;
        const fill       = isDragging ? "#2563eb" : "#4a90d9";
        const handler    = (e: React.PointerEvent) => {
          e.preventDefault(); e.stopPropagation();
          lockRef.current = computeTransform(segments, zoom, originPt);
          setDraggingVertex(i);
        };
        return (
          <g key={`v${i}`} style={{ cursor: isDragging ? "grabbing" : "grab" }}
            onPointerDown={handler}>
            {/* Invisible oversized hit target for easy touch */}
            <circle cx={tx(x)} cy={ty(y)} r={20} fill="transparent" stroke="none" />
            {/* Visible handle */}
            <circle cx={tx(x)} cy={ty(y)} r={7}
              fill={fill} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
          </g>
        );
      })}

      {/* Breakpoint handles — amber diamonds */}
      {segments.map((seg, i) => {
        if (!segHasBreakpoint(seg) || i + 1 >= pts.length) return null;
        const [wx1, wy1] = pts[i];
        const bx = tx(wx1 + seg.breakDxIn!), by = ty(wy1 + seg.breakDyIn!);
        const isDragging = i === draggingBreakpoint;
        return (
          <g key={`bp${seg.id}`}
            style={{ cursor: isDragging ? "grabbing" : "grab" }}
            onPointerDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              lockRef.current = computeTransform(segments, zoom, originPt);
              lockBpRef.current = { segIdx: i, ptX: wx1, ptY: wy1 };
              setDraggingBreakpoint(i);
            }}>
            <rect x={bx - 18} y={by - 18} width={36} height={36} fill="transparent" />
            <rect x={bx - 5} y={by - 5} width={10} height={10}
              fill={isDragging ? "#d97706" : "#f59e0b"}
              stroke="#fff" strokeWidth={1.5}
              transform={`rotate(45 ${bx} ${by})`}
            />
          </g>
        );
      })}

      {/* Curve control handles — teal circles */}
      {segments.map((seg, i) => {
        if (!segHasCurve(seg) || i + 1 >= pts.length) return null;
        const [wx1, wy1] = pts[i];
        const cpx = tx(wx1 + seg.cpDxIn!), cpy = ty(wy1 + seg.cpDyIn!);
        const isDragging = i === draggingCurve;
        // Dotted line from start to control and control to end
        const [wx2, wy2] = pts[i + 1];
        return (
          <g key={`cv${seg.id}`}>
            {/* Guide lines */}
            <line x1={tx(wx1)} y1={ty(wy1)} x2={cpx} y2={cpy}
              stroke="#0891b2" strokeWidth={1} strokeDasharray="3 2" opacity={0.5} pointerEvents="none" />
            <line x1={cpx} y1={cpy} x2={tx(wx2)} y2={ty(wy2)}
              stroke="#0891b2" strokeWidth={1} strokeDasharray="3 2" opacity={0.5} pointerEvents="none" />
            {/* Handle */}
            <circle cx={cpx} cy={cpy} r={20} fill="transparent"
              style={{ cursor: isDragging ? "grabbing" : "grab" }}
              onPointerDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                lockRef.current = computeTransform(segments, zoom, originPt);
                lockCvRef.current = { segIdx: i, ptX: wx1, ptY: wy1 };
                setDraggingCurve(i);
              }}
            />
            <circle cx={cpx} cy={cpy} r={6}
              fill={isDragging ? "#0e7490" : "#06b6d4"}
              stroke="#fff" strokeWidth={1.5}
              pointerEvents="none"
            />
          </g>
        );
      })}

      {/* Legend */}
      <g pointerEvents="none">
        <rect x={8} y={CANVAS_H - 110} width={148} height={102} rx={4}
          fill="rgba(250,250,248,0.92)" stroke="#e8e4de" strokeWidth={0.75} />
        <line x1={14} y1={CANVAS_H - 98} x2={26} y2={CANVAS_H - 98}
          stroke="#15803d" strokeWidth={3} strokeLinecap="round" />
        <text x={30} y={CANVAS_H - 94} fontSize={8} fill="#777">Has closet</text>
        <line x1={14} y1={CANVAS_H - 84} x2={26} y2={CANVAS_H - 84}
          stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" />
        <text x={30} y={CANVAS_H - 80} fontSize={8} fill="#777">No closet</text>
        <circle cx={17} cy={CANVAS_H - 68} r={5} fill="#4a90d9" stroke="#fff" strokeWidth={1.5} />
        <text x={30} y={CANVAS_H - 64} fontSize={8} fill="#777">Vertex (drag to reshape)</text>
        <rect x={12} y={CANVAS_H - 60} width={10} height={10}
          fill="#f59e0b" stroke="#fff" strokeWidth={1.5}
          transform={`rotate(45 17 ${CANVAS_H - 55})`} />
        <text x={30} y={CANVAS_H - 51} fontSize={8} fill="#777">Breakpoint (drag kink)</text>
        <circle cx={17} cy={CANVAS_H - 40} r={5} fill="#06b6d4" stroke="#fff" strokeWidth={1.5} />
        <text x={30} y={CANVAS_H - 36} fontSize={8} fill="#777">Curve control (drag arc)</text>
        <rect x={13} y={CANVAS_H - 25} width={8} height={6} rx={1}
          fill="rgba(195,155,100,0.45)" stroke="#c4935a" strokeWidth={0.75} />
        <text x={30} y={CANVAS_H - 19} fontSize={8} fill="#777">Closet footprint</text>
      </g>

      {/* Open/closed status */}
      <text x={CANVAS_W - 8} y={CANVAS_H - 8} textAnchor="end" fontSize={9} fontWeight="700"
        fill={closed ? "#15803d" : "#64748b"} pointerEvents="none">
        {closed ? "✓ Closed room" : "○ Open shape"}
      </text>
    </svg>
  );
}

// ─── SegmentRow ───────────────────────────────────────────────────────────────

function SegmentRow({
  seg, index, total, selected,
  onSelect, onMoveUp, onMoveDown, onRemove,
}: {
  seg:        RoomSegment;
  index:      number;
  total:      number;
  selected:   boolean;
  onSelect:   () => void;
  onMoveUp:   () => void;
  onMoveDown: () => void;
  onRemove:   () => void;
}) {
  const hasClos  = seg.selectedForDesign;
  const slanted  = segIsSlanted(seg);
  const len      = Math.round(segLength(seg));
  const angleDeg = Math.round(((segAngleDeg(seg) % 360) + 360) % 360);
  const color    = selected ? "#2563eb" : hasClos ? "#15803d" : "#64748b";

  return (
    <div onClick={onSelect} style={{
      display: "flex", alignItems: "center", gap: "8px",
      padding: "8px 10px", borderRadius: "7px", cursor: "pointer", userSelect: "none",
      border: `1.5px solid ${selected ? "#2563eb" : "#e5e0d8"}`,
      backgroundColor: selected ? "#eff6ff" : "#fff",
      marginBottom: "4px",
    }}>
      <span style={{
        minWidth: "22px", height: "22px", borderRadius: "50%",
        backgroundColor: selected ? "#2563eb" : "#e0dbd2",
        color: selected ? "#fff" : "#555", fontSize: "11px", fontWeight: "800",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>{wallLetter(index)}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "12px", fontWeight: "700", color: "#1a1a1a", display: "flex", alignItems: "center", gap: "5px" }}>
          {segLabel(seg, index)}
          <span style={{ fontSize: "11px", color, opacity: 0.8 }}>{dirSymbol(seg)}</span>
          {slanted && (
            <span style={{ fontSize: "9px", color: "#92400e", backgroundColor: "#fef3c7",
              padding: "1px 4px", borderRadius: "3px", fontWeight: "600" }}>
              slanted
            </span>
          )}
          {segHasBreakpoint(seg) && (
            <span style={{ fontSize: "9px", color: "#92400e", backgroundColor: "#fff7ed",
              padding: "1px 4px", borderRadius: "3px", fontWeight: "600" }}>
              split
            </span>
          )}
          {segHasCurve(seg) && (
            <span style={{ fontSize: "9px", color: "#0e7490", backgroundColor: "#ecfeff",
              padding: "1px 4px", borderRadius: "3px", fontWeight: "600" }}>
              curve
            </span>
          )}
        </div>
        <div style={{ fontSize: "11px", color: "#888", display: "flex", gap: "5px" }}>
          <span>{len}"</span>
          {slanted && <span style={{ color: "#92400e" }}>· {angleDeg}°</span>}
          {!seg.usable && <span style={{ color: "#9ca3af" }}>· unusable</span>}
        </div>
      </div>

      <span style={{
        fontSize: "10px", fontWeight: "700", padding: "2px 7px", borderRadius: "12px", flexShrink: 0,
        backgroundColor: hasClos ? "#dcfce7" : "#f1f5f9",
        color: hasClos ? "#15803d" : "#94a3b8",
        border: `1px solid ${hasClos ? "#86efac" : "#e2e8f0"}`,
      }}>
        {hasClos ? "Closet" : "No closet"}
      </span>

      <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
        <button disabled={index === 0} onClick={e => { e.stopPropagation(); onMoveUp(); }}
          style={RS.miniBtn(index === 0)} title="Move up">▲</button>
        <button disabled={index === total - 1} onClick={e => { e.stopPropagation(); onMoveDown(); }}
          style={RS.miniBtn(index === total - 1)} title="Move down">▼</button>
        <button onClick={e => { e.stopPropagation(); onRemove(); }}
          style={{ ...RS.miniBtn(false), color: "#c0392b" }} title="Remove">✕</button>
      </div>
    </div>
  );
}

const RS = {
  miniBtn: (disabled: boolean): React.CSSProperties => ({
    width: "22px", height: "22px", fontSize: "9px", fontWeight: "700",
    border: "1px solid #e0dbd2", borderRadius: "4px", cursor: disabled ? "default" : "pointer",
    backgroundColor: "#f5f2ee", color: disabled ? "#ccc" : "#555",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0,
  }),
};

// ─── SegmentEditor ────────────────────────────────────────────────────────────

function SegmentEditor({
  seg, wallIndex, onChange,
}: {
  seg:       RoomSegment;
  wallIndex: number;
  onChange:  (updated: RoomSegment) => void;
}) {
  const hasClos  = seg.selectedForDesign;
  const len      = Math.round(segLength(seg));
  const angleDeg = ((segAngleDeg(seg) % 360) + 360) % 360;
  const slanted  = segIsSlanted(seg);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: "12px", fontWeight: "700", color: "#555",
          textTransform: "uppercase", letterSpacing: "0.6px" }}>
          {wallLabel(wallIndex)}
        </div>
        <span style={{ fontSize: "10px", color: "#aaa" }}>
          {len}" · {Math.round(angleDeg)}°{slanted ? " · slanted" : ""}
        </span>
      </div>

      {/* HAS CLOSET — primary toggle */}
      <div
        onClick={() => onChange({ ...seg, selectedForDesign: !seg.selectedForDesign })}
        style={{
          display: "flex", alignItems: "center", gap: "12px",
          padding: "12px 14px", borderRadius: "8px", cursor: "pointer",
          border: `2px solid ${hasClos ? "#15803d" : "#e5e0d8"}`,
          backgroundColor: hasClos ? "#f0fdf4" : "#fafaf8",
          userSelect: "none",
        }}>
        <div style={{
          width: "22px", height: "22px", borderRadius: "5px", flexShrink: 0,
          border: `2px solid ${hasClos ? "#15803d" : "#c8c4be"}`,
          backgroundColor: hasClos ? "#15803d" : "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {hasClos && <span style={{ color: "#fff", fontSize: "13px", fontWeight: "900" }}>✓</span>}
        </div>
        <div>
          <div style={{ fontSize: "13px", fontWeight: "700",
            color: hasClos ? "#15803d" : "#555" }}>
            {hasClos ? "Has Closet" : "No Closet"}
          </div>
          <div style={{ fontSize: "11px", color: "#888", marginTop: "1px" }}>
            {hasClos
              ? "Wall is included in the Design Editor."
              : "Click to add closet design to this wall."}
          </div>
        </div>
      </div>

      {/* Label + Length */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: "10px" }}>
        <div>
          <label style={ES.lbl}>
            Custom Label <span style={{ fontWeight: "400", color: "#aaa" }}>(optional)</span>
          </label>
          <input style={ES.inp} type="text" placeholder={wallLabel(wallIndex)}
            value={seg.label} onChange={e => onChange({ ...seg, label: e.target.value })} />
        </div>
        <div>
          <label style={ES.lbl}>Length (in)</label>
          <input style={ES.inp} type="number" min={1} value={len}
            onChange={e => onChange(setSegLen(seg, Math.max(1, Number(e.target.value))))} />
        </div>
      </div>

      {/* Orientation — snap buttons + free angle */}
      <div>
        <label style={ES.lbl}>Orientation</label>
        {/* Orthogonal snap buttons */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
          {(["right", "down", "left", "up"] as SegmentDirection[]).map(dir => {
            const sym = { right: "→", down: "↓", left: "←", up: "↑" }[dir];
            const targetAngle = { right: 0, down: 90, left: 180, up: 270 }[dir];
            const isOn = !slanted && Math.abs(angleDeg - targetAngle) < 1;
            return (
              <button key={dir} onClick={() => onChange(snapOrthogonal(seg, dir))}
                title={`Snap to ${dir}`}
                style={{
                  flex: 1, padding: "7px 4px", fontSize: "15px", fontWeight: "700",
                  borderRadius: "6px", cursor: "pointer",
                  border: `1.5px solid ${isOn ? "#2563eb" : "#d1cdc7"}`,
                  backgroundColor: isOn ? "#eff6ff" : "#fff",
                  color: isOn ? "#2563eb" : "#666",
                }}>
                {sym}
              </button>
            );
          })}
        </div>
        {/* Free angle input */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ ...ES.lbl, marginBottom: 0, minWidth: "36px", flexShrink: 0 }}>Angle</span>
          <input style={{ ...ES.inp, width: "72px" }} type="number" step={1} min={0} max={359}
            value={Math.round(angleDeg)}
            onChange={e => onChange(setSegAngle(seg, Number(e.target.value)))} />
          <span style={{ fontSize: "11px", color: "#aaa" }}>° (0=right · 90=down)</span>
        </div>
      </div>

      {/* Curve — bezier arc wall */}
      <div>
        <label style={ES.lbl}>
          Curve
          <span style={{ fontWeight: "400", color: "#aaa", marginLeft: "4px" }}>(arc / curved wall)</span>
        </label>
        {segHasCurve(seg) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ fontSize: "11px", color: "#555", backgroundColor: "#ecfeff",
              border: "1px solid #a5f3fc", borderRadius: "5px", padding: "6px 8px" }}>
              Drag the teal ● handle on the canvas to shape the arc.
            </div>
            <button onClick={() => onChange({ ...seg, cpDxIn: undefined, cpDyIn: undefined })}
              style={{ ...ES.tog(false, "#0891b2"), width: "fit-content" }}>
              Remove Curve
            </button>
          </div>
        ) : (
          <button onClick={() => {
            const [dx, dy] = segDxDy(seg);
            const wallLen  = Math.sqrt(dx * dx + dy * dy);
            if (wallLen < 0.01) return;
            // Place control at midpoint + 25% of wall length perpendicular (inward)
            const bulge    = wallLen * 0.25;
            const nx = -dy / wallLen, ny = dx / wallLen;
            onChange({ ...seg, cpDxIn: dx / 2 + nx * bulge, cpDyIn: dy / 2 + ny * bulge });
          }} style={{ ...ES.tog(false, "#0891b2"), width: "fit-content" }}>
            + Add Curve (Arc)
          </button>
        )}
      </div>

      {/* Breakpoint — split wall into two sub-legs */}
      <div>
        <label style={ES.lbl}>
          Breakpoint
          <span style={{ fontWeight: "400", color: "#aaa", marginLeft: "4px" }}>(straight-then-slanted)</span>
        </label>
        {segHasBreakpoint(seg) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {(() => {
              const [tdx, tdy] = segDxDy(seg);
              const leg1Len = Math.round(Math.sqrt(seg.breakDxIn! ** 2 + seg.breakDyIn! ** 2));
              const l2dx = tdx - seg.breakDxIn!, l2dy = tdy - seg.breakDyIn!;
              const leg2Len = Math.round(Math.sqrt(l2dx ** 2 + l2dy ** 2));
              return (
                <div style={{ fontSize: "11px", color: "#666", backgroundColor: "#faf8f5",
                  border: "1px solid #e8e4de", borderRadius: "5px", padding: "6px 8px" }}>
                  Sub-leg 1: {leg1Len}" · Sub-leg 2: {leg2Len}" · Drag the amber ◆ to reposition the kink
                </div>
              );
            })()}
            <button onClick={() => onChange({ ...seg, breakDxIn: undefined, breakDyIn: undefined })}
              style={{ ...ES.tog(false, "#d97706"), width: "fit-content" }}>
              Remove Breakpoint
            </button>
          </div>
        ) : (
          <button onClick={() => {
            const [dx, dy] = segDxDy(seg);
            onChange({ ...seg, breakDxIn: dx / 2, breakDyIn: dy / 2 });
          }} style={{ ...ES.tog(false, "#d97706"), width: "fit-content" }}>
            + Add Breakpoint at Midpoint
          </button>
        )}
      </div>

      {/* Physical properties */}
      <div>
        <label style={ES.lbl}>Physical Properties</label>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={() => onChange({ ...seg, usable: !seg.usable })}
            style={ES.tog(seg.usable, "#c4935a")}>
            {seg.usable ? "✓ Usable" : "Not Usable"}
          </button>
          <button
            onClick={() => onChange({ ...seg, canHaveCabinetry: !seg.canHaveCabinetry })}
            style={ES.tog(seg.canHaveCabinetry, "#c4935a")}>
            {seg.canHaveCabinetry ? "✓ Cabinetry OK" : "No Cabinetry"}
          </button>
        </div>
      </div>

      {/* Features */}
      <div>
        <label style={ES.lbl}>Features on this wall</label>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {([
            ["hasWindow",   "Window",   "#2563eb"],
            ["hasDoor",     "Door",     "#c4935a"],
            ["hasObstacle", "Obstacle", "#b91c1c"],
          ] as [keyof RoomSegment, string, string][]).map(([field, label, color]) => (
            <button key={field}
              onClick={() => onChange({ ...seg, [field]: !seg[field] })}
              style={{
                padding: "6px 12px", fontSize: "12px", fontWeight: "600",
                borderRadius: "20px", cursor: "pointer",
                border: `1.5px solid ${seg[field] ? color : "#d1cdc7"}`,
                backgroundColor: seg[field] ? `${color}18` : "#fff",
                color: seg[field] ? color : "#888",
              }}>
              {seg[field] ? "✓ " : ""}{label}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label style={ES.lbl}>Notes</label>
        <textarea value={seg.notes} rows={2}
          onChange={e => onChange({ ...seg, notes: e.target.value })}
          placeholder="e.g. 36&quot; window centered, 6&quot; from left"
          style={{ ...ES.inp, resize: "vertical", fontFamily: "sans-serif", lineHeight: "1.5" }} />
      </div>
    </div>
  );
}

const ES = {
  lbl: { fontSize: "11px", fontWeight: "700", color: "#555", display: "block", marginBottom: "4px" } as React.CSSProperties,
  inp: {
    padding: "7px 9px", fontSize: "13px", border: "1px solid #c8c4be",
    borderRadius: "6px", width: "100%", boxSizing: "border-box" as const, color: "#111",
  } as React.CSSProperties,
  tog: (on: boolean, color: string): React.CSSProperties => ({
    padding: "6px 14px", fontSize: "12px", fontWeight: "600", borderRadius: "20px", cursor: "pointer",
    border: `1.5px solid ${on ? color : "#c8c4be"}`,
    backgroundColor: on ? `${color}18` : "#fff",
    color: on ? color : "#777",
  }),
};

// ─── DimCard ──────────────────────────────────────────────────────────────────

function DimCard({
  ceilingH, systemH, depthIn, onCeiling, onSystem, onDepth,
}: {
  ceilingH: number; systemH: number; depthIn: number;
  onCeiling: (v: number) => void; onSystem: (v: number) => void; onDepth: (v: number) => void;
}) {
  return (
    <div style={DS.card}>
      <p style={DS.cardTitle}>Global Dimensions</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
        {([
          ["Ceiling Height (in)", ceilingH, onCeiling, 48],
          ["System Height (in)",  systemH,  onSystem,  36],
          ["Closet Depth (in)",   depthIn,  onDepth,   8],
        ] as [string, number, (v: number) => void, number][]).map(([lbl, val, fn, min]) => (
          <div key={lbl}>
            <label style={ES.lbl}>{lbl}</label>
            <input style={ES.inp} type="number" min={min} value={val}
              onChange={e => fn(Math.max(min, Number(e.target.value)))} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page styles ──────────────────────────────────────────────────────────────

const DS = {
  card: {
    backgroundColor: "#fff", border: "1px solid #e5e0d8",
    borderRadius: "10px", padding: "16px 18px", marginBottom: "16px",
  } as React.CSSProperties,
  cardTitle: {
    fontSize: "11px", fontWeight: "700", color: "#555",
    textTransform: "uppercase" as const, letterSpacing: "0.6px",
    marginBottom: "12px", marginTop: 0,
  } as React.CSSProperties,
};

// ─── Zoom control styles ──────────────────────────────────────────────────────

const ZS = {
  btn: {
    width: "26px", height: "26px", fontSize: "15px", fontWeight: "700",
    border: "1px solid #d1cdc7", borderRadius: "5px", cursor: "pointer",
    backgroundColor: "#fff", color: "#444",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 0, lineHeight: 1,
  } as React.CSSProperties,
  pct: {
    fontSize: "11px", fontWeight: "700", color: "#555",
    minWidth: "38px", textAlign: "center" as const,
  } as React.CSSProperties,
  reset: {
    padding: "4px 9px", fontSize: "11px", fontWeight: "600",
    border: "1px solid #d1cdc7", borderRadius: "5px", cursor: "pointer",
    backgroundColor: "#fff", color: "#666",
  } as React.CSSProperties,
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RoomLayoutPage() {
  const router = useRouter();

  const [projectType,  setProjectType]  = useState("");
  const [clientName,   setClientName]   = useState("");
  const [clientNum,    setClientNum]    = useState("");
  const [locationName, setLocationName] = useState("");
  const [remarks,      setRemarks]      = useState("");
  const [ceilingH,     setCeilingH]     = useState(101);
  const [systemH,      setSystemH]      = useState(84);
  const [depthIn,      setDepthIn]      = useState(25);
  const [segments,     setSegments]     = useState<RoomSegment[]>([]);
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [designRuns,   setDesignRuns]   = useState<TopViewRun[]>([]);
  const [ready,        setReady]        = useState(false);
  const [roomZoom,     setRoomZoom]     = useState(1.0);
  const [originPt,     setOriginPt]     = useState<Point>([0, 0]);

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const rawSetup = localStorage.getItem("closet-setup");
    if (!rawSetup) { router.replace("/setup"); return; }

    try {
      const cfg = JSON.parse(rawSetup) as Config;
      setProjectType(cfg.projectType  ?? "");
      setClientName(cfg.clientName    ?? "");
      setClientNum(cfg.clientNum      ?? "");
      setLocationName(cfg.locationName ?? "");
      setRemarks(cfg.remarks          ?? "");
      setCeilingH(cfg.ceilingHeightIn ?? 101);
      const sh = (cfg.ceilingHeightIn ?? 101) >= 96 ? 84 : Math.max(60, (cfg.ceilingHeightIn ?? 101) - 12);
      setSystemH(sh);
      setDepthIn(cfg.closetDepthIn ?? 25);

      const rawLayout = localStorage.getItem("room-layout");
      if (rawLayout) {
        try {
          const saved = JSON.parse(rawLayout) as RoomLayout;
          if (saved.segments?.length > 0) {
            seedId(saved.segments);
            const migrated = saved.segments.map(s => ({
              ...s,
              selectedForDesign: s.selectedForDesign ?? false,
            }));
            setSegments(migrated);
            setSelectedId(migrated[0]?.id ?? null);
            if (saved.ceilingHeightIn) setCeilingH(saved.ceilingHeightIn);
            if (saved.systemHeightIn)  setSystemH(saved.systemHeightIn);
            if (saved.closetDepthIn)   setDepthIn(saved.closetDepthIn);
            if (saved.originX !== undefined && saved.originY !== undefined) {
              setOriginPt([saved.originX, saved.originY]);
            }
          } else if ((saved.walls ?? []).length > 0) {
            const migrated: RoomSegment[] = (saved.walls ?? []).map(w => ({
              id: nextId(), label: w.label || w.id,
              lengthIn: w.widthIn, direction: "right" as SegmentDirection,
              usable: w.usable, selectedForDesign: false,
              canHaveCabinetry: true,
              hasWindow: w.hasOpening, hasDoor: false, hasObstacle: false, notes: "",
            }));
            setSegments(migrated);
            setSelectedId(migrated[0]?.id ?? null);
          } else {
            const w = cfg.wallWidthIn ?? 120, d = cfg.closetDepthIn ?? 84;
            const def = makeDefault(w, d);
            setSegments(def);
            setSelectedId(def[0]?.id ?? null);
          }
        } catch {
          const w = cfg.wallWidthIn ?? 120, d = cfg.closetDepthIn ?? 84;
          const def = makeDefault(w, d);
          setSegments(def);
          setSelectedId(def[0]?.id ?? null);
        }
      } else {
        const w = cfg.wallWidthIn ?? 120, d = cfg.closetDepthIn ?? 84;
        const def = makeDefault(w, d);
        setSegments(def);
        setSelectedId(def[0]?.id ?? null);
      }

      // Load design runs for overlay
      const rawDesign = localStorage.getItem("design-state");
      if (rawDesign) {
        try {
          const saved = JSON.parse(rawDesign);
          if (saved.v === 2 && Array.isArray(saved.runs)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const runs: TopViewRun[] = saved.runs.map((r: any) => ({
              wallId:   r.wallId,
              startIn:  r.startIn  ?? 0,
              endIn:    r.endIn    ?? 0,
              panels:   (r.panels  ?? []).map((p: any) => ({ id: p.id, xIn: p.xIn })),
              sections: (r.sections ?? []).map((s: any) => ({ id: s.id, depthIn: s.depthIn ?? 12 })),
            }));
            setDesignRuns(runs);
          }
        } catch { /* design state is optional */ }
      }
    } catch { router.replace("/setup"); return; }

    setReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-save ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!ready) return;
    const layout: RoomLayout = {
      projectType, clientName, clientNum, locationName, remarks,
      ceilingHeightIn: ceilingH, systemHeightIn: systemH, closetDepthIn: depthIn,
      segments,
      originX: originPt[0], originY: originPt[1],
    };
    localStorage.setItem("room-layout", JSON.stringify(layout));
  }, [segments, originPt, ceilingH, systemH, depthIn, ready,
      projectType, clientName, clientNum, locationName, remarks]);

  // ── Mutators ──────────────────────────────────────────────────────────────

  function addSegment() {
    const last = segments[segments.length - 1];
    let dir: SegmentDirection = "right";
    if (last && last.dxIn === undefined) {
      dir = ({ right: "down", down: "left", left: "up", up: "right" } as Record<SegmentDirection, SegmentDirection>)[last.direction];
    }
    const newSeg = makeSeg(dir, 60);
    setSegments(prev => [...prev, newSeg]);
    setSelectedId(newSeg.id);
  }

  function updateSegment(updated: RoomSegment) {
    setSegments(prev => prev.map(s => s.id === updated.id ? updated : s));
  }

  function removeSegment(id: string) {
    setSegments(prev => {
      const next = prev.filter(s => s.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id ?? null);
      return next;
    });
  }

  function moveSegment(id: string, dir: -1 | 1) {
    setSegments(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0) return prev;
      const next  = [...prev];
      const other = idx + dir;
      if (other < 0 || other >= next.length) return prev;
      [next[idx], next[other]] = [next[other], next[idx]];
      return next;
    });
  }

  /** Called by PerimeterCanvas when a curve control handle is dragged. */
  function handleCurveDrag(segIdx: number, dxIn: number, dyIn: number) {
    setSegments(prev => {
      const next = [...prev];
      next[segIdx] = { ...next[segIdx], cpDxIn: dxIn, cpDyIn: dyIn };
      return next;
    });
  }

  /** Called by PerimeterCanvas when a breakpoint handle is dragged. */
  function handleBreakpointDrag(segIdx: number, dxIn: number, dyIn: number) {
    setSegments(prev => {
      const next = [...prev];
      next[segIdx] = { ...next[segIdx], breakDxIn: dxIn, breakDyIn: dyIn };
      return next;
    });
  }

  /**
   * Called by PerimeterCanvas when any vertex is dragged to (newXIn, newYIn).
   * All vertices use the same logic: update the two segments that share the vertex.
   * Vertex 0 is stored as `originPt`; its adjacent segments update the same way.
   */
  function handleVertexDrag(vertexIdx: number, newXIn: number, newYIn: number) {
    if (vertexIdx === 0) {
      // Vertex 0 position is stored in originPt. Update it and adjust the two
      // adjacent segments so all other vertices stay exactly where they are.
      const pts = computePoints(segments, originPt);
      const next = [...segments];

      // seg[0] starts at vertex 0 (originPt) and ends at pts[1].
      // Its new vector = pts[1] - (newXIn, newYIn).
      if (segments.length > 0 && pts.length > 1) {
        const [px1, py1] = pts[1];
        const dx = px1 - newXIn, dy = py1 - newYIn;
        const len = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
        next[0] = { ...next[0], dxIn: dx, dyIn: dy, lengthIn: len };
      }

      // If closed, seg[N-1] ends at vertex 0.
      // Its new vector = (newXIn, newYIn) - pts[N-1].
      if (isClosed(pts) && segments.length > 1) {
        const N = segments.length;
        const [pxN1, pyN1] = pts[N - 1];
        const dx = newXIn - pxN1, dy = newYIn - pyN1;
        const len = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
        next[N - 1] = { ...next[N - 1], dxIn: dx, dyIn: dy, lengthIn: len };
      }

      setOriginPt([newXIn, newYIn]);
      setSegments(next);
      return;
    }

    setSegments(prev => {
      const pts  = computePoints(prev, originPt);
      const next = [...prev];

      // Segment ending at this vertex: segment[vertexIdx - 1]
      if (vertexIdx >= 1 && vertexIdx - 1 < prev.length) {
        const [px, py] = pts[vertexIdx - 1];
        const dx = newXIn - px, dy = newYIn - py;
        const len = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
        next[vertexIdx - 1] = { ...next[vertexIdx - 1], dxIn: dx, dyIn: dy, lengthIn: len };
      }

      // Segment starting at this vertex: segment[vertexIdx]
      if (vertexIdx < prev.length && vertexIdx + 1 < pts.length) {
        const [nx, ny] = pts[vertexIdx + 1];
        const dx = nx - newXIn, dy = ny - newYIn;
        const len = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
        next[vertexIdx] = { ...next[vertexIdx], dxIn: dx, dyIn: dy, lengthIn: len };
      }

      return next;
    });
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const selected   = segments.find(s => s.id === selectedId) ?? null;
  const designSegs = segments.filter(s => s.selectedForDesign);
  const canContinue = designSegs.length > 0;

  function handleContinue() {
    const layout: RoomLayout = {
      projectType, clientName, clientNum, locationName, remarks,
      ceilingHeightIn: ceilingH, systemHeightIn: systemH, closetDepthIn: depthIn,
      segments,
    };
    localStorage.setItem("room-layout", JSON.stringify(layout));
    router.push("/design");
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!ready) {
    return (
      <div style={{ fontFamily: "sans-serif", display: "flex", alignItems: "center",
        justifyContent: "center", height: "100vh", backgroundColor: "#f5f2ee", color: "#888" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee" }}>

      {/* Header */}
      <header style={{
        backgroundColor: "#1a1a1a", color: "#fff", position: "sticky", top: 0, zIndex: 50,
        padding: "0 24px", height: "52px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button onClick={() => router.push("/setup")}
            style={{ fontSize: "12px", fontWeight: "600", color: "#888",
              background: "none", border: "none", cursor: "pointer" }}>
            ← Setup
          </button>
          <span style={{ color: "#333" }}>|</span>
          <span style={{ fontSize: "14px", fontWeight: "800" }}>Room Layout Builder</span>
          {projectType && (
            <span style={{ fontSize: "11px", color: "#bbb", backgroundColor: "#2a2a2a",
              padding: "2px 8px", borderRadius: "4px" }}>
              {projectType}
            </span>
          )}
          {clientName && <span style={{ fontSize: "12px", color: "#888" }}>{clientName}</span>}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {["Setup", "Room Layout", "Design", "Pricing"].map((s, i) => (
            <span key={s} style={{
              fontSize: "11px", padding: "3px 10px", borderRadius: "20px",
              backgroundColor: i === 1 ? "#fff" : "transparent",
              color: i === 1 ? "#1a1a1a" : "#888",
              fontWeight: i === 1 ? "700" : "400",
            }}>{s}</span>
          ))}
        </div>
      </header>

      {/* Body */}
      <main style={{ maxWidth: "1160px", margin: "0 auto", padding: "28px 24px 80px",
        display: "flex", gap: "20px", alignItems: "flex-start" }}>

        {/* LEFT COLUMN — wall list + dimensions + continue */}
        <div style={{ width: "340px", flexShrink: 0 }}>

          {/* Wall list */}
          <div style={DS.card}>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", marginBottom: "12px" }}>
              <p style={{ ...DS.cardTitle, marginBottom: 0 }}>
                Walls
                <span style={{ marginLeft: "6px", fontSize: "11px", fontWeight: "400", color: "#bbb" }}>
                  ({segments.length} walls · {designSegs.length} with closet)
                </span>
              </p>
              <button onClick={addSegment} style={{
                padding: "6px 14px", fontSize: "12px", fontWeight: "700",
                backgroundColor: "#1a1a1a", color: "#fff",
                border: "none", borderRadius: "6px", cursor: "pointer",
              }}>
                + Add Wall
              </button>
            </div>

            {segments.length === 0 ? (
              <div style={{ color: "#bbb", fontSize: "13px", textAlign: "center", padding: "20px 0" }}>
                No walls yet. Click &ldquo;+ Add Wall&rdquo; to start.
              </div>
            ) : (
              <div>
                {segments.map((seg, i) => (
                  <SegmentRow
                    key={seg.id} seg={seg} index={i} total={segments.length}
                    selected={seg.id === selectedId}
                    onSelect={() => setSelectedId(seg.id)}
                    onMoveUp={() => moveSegment(seg.id, -1)}
                    onMoveDown={() => moveSegment(seg.id, 1)}
                    onRemove={() => removeSegment(seg.id)}
                  />
                ))}

                {/* Design summary */}
                {designSegs.length > 0 && (
                  <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid #f0ece6" }}>
                    <div style={{ fontSize: "10px", fontWeight: "700", color: "#aaa",
                      textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                      Walls with closet
                    </div>
                    {designSegs.map(s => {
                      const gi = segments.findIndex(x => x.id === s.id);
                      return (
                        <div key={s.id} style={{ display: "flex", justifyContent: "space-between",
                          fontSize: "11px", color: "#15803d", marginBottom: "2px" }}>
                          <span style={{ fontWeight: "600" }}>
                            {segLabel(s, gi)} {dirSymbol(s)}
                          </span>
                          <span style={{ fontWeight: "700" }}>{Math.round(segLength(s))}"</span>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px",
                      fontWeight: "800", color: "#15803d", marginTop: "6px", paddingTop: "6px",
                      borderTop: "1px solid #e8e4de" }}>
                      <span>Total</span>
                      <span>{designSegs.reduce((s, x) => s + Math.round(segLength(x)), 0)}"</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Global dimensions */}
          <DimCard
            ceilingH={ceilingH} systemH={systemH} depthIn={depthIn}
            onCeiling={setCeilingH} onSystem={setSystemH} onDepth={setDepthIn}
          />

          {/* Continue */}
          <button onClick={handleContinue} disabled={!canContinue} style={{
            width: "100%", padding: "14px", fontSize: "14px", fontWeight: "800",
            backgroundColor: canContinue ? "#1a1a1a" : "#c5c0b8",
            color: "#fff", border: "none", borderRadius: "8px",
            cursor: canContinue ? "pointer" : "default", letterSpacing: "0.3px",
          }}>
            Continue to Design →
          </button>
          {!canContinue && (
            <p style={{ fontSize: "11px", color: "#b91c1c", textAlign: "center", marginTop: "8px" }}>
              {segments.length === 0
                ? "Add at least one wall first."
                : "Enable \"Has Closet\" on at least one wall."}
            </p>
          )}
        </div>

        {/* RIGHT COLUMN — canvas + editor */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Canvas */}
          <div style={{ ...DS.card, marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", marginBottom: "12px" }}>
              <p style={{ ...DS.cardTitle, marginBottom: 0 }}>Room Shape — Top View</p>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "11px", color: "#94a3b8", marginRight: "6px" }}>
                  Drag handles to reshape
                </span>
                <button
                  onClick={() => setRoomZoom(z => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
                  title="Zoom out"
                  style={ZS.btn}>−</button>
                <span style={ZS.pct}>{Math.round(roomZoom * 100)}%</span>
                <button
                  onClick={() => setRoomZoom(z => Math.min(2.5, Math.round((z + 0.1) * 10) / 10))}
                  title="Zoom in"
                  style={ZS.btn}>+</button>
                <button
                  onClick={() => setRoomZoom(1)}
                  title="Reset zoom"
                  style={ZS.reset}>Reset</button>
              </div>
            </div>
            <div style={{ overflow: "hidden", borderRadius: "8px" }}>
              <PerimeterCanvas
                segments={segments}
                selectedId={selectedId}
                onSelect={setSelectedId}
                designRuns={designRuns}
                onVertexDrag={handleVertexDrag}
                onBreakpointDrag={handleBreakpointDrag}
                onCurveDrag={handleCurveDrag}
                zoom={roomZoom}
                originPt={originPt}
              />
            </div>
            {designRuns.length > 0 && (
              <div style={{ marginTop: "6px", fontSize: "11px", color: "#8b6437",
                textAlign: "center", opacity: 0.8 }}>
                Showing saved closet layout from the Design Editor.
              </div>
            )}
          </div>

          {/* Wall editor */}
          {selected ? (
            <div style={DS.card}>
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: "14px" }}>
                <span style={{ fontSize: "14px", fontWeight: "800", color: "#1a1a1a" }}>
                  {wallLabel(segments.findIndex(s => s.id === selected.id))}
                  {selected.label.trim() && (
                    <span style={{ fontWeight: "400", color: "#888", marginLeft: "6px" }}>
                      — {selected.label}
                    </span>
                  )}
                </span>
                <button onClick={() => setSelectedId(null)}
                  style={{ fontSize: "12px", color: "#aaa", background: "none",
                    border: "none", cursor: "pointer" }}>
                  ✕ Close
                </button>
              </div>
              <SegmentEditor
                seg={selected}
                wallIndex={segments.findIndex(s => s.id === selected.id)}
                onChange={updateSegment}
              />
            </div>
          ) : segments.length > 0 ? (
            <div style={{ ...DS.card, textAlign: "center", color: "#bbb",
              fontSize: "13px", padding: "20px" }}>
              Click a wall in the list or on the canvas to edit its settings.
            </div>
          ) : null}

        </div>
      </main>
    </div>
  );
}
