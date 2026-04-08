"use client";
// app/room-layout/page.tsx — Room Layout Builder
//
// The room is defined as a polygon of vertices connected by wall segments.
// Each segment supports arbitrary angles (slanted walls) via dxIn/dyIn.
// "Has Closet" is a per-wall toggle, completely independent of room geometry.
// Vertices are draggable to reshape the room interactively.

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getActiveProjectId, saveCurrentProject } from "@/app/_lib/projects";
import type { RoomLayout, RoomSegment, SegmentDirection } from "@/app/_lib/room-types";
import type { Config } from "@/app/elevation/_lib/types";
import {
  type Point, type CanvasTransform, type SnapTarget,
  computePoints, segStart, isClosed,
  segLength, segAngleDeg, segIsSlanted, segHasBreakpoint, segHasCurve, segDxDy,
  dirSymbol, setSegAngle, setSegLen, snapOrthogonal,
  SNAP_PX, buildSnapTargets, findSnap,
  computeTransform, computeSignedArea, makeWallPtFn, buildRoomPath,
} from "@/app/_lib/room-geo";

// ─── ID counter ───────────────────────────────────────────────────────────────

let _id = 1;
function nextId(): string { return String(_id++); }
function seedId(segs: RoomSegment[]): void {
  const nums = segs.map(s => Number(s.id)).filter(n => !isNaN(n) && n > 0);
  const max  = nums.reduce((m, n) => Math.max(m, n), 0);
  if (max >= _id) _id = max + 1;
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

// ─── Closet room templates ────────────────────────────────────────────────────
// These create open or closed polygons for common closet configurations.
// "Up" = into the closet (back of closet at top of canvas).
// Origin sits at the left end of the door opening.

/** Reach-In: left return + back wall + right return (open front = door opening). */
function makeReachIn(wallWidthIn = 120, returnDepthIn = 24): RoomSegment[] {
  _id = 1;
  return [
    { ...makeSeg("up",    returnDepthIn), selectedForDesign: true, label: "Left Return" },
    { ...makeSeg("right", wallWidthIn),   selectedForDesign: true, label: "Back Wall"   },
    { ...makeSeg("down",  returnDepthIn), selectedForDesign: true, label: "Right Return"},
  ];
}

/** L-Shape: left return + back wall. Opening is along the right/front side. */
function makeLShape(wallWidthIn = 120, returnDepthIn = 24): RoomSegment[] {
  _id = 1;
  return [
    { ...makeSeg("up",    returnDepthIn), selectedForDesign: true, label: "Left Return" },
    { ...makeSeg("right", wallWidthIn),   selectedForDesign: true, label: "Back Wall"   },
  ];
}

/** L-Shape (right): back wall + right return. Opening is along the left/front side. */
function makeLShapeRight(wallWidthIn = 120, returnDepthIn = 24): RoomSegment[] {
  _id = 1;
  return [
    { ...makeSeg("right", wallWidthIn),   selectedForDesign: true, label: "Back Wall"    },
    { ...makeSeg("down",  returnDepthIn), selectedForDesign: true, label: "Right Return" },
  ];
}

/** Walk-In: 4 closed walls. Front wall (door) is not for closet design. */
function makeWalkIn(widthIn = 120, depthIn = 72): RoomSegment[] {
  _id = 1;
  return [
    { ...makeSeg("right", widthIn),  selectedForDesign: true,  label: "Back Wall"    },
    { ...makeSeg("down",  depthIn),  selectedForDesign: true,  label: "Right Side"   },
    { ...makeSeg("left",  widthIn),  selectedForDesign: false, label: "Front (Door)" },
    { ...makeSeg("up",    depthIn),  selectedForDesign: true,  label: "Left Side"    },
  ];
}

// ─── Wall labels ──────────────────────────────────────────────────────────────

const WALL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function wallLetter(index: number): string { return WALL_LETTERS[index] ?? String(index + 1); }
function wallLabel(index: number): string  { return `Wall ${wallLetter(index)}`; }
function segLabel(_seg: RoomSegment, index: number): string { return wallLabel(index); }

// ─── Canvas constants + transform wrapper ─────────────────────────────────────

const CANVAS_W   = 520;
const CANVAS_H   = 380;
const CANVAS_PAD = 54;

/** Page-local wrapper: fills in the fixed canvas dimensions for this page. */
function pageTransform(segs: RoomSegment[], zoom = 1, origin: Point = [0, 0]): CanvasTransform {
  return computeTransform(segs, zoom, origin, CANVAS_W, CANVAS_H, CANVAS_PAD);
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
  segments, selectedId, onSelect, designRuns, onVertexDrag, onBreakpointDrag, onCurveDrag, onAnchorDrag,
  zoom, originPt, showLegend, pan, onPanChange, onZoomChange,
}: {
  segments:         RoomSegment[];
  selectedId:       string | null;
  onSelect:         (id: string) => void;
  designRuns:       TopViewRun[];
  onVertexDrag:     (vertexIdx: number, xIn: number, yIn: number) => void;
  onBreakpointDrag: (segIdx: number, dxIn: number, dyIn: number) => void;
  onCurveDrag:      (segIdx: number, dxIn: number, dyIn: number) => void;
  onAnchorDrag:     (segIdx: number, xIn: number, yIn: number) => void;
  zoom:             number;
  originPt:         Point;
  showLegend:       boolean;
  pan:              [number, number];
  onPanChange:      (p: [number, number]) => void;
  onZoomChange:     (z: number) => void;
}) {
  const svgRef          = useRef<SVGSVGElement>(null);
  const lockRef         = useRef<CanvasTransform | null>(null);
  const cbRef           = useRef(onVertexDrag);
  const bpCbRef         = useRef(onBreakpointDrag);
  const cvCbRef         = useRef(onCurveDrag);
  const anchorCbRef     = useRef(onAnchorDrag);
  const lockBpRef       = useRef<{ segIdx: number; ptX: number; ptY: number } | null>(null);
  const lockCvRef       = useRef<{ segIdx: number; ptX: number; ptY: number } | null>(null);
  const snapTargetsRef  = useRef<SnapTarget[]>([]);

  // ── Pan gesture (drag background) ────────────────────────────────────────
  const panGestureRef   = useRef<{ startX: number; startY: number; px: number; py: number } | null>(null);
  // ── Pinch gesture (two-finger zoom) ──────────────────────────────────────
  const pinchGestureRef = useRef<{
    dist: number; midSvgX: number; midSvgY: number;
    startPanX: number; startPanY: number; startZoom: number;
    baseOffX: number; baseOffY: number;
  } | null>(null);
  // Keep latest pan/zoom in refs so wheel/native handlers always read current values
  const panRef  = useRef<[number, number]>(pan);
  const zoomRef = useRef(zoom);
  panRef.current  = pan;
  zoomRef.current = zoom;
  const dragExcludeRef  = useRef<string>("");
  const [draggingVertex,     setDraggingVertex]     = useState<number | null>(null);
  const [draggingBreakpoint, setDraggingBreakpoint] = useState<number | null>(null);
  const [draggingCurve,      setDraggingCurve]      = useState<number | null>(null);
  const [draggingAnchor,     setDraggingAnchor]     = useState<number | null>(null);
  const [snapTarget,         setSnapTarget]          = useState<Point | null>(null);

  useEffect(() => { cbRef.current      = onVertexDrag; });
  useEffect(() => { bpCbRef.current    = onBreakpointDrag; });
  useEffect(() => { cvCbRef.current    = onCurveDrag; });
  useEffect(() => { anchorCbRef.current = onAnchorDrag; });

  // Vertex drag
  useEffect(() => {
    if (draggingVertex === null) return;
    const vertexIdx = draggingVertex;
    function onMove(e: PointerEvent) {
      if (!lockRef.current || !svgRef.current) return;
      const { scale, offX, offY, minX, minY } = lockRef.current;
      const rect = svgRef.current.getBoundingClientRect();
      const rawX = (e.clientX - rect.left - offX) / scale + minX;
      const rawY = (e.clientY - rect.top  - offY) / scale + minY;
      const snap = findSnap(rawX, rawY, snapTargetsRef.current, dragExcludeRef.current, scale);
      setSnapTarget(snap);
      const [xIn, yIn] = snap ?? [rawX, rawY];
      cbRef.current(vertexIdx, xIn, yIn);
    }
    function onUp() { setDraggingVertex(null); lockRef.current = null; setSnapTarget(null); }
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

  // Anchor drag — moves free-standing segment as a whole unit
  useEffect(() => {
    if (draggingAnchor === null) return;
    const segIdx = draggingAnchor;
    function onMove(e: PointerEvent) {
      if (!lockRef.current || !svgRef.current) return;
      const { scale, offX, offY, minX, minY } = lockRef.current;
      const rect = svgRef.current.getBoundingClientRect();
      const rawX = (e.clientX - rect.left - offX) / scale + minX;
      const rawY = (e.clientY - rect.top  - offY) / scale + minY;
      const snap = findSnap(rawX, rawY, snapTargetsRef.current, dragExcludeRef.current, scale);
      setSnapTarget(snap);
      const [xIn, yIn] = snap ?? [rawX, rawY];
      anchorCbRef.current(segIdx, xIn, yIn);
    }
    function onUp() { setDraggingAnchor(null); lockRef.current = null; setSnapTarget(null); }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup",   onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [draggingAnchor]);

  // ── Wheel zoom (desktop) ────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const factor  = e.deltaY < 0 ? 1.12 : 0.88;
      const z0      = zoomRef.current;
      const newZoom = Math.max(0.15, Math.min(8, z0 * factor));
      // Zoom around mouse cursor position in SVG coords
      const rect    = svg!.getBoundingClientRect();
      const msvgX   = e.clientX - rect.left;
      const msvgY   = e.clientY - rect.top;
      const baseXf  = computeTransform(segments, 1, originPt, CANVAS_W, CANVAS_H, CANVAS_PAD);
      const eff0X   = (baseXf.offX - CANVAS_W / 2) * z0 + CANVAS_W / 2 + panRef.current[0];
      const eff0Y   = (baseXf.offY - CANVAS_H / 2) * z0 + CANVAS_H / 2 + panRef.current[1];
      const r       = newZoom / z0;
      const newEffX = msvgX * (1 - r) + eff0X * r;
      const newEffY = msvgY * (1 - r) + eff0Y * r;
      const newPanX = newEffX - (baseXf.offX - CANVAS_W / 2) * newZoom - CANVAS_W / 2;
      const newPanY = newEffY - (baseXf.offY - CANVAS_H / 2) * newZoom - CANVAS_H / 2;
      onZoomChange(newZoom);
      onPanChange([newPanX, newPanY]);
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, originPt, onZoomChange, onPanChange]);

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

  // ── Effective transform: base fit + zoom around canvas centre + pan ─────
  function effectiveTransform(): CanvasTransform {
    const base = computeTransform(segments, 1, originPt, CANVAS_W, CANVAS_H, CANVAS_PAD);
    return {
      scale: base.scale * zoom,
      offX:  (base.offX - CANVAS_W / 2) * zoom + CANVAS_W / 2 + pan[0],
      offY:  (base.offY - CANVAS_H / 2) * zoom + CANVAS_H / 2 + pan[1],
      minX:  base.minX,
      minY:  base.minY,
    };
  }

  const xform  = lockRef.current ?? effectiveTransform();
  const { scale, offX, offY, minX, minY } = xform;
  const pts    = computePoints(segments, originPt);
  const closed = isClosed(segments, pts);

  // Keep snap targets fresh every render
  snapTargetsRef.current = buildSnapTargets(segments, pts);

  const tx = (x: number) => offX + (x - minX) * scale;
  const ty = (y: number) => offY + (y - minY) * scale;

  const normalSign = computeSignedArea(segments, pts) >= 0 ? 1 : -1;
  const wallPt     = makeWallPtFn(segments, pts, normalSign, tx, ty);

  function ptStr(...coords: [number, number][]): string {
    return coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  }

  // ── Pinch helpers ────────────────────────────────────────────────────────
  const isPointDragging = draggingVertex !== null || draggingBreakpoint !== null || draggingCurve !== null || draggingAnchor !== null;

  function handleBgPointerDown(e: React.PointerEvent) {
    if (isPointDragging) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId);
    panGestureRef.current = { startX: e.clientX, startY: e.clientY, px: pan[0], py: pan[1] };
    pinchGestureRef.current = null;
  }

  function handleBgPointerMove(e: React.PointerEvent) {
    const pg = panGestureRef.current;
    if (!pg) return;
    const dx = e.clientX - pg.startX;
    const dy = e.clientY - pg.startY;
    onPanChange([pg.px + dx, pg.py + dy]);
  }

  function handleBgPointerUp() {
    panGestureRef.current = null;
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (isPointDragging) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      panGestureRef.current = null;
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const rect = svgRef.current!.getBoundingClientRect();
      const midSvgX = (t1.clientX + t2.clientX) / 2 - rect.left;
      const midSvgY = (t1.clientY + t2.clientY) / 2 - rect.top;
      const base = computeTransform(segments, 1, originPt, CANVAS_W, CANVAS_H, CANVAS_PAD);
      pinchGestureRef.current = {
        dist, midSvgX, midSvgY,
        startPanX: pan[0], startPanY: pan[1], startZoom: zoom,
        baseOffX: base.offX, baseOffY: base.offY,
      };
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    const pg = pinchGestureRef.current;
    if (!pg || e.touches.length !== 2) return;
    e.preventDefault();
    const t1 = e.touches[0], t2 = e.touches[1];
    const newDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const ratio   = newDist / pg.dist;
    const newZoom = Math.max(0.15, Math.min(8, pg.startZoom * ratio));
    // Keep pinch centre fixed in SVG space
    const eff0X   = (pg.baseOffX - CANVAS_W / 2) * pg.startZoom + CANVAS_W / 2 + pg.startPanX;
    const eff0Y   = (pg.baseOffY - CANVAS_H / 2) * pg.startZoom + CANVAS_H / 2 + pg.startPanY;
    const zr      = newZoom / pg.startZoom;
    const newEffX = pg.midSvgX * (1 - zr) + eff0X * zr;
    const newEffY = pg.midSvgY * (1 - zr) + eff0Y * zr;
    const newPanX = newEffX - (pg.baseOffX - CANVAS_W / 2) * newZoom - CANVAS_W / 2;
    const newPanY = newEffY - (pg.baseOffY - CANVAS_H / 2) * newZoom - CANVAS_H / 2;
    onZoomChange(newZoom);
    onPanChange([newPanX, newPanY]);
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinchGestureRef.current = null;
  }

  return (
    <svg ref={svgRef} width={CANVAS_W} height={CANVAS_H}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        display: "block", backgroundColor: "#fafaf8",
        borderRadius: "8px", border: "1px solid #e8e4de",
        cursor: isPointDragging ? "grabbing" : panGestureRef.current ? "grabbing" : "default",
        userSelect: "none", touchAction: "none",
      }}>

      {/* Background — captures pointer for pan (fires only when handles don't stop propagation) */}
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="transparent"
        style={{ cursor: isPointDragging ? "default" : "grab" }}
        onPointerDown={handleBgPointerDown}
        onPointerMove={handleBgPointerMove}
        onPointerUp={handleBgPointerUp}
        onPointerCancel={handleBgPointerUp}
      />

      {/* Room fill — uses path to support curves */}
      {closed && (
        <path d={buildRoomPath(segments, pts, closed, tx, ty)} fill="rgba(22,163,74,0.04)" />
      )}

      {/* Closet footprints */}
      {designRuns.map(run => {
        const segIdx = segments.findIndex(s => s.id === run.wallId);
        if (segIdx === -1 || segIdx + 1 >= pts.length || run.sections.length === 0) return null;
        // fd: flip depth sign if footprintFlipped is set on this wall
        const fd = (d: number) => segments[segIdx].footprintFlipped ? -d : d;
        return (
          <g key={run.wallId} pointerEvents="none">
            {run.sections.map((sec, si) => {
              const leftIn  = si === 0 ? run.startIn : run.panels[si - 1].xIn + TV_PANEL_W;
              const rightIn = si === run.panels.length ? run.endIn : run.panels[si].xIn;
              if (rightIn <= leftIn) return null;
              const a = wallPt(segIdx, leftIn, 0);             const b = wallPt(segIdx, rightIn, 0);
              const c = wallPt(segIdx, rightIn, fd(sec.depthIn)); const d = wallPt(segIdx, leftIn, fd(sec.depthIn));
              return <polygon key={sec.id} points={ptStr(a,b,c,d)} fill="rgba(195,155,100,0.28)" stroke="#c4935a" strokeWidth={0.75} />;
            })}
            {run.panels.map((panel, pi) => {
              const lD = run.sections[pi]?.depthIn ?? 12, rD = run.sections[pi+1]?.depthIn ?? 12;
              const maxD = Math.max(lD, rD);
              const a = wallPt(segIdx, panel.xIn, 0);                   const b = wallPt(segIdx, panel.xIn + TV_PANEL_W, 0);
              const c = wallPt(segIdx, panel.xIn + TV_PANEL_W, fd(maxD)); const d = wallPt(segIdx, panel.xIn, fd(maxD));
              return <polygon key={panel.id} points={ptStr(a,b,c,d)} fill="#b8956a" stroke="#8b6437" strokeWidth={0.5} />;
            })}
            {(() => {
              const d0 = run.sections[0]?.depthIn ?? 12;
              const dN = run.sections[run.sections.length - 1]?.depthIn ?? 12;
              const la = wallPt(segIdx, run.startIn, 0);
              const lb = wallPt(segIdx, run.startIn + TV_PANEL_W, 0);
              const lc = wallPt(segIdx, run.startIn + TV_PANEL_W, fd(d0));
              const ld = wallPt(segIdx, run.startIn, fd(d0));
              const ra = wallPt(segIdx, run.endIn - TV_PANEL_W, 0);
              const rb = wallPt(segIdx, run.endIn, 0);
              const rc = wallPt(segIdx, run.endIn, fd(dN));
              const rd = wallPt(segIdx, run.endIn - TV_PANEL_W, fd(dN));
              return <>
                <polygon points={ptStr(la,lb,lc,ld)} fill="#b8956a" stroke="#8b6437" strokeWidth={0.75} />
                <polygon points={ptStr(ra,rb,rc,rd)} fill="#b8956a" stroke="#8b6437" strokeWidth={0.75} />
              </>;
            })()}
            {(() => {
              const [wx1, wy1] = segStart(segments, pts, segIdx);
              const [wx2, wy2] = pts[segIdx + 1] ?? pts[segIdx];
              const wl = Math.sqrt((wx2 - wx1) ** 2 + (wy2 - wy1) ** 2);
              if (wl < 0.01) return null;
              const depthAngle = (Math.atan2((wy2 - wy1) / wl, (wx2 - wx1) / wl) * 180 / Math.PI) - 90;
              const d0 = run.sections[0]?.depthIn ?? 12;
              const dN = run.sections[run.sections.length - 1]?.depthIn ?? 12;
              type PD = { mid: number; depth: number; key: string };
              const items: PD[] = [];
              items.push({ mid: run.startIn + TV_PANEL_W / 2, depth: d0, key: 'lep' });
              run.panels.forEach((panel, pi) => {
                const lD = run.sections[pi]?.depthIn ?? 12;
                const rD = run.sections[pi + 1]?.depthIn ?? 12;
                items.push({ mid: panel.xIn + TV_PANEL_W / 2, depth: Math.max(lD, rD), key: `ip${panel.id}` });
              });
              items.push({ mid: run.endIn - TV_PANEL_W / 2, depth: dN, key: 'rep' });
              return items.map(({ mid, depth, key }) => {
                const [mx, my] = wallPt(segIdx, mid, fd(depth / 2));
                return (
                  <text key={`pdlbl-${key}`}
                    x={mx} y={my}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={10} fill="#000" fontWeight="900" pointerEvents="none"
                    stroke="#fff" strokeWidth={2.5} paintOrder="stroke"
                    transform={`rotate(${depthAngle.toFixed(1)},${mx.toFixed(1)},${my.toFixed(1)})`}>
                    {depth}"
                  </text>
                );
              });
            })()}
          </g>
        );
      })}

      {/* Wall segments — path for curves/breakpoints, line for straight */}
      {segments.map((seg, i) => {
        if (i + 1 >= pts.length) return null;
        const [x1, y1] = segStart(segments, pts, i);
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

      {/* Draggable vertex handles — uniform blue circles for all geometry points */}
      {pts.map(([x, y], i) => {
        if (closed && i === pts.length - 1) return null;
        // pts[0] = origin; skip it when the first segment is free-standing (anchored),
        // since the origin has no geometry attached to it and would appear as a stray dot.
        if (i === 0 && segments[0]?.anchorX !== undefined) return null;
        const isDragging = i === draggingVertex;
        return (
          <g key={`v${i}`} style={{ cursor: isDragging ? "grabbing" : "grab" }}
            onPointerDown={(e: React.PointerEvent) => {
              e.preventDefault(); e.stopPropagation();
              dragExcludeRef.current = `v:${i}`;
              lockRef.current = effectiveTransform();
              setDraggingVertex(i);
            }}>
            <circle cx={tx(x)} cy={ty(y)} r={20} fill="transparent" stroke="none" />
            <circle cx={tx(x)} cy={ty(y)} r={7}
              fill={isDragging ? "#2563eb" : "#4a90d9"}
              stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
          </g>
        );
      })}

      {/* Anchor handles — same blue circles, drag behavior moves whole segment */}
      {segments.map((seg, i) => {
        if (seg.anchorX === undefined || seg.anchorY === undefined) return null;
        const ax = tx(seg.anchorX), ay = ty(seg.anchorY);
        const isDragging = i === draggingAnchor;
        return (
          <g key={`anchor${seg.id}`}
            style={{ cursor: isDragging ? "grabbing" : "grab" }}
            onPointerDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              dragExcludeRef.current = `a:${seg.id}`;
              lockRef.current = effectiveTransform();
              setDraggingAnchor(i);
            }}>
            <circle cx={ax} cy={ay} r={20} fill="transparent" stroke="none" />
            <circle cx={ax} cy={ay} r={7}
              fill={isDragging ? "#2563eb" : "#4a90d9"}
              stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
          </g>
        );
      })}

      {/* Breakpoint handles — blue circles (same as vertices) */}
      {segments.map((seg, i) => {
        if (!segHasBreakpoint(seg) || i + 1 >= pts.length) return null;
        const [wx1, wy1] = segStart(segments, pts, i);
        const bx = tx(wx1 + seg.breakDxIn!), by = ty(wy1 + seg.breakDyIn!);
        const isDragging = i === draggingBreakpoint;
        return (
          <g key={`bp${seg.id}`}
            style={{ cursor: isDragging ? "grabbing" : "grab" }}
            onPointerDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              dragExcludeRef.current = "";
              lockRef.current = effectiveTransform();
              lockBpRef.current = { segIdx: i, ptX: wx1, ptY: wy1 };
              setDraggingBreakpoint(i);
            }}>
            <circle cx={bx} cy={by} r={20} fill="transparent" stroke="none" />
            <circle cx={bx} cy={by} r={7}
              fill={isDragging ? "#2563eb" : "#4a90d9"}
              stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
          </g>
        );
      })}

      {/* Curve control handles — teal circles */}
      {segments.map((seg, i) => {
        if (!segHasCurve(seg) || i + 1 >= pts.length) return null;
        const [wx1, wy1] = segStart(segments, pts, i);
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
                dragExcludeRef.current = "";
                lockRef.current = effectiveTransform();
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

      {/* Magnetic snap indicator */}
      {snapTarget && (
        <g pointerEvents="none">
          <circle cx={tx(snapTarget[0])} cy={ty(snapTarget[1])} r={16}
            fill="rgba(37,99,235,0.1)" stroke="#2563eb" strokeWidth={2} opacity={0.8} />
          <circle cx={tx(snapTarget[0])} cy={ty(snapTarget[1])} r={22}
            fill="none" stroke="#2563eb" strokeWidth={1} opacity={0.35} />
        </g>
      )}

      {/* Legend */}
      {showLegend && (
        <g pointerEvents="none">
          <rect x={8} y={CANVAS_H - 88} width={148} height={80} rx={4}
            fill="rgba(250,250,248,0.92)" stroke="#e8e4de" strokeWidth={0.75} />
          <line x1={14} y1={CANVAS_H - 64} x2={26} y2={CANVAS_H - 64}
            stroke="#15803d" strokeWidth={3} strokeLinecap="round" />
          <text x={30} y={CANVAS_H - 60} fontSize={8} fill="#777">Has closet</text>
          <line x1={14} y1={CANVAS_H - 50} x2={26} y2={CANVAS_H - 50}
            stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" />
          <text x={30} y={CANVAS_H - 46} fontSize={8} fill="#777">No closet</text>
          <circle cx={17} cy={CANVAS_H - 34} r={5} fill="#4a90d9" stroke="#fff" strokeWidth={1.5} />
          <text x={30} y={CANVAS_H - 30} fontSize={8} fill="#777">Point (drag to reshape)</text>
          <circle cx={17} cy={CANVAS_H - 20} r={5} fill="#06b6d4" stroke="#fff" strokeWidth={1.5} />
          <text x={30} y={CANVAS_H - 16} fontSize={8} fill="#777">Curve control (drag arc)</text>
          <rect x={13} y={CANVAS_H - 10} width={8} height={6} rx={1}
            fill="rgba(195,155,100,0.45)" stroke="#c4935a" strokeWidth={0.75} />
          <text x={30} y={CANVAS_H - 4} fontSize={8} fill="#777">Closet footprint</text>
        </g>
      )}

      {/* Open/closed status */}
      <text x={CANVAS_W - 8} y={CANVAS_H - 8} textAnchor="end" fontSize={9} fontWeight="700"
        fill={closed ? "#15803d" : "#2563eb"} pointerEvents="none">
        {closed ? "✓ Closed room" : "○ Open"}
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

      {/* Closet footprint direction — only relevant when Has Closet is on */}
      {hasClos && (
        <div>
          <label style={ES.lbl}>Closet Footprint Side</label>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => onChange({ ...seg, footprintFlipped: false })}
              style={{ ...ES.tog(!seg.footprintFlipped, "#15803d"), flex: 1, fontSize: "11px" }}>
              ↗ Auto (inward)
            </button>
            <button
              onClick={() => onChange({ ...seg, footprintFlipped: true })}
              style={{ ...ES.tog(!!seg.footprintFlipped, "#b91c1c"), flex: 1, fontSize: "11px" }}>
              ↙ Flip (outward)
            </button>
          </div>
          {seg.footprintFlipped && (
            <div style={{ fontSize: "10px", color: "#b91c1c", marginTop: "4px" }}>
              Footprint direction is manually flipped for this wall.
            </div>
          )}
        </div>
      )}

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
  const [viewPan,      setViewPan]      = useState<[number, number]>([0, 0]);
  const [originPt,     setOriginPt]     = useState<Point>([0, 0]);
  const [showLegend,   setShowLegend]   = useState(true);

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const rawSetup = localStorage.getItem("closet-setup");
    if (!rawSetup) { router.replace("/setup"); return; }

    try {
      const cfg = JSON.parse(rawSetup) as Config;
      setProjectType(cfg.projectType   ?? "");
      setClientName(cfg.clientName     ?? "");
      setClientNum(cfg.clientNum       ?? "");
      setLocationName(cfg.locationName ?? "");
      setRemarks(cfg.remarks           ?? "");
      // Dimensions now default here — no longer sourced from setup

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
            // Legacy v1 wall migration
            const migrated: RoomSegment[] = (saved.walls ?? []).map(w => ({
              id: nextId(), label: w.label || w.id,
              lengthIn: w.widthIn, direction: "right" as SegmentDirection,
              usable: w.usable, selectedForDesign: false,
              canHaveCabinetry: true,
              hasWindow: w.hasOpening, hasDoor: false, hasObstacle: false, notes: "",
            }));
            setSegments(migrated);
            setSelectedId(migrated[0]?.id ?? null);
          }
          // else: saved layout has no segments → start blank (fall through)
        } catch { /* corrupt saved layout → start blank */ }
      }
      // No saved layout → segments stay [] (blank room, user builds from scratch)

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
    // Place the new free-standing segment near the current room
    const pts = computePoints(segments, originPt);
    const allXs = pts.map(p => p[0]);
    const allYs = pts.map(p => p[1]);
    for (const s of segments) {
      if (s.anchorX !== undefined) allXs.push(s.anchorX);
      if (s.anchorY !== undefined) allYs.push(s.anchorY);
    }
    const anchorX = allXs.length > 0
      ? (Math.min(...allXs) + Math.max(...allXs)) / 2 - 30
      : 0;
    const anchorY = allYs.length > 0
      ? Math.min(...allYs) - 40   // 40" above the top of the room
      : -40;
    const newSeg: RoomSegment = { ...makeSeg("right", 60), anchorX, anchorY };
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

  /** Called by PerimeterCanvas when an anchor handle is dragged (moves free-standing segment). */
  function handleAnchorDrag(segIdx: number, xIn: number, yIn: number) {
    setSegments(prev => {
      const next = [...prev];
      next[segIdx] = { ...next[segIdx], anchorX: xIn, anchorY: yIn };
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
      if (isClosed(segments, pts) && segments.length > 1) {
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
        const [px, py] = segStart(prev, pts, vertexIdx - 1);
        const dx = newXIn - px, dy = newYIn - py;
        const len = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
        next[vertexIdx - 1] = { ...next[vertexIdx - 1], dxIn: dx, dyIn: dy, lengthIn: len };
      }

      // Segment starting at this vertex: segment[vertexIdx]
      // Skip if that segment is free-standing (anchor controls its start, not this vertex)
      if (vertexIdx < prev.length && vertexIdx + 1 < pts.length
          && prev[vertexIdx].anchorX === undefined) {
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
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {["Setup", "Room Layout", "Design", "Pricing"].map((s, i) => (
            <span key={s} style={{
              fontSize: "11px", padding: "3px 10px", borderRadius: "20px",
              backgroundColor: i === 1 ? "#fff" : "transparent",
              color: i === 1 ? "#1a1a1a" : "#888",
              fontWeight: i === 1 ? "700" : "400",
            }}>{s}</span>
          ))}
          <button onClick={() => { saveCurrentProject(getActiveProjectId()); }}
            style={{ fontSize: "12px", fontWeight: "700", cursor: "pointer", marginLeft: "8px",
              padding: "5px 14px", borderRadius: "6px", border: "none",
              backgroundColor: "#3a5a3a", color: "#fff" }}>
            Save
          </button>
          <button onClick={() => router.push("/")}
            style={{ fontSize: "12px", fontWeight: "600", cursor: "pointer",
              padding: "5px 14px", borderRadius: "6px",
              border: "1.5px solid #4a4a4a", backgroundColor: "transparent", color: "#aaa" }}>
            Dashboard
          </button>
        </div>
      </header>

      {/* Body */}
      <main style={{ maxWidth: "1160px", margin: "0 auto", padding: "28px 24px 80px",
        display: "flex", gap: "20px", alignItems: "flex-start" }}>

        {/* LEFT COLUMN — wall list + dimensions + continue */}
        <div style={{ width: "340px", flexShrink: 0 }}>

          {/* Quick Templates */}
          <div style={DS.card}>
            <p style={{ ...DS.cardTitle, marginBottom: "10px" }}>Room Templates</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {([
                {
                  label: "Reach-In (Back + 2 Returns)",
                  sub:   "Left return · back wall · right return · open front",
                  fn:    () => makeReachIn(120, 24),
                },
                {
                  label: "L-Shape (Back + Left Return)",
                  sub:   "Left return · back wall · open right/front",
                  fn:    () => makeLShape(120, 24),
                },
                {
                  label: "L-Shape (Back + Right Return)",
                  sub:   "Back wall · right return · open left/front",
                  fn:    () => makeLShapeRight(120, 24),
                },
                {
                  label: "Walk-In Closet (4 Walls)",
                  sub:   "Back wall · two sides · front wall (door, no closet)",
                  fn:    () => makeWalkIn(120, 72),
                },
                {
                  label: "Rectangular Room",
                  sub:   "Standard 4-wall closed room",
                  fn:    () => makeDefault(120, 84),
                },
              ] as { label: string; sub: string; fn: () => RoomSegment[] }[]).map(({ label, sub, fn }) => (
                <button key={label}
                  onClick={() => {
                    const segs = fn();
                    setSegments(segs);
                    setSelectedId(segs[0]?.id ?? null);
                    setOriginPt([0, 0]);
                  }}
                  style={{
                    padding: "9px 12px", fontSize: "12px", fontWeight: "600",
                    textAlign: "left", border: "1px solid #d8d3cb", borderRadius: "7px",
                    cursor: "pointer", backgroundColor: "#fafaf8", color: "#333",
                    width: "100%",
                  }}>
                  <div style={{ fontWeight: "700", color: "#1a1a1a" }}>{label}</div>
                  <div style={{ fontSize: "10px", color: "#888", marginTop: "2px" }}>{sub}</div>
                </button>
              ))}
            </div>
            <p style={{ fontSize: "10px", color: "#aaa", marginTop: "8px", marginBottom: 0 }}>
              Replaces current walls. Adjust lengths in the wall editor after applying.
            </p>
          </div>

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
                  onClick={() => { setRoomZoom(1); setViewPan([0, 0]); }}
                  title="Reset zoom and pan"
                  style={ZS.reset}>Reset</button>
                <button
                  onClick={() => setShowLegend(v => !v)}
                  title={showLegend ? "Hide legend" : "Show legend"}
                  style={{ ...ZS.reset, marginLeft: "4px" }}>
                  {showLegend ? "Hide legend" : "Legend"}
                </button>
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
                onAnchorDrag={handleAnchorDrag}
                zoom={roomZoom}
                originPt={originPt}
                showLegend={showLegend}
                pan={viewPan}
                onPanChange={setViewPan}
                onZoomChange={z => setRoomZoom(Math.max(0.15, Math.min(8, z)))}
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
