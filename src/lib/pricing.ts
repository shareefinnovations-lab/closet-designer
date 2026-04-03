// src/lib/pricing.ts
//
// Pure pricing engine — no React, no side-effects.
// Takes the current sections state and computes a full Bill of Materials
// with line items, subtotal, 11% adjustment, and total.

// ─── Catalog prices ───────────────────────────────────────────────────────────

const PANEL_12      = 348;   // 12" deep panel
const PANEL_16      = 435;   // 16" deep panel

const SHELF_12_NARROW = 62;  // 12" deep, ≤30" wide
const SHELF_12_WIDE   = 83;  // 12" deep, >30" wide
const SHELF_16_NARROW = 75;  // 16" deep, ≤30" wide
const SHELF_16_WIDE   = 100; // 16" deep, >30" wide

const ROD_NARROW = 99;       // ≤30" wide
const ROD_WIDE   = 118;      // >30" wide

const DRAWER_75 = 310;       // 75% extension drawer box (any height)

export const ADJUSTMENT_RATE = 0.11; // 11%

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PricingSection {
  widthIn: number;
  depthIn: number;
  components: {
    type: "Shelf" | "Rod" | "DrawerStack";
    drawerHeights: number[];
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

/** Round depth up to 12 or 16. Anything above 16 still prices at 16 (with a warning). */
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
 * @param overallDepthIn Overall closet depth — used for outer panels
 */
export function computePricing(
  sections: PricingSection[],
  overallDepthIn: number
): PricingResult {
  const lineItems: LineItem[] = [];
  const warnings: string[] = [];

  if (sections.length === 0) {
    return { lineItems: [], subtotal: 0, adjustment: 0, total: 0, warnings: [] };
  }

  // ── 1. Panels ──────────────────────────────────────────────────────────────
  // There are (sections.length + 1) vertical panels total.
  // - Outer left panel:  uses sections[0].depthIn
  // - Outer right panel: uses sections[N-1].depthIn
  // - Each inner panel:  uses max depth of its two neighboring sections
  //
  // Group panels by price tier and emit separate line items per tier.

  const panelDepths: number[] = [];

  // Left outer panel — uses the leftmost section's actual depth
  panelDepths.push(sections[0].depthIn);
  // Inner panels — use max depth of the two sections they separate
  for (let i = 0; i < sections.length - 1; i++) {
    panelDepths.push(Math.max(sections[i].depthIn, sections[i + 1].depthIn));
  }
  // Right outer panel — uses the rightmost section's actual depth
  panelDepths.push(sections[sections.length - 1].depthIn);

  // Check for overall depth > 16"
  if (overallDepthIn > 16) {
    warnings.push(`Overall depth (${overallDepthIn}") exceeds 16" — verify panel depth with supplier.`);
  }

  const panels12 = panelDepths.filter(d => depthBucket(d) === 12).length;
  const panels16 = panelDepths.filter(d => depthBucket(d) === 16).length;

  if (panels12 > 0) {
    lineItems.push({ label: "Panel 12\" deep", qty: panels12, unitPrice: PANEL_12, total: panels12 * PANEL_12 });
  }
  if (panels16 > 0) {
    lineItems.push({ label: "Panel 16\" deep", qty: panels16, unitPrice: PANEL_16, total: panels16 * PANEL_16 });
  }

  // ── 2. Shelves ─────────────────────────────────────────────────────────────
  // 2 lock shelves per section (top + bottom) + any user-added Shelf components.
  // Grouped into 4 buckets: 12narrow, 12wide, 16narrow, 16wide.

  const shelfCounts = { s12n: 0, s12w: 0, s16n: 0, s16w: 0 };

  for (const sec of sections) {
    const bucket = depthBucket(sec.depthIn);
    const wide = isWide(sec.widthIn);

    // 2 lock shelves always present
    const lockCount = 2;
    // User shelves
    const userCount = sec.components.filter(c => c.type === "Shelf").length;
    const total = lockCount + userCount;

    if (bucket === 12) {
      if (wide) shelfCounts.s12w += total; else shelfCounts.s12n += total;
    } else {
      if (wide) shelfCounts.s16w += total; else shelfCounts.s16n += total;
    }

    if (sec.widthIn > 42) {
      warnings.push(`Section width (${sec.widthIn}") exceeds 42" — consider adding a center panel.`);
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
  // Count individual drawer boxes across all DrawerStack components.
  let drawerCount = 0;
  for (const sec of sections) {
    for (const comp of sec.components) {
      if (comp.type === "DrawerStack") {
        drawerCount += comp.drawerHeights.length;
      }
    }
  }

  if (drawerCount > 0) {
    lineItems.push({ label: "Drawer box 75% ext.", qty: drawerCount, unitPrice: DRAWER_75, total: drawerCount * DRAWER_75 });
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  const subtotal   = lineItems.reduce((sum, li) => sum + li.total, 0);
  const adjustment = Math.round(subtotal * ADJUSTMENT_RATE * 100) / 100;
  const total      = Math.round((subtotal + adjustment) * 100) / 100;

  return { lineItems, subtotal, adjustment, total, warnings };
}
