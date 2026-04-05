"use client";
// app/design/page.tsx — Manual panel + component closet design editor (v2)

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { RoomLayout, DesignWall, RoomSegment } from "@/app/_lib/room-types";
import { getSelectedWalls, getDesignWalls } from "@/app/_lib/room-types";
import {
  type Point, computePoints, segStart, isClosed,
  computeTransform, computeSignedArea, makeWallPtFn, buildRoomPath,
} from "@/app/_lib/room-geo";

// ─── Types ────────────────────────────────────────────────────────────────────

type CompType = "Shelf" | "Rod" | "DrawerStack";

type ObstacleType = "LightSwitch" | "Outlet" | "Window" | "Unknown";

interface ClosetComp {
  id:            number;
  type:          CompType;
  positionIn:    number;
  drawerHeights: number[];
}

interface Obstacle {
  id:   number;
  type: ObstacleType;
  xIn:  number;   // left edge, wall-absolute inches
  yIn:  number;   // bottom edge, floor-based inches
  wIn:  number;
  hIn:  number;
}

interface Panel { id: number; xIn: number; heightIn?: number; }  // xIn = left edge, wall-absolute inches

interface Section { id: number; depthIn: number; comps: ClosetComp[]; }

// ── Per-wall ceiling profile ──────────────────────────────────────────────────
// x-coordinates in the profile are run-relative (0 = left end of closet system).
// Height values are floor-relative inches.
// undefined ceilingProfile on WallRun → flat at layout.ceilingHeightIn.
type CeilingProfile =
  | { type: "flat";            heightIn: number }
  | { type: "slope";           leftHeightIn: number; rightHeightIn: number }
  | { type: "flat_then_slope"; flatLengthIn: number; flatHeightIn: number; endHeightIn: number };

interface WallRun {
  wallId:               string;
  startIn:              number;   // left edge of the closet system (0 = flush to left wall)
  endIn:                number;   // right edge of the closet system (wall.widthIn = flush to right wall)
  panels:               Panel[];  // interior dividers, sorted by xIn; n panels → n+1 sections
  sections:             Section[];
  obstacles:            Obstacle[];
  leftPanelHeightIn?:   number;   // custom height for the left end panel (undefined = sysH)
  rightPanelHeightIn?:  number;   // custom height for the right end panel (undefined = sysH)
  ceilingProfile?:      CeilingProfile; // per-wall ceiling shape (undefined = flat global ceiling)
}

interface DesignStateV2 { v: 2; runs: WallRun[]; fullLengthWalls: string[]; }

// V1 legacy (migration only)
interface V1Section { id: number; widthIn: number; depthIn: number; components: ClosetComp[]; }
interface V1Wall    { wallId: string; sections: V1Section[]; }
interface V1State   { walls: V1Wall[]; }

type Selection =
  | { kind: "left-end"  }
  | { kind: "right-end" }
  | { kind: "panel";    panelId: number }
  | { kind: "section";  secId: number }
  | { kind: "comp";     secId: number; compId: number }
  | { kind: "obstacle"; obsId: number }
  | null;

type DragState =
  | { kind: "left-end";          wallId: string; startX: number; startIn: number }
  | { kind: "right-end";         wallId: string; startX: number; endIn: number }
  | { kind: "left-end-height";   wallId: string; startY: number; startHeightIn: number }
  | { kind: "right-end-height";  wallId: string; startY: number; startHeightIn: number }
  | { kind: "panel";             wallId: string; panelIdx: number; startX: number; startXIn: number }
  | { kind: "panel-height";      wallId: string; panelIdx: number; startY: number; startHeightIn: number }
  | { kind: "comp";              wallId: string; secId: number; compId: number; startY: number; startPosIn: number }
  | { kind: "obstacle";          wallId: string; obsId: number; startX: number; startY: number; startXIn: number; startYIn: number };

type ViewMode = "front" | "top" | "split";

// ─── Constants ────────────────────────────────────────────────────────────────

const SCALE          = 6;
const PANEL_W_IN     = 0.75;
const PANEL_W_PX     = PANEL_W_IN * SCALE;   // 4.5 px
const LOCK_H_IN      = 1;
const LOCK_H_PX      = LOCK_H_IN * SCALE;
const MIN_SEC_W      = 6;    // minimum section width (inches)
const SNAP_IN        = 1;
const DRAWER_MAX_TOP = 50;   // drawer stack top cannot exceed this height from floor
const DRAWER_MAX_W   = 36;   // drawer section max width (inches)
const LOCK_SPAN_MIN  = 43;   // shelf/rod locked when span >= this (43–48" range)
const MAX_SPAN_IN    = 48;   // shelf/rod not allowed when span > this
const PAD_TOP        = 40;
const PAD_BOT        = 32;
const H_PAD          = 44;   // horizontal SVG padding (ruler space on left)

const C_PANEL    = "#b8956a";
const C_PANEL_BD = "#5c3d1e";
const C_ENDPANEL = "#8b7355";   // end panels slightly darker
const C_LOCK     = "#7a8a96";
const C_LOCK_BD  = "#4a5a66";
const C_SHELF    = "#c4935a";
const C_SHELF_BD = "#8b6437";
const C_ROD      = "#7a5230";
const C_DRAWER   = "#d4b896";
const C_DRAWER_BD= "#8b6437";
const C_SELECT   = "#3b82f6";
const C_DIM      = "#666";
const C_INT      = "#f5f0e8";   // active system interior
const C_GAP      = "#e2ddd7";   // unused wall area
const C_INT_BD   = "#d4cfc8";
const C_HANGER   = "#9a6840";

// Obstacle colors by type
const OBS_FILL: Record<ObstacleType, string> = {
  LightSwitch: "#d0d8e4",
  Outlet:      "#d8d4cc",
  Window:      "#b8d4e8",
  Unknown:     "#e4d4b0",
};
const OBS_STROKE: Record<ObstacleType, string> = {
  LightSwitch: "#6a7a90",
  Outlet:      "#7a7060",
  Window:      "#4a80a8",
  Unknown:     "#9a8050",
};
const OBS_LABEL: Record<ObstacleType, string> = {
  LightSwitch: "SW",
  Outlet:      "OUT",
  Window:      "WIN",
  Unknown:     "?",
};

// ─── ID counter ───────────────────────────────────────────────────────────────

let _id = 1;
function nextId(): number { return _id++; }

function seedId(runs: WallRun[]) {
  const ids: number[] = [];
  for (const r of runs) {
    r.panels.forEach(p => ids.push(p.id));
    r.sections.forEach(s => { ids.push(s.id); s.comps.forEach(c => ids.push(c.id)); });
    (r.obstacles ?? []).forEach(o => ids.push(o.id));
  }
  const max = ids.reduce((m, x) => Math.max(m, x), 0);
  if (max >= _id) _id = max + 1;
}

// ─── Section geometry ─────────────────────────────────────────────────────────

/** Left edge (inches) of section[i] within the wall coordinate space */
function secLeft(panels: Panel[], startIn: number, i: number): number {
  return i === 0 ? startIn : panels[i - 1].xIn + PANEL_W_IN;
}

/** Width (inches) of section[i] */
function secWidth(panels: Panel[], startIn: number, endIn: number, i: number): number {
  const l = secLeft(panels, startIn, i);
  const r = i === panels.length ? endIn : panels[i].xIn;
  return Math.max(0, r - l);
}

/** Effective height of a panel (falls back to system height when not overridden). */
function panelH(panel: Panel, sysH: number): number {
  return panel.heightIn ?? sysH;
}

/** Effective height available in section[si] = min of its two bounding panels (including end panels). */
function sectionEffH(run: WallRun, si: number, sysH: number): number {
  const leftH  = si === 0                   ? (run.leftPanelHeightIn  ?? sysH) : panelH(run.panels[si - 1], sysH);
  const rightH = si === run.panels.length   ? (run.rightPanelHeightIn ?? sysH) : panelH(run.panels[si],     sysH);
  return Math.min(leftH, rightH);
}

// ─── Factories ────────────────────────────────────────────────────────────────

function mkSection(depthIn = 12): Section {
  return { id: nextId(), depthIn, comps: [] };
}
function mkPanel(xIn: number): Panel {
  return { id: nextId(), xIn };
}
function mkRun(wallId: string, wallW: number): WallRun {
  return {
    wallId,
    startIn:   0,
    endIn:     wallW,
    panels:    [],
    sections:  [mkSection(12)],
    obstacles: [],
  };
}

// ─── Run mutations ────────────────────────────────────────────────────────────

function runAddPanel(run: WallRun, xIn: number): WallRun {
  const idx = run.sections.findIndex((_, i) => {
    const l = secLeft(run.panels, run.startIn, i);
    const r = i === run.panels.length ? run.endIn : run.panels[i].xIn;
    return xIn > l + MIN_SEC_W && xIn < r - PANEL_W_IN - MIN_SEC_W;
  });
  if (idx === -1) return run;

  const lx       = secLeft(run.panels, run.startIn, idx);
  const rx       = idx === run.panels.length ? run.endIn : run.panels[idx].xIn;
  const clamped  = Math.max(lx + MIN_SEC_W, Math.min(rx - PANEL_W_IN - MIN_SEC_W, xIn));
  const newPanel = mkPanel(clamped);
  const newSec   = mkSection(run.sections[idx].depthIn);

  return {
    ...run,
    panels:   [...run.panels.slice(0, idx),       newPanel, ...run.panels.slice(idx)],
    sections: [...run.sections.slice(0, idx + 1), newSec,   ...run.sections.slice(idx + 1)],
  };
}

function runRemovePanel(run: WallRun, panelId: number): WallRun {
  const idx = run.panels.findIndex(p => p.id === panelId);
  if (idx === -1) return run;
  const merged: Section = {
    ...run.sections[idx],
    comps: [...run.sections[idx].comps, ...run.sections[idx + 1].comps],
  };
  return {
    ...run,
    panels:   run.panels.filter(p => p.id !== panelId),
    sections: [...run.sections.slice(0, idx), merged, ...run.sections.slice(idx + 2)],
  };
}

function runMovePanel(run: WallRun, panelIdx: number, newX: number): WallRun {
  let minX = panelIdx === 0
    ? run.startIn + MIN_SEC_W
    : run.panels[panelIdx - 1].xIn + PANEL_W_IN + MIN_SEC_W;
  let maxX = panelIdx === run.panels.length - 1
    ? run.endIn - PANEL_W_IN - MIN_SEC_W
    : run.panels[panelIdx + 1].xIn - PANEL_W_IN - MIN_SEC_W;
  // Enforce DRAWER_MAX_W for adjacent sections that contain DrawerStack
  const leftStart = panelIdx === 0 ? run.startIn : run.panels[panelIdx - 1].xIn + PANEL_W_IN;
  const rightEnd  = panelIdx === run.panels.length - 1 ? run.endIn : run.panels[panelIdx + 1].xIn;
  if (run.sections[panelIdx]?.comps.some(c => c.type === "DrawerStack")) {
    maxX = Math.min(maxX, leftStart + DRAWER_MAX_W);
  }
  if (run.sections[panelIdx + 1]?.comps.some(c => c.type === "DrawerStack")) {
    minX = Math.max(minX, rightEnd - PANEL_W_IN - DRAWER_MAX_W);
  }
  if (run.sections[panelIdx]?.comps.some(c => c.type === "Shelf" || c.type === "Rod")) {
    maxX = Math.min(maxX, leftStart + MAX_SPAN_IN);
  }
  if (run.sections[panelIdx + 1]?.comps.some(c => c.type === "Shelf" || c.type === "Rod")) {
    minX = Math.max(minX, rightEnd - PANEL_W_IN - MAX_SPAN_IN);
  }
  return {
    ...run,
    panels: run.panels.map((p, i) => i === panelIdx ? { ...p, xIn: Math.max(minX, Math.min(maxX, newX)) } : p),
  };
}

function runMoveLeftEnd(run: WallRun, newStart: number): WallRun {
  const firstPanelX = run.panels.length > 0 ? run.panels[0].xIn : run.endIn;
  let maxStart = firstPanelX - MIN_SEC_W;
  let minStart = 0;
  // DrawerStack: prevent section from exceeding DRAWER_MAX_W (can still shrink freely)
  if (run.sections[0]?.comps.some(c => c.type === "DrawerStack")) {
    minStart = Math.max(minStart, firstPanelX - DRAWER_MAX_W);
  }
  // Shelf/Rod: prevent section from exceeding MAX_SPAN_IN (can still shrink freely)
  if (run.sections[0]?.comps.some(c => c.type === "Shelf" || c.type === "Rod")) {
    minStart = Math.max(minStart, firstPanelX - MAX_SPAN_IN);
  }
  return { ...run, startIn: Math.max(minStart, Math.max(0, Math.min(maxStart, newStart))) };
}

function runMoveRightEnd(run: WallRun, newEnd: number, wallW: number): WallRun {
  const last         = run.panels[run.panels.length - 1];
  const lastSecStart = last ? last.xIn + PANEL_W_IN : run.startIn;
  let minEnd         = lastSecStart + MIN_SEC_W;
  let maxEnd         = wallW;
  // DrawerStack: prevent section from exceeding DRAWER_MAX_W (can still shrink freely)
  const lastSec = run.sections[run.sections.length - 1];
  if (lastSec?.comps.some(c => c.type === "DrawerStack")) {
    maxEnd = Math.min(maxEnd, lastSecStart + DRAWER_MAX_W);
  }
  // Shelf/Rod: prevent section from exceeding MAX_SPAN_IN (can still shrink freely)
  if (lastSec?.comps.some(c => c.type === "Shelf" || c.type === "Rod")) {
    maxEnd = Math.min(maxEnd, lastSecStart + MAX_SPAN_IN);
  }
  return { ...run, endIn: Math.max(minEnd, Math.min(maxEnd, Math.min(wallW, newEnd))) };
}

function runUpdatePanel(run: WallRun, panelId: number, u: Partial<Panel>): WallRun {
  return { ...run, panels: run.panels.map(p => p.id === panelId ? { ...p, ...u } : p) };
}

function runUpdateEndPanel(run: WallRun, side: "left" | "right", heightIn: number | undefined): WallRun {
  return side === "left"
    ? { ...run, leftPanelHeightIn: heightIn }
    : { ...run, rightPanelHeightIn: heightIn };
}

function runUpdateSection(run: WallRun, secId: number, u: Partial<Section>): WallRun {
  // Enforce minimum depth: 16" for drawer sections, 12" for all others
  if (u.depthIn !== undefined) {
    const sec = run.sections.find(s => s.id === secId);
    const hasDrawers = sec?.comps.some(c => c.type === "DrawerStack") ?? false;
    u = { ...u, depthIn: Math.max(hasDrawers ? 16 : 12, u.depthIn) };
  }
  return { ...run, sections: run.sections.map(s => s.id === secId ? { ...s, ...u } : s) };
}

/**
 * Update depth for both sections adjacent to an interior panel (atomically).
 * Each side independently enforces its own drawer/standard minimum.
 */
function runSetPanelDepth(
  run:        WallRun,
  leftSecId:  number,
  rightSecId: number,
  depth:      number,
): WallRun {
  let result = run;
  result = runUpdateSection(result, leftSecId,  { depthIn: depth });
  result = runUpdateSection(result, rightSecId, { depthIn: depth });
  return result;
}

function runAddComp(run: WallRun, secId: number, type: CompType, sysH: number): WallRun {
  const si   = run.sections.findIndex(s => s.id === secId);
  // Shelf/Rod not allowed in sections wider than MAX_SPAN_IN
  if (type === "Shelf" || type === "Rod") {
    if (si !== -1 && secWidth(run.panels, run.startIn, run.endIn, si) > MAX_SPAN_IN) return run;
  }
  // DrawerStack not allowed in sections wider than DRAWER_MAX_W
  if (type === "DrawerStack") {
    if (si !== -1 && secWidth(run.panels, run.startIn, run.endIn, si) > DRAWER_MAX_W) return run;
  }
  // Use section effective height (min of bounding panels) for default placement
  const effH = si >= 0 ? sectionEffH(run, si, sysH) : sysH;
  const dh   = [8, 8, 8];
  const tot  = dh.reduce((a, b) => a + b, 0);
  const comp: ClosetComp = {
    id: nextId(), type,
    positionIn: type === "DrawerStack"
      ? Math.max(LOCK_H_IN, Math.min(DRAWER_MAX_TOP - tot, effH - tot - LOCK_H_IN))
      : Math.floor(effH / 2),
    drawerHeights: type === "DrawerStack" ? dh : [],
  };
  const withComp = { ...run, sections: run.sections.map(s => s.id === secId ? { ...s, comps: [...s.comps, comp] } : s) };
  // Drawers require a minimum 16" depth — enforce immediately
  if (type === "DrawerStack") {
    return {
      ...withComp,
      sections: withComp.sections.map(s =>
        s.id === secId ? { ...s, depthIn: Math.max(16, s.depthIn) } : s
      ),
    };
  }
  return withComp;
}

function runUpdateComp(run: WallRun, secId: number, compId: number, u: Partial<ClosetComp>): WallRun {
  return {
    ...run,
    sections: run.sections.map(s =>
      s.id === secId
        ? { ...s, comps: s.comps.map(c => c.id === compId ? { ...c, ...u } : c) }
        : s
    ),
  };
}

function runDeleteComp(run: WallRun, secId: number, compId: number): WallRun {
  return { ...run, sections: run.sections.map(s => s.id === secId ? { ...s, comps: s.comps.filter(c => c.id !== compId) } : s) };
}

function runAddObstacle(run: WallRun, type: ObstacleType, wallW: number, ceilingH: number): WallRun {
  const defaults: Record<ObstacleType, { wIn: number; hIn: number }> = {
    LightSwitch: { wIn: 3,  hIn: 4 },
    Outlet:      { wIn: 3,  hIn: 4 },
    Window:      { wIn: 24, hIn: 36 },
    Unknown:     { wIn: 6,  hIn: 6 },
  };
  const { wIn, hIn } = defaults[type];
  const obs: Obstacle = {
    id: nextId(), type,
    xIn: Math.max(0, Math.min(wallW - wIn, wallW / 2 - wIn / 2)),
    // Default Y positions: windows at 36" sill, switches/outlets at 12", clamped to ceiling
    yIn: Math.max(0, Math.min(ceilingH - hIn, type === "Window" ? 36 : 12)),
    wIn, hIn,
  };
  return { ...run, obstacles: [...(run.obstacles ?? []), obs] };
}

function runUpdateObstacle(run: WallRun, obsId: number, u: Partial<Obstacle>): WallRun {
  return { ...run, obstacles: (run.obstacles ?? []).map(o => o.id === obsId ? { ...o, ...u } : o) };
}

function runDeleteObstacle(run: WallRun, obsId: number): WallRun {
  return { ...run, obstacles: (run.obstacles ?? []).filter(o => o.id !== obsId) };
}

function runUpdateCeilingProfile(run: WallRun, profile: CeilingProfile | undefined): WallRun {
  return { ...run, ceilingProfile: profile };
}

// ─── Corner clearance ─────────────────────────────────────────────────────────

/** Depth of the section at the given end of a run (the section closest to that corner). */
function runCornerDepth(run: WallRun, side: "left" | "right"): number {
  const idx = side === "right" ? run.sections.length - 1 : 0;
  return run.sections[idx]?.depthIn ?? 12;
}

interface CornerConstraint {
  cornerKey:  string;
  wallId:     string;            // cut-short wall's id
  side:       "left" | "right";  // which end of the cut-short wall is constrained
  cutbackIn:  number;            // required clear distance from that end (inches)
  otherLabel: string;            // full-length wall's label (for display)
  violated:   boolean;
}

/**
 * For every adjacent selected-wall pair (A→B in perimeter order):
 *  • If A is full-length → B gets a left-end clearance constraint
 *  • If B is full-length → A gets a right-end clearance constraint
 */
function deriveConstraints(
  fullLengthWalls: string[],
  runs:            WallRun[],
  walls:           DesignWall[],
  layout:          RoomLayout,
  labelOf:         (id: string) => string,
): CornerConstraint[] {
  const fullSet = new Set(fullLengthWalls);
  const selIds  = new Set(walls.map(w => w.id));
  const wallMap = new Map(walls.map(w => [w.id, w]));
  const segs    = layout.segments ?? [];
  const out: CornerConstraint[] = [];

  for (let i = 0; i < segs.length; i++) {
    const a = segs[i];
    const b = segs[(i + 1) % segs.length];
    if (!selIds.has(a.id) || !selIds.has(b.id)) continue;

    const aRun = runs.find(r => r.wallId === a.id);
    const bRun = runs.find(r => r.wallId === b.id);
    if (!aRun || !bRun) continue;

    // A full-length at its right end → B needs left clearance
    if (fullSet.has(a.id)) {
      const cutback = runCornerDepth(aRun, "right") + 12;
      out.push({
        cornerKey:  `${a.id}:${b.id}:a`,
        wallId:     b.id,
        side:       "left",
        cutbackIn:  cutback,
        otherLabel: labelOf(a.id),
        violated:   bRun.startIn < cutback,
      });
    }

    // B full-length at its left end → A needs right clearance
    if (fullSet.has(b.id)) {
      const cutback = runCornerDepth(bRun, "left") + 12;
      const aWall   = wallMap.get(a.id);
      out.push({
        cornerKey:  `${a.id}:${b.id}:b`,
        wallId:     a.id,
        side:       "right",
        cutbackIn:  cutback,
        otherLabel: labelOf(b.id),
        violated:   aRun.endIn > (aWall?.widthIn ?? 120) - cutback,
      });
    }
  }
  return out;
}

/**
 * Build a Map<segmentId → readable label> for the ordered list of selected walls.
 * If a wall already has a human-readable label (not "Segment NNN" auto-name), keep it.
 * Otherwise assign "Wall A", "Wall B", … in perimeter order.
 */
function buildWallLabelMap(walls: DesignWall[]): Map<string, string> {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const map = new Map<string, string>();
  walls.forEach((w, i) => {
    map.set(w.id, `Wall ${letters[i] ?? String(i + 1)}`);
  });
  return map;
}

// ─── Component helpers ────────────────────────────────────────────────────────

function compHeight(comp: ClosetComp): number {
  return comp.type === "DrawerStack" ? comp.drawerHeights.reduce((a, b) => a + b, 0) : 1;
}

/** effH = section effective height (min of bounding panel heights). */
function resolvePos(comp: ClosetComp, effH: number, raw: number, all: ClosetComp[]): number {
  const cH = compHeight(comp);
  const min = LOCK_H_IN;
  // Enforce 50" drawer-top ceiling
  const max = comp.type === "DrawerStack"
    ? Math.min(effH - LOCK_H_IN - cH, DRAWER_MAX_TOP - cH)
    : effH - LOCK_H_IN - cH;

  if (max < min) return min;

  let pos = Math.round(raw / SNAP_IN) * SNAP_IN;
  pos     = Math.max(min, Math.min(max, pos));

  for (const other of all) {
    if (other.id === comp.id) continue;
    const oH = compHeight(other);
    if (pos < other.positionIn + oH && pos + cH > other.positionIn) {
      const above = other.positionIn - cH;
      const below = other.positionIn + oH;
      const aOk   = above >= min;
      const bOk   = below <= max;
      if (aOk && bOk) pos = Math.abs(raw - above) <= Math.abs(raw - below) ? above : below;
      else if (aOk)   pos = above;
      else if (bOk)   pos = below;
      break;
    }
  }
  return pos;
}

// ─── Ceiling profile helpers ──────────────────────────────────────────────────

/** Ceiling height (floor-relative, inches) at a run-relative x position. */
function ceilingAtX(xIn: number, runW: number, profile: CeilingProfile): number {
  switch (profile.type) {
    case "flat": return profile.heightIn;
    case "slope": {
      const t = runW > 0 ? Math.max(0, Math.min(1, xIn / runW)) : 0;
      return profile.leftHeightIn + (profile.rightHeightIn - profile.leftHeightIn) * t;
    }
    case "flat_then_slope": {
      if (xIn <= profile.flatLengthIn) return profile.flatHeightIn;
      const rem = Math.max(0, runW - profile.flatLengthIn);
      if (rem === 0) return profile.endHeightIn;
      const t = Math.max(0, Math.min(1, (xIn - profile.flatLengthIn) / rem));
      return profile.flatHeightIn + (profile.endHeightIn - profile.flatHeightIn) * t;
    }
  }
}

/** Minimum ceiling height over the run-relative range [x1, x2]. */
function minCeilingInRange(x1: number, x2: number, runW: number, profile: CeilingProfile): number {
  switch (profile.type) {
    case "flat": return profile.heightIn;
    case "slope":
      return Math.min(ceilingAtX(x1, runW, profile), ceilingAtX(x2, runW, profile));
    case "flat_then_slope": {
      const checks = [x1, x2];
      if (profile.flatLengthIn > x1 && profile.flatLengthIn < x2) checks.push(profile.flatLengthIn);
      return Math.min(...checks.map(x => ceilingAtX(x, runW, profile)));
    }
  }
}

/** Control points [runRelativeXIn, heightIn][] describing the ceiling boundary. */
function ceilingProfilePts(runW: number, profile: CeilingProfile): [number, number][] {
  switch (profile.type) {
    case "flat":
      return [[0, profile.heightIn], [runW, profile.heightIn]];
    case "slope":
      return [[0, profile.leftHeightIn], [runW, profile.rightHeightIn]];
    case "flat_then_slope":
      return [
        [0,                  profile.flatHeightIn],
        [profile.flatLengthIn, profile.flatHeightIn],
        [runW,               profile.endHeightIn],
      ];
  }
}

/** Resolved ceiling height at a wall-absolute x, with fallback to global ceilingH. */
function runCeilingAt(run: WallRun, xWall: number, ceilingH: number): number {
  if (!run.ceilingProfile) return ceilingH;
  const runW = run.endIn - run.startIn;
  return ceilingAtX(Math.max(0, Math.min(runW, xWall - run.startIn)), runW, run.ceilingProfile);
}

// ─── Migration ────────────────────────────────────────────────────────────────

function migrateV1(v1: V1State, wallMap: Map<string, DesignWall>): DesignStateV2 {
  const runs: WallRun[] = v1.walls.map(wd => {
    const wallW = wallMap.get(wd.wallId)?.widthIn ?? 120;
    const panels: Panel[] = [];
    let x = 0;
    for (let i = 0; i < wd.sections.length - 1; i++) {
      x += wd.sections[i].widthIn;
      panels.push(mkPanel(x));
      x += PANEL_W_IN;
    }
    const sections: Section[] = wd.sections.map(s => ({
      id:      s.id,
      depthIn: s.depthIn,
      comps:   (s.components ?? []).map(c => ({
        id:            c.id,
        type:          c.type as CompType,
        positionIn:    c.positionIn,
        drawerHeights: c.drawerHeights ?? [],
      })),
    }));
    return { wallId: wd.wallId, startIn: 0, endIn: wallW, panels, sections, obstacles: [] };
  });
  return { v: 2, runs, fullLengthWalls: [] };
}

// ─── Compat save ──────────────────────────────────────────────────────────────

function saveCompatPayload(layout: RoomLayout, runs: WallRun[]) {
  const allWalls = getSelectedWalls(layout);
  const mainWall = allWalls[0];
  if (!mainWall) return;
  const run = runs.find(r => r.wallId === mainWall.id);
  if (!run) return;

  const startIn = run.startIn ?? 0;
  const endIn   = run.endIn   ?? mainWall.widthIn;

  const legacySections = run.sections.map((s, i) => ({
    widthIn:    secWidth(run.panels, startIn, endIn, i),
    depthIn:    s.depthIn,
    components: s.comps,
  }));
  const panelArr = Array.from({ length: run.sections.length + 1 }, () => layout.systemHeightIn);

  localStorage.setItem("closet-design", JSON.stringify({
    config: {
      clientName:      layout.clientName,
      clientNum:       layout.clientNum,
      locationName:    layout.locationName,
      wallWidthIn:     endIn - startIn,
      ceilingHeightIn: layout.ceilingHeightIn,
      closetDepthIn:   layout.closetDepthIn,
      leftReturnIn:    layout.leftReturnIn  ?? 0.5,
      rightReturnIn:   layout.rightReturnIn ?? 2.5,
      remarks:         layout.remarks,
      projectType:     layout.projectType,
    },
    sections:     legacySections,
    panelHeights: panelArr,
    ceilingH:     layout.ceilingHeightIn,
  }));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RodWithHangers({ xPx, wPx, cYPx, wallH, padTop, lockH, selected }: {
  xPx: number; wPx: number; cYPx: number; wallH: number;
  padTop: number; lockH: number; selected: boolean;
}) {
  const rodY        = cYPx + 3;
  const hangAreaBot = padTop + wallH - lockH;
  const hangAreaH   = Math.max(0, hangAreaBot - (cYPx + SCALE));
  const count       = Math.max(2, Math.min(8, Math.floor(wPx / 18)));
  const xs          = Array.from({ length: count }, (_, i) =>
    xPx + 8 + (count === 1 ? 0 : i * (wPx - 16) / (count - 1))
  );

  return (
    <g pointerEvents="none">
      <rect x={xPx} y={cYPx + SCALE} width={wPx} height={hangAreaH}
        fill={C_ROD} opacity={0.05} />
      {xs.map((hx, i) => (
        <g key={i} stroke={C_HANGER} strokeWidth={1} fill="none" opacity={0.5}>
          <path d={`M ${hx} ${rodY} Q ${hx + 3} ${rodY - 4} ${hx + 5} ${rodY}`} strokeWidth={1.5} />
          <line x1={hx} y1={rodY} x2={hx} y2={rodY + 7} />
          <line x1={hx} y1={rodY + 7} x2={hx - 8} y2={rodY + 16} />
          <line x1={hx} y1={rodY + 7} x2={hx + 8} y2={rodY + 16} />
          <line x1={hx - 8} y1={rodY + 16} x2={hx + 8} y2={rodY + 16} />
        </g>
      ))}
      {/* Rod bar spans flush to panel faces */}
      <line x1={xPx} y1={rodY} x2={xPx + wPx} y2={rodY}
        stroke={selected ? C_SELECT : C_ROD} strokeWidth={4} strokeLinecap="butt" />
      {/* Mount brackets at each end */}
      <rect x={xPx} y={rodY - 5} width={3} height={10}
        fill={selected ? C_SELECT : C_ROD} />
      <rect x={xPx + wPx - 3} y={rodY - 5} width={3} height={10}
        fill={selected ? C_SELECT : C_ROD} />
    </g>
  );
}

function DrawerFace({ x, y, w, h, selected }: {
  x: number; y: number; w: number; h: number; selected: boolean;
}) {
  const faceH   = Math.max(4, h - 2);
  const handleW = Math.min(w * 0.35, 28);
  const handleX = x + (w - handleW) / 2;
  const handleY = y + 1 + faceH / 2 - 1.5;
  return (
    <g>
      <rect x={x + 2} y={y + 1} width={w - 4} height={faceH}
        fill={selected ? "#e8d5b8" : C_DRAWER}
        stroke={selected ? C_SELECT : C_DRAWER_BD}
        strokeWidth={selected ? 1.5 : 1} rx={2} />
      <rect x={handleX} y={handleY} width={handleW} height={3}
        fill={C_DRAWER_BD} rx={1.5} />
      <circle cx={handleX + 3}           cy={handleY + 1.5} r={1} fill={C_INT} opacity={0.6} />
      <circle cx={handleX + handleW - 3} cy={handleY + 1.5} r={1} fill={C_INT} opacity={0.6} />
    </g>
  );
}

// ─── Wall Canvas ──────────────────────────────────────────────────────────────

function WallCanvas({
  run, wall, sysH, ceilingH, selection, onSelect, onDragStart, onAddPanelAt, cornerConstraints, zoom,
}: {
  run:               WallRun;
  wall:              DesignWall;
  sysH:              number;
  ceilingH:          number;
  selection:         Selection;
  onSelect:          (s: Selection) => void;
  onDragStart:       (drag: DragState, e: React.PointerEvent) => void;
  onAddPanelAt:      (xIn: number) => void;
  cornerConstraints: CornerConstraint[];
  zoom:              number;
}) {
  const obstacles      = run.obstacles ?? [];
  const wallCorners    = cornerConstraints.filter(c => c.wallId === wall.id);
  const svgRef         = useRef<SVGSVGElement>(null);
  const wallW          = wall.widthIn * SCALE;
  const wallH          = ceilingH * SCALE;   // canvas spans full ceiling height — no sysH cap
  const SYSTEM_TOP_Y   = PAD_TOP;            // ceiling is the top of the canvas
  const svgW           = wallW + H_PAD * 2 + 16;
  const svgH           = SYSTEM_TOP_Y + wallH + PAD_BOT;
  const sysX           = H_PAD + run.startIn * SCALE;
  const sysW           = (run.endIn - run.startIn) * SCALE;

  function toXIn(e: { clientX: number }): number {
    const r = svgRef.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / zoom - H_PAD) / SCALE;
  }

  function floorY(posIn: number): number {
    return SYSTEM_TOP_Y + wallH - posIn * SCALE;
  }

  const leftSelBorder  = selection?.kind === "left-end";
  const rightSelBorder = selection?.kind === "right-end";

  return (
    <svg ref={svgRef} width={svgW * zoom} height={svgH * zoom}
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{ display: "block", userSelect: "none", touchAction: "none" }}>

      {/* ── Height ruler — floor to ceiling ── */}
      <g pointerEvents="none">
        <line x1={H_PAD - 6} y1={PAD_TOP} x2={H_PAD - 6} y2={SYSTEM_TOP_Y + wallH}
          stroke="#ddd" strokeWidth={1} />
        {Array.from({ length: Math.floor(ceilingH / 12) + 1 }, (_, i) => {
          const hIn = i * 12;
          if (hIn > ceilingH) return null;
          const yPx     = floorY(hIn);
          const atSysH  = hIn === sysH;
          return (
            <g key={i}>
              <line x1={H_PAD - 10} y1={yPx} x2={H_PAD - 6} y2={yPx}
                stroke={atSysH ? "#c8a060" : "#ccc"} strokeWidth={atSysH ? 1.5 : 1} />
              {hIn !== ceilingH && (
                <text x={H_PAD - 13} y={yPx + 4} textAnchor="end" fontSize={9}
                  fill={atSysH ? "#c8a060" : "#aaa"} fontWeight={atSysH ? "700" : "400"}>
                  {hIn}"
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* ── Full wall background ── */}
      <rect x={H_PAD} y={SYSTEM_TOP_Y} width={wallW} height={wallH}
        fill={C_GAP} stroke={C_INT_BD} strokeWidth={1} />

      {/* ── Active system background (click-target for double-click handled by sections) ── */}
      <rect x={sysX} y={SYSTEM_TOP_Y} width={sysW} height={wallH}
        fill={C_INT} stroke="none" />

      {/* ── Corner clearance zones ── */}
      {wallCorners.map(cc => {
        const zonePx  = cc.cutbackIn * SCALE;
        const violated = cc.violated;
        const fill    = violated ? "#fee2e2" : "#fff7ed";
        const stroke  = violated ? "#dc2626" : "#f97316";
        const opacity = violated ? 0.75 : 0.6;
        if (cc.side === "left") {
          const xPx = H_PAD;
          const wPx = Math.min(zonePx, wallW);
          return (
            <g key={cc.cornerKey} pointerEvents="none">
              <rect x={xPx} y={SYSTEM_TOP_Y} width={wPx} height={wallH}
                fill={fill} opacity={opacity} />
              <line x1={xPx + wPx} y1={SYSTEM_TOP_Y} x2={xPx + wPx} y2={SYSTEM_TOP_Y + wallH}
                stroke={stroke} strokeWidth={1.5} strokeDasharray="5 3" />
              <text x={xPx + wPx / 2} y={SYSTEM_TOP_Y + wallH / 2}
                textAnchor="middle" fontSize={9} fill={stroke} fontWeight="700"
                transform={`rotate(-90,${xPx + wPx / 2},${SYSTEM_TOP_Y + wallH / 2})`}>
                {cc.cutbackIn}" clear · {cc.otherLabel} full
              </text>
            </g>
          );
        } else {
          const xPx = H_PAD + (wall.widthIn - cc.cutbackIn) * SCALE;
          const wPx = Math.min(zonePx, wallW);
          const clamped = Math.max(H_PAD, xPx);
          return (
            <g key={cc.cornerKey} pointerEvents="none">
              <rect x={clamped} y={SYSTEM_TOP_Y} width={H_PAD + wallW - clamped} height={wallH}
                fill={fill} opacity={opacity} />
              <line x1={clamped} y1={SYSTEM_TOP_Y} x2={clamped} y2={SYSTEM_TOP_Y + wallH}
                stroke={stroke} strokeWidth={1.5} strokeDasharray="5 3" />
              <text x={clamped + (H_PAD + wallW - clamped) / 2} y={SYSTEM_TOP_Y + wallH / 2}
                textAnchor="middle" fontSize={9} fill={stroke} fontWeight="700"
                transform={`rotate(-90,${clamped + (H_PAD + wallW - clamped) / 2},${SYSTEM_TOP_Y + wallH / 2})`}>
                {cc.cutbackIn}" clear · {cc.otherLabel} full
              </text>
            </g>
          );
        }
      })}

      {/* Wall total width label */}
      <text x={H_PAD + wallW / 2} y={SYSTEM_TOP_Y - 22}
        textAnchor="middle" fontSize={11} fill="#aaa" fontWeight="600">
        Wall: {wall.widthIn}"
      </text>
      {/* System span label */}
      <text x={sysX + sysW / 2} y={SYSTEM_TOP_Y - 10}
        textAnchor="middle" fontSize={11} fill={C_DIM} fontWeight="700">
        System: {(run.endIn - run.startIn).toFixed(1)}"
      </text>
      <line x1={sysX} y1={SYSTEM_TOP_Y - 5} x2={sysX + sysW} y2={SYSTEM_TOP_Y - 5}
        stroke="#bbb" strokeWidth={1} />
      <line x1={sysX}        y1={SYSTEM_TOP_Y - 8} x2={sysX}        y2={SYSTEM_TOP_Y - 2} stroke="#bbb" strokeWidth={1} />
      <line x1={sysX + sysW} y1={SYSTEM_TOP_Y - 8} x2={sysX + sysW} y2={SYSTEM_TOP_Y - 2} stroke="#bbb" strokeWidth={1} />

      {/* Gap labels */}
      {run.startIn > 0.5 && (
        <text x={H_PAD + (run.startIn * SCALE) / 2} y={SYSTEM_TOP_Y + wallH / 2}
          textAnchor="middle" fontSize={10} fill="#aaa" transform={`rotate(-90, ${H_PAD + (run.startIn * SCALE) / 2}, ${SYSTEM_TOP_Y + wallH / 2})`}>
          {run.startIn.toFixed(1)}" gap
        </text>
      )}
      {wall.widthIn - run.endIn > 0.5 && (
        <text
          x={H_PAD + run.endIn * SCALE + (wall.widthIn - run.endIn) * SCALE / 2}
          y={SYSTEM_TOP_Y + wallH / 2}
          textAnchor="middle" fontSize={10} fill="#aaa"
          transform={`rotate(-90, ${H_PAD + run.endIn * SCALE + (wall.widthIn - run.endIn) * SCALE / 2}, ${SYSTEM_TOP_Y + wallH / 2})`}>
          {(wall.widthIn - run.endIn).toFixed(1)}" gap
        </text>
      )}

      {/* ── Sections ── */}
      {run.sections.map((sec, si) => {
        const lxIn  = secLeft(run.panels, run.startIn, si);
        const sw    = secWidth(run.panels, run.startIn, run.endIn, si);
        const xPx   = H_PAD + lxIn * SCALE;
        const wPx   = sw * SCALE;
        const isSel = selection?.kind === "section" && selection.secId === sec.id;

        const effH   = sectionEffH(run, si, sysH);
        const effHPx = effH * SCALE;
        const topY   = SYSTEM_TOP_Y + wallH - effHPx;   // top of this section's usable space

        return (
          <g key={sec.id}>
            {/* ① Click target — FIRST (lowest z) */}
            <rect x={xPx} y={SYSTEM_TOP_Y} width={wPx} height={wallH}
              fill="transparent" stroke="none" style={{ cursor: "pointer" }}
              onClick={e => { e.stopPropagation(); onSelect({ kind: "section", secId: sec.id }); }}
              onDoubleClick={e => { e.stopPropagation(); onAddPanelAt(toXIn(e)); }}
            />

            {isSel && <>
              <rect x={xPx} y={SYSTEM_TOP_Y} width={wPx} height={wallH}
                fill={C_SELECT} opacity={0.07} pointerEvents="none" />
              <rect x={xPx} y={SYSTEM_TOP_Y} width={wPx} height={wallH}
                fill="none" stroke={C_SELECT} strokeWidth={1.5} pointerEvents="none" />
            </>}

            {/* Width label */}
            <text x={xPx + wPx / 2} y={SYSTEM_TOP_Y + wallH + 20}
              textAnchor="middle" fontSize={10}
              fill={isSel ? C_SELECT : C_DIM} fontWeight={isSel ? "700" : "400"}>
              {sw.toFixed(1)}"
            </text>

            {/* Lock shelves — positioned at effective height boundaries */}
            <rect x={xPx} y={topY} width={wPx} height={LOCK_H_PX}
              fill={C_LOCK} stroke={C_LOCK_BD} strokeWidth={0.5} opacity={0.8} pointerEvents="none" />
            <rect x={xPx} y={SYSTEM_TOP_Y + wallH - LOCK_H_PX} width={wPx} height={LOCK_H_PX}
              fill={C_LOCK} stroke={C_LOCK_BD} strokeWidth={0.5} opacity={0.8} pointerEvents="none" />

            {/* ② Components — AFTER click target (higher z) */}
            {sec.comps.map(comp => {
              const isSC = selection?.kind === "comp" && selection.compId === comp.id;
              const cH   = compHeight(comp);
              const cYPx = floorY(comp.positionIn + cH);

              const startDrag = (e: React.PointerEvent) => {
                e.preventDefault(); e.stopPropagation();
                onSelect({ kind: "comp", secId: sec.id, compId: comp.id });
                onDragStart({ kind: "comp", wallId: run.wallId, secId: sec.id, compId: comp.id,
                  startY: e.clientY, startPosIn: comp.positionIn }, e);
              };
              const selectOnly = (e: React.PointerEvent) => {
                e.stopPropagation();
                onSelect({ kind: "comp", secId: sec.id, compId: comp.id });
              };
              const isLocked = (comp.type === "Shelf" || comp.type === "Rod") && sw >= LOCK_SPAN_MIN;

              if (comp.type === "Shelf") return (
                <g key={comp.id}
                  style={{ cursor: isLocked ? "default" : "ns-resize" }}
                  onPointerDown={isLocked ? selectOnly : startDrag}>
                  {!isLocked && (
                    <rect x={xPx} y={cYPx + 2} width={wPx} height={SCALE + 2}
                      fill="#c0a070" opacity={0.2} rx={1} />
                  )}
                  {/* Shelf spans full section width — consistent appearance at all widths */}
                  <rect x={xPx} y={cYPx} width={wPx} height={SCALE}
                    fill={isSC ? "#e8d5b8" : C_SHELF}
                    stroke={isSC ? C_SELECT : C_SHELF_BD}
                    strokeWidth={isSC ? 2 : 1}
                    rx={0} />
                  <line x1={xPx} y1={cYPx + 1} x2={xPx + wPx} y2={cYPx + 1}
                    stroke="#fff" strokeWidth={1} opacity={0.4} pointerEvents="none" />
                  {/* Shelf pin marks at each panel face */}
                  <rect x={xPx} y={cYPx - 3} width={3} height={SCALE + 6}
                    fill={isSC ? C_SELECT : C_PANEL_BD} opacity={0.5} pointerEvents="none" />
                  <rect x={xPx + wPx - 3} y={cYPx - 3} width={3} height={SCALE + 6}
                    fill={isSC ? C_SELECT : C_PANEL_BD} opacity={0.5} pointerEvents="none" />
                </g>
              );

              if (comp.type === "Rod") return (
                <g key={comp.id}
                  style={{ cursor: isLocked ? "default" : "ns-resize" }}
                  onPointerDown={isLocked ? selectOnly : startDrag}>
                  <rect x={xPx} y={cYPx} width={wPx} height={SCALE} fill="transparent" />
                  {/* Rod — consistent appearance at all widths */}
                  <RodWithHangers xPx={xPx} wPx={wPx} cYPx={cYPx}
                    wallH={wallH} padTop={SYSTEM_TOP_Y} lockH={LOCK_H_PX} selected={isSC} />
                </g>
              );

              if (comp.type === "DrawerStack") {
                // Visual warning tint if near limit
                const top = comp.positionIn + cH;
                const atLimit = top >= DRAWER_MAX_TOP - 1;
                let dyAcc = 0;
                return (
                  <g key={comp.id} style={{ cursor: "ns-resize" }} onPointerDown={startDrag}>
                    {atLimit && (
                      <rect x={xPx + 2} y={cYPx} width={wPx - 4} height={2}
                        fill="#e05050" opacity={0.6} pointerEvents="none" />
                    )}
                    {comp.drawerHeights.map((dh, di) => {
                      const dyPx = cYPx + dyAcc;
                      dyAcc += dh * SCALE;
                      return (
                        <DrawerFace key={di}
                          x={xPx} y={dyPx} w={wPx} h={dh * SCALE} selected={isSC} />
                      );
                    })}
                  </g>
                );
              }
              return null;
            })}
          </g>
        );
      })}

      {/* ── Obstacles (wall-absolute, above components, below panels) ── */}
      {obstacles.map(obs => {
        const isSel = selection?.kind === "obstacle" && selection.obsId === obs.id;
        const xPx   = H_PAD + obs.xIn * SCALE;
        const yPx   = floorY(obs.yIn + obs.hIn);   // floorY already uses SYSTEM_TOP_Y
        const wPx   = obs.wIn * SCALE;
        const hPx   = obs.hIn * SCALE;
        const fill  = OBS_FILL[obs.type];
        const stroke= isSel ? C_SELECT : OBS_STROKE[obs.type];
        const lbl   = OBS_LABEL[obs.type];
        return (
          <g key={obs.id} style={{ cursor: "move" }}
            onClick={e => { e.stopPropagation(); onSelect({ kind: "obstacle", obsId: obs.id }); }}
            onPointerDown={e => {
              e.preventDefault(); e.stopPropagation();
              onSelect({ kind: "obstacle", obsId: obs.id });
              onDragStart({
                kind: "obstacle", wallId: run.wallId, obsId: obs.id,
                startX: e.clientX, startY: e.clientY,
                startXIn: obs.xIn, startYIn: obs.yIn,
              }, e);
            }}>
            <rect x={xPx} y={yPx} width={wPx} height={hPx}
              fill={fill} stroke={stroke} strokeWidth={isSel ? 2 : 1.5}
              strokeDasharray={isSel ? "none" : "4 2"} rx={2} opacity={0.85} />
            {isSel && <rect x={xPx} y={yPx} width={wPx} height={hPx}
              fill={C_SELECT} opacity={0.12} rx={2} pointerEvents="none" />}
            <text x={xPx + wPx / 2} y={yPx + hPx / 2 + 4}
              textAnchor="middle" fontSize={Math.min(10, hPx * 0.4)}
              fill={isSel ? C_SELECT : OBS_STROKE[obs.type]}
              fontWeight="700" pointerEvents="none">
              {lbl}
            </text>
          </g>
        );
      })}

      {/* ── Interior panels ── */}
      {run.panels.map((panel, pi) => {
        const xPx    = H_PAD + panel.xIn * SCALE;
        const isSel  = selection?.kind === "panel" && selection.panelId === panel.id;
        const pH      = panelH(panel, sysH);
        const pHPx    = pH * SCALE;
        const panTopY = SYSTEM_TOP_Y + wallH - pHPx;
        const isCustomH = panel.heightIn !== undefined;   // any explicit override — shorter OR taller
        return (
          <g key={panel.id}>
            <rect x={xPx} y={panTopY} width={PANEL_W_PX} height={pHPx}
              fill={isSel ? C_SELECT : C_PANEL}
              stroke={isSel ? "#1a5ccc" : C_PANEL_BD} strokeWidth={1}
              style={{ cursor: "ew-resize" }}
              onClick={e => { e.stopPropagation(); onSelect({ kind: "panel", panelId: panel.id }); }}
              onPointerDown={e => {
                e.preventDefault(); e.stopPropagation();
                onSelect({ kind: "panel", panelId: panel.id });
                onDragStart({ kind: "panel", wallId: run.wallId, panelIdx: pi,
                  startX: e.clientX, startXIn: panel.xIn }, e);
              }}
            />
            {/* Height drag handle — tab at panel top */}
            <rect x={xPx - 4} y={panTopY - 7} width={PANEL_W_PX + 8} height={14}
              fill={isSel ? C_SELECT : (isCustomH ? "#d4a050" : C_PANEL)}
              stroke={isSel ? "#1a5ccc" : C_PANEL_BD} strokeWidth={1}
              rx={3} style={{ cursor: "ns-resize" }}
              onClick={e => { e.stopPropagation(); onSelect({ kind: "panel", panelId: panel.id }); }}
              onPointerDown={e => {
                e.preventDefault(); e.stopPropagation();
                onSelect({ kind: "panel", panelId: panel.id });
                onDragStart({ kind: "panel-height", wallId: run.wallId, panelIdx: pi,
                  startY: e.clientY, startHeightIn: pH }, e);
              }}
            />
            <text x={xPx + PANEL_W_PX / 2} y={SYSTEM_TOP_Y - 7}
              textAnchor="middle" fontSize={9} fill={isSel ? C_SELECT : "#aaa"}>
              {panel.xIn.toFixed(1)}"
            </text>
            {isCustomH && (
              <text x={xPx + PANEL_W_PX / 2} y={panTopY - 12}
                textAnchor="middle" fontSize={8} fill="#d4a050" fontWeight="700">
                {pH}"
              </text>
            )}
          </g>
        );
      })}

      {/* ── End panels — LAST (highest z), draggable ── */}
      {/* Left end panel */}
      {(() => {
        const lpH      = run.leftPanelHeightIn ?? sysH;
        const lpHPx    = lpH * SCALE;
        const lpTopY   = SYSTEM_TOP_Y + wallH - lpHPx;
        const lpCustom = run.leftPanelHeightIn !== undefined;
        return (
          <g>
            <rect x={sysX} y={lpTopY} width={PANEL_W_PX} height={lpHPx}
              fill={leftSelBorder ? C_SELECT : C_ENDPANEL}
              stroke={leftSelBorder ? "#1a5ccc" : C_PANEL_BD} strokeWidth={1.5}
              style={{ cursor: "ew-resize" }}
              onClick={e => { e.stopPropagation(); onSelect({ kind: "left-end" }); }}
              onPointerDown={e => {
                e.preventDefault(); e.stopPropagation();
                onSelect({ kind: "left-end" });
                onDragStart({ kind: "left-end", wallId: run.wallId, startX: e.clientX, startIn: run.startIn }, e);
              }}
            />
            {/* Height drag handle */}
            <rect x={sysX - 4} y={lpTopY - 7} width={PANEL_W_PX + 8} height={14}
              fill={leftSelBorder ? C_SELECT : (lpCustom ? "#d4a050" : C_ENDPANEL)}
              stroke={leftSelBorder ? "#1a5ccc" : C_PANEL_BD} strokeWidth={1}
              rx={3} style={{ cursor: "ns-resize" }}
              onClick={e => { e.stopPropagation(); onSelect({ kind: "left-end" }); }}
              onPointerDown={e => {
                e.preventDefault(); e.stopPropagation();
                onSelect({ kind: "left-end" });
                onDragStart({ kind: "left-end-height", wallId: run.wallId,
                  startY: e.clientY, startHeightIn: lpH }, e);
              }}
            />
            <line x1={sysX + 1} y1={lpTopY + 4} x2={sysX + 1} y2={SYSTEM_TOP_Y + wallH - 4}
              stroke="#fff" strokeWidth={1} opacity={0.25} pointerEvents="none" />
            {lpCustom && (
              <text x={sysX + PANEL_W_PX / 2} y={lpTopY - 12}
                textAnchor="middle" fontSize={8} fill="#d4a050" fontWeight="700" pointerEvents="none">
                {lpH}"
              </text>
            )}
          </g>
        );
      })()}

      {/* Right end panel */}
      {(() => {
        const rpH      = run.rightPanelHeightIn ?? sysH;
        const rpHPx    = rpH * SCALE;
        const rpTopY   = SYSTEM_TOP_Y + wallH - rpHPx;
        const rpX      = H_PAD + (run.endIn - PANEL_W_IN) * SCALE;
        const rpCustom = run.rightPanelHeightIn !== undefined;
        return (
          <g>
            <rect x={rpX} y={rpTopY} width={PANEL_W_PX} height={rpHPx}
              fill={rightSelBorder ? C_SELECT : C_ENDPANEL}
              stroke={rightSelBorder ? "#1a5ccc" : C_PANEL_BD} strokeWidth={1.5}
              style={{ cursor: "ew-resize" }}
              onClick={e => { e.stopPropagation(); onSelect({ kind: "right-end" }); }}
              onPointerDown={e => {
                e.preventDefault(); e.stopPropagation();
                onSelect({ kind: "right-end" });
                onDragStart({ kind: "right-end", wallId: run.wallId, startX: e.clientX, endIn: run.endIn }, e);
              }}
            />
            {/* Height drag handle */}
            <rect x={rpX - 4} y={rpTopY - 7} width={PANEL_W_PX + 8} height={14}
              fill={rightSelBorder ? C_SELECT : (rpCustom ? "#d4a050" : C_ENDPANEL)}
              stroke={rightSelBorder ? "#1a5ccc" : C_PANEL_BD} strokeWidth={1}
              rx={3} style={{ cursor: "ns-resize" }}
              onClick={e => { e.stopPropagation(); onSelect({ kind: "right-end" }); }}
              onPointerDown={e => {
                e.preventDefault(); e.stopPropagation();
                onSelect({ kind: "right-end" });
                onDragStart({ kind: "right-end-height", wallId: run.wallId,
                  startY: e.clientY, startHeightIn: rpH }, e);
              }}
            />
            <line x1={rpX + 1} y1={rpTopY + 4} x2={rpX + 1} y2={SYSTEM_TOP_Y + wallH - 4}
              stroke="#fff" strokeWidth={1} opacity={0.25} pointerEvents="none" />
            {rpCustom && (
              <text x={rpX + PANEL_W_PX / 2} y={rpTopY - 12}
                textAnchor="middle" fontSize={8} fill="#d4a050" fontWeight="700" pointerEvents="none">
                {rpH}"
              </text>
            )}
          </g>
        );
      })()}

      {/* Bottom floor rail (structural, non-interactive) */}
      <g pointerEvents="none">
        <rect x={sysX} y={SYSTEM_TOP_Y + wallH - LOCK_H_PX} width={sysW} height={LOCK_H_PX}
          fill={C_LOCK} stroke={C_LOCK_BD} strokeWidth={0.5} opacity={0.35} />
      </g>

      {/* ── Above-ceiling zone — drawn last so it covers all wall content ── */}
      {(() => {
        const runW    = run.endIn - run.startIn;
        const profile: CeilingProfile = run.ceilingProfile ?? { type: "flat", heightIn: ceilingH };
        const pts     = ceilingProfilePts(runW, profile);
        // SVG coordinates for each ceiling boundary point
        const svgPts  = pts.map(([xIn, hIn]) => [sysX + xIn * SCALE, floorY(hIn)] as [number, number]);
        // Filled polygon: canvas top-left → canvas top-right → ceiling R-to-L → close
        const fillPoly = [
          [sysX,        SYSTEM_TOP_Y] as [number, number],
          [sysX + sysW, SYSTEM_TOP_Y] as [number, number],
          ...svgPts.slice().reverse(),
        ].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
        const linePts = svgPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

        return (
          <g pointerEvents="none">
            {/* Solid fill above-ceiling zone — covers everything below */}
            <polygon points={fillPoly} fill="#ddd8d0" />
            {/* Ceiling boundary line */}
            <polyline points={linePts} fill="none"
              stroke="#6baed6" strokeWidth={1.5} strokeDasharray="6 4" />
            {/* Height labels at profile key points */}
            {pts.map(([xIn, hIn], i) => {
              const sx      = sysX + xIn * SCALE;
              const sy      = floorY(hIn);
              const isFirst = i === 0;
              const prevH   = i > 0 ? pts[i - 1][1] : null;
              if (prevH !== null && Math.abs(prevH - hIn) < 0.5 && xIn > 0) return null;
              return (
                <g key={i}>
                  <line x1={sx - 4} y1={sy} x2={sx + 4} y2={sy}
                    stroke="#6baed6" strokeWidth={1} />
                  <text
                    x={isFirst ? H_PAD - 13 : sx + 5}
                    y={sy + 4}
                    textAnchor={isFirst ? "end" : "start"}
                    fontSize={9} fill="#6baed6" fontWeight="700">
                    {Math.round(hIn)}"
                  </text>
                </g>
              );
            })}
            {/* Profile type badge */}
            {profile.type !== "flat" && (
              <text x={sysX + sysW / 2} y={SYSTEM_TOP_Y - 6}
                textAnchor="middle" fontSize={8} fill="#6baed6" fontWeight="700">
                {profile.type === "slope" ? "Sloped ceiling" : "Flat + slope ceiling"}
              </text>
            )}
          </g>
        );
      })()}
    </svg>
  );
}

// ─── Inspector ────────────────────────────────────────────────────────────────

function Inspector({
  selection, run, wall, sysH, ceilingH,
  onUpdateSection, onAddComp, onUpdateComp, onDeleteComp,
  onRemovePanel, onUpdatePanel, onUpdateEndPanel, onSetPanelDepth, onAddPanel, onClearSel,
  onUpdateObstacle, onDeleteObstacle, onAddObstacle,
  onUpdateCeilingProfile,
}: {
  selection:        Selection;
  run:              WallRun | null;
  wall:             DesignWall | null;
  sysH:             number;
  ceilingH:         number;
  onUpdateSection:    (secId: number, u: Partial<Section>) => void;
  onAddComp:          (secId: number, type: CompType) => void;
  onUpdateComp:       (secId: number, compId: number, u: Partial<ClosetComp>) => void;
  onDeleteComp:       (secId: number, compId: number) => void;
  onRemovePanel:      (panelId: number) => void;
  onUpdatePanel:      (panelId: number, u: Partial<Panel>) => void;
  onUpdateEndPanel:   (side: "left" | "right", heightIn: number | undefined) => void;
  onSetPanelDepth:    (leftSecId: number, rightSecId: number, depth: number) => void;
  onAddPanel:         (secId: number) => void;
  onClearSel:         () => void;
  onUpdateObstacle:   (obsId: number, u: Partial<Obstacle>) => void;
  onDeleteObstacle:   (obsId: number) => void;
  onAddObstacle:      (type: ObstacleType) => void;
  onUpdateCeilingProfile: (p: CeilingProfile | undefined) => void;
}) {
  const inp: React.CSSProperties = {
    padding: "5px 8px", fontSize: "13px", border: "1px solid #c8c4be",
    borderRadius: "5px", backgroundColor: "#fff", color: "#111", width: "80px",
  };
  const lbl: React.CSSProperties = {
    fontSize: "11px", color: "#888", fontWeight: "600", display: "block", marginBottom: "3px",
  };
  const metric = (v: string | number, unit = '"') => (
    <span style={{ fontSize: "20px", fontWeight: "700", color: "#333" }}>
      {v}<span style={{ fontSize: "12px", color: "#aaa", marginLeft: "2px" }}>{unit}</span>
    </span>
  );
  const closeX = (
    <button onClick={onClearSel}
      style={{ background: "none", border: "none", fontSize: "18px", color: "#bbb", cursor: "pointer", lineHeight: 1 }}>
      ×
    </button>
  );
  function rowBtn(danger = false): React.CSSProperties {
    return {
      padding: "6px 12px", fontSize: "12px", fontWeight: "700", cursor: "pointer",
      borderRadius: "6px", border: `1.5px solid ${danger ? "#e08070" : "#c8c4be"}`,
      backgroundColor: "#fff", color: danger ? "#c0392b" : "#444",
    };
  }
  function primBtn(): React.CSSProperties {
    return {
      padding: "7px 14px", fontSize: "12px", fontWeight: "700", cursor: "pointer",
      borderRadius: "6px", border: "none", backgroundColor: "#1a1a1a", color: "#fff",
    };
  }

  if (!run || !wall) {
    return (
      <div style={{ padding: "18px 16px", color: "#aaa", fontSize: "13px", lineHeight: 1.7 }}>
        <div style={{ marginBottom: "10px", color: "#888", fontWeight: "600", fontSize: "12px" }}>How to use</div>
        <p style={{ margin: "0 0 8px" }}><span style={{ color: "#555" }}>Click a section</span> to add components.</p>
        <p style={{ margin: "0 0 8px" }}><span style={{ color: "#555" }}>Double-click a section</span> to split it with a panel.</p>
        <p style={{ margin: "0 0 8px" }}><span style={{ color: "#555" }}>Drag any panel</span> (including end panels) to resize.</p>
        <p style={{ margin: "0" }}><span style={{ color: "#555" }}>Drag end panels</span> to create gaps on either side.</p>
      </div>
    );
  }

  if (!selection) {
    // ── Wall Settings (ceiling profile) ──────────────────────────────────────
    const runW    = run.endIn - run.startIn;
    const profile: CeilingProfile = run.ceilingProfile ?? { type: "flat", heightIn: ceilingH };
    const selSty: React.CSSProperties = {
      padding: "5px 8px", fontSize: "12px", border: "1px solid #c8c4be",
      borderRadius: "5px", backgroundColor: "#fff", color: "#111", width: "100%",
    };
    const numSty: React.CSSProperties = {
      ...inp, width: "70px",
    };

    function switchProfileType(t: string) {
      if (t === "flat") {
        onUpdateCeilingProfile({ type: "flat", heightIn: Math.round(ceilingAtX(0, runW, profile)) });
      } else if (t === "slope") {
        onUpdateCeilingProfile({
          type: "slope",
          leftHeightIn:  Math.round(ceilingAtX(0, runW, profile)),
          rightHeightIn: Math.round(ceilingAtX(runW, runW, profile)),
        });
      } else {
        const flatH = Math.round(ceilingAtX(0, runW, profile));
        onUpdateCeilingProfile({
          type: "flat_then_slope",
          flatLengthIn: Math.round(runW / 2),
          flatHeightIn: flatH,
          endHeightIn:  Math.max(24, flatH - 12),
        });
      }
    }

    return (
      <div style={{ padding: "16px" }}>
        {/* ── Ceiling Profile ── */}
        <div style={{ marginBottom: "18px", paddingBottom: "16px", borderBottom: "1px solid #f0ece4" }}>
          <div style={{ fontSize: "11px", fontWeight: "700", color: "#888",
            textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
            Ceiling Profile
          </div>

          {/* Type picker */}
          <div style={{ marginBottom: "10px" }}>
            <span style={lbl}>Type</span>
            <select value={profile.type} style={selSty}
              onChange={e => switchProfileType(e.target.value)}>
              <option value="flat">Flat</option>
              <option value="slope">Sloped (start → end)</option>
              <option value="flat_then_slope">Flat, then slope</option>
            </select>
          </div>

          {/* Flat inputs */}
          {profile.type === "flat" && (
            <div>
              <span style={lbl}>Height (in)</span>
              <input type="number" style={numSty} min={24} step={1}
                value={profile.heightIn}
                onChange={e => onUpdateCeilingProfile({ type: "flat", heightIn: Math.max(24, Number(e.target.value)) })} />
            </div>
          )}

          {/* Slope inputs */}
          {profile.type === "slope" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div>
                <span style={lbl}>Left height (in)</span>
                <input type="number" style={numSty} min={24} step={1}
                  value={profile.leftHeightIn}
                  onChange={e => onUpdateCeilingProfile({
                    ...profile, leftHeightIn: Math.max(24, Number(e.target.value)),
                  })} />
              </div>
              <div>
                <span style={lbl}>Right height (in)</span>
                <input type="number" style={numSty} min={24} step={1}
                  value={profile.rightHeightIn}
                  onChange={e => onUpdateCeilingProfile({
                    ...profile, rightHeightIn: Math.max(24, Number(e.target.value)),
                  })} />
              </div>
            </div>
          )}

          {/* Flat then slope inputs */}
          {profile.type === "flat_then_slope" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div>
                  <span style={lbl}>Flat height (in)</span>
                  <input type="number" style={numSty} min={24} step={1}
                    value={profile.flatHeightIn}
                    onChange={e => onUpdateCeilingProfile({
                      ...profile, flatHeightIn: Math.max(24, Number(e.target.value)),
                    })} />
                </div>
                <div>
                  <span style={lbl}>End height (in)</span>
                  <input type="number" style={numSty} min={24} step={1}
                    value={profile.endHeightIn}
                    onChange={e => onUpdateCeilingProfile({
                      ...profile, endHeightIn: Math.max(24, Number(e.target.value)),
                    })} />
                </div>
              </div>
              <div>
                <span style={lbl}>Flat section length (in) — out of {Math.round(runW)}"</span>
                <input type="number" style={numSty} min={1} max={Math.floor(runW) - 1} step={1}
                  value={profile.flatLengthIn}
                  onChange={e => onUpdateCeilingProfile({
                    ...profile,
                    flatLengthIn: Math.max(1, Math.min(Math.floor(runW) - 1, Number(e.target.value))),
                  })} />
              </div>
            </div>
          )}

          {/* Reset button if using a custom profile */}
          {run.ceilingProfile && (
            <button style={{ marginTop: "10px", ...rowBtn(), fontSize: "11px" }}
              onClick={() => onUpdateCeilingProfile(undefined)}>
              Reset to global flat ({ceilingH}")
            </button>
          )}
        </div>

        {/* ── How to use ── */}
        <div style={{ fontSize: "11px", color: "#aaa", lineHeight: 1.7 }}>
          <div style={{ marginBottom: "8px", color: "#888", fontWeight: "600", fontSize: "11px" }}>How to use</div>
          <p style={{ margin: "0 0 6px" }}><span style={{ color: "#555" }}>Click a section</span> to add components.</p>
          <p style={{ margin: "0 0 6px" }}><span style={{ color: "#555" }}>Double-click a section</span> to split it with a panel.</p>
          <p style={{ margin: "0 0 6px" }}><span style={{ color: "#555" }}>Drag any panel</span> to resize adjacent sections.</p>
          <p style={{ margin: "0" }}><span style={{ color: "#555" }}>Drag end panels</span> to leave gaps at walls.</p>
        </div>
      </div>
    );
  }

  // ── Left end panel ─────────────────────────────────────────────────────────
  if (selection.kind === "left-end") {
    const lpMaxH    = runCeilingAt(run, run.startIn, ceilingH);
    const lpH       = Math.min(run.leftPanelHeightIn ?? sysH, lpMaxH);
    const lpOpenSpc = lpMaxH - lpH;
    const sec0      = run.sections[0];
    const lpHasD    = sec0?.comps.some(c => c.type === "DrawerStack") ?? false;
    const lpMinD    = lpHasD ? 16 : 12;
    const lpD       = sec0?.depthIn ?? 12;
    return (
      <div style={{ padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "8px", height: "28px", backgroundColor: C_ENDPANEL, borderRadius: "2px" }} />
            <span style={{ fontSize: "14px", fontWeight: "700" }}>Left End Panel</span>
          </div>
          {closeX}
        </div>

        {/* Height / Ceiling / Open Space */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "12px" }}>
          <div style={{ padding: "8px 10px", backgroundColor: "#faf8f5", borderRadius: "6px", border: "1px solid #e8e4de" }}>
            <span style={lbl}>Panel height</span>
            <input type="number" style={{ ...inp, width: "50px", fontSize: "13px", fontWeight: "700" }}
              min={24} max={lpMaxH} step={1} value={lpH}
              onChange={e => {
                const v = Math.max(24, Math.min(lpMaxH, Number(e.target.value)));
                onUpdateEndPanel("left", v);
              }} />
            <div style={{ fontSize: "10px", color: "#aaa" }}>inches</div>
          </div>
          <div style={{ padding: "8px 10px", backgroundColor: "#f0f7ff", borderRadius: "6px", border: "1px solid #c8dcf0" }}>
            <span style={lbl}>Ceiling</span>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#2563eb" }}>{Math.round(lpMaxH)}"</div>
          </div>
          <div style={{ padding: "8px 10px", backgroundColor: lpOpenSpc > 0 ? "#f8fdf8" : "#faf8f5",
            borderRadius: "6px", border: `1px solid ${lpOpenSpc > 0 ? "#b6ddb6" : "#e8e4de"}` }}>
            <span style={lbl}>Open above</span>
            <div style={{ fontSize: "16px", fontWeight: "700", color: lpOpenSpc > 0 ? "#166534" : "#aaa" }}>
              {Math.round(lpOpenSpc)}"
            </div>
          </div>
        </div>

        <div style={{ padding: "8px 10px", backgroundColor: "#faf8f5", borderRadius: "6px", border: "1px solid #e8e4de", marginBottom: "12px" }}>
          <span style={lbl}>Left gap from wall</span>
          {metric(run.startIn.toFixed(1))}
        </div>

        <div style={{ padding: "10px 12px", backgroundColor: lpHasD ? "#fffbf0" : "#faf8f5",
          borderRadius: "6px", border: `1px solid ${lpHasD ? "#e8c870" : "#e8e4de"}`, marginBottom: "14px" }}>
          <span style={lbl}>Depth (sets §1)</span>
          <input type="number" style={{ ...inp, width: "58px", fontSize: "14px", fontWeight: "700" }}
            min={lpMinD} step={1} value={lpD}
            onChange={e => {
              if (sec0) onUpdateSection(sec0.id, { depthIn: Math.max(lpMinD, Number(e.target.value)) });
            }} />
          <div style={{ fontSize: "10px", color: lpHasD ? "#b08020" : "#aaa" }}>
            {lpHasD ? `min 16" (drawers)` : `min 12"`}
          </div>
        </div>
        <p style={{ fontSize: "11px", color: "#aaa", margin: "0" }}>
          Drag left end panel ↔ to set gap · drag top handle ↕ to set height.
        </p>
      </div>
    );
  }

  // ── Right end panel ────────────────────────────────────────────────────────
  if (selection.kind === "right-end") {
    const rightGap   = wall.widthIn - run.endIn;
    const rpMaxH     = runCeilingAt(run, run.endIn - PANEL_W_IN, ceilingH);
    const rpH        = Math.min(run.rightPanelHeightIn ?? sysH, rpMaxH);
    const rpOpenSpc  = rpMaxH - rpH;
    const secN       = run.sections[run.sections.length - 1];
    const rpHasD     = secN?.comps.some(c => c.type === "DrawerStack") ?? false;
    const rpMinD     = rpHasD ? 16 : 12;
    const rpD        = secN?.depthIn ?? 12;
    return (
      <div style={{ padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "8px", height: "28px", backgroundColor: C_ENDPANEL, borderRadius: "2px" }} />
            <span style={{ fontSize: "14px", fontWeight: "700" }}>Right End Panel</span>
          </div>
          {closeX}
        </div>

        {/* Height / Ceiling / Open Space */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "12px" }}>
          <div style={{ padding: "8px 10px", backgroundColor: "#faf8f5", borderRadius: "6px", border: "1px solid #e8e4de" }}>
            <span style={lbl}>Panel height</span>
            <input type="number" style={{ ...inp, width: "50px", fontSize: "13px", fontWeight: "700" }}
              min={24} max={rpMaxH} step={1} value={rpH}
              onChange={e => {
                const v = Math.max(24, Math.min(rpMaxH, Number(e.target.value)));
                onUpdateEndPanel("right", v);
              }} />
            <div style={{ fontSize: "10px", color: "#aaa" }}>inches</div>
          </div>
          <div style={{ padding: "8px 10px", backgroundColor: "#f0f7ff", borderRadius: "6px", border: "1px solid #c8dcf0" }}>
            <span style={lbl}>Ceiling</span>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#2563eb" }}>{Math.round(rpMaxH)}"</div>
          </div>
          <div style={{ padding: "8px 10px", backgroundColor: rpOpenSpc > 0 ? "#f8fdf8" : "#faf8f5",
            borderRadius: "6px", border: `1px solid ${rpOpenSpc > 0 ? "#b6ddb6" : "#e8e4de"}` }}>
            <span style={lbl}>Open above</span>
            <div style={{ fontSize: "16px", fontWeight: "700", color: rpOpenSpc > 0 ? "#166534" : "#aaa" }}>
              {Math.round(rpOpenSpc)}"
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
          <div style={{ padding: "8px 10px", backgroundColor: "#faf8f5", borderRadius: "6px", border: "1px solid #e8e4de" }}>
            <span style={lbl}>System ends at</span>
            {metric(run.endIn.toFixed(1))}
          </div>
          <div style={{ padding: "8px 10px", backgroundColor: "#faf8f5", borderRadius: "6px", border: "1px solid #e8e4de" }}>
            <span style={lbl}>Right gap</span>
            {metric(rightGap.toFixed(1))}
          </div>
        </div>

        <div style={{ padding: "10px 12px", backgroundColor: rpHasD ? "#fffbf0" : "#faf8f5",
          borderRadius: "6px", border: `1px solid ${rpHasD ? "#e8c870" : "#e8e4de"}`, marginBottom: "14px" }}>
          <span style={lbl}>Depth (sets last §)</span>
          <input type="number" style={{ ...inp, width: "58px", fontSize: "14px", fontWeight: "700" }}
            min={rpMinD} step={1} value={rpD}
            onChange={e => {
              if (secN) onUpdateSection(secN.id, { depthIn: Math.max(rpMinD, Number(e.target.value)) });
            }} />
          <div style={{ fontSize: "10px", color: rpHasD ? "#b08020" : "#aaa" }}>
            {rpHasD ? `min 16" (drawers)` : `min 12"`}
          </div>
        </div>
        <p style={{ fontSize: "11px", color: "#aaa", margin: "0" }}>
          Drag right end panel ↔ to set gap · drag top handle ↕ to set height.
        </p>
      </div>
    );
  }

  // ── Interior panel ─────────────────────────────────────────────────────────
  if (selection.kind === "panel") {
    const panel    = run.panels.find(p => p.id === selection.panelId);
    if (!panel) return null;
    const pi       = run.panels.findIndex(p => p.id === selection.panelId);
    const pMaxH    = runCeilingAt(run, panel.xIn, ceilingH);
    const pH       = Math.min(panelH(panel, sysH), pMaxH);
    const pOpenSpc = pMaxH - pH;
    const leftSec  = run.sections[pi];
    const rightSec = run.sections[pi + 1];
    const leftHasD = leftSec?.comps.some(c => c.type === "DrawerStack") ?? false;
    const rightHasD= rightSec?.comps.some(c => c.type === "DrawerStack") ?? false;
    const pMinD    = (leftHasD || rightHasD) ? 16 : 12;
    const pD       = Math.max(leftSec?.depthIn ?? 12, rightSec?.depthIn ?? 12);
    return (
      <div style={{ padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "8px", height: "28px", backgroundColor: C_PANEL, borderRadius: "2px" }} />
            <span style={{ fontSize: "14px", fontWeight: "700" }}>Panel</span>
          </div>
          {closeX}
        </div>

        {/* Height / Ceiling / Open Space */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "12px" }}>
          <div style={{ padding: "8px 10px", backgroundColor: "#faf8f5", borderRadius: "6px", border: "1px solid #e8e4de" }}>
            <span style={lbl}>Panel height</span>
            <input type="number" style={{ ...inp, width: "50px", fontSize: "13px", fontWeight: "700" }}
              min={24} max={pMaxH} step={1} value={pH}
              onChange={e => {
                const v = Math.max(24, Math.min(pMaxH, Number(e.target.value)));
                onUpdatePanel(panel.id, { heightIn: v });
              }} />
            <div style={{ fontSize: "10px", color: "#aaa" }}>inches</div>
          </div>
          <div style={{ padding: "8px 10px", backgroundColor: "#f0f7ff", borderRadius: "6px", border: "1px solid #c8dcf0" }}>
            <span style={lbl}>Ceiling</span>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#2563eb" }}>{Math.round(pMaxH)}"</div>
          </div>
          <div style={{ padding: "8px 10px", backgroundColor: pOpenSpc > 0 ? "#f8fdf8" : "#faf8f5",
            borderRadius: "6px", border: `1px solid ${pOpenSpc > 0 ? "#b6ddb6" : "#e8e4de"}` }}>
            <span style={lbl}>Open above</span>
            <div style={{ fontSize: "16px", fontWeight: "700", color: pOpenSpc > 0 ? "#166534" : "#aaa" }}>
              {Math.round(pOpenSpc)}"
            </div>
          </div>
        </div>

        <div style={{ padding: "8px 10px", backgroundColor: "#faf8f5", borderRadius: "6px", border: "1px solid #e8e4de", marginBottom: "12px" }}>
          <span style={lbl}>Position from wall left</span>
          {metric(panel.xIn.toFixed(1))}
        </div>

        <div style={{ padding: "10px 12px", backgroundColor: (leftHasD || rightHasD) ? "#fffbf0" : "#faf8f5",
          borderRadius: "6px", border: `1px solid ${(leftHasD || rightHasD) ? "#e8c870" : "#e8e4de"}`, marginBottom: "14px" }}>
          <span style={lbl}>Depth (sets both adjacent §)</span>
          <input type="number" style={{ ...inp, width: "58px", fontSize: "14px", fontWeight: "700" }}
            min={pMinD} step={1} value={pD}
            onChange={e => {
              const v = Math.max(pMinD, Number(e.target.value));
              if (leftSec && rightSec) onSetPanelDepth(leftSec.id, rightSec.id, v);
            }} />
          <div style={{ fontSize: "10px", color: (leftHasD || rightHasD) ? "#b08020" : "#aaa" }}>
            {(leftHasD || rightHasD) ? `min 16" (drawers on one side)` : `min 12"`}
          </div>
        </div>
        <p style={{ fontSize: "11px", color: "#aaa", margin: "0 0 14px" }}>
          Drag the panel ↔ to reposition · drag the top handle ↕ to set height.
        </p>
        <button style={{ ...rowBtn(true), width: "100%" }}
          onClick={() => { onRemovePanel(selection.panelId); onClearSel(); }}>
          Remove Panel
        </button>
      </div>
    );
  }

  // ── Section ────────────────────────────────────────────────────────────────
  if (selection.kind === "section") {
    const si    = run.sections.findIndex(s => s.id === selection.secId);
    const sec   = run.sections[si];
    if (!sec) return null;
    const sw    = secWidth(run.panels, run.startIn, run.endIn, si);
    const secEH = sectionEffH(run, si, sysH);
    const hasDrawers    = sec.comps.some(c => c.type === "DrawerStack");
    const drawerTooWide = hasDrawers && sw > DRAWER_MAX_W;
    const hasSpanComp   = sec.comps.some(c => c.type === "Shelf" || c.type === "Rod");
    const spanLocked    = hasSpanComp && sw >= LOCK_SPAN_MIN && sw <= MAX_SPAN_IN;
    const spanTooWide   = hasSpanComp && sw > MAX_SPAN_IN;

    return (
      <div style={{ padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <span style={{ fontSize: "14px", fontWeight: "700" }}>Section {si + 1}</span>
          {closeX}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
          <div style={{ padding: "8px 10px", backgroundColor: drawerTooWide ? "#fef2f2" : "#faf8f5",
            borderRadius: "6px", border: `1px solid ${drawerTooWide ? "#dc2626" : "#e8e4de"}` }}>
            <span style={lbl}>Width</span>
            <div style={{ fontSize: "16px", fontWeight: "700", color: drawerTooWide ? "#dc2626" : "#333" }}>{sw.toFixed(1)}"</div>
            <div style={{ fontSize: "10px", color: "#aaa" }}>set by panels</div>
          </div>
          {(() => {
            const minD = hasDrawers ? 16 : 12;
            return (
              <div style={{ padding: "8px 10px", backgroundColor: hasDrawers ? "#fffbf0" : "#faf8f5",
                borderRadius: "6px", border: `1px solid ${hasDrawers ? "#e8c870" : "#e8e4de"}` }}>
                <span style={lbl}>Depth</span>
                <input type="number" style={{ ...inp, width: "58px", fontSize: "14px", fontWeight: "700" }}
                  min={minD} step={1} value={sec.depthIn}
                  onChange={e => onUpdateSection(sec.id, { depthIn: Number(e.target.value) })} />
                <div style={{ fontSize: "10px", color: hasDrawers ? "#b08020" : "#aaa" }}>
                  {hasDrawers ? `min 16" (drawers)` : `min 12"`}
                </div>
              </div>
            );
          })()}
        </div>

        {drawerTooWide && (
          <div style={{ padding: "8px 10px", borderRadius: "6px", backgroundColor: "#fef2f2",
            border: "1.5px solid #dc2626", marginBottom: "10px", fontSize: "11px", color: "#991b1b", fontWeight: "600" }}>
            ⚠ {sw.toFixed(1)}" wide — drawers max {DRAWER_MAX_W}". Split section or remove drawers.
          </div>
        )}
        {spanLocked && (
          <div style={{ padding: "8px 10px", borderRadius: "6px", backgroundColor: "#fffbf0",
            border: "1px solid #d8c898", marginBottom: "10px", fontSize: "11px", color: "#806848" }}>
            Span {LOCK_SPAN_MIN}–{MAX_SPAN_IN}" — shelf/rod position is locked. Set height via component input.
          </div>
        )}
        {spanTooWide && (
          <div style={{ padding: "8px 10px", borderRadius: "6px", backgroundColor: "#fef2f2",
            border: "1.5px solid #dc2626", marginBottom: "10px", fontSize: "11px", color: "#991b1b", fontWeight: "600" }}>
            ⚠ Span {sw.toFixed(1)}" — shelf/rod not allowed over {MAX_SPAN_IN}". Split section or remove components.
          </div>
        )}

        <div style={{ marginBottom: "14px" }}>
          <button style={{ ...primBtn(), width: "100%", fontSize: "12px" }}
            onClick={() => onAddPanel(sec.id)}>
            ＋ Split Section (Add Panel at Midpoint)
          </button>
        </div>

        <div style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: "1px solid #f0ece4" }}>
          <p style={{ fontSize: "11px", fontWeight: "700", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 8px" }}>
            Add Component
          </p>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {(["Shelf", "Rod", "DrawerStack"] as CompType[]).map(type => {
              const blocked =
                ((type === "Shelf" || type === "Rod") && sw > MAX_SPAN_IN) ||
                (type === "DrawerStack" && sw > DRAWER_MAX_W);
              const blockReason =
                (type === "Shelf" || type === "Rod")
                  ? `Section must be ≤ ${MAX_SPAN_IN}" to add ${type}`
                  : `Drawers require section width of ${DRAWER_MAX_W}" or less`;
              return (
                <button key={type} disabled={blocked}
                  style={{ ...rowBtn(), opacity: blocked ? 0.4 : 1, cursor: blocked ? "not-allowed" : "pointer" }}
                  onClick={() => !blocked && onAddComp(sec.id, type)}
                  title={blocked ? blockReason : undefined}>
                  + {type === "DrawerStack" ? "Drawers" : type}
                </button>
              );
            })}
          </div>
          {sw > DRAWER_MAX_W && (
            <p style={{ margin: "8px 0 0", fontSize: "10px", color: "#b07040", lineHeight: 1.4 }}>
              Drawers require section width of {DRAWER_MAX_W}" or less.
            </p>
          )}
        </div>

        {sec.comps.length > 0 && (
          <div>
            <p style={{ fontSize: "11px", fontWeight: "700", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 8px" }}>
              Components
            </p>
            {sec.comps.map(comp => (
              <CompCard key={comp.id} comp={comp} sec={sec} secEffH={secEH} secWidthIn={sw}
                onUpdate={u => onUpdateComp(sec.id, comp.id, u)}
                onDelete={() => onDeleteComp(sec.id, comp.id)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Component ──────────────────────────────────────────────────────────────
  if (selection.kind === "comp") {
    const si    = run.sections.findIndex(s => s.id === selection.secId);
    const sec   = run.sections[si];
    const comp  = sec?.comps.find(c => c.id === selection.compId);
    if (!sec || !comp) return null;
    const sw    = secWidth(run.panels, run.startIn, run.endIn, si);
    const secEH = sectionEffH(run, si, sysH);
    return (
      <div style={{ padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <span style={{ fontSize: "14px", fontWeight: "700" }}>{comp.type}</span>
          {closeX}
        </div>
        {/* Section context */}
        <div style={{ marginBottom: "12px", padding: "6px 10px", borderRadius: "5px",
          backgroundColor: "#f0f4ff", border: "1px solid #c8d4f0",
          fontSize: "11px", color: "#3b5bdb", fontWeight: "600", display: "flex", gap: "10px" }}>
          <span>Section {si + 1}</span>
          <span style={{ color: "#7c8db5" }}>·</span>
          <span>Width {sw.toFixed(1)}"</span>
          <span style={{ color: "#7c8db5" }}>·</span>
          <span>Panel height {secEH}"</span>
        </div>
        <CompCard comp={comp} sec={sec} secEffH={secEH} secWidthIn={sw}
          onUpdate={u => onUpdateComp(sec.id, comp.id, u)}
          onDelete={() => { onDeleteComp(sec.id, comp.id); onClearSel(); }} />
      </div>
    );
  }

  // ── Obstacle ────────────────────────────────────────────────────────────────
  if (selection.kind === "obstacle") {
    const obs = (run.obstacles ?? []).find(o => o.id === selection.obsId);
    if (!obs) return null;
    const obsTypes: ObstacleType[] = ["LightSwitch", "Outlet", "Window", "Unknown"];
    const obsLabels: Record<ObstacleType, string> = {
      LightSwitch: "Light Switch",
      Outlet:      "Outlet",
      Window:      "Window",
      Unknown:     "Unknown Obstacle",
    };
    const obsInpStyle: React.CSSProperties = {
      ...inp,
      width: "60px",
      borderColor: "#b8cce4",
      backgroundColor: "#f8fbff",
    };
    const obsLbl: React.CSSProperties = {
      ...lbl,
      color: "#4a6080",
    };
    return (
      <div style={{ padding: "16px" }}>
        {/* Header — distinct from closet component inspector */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "12px", height: "12px", borderRadius: "2px",
              backgroundColor: OBS_FILL[obs.type], border: `2px solid ${OBS_STROKE[obs.type]}` }} />
            <span style={{ fontSize: "14px", fontWeight: "700", color: "#2a4060" }}>
              {obsLabels[obs.type]}
            </span>
          </div>
          {closeX}
        </div>

        {/* "Wall condition" badge — visually separates from closet components */}
        <div style={{ marginBottom: "14px", padding: "5px 10px", borderRadius: "6px",
          backgroundColor: "#eef4fb", border: "1px solid #b8cce4",
          fontSize: "10px", fontWeight: "700", color: "#4a6080",
          textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Wall condition — not a closet component
        </div>

        <div style={{ marginBottom: "12px" }}>
          <span style={obsLbl}>Type</span>
          <select value={obs.type}
            onChange={e => onUpdateObstacle(obs.id, { type: e.target.value as ObstacleType })}
            style={{ ...inp, width: "100%", borderColor: "#b8cce4", backgroundColor: "#f8fbff" }}>
            {obsTypes.map(t => <option key={t} value={t}>{obsLabels[t]}</option>)}
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
          <div>
            <span style={obsLbl}>Width (in)</span>
            <input type="number" style={obsInpStyle} min={1} step={1} value={obs.wIn}
              onChange={e => onUpdateObstacle(obs.id, { wIn: Math.max(1, Number(e.target.value)) })} />
          </div>
          <div>
            <span style={obsLbl}>Height (in)</span>
            <input type="number" style={obsInpStyle} min={1} step={1} value={obs.hIn}
              onChange={e => onUpdateObstacle(obs.id, { hIn: Math.max(1, Number(e.target.value)) })} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
          <div>
            <span style={obsLbl}>X from left (in)</span>
            <input type="number" style={obsInpStyle} min={0} step={1} value={obs.xIn}
              onChange={e => onUpdateObstacle(obs.id, { xIn: Math.max(0, Number(e.target.value)) })} />
          </div>
          <div>
            <span style={obsLbl}>Y from floor (in)</span>
            <input type="number" style={obsInpStyle} min={0} step={1} value={obs.yIn}
              onChange={e => onUpdateObstacle(obs.id, { yIn: Math.max(0, Number(e.target.value)) })} />
          </div>
        </div>

        <p style={{ fontSize: "11px", color: "#6a88a8", margin: "0 0 14px",
          padding: "6px 8px", backgroundColor: "#f0f6fc", borderRadius: "5px",
          border: "1px solid #ccdff0" }}>
          Drag on canvas to reposition. Can be placed anywhere on the wall, up to the ceiling.
        </p>

        <button style={{ ...rowBtn(true), width: "100%", borderColor: "#b8cce4", color: "#4a6080" }}
          onClick={() => { onDeleteObstacle(obs.id); onClearSel(); }}>
          Remove
        </button>
      </div>
    );
  }

  return null;
}

// ─── CompCard ─────────────────────────────────────────────────────────────────

function CompCard({ comp, sec, secEffH, secWidthIn, onUpdate, onDelete }: {
  comp:        ClosetComp;
  sec:         Section;
  secEffH:     number;   // section effective height (min of bounding panel heights)
  secWidthIn?: number;
  onUpdate:    (u: Partial<ClosetComp>) => void;
  onDelete:    () => void;
}) {
  const inp: React.CSSProperties = {
    padding: "4px 6px", fontSize: "12px", border: "1px solid #c8c4be",
    borderRadius: "4px", backgroundColor: "#fff", color: "#111",
  };
  const nudge: React.CSSProperties = {
    padding: "2px 7px", fontSize: "12px", cursor: "pointer",
    border: "1px solid #c8c4be", borderRadius: "4px",
    backgroundColor: "#fff", color: "#444", lineHeight: 1.4,
  };
  const dotColor: Record<CompType, string> = { Shelf: C_SHELF, Rod: C_ROD, DrawerStack: C_DRAWER };
  const cH       = compHeight(comp);
  const top      = comp.positionIn + cH;
  const atLimit  = comp.type === "DrawerStack" && top >= DRAWER_MAX_TOP - 1;
  const isLocked = (comp.type === "Shelf" || comp.type === "Rod") && (secWidthIn ?? 0) >= LOCK_SPAN_MIN;
  const sysH     = secEffH;   // alias for resolvePos calls below

  return (
    <div style={{
      padding: "10px 12px", borderRadius: "7px", marginBottom: "6px",
      border: `1px solid ${atLimit ? "#e08070" : "#e0dbd2"}`,
      backgroundColor: atLimit ? "#fff8f7" : "#faf8f5",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%",
            backgroundColor: isLocked ? "#a89878" : dotColor[comp.type], display: "inline-block" }} />
          <span style={{ fontSize: "12px", fontWeight: "700", color: "#333" }}>{comp.type}</span>
          {atLimit && (
            <span style={{ fontSize: "10px", color: "#c0392b", fontWeight: "700", backgroundColor: "#fde8e8",
              borderRadius: "3px", padding: "1px 5px" }}>
              50" max
            </span>
          )}
          {isLocked && (
            <span style={{ fontSize: "10px", color: "#806848", fontWeight: "700", backgroundColor: "#f0e8d4",
              borderRadius: "3px", padding: "1px 5px" }}>
              LOCKED
            </span>
          )}
        </div>
        <button onClick={onDelete}
          style={{ background: "none", border: "none", fontSize: "15px", color: "#ccc", cursor: "pointer", lineHeight: 1 }}>
          ×
        </button>
      </div>

      {isLocked && (
        <div style={{ marginBottom: "8px", padding: "6px 8px", borderRadius: "5px",
          backgroundColor: "#f7f2e8", border: "1px solid #d8c898", fontSize: "10px", color: "#806848" }}>
          Span ≥ {LOCK_SPAN_MIN}" — drag disabled. Set height with the input below.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: comp.type === "DrawerStack" ? "8px" : "0" }}>
        <span style={{ fontSize: "11px", color: "#888", width: isLocked ? "52px" : "30px" }}>
          {isLocked ? "Floor ↕" : "Pos"}
        </span>
        <input type="number" style={{ ...inp, width: "50px" }} min={1} step={1}
          value={comp.positionIn}
          onChange={e => {
            const r = resolvePos(comp, sysH, Number(e.target.value), sec.comps);
            onUpdate({ positionIn: r });
          }} />
        <span style={{ fontSize: "11px", color: "#aaa", flex: 1 }}>″ floor</span>
        <button style={nudge}
          onClick={() => onUpdate({ positionIn: resolvePos(comp, sysH, comp.positionIn + 1, sec.comps) })}>▲</button>
        <button style={nudge}
          onClick={() => onUpdate({ positionIn: resolvePos(comp, sysH, comp.positionIn - 1, sec.comps) })}>▼</button>
      </div>

      {comp.type === "DrawerStack" && (
        <div style={{ paddingTop: "6px", borderTop: "1px solid #ede9e3" }}>
          <div style={{ fontSize: "11px", color: "#888", fontWeight: "600", marginBottom: "5px" }}>
            Drawer heights — total: <strong style={{ color: "#555" }}>{cH}"</strong>
            {" · "}top at: <strong style={{ color: atLimit ? "#c0392b" : "#555" }}>{top}"</strong>
            <span style={{ color: "#aaa" }}> / {DRAWER_MAX_TOP}" max</span>
          </div>
          {comp.drawerHeights.map((dh, di) => (
            <div key={di} style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "3px" }}>
              <span style={{ fontSize: "10px", color: "#bbb", width: "16px" }}>#{di + 1}</span>
              <input type="number" style={{ ...inp, width: "46px" }} min={4} step={1} value={dh}
                onChange={e => {
                  const heights = comp.drawerHeights.map((h, hi) => hi === di ? Number(e.target.value) : h);
                  onUpdate({ drawerHeights: heights });
                }} />
              <span style={{ fontSize: "10px", color: "#aaa" }}>″</span>
              {comp.drawerHeights.length > 1 && (
                <button style={{ ...nudge, color: "#c0392b", borderColor: "#e8c0b8", padding: "2px 6px", fontSize: "11px" }}
                  onClick={() => onUpdate({ drawerHeights: comp.drawerHeights.filter((_, hi) => hi !== di) })}>
                  ×
                </button>
              )}
            </div>
          ))}
          <button style={{ marginTop: "3px", padding: "3px 9px", fontSize: "11px", cursor: "pointer",
            border: "1px solid #c8c4be", borderRadius: "4px", backgroundColor: "#fff", color: "#444" }}
            onClick={() => onUpdate({ drawerHeights: [...comp.drawerHeights, 8] })}>
            + Add Drawer
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Wall Top View ────────────────────────────────────────────────────────────
// Plan / top-down view of a single wall run. Read-only — no drag interactions.

const TV_SCALE  = 6;    // px/inch (same as front view SCALE)
const TV_PAD_L  = 50;   // left padding (depth ruler)
const TV_PAD_R  = 28;
const TV_PAD_T  = 42;   // top padding (labels + system span bracket)
const TV_PAD_B  = 28;   // bottom (section width labels)

function WallTopView({
  run, wall, cornerConstraints, zoom,
}: {
  run:               WallRun;
  wall:              DesignWall;
  cornerConstraints: CornerConstraint[];
  zoom:              number;
}) {
  const wallW      = wall.widthIn;
  const wallCorns  = cornerConstraints.filter(c => c.wallId === wall.id);
  const obstacles  = run.obstacles ?? [];

  const maxDepth = run.sections.length > 0
    ? Math.max(12, ...run.sections.map(s => s.depthIn))
    : 12;

  const svgW = TV_PAD_L + wallW * TV_SCALE + TV_PAD_R;
  const svgH = TV_PAD_T + maxDepth * TV_SCALE + TV_PAD_B;

  const xPx = (xIn: number) => TV_PAD_L + xIn * TV_SCALE;
  const yPx = (dIn: number) => TV_PAD_T + dIn * TV_SCALE;

  // Section geometry (reuse shared helpers)
  const sLeft  = (i: number) => secLeft(run.panels, run.startIn, i);
  const sWidth = (i: number) => secWidth(run.panels, run.startIn, run.endIn, i);

  return (
    <svg width={svgW * zoom} height={svgH * zoom}
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{ display: "block", userSelect: "none" }}>

      {/* ── Background: full wall footprint ── */}
      <rect x={xPx(0)} y={yPx(0)} width={wallW * TV_SCALE} height={maxDepth * TV_SCALE}
        fill="#eeebe6" stroke="#d4cfc8" strokeWidth={1} />

      {/* ── Depth ruler on left ── */}
      <line x1={TV_PAD_L - 8} y1={yPx(0)} x2={TV_PAD_L - 8} y2={yPx(maxDepth)}
        stroke="#ccc" strokeWidth={1} />
      {Array.from({ length: Math.floor(maxDepth / 6) + 1 }, (_, i) => {
        const d = i * 6;
        if (d > maxDepth + 0.5) return null;
        return (
          <g key={d} pointerEvents="none">
            <line x1={TV_PAD_L - 12} y1={yPx(d)} x2={TV_PAD_L - 8} y2={yPx(d)}
              stroke="#ccc" strokeWidth={1} />
            <text x={TV_PAD_L - 14} y={yPx(d) + 4} textAnchor="end" fontSize={9} fill="#aaa">
              {d}"
            </text>
          </g>
        );
      })}
      <text x={TV_PAD_L / 2} y={yPx(maxDepth / 2)} textAnchor="middle"
        fontSize={8} fill="#bbb"
        transform={`rotate(-90,${TV_PAD_L / 2},${yPx(maxDepth / 2)})`}>
        depth →
      </text>

      {/* ── Corner clearance zones ── */}
      {wallCorns.map(cc => {
        const zonePx  = cc.cutbackIn * TV_SCALE;
        const violated = cc.violated;
        const fill    = violated ? "#fee2e2" : "#fff7ed";
        const stroke  = violated ? "#dc2626" : "#f97316";
        if (cc.side === "left") {
          const w = Math.min(zonePx, wallW * TV_SCALE);
          return (
            <g key={cc.cornerKey} pointerEvents="none">
              <rect x={xPx(0)} y={yPx(0)} width={w} height={maxDepth * TV_SCALE}
                fill={fill} opacity={0.65} />
              <line x1={xPx(0) + w} y1={yPx(0)} x2={xPx(0) + w} y2={yPx(maxDepth)}
                stroke={stroke} strokeWidth={1.5} strokeDasharray="5,3" />
              <text x={xPx(0) + w / 2} y={yPx(maxDepth / 2) + 4}
                textAnchor="middle" fontSize={8} fill={stroke} fontWeight="700"
                transform={`rotate(-90,${xPx(0) + w / 2},${yPx(maxDepth / 2)})`}>
                {cc.cutbackIn}" clear
              </text>
            </g>
          );
        } else {
          const startX = xPx(wallW - cc.cutbackIn);
          const w = cc.cutbackIn * TV_SCALE;
          return (
            <g key={cc.cornerKey} pointerEvents="none">
              <rect x={startX} y={yPx(0)} width={w} height={maxDepth * TV_SCALE}
                fill={fill} opacity={0.65} />
              <line x1={startX} y1={yPx(0)} x2={startX} y2={yPx(maxDepth)}
                stroke={stroke} strokeWidth={1.5} strokeDasharray="5,3" />
              <text x={startX + w / 2} y={yPx(maxDepth / 2) + 4}
                textAnchor="middle" fontSize={8} fill={stroke} fontWeight="700"
                transform={`rotate(-90,${startX + w / 2},${yPx(maxDepth / 2)})`}>
                {cc.cutbackIn}" clear
              </text>
            </g>
          );
        }
      })}

      {/* ── Gap zones ── */}
      {run.startIn > 0.5 && (
        <g pointerEvents="none">
          <rect x={xPx(0)} y={yPx(0)} width={run.startIn * TV_SCALE} height={maxDepth * TV_SCALE}
            fill="rgba(160,160,160,0.14)" />
          <text x={xPx(run.startIn / 2)} y={yPx(maxDepth / 2) + 4}
            textAnchor="middle" fontSize={9} fill="#aaa"
            transform={`rotate(-90,${xPx(run.startIn / 2)},${yPx(maxDepth / 2)})`}>
            {run.startIn.toFixed(1)}" gap
          </text>
        </g>
      )}
      {wallW - run.endIn > 0.5 && (
        <g pointerEvents="none">
          <rect x={xPx(run.endIn)} y={yPx(0)}
            width={(wallW - run.endIn) * TV_SCALE} height={maxDepth * TV_SCALE}
            fill="rgba(160,160,160,0.14)" />
          <text
            x={xPx(run.endIn + (wallW - run.endIn) / 2)}
            y={yPx(maxDepth / 2) + 4}
            textAnchor="middle" fontSize={9} fill="#aaa"
            transform={`rotate(-90,${xPx(run.endIn + (wallW - run.endIn) / 2)},${yPx(maxDepth / 2)})`}>
            {(wallW - run.endIn).toFixed(1)}" gap
          </text>
        </g>
      )}

      {/* ── Section fills (per section, actual depth) ── */}
      {run.sections.map((sec, si) => {
        const lx = sLeft(si);
        const sw = sWidth(si);
        return (
          <g key={sec.id} pointerEvents="none">
            <rect x={xPx(lx)} y={yPx(0)} width={sw * TV_SCALE} height={sec.depthIn * TV_SCALE}
              fill="rgba(195,155,100,0.30)" stroke="#c4935a" strokeWidth={0.75} />
            {/* Depth value inside section */}
            <text x={xPx(lx + sw / 2)} y={yPx(sec.depthIn / 2) + 4}
              textAnchor="middle" fontSize={9} fill="#8b6437" fontWeight="700">
              {sec.depthIn}"
            </text>
          </g>
        );
      })}

      {/* ── Interior panels ── */}
      {run.panels.map((panel, pi) => {
        const leftDepth  = run.sections[pi]?.depthIn     ?? maxDepth;
        const rightDepth = run.sections[pi + 1]?.depthIn ?? maxDepth;
        const pDepth     = Math.max(leftDepth, rightDepth);
        return (
          <rect key={panel.id}
            x={xPx(panel.xIn)} y={yPx(0)}
            width={PANEL_W_IN * TV_SCALE} height={pDepth * TV_SCALE}
            fill="#b8956a" stroke="#8b6437" strokeWidth={0.5}
            pointerEvents="none"
          />
        );
      })}

      {/* ── End panels ── */}
      {run.sections.length > 0 && (() => {
        const d0 = run.sections[0].depthIn;
        const dN = run.sections[run.sections.length - 1].depthIn;
        return (
          <>
            <rect x={xPx(run.startIn)} y={yPx(0)}
              width={PANEL_W_IN * TV_SCALE} height={d0 * TV_SCALE}
              fill="#b8956a" stroke="#8b6437" strokeWidth={1} pointerEvents="none" />
            <rect x={xPx(run.endIn - PANEL_W_IN)} y={yPx(0)}
              width={PANEL_W_IN * TV_SCALE} height={dN * TV_SCALE}
              fill="#b8956a" stroke="#8b6437" strokeWidth={1} pointerEvents="none" />
          </>
        );
      })()}

      {/* ── Obstacles (shown at wall face as position markers) ── */}
      {obstacles.map(obs => {
        const xLeft = xPx(obs.xIn);
        const wPx   = obs.wIn * TV_SCALE;
        const fill  = OBS_FILL[obs.type];
        const stroke= OBS_STROKE[obs.type];
        return (
          <g key={obs.id} pointerEvents="none">
            <rect x={xLeft} y={yPx(0) - 10} width={wPx} height={10}
              fill={fill} stroke={stroke} strokeWidth={1} rx={1} opacity={0.9} />
            <text x={xLeft + wPx / 2} y={yPx(0) - 2}
              textAnchor="middle" fontSize={7} fill={stroke} fontWeight="700">
              {OBS_LABEL[obs.type]}
            </text>
          </g>
        );
      })}

      {/* ── Wall face bar ── */}
      <rect x={xPx(0)} y={TV_PAD_T - 5} width={wallW * TV_SCALE} height={5}
        fill="#3a3a3a" pointerEvents="none" />

      {/* ── System span bracket above wall face ── */}
      <line x1={xPx(run.startIn)} y1={TV_PAD_T - 16} x2={xPx(run.endIn)} y2={TV_PAD_T - 16}
        stroke="#666" strokeWidth={1} pointerEvents="none" />
      <line x1={xPx(run.startIn)} y1={TV_PAD_T - 19} x2={xPx(run.startIn)} y2={TV_PAD_T - 13}
        stroke="#666" strokeWidth={1} pointerEvents="none" />
      <line x1={xPx(run.endIn)} y1={TV_PAD_T - 19} x2={xPx(run.endIn)} y2={TV_PAD_T - 13}
        stroke="#666" strokeWidth={1} pointerEvents="none" />
      <text x={(xPx(run.startIn) + xPx(run.endIn)) / 2} y={TV_PAD_T - 20}
        textAnchor="middle" fontSize={9} fill="#555" fontWeight="700" pointerEvents="none">
        System: {(run.endIn - run.startIn).toFixed(1)}"
      </text>

      {/* ── Wall total width label ── */}
      <text x={xPx(wallW / 2)} y={12}
        textAnchor="middle" fontSize={10} fill="#aaa" fontWeight="600" pointerEvents="none">
        Wall: {wallW}"
      </text>

      {/* ── Section width labels at bottom ── */}
      {run.sections.map((sec, si) => {
        const lx = sLeft(si);
        const sw = sWidth(si);
        return (
          <text key={`wlbl${sec.id}`}
            x={xPx(lx + sw / 2)} y={svgH - 8}
            textAnchor="middle" fontSize={9} fill="#666" fontWeight="600" pointerEvents="none">
            {sw.toFixed(1)}"
          </text>
        );
      })}

      {/* ── "Wall face" label ── */}
      <text x={xPx(wallW) + 8} y={TV_PAD_T - 2} fontSize={8} fill="#888" pointerEvents="none">
        wall face
      </text>

    </svg>
  );
}

// ─── Room Top View ────────────────────────────────────────────────────────────
// Full-room plan view: perimeter + all closet footprints.
// Falls back to a flat multi-wall strip layout when no perimeter segments exist.

const RTV_W   = 580;
const RTV_H   = 420;
const RTV_PAD = 54;

function RoomTopView({
  layout, runs, wallLabelMap, usableWalls, zoom,
}: {
  layout:       RoomLayout;
  runs:         WallRun[];
  wallLabelMap: Map<string, string>;
  usableWalls:  DesignWall[];
  zoom:         number;
}) {
  // ── Source of truth: use the SAME segment geometry as the Room Layout Builder ──
  // Priority: real segments → legacy walls → usableWalls prop.
  // All three paths feed the SAME perimeter renderer — never a different layout.
  let segments: RoomSegment[] = (layout.segments ?? []).slice();

  if (segments.length === 0) {
    // Migrate legacy RoomWall[] → RoomSegment[] (straight, right-direction)
    const legacyWalls = layout.walls ?? [];
    if (legacyWalls.length > 0) {
      segments = legacyWalls.map(w => ({
        id:                w.id,
        label:             w.label,
        lengthIn:          w.widthIn,
        direction:         "right" as const,
        usable:            w.usable,
        selectedForDesign: w.usable,
        canHaveCabinetry:  w.usable,
        hasWindow:         w.hasOpening,
        hasDoor:           false,
        hasObstacle:       false,
        notes:             "",
      }));
    } else if (usableWalls.length > 0) {
      // Last resort: synthesize from DesignWall props
      segments = usableWalls.map(w => ({
        id:                w.id,
        label:             w.label,
        lengthIn:          w.widthIn,
        direction:         "right" as const,
        usable:            w.usable,
        selectedForDesign: w.selectedForDesign,
        canHaveCabinetry:  w.usable,
        hasWindow:         false,
        hasDoor:           false,
        hasObstacle:       false,
        notes:             "",
      }));
    }
  }

  // Use the perimeter renderer for any wall data (≥ 1 segment).
  // This is the same renderer as the Room Layout Builder — never a strip view.
  const hasPerimeter = segments.length >= 1;

  // ── PERIMETER VIEW ───────────────────────────────────────────────────────
  if (hasPerimeter) {
    // All geometry via shared room-geo module — identical to Room Layout Builder.
    const _origin: Point = (layout.originX !== undefined && layout.originY !== undefined)
      ? [layout.originX, layout.originY] : [0, 0];
    const pts = computePoints(segments, _origin);

    const { scale: pscale, offX, offY, minX, minY } =
      computeTransform(segments, 1, _origin, RTV_W, RTV_H, RTV_PAD);
    const tx = (x: number) => offX + (x - minX) * pscale;
    const ty = (y: number) => offY + (y - minY) * pscale;

    const normalSign = computeSignedArea(segments, pts) >= 0 ? 1 : -1;
    const closed     = isClosed(segments, pts);
    const wallPt     = makeWallPtFn(segments, pts, normalSign, tx, ty);

    function ptStr(...coords: [number, number][]): string {
      return coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    }

    /** Actual Euclidean length of a segment (correct for slanted/curved). */
    function segLen(seg: typeof segments[0]): number {
      if (seg.dxIn !== undefined && seg.dyIn !== undefined)
        return Math.sqrt(seg.dxIn**2 + seg.dyIn**2);
      return seg.lengthIn;
    }

    return (
      <svg width={RTV_W * zoom} height={RTV_H * zoom}
        viewBox={`0 0 ${RTV_W} ${RTV_H}`}
        style={{ display: "block", userSelect: "none",
          backgroundColor: "#f7f4ef", borderRadius: "10px", border: "1px solid #d8d0c8" }}>

        <text x={RTV_W / 2} y={18} textAnchor="middle" fontSize={10} fill="#888" fontWeight="700"
          pointerEvents="none" letterSpacing="0.5">
          FULL ROOM PLAN
        </text>

        {/* Room fill */}
        {closed && (
          <path d={buildRoomPath(segments, pts, closed, tx, ty)} fill="rgba(255,255,255,0.70)" />
        )}

        {/* Closet footprints */}
        {runs.map(run => {
          const segIdx = segments.findIndex(s => s.id === run.wallId);
          if (segIdx < 0 || segIdx >= pts.length - 1 || run.sections.length === 0) return null;
          // fd: flip depth sign if footprintFlipped is set on this wall
          const fd = (d: number) => segments[segIdx].footprintFlipped ? -d : d;
          return (
            <g key={run.wallId} pointerEvents="none">
              {run.sections.map((sec, si) => {
                const lx  = si === 0 ? run.startIn : run.panels[si - 1].xIn + PANEL_W_IN;
                const rx  = si === run.panels.length ? run.endIn : run.panels[si].xIn;
                if (rx <= lx) return null;
                const a   = wallPt(segIdx, lx, 0);
                const b   = wallPt(segIdx, rx, 0);
                const c   = wallPt(segIdx, rx, fd(sec.depthIn));
                const dpt = wallPt(segIdx, lx, fd(sec.depthIn));
                return (
                  <polygon key={sec.id} points={ptStr(a, b, c, dpt)}
                    fill="rgba(195,155,100,0.38)" stroke="#c4935a" strokeWidth={1} />
                );
              })}
              {run.panels.map((panel, pi) => {
                const lD = run.sections[pi]?.depthIn ?? 12;
                const rD = run.sections[pi+1]?.depthIn ?? 12;
                const maxD = Math.max(lD, rD);
                const a = wallPt(segIdx, panel.xIn, 0);
                const b = wallPt(segIdx, panel.xIn + PANEL_W_IN, 0);
                const c = wallPt(segIdx, panel.xIn + PANEL_W_IN, fd(maxD));
                const dpt = wallPt(segIdx, panel.xIn, fd(maxD));
                return (
                  <polygon key={panel.id} points={ptStr(a, b, c, dpt)}
                    fill="#b8956a" stroke="#8b6437" strokeWidth={0.5} />
                );
              })}
              {run.sections.length > 0 && (() => {
                const d0 = run.sections[0].depthIn;
                const dN = run.sections[run.sections.length-1].depthIn;
                const la = wallPt(segIdx, run.startIn, 0);
                const lb = wallPt(segIdx, run.startIn + PANEL_W_IN, 0);
                const lc = wallPt(segIdx, run.startIn + PANEL_W_IN, fd(d0));
                const ld = wallPt(segIdx, run.startIn, fd(d0));
                const ra = wallPt(segIdx, run.endIn - PANEL_W_IN, 0);
                const rb = wallPt(segIdx, run.endIn, 0);
                const rc = wallPt(segIdx, run.endIn, fd(dN));
                const rd = wallPt(segIdx, run.endIn - PANEL_W_IN, fd(dN));
                return (
                  <>
                    <polygon points={ptStr(la, lb, lc, ld)} fill="#b8956a" stroke="#8b6437" strokeWidth={1} />
                    <polygon points={ptStr(ra, rb, rc, rd)} fill="#b8956a" stroke="#8b6437" strokeWidth={1} />
                  </>
                );
              })()}
              {(() => {
                const maxD = Math.max(...run.sections.map(s => s.depthIn));
                const midAlong = (run.startIn + run.endIn) / 2;
                const [mx, my] = wallPt(segIdx, midAlong, fd(maxD / 2));
                const [wx1, wy1] = segStart(segments, pts,segIdx);
                const [wx2, wy2] = pts[segIdx+1] ?? pts[segIdx];
                const wl = Math.sqrt((wx2-wx1)**2+(wy2-wy1)**2);
                if (wl < 0.01) return null;
                const depthAngle = (Math.atan2((wy2-wy1)/wl, (wx2-wx1)/wl) * 180/Math.PI) - 90;
                return (
                  <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
                    fontSize={9} fill="#8b6437" fontWeight="700" pointerEvents="none"
                    transform={`rotate(${depthAngle.toFixed(1)},${mx.toFixed(1)},${my.toFixed(1)})`}>
                    {maxD}"
                  </text>
                );
              })()}
            </g>
          );
        })}

        {/* Wall lines + labels */}
        {segments.map((seg, i) => {
          if (i >= pts.length - 1) return null;
          const [x1, y1] = segStart(segments, pts,i);
          const [x2, y2] = pts[i + 1];
          const sx1 = tx(x1), sy1 = ty(y1), sx2 = tx(x2), sy2 = ty(y2);
          const hasRun  = runs.some(r => r.wallId === seg.id);
          const color   = !seg.usable ? "#9ca3af" : hasRun ? "#15803d" : "#b07040";
          const strokeW = hasRun ? 4 : seg.usable ? 2.5 : 1.5;

          // Build path for this segment (supports curves and breakpoints)
          let wallPathD: string;
          if (seg.cpDxIn !== undefined && seg.cpDyIn !== undefined) {
            const cpx = tx(x1 + seg.cpDxIn), cpy = ty(y1 + seg.cpDyIn);
            wallPathD = `M ${sx1} ${sy1} Q ${cpx} ${cpy} ${sx2} ${sy2}`;
          } else if (seg.breakDxIn !== undefined && seg.breakDyIn !== undefined) {
            const bx = tx(x1 + seg.breakDxIn), by = ty(y1 + seg.breakDyIn);
            wallPathD = `M ${sx1} ${sy1} L ${bx} ${by} L ${sx2} ${sy2}`;
          } else {
            wallPathD = `M ${sx1} ${sy1} L ${sx2} ${sy2}`;
          }

          // Label position perpendicular to the chord (works for all wall types)
          const dxL = sx2 - sx1, dyL = sy2 - sy1;
          const sl = Math.sqrt(dxL*dxL+dyL*dyL)||1;
          const pnx = -dyL/sl, pny = dxL/sl;
          const midX = (sx1+sx2)/2, midY = (sy1+sy2)/2;
          const lOffset = 14;
          const lx = midX + pnx * lOffset, ly = midY + pny * lOffset;

          // Always label by segment index (matching Room Layout Builder: Wall A = first segment)
          const _WALL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
          const displayLabel  = `Wall ${_WALL_LETTERS[i] ?? String(i + 1)}`;
          const lenStr       = Math.round(segLen(seg)) + '"';

          return (
            <g key={seg.id} pointerEvents="none">
              <path d={wallPathD} fill="none"
                stroke={color} strokeWidth={strokeW} strokeLinecap="round"
                opacity={seg.usable ? 1 : 0.5} />
              {displayLabel ? (
                <>
                  <text x={lx} y={ly - 5} textAnchor="middle" fontSize={9} fill={color} fontWeight="800">
                    {displayLabel}
                  </text>
                  <text x={lx} y={ly + 6} textAnchor="middle" fontSize={8} fill={color} opacity={0.75}>
                    {lenStr}
                  </text>
                </>
              ) : (
                <text x={lx} y={ly} textAnchor="middle" fontSize={8} fill={color} opacity={0.7}>
                  {lenStr}
                </text>
              )}
            </g>
          );
        })}

        {/* Corner dots — use actual segment starts (anchor-aware) */}
        {segments.map((_, i) => {
          const [x, y] = segStart(segments, pts,i);
          return (
            <circle key={`dot${i}`} cx={tx(x)} cy={ty(y)} r={i === 0 ? 5 : 3}
              fill={i === 0 ? "#1a1a1a" : "#999"} pointerEvents="none" />
          );
        })}

        {/* Legend */}
        <g pointerEvents="none">
          <rect x={8} y={RTV_H - 52} width={130} height={44} rx={4}
            fill="rgba(247,244,239,0.92)" stroke="#d8d0c8" strokeWidth={0.75} />
          <rect x={13} y={RTV_H - 47} width={10} height={6} rx={1}
            fill="rgba(195,155,100,0.45)" stroke="#c4935a" strokeWidth={0.75} />
          <text x={26} y={RTV_H - 41} fontSize={8} fill="#777">Closet area</text>
          <line x1={12} y1={RTV_H - 28} x2={22} y2={RTV_H - 28}
            stroke="#15803d" strokeWidth={3} strokeLinecap="round" />
          <text x={26} y={RTV_H - 24} fontSize={8} fill="#777">Has closet</text>
          <line x1={12} y1={RTV_H - 14} x2={22} y2={RTV_H - 14}
            stroke="#b07040" strokeWidth={2} strokeLinecap="round" />
          <text x={26} y={RTV_H - 10} fontSize={8} fill="#777">No closet</text>
        </g>

        {/* Closed status */}
        <text x={RTV_W - 8} y={RTV_H - 8} textAnchor="end" fontSize={9} fontWeight="700"
          fill={closed ? "#15803d" : "#2563eb"} pointerEvents="none">
          {closed ? "✓ Closed room" : "○ Open"}
        </text>
      </svg>
    );
  }

  // No data at all — this should never happen in normal flow
  return (
    <svg width={RTV_W * zoom} height={RTV_H * zoom}
      viewBox={`0 0 ${RTV_W} ${RTV_H}`}
      style={{ display: "block", userSelect: "none",
        backgroundColor: "#f7f4ef", borderRadius: "10px", border: "1px solid #d8d0c8" }}>
      <text x={RTV_W / 2} y={RTV_H / 2 - 8} textAnchor="middle" fontSize={13} fill="#aaa">
        No room layout found.
      </text>
      <text x={RTV_W / 2} y={RTV_H / 2 + 10} textAnchor="middle" fontSize={11} fill="#ccc">
        Visit Room Layout Builder to define the room.
      </text>
    </svg>
  );
}

// ─── Zoom control styles (design page) ───────────────────────────────────────

const DZS = {
  btn: {
    width: "26px", height: "26px", fontSize: "15px", fontWeight: "700",
    border: "1px solid #d1cdc7", borderRadius: "5px", cursor: "pointer",
    backgroundColor: "#fff", color: "#444",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
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

export default function DesignPage() {
  const router = useRouter();

  const [layout,          setLayout]          = useState<RoomLayout | null>(null);
  const [runs,            setRuns]            = useState<WallRun[]>([]);
  const [fullLengthWalls, setFullLengthWalls] = useState<string[]>([]);
  const [activeWallId,    setActiveWallId]    = useState<string | null>(null);
  const [selection,       setSelection]       = useState<Selection>(null);
  const [viewMode,        setViewMode]        = useState<ViewMode>("front");
  const [topSubMode,      setTopSubMode]      = useState<"wall" | "room">("room");
  const [ready,           setReady]           = useState(false);
  const [designZoom,      setDesignZoom]      = useState(1.0);

  const dragRef        = useRef<DragState | null>(null);
  const layoutRef      = useRef<RoomLayout | null>(null);
  const designZoomRef  = useRef(1.0);

  // Keep zoom ref in sync for use inside drag handler useEffect
  useEffect(() => { designZoomRef.current = designZoom; }, [designZoom]);

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const rawLayout = localStorage.getItem("room-layout");
    if (!rawLayout) { router.replace("/room-layout"); return; }

    try {
      const lay = JSON.parse(rawLayout) as RoomLayout;
      setLayout(lay);
      layoutRef.current = lay;

      const usableWalls = getSelectedWalls(lay);
      const wallMap     = new Map(getDesignWalls(lay).map(w => [w.id, w]));
      let newRuns: WallRun[] = [];

      let savedFullLengthWalls: string[] = [];
      const rawState = localStorage.getItem("design-state");
      if (rawState) {
        try {
          const saved = JSON.parse(rawState);
          if (saved.v === 2) {
            const wallIds = new Set(usableWalls.map(w => w.id));
            newRuns = (saved as DesignStateV2).runs
              .filter(r => wallIds.has(r.wallId))
              .map(r => ({
                ...r,
                startIn:   r.startIn   ?? 0,
                endIn:     r.endIn     ?? (wallMap.get(r.wallId)?.widthIn ?? 120),
                obstacles: (r as WallRun).obstacles ?? [],
              }));
            // Filter saved full-length wall IDs to only current walls
            savedFullLengthWalls = ((saved as DesignStateV2).fullLengthWalls ?? [])
              .filter((id: string) => wallIds.has(id));
          } else if (saved.walls) {
            newRuns = migrateV1(saved as V1State, wallMap).runs
              .filter(r => usableWalls.some(w => w.id === r.wallId));
          }
        } catch { /* fall through */ }
      }

      const designed = new Set(newRuns.map(r => r.wallId));
      for (const w of usableWalls) {
        if (!designed.has(w.id)) newRuns.push(mkRun(w.id, w.widthIn));
      }

      seedId(newRuns);
      setRuns(newRuns);
      setFullLengthWalls(savedFullLengthWalls);
      if (usableWalls.length > 0) setActiveWallId(usableWalls[0].id);
      setReady(true);
    } catch {
      router.replace("/room-layout");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-save ──────────────────────────────────────────────────────────────

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ready || !layout) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem("design-state", JSON.stringify({ v: 2, runs, fullLengthWalls }));
      saveCompatPayload(layout, runs);
    }, 300);
  }, [runs, fullLengthWalls, ready, layout]);

  // ── Drag system ────────────────────────────────────────────────────────────

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.kind === "comp") {
        const rawPos = drag.startPosIn - (e.clientY - drag.startY) / (SCALE * designZoomRef.current);
        setRuns(prev => {
          const run  = prev.find(r => r.wallId === drag.wallId);
          const sec  = run?.sections.find(s => s.id === drag.secId);
          const comp = sec?.comps.find(c => c.id === drag.compId);
          if (!run || !sec || !comp) return prev;
          const globalSysH = layoutRef.current?.systemHeightIn ?? 84;
          const si         = run.sections.findIndex(s => s.id === drag.secId);
          const effH       = si >= 0 ? sectionEffH(run, si, globalSysH) : globalSysH;
          const resolved   = resolvePos(comp, effH, rawPos, sec.comps);
          return prev.map(r =>
            r.wallId === drag.wallId
              ? runUpdateComp(r, sec.id, comp.id, { positionIn: resolved })
              : r
          );
        });
      }

      if (drag.kind === "panel") {
        const rawX = drag.startXIn + (e.clientX - drag.startX) / (SCALE * designZoomRef.current);
        setRuns(prev => prev.map(r =>
          r.wallId === drag.wallId ? runMovePanel(r, drag.panelIdx, rawX) : r
        ));
      }

      if (drag.kind === "panel-height") {
        const rawH = drag.startHeightIn - (e.clientY - drag.startY) / (SCALE * designZoomRef.current);
        const sH   = layoutRef.current?.systemHeightIn  ?? 84;
        setRuns(prev => prev.map(r => {
          if (r.wallId !== drag.wallId) return r;
          const panel = r.panels[drag.panelIdx];
          if (!panel) return r;
          const cH = runCeilingAt(r, panel.xIn, layoutRef.current?.ceilingHeightIn ?? 96);
          const clampedH = Math.max(24, Math.min(cH, Math.round(rawH)));
          return runUpdatePanel(r, panel.id, { heightIn: clampedH === sH ? undefined : clampedH });
        }));
      }

      if (drag.kind === "left-end-height") {
        const rawH = drag.startHeightIn - (e.clientY - drag.startY) / (SCALE * designZoomRef.current);
        const sH   = layoutRef.current?.systemHeightIn  ?? 84;
        setRuns(prev => prev.map(r => {
          if (r.wallId !== drag.wallId) return r;
          const cH = runCeilingAt(r, r.startIn, layoutRef.current?.ceilingHeightIn ?? 96);
          const clampedH = Math.max(24, Math.min(cH, Math.round(rawH)));
          return runUpdateEndPanel(r, "left", clampedH === sH ? undefined : clampedH);
        }));
      }

      if (drag.kind === "right-end-height") {
        const rawH = drag.startHeightIn - (e.clientY - drag.startY) / (SCALE * designZoomRef.current);
        const sH   = layoutRef.current?.systemHeightIn  ?? 84;
        setRuns(prev => prev.map(r => {
          if (r.wallId !== drag.wallId) return r;
          const cH = runCeilingAt(r, r.endIn - PANEL_W_IN, layoutRef.current?.ceilingHeightIn ?? 96);
          const clampedH = Math.max(24, Math.min(cH, Math.round(rawH)));
          return runUpdateEndPanel(r, "right", clampedH === sH ? undefined : clampedH);
        }));
      }

      if (drag.kind === "left-end") {
        const rawStart = drag.startIn + (e.clientX - drag.startX) / (SCALE * designZoomRef.current);
        setRuns(prev => prev.map(r =>
          r.wallId === drag.wallId ? runMoveLeftEnd(r, rawStart) : r
        ));
      }

      if (drag.kind === "right-end") {
        const rawEnd = drag.endIn + (e.clientX - drag.startX) / (SCALE * designZoomRef.current);
        const wallW  = layoutRef.current
          ? (getSelectedWalls(layoutRef.current).find(w => w.id === drag.wallId)?.widthIn ?? 120)
          : 120;
        setRuns(prev => prev.map(r =>
          r.wallId === drag.wallId ? runMoveRightEnd(r, rawEnd, wallW) : r
        ));
      }

      if (drag.kind === "obstacle") {
        const rawX = drag.startXIn + (e.clientX - drag.startX) / (SCALE * designZoomRef.current);
        const rawY = drag.startYIn - (e.clientY - drag.startY) / (SCALE * designZoomRef.current);
        setRuns(prev => {
          const run = prev.find(r => r.wallId === drag.wallId);
          const obs = run?.obstacles?.find(o => o.id === drag.obsId);
          if (!run || !obs) return prev;
          const wallW    = layoutRef.current
            ? (getSelectedWalls(layoutRef.current).find(w => w.id === drag.wallId)?.widthIn ?? 120)
            : 120;
          // Obstacles are wall conditions — clamp to full wall height (ceiling), NOT system height
          const ceilingH = layoutRef.current?.ceilingHeightIn ?? 96;
          const clampedX = Math.max(0, Math.min(wallW - obs.wIn, Math.round(rawX)));
          const clampedY = Math.max(0, Math.min(ceilingH - obs.hIn, Math.round(rawY)));
          return prev.map(r =>
            r.wallId === drag.wallId
              ? runUpdateObstacle(r, drag.obsId, { xIn: clampedX, yIn: clampedY })
              : r
          );
        });
      }
    }

    function onUp() { dragRef.current = null; }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup",   onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup",   onUp);
    };
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function patchRun(wallId: string, fn: (r: WallRun) => WallRun) {
    setRuns(prev => prev.map(r => r.wallId === wallId ? fn(r) : r));
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const usableWalls       = layout ? getSelectedWalls(layout) : [];
  const wallLabelMap      = buildWallLabelMap(usableWalls);
  const wLabel            = (wallId: string) => wallLabelMap.get(wallId) ?? wallId;
  const activeWall        = usableWalls.find(w => w.id === activeWallId) ?? null;
  const activeRun         = runs.find(r => r.wallId === activeWallId) ?? null;
  const sysH              = layout?.systemHeightIn ?? 84;
  const cornerConstraints = layout ? deriveConstraints(fullLengthWalls, runs, usableWalls, layout, wLabel) : [];
  const anyViolations     = cornerConstraints.some(c => c.violated);

  if (!ready) {
    return (
      <div style={{ fontFamily: "sans-serif", display: "flex", alignItems: "center",
        justifyContent: "center", height: "100vh", backgroundColor: "#f5f2ee", color: "#888" }}>
        Loading…
      </div>
    );
  }
  if (!layout) return null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee",
      display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <header style={{
        backgroundColor: "#1a1a1a", color: "#fff", padding: "12px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "15px", fontWeight: "800" }}>Design Editor</span>
          {layout.projectType && (
            <span style={{ fontSize: "11px", color: "#aaa", backgroundColor: "#333",
              borderRadius: "4px", padding: "2px 8px" }}>{layout.projectType}</span>
          )}
          {layout.clientName && <span style={{ fontSize: "12px", color: "#aaa" }}>{layout.clientName}</span>}
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {["Setup", "Room Layout", "Design", "Worksheet"].map((s, i) => (
            <span key={s} style={{
              fontSize: "11px", padding: "3px 10px", borderRadius: "20px",
              backgroundColor: i === 2 ? "#fff" : "transparent",
              color: i === 2 ? "#1a1a1a" : "#888", fontWeight: i === 2 ? "700" : "400",
            }}>{s}</span>
          ))}
          <button onClick={() => router.push("/room-layout")}
            style={{
              fontSize: "12px", fontWeight: "600", cursor: "pointer", marginLeft: "8px",
              padding: "5px 14px", borderRadius: "6px",
              border: "1.5px solid #4a4a4a", backgroundColor: "transparent", color: "#ddd",
            }}>
            ← Room Layout
          </button>
        </div>
      </header>

      {/* Wall tabs */}
      <div style={{
        backgroundColor: "#fff", borderBottom: "1px solid #e5e0d8",
        padding: "10px 20px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center",
      }}>
        {usableWalls.map(w => (
          <button key={w.id} onClick={() => { setActiveWallId(w.id); setSelection(null); }}
            style={{
              padding: "6px 16px", fontSize: "12px", fontWeight: "700",
              borderRadius: "20px", border: "1.5px solid",
              backgroundColor: activeWallId === w.id ? "#1a1a1a" : "#fff",
              borderColor:     activeWallId === w.id ? "#1a1a1a" : "#c8c4be",
              color:           activeWallId === w.id ? "#fff" : "#444",
              cursor: "pointer",
            }}>
            {wLabel(w.id)}
            <span style={{ fontWeight: "400", color: activeWallId === w.id ? "#aaa" : "#aaa", marginLeft: "5px" }}>
              {w.widthIn}"
            </span>
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>

          {/* View mode toggle */}
          <div style={{
            display: "flex", border: "1.5px solid #c8c4be", borderRadius: "7px",
            overflow: "hidden", flexShrink: 0,
          }}>
            {(["front", "top", "split"] as ViewMode[]).map((mode, idx) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                style={{
                  padding: "5px 11px", fontSize: "11px", fontWeight: "700",
                  borderRight: idx < 2 ? "1px solid #c8c4be" : "none",
                  border: "none",
                  backgroundColor: viewMode === mode ? "#1a1a1a" : "#fff",
                  color: viewMode === mode ? "#fff" : "#555",
                  cursor: "pointer",
                  borderRadius: 0,
                }}>
                {mode === "front" ? "↑ Front" : mode === "top" ? "⊞ Top" : "⊟ Split"}
              </button>
            ))}
          </div>

          <button onClick={() => router.push("/worksheet")}
            style={{ padding: "7px 18px", fontSize: "12px", fontWeight: "700", borderRadius: "6px",
              border: "none", backgroundColor: "#1a1a1a", color: "#fff", cursor: "pointer" }}>
            Worksheet →
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* Canvas */}
        <div style={{ flex: 1, padding: "28px 24px", overflowX: "auto", overflowY: "auto" }}>
          {activeWall && activeRun ? (
            <>
              {/* Info row */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "18px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: "800", color: "#1a1a1a", margin: 0 }}>
                  {wLabel(activeWall.id)}
                </h2>
                <span style={{ fontSize: "12px", color: "#888", backgroundColor: "#fff",
                  border: "1px solid #e5e0d8", borderRadius: "20px", padding: "3px 12px" }}>
                  {activeWall.widthIn}"
                  {activeRun.startIn > 0 || activeRun.endIn < activeWall.widthIn
                    ? ` · System ${(activeRun.endIn - activeRun.startIn).toFixed(1)}"`
                    : ""}
                  {" · "}{activeRun.panels.length + 2} panels · {activeRun.sections.length} section{activeRun.sections.length !== 1 ? "s" : ""}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}>
                  <span style={{ fontSize: "11px", color: "#bbb", marginRight: "4px" }}>
                    {viewMode === "top" ? "Plan view" : "Double-click to add panel"}
                  </span>
                  <button
                    onClick={() => setDesignZoom(z => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
                    title="Zoom out"
                    style={DZS.btn}>−</button>
                  <span style={DZS.pct}>{Math.round(designZoom * 100)}%</span>
                  <button
                    onClick={() => setDesignZoom(z => Math.min(2.5, Math.round((z + 0.1) * 10) / 10))}
                    title="Zoom in"
                    style={DZS.btn}>+</button>
                  <button
                    onClick={() => setDesignZoom(1)}
                    title="Reset zoom"
                    style={DZS.reset}>Reset</button>
                </div>
              </div>

              {/* Corner violation warnings */}
              {cornerConstraints.filter(c => c.wallId === activeWall.id && c.violated).map(cc => (
                <div key={cc.cornerKey} style={{
                  marginBottom: "10px", padding: "8px 14px", borderRadius: "8px",
                  backgroundColor: "#fef2f2", border: "1.5px solid #dc2626",
                  display: "flex", alignItems: "center", gap: "8px",
                }}>
                  <span style={{ fontSize: "14px" }}>⚠</span>
                  <span style={{ fontSize: "12px", color: "#991b1b", fontWeight: "600" }}>
                    Corner violation: {cc.side === "left" ? "left" : "right"} end must be clear by{" "}
                    <strong>{cc.cutbackIn}"</strong> ({cc.otherLabel} is full-length).{" "}
                    Current system {cc.side === "left" ? "starts" : "ends"} too{" "}
                    {cc.side === "left" ? "close to left wall" : "close to right wall"}.
                  </span>
                </div>
              ))}

              {/* ── View area ── */}
              {(viewMode === "front" || viewMode === "split") && (
                <>
                  {viewMode === "split" && (
                    <div style={{ fontSize: "10px", fontWeight: "700", color: "#aaa",
                      textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                      Front / Elevation
                    </div>
                  )}
                  <div style={{
                    display: "flex", justifyContent: "center",
                    backgroundColor: "#fff",
                    border: `1px solid ${cornerConstraints.some(c => c.wallId === activeWall.id && c.violated) ? "#dc2626" : "#e5e0d8"}`,
                    borderRadius: "12px", padding: "28px 16px 14px",
                    overflowX: "auto", touchAction: "none",
                  }}>
                    <WallCanvas
                      run={activeRun}
                      wall={activeWall}
                      sysH={sysH}
                      ceilingH={layout.ceilingHeightIn ?? 96}
                      selection={selection}
                      onSelect={setSelection}
                      onDragStart={(drag, e) => { e.preventDefault(); dragRef.current = drag; }}
                      onAddPanelAt={xIn => {
                        patchRun(activeWall.id, r => runAddPanel(r, xIn));
                        setSelection(null);
                      }}
                      cornerConstraints={cornerConstraints}
                      zoom={designZoom}
                    />
                  </div>
                  {/* Front view legend */}
                  <div style={{ marginTop: "8px", display: "flex", gap: "14px", flexWrap: "wrap", justifyContent: "center" }}>
                    {([
                      [C_ENDPANEL, "End panel (drag ↔)"],
                      [C_PANEL,    "Interior panel (drag ↔)"],
                      [C_LOCK,     "Lock shelf"],
                      [C_SHELF,    "Shelf (drag ↕)"],
                      [C_ROD,      "Rod (drag ↕)"],
                      [C_DRAWER,   "Drawers (drag ↕)"],
                    ] as [string, string][]).map(([color, label]) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                        <div style={{ width: "10px", height: "10px", backgroundColor: color, borderRadius: "2px",
                          border: "1px solid rgba(0,0,0,0.1)" }} />
                        <span style={{ fontSize: "11px", color: "#888" }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {(viewMode === "top" || viewMode === "split") && (
                <div style={{
                  marginTop: viewMode === "split" ? "20px" : "0",
                  backgroundColor: "#fff",
                  border: "1px solid #e5e0d8",
                  borderRadius: "12px",
                  overflow: "hidden",
                }}>
                  {/* Card header: label + sub-toggle (only in pure Top mode) */}
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 16px",
                    borderBottom: "1px solid #f0ece4",
                    backgroundColor: "#faf8f5",
                  }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "#888",
                      textTransform: "uppercase", letterSpacing: "0.6px" }}>
                      {viewMode === "split" ? "Top / Plan" : "Top View"}
                    </span>

                    {viewMode === "top" && (
                      <div style={{ display: "flex", borderRadius: "8px", overflow: "hidden",
                        border: "1.5px solid #c8c4be" }}>
                        <button
                          onClick={() => setTopSubMode("wall")}
                          style={{
                            padding: "5px 18px", fontSize: "12px", fontWeight: "700",
                            cursor: "pointer", borderRadius: 0,
                            borderRight: "1.5px solid #c8c4be",
                            borderTop: "none", borderBottom: "none", borderLeft: "none",
                            backgroundColor: topSubMode === "wall" ? "#1a1a1a" : "#fff",
                            color:           topSubMode === "wall" ? "#fff" : "#555",
                          }}>
                          Wall
                        </button>
                        <button
                          onClick={() => setTopSubMode("room")}
                          style={{
                            padding: "5px 18px", fontSize: "12px", fontWeight: "700",
                            cursor: "pointer", borderRadius: 0,
                            border: "none",
                            backgroundColor: topSubMode === "room" ? "#1a1a1a" : "#fff",
                            color:           topSubMode === "room" ? "#fff" : "#555",
                          }}>
                          Room
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Content area */}
                  <div style={{ padding: "16px", overflowX: "auto" }}>

                    {/* Wall top view */}
                    {topSubMode === "wall" && viewMode !== "split" && (
                      <>
                        <div style={{ display: "flex", justifyContent: "center" }}>
                          <WallTopView
                            run={activeRun}
                            wall={activeWall}
                            cornerConstraints={cornerConstraints}
                            zoom={designZoom}
                          />
                        </div>
                        <div style={{ marginTop: "10px", display: "flex", gap: "14px",
                          flexWrap: "wrap", justifyContent: "center" }}>
                          {([
                            ["rgba(195,155,100,0.40)", "Closet section (depth shown)"],
                            ["#b8956a",                "Panel"],
                            ["#eeebe6",                "Open wall / gap"],
                          ] as [string, string][]).map(([color, label]) => (
                            <div key={label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                              <div style={{ width: "10px", height: "10px", backgroundColor: color,
                                borderRadius: "2px", border: "1px solid rgba(0,0,0,0.1)" }} />
                              <span style={{ fontSize: "11px", color: "#888" }}>{label}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Room top view */}
                    {(topSubMode === "room" || viewMode === "split") && (
                      <>
                        <div style={{ display: "flex", justifyContent: "center" }}>
                          <RoomTopView
                            layout={layout}
                            runs={runs}
                            wallLabelMap={wallLabelMap}
                            usableWalls={usableWalls}
                            zoom={designZoom}
                          />
                        </div>
                        <div style={{ marginTop: "10px", display: "flex", gap: "14px",
                          flexWrap: "wrap", justifyContent: "center" }}>
                          {([
                            ["rgba(195,155,100,0.40)", "Closet footprint"],
                            ["#15803d",                "Wall with closet"],
                            ["#b07040",                "Wall — no closet"],
                            ["#9ca3af",                "Non-usable wall"],
                          ] as [string, string][]).map(([color, label]) => (
                            <div key={label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                              <div style={{ width: "10px", height: "10px", backgroundColor: color,
                                borderRadius: "2px", border: "1px solid rgba(0,0,0,0.1)" }} />
                              <span style={{ fontSize: "11px", color: "#888" }}>{label}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                  </div>
                </div>
              )}

              {/* Multi-wall summary */}
              {usableWalls.length > 1 && (
                <div style={{ marginTop: "18px", backgroundColor: "#fff", border: "1px solid #e5e0d8",
                  borderRadius: "10px", padding: "14px 16px" }}>
                  <p style={{ fontSize: "11px", fontWeight: "700", color: "#888",
                    textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 10px" }}>
                    All Walls
                  </p>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {usableWalls.map(w => {
                      const r = runs.find(r => r.wallId === w.id);
                      const isAct = w.id === activeWallId;
                      const hasViolation = cornerConstraints.some(c => c.wallId === w.id && c.violated);
                      return (
                        <div key={w.id}
                          onClick={() => { setActiveWallId(w.id); setSelection(null); }}
                          style={{ padding: "8px 14px", borderRadius: "8px", cursor: "pointer",
                            border: `1.5px solid ${hasViolation ? "#dc2626" : isAct ? "#1a1a1a" : "#e5e0d8"}`,
                            backgroundColor: isAct ? "#f7f5f0" : "transparent" }}>
                          <div style={{ fontSize: "12px", fontWeight: "700", color: isAct ? "#1a1a1a" : "#555", display: "flex", gap: "5px", alignItems: "center" }}>
                            {wLabel(w.id)}
                            {hasViolation && <span style={{ fontSize: "9px", color: "#dc2626" }}>⚠</span>}
                          </div>
                          <div style={{ fontSize: "11px", color: "#aaa" }}>
                            {w.widthIn}" · {r?.sections.length ?? 0}§
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: "#aaa", textAlign: "center", paddingTop: "80px" }}>
              Select a wall above to start designing.
            </div>
          )}
        </div>

        {/* Inspector */}
        <div style={{
          width: "296px", flexShrink: 0, borderLeft: "1px solid #e5e0d8", backgroundColor: "#fff",
          display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 100px)", overflow: "hidden",
        }}>
          <div style={{
            padding: "11px 16px", borderBottom: "1px solid #f0ece4", flexShrink: 0,
            fontSize: "11px", fontWeight: "700", color: "#999",
            textTransform: "uppercase", letterSpacing: "0.6px",
          }}>
            Inspector
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            <Inspector
              selection={selection} run={activeRun} wall={activeWall}
              sysH={sysH} ceilingH={layout.ceilingHeightIn ?? 96}
              onUpdateSection={(secId, u) => {
                if (activeWallId) patchRun(activeWallId, r => runUpdateSection(r, secId, u));
              }}
              onAddComp={(secId, type) => {
                if (activeWallId) patchRun(activeWallId, r => runAddComp(r, secId, type, sysH));
              }}
              onUpdateComp={(secId, compId, u) => {
                if (activeWallId) patchRun(activeWallId, r => runUpdateComp(r, secId, compId, u));
              }}
              onDeleteComp={(secId, compId) => {
                if (activeWallId) patchRun(activeWallId, r => runDeleteComp(r, secId, compId));
              }}
              onRemovePanel={panelId => {
                if (activeWallId) patchRun(activeWallId, r => runRemovePanel(r, panelId));
              }}
              onUpdatePanel={(panelId, u) => {
                if (activeWallId) patchRun(activeWallId, r => runUpdatePanel(r, panelId, u));
              }}
              onUpdateEndPanel={(side, heightIn) => {
                if (activeWallId) patchRun(activeWallId, r => runUpdateEndPanel(r, side, heightIn));
              }}
              onSetPanelDepth={(leftSecId, rightSecId, depth) => {
                if (activeWallId) patchRun(activeWallId, r => runSetPanelDepth(r, leftSecId, rightSecId, depth));
              }}
              onAddPanel={secId => {
                if (!activeWallId || !activeRun) return;
                const si = activeRun.sections.findIndex(s => s.id === secId);
                if (si === -1) return;
                const lx = secLeft(activeRun.panels, activeRun.startIn, si);
                const sw = secWidth(activeRun.panels, activeRun.startIn, activeRun.endIn, si);
                patchRun(activeWallId, r => runAddPanel(r, lx + sw / 2));
              }}
              onClearSel={() => setSelection(null)}
              onUpdateObstacle={(obsId, u) => {
                if (activeWallId) patchRun(activeWallId, r => runUpdateObstacle(r, obsId, u));
              }}
              onDeleteObstacle={obsId => {
                if (activeWallId) patchRun(activeWallId, r => runDeleteObstacle(r, obsId));
              }}
              onAddObstacle={type => {
                if (!activeWallId || !activeWall || !layout) return;
                patchRun(activeWallId, r => runAddObstacle(r, type, activeWall.widthIn, layout.ceilingHeightIn ?? 96));
              }}
              onUpdateCeilingProfile={p => {
                if (activeWallId) patchRun(activeWallId, r => runUpdateCeilingProfile(r, p));
              }}
            />
          </div>

          {/* Section chips footer */}
          {activeRun && activeWall && (
            <div style={{ borderTop: "1px solid #f0ece4", padding: "10px 14px",
              flexShrink: 0, backgroundColor: "#faf8f5" }}>
              <p style={{ fontSize: "10px", fontWeight: "700", color: "#aaa",
                textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 6px" }}>
                Sections
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {activeRun.sections.map((sec, i) => {
                  const sw    = secWidth(activeRun.panels, activeRun.startIn, activeRun.endIn, i);
                  const isSel = selection?.kind === "section" && selection.secId === sec.id;
                  return (
                    <div key={sec.id}
                      onClick={() => setSelection({ kind: "section", secId: sec.id })}
                      style={{
                        padding: "4px 10px", borderRadius: "20px", cursor: "pointer", fontSize: "11px",
                        fontWeight: isSel ? "700" : "500",
                        border: `1.5px solid ${isSel ? C_SELECT : "#e0dbd2"}`,
                        backgroundColor: isSel ? "#eff4ff" : "#fff",
                        color: isSel ? C_SELECT : "#555",
                      }}>
                      §{i + 1} · {sw.toFixed(0)}"
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add Obstacle footer */}
          {activeRun && activeWall && (
            <div style={{ borderTop: "1px solid #f0ece4", padding: "10px 14px",
              flexShrink: 0, backgroundColor: "#faf8f5" }}>
              <p style={{ fontSize: "10px", fontWeight: "700", color: "#aaa",
                textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 6px" }}>
                Add Obstacle
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {(["LightSwitch", "Outlet", "Window", "Unknown"] as ObstacleType[]).map(type => {
                  const labels: Record<ObstacleType, string> = {
                    LightSwitch: "Switch", Outlet: "Outlet", Window: "Window", Unknown: "Other",
                  };
                  return (
                    <button key={type}
                      onClick={() => {
                        if (!activeWallId || !activeWall || !layout) return;
                        patchRun(activeWallId, r => runAddObstacle(r, type, activeWall.widthIn, layout.ceilingHeightIn ?? 96));
                      }}
                      style={{
                        padding: "4px 10px", borderRadius: "20px", cursor: "pointer", fontSize: "11px",
                        fontWeight: "600", border: `1.5px solid ${OBS_STROKE[type]}`,
                        backgroundColor: OBS_FILL[type], color: OBS_STROKE[type],
                      }}>
                      + {labels[type]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Full-Length Walls footer */}
          {usableWalls.length > 1 && (
            <div style={{ borderTop: "1px solid #f0ece4", padding: "10px 14px",
              flexShrink: 0, backgroundColor: "#faf8f5" }}>
              <p style={{ fontSize: "10px", fontWeight: "700",
                color: anyViolations ? "#dc2626" : "#aaa",
                textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 8px",
                display: "flex", alignItems: "center", gap: "5px" }}>
                {anyViolations && <span>⚠</span>}
                Full-Length Walls
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px" }}>
                {usableWalls.map(w => {
                  const isFull = fullLengthWalls.includes(w.id);
                  return (
                    <button key={w.id}
                      onClick={() => setFullLengthWalls(prev =>
                        isFull ? prev.filter(id => id !== w.id) : [...prev, w.id]
                      )}
                      style={{
                        padding: "4px 10px", fontSize: "10px", fontWeight: "700",
                        borderRadius: "4px", cursor: "pointer",
                        border: `1.5px solid ${isFull ? "#1a1a1a" : "#c8c4be"}`,
                        backgroundColor: isFull ? "#1a1a1a" : "#fff",
                        color: isFull ? "#fff" : "#666",
                      }}>
                      {wLabel(w.id)}
                    </button>
                  );
                })}
              </div>
              {cornerConstraints.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {cornerConstraints.map(cc => (
                    <div key={cc.cornerKey} style={{
                      fontSize: "10px", padding: "5px 8px", borderRadius: "4px",
                      border: `1px solid ${cc.violated ? "#dc2626" : "#e0dbd2"}`,
                      backgroundColor: cc.violated ? "#fef2f2" : "#fff",
                      color: cc.violated ? "#991b1b" : "#666",
                      fontWeight: cc.violated ? "700" : "400",
                    }}>
                      {cc.violated && "⚠ "}
                      {wLabel(cc.wallId)} {cc.side === "left" ? "left" : "right"} needs{" "}
                      <strong>{cc.cutbackIn}"</strong> clear · {cc.otherLabel} full
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
