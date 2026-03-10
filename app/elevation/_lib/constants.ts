// ─── Layout / Scale ───────────────────────────────────────────────────────────

export const MIN_DEPTH        = 12;
export const DRAWER_MIN_DEPTH = 16;
export const SCALE            = 6;    // SVG pixels per inch
export const MIN_WIDTH        = 6;
export const MAX_SECTIONS     = 8;
export const PAD_LEFT         = 64;
export const FV_PAD_TOP       = 44;
export const FV_PAD_RIGHT     = 24;
export const FV_PAD_BOTTOM    = 56;
export const TV_PAD_TOP       = 50;
export const TV_PAD_RIGHT     = 80;
export const TV_PAD_BOTTOM    = 80;

export const DRAWER_MIN_H                = 6;   // minimum height of one drawer (inches)
export const DRAWER_MAX_HEIGHT_FROM_FLOOR = 50; // drawer stack top must be ≤ this many inches from the floor
export const SNAP_IN                     = 1;   // components snap to 1-inch grid

// ─── Panel + Lock shelf dimensions ───────────────────────────────────────────

export const PANEL_W_IN = 0.75;
export const PANEL_W_PX = PANEL_W_IN * SCALE;
export const LOCK_H_IN  = 1;
export const LOCK_H_PX  = LOCK_H_IN * SCALE;

// ─── Colors ───────────────────────────────────────────────────────────────────

export const C_FRAME     = "#2b2b2b";
export const C_ROD       = "#7a5230";
export const C_GARMENT   = "#8a7060";
export const C_SHELF     = "#c4935a";
export const C_SHELF_BD  = "#8b6437";
export const C_DRAWER    = "#d4b896";
export const C_DRAWER_BD = "#8b6437";
export const C_DIM       = "#666";
export const C_PANEL     = "#b8956a";
export const C_PANEL_BD  = "#5c3d1e";
export const C_SELECT    = "#3b82f6";
export const C_LOCK      = "#7a8a96";
export const C_LOCK_BD   = "#4a5a66";
export const C_RETURN    = "#6b7280";
export const C_INTERIOR  = "#f5f0e8";
export const C_BEYOND    = "#e8e4de";
export const C_OPEN_LINE = "#5a9abf";
export const C_HATCH     = "#c8c2bc";
