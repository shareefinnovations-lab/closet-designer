"use client";

import {
  SCALE, PAD_LEFT, FV_PAD_TOP, FV_PAD_RIGHT, FV_PAD_BOTTOM,
  PANEL_W_PX, PANEL_W_IN, LOCK_H_PX,
  C_FRAME, C_ROD, C_GARMENT, C_SHELF, C_SHELF_BD,
  C_DRAWER, C_DRAWER_BD, C_DIM, C_PANEL, C_PANEL_BD,
  C_SELECT, C_LOCK, C_LOCK_BD,
} from "../_lib/constants";
import { formatIn, compHeight } from "../_lib/helpers";
import type { Section, ClosetComponent } from "../_lib/types";

// ─── SectionVisual ────────────────────────────────────────────────────────────
// Renders one section: lock shelves + all interior components.
// Each component is draggable — pressing it fires onStartDrag.

interface SectionVisualProps {
  index: number;
  x: number;
  widthPx: number;
  wy: number;       // SVG y of section top
  wallHPx: number;  // section height in pixels
  components: ClosetComponent[];
  selected: boolean;
  onStartDrag: (compId: number, clientY: number, positionIn: number) => void;
}

function SectionVisual({
  index, x, widthPx, wy, wallHPx, components, selected, onStartDrag
}: SectionVisualProps) {
  const clipId      = `clip-sec-${index}`;
  const margin      = 6;
  const innerX      = x + PANEL_W_PX / 2 + margin;
  const innerW      = widthPx - PANEL_W_PX - margin * 2;
  const usableX     = x + PANEL_W_PX / 2;
  const usableW     = widthPx - PANEL_W_PX;
  const topLockY    = wy;
  const bottomLockY = wy + wallHPx - LOCK_H_PX;
  const cx          = innerX + innerW / 2;
  const hangW       = Math.min(innerW * 0.5, 36);

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={usableX} y={wy} width={usableW} height={wallHPx} />
        </clipPath>
      </defs>

      {selected && (
        <rect x={usableX} y={wy} width={usableW} height={wallHPx}
          fill="rgba(59,130,246,0.07)" stroke={C_SELECT} strokeWidth={2} />
      )}

      <g clipPath={`url(#${clipId})`}>
        {/* Top lock shelf */}
        <rect x={usableX} y={topLockY} width={usableW} height={LOCK_H_PX}
          fill={C_LOCK} stroke={C_LOCK_BD} strokeWidth={1} />
        <text x={usableX + 5} y={topLockY + LOCK_H_PX / 2}
          fontSize={7} fill="#fff" dominantBaseline="middle">Top Lock</text>

        {/* Bottom lock shelf */}
        <rect x={usableX} y={bottomLockY} width={usableW} height={LOCK_H_PX}
          fill={C_LOCK} stroke={C_LOCK_BD} strokeWidth={1} />
        <text x={usableX + 5} y={bottomLockY + LOCK_H_PX / 2}
          fontSize={7} fill="#fff" dominantBaseline="middle">Bottom Lock</text>

        {/* Interior components — visuals only (clipped) */}
        {components.map(comp => {
          const compTopY = wy + comp.positionIn * SCALE;

          if (comp.type === "Shelf") {
            return (
              <g key={comp.id}>
                <rect x={innerX} y={compTopY - 3} width={innerW} height={6}
                  fill={C_SHELF} stroke={C_SHELF_BD} strokeWidth={1} rx={1} />
              </g>
            );
          }

          if (comp.type === "Rod") {
            const rodY = compTopY;
            return (
              <g key={comp.id}>
                <line x1={innerX} y1={rodY} x2={innerX + innerW} y2={rodY}
                  stroke={C_ROD} strokeWidth={3} strokeLinecap="round" />
                <circle cx={cx} cy={rodY} r={3}
                  fill="none" stroke={C_GARMENT} strokeWidth={1.5} />
                <line x1={cx} y1={rodY + 3} x2={cx - hangW / 2} y2={rodY + 20}
                  stroke={C_GARMENT} strokeWidth={1.5} strokeLinecap="round" />
                <line x1={cx} y1={rodY + 3} x2={cx + hangW / 2} y2={rodY + 20}
                  stroke={C_GARMENT} strokeWidth={1.5} strokeLinecap="round" />
                <line x1={cx - hangW / 2} y1={rodY + 20} x2={cx + hangW / 2} y2={rodY + 20}
                  stroke={C_GARMENT} strokeWidth={1.5} strokeLinecap="round" />
              </g>
            );
          }

          if (comp.type === "DrawerStack") {
            let drawY = compTopY;
            return (
              <g key={comp.id}>
                {comp.drawerHeights.map((dh, di) => {
                  const thisY = drawY;
                  drawY      += dh * SCALE;
                  const hW   = innerW * 0.45;
                  const hX   = innerX + (innerW - hW) / 2;
                  const hY   = thisY + (dh * SCALE - 6) / 2;
                  return (
                    <g key={di}>
                      <rect x={innerX} y={thisY} width={innerW}
                        height={Math.max(3, dh * SCALE - 3)}
                        fill={C_DRAWER} stroke={C_DRAWER_BD} strokeWidth={1} rx={2} />
                      <rect x={hX} y={hY} width={hW} height={6}
                        fill="#fff" stroke={C_DRAWER_BD} strokeWidth={1} rx={3} />
                    </g>
                  );
                })}
              </g>
            );
          }

          return null;
        })}
      </g>

      {/* Drag hit areas — outside clipPath so pointer events are never clipped */}
      {components.map(comp => {
        const compTopY = wy + comp.positionIn * SCALE;
        const onDown = (e: React.MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          onStartDrag(comp.id, e.clientY, comp.positionIn);
        };

        if (comp.type === "Shelf") {
          return (
            <rect key={comp.id} x={innerX} y={compTopY - 10} width={innerW} height={20}
              fill="transparent" style={{ cursor: "grab" }} onMouseDown={onDown} />
          );
        }
        if (comp.type === "Rod") {
          return (
            <rect key={comp.id} x={innerX} y={compTopY - 8} width={innerW} height={36}
              fill="transparent" style={{ cursor: "grab" }} onMouseDown={onDown} />
          );
        }
        if (comp.type === "DrawerStack") {
          const totalH = comp.drawerHeights.reduce((s, h) => s + h, 0);
          return (
            <rect key={comp.id} x={innerX} y={compTopY} width={innerW} height={totalH * SCALE}
              fill="transparent" style={{ cursor: "grab" }} onMouseDown={onDown} />
          );
        }
        return null;
      })}
    </g>
  );
}

// ─── FrontView ────────────────────────────────────────────────────────────────

interface FrontViewProps {
  sections: Section[];
  sectionStartXs: number[];
  panelHeights: number[];
  selectedIndex: number | null;
  drag: { compId: number; secIdx: number; startClientY: number; startPosIn: number } | null;
  ceilingH: number;
  getSectionHeight: (i: number) => number;
  clampPanel: (h: number) => number;
  handleSectionClick: (i: number) => void;
  handleStartDrag: (secIdx: number, compId: number, clientY: number, positionIn: number) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

export function FrontView({
  sections, sectionStartXs, panelHeights, selectedIndex, drag,
  ceilingH, getSectionHeight, clampPanel,
  handleSectionClick, handleStartDrag, svgRef,
}: FrontViewProps) {
  const wallW     = sections.reduce((sum, s) => sum + s.widthIn, 0);
  const wallWpx   = wallW * SCALE;
  const wx        = PAD_LEFT;
  const ceilingHpx = ceilingH * SCALE;
  const fvSvgW    = PAD_LEFT + wallWpx + FV_PAD_RIGHT;
  const fvSvgH    = FV_PAD_TOP + ceilingHpx + FV_PAD_BOTTOM;
  const wy        = FV_PAD_TOP;
  const floorY    = wy + ceilingHpx;
  const panelBoundaries = [wx, ...sectionStartXs.slice(1), wx + wallWpx];

  return (
    <svg
      ref={svgRef}
      width={fvSvgW} height={fvSvgH}
      style={{ display: "block", overflow: "visible", cursor: drag ? "grabbing" : "default" }}
    >
      {/* Full room background */}
      <rect x={wx} y={wy} width={wallWpx} height={ceilingHpx}
        fill="#faf6f1" stroke={C_FRAME} strokeWidth={3} />

      {/* Per-section space-above tint */}
      {sections.map((s, i) => {
        const sectionH    = getSectionHeight(i);
        const sectionHpx  = sectionH * SCALE;
        const spaceHpx    = ceilingHpx - sectionHpx;
        if (spaceHpx <= 0) return null;
        return (
          <rect key={`space-${i}`}
            x={sectionStartXs[i]} y={wy} width={s.widthIn * SCALE} height={spaceHpx}
            fill="#eef2ff" />
        );
      })}

      {/* Ceiling line */}
      <line x1={wx} y1={wy} x2={wx + wallWpx} y2={wy} stroke={C_FRAME} strokeWidth={3} />

      {/* Per-section SectionVisual — each at its own height */}
      {sections.map((s, i) => {
        const sectionH    = getSectionHeight(i);
        const sectionHpx  = sectionH * SCALE;
        const sectionTopY = floorY - sectionHpx;
        const sx      = sectionStartXs[i];
        const sw      = s.widthIn * SCALE;
        const usableX = sx + PANEL_W_PX / 2;
        const usableW = sw - PANEL_W_PX;
        const mid     = usableX + usableW / 2;
        const left    = sx + PANEL_W_PX / 2;
        const right   = sx + sw - PANEL_W_PX / 2;
        return (
          <g key={`sec-${i}`}>
            {/* Click target rendered FIRST so it sits below components in z-order */}
            <rect x={usableX} y={sectionTopY} width={usableW} height={sectionHpx}
              fill="transparent" style={{ cursor: "pointer" }}
              onClick={() => handleSectionClick(i)} />
            <SectionVisual
              index={i} x={sx} widthPx={sw}
              wy={sectionTopY} wallHPx={sectionHpx}
              components={s.components}
              selected={i === selectedIndex}
              onStartDrag={(compId, clientY, positionIn) =>
                handleStartDrag(i, compId, clientY, positionIn)
              }
            />
            {/* Section number */}
            <text x={mid} y={sectionTopY + LOCK_H_PX / 2}
              textAnchor="middle" fontSize={8} fill="#fff">{i + 1}</text>
            {/* Width dimension */}
            <line x1={left}  y1={floorY + 18} x2={right} y2={floorY + 18} stroke={C_DIM} strokeWidth={1} />
            <line x1={left}  y1={floorY + 13} x2={left}  y2={floorY + 23} stroke={C_DIM} strokeWidth={1} />
            <line x1={right} y1={floorY + 13} x2={right} y2={floorY + 23} stroke={C_DIM} strokeWidth={1} />
            <text x={mid} y={floorY + 38} textAnchor="middle" fontSize={12} fill={C_DIM}>
              {formatIn(s.widthIn - PANEL_W_IN)}&Prime;
            </text>
          </g>
        );
      })}

      {/* Panel boards — each at its own height */}
      {panelBoundaries.map((bx, i) => {
        const ph         = clampPanel(panelHeights[i] ?? 84);
        const phPx       = ph * SCALE;
        const panelTopY  = floorY - phPx;
        const spaceAbove = ceilingH - ph;
        return (
          <g key={`panel-${i}`}>
            <rect x={bx - PANEL_W_PX / 2} y={panelTopY} width={PANEL_W_PX} height={phPx}
              fill={C_PANEL} stroke={C_PANEL_BD} strokeWidth={2} />
            <line x1={bx - PANEL_W_PX / 2 - 4} y1={panelTopY}
                  x2={bx + PANEL_W_PX / 2 + 4} y2={panelTopY}
              stroke={C_PANEL_BD} strokeWidth={1} strokeDasharray="3 2" />
            {phPx > 20 && (
              <text x={bx} y={panelTopY - 5} textAnchor="middle" fontSize={9} fill={C_PANEL_BD} fontWeight="600">
                {ph}&Prime;
              </text>
            )}
            {spaceAbove > 2 && phPx < ceilingHpx - 12 && (
              <text x={bx} y={wy + (ceilingHpx - phPx) / 2} textAnchor="middle" fontSize={8} fill="#9ca3af" fontStyle="italic">
                {spaceAbove}&Prime;
              </text>
            )}
          </g>
        );
      })}

      {/* Ceiling height dimension — left side */}
      <line x1={wx - 40} y1={wy}     x2={wx - 40} y2={floorY} stroke="#2563eb" strokeWidth={1} />
      <line x1={wx - 46} y1={wy}     x2={wx - 34} y2={wy}     stroke="#2563eb" strokeWidth={1} />
      <line x1={wx - 46} y1={floorY} x2={wx - 34} y2={floorY} stroke="#2563eb" strokeWidth={1} />
      <text x={wx - 56} y={wy + ceilingHpx / 2} textAnchor="middle" fontSize={11} fill="#2563eb"
        transform={`rotate(-90, ${wx - 56}, ${wy + ceilingHpx / 2})`}>
        Ceiling {ceilingH}&Prime;
      </text>
    </svg>
  );
}
