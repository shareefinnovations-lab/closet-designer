// src/lib/presentation-pricing.ts
//
// Presentation pricing engine — extends the base pricing engine with:
//   - Material tier multipliers  (Everyday / Classic / Regency / Brio)
//   - Custom options             (backing, doors, molding, slides, etc.)
//   - Accessories                (valet rods, tie racks, etc.)
//   - Promotion discount
// Pure function — no React, no side-effects.

import { computePricing, type PricingSection, type LineItem } from "./pricing";

// ─── Material Tiers ───────────────────────────────────────────────────────────

export type MaterialTier = "Everyday" | "Classic" | "Regency" | "Brio";

export interface TierDef {
  label:      string;
  tagline:    string;
  multiplier: number; // applied to base total (post-11% adjustment)
}

export const TIER_ORDER: MaterialTier[] = ["Everyday", "Classic", "Regency", "Brio"];

export const MATERIAL_TIERS: Record<MaterialTier, TierDef> = {
  Everyday: { label: "Everyday", tagline: "Great value starter system",         multiplier: 1.00 },
  Classic:  { label: "Classic",  tagline: "Most popular — upgraded finishes",   multiplier: 1.15 },
  Regency:  { label: "Regency",  tagline: "Premium materials & aesthetics",     multiplier: 1.30 },
  Brio:     { label: "Brio",     tagline: "Top-of-the-line full feature system", multiplier: 1.45 },
};

// ─── Layout counts (derived from sections) ────────────────────────────────────

export interface LayoutCounts {
  panelCount:   number;
  sectionCount: number;
  shelfCount:   number;  // includes 2 lock shelves per section
  drawerCount:  number;  // individual drawer boxes
  rodCount:     number;
  wallWidthIn:  number;
}

export function computeLayoutCounts(
  sections: PricingSection[],
  wallWidthIn: number,
): LayoutCounts {
  let shelfCount = 0, drawerCount = 0, rodCount = 0;
  for (const sec of sections) {
    shelfCount += 2; // lock shelves (top + bottom of every section)
    for (const comp of sec.components) {
      if (comp.type === "Shelf")       shelfCount++;
      if (comp.type === "Rod")         rodCount++;
      if (comp.type === "DrawerStack") drawerCount += comp.drawerHeights.length;
    }
  }
  return {
    panelCount:   sections.length + 1,
    sectionCount: sections.length,
    shelfCount,
    drawerCount,
    rodCount,
    wallWidthIn,
  };
}

// ─── Custom Options ───────────────────────────────────────────────────────────

export type OptionKey =
  | "solidColorMelamine"
  | "woodgrainMelamine"
  | "backing"
  | "brioBacking"
  | "decoDoors100_400"
  | "decoDoors500_Shaker"
  | "moldingPackage"
  | "moldingTopOrBottom"
  | "softCloseSlides"
  | "accentTopShelf"
  | "premiumOptions";

export const OPTION_ORDER: OptionKey[] = [
  "solidColorMelamine",
  "woodgrainMelamine",
  "backing",
  "brioBacking",
  "decoDoors100_400",
  "decoDoors500_Shaker",
  "moldingPackage",
  "moldingTopOrBottom",
  "softCloseSlides",
  "accentTopShelf",
  "premiumOptions",
];

export interface OptionDef {
  label:     string;
  unitLabel: string;
  unitPrice: number; // 0 = standard/included
  calcQty:   (c: LayoutCounts) => number;
}

export const OPTIONS: Record<OptionKey, OptionDef> = {
  solidColorMelamine:  { label: "Solid Color Melamine",          unitLabel: "per panel",    unitPrice: 0,   calcQty: c => c.panelCount   },
  woodgrainMelamine:   { label: "Woodgrain Melamine",            unitLabel: "per panel",    unitPrice: 28,  calcQty: c => c.panelCount   },
  backing:             { label: "Backing",                        unitLabel: "per section",  unitPrice: 52,  calcQty: c => c.sectionCount },
  brioBacking:         { label: "Brio Backing",                   unitLabel: "per section",  unitPrice: 78,  calcQty: c => c.sectionCount },
  decoDoors100_400:    { label: "Deco Doors (100–400 Series)",    unitLabel: "per opening",  unitPrice: 195, calcQty: c => c.sectionCount },
  decoDoors500_Shaker: { label: "Deco Doors (500 / Shaker 600)", unitLabel: "per opening",  unitPrice: 295, calcQty: c => c.sectionCount },
  moldingPackage:      { label: "Molding Package",                unitLabel: "per lin. in.", unitPrice: 4,   calcQty: c => c.wallWidthIn  },
  moldingTopOrBottom:  { label: "Molding Top or Bottom",          unitLabel: "per lin. in.", unitPrice: 2,   calcQty: c => c.wallWidthIn  },
  softCloseSlides:     { label: "Soft Close Slides",              unitLabel: "per drawer",   unitPrice: 38,  calcQty: c => c.drawerCount  },
  accentTopShelf:      { label: "Accent Top Shelf",               unitLabel: "per panel",    unitPrice: 58,  calcQty: c => c.panelCount   },
  premiumOptions:      { label: "Premium Options",                unitLabel: "package",      unitPrice: 175, calcQty: _ => 1              },
};

// ─── Accessories ──────────────────────────────────────────────────────────────

export type AccessoryKey =
  | "drawerInserts"
  | "valetRods"
  | "tieRacks"
  | "beltRacks"
  | "hamper"
  | "jewelryInserts"
  | "hooks";

export const ACCESSORY_ORDER: AccessoryKey[] = [
  "drawerInserts",
  "valetRods",
  "tieRacks",
  "beltRacks",
  "hamper",
  "jewelryInserts",
  "hooks",
];

export interface AccessoryDef {
  label:     string;
  unitPrice: number;
}

export const ACCESSORIES: Record<AccessoryKey, AccessoryDef> = {
  drawerInserts:  { label: "Drawer Inserts",  unitPrice: 48  },
  valetRods:      { label: "Valet Rods",      unitPrice: 68  },
  tieRacks:       { label: "Tie Racks",       unitPrice: 58  },
  beltRacks:      { label: "Belt Racks",      unitPrice: 58  },
  hamper:         { label: "Hamper",          unitPrice: 195 },
  jewelryInserts: { label: "Jewelry Inserts", unitPrice: 98  },
  hooks:          { label: "Hooks",           unitPrice: 14  },
};

// ─── Result shape ─────────────────────────────────────────────────────────────

export interface OptionLine {
  key:       OptionKey;
  label:     string;
  qty:       number;
  unitPrice: number;
  total:     number;
}

export interface AccessoryLine {
  key:       AccessoryKey;
  label:     string;
  qty:       number;
  unitPrice: number;
  total:     number;
}

export interface PresentationResult {
  layoutCounts:    LayoutCounts;
  baseLineItems:   LineItem[];   // from base pricing engine
  baseSubtotal:    number;       // raw component cost (before 11%)
  baseAdjustment:  number;       // 11% adjustment
  baseTotal:       number;       // baseSubtotal + adjustment (Everyday price)
  tierMultiplier:  number;
  tierUpgrade:     number;       // delta from material tier (0 for Everyday)
  materialBase:    number;       // baseTotal × tierMultiplier
  optionLines:     OptionLine[];  // only lines with total > 0
  optionsTotal:    number;
  accessoryLines:  AccessoryLine[];
  accessoriesTotal: number;
  subtotal:        number;       // materialBase + optionsTotal + accessoriesTotal
  promoDiscount:   number;
  finalTotal:      number;
  warnings:        string[];
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export function computePresentationPricing(
  sections:        PricingSection[],
  overallDepthIn:  number,
  wallWidthIn:     number,
  materialTier:    MaterialTier,
  selectedOptions: Set<OptionKey>,
  accessoryQtys:   Partial<Record<AccessoryKey, number>>,
  promoDiscount:   number,
): PresentationResult {
  const base   = computePricing(sections, overallDepthIn);
  const counts = computeLayoutCounts(sections, wallWidthIn);

  // Material tier
  const tierMultiplier = MATERIAL_TIERS[materialTier].multiplier;
  const materialBase   = Math.round(base.total * tierMultiplier * 100) / 100;
  const tierUpgrade    = Math.round((materialBase - base.total) * 100) / 100;

  // Options — skip $0 lines from the output (they are standard inclusions)
  const optionLines: OptionLine[] = [];
  for (const key of OPTION_ORDER) {
    if (!selectedOptions.has(key)) continue;
    const opt   = OPTIONS[key];
    const qty   = opt.calcQty(counts);
    const total = Math.round(qty * opt.unitPrice * 100) / 100;
    if (total <= 0) continue; // standard/included — not a billable add-on
    optionLines.push({ key, label: opt.label, qty, unitPrice: opt.unitPrice, total });
  }
  const optionsTotal = optionLines.reduce((s, o) => s + o.total, 0);

  // Accessories
  const accessoryLines: AccessoryLine[] = [];
  for (const key of ACCESSORY_ORDER) {
    const qty = accessoryQtys[key] ?? 0;
    if (qty <= 0) continue;
    const acc   = ACCESSORIES[key];
    const total = qty * acc.unitPrice;
    accessoryLines.push({ key, label: acc.label, qty, unitPrice: acc.unitPrice, total });
  }
  const accessoriesTotal = accessoryLines.reduce((s, a) => s + a.total, 0);

  const subtotal   = materialBase + optionsTotal + accessoriesTotal;
  const finalTotal = Math.max(0, Math.round((subtotal - promoDiscount) * 100) / 100);

  return {
    layoutCounts:    counts,
    baseLineItems:   base.lineItems,
    baseSubtotal:    base.subtotal,
    baseAdjustment:  base.adjustment,
    baseTotal:       base.total,
    tierMultiplier,
    tierUpgrade,
    materialBase,
    optionLines,
    optionsTotal,
    accessoryLines,
    accessoriesTotal,
    subtotal,
    promoDiscount,
    finalTotal,
    warnings:        base.warnings,
  };
}
