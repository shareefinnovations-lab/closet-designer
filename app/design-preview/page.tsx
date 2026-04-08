"use client";
// app/design-preview/page.tsx — Final Design Preview (client-facing, read-only)
//
// Sits between the Worksheet and the Price Presentation.
// Shows every designed wall as a clean elevation + the full room top-view plan.
// No editing controls, no inspector, no drag handles — pure presentation.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getActiveProjectId, saveCurrentProject } from "@/app/_lib/projects";
import type { RoomLayout, RoomSegment } from "@/app/_lib/room-types";
import { getSelectedWalls } from "@/app/_lib/room-types";
import {
  type Point, computePoints, segStart, isClosed,
  computeTransform, computeSignedArea, makeWallPtFn, buildRoomPath,
} from "@/app/_lib/room-geo";

// ─── Types (mirrored from design page) ───────────────────────────────────────

type CompType     = "Shelf" | "Rod" | "DrawerStack" | "Door";
type ObstacleType = "LightSwitch" | "Outlet" | "Window" | "Unknown";

interface ClosetComp {
  id:            number;
  type:          CompType;
  positionIn:    number;
  drawerHeights: number[];
  doorHeightIn?: number;
  doorFlipped?:  boolean;
}

interface Obstacle {
  id:   number;
  type: ObstacleType;
  xIn:  number;
  yIn:  number;
  wIn:  number;
  hIn:  number;
}

interface Panel   { id: number; xIn: number; heightIn?: number; }
interface Section { id: number; depthIn: number; comps: ClosetComp[]; }

type CeilingProfile =
  | { type: "flat";            heightIn: number }
  | { type: "slope";           leftHeightIn: number; rightHeightIn: number }
  | { type: "flat_then_slope"; flatLengthIn: number; flatHeightIn: number; endHeightIn: number };

interface WallRun {
  wallId:              string;
  startIn:             number;
  endIn:               number;
  panels:              Panel[];
  sections:            Section[];
  obstacles:           Obstacle[];
  leftPanelHeightIn?:  number;
  rightPanelHeightIn?: number;
  ceilingProfile?:     CeilingProfile;
}

interface DesignStateV2 { v: 2; runs: WallRun[]; }

// ─── Drawing constants (same as design editor) ────────────────────────────────

const SCALE      = 6;
const PANEL_W_IN = 0.75;
const PANEL_W_PX = PANEL_W_IN * SCALE;
const LOCK_H_IN  = 1;
const LOCK_H_PX  = LOCK_H_IN * SCALE;
const PAD_TOP    = 40;
const PAD_BOT    = 36;
const H_PAD      = 44;

// Colors — identical to design editor for visual consistency
const C_PANEL    = "#b8956a";
const C_PANEL_BD = "#5c3d1e";
const C_ENDPANEL = "#8b7355";
const C_LOCK     = "#7a8a96";
const C_LOCK_BD  = "#4a5a66";
const C_SHELF    = "#c4935a";
const C_SHELF_BD = "#8b6437";
const C_ROD      = "#7a5230";
const C_DRAWER   = "#d4b896";
const C_DRAWER_BD= "#8b6437";
const C_DOOR     = "#a8c8e8";
const C_DOOR_BD  = "#5a8ab0";
const C_DIM      = "#555";
const C_INT      = "#f5f0e8";
const C_GAP      = "#e2ddd7";
const C_INT_BD   = "#d4cfc8";
const C_HANGER   = "#9a6840";

const OBS_FILL: Record<ObstacleType, string>   = { LightSwitch:"#d0d8e4", Outlet:"#d8d4cc", Window:"#b8d4e8", Unknown:"#e4d4b0" };
const OBS_STROKE: Record<ObstacleType, string> = { LightSwitch:"#6a7a90", Outlet:"#7a7060", Window:"#4a80a8", Unknown:"#9a8050" };
const OBS_LABEL: Record<ObstacleType, string>  = { LightSwitch:"SW",      Outlet:"OUT",     Window:"WIN",     Unknown:"?" };

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function secLeft(panels: Panel[], startIn: number, i: number): number {
  return i === 0 ? startIn : panels[i - 1].xIn + PANEL_W_IN;
}
function secWidth(panels: Panel[], startIn: number, endIn: number, i: number): number {
  const l = secLeft(panels, startIn, i);
  const r = i === panels.length ? endIn : panels[i].xIn;
  return Math.max(0, r - l);
}
function panelH(panel: Panel, sysH: number): number {
  return panel.heightIn ?? sysH;
}
function sectionEffH(run: WallRun, si: number, sysH: number): number {
  const leftH  = si === 0               ? (run.leftPanelHeightIn  ?? sysH) : panelH(run.panels[si-1], sysH);
  const rightH = si === run.panels.length ? (run.rightPanelHeightIn ?? sysH) : panelH(run.panels[si],   sysH);
  return Math.min(leftH, rightH);
}
function compHeight(comp: ClosetComp): number {
  if (comp.type === "DrawerStack") return comp.drawerHeights.reduce((a,b) => a+b, 0);
  if (comp.type === "Door")        return comp.doorHeightIn ?? 80;
  return 1;
}

function ceilingAtX(xIn: number, runW: number, profile: CeilingProfile): number {
  switch (profile.type) {
    case "flat": return profile.heightIn;
    case "slope": {
      const t = runW > 0 ? Math.max(0, Math.min(1, xIn/runW)) : 0;
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

function buildWallLabelMap(walls: ReturnType<typeof getSelectedWalls>): Map<string, string> {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const map = new Map<string, string>();
  walls.forEach((w, i) => map.set(w.id, `Wall ${letters[i] ?? String(i+1)}`));
  return map;
}

// ─── PreviewElevation ─────────────────────────────────────────────────────────
// Read-only wall elevation. No event handlers on any design element.

const PREV_DRAW_MAX_W = 820;
const PREV_H_MAX      = 540;

function PreviewElevation({
  run, wallWidthIn, sysH, ceilingH, label,
}: {
  run:         WallRun;
  wallWidthIn: number;
  sysH:        number;
  ceilingH:    number;
  label:       string;
}) {
  const wallW  = wallWidthIn * SCALE;
  const wallH  = ceilingH * SCALE;
  const svgW   = wallW + H_PAD * 2 + 16;
  const svgH   = PAD_TOP + wallH + PAD_BOT;
  const sysX   = H_PAD + run.startIn * SCALE;
  const sysW   = (run.endIn - run.startIn) * SCALE;
  const TOP_Y  = PAD_TOP;

  // Auto-scale to fit the preview card
  const zW   = Math.min(1, PREV_DRAW_MAX_W / (wallW + 16));
  const zH   = Math.min(1, PREV_H_MAX / svgH);
  const zoom = Math.min(zW, zH);

  function floorY(posIn: number) { return TOP_Y + wallH - posIn * SCALE; }

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={svgW * zoom} height={svgH * zoom}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ display: "block", userSelect: "none" }}>

        {/* ── Height ruler ── */}
        <g pointerEvents="none">
          <line x1={H_PAD-6} y1={TOP_Y} x2={H_PAD-6} y2={TOP_Y+wallH} stroke="#ddd" strokeWidth={1} />
          {Array.from({ length: Math.floor(ceilingH/12)+1 }, (_,i) => {
            const hIn = i*12;
            if (hIn > ceilingH) return null;
            const yPx = floorY(hIn);
            const atSys = hIn === sysH;
            return (
              <g key={i} pointerEvents="none">
                <line x1={H_PAD-10} y1={yPx} x2={H_PAD-6} y2={yPx}
                  stroke={atSys?"#c8a060":"#ccc"} strokeWidth={atSys?1.5:1} />
                {hIn !== ceilingH && (
                  <text x={H_PAD-13} y={yPx+4} textAnchor="end" fontSize={9}
                    fill={atSys?"#c8a060":"#aaa"} fontWeight={atSys?"700":"400"}>
                    {hIn}"
                  </text>
                )}
              </g>
            );
          })}
          <text x={H_PAD-13} y={floorY(ceilingH)+4} textAnchor="end" fontSize={9} fill="#555" fontWeight="700">
            {ceilingH}"
          </text>
        </g>

        {/* ── Wall background ── */}
        <rect x={H_PAD} y={TOP_Y} width={wallW} height={wallH}
          fill={C_GAP} stroke={C_INT_BD} strokeWidth={1} />

        {/* ── Active system background ── */}
        <rect x={sysX} y={TOP_Y} width={sysW} height={wallH}
          fill={C_INT} stroke="none" />

        {/* ── Ceiling profile overlay ── */}
        {run.ceilingProfile && (() => {
          const runW = run.endIn - run.startIn;
          const steps = 60;
          const top = Array.from({ length: steps+1 }, (_,i) => {
            const x = (i/steps)*runW;
            const h = ceilingAtX(x, runW, run.ceilingProfile!);
            return `${(sysX+x*SCALE).toFixed(1)},${floorY(h).toFixed(1)}`;
          });
          const bot = `${(sysX+runW*SCALE).toFixed(1)},${TOP_Y} ${sysX.toFixed(1)},${TOP_Y}`;
          return (
            <polygon points={`${top.join(" ")} ${bot}`}
              fill="rgba(100,100,180,0.07)" stroke="#8888cc" strokeWidth={1}
              strokeDasharray="5 3" pointerEvents="none" />
          );
        })()}

        {/* ── Sections (lock shelves + components) ── */}
        {run.sections.map((sec, si) => {
          const lxIn  = secLeft(run.panels, run.startIn, si);
          const sw    = secWidth(run.panels, run.startIn, run.endIn, si);
          const xPx   = H_PAD + lxIn * SCALE;
          const wPx   = sw * SCALE;
          const effH  = sectionEffH(run, si, sysH);
          const topY  = floorY(effH);

          return (
            <g key={sec.id} pointerEvents="none">
              {/* Top lock shelf */}
              <rect x={xPx} y={topY} width={wPx} height={LOCK_H_PX}
                fill={C_LOCK} stroke={C_LOCK_BD} strokeWidth={0.5} opacity={0.8} />
              {/* Bottom lock shelf */}
              <rect x={xPx} y={TOP_Y+wallH-LOCK_H_PX} width={wPx} height={LOCK_H_PX}
                fill={C_LOCK} stroke={C_LOCK_BD} strokeWidth={0.5} opacity={0.8} />

              {/* Components */}
              {sec.comps.map(comp => {
                const cH   = compHeight(comp);
                const cYPx = floorY(comp.positionIn + cH);

                if (comp.type === "Shelf") return (
                  <g key={comp.id}>
                    <rect x={xPx} y={cYPx} width={wPx} height={SCALE}
                      fill={C_SHELF} stroke={C_SHELF_BD} strokeWidth={1} />
                    <rect x={xPx} y={cYPx-3} width={3} height={SCALE+6}
                      fill={C_PANEL_BD} opacity={0.35} />
                    <rect x={xPx+wPx-3} y={cYPx-3} width={3} height={SCALE+6}
                      fill={C_PANEL_BD} opacity={0.35} />
                  </g>
                );

                if (comp.type === "Rod") {
                  const rodY = cYPx + 3;
                  const hangH = Math.max(0, TOP_Y+wallH-LOCK_H_PX - (cYPx+SCALE));
                  const cnt = Math.max(2, Math.min(8, Math.floor(wPx/18)));
                  const xs = Array.from({length:cnt}, (_,i) =>
                    xPx+8+(cnt===1?0:i*(wPx-16)/(cnt-1)));
                  return (
                    <g key={comp.id}>
                      <rect x={xPx} y={cYPx+SCALE} width={wPx} height={hangH}
                        fill={C_ROD} opacity={0.04} />
                      {xs.map((hx,i) => (
                        <g key={i} stroke={C_HANGER} strokeWidth={1} fill="none" opacity={0.45}>
                          <path d={`M ${hx} ${rodY} Q ${hx+3} ${rodY-4} ${hx+5} ${rodY}`} strokeWidth={1.5}/>
                          <line x1={hx} y1={rodY} x2={hx} y2={rodY+7}/>
                          <line x1={hx} y1={rodY+7} x2={hx-8} y2={rodY+16}/>
                          <line x1={hx} y1={rodY+7} x2={hx+8} y2={rodY+16}/>
                          <line x1={hx-8} y1={rodY+16} x2={hx+8} y2={rodY+16}/>
                        </g>
                      ))}
                      <line x1={xPx} y1={rodY} x2={xPx+wPx} y2={rodY}
                        stroke={C_ROD} strokeWidth={4} strokeLinecap="butt" />
                      <rect x={xPx} y={rodY-5} width={3} height={10} fill={C_ROD} />
                      <rect x={xPx+wPx-3} y={rodY-5} width={3} height={10} fill={C_ROD} />
                    </g>
                  );
                }

                if (comp.type === "DrawerStack") {
                  let dyAcc = 0;
                  return (
                    <g key={comp.id}>
                      {comp.drawerHeights.map((dh, di) => {
                        const dyPx = floorY(comp.positionIn + dyAcc + dh);
                        dyAcc += dh;
                        return (
                          <g key={di}>
                            <rect x={xPx} y={dyPx} width={wPx} height={dh*SCALE}
                              fill={C_DRAWER} stroke={C_DRAWER_BD} strokeWidth={1} />
                            <line x1={xPx+8} y1={dyPx+dh*SCALE/2} x2={xPx+wPx-8} y2={dyPx+dh*SCALE/2}
                              stroke={C_DRAWER_BD} strokeWidth={0.5} opacity={0.5} />
                            <circle cx={xPx+wPx/2} cy={dyPx+dh*SCALE/2} r={3}
                              fill={C_DRAWER_BD} opacity={0.5} />
                          </g>
                        );
                      })}
                    </g>
                  );
                }

                if (comp.type === "Door") {
                  const dh2     = comp.doorHeightIn ?? 80;
                  const dhPx    = dh2 * SCALE;
                  const dyPx    = floorY(comp.positionIn + dh2);
                  const flipped = comp.doorFlipped ?? false;
                  const hxPx    = xPx + wPx * (flipped ? 0.20 : 0.80);
                  return (
                    <g key={comp.id} pointerEvents="none">
                      {/* Door panel */}
                      <rect x={xPx} y={dyPx} width={wPx} height={dhPx}
                        fill={C_DOOR} opacity={0.50} stroke={C_DOOR_BD} strokeWidth={1.5} rx={1} />
                      {/* Inner frame rails */}
                      <line x1={xPx+4} y1={dyPx+8} x2={xPx+wPx-4} y2={dyPx+8}
                        stroke={C_DOOR_BD} strokeWidth={1} opacity={0.35} />
                      <line x1={xPx+4} y1={dyPx+dhPx-8} x2={xPx+wPx-4} y2={dyPx+dhPx-8}
                        stroke={C_DOOR_BD} strokeWidth={1} opacity={0.35} />
                      {/* Handle */}
                      <line x1={hxPx} y1={dyPx+dhPx*0.42} x2={hxPx} y2={dyPx+dhPx*0.58}
                        stroke={C_DOOR_BD} strokeWidth={3} strokeLinecap="round" />
                      <circle cx={hxPx} cy={dyPx+dhPx*0.5} r={3} fill={C_DOOR_BD} opacity={0.75} />
                      {/* Height label */}
                      <text x={xPx+wPx/2} y={dyPx+dhPx/2+4}
                        textAnchor="middle" fontSize={8} fill={C_DOOR_BD} fontWeight="600">
                        {dh2}"
                      </text>
                    </g>
                  );
                }

                return null;
              })}

              {/* Section width label */}
              <text x={xPx+wPx/2} y={TOP_Y+wallH+22}
                textAnchor="middle" fontSize={10} fill={C_DIM}>
                {sw.toFixed(1)}"
              </text>
            </g>
          );
        })}

        {/* ── Obstacles ── */}
        {(run.obstacles ?? []).map(obs => {
          const xPx = H_PAD + obs.xIn * SCALE;
          const yPx = floorY(obs.yIn + obs.hIn);
          const wPx = obs.wIn * SCALE;
          const hPx = obs.hIn * SCALE;
          return (
            <g key={obs.id} pointerEvents="none">
              <rect x={xPx} y={yPx} width={wPx} height={hPx}
                fill={OBS_FILL[obs.type]} stroke={OBS_STROKE[obs.type]}
                strokeWidth={1.5} strokeDasharray="4 2" rx={2} opacity={0.85} />
              <text x={xPx+wPx/2} y={yPx+hPx/2+4}
                textAnchor="middle" fontSize={Math.min(10, hPx*0.38)}
                fill={OBS_STROKE[obs.type]} fontWeight="700">
                {OBS_LABEL[obs.type]}
              </text>
            </g>
          );
        })}

        {/* ── Interior panels ── */}
        {run.panels.map(panel => {
          const xPx    = H_PAD + panel.xIn * SCALE;
          const pH     = panelH(panel, sysH);
          const pHPx   = pH * SCALE;
          const panTopY = TOP_Y + wallH - pHPx;
          return (
            <g key={panel.id} pointerEvents="none">
              <rect x={xPx} y={panTopY} width={PANEL_W_PX} height={pHPx}
                fill={C_PANEL} stroke={C_PANEL_BD} strokeWidth={1} />
              {panel.heightIn !== undefined && (
                <text x={xPx+PANEL_W_PX/2} y={panTopY-5}
                  textAnchor="middle" fontSize={8} fill={C_PANEL_BD} fontWeight="700">
                  {panel.heightIn}"
                </text>
              )}
            </g>
          );
        })}

        {/* ── Left end panel ── */}
        {(() => {
          const lpH    = run.leftPanelHeightIn ?? sysH;
          const lpTopY = TOP_Y + wallH - lpH * SCALE;
          return (
            <g pointerEvents="none">
              <rect x={sysX} y={lpTopY} width={PANEL_W_PX} height={lpH*SCALE}
                fill={C_ENDPANEL} stroke={C_PANEL_BD} strokeWidth={1} />
              {run.leftPanelHeightIn !== undefined && (
                <text x={sysX+PANEL_W_PX/2} y={lpTopY-5}
                  textAnchor="middle" fontSize={8} fill={C_PANEL_BD} fontWeight="700">
                  {lpH}"
                </text>
              )}
            </g>
          );
        })()}

        {/* ── Right end panel ── */}
        {(() => {
          const rpH    = run.rightPanelHeightIn ?? sysH;
          const rpX    = sysX + sysW - PANEL_W_PX;
          const rpTopY = TOP_Y + wallH - rpH * SCALE;
          return (
            <g pointerEvents="none">
              <rect x={rpX} y={rpTopY} width={PANEL_W_PX} height={rpH*SCALE}
                fill={C_ENDPANEL} stroke={C_PANEL_BD} strokeWidth={1} />
              {run.rightPanelHeightIn !== undefined && (
                <text x={rpX+PANEL_W_PX/2} y={rpTopY-5}
                  textAnchor="middle" fontSize={8} fill={C_PANEL_BD} fontWeight="700">
                  {rpH}"
                </text>
              )}
            </g>
          );
        })()}

        {/* ── Header labels ── */}
        <text x={H_PAD+wallW/2} y={TOP_Y-22}
          textAnchor="middle" fontSize={12} fill="#888" fontWeight="600">
          {wallWidthIn}"
        </text>
        {/* System span bracket */}
        <text x={sysX+sysW/2} y={TOP_Y-10}
          textAnchor="middle" fontSize={11} fill={C_DIM} fontWeight="700">
          System: {(run.endIn-run.startIn).toFixed(1)}"
        </text>
        <line x1={sysX} y1={TOP_Y-5} x2={sysX+sysW} y2={TOP_Y-5}
          stroke="#bbb" strokeWidth={1} />
        <line x1={sysX} y1={TOP_Y-8} x2={sysX} y2={TOP_Y-2}
          stroke="#bbb" strokeWidth={1} />
        <line x1={sysX+sysW} y1={TOP_Y-8} x2={sysX+sysW} y2={TOP_Y-2}
          stroke="#bbb" strokeWidth={1} />

        {/* Gap labels */}
        {run.startIn > 0.5 && (
          <text x={H_PAD+(run.startIn*SCALE)/2} y={TOP_Y+wallH/2}
            textAnchor="middle" fontSize={10} fill="#aaa"
            transform={`rotate(-90,${H_PAD+(run.startIn*SCALE)/2},${TOP_Y+wallH/2})`}>
            {run.startIn.toFixed(1)}" gap
          </text>
        )}
        {wallWidthIn-run.endIn > 0.5 && (
          <text
            x={H_PAD+run.endIn*SCALE+(wallWidthIn-run.endIn)*SCALE/2}
            y={TOP_Y+wallH/2}
            textAnchor="middle" fontSize={10} fill="#aaa"
            transform={`rotate(-90,${H_PAD+run.endIn*SCALE+(wallWidthIn-run.endIn)*SCALE/2},${TOP_Y+wallH/2})`}>
            {(wallWidthIn-run.endIn).toFixed(1)}" gap
          </text>
        )}

      </svg>
    </div>
  );
}

// ─── PreviewRoomTopView ───────────────────────────────────────────────────────
// Read-only full-room plan view: perimeter + all closet footprints.

const RTV_W   = 600;
const RTV_H   = 440;
const RTV_PAD = 56;
const TV_PW   = 0.75; // panel width in inches for top-view

function PreviewRoomTopView({
  layout, runs, wallLabelMap,
}: {
  layout:       RoomLayout;
  runs:         WallRun[];
  wallLabelMap: Map<string, string>;
}) {
  // Resolve segments (same priority as design page RoomTopView)
  let segments: RoomSegment[] = (layout.segments ?? []).slice();
  if (segments.length === 0) {
    const legacyWalls = layout.walls ?? [];
    if (legacyWalls.length > 0) {
      segments = legacyWalls.map(w => ({
        id: w.id, label: w.label, lengthIn: w.widthIn, direction: "right" as const,
        usable: w.usable, selectedForDesign: w.usable, canHaveCabinetry: w.usable,
        hasWindow: w.hasOpening, hasDoor: false, hasObstacle: false, notes: "",
      }));
    }
  }

  if (segments.length === 0) {
    return (
      <svg width={RTV_W} height={RTV_H}
        style={{ display:"block", backgroundColor:"#f7f4ef", borderRadius:"10px",
          border:"1px solid #d8d0c8" }}>
        <text x={RTV_W/2} y={RTV_H/2} textAnchor="middle" fontSize={13} fill="#aaa">
          No room layout defined.
        </text>
      </svg>
    );
  }

  // All geometry via shared room-geo module — identical pipeline to Design page RoomTopView.
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

  function segLen(seg: typeof segments[0]): number {
    if (seg.dxIn !== undefined && seg.dyIn !== undefined)
      return Math.sqrt(seg.dxIn**2 + seg.dyIn**2);
    return seg.lengthIn;
  }

  return (
    <svg width={RTV_W} height={RTV_H}
      style={{ display:"block", userSelect:"none",
        backgroundColor:"#f7f4ef", borderRadius:"10px", border:"1px solid #d8d0c8" }}>

      <text x={RTV_W/2} y={18} textAnchor="middle" fontSize={10} fill="#888" fontWeight="700"
        letterSpacing="0.5">
        FULL ROOM PLAN
      </text>

      {/* Room fill */}
      {closed && (
        <path d={buildRoomPath(segments, pts, closed, tx, ty)} fill="rgba(255,255,255,0.70)" />
      )}

      {/* Closet footprints */}
      {runs.map(run => {
        const si = segments.findIndex(s => s.id === run.wallId);
        if (si < 0 || si >= pts.length - 1 || run.sections.length === 0) return null;
        const fd = (d: number) => segments[si].footprintFlipped ? -d : d;
        return (
          <g key={run.wallId} pointerEvents="none">
            {run.sections.map((sec, sIdx) => {
              const lx = sIdx === 0 ? run.startIn : run.panels[sIdx-1].xIn + TV_PW;
              const rx = sIdx === run.panels.length ? run.endIn : run.panels[sIdx].xIn;
              if (rx <= lx) return null;
              const a = wallPt(si, lx, 0),          b = wallPt(si, rx, 0);
              const c = wallPt(si, rx, fd(sec.depthIn)), d = wallPt(si, lx, fd(sec.depthIn));
              return (
                <polygon key={sec.id} points={ptStr(a, b, c, d)}
                  fill="rgba(195,155,100,0.30)" stroke="#c4935a" strokeWidth={0.75} />
              );
            })}
            {run.panels.map((panel, pi) => {
              const lD = run.sections[pi]?.depthIn ?? 12;
              const rD = run.sections[pi+1]?.depthIn ?? 12;
              const mD = Math.max(lD, rD);
              const a = wallPt(si, panel.xIn, 0),            b = wallPt(si, panel.xIn + TV_PW, 0);
              const c = wallPt(si, panel.xIn + TV_PW, fd(mD)), d = wallPt(si, panel.xIn, fd(mD));
              return (
                <polygon key={panel.id} points={ptStr(a, b, c, d)}
                  fill="#b8956a" stroke="#8b6437" strokeWidth={0.5} />
              );
            })}
            {(() => {
              const d0 = run.sections[0]?.depthIn ?? 12;
              const dN = run.sections[run.sections.length-1]?.depthIn ?? 12;
              const la = wallPt(si, run.startIn, 0),               lb = wallPt(si, run.startIn + TV_PW, 0);
              const lc = wallPt(si, run.startIn + TV_PW, fd(d0)),   ld = wallPt(si, run.startIn, fd(d0));
              const ra = wallPt(si, run.endIn - TV_PW, 0),          rb = wallPt(si, run.endIn, 0);
              const rc = wallPt(si, run.endIn, fd(dN)),              rd = wallPt(si, run.endIn - TV_PW, fd(dN));
              return (
                <>
                  <polygon points={ptStr(la, lb, lc, ld)} fill="#b8956a" stroke="#8b6437" strokeWidth={1} />
                  <polygon points={ptStr(ra, rb, rc, rd)} fill="#b8956a" stroke="#8b6437" strokeWidth={1} />
                </>
              );
            })()}
            {(() => {
              const [wx1, wy1] = segStart(segments, pts, si);
              const [wx2, wy2] = pts[si + 1] ?? pts[si];
              const wl = Math.sqrt((wx2 - wx1) ** 2 + (wy2 - wy1) ** 2);
              if (wl < 0.01) return null;
              const depthAngle = (Math.atan2((wy2 - wy1) / wl, (wx2 - wx1) / wl) * 180 / Math.PI) - 90;
              const d0 = run.sections[0]?.depthIn ?? 12;
              const dN = run.sections[run.sections.length - 1]?.depthIn ?? 12;
              type PD = { mid: number; depth: number; key: string };
              const items: PD[] = [];
              items.push({ mid: run.startIn + TV_PW / 2, depth: d0, key: 'lep' });
              run.panels.forEach((panel, pi) => {
                const lD = run.sections[pi]?.depthIn ?? 12;
                const rD = run.sections[pi + 1]?.depthIn ?? 12;
                items.push({ mid: panel.xIn + TV_PW / 2, depth: Math.max(lD, rD), key: `ip${panel.id}` });
              });
              items.push({ mid: run.endIn - TV_PW / 2, depth: dN, key: 'rep' });
              return items.map(({ mid, depth, key }) => {
                const [mx, my] = wallPt(si, mid, fd(depth / 2));
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

      {/* Open shape dashed line */}
      {!closed && pts.length > 1 && (
        <line
          x1={tx(pts[pts.length-1][0])} y1={ty(pts[pts.length-1][1])}
          x2={tx(pts[0][0])}            y2={ty(pts[0][1])}
          stroke="#dc2626" strokeWidth={1} strokeDasharray="5 3" opacity={0.35} />
      )}

      {/* Wall segments + labels */}
      {segments.map((seg, i) => {
        if (i >= pts.length - 1) return null;
        const [x1, y1] = segStart(segments, pts, i);
        const [x2, y2] = pts[i + 1];
        const sx1 = tx(x1), sy1 = ty(y1), sx2 = tx(x2), sy2 = ty(y2);
        const hasClos = runs.some(r => r.wallId === seg.id);
        const color   = !seg.usable ? "#9ca3af" : hasClos ? "#15803d" : "#a07040";
        const sw2     = hasClos ? 3 : seg.usable ? 1.5 : 1;

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

        const dxL = sx2 - sx1, dyL = sy2 - sy1;
        const sl  = Math.sqrt(dxL*dxL + dyL*dyL) || 1;
        const nx  = -dyL/sl, ny = dxL/sl;
        const midX = (sx1+sx2)/2, midY = (sy1+sy2)/2;
        const lx = midX + nx*14, ly = midY + ny*14;

        const wallLabel = wallLabelMap.get(seg.id);
        const lenStr    = Math.round(segLen(seg)) + '"';
        return (
          <g key={seg.id} pointerEvents="none">
            <path d={wallPathD} fill="none" stroke={color} strokeWidth={sw2} strokeLinecap="round"
              opacity={seg.usable ? 1 : 0.45} />
            {wallLabel && (
              <>
                <text x={lx} y={ly - 5} textAnchor="middle" fontSize={9} fill={color} fontWeight="800">
                  {wallLabel}
                </text>
                <text x={lx} y={ly + 6} textAnchor="middle" fontSize={8} fill={color} opacity={0.75}>
                  {lenStr}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* Legend */}
      <g pointerEvents="none">
        <rect x={8} y={RTV_H-54} width={136} height={46} rx={4}
          fill="rgba(250,250,248,0.92)" stroke="#e8e4de" strokeWidth={0.75} />
        <rect x={13} y={RTV_H-47} width={10} height={6} rx={1}
          fill="rgba(195,155,100,0.40)" stroke="#c4935a" strokeWidth={0.75} />
        <text x={26} y={RTV_H-40} fontSize={8} fill="#777">Closet area</text>
        <line x1={12} y1={RTV_H-29} x2={22} y2={RTV_H-29}
          stroke="#15803d" strokeWidth={2.5} strokeLinecap="round" />
        <text x={26} y={RTV_H-25} fontSize={8} fill="#777">Wall with closet</text>
        <line x1={12} y1={RTV_H-14} x2={22} y2={RTV_H-14}
          stroke="#a07040" strokeWidth={1.5} strokeLinecap="round" />
        <text x={26} y={RTV_H-10} fontSize={8} fill="#777">Wall — no closet</text>
      </g>

      {/* Closed/open indicator */}
      <text x={RTV_W-8} y={RTV_H-8} textAnchor="end" fontSize={9} fontWeight="700"
        fill={closed?"#15803d":"#dc2626"} pointerEvents="none">
        {closed?"✓ Closed room":"○ Open room"}
      </text>
    </svg>
  );
}

// ─── Component summary helper ─────────────────────────────────────────────────

function compSummary(runs: WallRun[]): { shelves: number; rods: number; drawers: number } {
  let shelves=0, rods=0, drawers=0;
  for (const r of runs)
    for (const s of r.sections)
      for (const c of s.comps) {
        if (c.type === "Shelf")      shelves++;
        else if (c.type === "Rod")   rods++;
        else if (c.type === "DrawerStack") drawers += c.drawerHeights.length;
      }
  return { shelves, rods, drawers };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DesignPreviewPage() {
  const router = useRouter();

  const [layout,  setLayout]  = useState<RoomLayout | null>(null);
  const [runs,    setRuns]    = useState<WallRun[]>([]);
  const [error,   setError]   = useState<string | null>(null);
  const [ready,   setReady]   = useState(false);

  useEffect(() => {
    const rawLayout = localStorage.getItem("room-layout");
    const rawState  = localStorage.getItem("design-state");

    if (!rawLayout || !rawState) {
      setError("No design found. Please complete the Room Layout and Design steps first.");
      return;
    }
    try {
      const lay = JSON.parse(rawLayout) as RoomLayout;
      setLayout(lay);
      const ds = JSON.parse(rawState) as DesignStateV2;
      if (ds.v === 2 && Array.isArray(ds.runs)) {
        setRuns(ds.runs);
      }
      setReady(true);
    } catch {
      setError("Could not load design data.");
    }
  }, []);

  if (!ready || !layout) {
    return (
      <div style={{ fontFamily:"sans-serif", minHeight:"100vh", backgroundColor:"#f5f2ee",
        display:"flex", alignItems:"center", justifyContent:"center" }}>
        {error
          ? <div style={{ maxWidth:"440px", textAlign:"center" }}>
              <p style={{ fontSize:"14px", color:"#b91c1c", marginBottom:"16px" }}>{error}</p>
              <button onClick={() => router.push("/design")}
                style={{ padding:"10px 24px", borderRadius:"8px", border:"none",
                  backgroundColor:"#1a1a1a", color:"#fff", fontWeight:"700", cursor:"pointer" }}>
                Go to Design Editor
              </button>
            </div>
          : <p style={{ color:"#888", fontSize:"14px" }}>Loading preview…</p>
        }
      </div>
    );
  }

  const usableWalls  = getSelectedWalls(layout);
  const wallLabelMap = buildWallLabelMap(usableWalls);
  const sysH         = layout.systemHeightIn ?? 84;
  const ceilingH     = layout.ceilingHeightIn ?? 96;
  const summary      = compSummary(runs);
  const totalPanels  = runs.reduce((n, r) => n + r.panels.length + 2, 0);

  return (
    <div style={{ fontFamily:"sans-serif", minHeight:"100vh", backgroundColor:"#f5f2ee" }}>

      {/* ── Header ── */}
      <header style={{
        backgroundColor:"#1a1a1a", color:"#fff", position:"sticky", top:0, zIndex:50,
        padding:"0 24px", height:"52px", display:"flex", alignItems:"center",
        justifyContent:"space-between",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <button onClick={() => router.push("/worksheet")}
            style={{ fontSize:"12px", fontWeight:"600", color:"#888",
              background:"none", border:"none", cursor:"pointer" }}>
            ← Worksheet
          </button>
          <span style={{ color:"#333" }}>|</span>
          <span style={{ fontSize:"14px", fontWeight:"800" }}>Final Design Preview</span>
          {layout.clientName && (
            <span style={{ fontSize:"12px", color:"#888" }}>{layout.clientName}</span>
          )}
        </div>
        {/* Step indicator + actions */}
        <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
          {["Setup","Room Layout","Design","Worksheet","Preview","Pricing"].map((s,i) => (
            <span key={s} style={{
              fontSize:"11px", padding:"3px 10px", borderRadius:"20px",
              backgroundColor: i === 4 ? "#fff" : "transparent",
              color: i === 4 ? "#1a1a1a" : "#888",
              fontWeight: i === 4 ? "700" : "400",
            }}>{s}</span>
          ))}
          <button onClick={() => { saveCurrentProject(getActiveProjectId()); }}
            style={{ fontSize:"12px", fontWeight:"700", cursor:"pointer", marginLeft:"8px",
              padding:"5px 14px", borderRadius:"6px", border:"none",
              backgroundColor:"#3a5a3a", color:"#fff" }}>
            Save
          </button>
          <button onClick={() => router.push("/")}
            style={{ fontSize:"12px", fontWeight:"600", cursor:"pointer",
              padding:"5px 14px", borderRadius:"6px",
              border:"1.5px solid #4a4a4a", backgroundColor:"transparent", color:"#aaa" }}>
            Dashboard
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <main style={{ maxWidth:"1040px", margin:"0 auto", padding:"32px 24px 80px" }}>

        {/* Page title */}
        <div style={{ marginBottom:"28px" }}>
          <h1 style={{ fontSize:"24px", fontWeight:"900", color:"#1a1a1a", margin:"0 0 4px" }}>
            Final Design Preview
          </h1>
          <p style={{ fontSize:"13px", color:"#888", margin:0 }}>
            Review the complete closet design below before proceeding to pricing.
          </p>
        </div>

        {/* ── Project summary card ── */}
        <div style={PS.card}>
          <div style={{ display:"flex", justifyContent:"space-between",
            alignItems:"center", marginBottom:"16px" }}>
            <h2 style={{ fontSize:"13px", fontWeight:"700", color:"#555",
              textTransform:"uppercase", letterSpacing:"0.6px", margin:0 }}>
              Project Summary
            </h2>
            <span style={{ fontSize:"11px", color:"#bbb" }}>Read-only preview</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",
            gap:"16px", marginBottom:"16px" }}>
            {[
              ["Client",          layout.clientName    || "—"],
              ["Project #",       layout.clientNum     || "—"],
              ["Location",        layout.locationName  || "—"],
              ["Type",            layout.projectType   || "—"],
              ["Ceiling Height",  `${ceilingH}"`],
              ["System Height",   `${sysH}"`],
              ["Closet Depth",    `${layout.closetDepthIn ?? "—"}"`],
              ["Designed Walls",  String(usableWalls.length)],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <div style={{ fontSize:"10px", fontWeight:"700", color:"#aaa",
                  textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:"3px" }}>
                  {lbl}
                </div>
                <div style={{ fontSize:"14px", fontWeight:"600", color:"#1a1a1a" }}>{val}</div>
              </div>
            ))}
          </div>
          {/* Component summary pills */}
          <div style={{ display:"flex", gap:"8px", flexWrap:"wrap",
            paddingTop:"12px", borderTop:"1px solid #f0ece6" }}>
            {[
              ["Panels total",   String(totalPanels),   "#c4935a"],
              ["Shelves",        String(summary.shelves),"#7a8a96"],
              ["Rods",           String(summary.rods),   "#7a5230"],
              ["Drawer units",   String(summary.drawers),"#b8956a"],
              ["Sections",       String(runs.reduce((n,r)=>n+r.sections.length,0)), "#555"],
            ].map(([lbl, val, color]) => (
              <div key={lbl} style={{
                padding:"5px 12px", borderRadius:"20px",
                backgroundColor:"#f7f4f0", border:"1px solid #e8e2da",
                display:"flex", alignItems:"center", gap:"6px",
              }}>
                <span style={{ fontSize:"15px", fontWeight:"800", color }}>{val}</span>
                <span style={{ fontSize:"11px", color:"#888" }}>{lbl}</span>
              </div>
            ))}
          </div>
          {layout.remarks && (
            <div style={{ marginTop:"12px", padding:"8px 12px", borderRadius:"6px",
              backgroundColor:"#faf8f5", border:"1px solid #e8e4de",
              fontSize:"12px", color:"#666" }}>
              <span style={{ fontWeight:"700", color:"#999",
                textTransform:"uppercase", fontSize:"10px", letterSpacing:"0.5px" }}>
                Remarks:{" "}
              </span>
              {layout.remarks}
            </div>
          )}
        </div>

        {/* ── Full room layout card ── */}
        <div style={PS.card}>
          <h2 style={PS.sectionTitle}>Full Room Layout</h2>
          <p style={{ fontSize:"12px", color:"#aaa", margin:"0 0 16px" }}>
            Top view — room perimeter with all closet footprints
          </p>
          <div style={{ display:"flex", justifyContent:"center" }}>
            <PreviewRoomTopView
              layout={layout}
              runs={runs}
              wallLabelMap={wallLabelMap}
            />
          </div>
          {/* Wall legend */}
          <div style={{ marginTop:"14px", display:"flex", gap:"16px",
            flexWrap:"wrap", justifyContent:"center" }}>
            {usableWalls.map(w => {
              const run = runs.find(r => r.wallId === w.id);
              const lbl = wallLabelMap.get(w.id) ?? "—";
              return (
                <div key={w.id} style={{ display:"flex", flexDirection:"column",
                  alignItems:"center", gap:"2px" }}>
                  <span style={{ fontSize:"12px", fontWeight:"700", color:"#15803d" }}>{lbl}</span>
                  <span style={{ fontSize:"11px", color:"#888" }}>
                    {w.widthIn}" · {run?.sections.length ?? 0} sec
                    {run?.sections.length !== 1 ? "s" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Wall-by-wall elevation cards ── */}
        <div style={{ marginBottom:"20px" }}>
          <h2 style={{ ...PS.sectionTitle, marginBottom:"4px" }}>
            Wall Elevations — Front View
          </h2>
          <p style={{ fontSize:"12px", color:"#aaa", margin:"0 0 20px" }}>
            Each wall shown at full scale. Panels, components, and measurements are read-only.
          </p>
        </div>

        {usableWalls.map((wall, wi) => {
          const run = runs.find(r => r.wallId === wall.id);
          if (!run) return null;
          const label = wallLabelMap.get(wall.id) ?? `Wall ${wi+1}`;
          const sections = run.sections;
          const totalComps = sections.reduce((n,s) => n+s.comps.length, 0);
          const hasObs     = (run.obstacles ?? []).length > 0;
          const effectiveH = run.ceilingProfile
            ? (() => {
                const runW = run.endIn - run.startIn;
                const steps = [0, 0.25, 0.5, 0.75, 1].map(t =>
                  ceilingAtX(t * runW, runW, run.ceilingProfile!));
                return `${Math.round(Math.min(...steps))}–${Math.round(Math.max(...steps))}"`;
              })()
            : `${ceilingH}"`;

          return (
            <div key={wall.id} style={{ ...PS.card, marginBottom:"20px" }}>
              {/* Card header */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                marginBottom:"16px", paddingBottom:"12px", borderBottom:"1px solid #f0ece6" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                  <div style={{
                    width:"36px", height:"36px", borderRadius:"50%",
                    backgroundColor:"#1a1a1a", color:"#fff",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:"14px", fontWeight:"800", flexShrink:0,
                  }}>
                    {label.replace("Wall ", "")}
                  </div>
                  <div>
                    <div style={{ fontSize:"16px", fontWeight:"800", color:"#1a1a1a" }}>
                      {label}
                    </div>
                    <div style={{ fontSize:"12px", color:"#888", marginTop:"1px" }}>
                      {wall.widthIn}" wide · System {(run.endIn - run.startIn).toFixed(1)}" ·
                      {" "}{sections.length} section{sections.length !== 1 ? "s" : ""} ·
                      {" "}{run.panels.length + 2} panels
                    </div>
                  </div>
                </div>
                {/* Badges */}
                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", justifyContent:"flex-end" }}>
                  <span style={PS.badge("#f0f8f0","#86efac","#15803d")}>
                    Ceiling {effectiveH}
                  </span>
                  {totalComps > 0 && (
                    <span style={PS.badge("#fef9f0","#fbbf24","#92400e")}>
                      {totalComps} component{totalComps !== 1 ? "s" : ""}
                    </span>
                  )}
                  {hasObs && (
                    <span style={PS.badge("#eff6ff","#93c5fd","#1d4ed8")}>
                      Obstacles
                    </span>
                  )}
                  {run.ceilingProfile && (
                    <span style={PS.badge("#f5f3ff","#c4b5fd","#5b21b6")}>
                      Shaped ceiling
                    </span>
                  )}
                </div>
              </div>

              {/* Measurements row */}
              <div style={{ display:"flex", gap:"16px", flexWrap:"wrap",
                marginBottom:"16px", padding:"10px 14px", borderRadius:"8px",
                backgroundColor:"#fafaf8", border:"1px solid #ede9e2" }}>
                <Meas label="Wall width"   value={`${wall.widthIn}"`} />
                <Meas label="System span"  value={`${(run.endIn - run.startIn).toFixed(1)}"`} />
                {run.startIn > 0 && <Meas label="Left gap"  value={`${run.startIn.toFixed(1)}"`} />}
                {wall.widthIn - run.endIn > 0 && <Meas label="Right gap" value={`${(wall.widthIn - run.endIn).toFixed(1)}"`} />}
                {run.leftPanelHeightIn  !== undefined && <Meas label="Left panel H"  value={`${run.leftPanelHeightIn}"`}  />}
                {run.rightPanelHeightIn !== undefined && <Meas label="Right panel H" value={`${run.rightPanelHeightIn}"`} />}
                {sections.map((sec, si) => (
                  <Meas key={sec.id}
                    label={`Sec ${si+1} width`}
                    value={`${secWidth(run.panels, run.startIn, run.endIn, si).toFixed(1)}"`}
                  />
                ))}
              </div>

              {/* Elevation SVG */}
              <PreviewElevation
                run={run}
                wallWidthIn={wall.widthIn}
                sysH={sysH}
                ceilingH={ceilingH}
                label={label}
              />

              {/* Component list */}
              {totalComps > 0 && (
                <div style={{ marginTop:"14px", display:"flex", gap:"6px",
                  flexWrap:"wrap", borderTop:"1px solid #f0ece6", paddingTop:"12px" }}>
                  <span style={{ fontSize:"11px", fontWeight:"700", color:"#aaa",
                    textTransform:"uppercase", letterSpacing:"0.5px",
                    alignSelf:"center", marginRight:"4px" }}>
                    Components:
                  </span>
                  {sections.map((sec, si) =>
                    sec.comps.map(comp => {
                      const sw = secWidth(run.panels, run.startIn, run.endIn, si);
                      const lbl = comp.type === "DrawerStack"
                        ? `${comp.drawerHeights.length}× drawer in Sec ${si+1} (${sw.toFixed(0)}")`
                        : `${comp.type} in Sec ${si+1} (${sw.toFixed(0)}")`;
                      const color = comp.type === "Shelf"
                        ? "#c4935a" : comp.type === "Rod"
                        ? "#7a5230" : "#b8956a";
                      return (
                        <span key={comp.id} style={{
                          fontSize:"11px", fontWeight:"600", padding:"3px 10px",
                          borderRadius:"20px", backgroundColor:`${color}18`,
                          border:`1px solid ${color}50`, color,
                        }}>
                          {lbl}
                        </span>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Bottom navigation ── */}
        <div style={{ marginTop:"40px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <button onClick={() => router.push("/worksheet")}
            style={PS.btnBack}>
            ← Back to Worksheet
          </button>
          <button onClick={() => router.push("/presentation")}
            style={PS.btnNext}>
            Continue to Price Presentation →
          </button>
        </div>

      </main>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function Meas({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1px" }}>
      <span style={{ fontSize:"10px", fontWeight:"700", color:"#bbb",
        textTransform:"uppercase", letterSpacing:"0.4px" }}>
        {label}
      </span>
      <span style={{ fontSize:"13px", fontWeight:"700", color:"#333" }}>{value}</span>
    </div>
  );
}

// ─── Page styles ──────────────────────────────────────────────────────────────

const PS = {
  card: {
    backgroundColor:"#fff", border:"1px solid #e5e0d8",
    borderRadius:"12px", padding:"20px 22px", marginBottom:"20px",
  } as React.CSSProperties,
  sectionTitle: {
    fontSize:"13px", fontWeight:"700", color:"#555",
    textTransform:"uppercase" as const, letterSpacing:"0.6px",
    margin:"0 0 4px",
  } as React.CSSProperties,
  badge: (bg: string, border: string, color: string): React.CSSProperties => ({
    fontSize:"10px", fontWeight:"700", padding:"3px 9px", borderRadius:"12px",
    backgroundColor: bg, border:`1px solid ${border}`, color,
  }),
  btnBack: {
    padding:"10px 20px", fontSize:"13px", fontWeight:"700", borderRadius:"8px",
    border:"1.5px solid #c8c4be", backgroundColor:"#fff", color:"#444",
    cursor:"pointer",
  } as React.CSSProperties,
  btnNext: {
    padding:"12px 28px", fontSize:"14px", fontWeight:"800", borderRadius:"8px",
    border:"none", backgroundColor:"#1a1a1a", color:"#fff", cursor:"pointer",
  } as React.CSSProperties,
};
