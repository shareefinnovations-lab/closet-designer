// src/lib/pricing.ts
//
// Pure pricing engine — no React, no side-effects.
// Takes the current sections state and computes a full Bill of Materials
// with line items, subtotal, 11% adjustment, and total.

// ─── Shelf / Rod / Drawer catalog prices ──────────────────────────────────────

const SHELF_12_NARROW = 62;  // 12" deep, ≤30" wide
const SHELF_12_WIDE   = 83;  // 12" deep, >30" wide
const SHELF_16_NARROW = 75;  // 16" deep, ≤30" wide
const SHELF_16_WIDE   = 100; // 16" deep, >30" wide

const ROD_NARROW = 99;       // ≤30" wide
const ROD_WIDE   = 118;      // >30" wide

const DRAWER_75 = 310;       // 75% extension drawer box (any height)

export const ADJUSTMENT_RATE = 0.11; // 11%

// ─── Panel price table ────────────────────────────────────────────────────────
// Source: Closets by Design panel chart.
// Depth categories: 12, 16, 20, 24, 32, 36, 48" — round UP actual depth to next cat.
// Height classes:
//   quarter  ≤24"        (1/4 Panel)
//   third    25–42"      (1/3 Panel)
//   half     43–60"      (1/2 Panel)
//   main     61–96"      (WP / EP / CP / DP — same price regardless of type)
//   tall     97–120"     (Tall Panel — white/standard rate; material upgrade applied separately)
// All WP / EP / CP / DP share the same price for a given depth × height combination.

const PANEL_DEPTH_CATS = [12, 16, 20, 24, 32, 36, 48] as const;
type  PanelDepthCat    = typeof PANEL_DEPTH_CATS[number];

/** Round actual panel depth UP to the next supported depth category (max 48"). */
export function roundUpPanelDepth(d: number): PanelDepthCat {
  for (const cat of PANEL_DEPTH_CATS) {
    if (d <= cat) return cat;
  }
  return 48;
}

export type PanelHeightClass = "quarter" | "third" | "half" | "main" | "tall";

export function panelHeightClass(h: number): PanelHeightClass {
  if (h <= 24) return "quarter";
  if (h <= 42) return "third";
  if (h <= 60) return "half";
  if (h <= 96) return "main";
  return "tall";
}

const PANEL_PRICE_TABLE: Record<PanelHeightClass, Record<PanelDepthCat, number>> = {
  quarter: { 12: 242, 16: 307, 20: 366, 24: 406, 32: 499, 36: 597, 48:  670 },
  third:   { 12: 298, 16: 378, 20: 452, 24: 492, 32: 616, 36: 738, 48:  827 },
  half:    { 12: 320, 16: 402, 20: 484, 24: 529, 32: 662, 36: 794, 48:  886 },
  main:    { 12: 348, 16: 435, 20: 526, 24: 577, 32: 720, 36: 850, 48:  960 },
  tall:    { 12: 480, 16: 625, 20: 738, 24: 810, 32: 1052, 36: 1258, 48: 1416 },
};

/** Look up a single panel price given actual depth and height in inches. */
export function panelPrice(depthIn: number, heightIn: number): number {
  const cat = roundUpPanelDepth(depthIn);
  const cls = panelHeightClass(heightIn);
  return PANEL_PRICE_TABLE[cls][cat];
}

// ─── Door price table ─────────────────────────────────────────────────────────
// Source: Closets by Design pricing chart.
// Columns: Flat Face Front base | Deco 100–400/710/730 add-on | Deco 500 & Shaker 600 add-on
// Brackets are evaluated in order; first match (widthIn ≤ maxW AND heightIn ≤ maxH) wins.

interface DoorBracket { maxW: number; maxH: number; base: number; d1: number; d2: number; }

const DOOR_BRACKETS: DoorBracket[] = [
  { maxW: 24, maxH:  24, base: 310, d1: 185, d2: 334 },
  { maxW: 24, maxH:  36, base: 380, d1: 227, d2: 409 },
  { maxW: 24, maxH:  48, base: 415, d1: 248, d2: 447 },
  { maxW: 24, maxH:  60, base: 475, d1: 339, d2: 611 },
  { maxW: 24, maxH:  72, base: 510, d1: 370, d2: 667 },
  { maxW: 20, maxH:  86, base: 530, d1: 410, d2: 738 },
  { maxW: 24, maxH:  86, base: 570, d1: 472, d2: 850 },
  { maxW: 16, maxH:  96, base: 590, d1: 499, d2: 899 },
  { maxW: 24, maxH:  96, base: 635, d1: 522, d2: 940 },
];

export interface DoorPrices { base: number; d1: number; d2: number; }

/** Look up the door price bracket for a door of the given width and height. */
export function lookupDoorPrices(widthIn: number, heightIn: number): DoorPrices {
  for (const b of DOOR_BRACKETS) {
    if (widthIn <= b.maxW && heightIn <= b.maxH) return { base: b.base, d1: b.d1, d2: b.d2 };
  }
  const last = DOOR_BRACKETS[DOOR_BRACKETS.length - 1];
  return { base: last.base, d1: last.d1, d2: last.d2 };
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PricingSection {
  widthIn: number;
  depthIn: number;
  components: {
    type:          "Shelf" | "Rod" | "DrawerStack" | "Door";
    drawerHeights: number[];
    doorHeightIn?: number;
    doorFlipped?:  boolean;
  }[];
}

export interface LineItem {
  label: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface PricingResult {
  lineItems: LineItem[];
  subtotal: number;
  adjustment: number;
  total: number;
  warnings: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Legacy depth bucket (12 or 16) — used for shelf/rod categorisation only. */
function depthBucket(depthIn: number): 12 | 16 {
  return depthIn <= 12 ? 12 : 16;
}

function isWide(widthIn: number): boolean {
  return widthIn > 30;
}

// ─── Main engine ──────────────────────────────────────────────────────────────

/**
 * Compute pricing from the current design state.
 *
 * @param sections       Array of section objects (width, depth, components)
 * @param overallDepthIn Overall closet depth (informational — not used for pricing)
 * @param panelHeights   Optional array of (sections.length + 1) panel heights in inches.
 *                       When provided, each panel is priced using the full height × depth table.
 *                       When omitted, a default system height of 84" is assumed for all panels.
 */
export function computePricing(
  sections:       PricingSection[],
  overallDepthIn: number,
  panelHeights?:  number[],
): PricingResult {
  const lineItems: LineItem[] = [];
  const warnings:  string[]   = [];

  // suppress overallDepthIn "unused variable" warning in strict mode
  void overallDepthIn;

  if (sections.length === 0) {
    return { lineItems: [], subtotal: 0, adjustment: 0, total: 0, warnings: [] };
  }

  // ── 1. Panels ──────────────────────────────────────────────────────────────
  // There are (sections.length + 1) vertical panels total.
  // Depth: left/right outer panels use the adjacent section's depthIn;
  //        inner panels use the max of their two neighboring sections' depths.
  // Height: taken from panelHeights[] when available, otherwise defaults to 84".

  const DEFAULT_PANEL_H = 84;

  const panelDepths: number[] = [];
  panelDepths.push(sections[0].depthIn);
  for (let i = 0; i < sections.length - 1; i++) {
    panelDepths.push(Math.max(sections[i].depthIn, sections[i + 1].depthIn));
  }
  panelDepths.push(sections[sections.length - 1].depthIn);

  // Group panels by (heightClass, depthCat) and emit one line item per group.
  type GroupKey = string;
  const groups = new Map<GroupKey, { label: string; unitPrice: number; count: number }>();

  for (let pi = 0; pi < panelDepths.length; pi++) {
    const h        = panelHeights?.[pi] ?? DEFAULT_PANEL_H;
    const depthCat = roundUpPanelDepth(panelDepths[pi]);
    const hClass   = panelHeightClass(h);
    const unit     = PANEL_PRICE_TABLE[hClass][depthCat];
    const hLabel   = { quarter: "≤24\"", third: "25–42\"", half: "43–60\"", main: "61–96\"", tall: "97–120\"" }[hClass];
    const key      = `${hClass}|${depthCat}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      groups.set(key, { label: `Panel ${depthCat}" deep × ${hLabel} tall`, unitPrice: unit, count: 1 });
    }
  }

  for (const g of groups.values()) {
    lineItems.push({ label: g.label, qty: g.count, unitPrice: g.unitPrice, total: g.count * g.unitPrice });
  }

  // ── 2. Shelves ─────────────────────────────────────────────────────────────
  // 2 lock shelves per section (top + bottom) + any user-added Shelf components.
  // Grouped into 4 buckets: 12narrow, 12wide, 16narrow, 16wide.
  // Note: shelf pricing is depth-bucketed (12 or 16) regardless of exact depth.

  const shelfCounts = { s12n: 0, s12w: 0, s16n: 0, s16w: 0 };

  for (const sec of sections) {
    const bucket = depthBucket(sec.depthIn);
    const wide   = isWide(sec.widthIn);

    const lockCount = 2;
    const userCount = sec.components.filter(c => c.type === "Shelf").length;
    const total     = lockCount + userCount;

    if (bucket === 12) {
      if (wide) shelfCounts.s12w += total; else shelfCounts.s12n += total;
    } else {
      if (wide) shelfCounts.s16w += total; else shelfCounts.s16n += total;
    }
  }

  if (shelfCounts.s12n > 0) lineItems.push({ label: "Shelf 12\" narrow (≤30\")", qty: shelfCounts.s12n, unitPrice: SHELF_12_NARROW, total: shelfCounts.s12n * SHELF_12_NARROW });
  if (shelfCounts.s12w > 0) lineItems.push({ label: "Shelf 12\" wide (>30\")",   qty: shelfCounts.s12w, unitPrice: SHELF_12_WIDE,   total: shelfCounts.s12w * SHELF_12_WIDE   });
  if (shelfCounts.s16n > 0) lineItems.push({ label: "Shelf 16\" narrow (≤30\")", qty: shelfCounts.s16n, unitPrice: SHELF_16_NARROW, total: shelfCounts.s16n * SHELF_16_NARROW });
  if (shelfCounts.s16w > 0) lineItems.push({ label: "Shelf 16\" wide (>30\")",   qty: shelfCounts.s16w, unitPrice: SHELF_16_WIDE,   total: shelfCounts.s16w * SHELF_16_WIDE   });

  // ── 3. Rods ────────────────────────────────────────────────────────────────
  let rodsNarrow = 0;
  let rodsWide   = 0;

  for (const sec of sections) {
    const rodCount = sec.components.filter(c => c.type === "Rod").length;
    if (rodCount === 0) continue;
    if (isWide(sec.widthIn)) rodsWide += rodCount; else rodsNarrow += rodCount;
  }

  if (rodsNarrow > 0) lineItems.push({ label: "Rod (≤30\")", qty: rodsNarrow, unitPrice: ROD_NARROW, total: rodsNarrow * ROD_NARROW });
  if (rodsWide   > 0) lineItems.push({ label: "Rod (>30\")", qty: rodsWide,   unitPrice: ROD_WIDE,   total: rodsWide   * ROD_WIDE   });

  // ── 4. Drawers ─────────────────────────────────────────────────────────────
  let drawerCount = 0;
  for (const sec of sections) {
    for (const comp of sec.components) {
      if (comp.type === "DrawerStack") drawerCount += comp.drawerHeights.length;
    }
  }

  if (drawerCount > 0) {
    lineItems.push({ label: "Drawer box 75% ext.", qty: drawerCount, unitPrice: DRAWER_75, total: drawerCount * DRAWER_75 });
  }

  // ── 5. Doors ───────────────────────────────────────────────────────────────
  // Price each door by its section width × door height using the Flat Face base.
  // Deco add-ons for doors are applied separately in presentation-pricing.ts.
  for (const sec of sections) {
    for (const comp of sec.components) {
      if (comp.type !== "Door") continue;
      const doorH  = comp.doorHeightIn ?? 80;
      const prices = lookupDoorPrices(sec.widthIn, doorH);
      lineItems.push({
        label:     `Door — Flat Face (${sec.widthIn.toFixed(0)}"w × ${doorH.toFixed(0)}"h)`,
        qty:       1,
        unitPrice: prices.base,
        total:     prices.base,
      });
    }
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  const subtotal   = lineItems.reduce((sum, li) => sum + li.total, 0);
  const adjustment = Math.round(subtotal * ADJUSTMENT_RATE * 100) / 100;
  const total      = Math.round((subtotal + adjustment) * 100) / 100;

  return { lineItems, subtotal, adjustment, total, warnings };
}
