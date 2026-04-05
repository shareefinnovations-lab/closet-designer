// ─── Room Layout + Design Types ───────────────────────────────────────────────
// v2 uses a perimeter / segment model instead of fixed A/B/C walls.

// ── Segment-based Room Layout (v2) ───────────────────────────────────────────

export type SegmentDirection = "right" | "left" | "up" | "down";

export interface RoomSegment {
  id:                string;
  label:             string;
  lengthIn:          number;
  direction:         SegmentDirection;
  dxIn?:             number;   // wall vector x component (inches); overrides direction+lengthIn
  dyIn?:             number;   // wall vector y component (inches); overrides direction+lengthIn
  // Breakpoint — splits segment into two sub-legs at an intermediate vertex.
  // breakDxIn/breakDyIn are relative to the segment's start vertex.
  // The second sub-leg goes from the breakpoint to the end vertex (implied by dxIn/dyIn).
  breakDxIn?:        number;
  breakDyIn?:        number;
  // Quadratic Bézier curve control point, relative to segment's start vertex.
  // When set, the wall draws a smooth arc from start to end through this control point.
  cpDxIn?:           number;
  cpDyIn?:           number;
  // Free-standing anchor — when set, this segment starts at (anchorX, anchorY) in
  // room-coordinate space instead of being chained to the previous segment's end.
  // Dragging the anchor handle moves the whole segment without changing its length/angle.
  anchorX?:          number;
  anchorY?:          number;
  // Footprint direction override — when true, the closet footprint projects to the
  // opposite side of the wall from the automatic inward direction.
  footprintFlipped?: boolean;
  usable:            boolean;           // physical: can cabinetry go here at all?
  selectedForDesign: boolean;           // user choice: "Has Closet" — include in design
  canHaveCabinetry:  boolean;
  hasWindow:         boolean;
  hasDoor:           boolean;
  hasObstacle:       boolean;
  notes:             string;
}

export interface RoomLayout {
  // Project info (copied from setup)
  projectType:     string;
  clientName:      string;
  clientNum:       string;
  locationName:    string;
  remarks:         string;
  // Global dimensions
  ceilingHeightIn: number;
  systemHeightIn:  number;
  closetDepthIn:   number;
  // Perimeter segments (v2 model)
  segments:        RoomSegment[];
  // Origin of vertex 0 in room-coordinate space (inches).
  // Stored so that dragging vertex 0 behaves like any other vertex.
  originX?:        number;
  originY?:        number;
  // Legacy fields (v1) — kept only for data migration
  walls?:          RoomWall[];
  leftReturnIn?:   number;
  rightReturnIn?:  number;
}

// ── Legacy wall model (v1) ────────────────────────────────────────────────────
// Kept for backward compatibility with saved room-layout data and design page.
export interface RoomWall {
  id:             string;
  label:          string;
  widthIn:        number;
  usable:         boolean;
  hasOpening:     boolean;
  openingWidthIn: number;
}

// ── Design State ─────────────────────────────────────────────────────────────

export type SectionKind =
  | "DoubleHang"
  | "LongHang"
  | "Shelves"
  | "Drawers"
  | "OpenShelf";

export interface DesignComponent {
  id:            number;
  type:          "Shelf" | "Rod" | "DrawerStack";
  positionIn:    number;
  drawerHeights: number[];
}

export interface DesignSection {
  id:         number;
  kind:       SectionKind;
  widthIn:    number;
  depthIn:    number;
  components: DesignComponent[];
}

export interface WallDesign {
  wallId:   string;   // matches RoomSegment.id (or legacy RoomWall.id)
  sections: DesignSection[];
}

export interface DesignState {
  walls: WallDesign[];
}

// ── Normalize helper ──────────────────────────────────────────────────────────
// Returns a flat list of {id, label, widthIn, usable} from either format.
export interface DesignWall {
  id:                string;
  label:             string;
  widthIn:           number;
  usable:            boolean;
  selectedForDesign: boolean;
}

/** Actual geometric length of a segment in inches. */
function segmentLength(s: RoomSegment): number {
  if (s.dxIn !== undefined && s.dyIn !== undefined) {
    return Math.round(Math.sqrt(s.dxIn * s.dxIn + s.dyIn * s.dyIn));
  }
  return s.lengthIn;
}

/** All segments as DesignWall entries (every segment, all states). */
export function getDesignWalls(layout: RoomLayout): DesignWall[] {
  if (layout.segments?.length > 0) {
    return layout.segments.map(s => ({
      id:                s.id,
      label:             s.label || `Segment ${s.id}`,
      widthIn:           segmentLength(s),
      usable:            s.usable,
      selectedForDesign: s.selectedForDesign ?? s.usable,
    }));
  }
  if (layout.walls && layout.walls.length > 0) {
    return layout.walls.map(w => ({
      id:                w.id,
      label:             w.label || w.id,
      widthIn:           w.widthIn,
      usable:            w.usable,
      selectedForDesign: w.usable,   // v1 legacy: usable implies selected
    }));
  }
  return [];
}

/** Walls selected for closet design ("Has Closet = yes") — used by the Design Editor. */
export function getSelectedWalls(layout: RoomLayout): DesignWall[] {
  return getDesignWalls(layout).filter(w => w.selectedForDesign);
}
