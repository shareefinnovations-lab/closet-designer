"use client";
// app/walkin/page.tsx
//
// Walk-In Closet Designer — three-wall editor.
//
// ARCHITECTURE (matches reach-in editor):
//   • Two-column layout inside the wall editor
//     – Left  (main):  Elevation SVG — click a section to select it
//     – Right (panel): Section editor — appears immediately when section selected
//   • Selected section highlighted in blue in the SVG
//   • Editor panel: Add Shelf / Rod / Drawer Stack, remove, position, drawer heights
//   • Drag components vertically in the SVG (same mechanism as reach-in)
//   • Section cards row (bottom) — manage widths, add/remove sections
//
// Stored in localStorage["walkin-design"].

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// ── Reuse reach-in closet primitives ─────────────────────────────────────────
import { resolvePosition, compHeight, defaultPanelHeight } from "@/app/elevation/_lib/helpers";
import {
  SCALE,                      // 6 px / in — same scale as reach-in editor
  LOCK_H_IN, LOCK_H_PX,
  PANEL_W_IN, PANEL_W_PX,
  DRAWER_MIN_H, DRAWER_MIN_DEPTH, DRAWER_MAX_HEIGHT_FROM_FLOOR,
  C_SELECT,
  C_ROD, C_GARMENT,
  C_SHELF, C_SHELF_BD,
  C_DRAWER, C_DRAWER_BD,
  C_PANEL, C_PANEL_BD,
  C_LOCK, C_LOCK_BD,
  C_DIM,
} from "@/app/elevation/_lib/constants";
import type { ClosetComponent, ComponentType } from "@/app/elevation/_lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type WallId = "A" | "B" | "C";

// SectionType is purely a starter-preset label; the real design is in `components`.
type SectionType = "DoubleHang" | "LongHang" | "Shelves" | "Drawers";

interface WalkInSection {
  id:         number;
  type:       SectionType;   // initial preset (used for starter layout)
  widthIn:    number;
  depthIn:    number;
  components: ClosetComponent[];
}

interface WalkInDesign {
  wallAWidth:    number;
  wallBWidth:    number;
  wallCWidth:    number;
  closetDepth:   number;
  ceilingHeight: number;
  systemHeight:  number;
  wallA:         WalkInSection[];
  wallB:         WalkInSection[];
  wallC:         WalkInSection[];
}

interface ClientInfo {
  clientName?:   string;
  clientNum?:    string;
  locationName?: string;
  projectType?:  string;
}

interface ValidationWarning {
  wall?:   WallId;
  message: string;
}

interface DragState {
  wallId:       WallId;
  secId:        number;
  compId:       number;
  startClientY: number;
  startPosIn:   number;
}

// ─── Section metadata ─────────────────────────────────────────────────────────

const SECTION_META: Record<SectionType, {
  label: string; fill: string; border: string; defaultWidth: number; defaultDepth: number;
}> = {
  DoubleHang: { label: "Double Hang", fill: "#eaf2ea", border: "#88b888", defaultWidth: 39, defaultDepth: 24 },
  LongHang:   { label: "Long Hang",   fill: "#eef5e8", border: "#7aaa6a", defaultWidth: 39, defaultDepth: 24 },
  Shelves:    { label: "Shelves",     fill: "#faf0dc", border: "#c4935a", defaultWidth: 30, defaultDepth: 12 },
  Drawers:    { label: "Drawers",     fill: "#e8f0f8", border: "#7a9ab8", defaultWidth: 27, defaultDepth: 16 },
};
const ALL_TYPES:   SectionType[] = ["DoubleHang", "LongHang", "Shelves", "Drawers"];
const HANGING:     SectionType[] = ["DoubleHang", "LongHang"];
const CORNER_CLEAR = 24;

// ─── ID counter ───────────────────────────────────────────────────────────────

let _id = 1;
function nextId(): number { return _id++; }

function seedIdCounter(d: WalkInDesign): void {
  const allSecs = [...d.wallA, ...d.wallB, ...d.wallC];
  let max = allSecs.reduce((m, s) => Math.max(m, s.id), 0);
  for (const s of allSecs) for (const c of (s.components ?? [])) max = Math.max(max, c.id);
  if (max >= _id) _id = max + 1;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isHanging(t?: SectionType): boolean { return t !== undefined && HANGING.includes(t); }
function wallTotal(secs: WalkInSection[]): number { return secs.reduce((s, x) => s + x.widthIn, 0); }
function defaultSystemH(h: number): number { return h >= 96 ? 84 : Math.max(60, h - 12); }

function migrate(s: WalkInSection): WalkInSection {
  return {
    ...s,
    depthIn:    s.depthIn    ?? SECTION_META[s.type]?.defaultDepth ?? 12,
    components: s.components ?? [],
  };
}

// Build preset starter components for a section type
function starterComponents(type: SectionType, sectionH: number): ClosetComponent[] {
  if (type === "DoubleHang") {
    return [
      { id: nextId(), type: "Rod", positionIn: LOCK_H_IN + 4,                  drawerHeights: [] },
      { id: nextId(), type: "Rod", positionIn: LOCK_H_IN + Math.round(sectionH * 0.50), drawerHeights: [] },
    ];
  }
  if (type === "LongHang") {
    return [
      { id: nextId(), type: "Rod", positionIn: LOCK_H_IN + 4, drawerHeights: [] },
    ];
  }
  if (type === "Shelves") {
    const count = Math.max(2, Math.round(sectionH / 16));
    return Array.from({ length: count }, (_, i) => ({
      id: nextId(), type: "Shelf" as ComponentType,
      positionIn: LOCK_H_IN + Math.round((sectionH - LOCK_H_IN * 2) / (count + 1)) * (i + 1),
      drawerHeights: [],
    }));
  }
  if (type === "Drawers") {
    const dh  = [10, 10, 8];
    const tot = dh.reduce((s, h) => s + h, 0);
    return [{
      id: nextId(), type: "DrawerStack" as ComponentType,
      positionIn: Math.max(LOCK_H_IN, sectionH - LOCK_H_IN - tot),
      drawerHeights: dh,
    }];
  }
  return [];
}

function makeSection(type: SectionType, widthIn: number, systemH: number): WalkInSection {
  return {
    id: nextId(), type, widthIn,
    depthIn:    SECTION_META[type].defaultDepth,
    components: starterComponents(type, systemH),
  };
}

function buildStarterWall(id: WallId, width: number, systemH: number): WalkInSection[] {
  if (width <= 0) return [];
  if (id === "A") {
    const dw = Math.min(27, Math.max(18, Math.floor(width * 0.38)));
    const hw = width - dw;
    if (hw <= 0) return [makeSection("Drawers", width, systemH)];
    return [makeSection("Drawers", dw, systemH), makeSection("DoubleHang", hw, systemH)];
  }
  if (id === "B") {
    if (width <= 50) return [makeSection("Shelves", width, systemH)];
    const sw  = Math.min(30, Math.max(20, Math.floor(width * 0.25)));
    const rem = width - sw;
    const lw  = Math.floor(rem / 2);
    return [makeSection("DoubleHang", lw, systemH), makeSection("Shelves", sw, systemH), makeSection("DoubleHang", rem - lw, systemH)];
  }
  const hw = Math.min(39, Math.max(18, Math.floor(width * 0.6)));
  const sw = width - hw;
  if (sw <= 0) return [makeSection("LongHang", width, systemH)];
  return [makeSection("LongHang", hw, systemH), makeSection("Shelves", sw, systemH)];
}

function makeDefault(): WalkInDesign {
  _id = 1;
  const aW = 60, bW = 120, cW = 60, sH = 84;
  return {
    wallAWidth: aW, wallBWidth: bW, wallCWidth: cW,
    closetDepth: 84, ceilingHeight: 96, systemHeight: sH,
    wallA: buildStarterWall("A", aW, sH),
    wallB: buildStarterWall("B", bW, sH),
    wallC: buildStarterWall("C", cW, sH),
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(d: WalkInDesign): ValidationWarning[] {
  const w: ValidationWarning[] = [];
  const walk = d.closetDepth - 24;
  if (walk < 24) w.push({ message: `Walkway only ${walk}" (${d.closetDepth}" − 24"). Minimum 24" needed.` });
  for (const { id, secs, width } of [
    { id: "A" as WallId, secs: d.wallA, width: d.wallAWidth },
    { id: "B" as WallId, secs: d.wallB, width: d.wallBWidth },
    { id: "C" as WallId, secs: d.wallC, width: d.wallCWidth },
  ]) {
    const tot = wallTotal(secs);
    if (secs.length > 0 && tot !== width) {
      const diff = tot - width;
      w.push({ wall: id, message: `Wall ${id}: sections total ${tot}" vs ${width}" wall (${diff > 0 ? "+" : ""}${diff}").` });
    }
  }
  const aLast = d.wallA[d.wallA.length - 1], cLast = d.wallC[d.wallC.length - 1];
  const bFirst = d.wallB[0], bLast = d.wallB[d.wallB.length - 1];
  if (isHanging(aLast?.type) && isHanging(bFirst?.type))
    w.push({ wall: "B", message: `Hang-into-hang at left corner: Wall A and Wall B both hang. Change Wall B's first section.` });
  if (isHanging(cLast?.type) && isHanging(bLast?.type))
    w.push({ wall: "B", message: `Hang-into-hang at right corner: Wall C and Wall B both hang. Change Wall B's last section.` });
  if (d.systemHeight > d.ceilingHeight)
    w.push({ message: `System height (${d.systemHeight}") exceeds ceiling (${d.ceilingHeight}").` });
  return w;
}

// ─── Floor Plan SVG ───────────────────────────────────────────────────────────

function FloorPlanSVG({ wallAWidth, wallBWidth, wallCWidth, closetDepth, activeWall, onWallClick }: {
  wallAWidth: number; wallBWidth: number; wallCWidth: number; closetDepth: number;
  activeWall: WallId; onWallClick: (w: WallId) => void;
}) {
  const SVG_W = 220, SVG_H = 130, PAD = 18, WT = 8;
  const availW = SVG_W - PAD * 2, availH = SVG_H - PAD * 2 - 16;
  const sc  = Math.min(availW / (wallBWidth + WT * 2), availH / (closetDepth + WT), 2.2);
  const roomW = (wallBWidth + WT * 2) * sc, depthPx = closetDepth * sc;
  const ox = (SVG_W - roomW) / 2, oy = PAD;
  const wc = (w: WallId) => activeWall === w ? "#1a1a1a" : "#b8956a";
  return (
    <svg width={SVG_W} height={SVG_H} style={{ display: "block", userSelect: "none" }}>
      <rect x={ox} y={oy} width={roomW} height={WT}     fill={wc("B")} style={{ cursor: "pointer" }} onClick={() => onWallClick("B")} />
      <rect x={ox} y={oy} width={WT} height={depthPx+WT} fill={wc("A")} style={{ cursor: "pointer" }} onClick={() => onWallClick("A")} />
      <rect x={ox+roomW-WT} y={oy} width={WT} height={depthPx+WT} fill={wc("C")} style={{ cursor: "pointer" }} onClick={() => onWallClick("C")} />
      <line x1={ox+WT} y1={oy+depthPx+WT} x2={ox+roomW-WT} y2={oy+depthPx+WT} stroke="#aaa" strokeWidth={1} strokeDasharray="4,3" />
      <text x={SVG_W/2} y={oy+depthPx+WT+12} textAnchor="middle" fontSize={9} fill="#aaa">Entry</text>
      <text x={ox-10} y={oy+depthPx/2+WT} textAnchor="middle" fontSize={10} fill={wc("A")} fontWeight={activeWall==="A"?"800":"600"} style={{cursor:"pointer"}} onClick={()=>onWallClick("A")}>A</text>
      <text x={SVG_W/2} y={oy-5} textAnchor="middle" fontSize={10} fill={wc("B")} fontWeight={activeWall==="B"?"800":"600"} style={{cursor:"pointer"}} onClick={()=>onWallClick("B")}>B</text>
      <text x={ox+roomW+10} y={oy+depthPx/2+WT} textAnchor="middle" fontSize={10} fill={wc("C")} fontWeight={activeWall==="C"?"800":"600"} style={{cursor:"pointer"}} onClick={()=>onWallClick("C")}>C</text>
    </svg>
  );
}

// ─── Elevation SVG (interactive, same scale as reach-in) ─────────────────────
//
// Uses SCALE = 6 px/in (reach-in constant).
// Sections are clickable. Components are draggable.
// Selected section gets blue border + tint.

interface ElevSVGProps {
  sections:         WalkInSection[];
  wallId:           WallId;
  systemH:          number;
  selectedId:       number | null;
  drag:             DragState | null;
  leftCornerHang:   boolean;
  rightCornerHang:  boolean;
  onSectionClick:   (secId: number) => void;
  onStartDrag:      (secId: number, compId: number, clientY: number, posIn: number) => void;
}

function ElevSVG({ sections, wallId, systemH, selectedId, drag, leftCornerHang, rightCornerHang, onSectionClick, onStartDrag }: ElevSVGProps) {
  const total = wallTotal(sections);
  if (total <= 0 || sections.length === 0) {
    return (
      <div style={{ padding: "40px", color: "#aaa", fontSize: "13px", textAlign: "center" }}>
        No sections — use &ldquo;+ Add Section&rdquo; on the right.
      </div>
    );
  }

  const wallWpx = total * SCALE;
  const PAD_L   = 40;
  const PAD_T   = 24;
  const PAD_B   = 40;
  const PAD_R   = 16;
  const svgW    = PAD_L + wallWpx + PAD_R;
  const sHpx    = systemH * SCALE;
  const svgH    = PAD_T + sHpx + PAD_B;
  const wy      = PAD_T;                   // section top Y in SVG
  const floorY  = wy + sHpx;              // floor Y

  // Section start X positions (inside PAD_L offset)
  const startXs: number[] = [];
  let cumX = PAD_L;
  for (const s of sections) { startXs.push(cumX); cumX += s.widthIn * SCALE; }

  return (
    <svg
      width={svgW} height={svgH}
      style={{ display: "block", overflow: "visible", cursor: drag ? "grabbing" : "default" }}
    >
      {/* Room background */}
      <rect x={PAD_L} y={wy} width={wallWpx} height={sHpx} fill="#faf6f1" stroke="#2b2b2b" strokeWidth={2} />

      {sections.map((sec, i) => {
        const sx      = startXs[i];
        const swPx    = sec.widthIn * SCALE;
        const usableX = sx + PANEL_W_PX / 2;
        const usableW = swPx - PANEL_W_PX;
        const isSel   = sec.id === selectedId;
        const innerX  = usableX + 6;
        const innerW  = usableW - 12;
        const midX    = usableX + usableW / 2;

        return (
          <g key={sec.id}>
            {/* Selected tint */}
            {isSel && (
              <rect x={usableX} y={wy} width={usableW} height={sHpx}
                fill="rgba(59,130,246,0.07)" stroke={C_SELECT} strokeWidth={2.5} />
            )}

            {/* Section click target — rendered FIRST so components sit on top of it */}
            <rect x={usableX} y={wy + LOCK_H_PX} width={usableW} height={sHpx - LOCK_H_PX * 2}
              fill="transparent" style={{ cursor: "pointer" }}
              onClick={() => onSectionClick(sec.id)} />

            {/* Top lock shelf */}
            <rect x={usableX} y={wy} width={usableW} height={LOCK_H_PX}
              fill={C_LOCK} stroke={C_LOCK_BD} strokeWidth={1} />

            {/* Bottom lock shelf */}
            <rect x={usableX} y={floorY - LOCK_H_PX} width={usableW} height={LOCK_H_PX}
              fill={C_LOCK} stroke={C_LOCK_BD} strokeWidth={1} />

            {/* ── Interior components ──────────────────────────────────────────── */}
            {sec.components.map(comp => {
              const compTopY  = wy + comp.positionIn * SCALE;
              const isDragging = drag?.secId === sec.id && drag?.compId === comp.id;

              if (comp.type === "Shelf") {
                return (
                  <g key={comp.id}>
                    {/* Visual */}
                    <rect x={innerX} y={compTopY - 3} width={innerW} height={6}
                      fill={C_SHELF} stroke={C_SHELF_BD} strokeWidth={1} rx={1}
                      opacity={isDragging ? 0.5 : 1} />
                    {/* Drag hit area */}
                    <rect x={innerX} y={compTopY - 10} width={innerW} height={20}
                      fill="transparent" style={{ cursor: "grab" }}
                      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartDrag(sec.id, comp.id, e.clientY, comp.positionIn); }} />
                  </g>
                );
              }

              if (comp.type === "Rod") {
                const cX = innerX + innerW / 2;
                const hW = Math.min(innerW * 0.5, 36);
                return (
                  <g key={comp.id}>
                    {/* Rod line */}
                    <line x1={innerX} y1={compTopY} x2={innerX+innerW} y2={compTopY}
                      stroke={C_ROD} strokeWidth={3} strokeLinecap="round"
                      opacity={isDragging ? 0.5 : 1} />
                    {/* Hanger silhouette */}
                    <circle cx={cX} cy={compTopY} r={3} fill="none" stroke={C_GARMENT} strokeWidth={1.5} />
                    <line x1={cX} y1={compTopY+3} x2={cX-hW/2} y2={compTopY+20} stroke={C_GARMENT} strokeWidth={1.5} strokeLinecap="round" />
                    <line x1={cX} y1={compTopY+3} x2={cX+hW/2} y2={compTopY+20} stroke={C_GARMENT} strokeWidth={1.5} strokeLinecap="round" />
                    <line x1={cX-hW/2} y1={compTopY+20} x2={cX+hW/2} y2={compTopY+20} stroke={C_GARMENT} strokeWidth={1.5} strokeLinecap="round" />
                    {/* Drag hit area */}
                    <rect x={innerX} y={compTopY-8} width={innerW} height={36}
                      fill="transparent" style={{ cursor: "grab" }}
                      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartDrag(sec.id, comp.id, e.clientY, comp.positionIn); }} />
                  </g>
                );
              }

              if (comp.type === "DrawerStack") {
                const totalH = comp.drawerHeights.reduce((s, h) => s + h, 0);
                let drawY    = compTopY;
                return (
                  <g key={comp.id}>
                    {comp.drawerHeights.map((dh, di) => {
                      const ty   = drawY; drawY += dh * SCALE;
                      const hW   = innerW * 0.45;
                      const hX   = innerX + (innerW - hW) / 2;
                      const hY   = ty + (dh * SCALE - 6) / 2;
                      return (
                        <g key={di}>
                          <rect x={innerX} y={ty} width={innerW} height={Math.max(3, dh*SCALE-3)}
                            fill={C_DRAWER} stroke={C_DRAWER_BD} strokeWidth={1} rx={2}
                            opacity={isDragging ? 0.5 : 1} />
                          <rect x={hX} y={hY} width={hW} height={6}
                            fill="#fff" stroke={C_DRAWER_BD} strokeWidth={1} rx={3} />
                        </g>
                      );
                    })}
                    {/* Drag hit area over entire stack */}
                    <rect x={innerX} y={compTopY} width={innerW} height={totalH*SCALE}
                      fill="transparent" style={{ cursor: "grab" }}
                      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartDrag(sec.id, comp.id, e.clientY, comp.positionIn); }} />
                  </g>
                );
              }
              return null;
            })}

            {/* Section number (top lock label) */}
            <text x={midX} y={wy + LOCK_H_PX / 2} textAnchor="middle"
              fontSize={8} fill="#fff" dominantBaseline="middle">{i + 1}</text>

            {/* Width dimension below floor */}
            <line x1={usableX} y1={floorY + 14} x2={usableX + usableW} y2={floorY + 14} stroke={C_DIM} strokeWidth={1} />
            <line x1={usableX} y1={floorY + 10} x2={usableX}           y2={floorY + 18} stroke={C_DIM} strokeWidth={1} />
            <line x1={usableX+usableW} y1={floorY+10} x2={usableX+usableW} y2={floorY+18} stroke={C_DIM} strokeWidth={1} />
            <text x={midX} y={floorY + 32} textAnchor="middle" fontSize={11} fill={C_DIM}>
              {sec.widthIn}"
            </text>
          </g>
        );
      })}

      {/* Panel boards */}
      {(() => {
        const boundaries = [PAD_L, ...startXs.slice(1), PAD_L + wallWpx];
        return boundaries.map((bx, i) => (
          <rect key={`p${i}`} x={bx - PANEL_W_PX / 2} y={wy} width={PANEL_W_PX} height={sHpx}
            fill={C_PANEL} stroke={C_PANEL_BD} strokeWidth={1.5} />
        ));
      })()}

      {/* Wall B corner dead zones */}
      {wallId === "B" && (() => {
        const cw = CORNER_CLEAR * SCALE;
        const nodes: React.ReactNode[] = [];
        if (leftCornerHang && cw < wallWpx) {
          nodes.push(
            <rect key="lz" x={PAD_L + PANEL_W_PX / 2} y={wy} width={cw} height={sHpx}
              fill="rgba(185,28,28,0.10)" stroke="rgba(185,28,28,0.35)" strokeWidth={1} strokeDasharray="5,3" />,
            <text key="lt" x={PAD_L + PANEL_W_PX / 2 + cw / 2} y={wy + sHpx / 2}
              textAnchor="middle" fontSize={9} fill="rgba(185,28,28,0.75)" fontWeight="700"
              transform={`rotate(-90,${PAD_L + PANEL_W_PX / 2 + cw / 2},${wy + sHpx / 2})`}>{CORNER_CLEAR}" CORNER</text>
          );
        }
        if (rightCornerHang && cw < wallWpx) {
          nodes.push(
            <rect key="rz" x={PAD_L + wallWpx - PANEL_W_PX / 2 - cw} y={wy} width={cw} height={sHpx}
              fill="rgba(185,28,28,0.10)" stroke="rgba(185,28,28,0.35)" strokeWidth={1} strokeDasharray="5,3" />,
            <text key="rt" x={PAD_L + wallWpx - PANEL_W_PX / 2 - cw / 2} y={wy + sHpx / 2}
              textAnchor="middle" fontSize={9} fill="rgba(185,28,28,0.75)" fontWeight="700"
              transform={`rotate(-90,${PAD_L + wallWpx - PANEL_W_PX / 2 - cw / 2},${wy + sHpx / 2})`}>{CORNER_CLEAR}" CORNER</text>
          );
        }
        return nodes;
      })()}

      {/* Height dimension on left */}
      <line x1={PAD_L - 24} y1={wy} x2={PAD_L - 24} y2={floorY} stroke="#2563eb" strokeWidth={1} />
      <line x1={PAD_L - 28} y1={wy} x2={PAD_L - 20} y2={wy} stroke="#2563eb" strokeWidth={1} />
      <line x1={PAD_L - 28} y1={floorY} x2={PAD_L - 20} y2={floorY} stroke="#2563eb" strokeWidth={1} />
      <text x={PAD_L - 34} y={wy + sHpx / 2} textAnchor="middle" fontSize={10} fill="#2563eb"
        transform={`rotate(-90,${PAD_L - 34},${wy + sHpx / 2})`}>{systemH}"</text>
    </svg>
  );
}

// ─── Section Inspector (right panel) ─────────────────────────────────────────
//
// Mirrors reach-in SectionEditor component.
// Shown in the right panel when a section is selected.

interface SectionInspectorProps {
  section:       WalkInSection;
  systemH:       number;
  overallDepth:  number;
  onClose:       () => void;
  onWidthChange: (w: number) => void;
  onDepthChange: (d: number) => void;
  onAddComp:     (type: ComponentType) => void;
  onRemoveComp:  (compId: number) => void;
  onMoveComp:    (compId: number, rawPos: number) => void;
  onAddDrawer:   (compId: number) => void;
  onRemoveDrawer:(compId: number) => void;
  onDrawerH:     (compId: number, idx: number, val: number) => void;
}

function SectionInspector({
  section, systemH, overallDepth, onClose,
  onWidthChange, onDepthChange,
  onAddComp, onRemoveComp, onMoveComp,
  onAddDrawer, onRemoveDrawer, onDrawerH,
}: SectionInspectorProps) {
  const hasDrawers = section.components.some(c => c.type === "DrawerStack");
  const minD       = hasDrawers ? DRAWER_MIN_DEPTH : 12;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "14px", fontWeight: "800", color: "#1a1a1a" }}>
          Section {section.widthIn}" — Interior Editor
        </span>
        <button onClick={onClose}
          style={{ fontSize: "12px", color: "#888", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}>
          ✕ Deselect
        </button>
      </div>

      {/* Width + Depth */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <div>
          <label style={LS.fieldLabel}>Width (in)</label>
          <input type="number" min={6} value={section.widthIn}
            onChange={e => onWidthChange(Number(e.target.value))}
            style={LS.input} />
        </div>
        <div>
          <label style={LS.fieldLabel}>Depth (in)</label>
          <input type="number" min={minD} max={overallDepth} value={section.depthIn}
            onChange={e => onDepthChange(Number(e.target.value))}
            style={LS.input} />
        </div>
      </div>

      {/* Lock shelf note */}
      <div style={{ fontSize: "11px", color: "#5a7a5a", backgroundColor: "#f0f7f0", border: "1px solid #c8e0c8", borderRadius: "5px", padding: "7px 10px" }}>
        <strong>Top Lock</strong> and <strong>Bottom Lock</strong> shelves are structural.
        Drag components in the elevation to move them.
      </div>

      {/* Add component buttons */}
      <div>
        <div style={{ fontSize: "11px", fontWeight: "700", color: "#555", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Add Component</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {([
            ["Shelf",       "Shelf"],
            ["Rod",         "Hanging Rod"],
            ["DrawerStack", "Drawer Stack"],
          ] as [ComponentType, string][]).map(([type, label]) => (
            <button key={type} onClick={() => onAddComp(type)}
              style={{ padding: "8px 12px", fontSize: "12px", fontWeight: "600", backgroundColor: "#fff", color: C_SELECT, border: `1.5px solid ${C_SELECT}`, borderRadius: "5px", cursor: "pointer" }}>
              + {label}
            </button>
          ))}
        </div>
      </div>

      {/* Component list */}
      {section.components.length === 0 ? (
        <div style={{ fontSize: "13px", color: "#aaa", textAlign: "center", padding: "16px 0", backgroundColor: "#f9f9f9", borderRadius: "6px", border: "1px dashed #ddd" }}>
          No components — add a shelf, rod, or drawers above.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {section.components.map(comp => (
            <CompCard
              key={comp.id}
              comp={comp}
              sectionH={systemH}
              onRemove={() => onRemoveComp(comp.id)}
              onMove={raw => onMoveComp(comp.id, raw)}
              onAddDrawer={() => onAddDrawer(comp.id)}
              onRemoveDrawer={() => onRemoveDrawer(comp.id)}
              onDrawerH={(idx, val) => onDrawerH(comp.id, idx, val)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Component Card ───────────────────────────────────────────────────────────

function CompCard({ comp, sectionH, onRemove, onMove, onAddDrawer, onRemoveDrawer, onDrawerH }: {
  comp:          ClosetComponent;
  sectionH:      number;
  onRemove:      () => void;
  onMove:        (raw: number) => void;
  onAddDrawer:   () => void;
  onRemoveDrawer:() => void;
  onDrawerH:     (idx: number, val: number) => void;
}) {
  const maxPos = sectionH - LOCK_H_IN - compHeight(comp);
  const minPos = comp.type === "DrawerStack"
    ? Math.max(LOCK_H_IN, sectionH - DRAWER_MAX_HEIGHT_FROM_FLOOR)
    : LOCK_H_IN;
  const label  = comp.type === "DrawerStack" ? "Drawer Stack" : comp.type === "Rod" ? "Hanging Rod" : "Shelf";

  return (
    <div style={{ backgroundColor: "#fff", border: `1.5px solid ${C_SELECT}22`, borderRadius: "6px", padding: "10px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <strong style={{ fontSize: "13px", color: "#333" }}>{label}</strong>
        <button onClick={onRemove}
          style={{ fontSize: "11px", color: "#c0392b", background: "none", border: "none", cursor: "pointer" }}>
          Remove
        </button>
      </div>

      {/* Position */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <span style={{ fontSize: "11px", color: "#444" }}>Position from top:</span>
        <input type="number" min={minPos} max={maxPos} value={comp.positionIn}
          onChange={e => onMove(Number(e.target.value))}
          style={{ width: "64px", padding: "3px 6px", fontSize: "12px", border: "1px solid #ccc", borderRadius: "4px", color: "#111" }} />
        <span style={{ fontSize: "11px", color: "#888" }}>in &nbsp;(drag in elevation)</span>
      </div>

      {/* Up / Down nudge buttons */}
      <div style={{ display: "flex", gap: "4px", marginBottom: comp.type === "DrawerStack" ? "10px" : "0" }}>
        <button onClick={() => onMove(Math.max(minPos, comp.positionIn - 1))}
          style={LS.nudgeBtn}>▲ Up 1"</button>
        <button onClick={() => onMove(Math.min(maxPos, comp.positionIn + 1))}
          style={LS.nudgeBtn}>▼ Down 1"</button>
        <button onClick={() => onMove(Math.max(minPos, comp.positionIn - 5))}
          style={LS.nudgeBtn}>▲▲ Up 5"</button>
        <button onClick={() => onMove(Math.min(maxPos, comp.positionIn + 5))}
          style={LS.nudgeBtn}>▼▼ Down 5"</button>
      </div>

      {/* DrawerStack editor */}
      {comp.type === "DrawerStack" && (() => {
        const total     = comp.drawerHeights.reduce((s, h) => s + h, 0);
        const fromFloor = sectionH - comp.positionIn;
        const over      = fromFloor > DRAWER_MAX_HEIGHT_FROM_FLOOR;
        return (
          <div style={{ borderTop: "1px solid #eee", paddingTop: "10px" }}>
            <div style={{ fontSize: "11px", color: over ? "#b91c1c" : "#666", backgroundColor: over ? "#fff0f0" : "#fef9ef", borderRadius: "4px", padding: "5px 8px", marginBottom: "8px" }}>
              {fromFloor}&Prime; from floor — max {DRAWER_MAX_HEIGHT_FROM_FLOOR}"{over ? " ⚠ will clamp" : " ✓"}
            </div>
            <div style={{ fontSize: "11px", fontWeight: "600", color: "#222", marginBottom: "6px" }}>
              Drawer heights ({total}&Prime; total)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>
              {comp.drawerHeights.map((dh, di) => (
                <label key={di} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
                  <span style={{ minWidth: "56px", color: "#555" }}>Drawer {di + 1}</span>
                  <input type="number" min={DRAWER_MIN_H} value={dh}
                    onChange={e => onDrawerH(di, Number(e.target.value))}
                    style={{ width: "58px", padding: "3px 5px", fontSize: "12px", border: "1px solid #ccc", borderRadius: "4px", color: "#111" }} />
                  <span style={{ color: "#888" }}>in</span>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button onClick={onAddDrawer}
                style={{ padding: "4px 10px", fontSize: "11px", fontWeight: "600", color: C_SELECT, border: `1px solid ${C_SELECT}`, borderRadius: "4px", background: "#fff", cursor: "pointer" }}>
                + Add Drawer
              </button>
              {comp.drawerHeights.length > 1 && (
                <button onClick={onRemoveDrawer}
                  style={{ padding: "4px 10px", fontSize: "11px", fontWeight: "600", color: "#c0392b", border: "1px solid #c0392b", borderRadius: "4px", background: "#fff", cursor: "pointer" }}>
                  Remove Last
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── DimField ─────────────────────────────────────────────────────────────────

function DimField({ label, value, min = 6, onChange }: { label: string; value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      <label style={{ fontSize: "11px", fontWeight: "700", color: "#666" }}>{label}</label>
      <input type="number" min={min} value={value}
        onChange={e => onChange(Math.max(min, Number(e.target.value) || min))}
        style={{ padding: "7px 9px", fontSize: "13px", border: "1px solid #d0cac2", borderRadius: "6px", color: "#1a1a1a", width: "100%", boxSizing: "border-box" }} />
    </div>
  );
}

function StatBadge({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={{ fontSize: "10px", fontWeight: "700", color: "#aaa", textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</span>
      <span style={{ fontSize: "13px", fontWeight: "700", color: ok ? "#1a7a4f" : "#b91c1c" }}>{value}</span>
    </div>
  );
}

// ─── Local styles ─────────────────────────────────────────────────────────────

const LS = {
  fieldLabel: { fontSize: "11px", fontWeight: "700", color: "#555", display: "block", marginBottom: "3px" } as React.CSSProperties,
  input: {
    padding: "6px 8px", fontSize: "13px", border: "1px solid #c8c4be",
    borderRadius: "5px", width: "100%", boxSizing: "border-box" as const, color: "#111",
  } as React.CSSProperties,
  nudgeBtn: {
    padding: "3px 8px", fontSize: "10px", fontWeight: "600",
    backgroundColor: "#f0f0f0", border: "1px solid #ddd",
    borderRadius: "4px", cursor: "pointer", color: "#333",
  } as React.CSSProperties,
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WalkInPage() {
  const router = useRouter();

  const [design,      setDesign]      = useState<WalkInDesign>(makeDefault());
  const [activeWall,  setActiveWall]  = useState<WallId>("B");
  const [selectedId,  setSelectedId]  = useState<number | null>(null);
  const [client,      setClient]      = useState<ClientInfo>({});
  const [ready,       setReady]       = useState(false);
  const [drag,        setDrag]        = useState<DragState | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const rawSetup  = localStorage.getItem("closet-setup");
    const rawWalkin = localStorage.getItem("walkin-design");

    if (rawSetup) {
      try {
        const s = JSON.parse(rawSetup);
        setClient({ clientName: s.clientName, clientNum: s.clientNum, locationName: s.locationName, projectType: s.projectType });
      } catch { /* ignore */ }
    }

    if (rawWalkin) {
      try {
        const saved = JSON.parse(rawWalkin) as WalkInDesign;
        saved.wallA = (saved.wallA ?? []).map(migrate);
        saved.wallB = (saved.wallB ?? []).map(migrate);
        saved.wallC = (saved.wallC ?? []).map(migrate);
        seedIdCounter(saved);
        setDesign(saved);
        setReady(true);
        return;
      } catch { /* fall through */ }
    }

    if (rawSetup) {
      try {
        const s = JSON.parse(rawSetup);
        const ch = s.ceilingHeightIn ?? 96;
        const dp = s.closetDepthIn   ?? 84;
        const sh = defaultSystemH(ch);
        setDesign(prev => ({ ...prev, ceilingHeight: ch, systemHeight: sh, closetDepth: dp }));
      } catch { /* ignore */ }
    }
    setReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem("walkin-design", JSON.stringify(design));
  }, [design, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!drag) return;
    const { wallId, secId, compId, startClientY, startPosIn } = drag;
    function onMove(e: MouseEvent) {
      updateComp(wallId, secId, compId, startPosIn + (e.clientY - startClientY) / SCALE);
    }
    function onUp() { setDrag(null); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drag]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ───────────────────────────────────────────────────────────────

  const wallMap = {
    A: { secs: design.wallA, width: design.wallAWidth },
    B: { secs: design.wallB, width: design.wallBWidth },
    C: { secs: design.wallC, width: design.wallCWidth },
  } as const;

  const active       = wallMap[activeWall];
  const activeSecs   = active.secs as WalkInSection[];
  const activeTotal  = wallTotal(activeSecs);
  const activeDiff   = activeTotal - active.width;
  const selectedSec  = selectedId !== null ? activeSecs.find(s => s.id === selectedId) ?? null : null;

  const aLastHangs = isHanging(design.wallA[design.wallA.length - 1]?.type);
  const cLastHangs = isHanging(design.wallC[design.wallC.length - 1]?.type);

  const warnings     = validate(design);
  const wallWarn: Record<WallId, number> = {
    A: warnings.filter(w => w.wall === "A").length,
    B: warnings.filter(w => w.wall === "B").length,
    C: warnings.filter(w => w.wall === "C").length,
  };

  // ── Mutators ──────────────────────────────────────────────────────────────

  function setWallSecs(wallId: WallId, secs: WalkInSection[]) {
    setDesign(prev => ({
      ...prev,
      wallA: wallId === "A" ? secs : prev.wallA,
      wallB: wallId === "B" ? secs : prev.wallB,
      wallC: wallId === "C" ? secs : prev.wallC,
    }));
  }

  function mutateSec(secId: number, fn: (s: WalkInSection) => WalkInSection) {
    setWallSecs(activeWall, activeSecs.map(s => s.id === secId ? fn(s) : s));
  }

  function updateComp(wallId: WallId, secId: number, compId: number, rawPos: number) {
    const wSecs = (wallMap[wallId].secs as WalkInSection[]).map(s => {
      if (s.id !== secId) return s;
      const comp = s.components.find(c => c.id === compId);
      if (!comp) return s;
      const newPos = resolvePosition(comp, design.systemHeight, rawPos, s.components);
      return { ...s, components: s.components.map(c => c.id === compId ? { ...c, positionIn: newPos } : c) };
    });
    setWallSecs(wallId, wSecs);
  }

  // Section-level
  function handleAddSection() {
    const type: SectionType = activeWall === "A" ? "DoubleHang" : activeWall === "B" ? "Shelves" : "LongHang";
    setWallSecs(activeWall, [...activeSecs, makeSection(type, SECTION_META[type].defaultWidth, design.systemHeight)]);
  }

  function handleRemoveSection(id: number) {
    setWallSecs(activeWall, activeSecs.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function handleWidthChange(secId: number, w: number) {
    mutateSec(secId, s => ({ ...s, widthIn: Math.max(6, w) }));
  }

  function handleDepthChange(secId: number, d: number) {
    const minD = (selectedSec?.components ?? []).some(c => c.type === "DrawerStack") ? DRAWER_MIN_DEPTH : 12;
    mutateSec(secId, s => ({ ...s, depthIn: Math.max(minD, Math.min(design.closetDepth, d)) }));
  }

  function handleRebuild() {
    setWallSecs(activeWall, buildStarterWall(activeWall, active.width, design.systemHeight));
    setSelectedId(null);
  }

  function handleDim(key: keyof WalkInDesign, val: number) {
    setDesign(prev => ({ ...prev, [key]: val }));
  }

  // Component-level
  function handleAddComp(type: ComponentType) {
    if (!selectedId) return;
    const sh = design.systemHeight;
    let comp: ClosetComponent;
    if (type === "DrawerStack") {
      const dh = [10, 10];
      comp = { id: nextId(), type, positionIn: Math.max(LOCK_H_IN, sh - LOCK_H_IN - dh.reduce((s,h)=>s+h,0)), drawerHeights: dh };
    } else if (type === "Rod") {
      comp = { id: nextId(), type, positionIn: LOCK_H_IN + 8, drawerHeights: [] };
    } else {
      comp = { id: nextId(), type, positionIn: Math.round(sh / 2), drawerHeights: [] };
    }
    mutateSec(selectedId, s => ({
      ...s,
      components: [...s.components, comp],
      depthIn: type === "DrawerStack" ? Math.max(s.depthIn, DRAWER_MIN_DEPTH) : s.depthIn,
    }));
  }

  function handleRemoveComp(compId: number) {
    if (!selectedId) return;
    mutateSec(selectedId, s => ({ ...s, components: s.components.filter(c => c.id !== compId) }));
  }

  function handleMoveComp(compId: number, rawPos: number) {
    if (!selectedId) return;
    updateComp(activeWall, selectedId, compId, rawPos);
  }

  function handleAddDrawer(compId: number) {
    if (!selectedId) return;
    mutateSec(selectedId, s => ({
      ...s, components: s.components.map(c =>
        c.id === compId && c.type === "DrawerStack" ? { ...c, drawerHeights: [...c.drawerHeights, 10] } : c
      ),
    }));
  }

  function handleRemoveDrawer(compId: number) {
    if (!selectedId) return;
    mutateSec(selectedId, s => ({
      ...s, components: s.components.map(c =>
        c.id === compId && c.type === "DrawerStack" && c.drawerHeights.length > 1
          ? { ...c, drawerHeights: c.drawerHeights.slice(0, -1) } : c
      ),
    }));
  }

  function handleDrawerH(compId: number, idx: number, val: number) {
    if (!selectedId) return;
    mutateSec(selectedId, s => ({
      ...s, components: s.components.map(c =>
        c.id === compId && c.type === "DrawerStack"
          ? { ...c, drawerHeights: c.drawerHeights.map((h, i) => i === idx ? Math.max(DRAWER_MIN_H, Math.round(val)) : h) } : c
      ),
    }));
  }

  function handleWallChange(wallId: WallId) {
    setActiveWall(wallId);
    setSelectedId(null);
  }

  function handleSectionClick(secId: number) {
    setSelectedId(prev => prev === secId ? null : secId);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>

      {/* Header */}
      <header style={S.header}>
        <div style={S.headerInner}>
          <div style={S.brandRow}>
            <button onClick={() => router.push("/")} style={S.backBtn}>← Dashboard</button>
            <span style={S.sep}>|</span>
            <span style={S.title}>Walk-In Closet Designer</span>
            {client.clientNum  && <span style={S.tag}>#{client.clientNum}</span>}
            {client.clientName && <span style={S.cname}>{client.clientName}</span>}
            {client.locationName && <span style={S.cloc}>· {client.locationName}</span>}
          </div>
          <button onClick={() => router.push("/setup")} style={S.btnSec}>← Setup</button>
        </div>
      </header>

      <main style={S.main}>

        {/* Top row: Floor Plan + Dimensions */}
        <div style={S.topRow}>
          <div style={S.card}>
            <div style={S.cardLabel}>Floor Plan</div>
            <FloorPlanSVG
              wallAWidth={design.wallAWidth} wallBWidth={design.wallBWidth} wallCWidth={design.wallCWidth}
              closetDepth={design.closetDepth} activeWall={activeWall} onWallClick={handleWallChange}
            />
          </div>
          <div style={S.dimCard}>
            <div style={S.cardLabel}>Dimensions</div>
            <div style={S.dimGrid}>
              <DimField label="Wall A Width" value={design.wallAWidth}    onChange={v => handleDim("wallAWidth",    v)} />
              <DimField label="Wall B Width" value={design.wallBWidth}    onChange={v => handleDim("wallBWidth",    v)} />
              <DimField label="Wall C Width" value={design.wallCWidth}    onChange={v => handleDim("wallCWidth",    v)} />
              <DimField label="Closet Depth" value={design.closetDepth}   onChange={v => handleDim("closetDepth",   v)} />
              <DimField label="Ceiling Ht."  value={design.ceilingHeight} onChange={v => handleDim("ceilingHeight", v)} />
              <DimField label="System Ht."   value={design.systemHeight}  onChange={v => handleDim("systemHeight",  v)} />
            </div>
            <div style={S.statsRow}>
              <StatBadge label="Walkway"       value={`${design.closetDepth - 24}"`} ok={(design.closetDepth - 24) >= 24} />
              <StatBadge label="Total Width"   value={`${design.wallAWidth + design.wallBWidth + design.wallCWidth}"`} ok />
              <StatBadge label="System / Ceil" value={`${design.systemHeight}" / ${design.ceilingHeight}"`} ok={design.systemHeight <= design.ceilingHeight} />
            </div>
          </div>
        </div>

        {/* Global warnings */}
        {warnings.filter(w => !w.wall).map((w, i) => (
          <div key={i} style={{ ...S.warning, marginBottom: "10px" }}>⚠ {w.message}</div>
        ))}

        {/* ── WALL EDITOR CARD ─────────────────────────────────────────────── */}
        <div style={S.wallCard}>

          {/* Wall tabs */}
          <div style={S.wallTabs}>
            {(["A", "B", "C"] as WallId[]).map(wid => {
              const wd  = wallMap[wid];
              const tot = wallTotal(wd.secs as WalkInSection[]);
              const sel = activeWall === wid;
              return (
                <button key={wid} onClick={() => handleWallChange(wid)}
                  style={{ ...S.wallTab, ...(sel ? S.wallTabSel : {}) }}>
                  <span style={{ fontSize: "14px", fontWeight: "800" }}>Wall {wid}</span>
                  <span style={{ fontSize: "11px", color: sel ? "rgba(255,255,255,0.65)" : tot === wd.width ? "#2a7a4f" : "#c0392b" }}>
                    {tot}"{tot !== wd.width && ` / ${wd.width}"`}
                  </span>
                  {wallWarn[wid] > 0 && <span style={{ fontSize: "10px", color: sel ? "#fbbf24" : "#c0392b" }}>{wallWarn[wid]} ⚠</span>}
                </button>
              );
            })}
          </div>

          {/* Wall-level warnings */}
          {warnings.filter(w => w.wall === activeWall).map((w, i) => (
            <div key={i} style={S.wallWarning}><span style={S.wwBadge}>Wall {w.wall}</span>{w.message}</div>
          ))}

          {/* Wall header */}
          <div style={S.wallHeader}>
            <div>
              <span style={S.wallTitle}>Wall {activeWall}</span>
              <span style={S.wallDim}> — {active.width}"</span>
              {activeDiff !== 0 && (
                <span style={{ fontSize: "12px", color: activeDiff > 0 ? "#c0392b" : "#e67e22", marginLeft: "8px" }}>
                  {activeDiff > 0 ? "+" : ""}{activeDiff}" vs wall
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={handleRebuild}    style={S.btnRebuild}>↺ Rebuild</button>
              <button onClick={handleAddSection} style={S.btnAdd}>+ Add Section</button>
            </div>
          </div>

          {/* ── TWO-COLUMN: SVG left, editor right ──────────────────────────── */}
          <div style={S.editorRow}>

            {/* LEFT — Elevation SVG */}
            <div style={S.svgPane}>
              <div style={{ fontSize: "11px", color: "#aaa", marginBottom: "8px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Elevation — Wall {activeWall}
                {activeWall === "B" && (aLastHangs || cLastHangs) && (
                  <span style={{ marginLeft: "8px", color: "#b91c1c" }}>
                    {aLastHangs && "← 24\" corner"}
                    {aLastHangs && cLastHangs && " · "}
                    {cLastHangs && "24\" corner →"}
                  </span>
                )}
              </div>
              {!selectedId && activeSecs.length > 0 && (
                <div style={{ fontSize: "12px", color: C_SELECT, marginBottom: "8px", fontWeight: "600" }}>
                  ↑ Click any section in the elevation to edit its interior
                </div>
              )}
              <div style={{ overflowX: "auto" }}>
                <ElevSVG
                  sections={activeSecs}
                  wallId={activeWall}
                  systemH={design.systemHeight}
                  selectedId={selectedId}
                  drag={drag}
                  leftCornerHang={activeWall === "B" ? aLastHangs : false}
                  rightCornerHang={activeWall === "B" ? cLastHangs : false}
                  onSectionClick={handleSectionClick}
                  onStartDrag={(secId, compId, clientY, posIn) =>
                    setDrag({ wallId: activeWall, secId, compId, startClientY: clientY, startPosIn: posIn })
                  }
                />
              </div>
            </div>

            {/* RIGHT — Section editor or section list */}
            <div style={S.editorPane}>
              {selectedSec ? (
                // ── Section inspector ──────────────────────────────────────────
                <SectionInspector
                  section={selectedSec}
                  systemH={design.systemHeight}
                  overallDepth={design.closetDepth}
                  onClose={() => setSelectedId(null)}
                  onWidthChange={w => handleWidthChange(selectedSec.id, w)}
                  onDepthChange={d => handleDepthChange(selectedSec.id, d)}
                  onAddComp={handleAddComp}
                  onRemoveComp={handleRemoveComp}
                  onMoveComp={handleMoveComp}
                  onAddDrawer={handleAddDrawer}
                  onRemoveDrawer={handleRemoveDrawer}
                  onDrawerH={handleDrawerH}
                />
              ) : (
                // ── Section list (when nothing selected) ──────────────────────
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "#1a1a1a", marginBottom: "12px" }}>
                    Sections — Wall {activeWall}
                  </div>
                  {activeSecs.length === 0 ? (
                    <div style={{ color: "#bbb", fontSize: "13px", textAlign: "center", padding: "20px 0" }}>
                      No sections — click &ldquo;+ Add Section&rdquo; above.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {activeSecs.map((sec, i) => {
                        const meta = SECTION_META[sec.type];
                        return (
                          <div
                            key={sec.id}
                            onClick={() => handleSectionClick(sec.id)}
                            style={{
                              display: "flex", alignItems: "center", gap: "8px",
                              padding: "10px 12px", backgroundColor: "#f9f9f9",
                              border: "1.5px solid #e5e0d8", borderLeft: `4px solid ${meta.border}`,
                              borderRadius: "7px", cursor: "pointer",
                            }}
                          >
                            <span style={{ fontSize: "11px", fontWeight: "700", color: "#aaa", minWidth: "16px" }}>{i+1}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: "13px", fontWeight: "600", color: "#1a1a1a" }}>{meta.label}</div>
                              <div style={{ fontSize: "11px", color: "#888" }}>{sec.widthIn}" wide · {sec.depthIn}" deep · {sec.components.length} component{sec.components.length !== 1 ? "s" : ""}</div>
                            </div>
                            <span style={{ fontSize: "11px", color: C_SELECT, fontWeight: "700" }}>Edit →</span>
                            {activeSecs.length > 1 && (
                              <button onClick={e => { e.stopPropagation(); handleRemoveSection(sec.id); }}
                                style={{ fontSize: "13px", color: "#ccc", background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}>✕</button>
                            )}
                          </div>
                        );
                      })}

                      {/* Width total */}
                      <div style={{ textAlign: "right", fontSize: "12px", fontWeight: "700", paddingTop: "4px",
                        color: activeDiff === 0 ? "#2a7a4f" : "#c0392b" }}>
                        Total: {activeTotal}" / {active.width}"  {activeDiff === 0 ? "✓" : `(${activeDiff > 0 ? "+" : ""}${activeDiff}")`}
                      </div>
                    </div>
                  )}

                  {/* Preset type quick-add */}
                  <div style={{ marginTop: "16px", borderTop: "1px solid #f0ece6", paddingTop: "14px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                      Quick-add preset
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {ALL_TYPES.map(type => {
                        const meta = SECTION_META[type];
                        return (
                          <button key={type} onClick={() => {
                            setWallSecs(activeWall, [...activeSecs, makeSection(type, meta.defaultWidth, design.systemHeight)]);
                          }} style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            padding: "7px 10px", backgroundColor: meta.fill,
                            border: `1px solid ${meta.border}`, borderRadius: "6px",
                            cursor: "pointer", textAlign: "left",
                          }}>
                            <span style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: meta.border, flexShrink: 0 }} />
                            <span style={{ fontSize: "12px", fontWeight: "600", color: "#333" }}>{meta.label}</span>
                            <span style={{ fontSize: "11px", color: "#888", marginLeft: "auto" }}>{meta.defaultWidth}"</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* All-walls summary */}
        <div style={S.summaryRow}>
          {(["A", "B", "C"] as WallId[]).map(wid => {
            const wd  = wallMap[wid];
            const tot = wallTotal(wd.secs as WalkInSection[]);
            return (
              <div key={wid} style={S.summaryCard}>
                <div style={S.summaryTitle}>Wall {wid} — {wd.width}"</div>
                {(wd.secs as WalkInSection[]).map(sec => (
                  <div key={sec.id} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                    <div style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: SECTION_META[sec.type].border, flexShrink: 0 }} />
                    <span style={{ fontSize: "12px", color: "#444" }}>{SECTION_META[sec.type].label}</span>
                    {sec.components.length > 0 && (
                      <span style={{ fontSize: "10px", color: C_SELECT, fontWeight: "600" }}>{sec.components.length}c</span>
                    )}
                    <span style={{ fontSize: "11px", color: "#aaa", marginLeft: "auto" }}>{sec.widthIn}"</span>
                  </div>
                ))}
                <div style={{ marginTop: "6px", paddingTop: "6px", borderTop: "1px solid #eee", fontSize: "11px", fontWeight: "700", color: tot === wd.width ? "#2a7a4f" : "#c0392b" }}>
                  {tot}" / {wd.width}"  {tot === wd.width ? "✓" : "⚠"}
                </div>
              </div>
            );
          })}
        </div>

      </main>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page:       { fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee" },
  header:     { backgroundColor: "#1a1a1a", position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid #2e2e2e" },
  headerInner:{ maxWidth: "1300px", margin: "0 auto", padding: "0 32px", height: "52px", display: "flex", alignItems: "center", justifyContent: "space-between" },
  brandRow:   { display: "flex", alignItems: "center", gap: "10px" },
  backBtn:    { fontSize: "12px", fontWeight: "600", color: "#888", background: "none", border: "none", cursor: "pointer", padding: 0 },
  sep:        { color: "#444" },
  title:      { fontSize: "14px", fontWeight: "700", color: "#fff" },
  tag:        { fontSize: "11px", fontWeight: "700", color: "#bbb", backgroundColor: "#2a2a2a", padding: "2px 8px", borderRadius: "4px", border: "1px solid #333" },
  cname:      { fontSize: "13px", color: "#ccc" },
  cloc:       { fontSize: "12px", color: "#666" },
  btnSec:     { padding: "7px 14px", fontSize: "12px", fontWeight: "600", backgroundColor: "transparent", color: "#888", border: "1px solid #444", borderRadius: "6px", cursor: "pointer" },
  main:       { maxWidth: "1300px", margin: "0 auto", padding: "28px 32px 80px" },
  topRow:     { display: "flex", gap: "16px", marginBottom: "20px", alignItems: "flex-start" },
  card:       { backgroundColor: "#fff", border: "1px solid #e8e4de", borderRadius: "10px", padding: "16px 20px" },
  dimCard:    { flex: 1, backgroundColor: "#fff", border: "1px solid #e8e4de", borderRadius: "10px", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" },
  cardLabel:  { fontSize: "10px", fontWeight: "700", color: "#aaa", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "10px" },
  dimGrid:    { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" },
  statsRow:   { display: "flex", gap: "20px", paddingTop: "10px", borderTop: "1px solid #f0ece6" },
  warning:    { fontSize: "12px", color: "#92400e", backgroundColor: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "5px", padding: "9px 12px" },
  wallWarning:{ fontSize: "12px", color: "#b91c1c", backgroundColor: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "5px", padding: "8px 16px", display: "flex", alignItems: "flex-start", gap: "8px" },
  wwBadge:    { fontSize: "10px", fontWeight: "800", color: "#fff", backgroundColor: "#b91c1c", borderRadius: "3px", padding: "1px 6px", flexShrink: 0, lineHeight: 1.6 },
  // Wall editor card
  wallCard:   { backgroundColor: "#fff", border: "1px solid #e8e4de", borderRadius: "10px", overflow: "hidden", marginBottom: "16px" },
  wallTabs:   { display: "flex", borderBottom: "1px solid #e8e4de" },
  wallTab:    { flex: 1, padding: "12px 16px", border: "none", borderRight: "1px solid #e8e4de", cursor: "pointer", backgroundColor: "#f9f7f4", color: "#666", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" },
  wallTabSel: { backgroundColor: "#1a1a1a", color: "#fff" },
  wallHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid #f0ece6" },
  wallTitle:  { fontSize: "15px", fontWeight: "800", color: "#1a1a1a" },
  wallDim:    { fontSize: "13px", color: "#888" },
  btnRebuild: { padding: "7px 13px", fontSize: "12px", fontWeight: "600", backgroundColor: "#f5f2ee", color: "#555", border: "1px solid #ddd", borderRadius: "6px", cursor: "pointer" },
  btnAdd:     { padding: "7px 14px", fontSize: "12px", fontWeight: "700", backgroundColor: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" },
  // Two-column editor row
  editorRow:  { display: "flex", gap: "0", minHeight: "400px" },
  svgPane:    { flex: 1, padding: "16px 20px", overflowX: "auto", borderRight: "1px solid #f0ece6" },
  editorPane: { width: "320px", flexShrink: 0, padding: "16px 18px", overflowY: "auto", maxHeight: "600px", backgroundColor: "#fafaf9" },
  // Summary
  summaryRow: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" },
  summaryCard:{ backgroundColor: "#fff", border: "1px solid #e8e4de", borderRadius: "8px", padding: "14px 16px" },
  summaryTitle:{ fontSize: "12px", fontWeight: "800", color: "#1a1a1a", marginBottom: "10px", paddingBottom: "8px", borderBottom: "1px solid #f0ece6" },
};
