// src/lib/wall-pricing.ts
//
// Shared utility: converts WallRun data (from design-state localStorage)
// into inputs accepted by the pricing engines (computePricing, computePresentationPricing).
//
// Mirrors the geometry helpers in design/page.tsx without importing from a page file.

import { computePricing, type PricingSection, type PricingResult } from "./pricing";

// ─── Panel constant ────────────────────────────────────────────────────────────
// Must stay in sync with design/page.tsx PANEL_W_IN.
export const PANEL_W_IN = 0.75;

// ─── Stored types (mirrors design/page.tsx interfaces) ────────────────────────
// Defined here so consumers don't need to import from a page component.

export interface StoredComp {
  id:            number;
  type:          "Shelf" | "Rod" | "DrawerStack" | "Door";
  positionIn:    number;
  drawerHeights: number[];
  doorHeightIn?: number;
  doorFlipped?:  boolean;
}

export interface StoredSection {
  id:      number;
  depthIn: number;
  comps:   StoredComp[];
}

export interface StoredPanel {
  id:        number;
  xIn:       number;
  heightIn?: number;
}

export interface StoredRun {
  wallId:               string;
  startIn:              number;
  endIn:                number;
  panels:               StoredPanel[];
  sections:             StoredSection[];
  obstacles:            unknown[];
  leftPanelHeightIn?:   number;
  rightPanelHeightIn?:  number;
}

export interface DesignStateV2 {
  v:               2;
  runs:            StoredRun[];
  fullLengthWalls: string[];
}

// ─── Section geometry ─────────────────────────────────────────────────────────

/** Left edge of section[i] in wall-absolute inches. */
function secLeft(panels: StoredPanel[], startIn: number, i: number): number {
  return i === 0 ? startIn : panels[i - 1].xIn + PANEL_W_IN;
}

/** Width of section[i] in inches. */
export function secWidth(
  panels:  StoredPanel[],
  startIn: number,
  endIn:   number,
  i:       number,
): number {
  const l = secLeft(panels, startIn, i);
  const r = i === panels.length ? endIn : panels[i].xIn;
  return Math.max(0, r - l);
}

// ─── Run → pricing inputs ─────────────────────────────────────────────────────

/** Convert a WallRun into the PricingSection[] required by computePricing. */
export function runToPricingSections(run: StoredRun): PricingSection[] {
  return run.sections.map((s, i) => ({
    widthIn:    secWidth(run.panels, run.startIn, run.endIn, i),
    depthIn:    s.depthIn,
    components: s.comps.map(c => ({
      type:          c.type,
      drawerHeights: c.drawerHeights,
      doorHeightIn:  c.doorHeightIn,
      doorFlipped:   c.doorFlipped,
    })),
  }));
}

/**
 * Build the panel heights array used by computeLayoutCounts for backing area.
 * Array length = sections.length + 1 (left end panel, interior panels, right end panel).
 */
export function runToPanelHeights(run: StoredRun, sysH: number): number[] {
  return [
    run.leftPanelHeightIn ?? sysH,
    ...run.panels.map(p => p.heightIn ?? sysH),
    run.rightPanelHeightIn ?? sysH,
  ];
}

// ─── Per-wall worksheet result ────────────────────────────────────────────────

export interface WallWorksheetResult {
  wallId:      string;
  label:       string;
  wallWidthIn: number;
  panelDepth:  number;
  panelCount:  number;
  shelfCount:  number;
  rodCount:    number;
  drawerCount: number;
  pricing:     PricingResult;
}

/**
 * Compute the internal (11%-adjustment) worksheet result for a single wall run.
 *
 * @param run           The WallRun from design-state
 * @param label         Human-readable label, e.g. "Wall A"
 * @param overallDepthIn Project-level overall closet depth (from RoomLayout)
 * @param sysH          System height (from RoomLayout.systemHeightIn), used as panel-height fallback
 */
export function computeWallWorksheet(
  run:            StoredRun,
  label:          string,
  overallDepthIn: number,
  sysH:           number,
): WallWorksheetResult {
  const pricingSections = runToPricingSections(run);
  const panelHeights    = runToPanelHeights(run, sysH);
  const pricing         = computePricing(pricingSections, overallDepthIn, panelHeights);

  let shelfCount = 0, rodCount = 0, drawerCount = 0;
  for (const sec of pricingSections) {
    shelfCount += 2; // 2 lock shelves per section (top + bottom)
    for (const comp of sec.components) {
      if (comp.type === "Shelf")       shelfCount++;
      if (comp.type === "Rod")         rodCount++;
      if (comp.type === "DrawerStack") drawerCount += comp.drawerHeights.length;
    }
  }

  return {
    wallId:      run.wallId,
    label,
    wallWidthIn: run.endIn - run.startIn,
    panelDepth:  overallDepthIn,
    panelCount:  pricingSections.length + 1,
    shelfCount,
    rodCount,
    drawerCount,
    pricing,
  };
}
