// src/lib/presentation-pricing.ts
//
// Presentation pricing engine — Designing Lite + dual-discount rules.
//
// Calculation chain:
//   1. Compute each line-item's original price
//   2. discountedPrice = originalPrice × (1 − LINE_DISCOUNT_RATE)   [40% off]
//   3. subtotalAfter40 = Σ discountedPrices
//   4. discountAmount15 = subtotalAfter40 × FINAL_DISCOUNT_RATE      [15% off]
//   5. finalTotal = subtotalAfter40 × (1 − FINAL_DISCOUNT_RATE)
//
// Pure function — no React, no side-effects.

import { computePricing, type PricingSection, type LineItem } from "./pricing";

// ─── Discount constants ───────────────────────────────────────────────────────

export const LINE_DISCOUNT_RATE  = 0.40; // 40% off every individual line item
export const FINAL_DISCOUNT_RATE = 0.15; // additional 15% off the 40%-discounted subtotal

// ─── System Tiers ─────────────────────────────────────────────────────────────

export type MaterialTier = "Everyday" | "Classic" | "Regency" | "Brio";

export interface TierDef {
  label:       string;
  tagline:     string;
  ratePercent: number;
}

export const TIER_ORDER: MaterialTier[] = ["Everyday", "Classic", "Regency", "Brio"];

export const MATERIAL_TIERS: Record<MaterialTier, TierDef> = {
  Everyday: { label: "Everyday", tagline: "Standard system",                    ratePercent: 0  },
  Classic:  { label: "Classic",  tagline: "Most popular — upgraded finishes",   ratePercent: 8  },
  Regency:  { label: "Regency",  tagline: "Premium materials & aesthetics",     ratePercent: 15 },
  Brio:     { label: "Brio",     tagline: "Top-of-the-line full feature system", ratePercent: 36 },
};

// ─── Material Options ─────────────────────────────────────────────────────────

export type MaterialOption = "none" | "solidColor" | "woodgrain";

export interface MaterialOptionDef {
  label:       string;
  ratePercent: number;
}

export const MATERIAL_OPTION_ORDER: MaterialOption[] = ["none", "solidColor", "woodgrain"];

export const MATERIAL_OPTIONS: Record<MaterialOption, MaterialOptionDef> = {
  none:       { label: "Standard (White)",     ratePercent: 0  },
  solidColor: { label: "Solid Color Melamine", ratePercent: 8  },
  woodgrain:  { label: "Woodgrain Melamine",   ratePercent: 25 },
};

// ─── Backing Options ──────────────────────────────────────────────────────────

export type BackingOption =
  | "none"
  | "standard_quarter"
  | "standard_threequarter"
  | "brio_quarter"
  | "brio_threequarter";

export interface BackingOptionDef {
  label:       string;
  spec:        string;
  ratePerSqFt: number;
}

export const BACKING_OPTION_ORDER: BackingOption[] = [
  "none", "standard_quarter", "standard_threequarter", "brio_quarter", "brio_threequarter",
];

export const BACKING_OPTIONS: Record<BackingOption, BackingOptionDef> = {
  none:                  { label: "No Backing",       spec: "",             ratePerSqFt: 0     },
  standard_quarter:      { label: "Standard Backing", spec: "1/4\" 1-sided", ratePerSqFt: 17.80 },
  standard_threequarter: { label: "Standard Backing", spec: "3/4\" 2-sided", ratePerSqFt: 29.00 },
  brio_quarter:          { label: "Brio Backing",     spec: "1/4\" 1-sided", ratePerSqFt: 21.80 },
  brio_threequarter:     { label: "Brio Backing",     spec: "3/4\" 2-sided", ratePerSqFt: 34.00 },
};

// ─── Deco Options ─────────────────────────────────────────────────────────────

export type DecoOption = "none" | "deco100_400_700" | "deco500_600";

export interface DecoOptionDef {
  label:         string;
  spec:          string;
  pricePerPiece: number;
}

export const DECO_OPTION_ORDER: DecoOption[] = ["none", "deco100_400_700", "deco500_600"];

export const DECO_OPTIONS: Record<DecoOption, DecoOptionDef> = {
  none:            { label: "No Deco",               spec: "",                            pricePerPiece: 0   },
  deco100_400_700: { label: "Deco 100–400 / 700",    spec: "100–400 series & 700 series", pricePerPiece: 170 },
  deco500_600:     { label: "Deco 500 / Shaker 600", spec: "500 series & Shaker 600",     pricePerPiece: 306 },
};

// ─── Accessories ──────────────────────────────────────────────────────────────

export type AccessoryKey =
  | "drawerInserts" | "valetRods" | "tieRacks" | "beltRacks"
  | "hamper" | "jewelryInserts" | "hooks";

export const ACCESSORY_ORDER: AccessoryKey[] = [
  "drawerInserts", "valetRods", "tieRacks", "beltRacks", "hamper", "jewelryInserts", "hooks",
];

export interface AccessoryDef { label: string; unitPrice: number; }

export const ACCESSORIES: Record<AccessoryKey, AccessoryDef> = {
  drawerInserts:  { label: "Drawer Inserts",  unitPrice: 48  },
  valetRods:      { label: "Valet Rods",      unitPrice: 68  },
  tieRacks:       { label: "Tie Racks",       unitPrice: 58  },
  beltRacks:      { label: "Belt Racks",      unitPrice: 58  },
  hamper:         { label: "Hamper",          unitPrice: 195 },
  jewelryInserts: { label: "Jewelry Inserts", unitPrice: 98  },
  hooks:          { label: "Hooks",           unitPrice: 14  },
};

// ─── Layout counts ────────────────────────────────────────────────────────────

export interface LayoutCounts {
  panelCount:        number;
  sectionCount:      number;
  shelfCount:        number;
  drawerCount:       number;
  rodCount:          number;
  doorCount:         number;
  wallWidthIn:       number;
  ceilingH:          number;
  systemHeightIn:    number;  // actual closet system height used for backing (panel height, not ceiling)
  backingSquareFeet: number;
}

export function computeLayoutCounts(
  sections:     PricingSection[],
  wallWidthIn:  number,
  ceilingH:     number,
  panelHeights: number[],
): LayoutCounts {
  let shelfCount = 0, drawerCount = 0, rodCount = 0;
  for (const sec of sections) {
    shelfCount += 2;
    for (const comp of sec.components) {
      if (comp.type === "Shelf")       shelfCount++;
      if (comp.type === "Rod")         rodCount++;
      if (comp.type === "DrawerStack") drawerCount += comp.drawerHeights.length;
    }
  }

  // Backing area = sum of (section width × actual section height) for all sections.
  // Section height = min of its two bounding panel heights (clamped to ceilingH).
  // This uses the real closet panel/system height, not the ceiling height.
  let backingAreaIn2 = 0;
  let totalWidthIn   = 0;
  for (let i = 0; i < sections.length; i++) {
    const leftH    = Math.min(panelHeights[i]     ?? ceilingH, ceilingH);
    const rightH   = Math.min(panelHeights[i + 1] ?? ceilingH, ceilingH);
    const sectionH = Math.min(leftH, rightH);
    backingAreaIn2 += sections[i].widthIn * sectionH;
    totalWidthIn   += sections[i].widthIn;
  }
  const backingSquareFeet = Math.round((backingAreaIn2 / 144) * 100) / 100;
  // Effective system height: backing area divided by total width.
  // For a uniform design this equals the panel height exactly.
  const systemHeightIn = totalWidthIn > 0 ? Math.round(backingAreaIn2 / totalWidthIn) : 0;

  return {
    panelCount:   sections.length + 1,
    sectionCount: sections.length,
    shelfCount,
    drawerCount,
    rodCount,
    doorCount:    0,
    wallWidthIn,
    ceilingH,
    systemHeightIn,
    backingSquareFeet,
  };
}

// ─── Priced item (one billable entry) ────────────────────────────────────────

export interface PricedItem {
  label:           string;
  originalPrice:   number;
  discountedPrice: number; // originalPrice × (1 − LINE_DISCOUNT_RATE)
}

export interface AccessoryLine {
  key:             AccessoryKey;
  label:           string;
  qty:             number;
  unitOriginal:    number;
  unitDiscounted:  number;
  totalOriginal:   number;
  totalDiscounted: number;
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface PresentationResult {
  // Layout
  layoutCounts:      LayoutCounts;
  baseLineItems:     LineItem[];

  // Step-by-step original prices (used to preview option impacts in the UI)
  baseSubtotal:      number;
  baseAdjustment:    number;
  baseLayoutPrice:   number;   // base total incl. 11% — original, before discounts
  tierRatePercent:   number;
  tierUpgrade:       number;   // original delta
  afterTierPrice:    number;   // used by material option preview
  materialRatePercent: number;
  materialUpgrade:   number;   // original delta
  afterMaterialPrice: number;
  backingRatePerSqFt: number;
  backingSquareFeet:  number;
  backingPrice:       number;  // original
  decoTotalPieces:    number;
  decoPricePerPiece:  number;
  decoPrice:          number;  // original
  accessoryLines:     AccessoryLine[];
  accessoriesTotal:   number;  // original

  // Discount layers
  pricedItems:            PricedItem[]; // every billable item with both prices
  subtotalBeforeDiscount: number;       // Σ originalPrice
  discountAmount40:       number;       // subtotalBeforeDiscount × LINE_DISCOUNT_RATE
  subtotalAfter40:        number;       // Σ discountedPrice
  discountAmount15:       number;       // subtotalAfter40 × FINAL_DISCOUNT_RATE
  finalTotal:             number;       // subtotalAfter40 × (1 − FINAL_DISCOUNT_RATE)

  warnings: string[];
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function lineDiscount(original: number): number {
  return Math.round(original * (1 - LINE_DISCOUNT_RATE) * 100) / 100;
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export function computePresentationPricing(
  sections:       PricingSection[],
  overallDepthIn: number,
  wallWidthIn:    number,
  ceilingH:       number,
  panelHeights:   number[],
  materialTier:   MaterialTier,
  materialOption: MaterialOption,
  backingOption:  BackingOption,
  decoOption:     DecoOption,
  accessoryQtys:  Partial<Record<AccessoryKey, number>>,
): PresentationResult {
  const base   = computePricing(sections, overallDepthIn);
  const counts = computeLayoutCounts(sections, wallWidthIn, ceilingH, panelHeights);
  const r2     = (n: number) => Math.round(n * 100) / 100;

  // ── Step-by-step original prices ─────────────────────────────────────────

  const baseLayoutPrice = base.total;

  const tierRatePercent = MATERIAL_TIERS[materialTier].ratePercent;
  const tierUpgrade     = r2(baseLayoutPrice * tierRatePercent / 100);
  const afterTierPrice  = r2(baseLayoutPrice + tierUpgrade);

  const materialRatePercent = MATERIAL_OPTIONS[materialOption].ratePercent;
  const materialUpgrade     = r2(afterTierPrice * materialRatePercent / 100);
  const afterMaterialPrice  = r2(afterTierPrice + materialUpgrade);

  const backingDef   = BACKING_OPTIONS[backingOption];
  const backingPrice = r2(counts.backingSquareFeet * backingDef.ratePerSqFt);

  const decoDef         = DECO_OPTIONS[decoOption];
  const decoTotalPieces = counts.drawerCount + counts.doorCount;
  const decoPrice       = decoTotalPieces > 0 ? decoDef.pricePerPiece * decoTotalPieces : 0;

  // Accessories
  const accessoryLines: AccessoryLine[] = [];
  for (const key of ACCESSORY_ORDER) {
    const qty = accessoryQtys[key] ?? 0;
    if (qty <= 0) continue;
    const acc = ACCESSORIES[key];
    const totalOrig = acc.unitPrice * qty;
    accessoryLines.push({
      key,
      label:           acc.label,
      qty,
      unitOriginal:    acc.unitPrice,
      unitDiscounted:  lineDiscount(acc.unitPrice),
      totalOriginal:   totalOrig,
      totalDiscounted: lineDiscount(totalOrig),
    });
  }
  const accessoriesTotal = accessoryLines.reduce((s, a) => s + a.totalOriginal, 0);

  // ── Build priced items list ───────────────────────────────────────────────
  // Each item carries its own 40% discount.

  const pricedItems: PricedItem[] = [];

  if (baseLayoutPrice > 0) {
    pricedItems.push({
      label: "Base Layout",
      originalPrice:   baseLayoutPrice,
      discountedPrice: lineDiscount(baseLayoutPrice),
    });
  }
  if (tierUpgrade > 0) {
    pricedItems.push({
      label: `System Tier — ${materialTier} (+${tierRatePercent}%)`,
      originalPrice:   tierUpgrade,
      discountedPrice: lineDiscount(tierUpgrade),
    });
  }
  if (materialUpgrade > 0) {
    pricedItems.push({
      label: `Material — ${MATERIAL_OPTIONS[materialOption].label} (+${materialRatePercent}%)`,
      originalPrice:   materialUpgrade,
      discountedPrice: lineDiscount(materialUpgrade),
    });
  }
  if (backingPrice > 0) {
    pricedItems.push({
      label: `Backing — ${backingDef.label} ${backingDef.spec} (${counts.backingSquareFeet} sqft)`,
      originalPrice:   backingPrice,
      discountedPrice: lineDiscount(backingPrice),
    });
  }
  if (decoPrice > 0) {
    pricedItems.push({
      label: `Deco — ${decoDef.label} (${decoTotalPieces} piece${decoTotalPieces !== 1 ? "s" : ""})`,
      originalPrice:   decoPrice,
      discountedPrice: lineDiscount(decoPrice),
    });
  }
  for (const al of accessoryLines) {
    pricedItems.push({
      label:           `${al.label} × ${al.qty}`,
      originalPrice:   al.totalOriginal,
      discountedPrice: al.totalDiscounted,
    });
  }

  // ── Discount totals ───────────────────────────────────────────────────────

  const subtotalBeforeDiscount = r2(pricedItems.reduce((s, i) => s + i.originalPrice, 0));
  const subtotalAfter40        = r2(pricedItems.reduce((s, i) => s + i.discountedPrice, 0));
  const discountAmount40       = r2(subtotalBeforeDiscount - subtotalAfter40);
  const discountAmount15       = r2(subtotalAfter40 * FINAL_DISCOUNT_RATE);
  const finalTotal             = r2(subtotalAfter40 * (1 - FINAL_DISCOUNT_RATE));

  return {
    layoutCounts:      counts,
    baseLineItems:     base.lineItems,
    baseSubtotal:      base.subtotal,
    baseAdjustment:    base.adjustment,
    baseLayoutPrice,
    tierRatePercent,
    tierUpgrade,
    afterTierPrice,
    materialRatePercent,
    materialUpgrade,
    afterMaterialPrice,
    backingRatePerSqFt: backingDef.ratePerSqFt,
    backingSquareFeet:  counts.backingSquareFeet,
    backingPrice,
    decoTotalPieces,
    decoPricePerPiece:  decoDef.pricePerPiece,
    decoPrice,
    accessoryLines,
    accessoriesTotal,
    pricedItems,
    subtotalBeforeDiscount,
    discountAmount40,
    subtotalAfter40,
    discountAmount15,
    finalTotal,
    warnings: base.warnings,
  };
}
