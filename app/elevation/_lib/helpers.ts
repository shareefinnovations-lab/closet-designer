import {
  MIN_DEPTH,
  DRAWER_MIN_DEPTH,
  LOCK_H_IN,
  SNAP_IN,
  DRAWER_MAX_HEIGHT_FROM_FLOOR,
} from "./constants";
import type { ClosetComponent, Section } from "./types";

export function formatIn(inches: number): string {
  const whole = Math.floor(inches);
  const frac  = Math.round((inches - whole) * 4) / 4;
  if (frac === 0.25) return `${whole}¼`;
  if (frac === 0.5)  return `${whole}½`;
  if (frac === 0.75) return `${whole}¾`;
  return `${whole}`;
}

export function rebalance(secs: Section[], wallW: number): Section[] {
  const count = secs.length;
  const base  = Math.floor(wallW / count);
  const extra = wallW - base * count;
  return secs.map((s, i) => ({ ...s, widthIn: base + (i < extra ? 1 : 0) }));
}

// Every new section starts at 12" regardless of the overall room depth.
export function defaultSectionDepth(): number {
  return MIN_DEPTH;
}

// Panel height rule:
//   ceiling >= 96"  →  84"
//   ceiling <  96"  →  ceiling - 12"
export function defaultPanelHeight(ceilingH: number): number {
  return ceilingH >= 96 ? 84 : ceilingH - 12;
}

// Create 3 equal sections from a given wall width.
export function makeInitialSections(wallW: number): Section[] {
  const base  = Math.floor(wallW / 3);
  const rem   = wallW % 3;
  const depth = defaultSectionDepth();
  return Array.from({ length: 3 }, (_, i) => ({
    widthIn:    base + (i < rem ? 1 : 0),
    depthIn:    depth,
    components: [],
  }));
}

export function minDepthFor(components: ClosetComponent[]): number {
  return components.some(c => c.type === "DrawerStack") ? DRAWER_MIN_DEPTH : MIN_DEPTH;
}

// Total height of a component in inches.
// Shelf and Rod are thin — we give them 1" so collision math works cleanly.
export function compHeight(comp: ClosetComponent): number {
  if (comp.type === "DrawerStack") {
    return comp.drawerHeights.reduce((sum, h) => sum + h, 0);
  }
  return 1;
}

// Snap rawPosIn to the 1" grid, clamp to the valid zone, then push away from
// any component it overlaps. Returns the resolved position.
export function resolvePosition(
  comp: ClosetComponent,
  sectionH: number,
  rawPosIn: number,
  allComps: ClosetComponent[]
): number {
  const cH     = compHeight(comp);
  const maxPos = sectionH - LOCK_H_IN - cH;

  // For DrawerStack: the top of the stack cannot be more than DRAWER_MAX_HEIGHT_FROM_FLOOR
  // inches from the floor. Distance from floor = sectionH - positionIn, so:
  //   sectionH - positionIn ≤ DRAWER_MAX_HEIGHT_FROM_FLOOR
  //   positionIn ≥ sectionH - DRAWER_MAX_HEIGHT_FROM_FLOOR
  const minPos = comp.type === "DrawerStack"
    ? Math.max(LOCK_H_IN, sectionH - DRAWER_MAX_HEIGHT_FROM_FLOOR)
    : LOCK_H_IN;

  if (maxPos < minPos) return minPos;

  // 1. Snap
  let pos = Math.round(rawPosIn / SNAP_IN) * SNAP_IN;
  // 2. Clamp
  pos = Math.max(minPos, Math.min(maxPos, pos));

  // 3. Push away from overlapping components
  for (const other of allComps) {
    if (other.id === comp.id) continue;
    const oH     = compHeight(other);
    const oStart = other.positionIn;
    const oEnd   = oStart + oH;
    if (pos < oEnd && pos + cH > oStart) {
      const abovePos = oStart - cH;
      const belowPos = oEnd;
      const aboveOk  = abovePos >= minPos;
      const belowOk  = belowPos <= maxPos;
      if (aboveOk && belowOk) {
        pos = Math.abs(rawPosIn - abovePos) <= Math.abs(rawPosIn - belowPos)
          ? abovePos : belowPos;
      } else if (aboveOk) {
        pos = abovePos;
      } else if (belowOk) {
        pos = belowPos;
      }
      break;
    }
  }
  return pos;
}
