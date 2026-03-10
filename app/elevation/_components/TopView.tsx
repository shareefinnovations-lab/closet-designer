"use client";

import {
  SCALE, PAD_LEFT, TV_PAD_TOP, TV_PAD_RIGHT, TV_PAD_BOTTOM,
  PANEL_W_PX, PANEL_W_IN,
  C_FRAME, C_DIM, C_PANEL, C_PANEL_BD, C_INTERIOR, C_BEYOND,
  C_OPEN_LINE, C_HATCH,
} from "../_lib/constants";
import { formatIn } from "../_lib/helpers";
import type { Section } from "../_lib/types";

interface TopViewProps {
  sections: Section[];
  sectionStartXs: number[];
  wx: number;
  wallWpx: number;
  overallDepth: number;
  leftReturn: number;
  rightReturn: number;
}

export function TopView({ sections, sectionStartXs, wx, wallWpx, overallDepth, leftReturn, rightReturn }: TopViewProps) {
  const overallDepthPx = overallDepth * SCALE;
  const leftRetPx      = leftReturn   * SCALE;
  const rightRetPx     = rightReturn  * SCALE;
  const svgW           = PAD_LEFT + wallWpx + TV_PAD_RIGHT;
  const svgH           = TV_PAD_TOP + overallDepthPx + TV_PAD_BOTTOM;
  const wy             = TV_PAD_TOP;
  const overallFrontY  = wy + overallDepthPx;
  const rightRetX      = wx + wallWpx - rightRetPx;
  const panelBoundaries = [wx, ...sectionStartXs.slice(1), wx + wallWpx];

  function panelDepthPx(bi: number): number {
    const isOuter = bi === 0 || bi === panelBoundaries.length - 1;
    if (isOuter) return overallDepthPx;
    const leftDepth  = sections[bi - 1].depthIn;
    const rightDepth = sections[bi].depthIn;
    return Math.max(leftDepth, rightDepth) * SCALE;
  }

  return (
    <svg width={svgW} height={svgH}
      style={{ display: "block", overflow: "visible" }}
      aria-label="Closet top-view (plan)">
      <defs>
        <pattern id="tv-hatch" width={6} height={6}
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={6} stroke={C_HATCH} strokeWidth={1.5} />
        </pattern>
      </defs>

      {/* ── Interior fill — full wall width, full depth ───────────────────── */}
      <rect x={wx} y={wy} width={wallWpx} height={overallDepthPx} fill={C_BEYOND} />

      {/* Per-section interior fill (each section's individual depth) */}
      {sections.map((s, i) => (
        <rect key={`tv-fill-${i}`}
          x={sectionStartXs[i]} y={wy}
          width={s.widthIn * SCALE} height={s.depthIn * SCALE}
          fill={C_INTERIOR} />
      ))}

      {/* Back wall hatch band */}
      <rect x={wx} y={wy} width={wallWpx} height={10} fill="url(#tv-hatch)" />

      {/* Panel boards */}
      {panelBoundaries.map((bx, i) => (
        <rect key={`tv-panel-${i}`}
          x={bx - PANEL_W_PX / 2} y={wy} width={PANEL_W_PX} height={panelDepthPx(i)}
          fill={C_PANEL} stroke={C_PANEL_BD} strokeWidth={0.5} />
      ))}

      {/* Per-section front-face lines at each section's own depth */}
      {sections.map((s, i) => {
        const sx      = sectionStartXs[i];
        const sw      = s.widthIn * SCALE;
        const sFrontY = wy + s.depthIn * SCALE;
        return (
          <line key={`tv-front-${i}`}
            x1={sx} y1={sFrontY} x2={sx + sw} y2={sFrontY}
            stroke={C_OPEN_LINE} strokeWidth={2} strokeDasharray="8 4" />
        );
      })}

      {/* ── Closet outline — true open-front shape ───────────────────────────
          The path traces:
            inner left return (wx+leftRetPx, frontY)
            → outer left corner  (wx, frontY)          ← left return front face
            → back-left corner   (wx, wy)               ← left side wall
            → back-right corner  (wx+wallWpx, wy)       ← back wall
            → front-right corner (wx+wallWpx, frontY)   ← right side wall
            → inner right return (rightRetX, frontY)    ← right return front face

          The segment from rightRetX to wx+leftRetPx at frontY is intentionally
          absent — that is the open front gap.                                */}
      <path
        d={`
          M ${wx + leftRetPx} ${overallFrontY}
          L ${wx}             ${overallFrontY}
          L ${wx}             ${wy}
          L ${wx + wallWpx}   ${wy}
          L ${wx + wallWpx}   ${overallFrontY}
          L ${rightRetX}      ${overallFrontY}
        `}
        fill="none" stroke={C_FRAME} strokeWidth={2.5} strokeLinecap="square"
      />

      {sections.map((s, i) => {
        const sx         = sectionStartXs[i];
        const sw         = s.widthIn * SCALE;
        const cx         = sx + sw / 2;
        const sDepthPx   = s.depthIn * SCALE;
        const midY       = wy + sDepthPx / 2;
        const hasDrawers = s.components.some(c => c.type === "DrawerStack");
        return (
          <g key={`tv-label-${i}`}>
            <text x={cx} y={midY - 8} textAnchor="middle" dominantBaseline="middle"
              fontSize={11} fill="#bbb" fontStyle="italic">{i + 1}</text>
            <text x={cx} y={midY + 8} textAnchor="middle" dominantBaseline="middle"
              fontSize={10} fontWeight="600" fill={hasDrawers ? "#b07030" : "#aaa"}>
              {s.depthIn}&Prime;D
            </text>
          </g>
        );
      })}

      <text x={wx + wallWpx / 2} y={wy - 14} textAnchor="middle" fontSize={11} fill="#555" fontWeight="600">Back Wall</text>
      {/* "Front Opening" label centred in the actual open gap between return walls */}
      <text
        x={(wx + leftRetPx + rightRetX) / 2}
        y={overallFrontY + 18}
        textAnchor="middle" fontSize={11} fill={C_OPEN_LINE} fontWeight="600">
        Front Opening
      </text>

      {/* Wall width dimension */}
      <line x1={wx} y1={wy - 30} x2={wx + wallWpx} y2={wy - 30} stroke={C_DIM} strokeWidth={1} />
      <line x1={wx}           y1={wy - 35} x2={wx}           y2={wy - 25} stroke={C_DIM} strokeWidth={1} />
      <line x1={wx + wallWpx} y1={wy - 35} x2={wx + wallWpx} y2={wy - 25} stroke={C_DIM} strokeWidth={1} />
      <text x={wx + wallWpx / 2} y={wy - 37} textAnchor="middle" fontSize={12} fill={C_DIM}>{wallWpx / SCALE}&Prime;</text>

      {/* Section usable widths */}
      {sections.map((s, i) => {
        const sx    = sectionStartXs[i];
        const sw    = s.widthIn * SCALE;
        const left  = sx + PANEL_W_PX / 2;
        const right = sx + sw - PANEL_W_PX / 2;
        const mid   = (left + right) / 2;
        return (
          <g key={`tv-dim-${i}`}>
            <line x1={left} y1={overallFrontY + 22} x2={right} y2={overallFrontY + 22} stroke={C_DIM} strokeWidth={1} />
            <line x1={left}  y1={overallFrontY + 17} x2={left}  y2={overallFrontY + 27} stroke={C_DIM} strokeWidth={1} />
            <line x1={right} y1={overallFrontY + 17} x2={right} y2={overallFrontY + 27} stroke={C_DIM} strokeWidth={1} />
            <text x={mid} y={overallFrontY + 40} textAnchor="middle" fontSize={11} fill={C_DIM}>
              {formatIn(s.widthIn - PANEL_W_IN)}&Prime;
            </text>
          </g>
        );
      })}

      {/* Overall wall depth dimension */}
      <line x1={wx + wallWpx + 36} y1={wy} x2={wx + wallWpx + 36} y2={overallFrontY} stroke={C_DIM} strokeWidth={1} />
      <line x1={wx + wallWpx + 31} y1={wy}            x2={wx + wallWpx + 41} y2={wy}            stroke={C_DIM} strokeWidth={1} />
      <line x1={wx + wallWpx + 31} y1={overallFrontY} x2={wx + wallWpx + 41} y2={overallFrontY} stroke={C_DIM} strokeWidth={1} />
      <text x={wx + wallWpx + 58} y={wy + overallDepthPx / 2}
        textAnchor="middle" fontSize={12} fill={C_DIM}
        transform={`rotate(-90, ${wx + wallWpx + 58}, ${wy + overallDepthPx / 2})`}>
        {overallDepth}&Prime; D (overall)
      </text>

      {/* Left return leader */}
      <line x1={wx + leftRetPx / 2} y1={overallFrontY} x2={wx + leftRetPx / 2} y2={overallFrontY + 30} stroke={C_DIM} strokeWidth={0.8} />
      <line x1={wx + leftRetPx / 2} y1={overallFrontY + 30} x2={wx - 8} y2={overallFrontY + 30} stroke={C_DIM} strokeWidth={0.8} />
      <circle cx={wx + leftRetPx / 2} cy={overallFrontY} r={2} fill={C_DIM} />
      <text x={wx - 11} y={overallFrontY + 34} textAnchor="end" fontSize={11} fill={C_DIM}>{leftReturn}&Prime;</text>

      {/* Right return leader */}
      <line x1={rightRetX + rightRetPx / 2} y1={overallFrontY} x2={rightRetX + rightRetPx / 2} y2={overallFrontY + 30} stroke={C_DIM} strokeWidth={0.8} />
      <line x1={rightRetX + rightRetPx / 2} y1={overallFrontY + 30} x2={wx + wallWpx + 8} y2={overallFrontY + 30} stroke={C_DIM} strokeWidth={0.8} />
      <circle cx={rightRetX + rightRetPx / 2} cy={overallFrontY} r={2} fill={C_DIM} />
      <text x={wx + wallWpx + 11} y={overallFrontY + 34} textAnchor="start" fontSize={11} fill={C_DIM}>{rightReturn}&Prime;</text>
    </svg>
  );
}
