"use client";
// app/presentation/page.tsx — Per-wall price presentation (v2)
//
// Each wall has its own independent upgrade selections and price calculation.
// Discount model (unchanged):
//   • 40% off every individual line item  — applied per wall, per item
//   • Additional 15% off the discounted subtotal — applied per wall
//
// Combined section sums the already-discounted wall finalTotals — no re-discounting.
// Persists to localStorage["closet-presentation"] (v2 format).

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getActiveProjectId, saveCurrentProject } from "@/app/_lib/projects";
import {
  computePresentationPricing,
  MATERIAL_TIERS,
  TIER_ORDER,
  MATERIAL_OPTIONS,
  MATERIAL_OPTION_ORDER,
  BACKING_OPTIONS,
  BACKING_OPTION_ORDER,
  DECO_OPTIONS,
  DECO_OPTION_ORDER,
  ACCESSORIES,
  ACCESSORY_ORDER,
  MOLDING_PACKAGES,
  MOLDING_PACKAGE_ORDER,
  BASE_MOLDING,
  BASE_MOLDING_ORDER,
  TOP_MOLDING,
  TOP_MOLDING_ORDER,
  VALANCE,
  VALANCE_ORDER,
  SCRIBE_SHOE,
  SCRIBE_SHOE_ORDER,
  DEFAULT_MOLDING_INPUT,
  LINE_DISCOUNT_RATE,
  FINAL_DISCOUNT_RATE,
  type MaterialTier,
  type MaterialOption,
  type BackingOption,
  type DecoOption,
  type AccessoryKey,
  type MoldingPackage,
  type BaseMoldingKey,
  type TopMoldingKey,
  type ValanceKey,
  type ScribeShoeKey,
  type MoldingInput,
  type PresentationResult,
} from "@/src/lib/presentation-pricing";
import { runToPricingSections, runToPanelHeights } from "@/src/lib/wall-pricing";
import type { DesignStateV2, StoredRun } from "@/src/lib/wall-pricing";
import type { RoomLayout, DesignWall } from "@/app/_lib/room-types";
import { getSelectedWalls } from "@/app/_lib/room-types";

// ─── Finish Selection ─────────────────────────────────────────────────────────

type FinishMaterial = "solidColor" | "woodgrain" | "brio";

const FINISH_COLORS: Record<FinishMaterial, string[]> = {
  solidColor: [
    "Antique White", "Light Grey", "Dark Grey", "Black", "Pumice", "Almond",
  ],
  woodgrain: [
    "Chocolate Pear", "African Walnut", "Cherry Blossom", "Wild Cherry",
    "Organic Cherry", "Pearwood", "Honey Maple", "Hard Rock Maple",
    "Fusion Maple", "Sherwood Oak", "Candlelight",
  ],
  brio: [
    "Spring Blossom", "Oyster Pine", "Mocha", "Sand Pine", "Dark Teak",
    "Light Teak", "Latitude Grey", "River Rock", "Latitude White", "Sandstone",
    "Greystone", "Antique Pearl", "Pearl", "Espresso", "Summer Breeze",
    "Winter Cherry", "Autumn Leaves", "Onyx",
  ],
};

// Series options per deco pricing tier
const DECO_SERIES_FOR: Partial<Record<DecoOption, string[]>> = {
  deco100_400_700: ["100", "200", "300", "400", "700"],
  deco500_600:     ["500", "600"],
};

// ─── Types ────────────────────────────────────────────────────────────────────

/** All upgrade selections for one wall — stored independently per wall. */
interface WallSel {
  tier:          MaterialTier;
  material:      MaterialOption;
  finishColor:   string;     // selected color name — display only, no pricing effect
  decoStyle:     string;     // individual series value; maps to `deco` for pricing
  backing:       BackingOption;
  deco:          DecoOption;
  accessoryQtys: Partial<Record<AccessoryKey, number>>;
  notes:         string;
  moldingSel:    MoldingInput;  // full molding configuration
  softClose:     boolean;
  accentShelf:   boolean;
}

function defaultSel(): WallSel {
  return {
    tier:          "Classic",
    material:      "none",
    finishColor:   "",
    decoStyle:     "none",
    backing:       "none",
    deco:          "none",
    accessoryQtys: {},
    notes:         "",
    moldingSel:    DEFAULT_MOLDING_INPUT,
    softClose:     false,
    accentShelf:   false,
  };
}

interface WallData {
  wall:  DesignWall;
  run:   StoredRun;
  label: string;
}

/** v2 save format — one WallSel per wallId + which walls are checked for combined view. */
interface PresentationSave {
  v:               2;
  wallSelections:  Record<string, WallSel>;
  selectedWallIds: string[];
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt0(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function off40(n: number): number {
  return Math.round(n * (1 - LINE_DISCOUNT_RATE) * 100) / 100;
}
function today(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PresentationPage() {
  const router = useRouter();

  const [layout,          setLayout]          = useState<RoomLayout | null>(null);
  const [wallDataList,    setWallDataList]     = useState<WallData[]>([]);
  const [wallSels,        setWallSels]         = useState<Record<string, WallSel>>({});
  const [selectedWallIds, setSelectedWallIds]  = useState<string[]>([]);
  const [error,           setError]            = useState<string | null>(null);
  const [ready,           setReady]            = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const rawLayout = localStorage.getItem("room-layout");
    const rawState  = localStorage.getItem("design-state");

    if (!rawLayout) { setError("No room layout found. Please complete the room layout first."); return; }
    if (!rawState)  { setError("No design found. Please complete the design first."); return; }

    try {
      const layout      = JSON.parse(rawLayout) as RoomLayout;
      const designState = JSON.parse(rawState)  as DesignStateV2;

      if (designState.v !== 2 || !Array.isArray(designState.runs)) {
        setError("Design data format not recognized. Please go back and re-save your design.");
        return;
      }

      const selectedWalls = getSelectedWalls(layout);
      const wallDataArr: WallData[] = [];

      for (let i = 0; i < selectedWalls.length; i++) {
        const wall = selectedWalls[i];
        const run  = designState.runs.find(r => r.wallId === wall.id);
        if (!run || run.sections.length === 0) continue;
        wallDataArr.push({ wall, run, label: `Wall ${String.fromCharCode(65 + i)}` });
      }

      // Restore saved selections
      const initSels: Record<string, WallSel> = {};
      let savedSelectedIds: string[] = [];

      const rawPres = localStorage.getItem("closet-presentation");
      if (rawPres) {
        try {
          const saved = JSON.parse(rawPres) as Partial<PresentationSave>;
          if (saved.v === 2 && saved.wallSelections) {
            for (const wd of wallDataArr) {
              if (saved.wallSelections[wd.wall.id]) {
                initSels[wd.wall.id] = { ...defaultSel(), ...saved.wallSelections[wd.wall.id] };
              }
            }
          }
          if (Array.isArray(saved.selectedWallIds)) {
            savedSelectedIds = saved.selectedWallIds.filter(id =>
              wallDataArr.some(wd => wd.wall.id === id)
            );
          }
        } catch { /* ignore corrupt save */ }
      }

      // Default to Classic / all walls selected for any not in saved state
      for (const wd of wallDataArr) {
        if (!initSels[wd.wall.id]) initSels[wd.wall.id] = defaultSel();
      }

      setLayout(layout);
      setWallDataList(wallDataArr);
      setWallSels(initSels);
      setSelectedWallIds(
        savedSelectedIds.length > 0
          ? savedSelectedIds
          : wallDataArr.map(wd => wd.wall.id)
      );
      setReady(true);
    } catch {
      setError("Could not read design data. Please go back and try again.");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist on change ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const save: PresentationSave = { v: 2, wallSelections: wallSels, selectedWallIds };
    localStorage.setItem("closet-presentation", JSON.stringify(save));
  }, [ready, wallSels, selectedWallIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function patchWallSel(wallId: string, patch: Partial<WallSel>) {
    setWallSels(prev => ({
      ...prev,
      [wallId]: { ...(prev[wallId] ?? defaultSel()), ...patch },
    }));
  }

  function toggleWallSelected(wallId: string) {
    setSelectedWallIds(prev =>
      prev.includes(wallId) ? prev.filter(id => id !== wallId) : [...prev, wallId]
    );
  }

  // ── Early returns ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={S.page}>
        <div style={{ textAlign: "center", paddingTop: "80px" }}>
          <p style={{ color: "#b91c1c", fontSize: "15px", marginBottom: "24px" }}>{error}</p>
          <button onClick={() => router.push("/worksheet")} style={S.btnBack}>← Back to Worksheet</button>
        </div>
      </div>
    );
  }
  if (!ready || !layout) {
    return <div style={S.page}><p style={{ color: "#888", paddingTop: "80px", textAlign: "center" }}>Loading…</p></div>;
  }

  // ── Compute per-wall results (pure — runs on every render, no side-effects) ──
  const wallResults: Record<string, PresentationResult> = {};
  for (const wd of wallDataList) {
    const sel  = wallSels[wd.wall.id] ?? defaultSel();
    const secs = runToPricingSections(wd.run);
    const phts = runToPanelHeights(wd.run, layout.systemHeightIn);
    wallResults[wd.wall.id] = computePresentationPricing(
      secs,
      layout.closetDepthIn,
      wd.run.endIn - wd.run.startIn,
      layout.ceilingHeightIn,
      phts,
      sel.tier,
      sel.material,
      sel.backing,
      sel.deco,
      sel.accessoryQtys,
      sel.moldingSel,
    );
  }

  // ── Combined totals — sum of selected walls' already-discounted numbers ───────
  const selectedData = wallDataList.filter(wd => selectedWallIds.includes(wd.wall.id));
  const combined = selectedData.reduce(
    (acc, wd) => {
      const r = wallResults[wd.wall.id];
      if (!r) return acc;
      return {
        subtotalBefore: acc.subtotalBefore + r.subtotalBeforeDiscount,
        discount40:     acc.discount40     + r.discountAmount40,
        after40:        acc.after40        + r.subtotalAfter40,
        discount15:     acc.discount15     + r.discountAmount15,
        finalTotal:     acc.finalTotal     + r.finalTotal,
      };
    },
    { subtotalBefore: 0, discount40: 0, after40: 0, discount15: 0, finalTotal: 0 },
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      <div style={S.sheet}>

        {/* Nav */}
        <div style={S.nav}>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => router.push("/")} style={S.btnBack}>
              Dashboard
            </button>
            <button onClick={() => router.push("/worksheet")} style={S.btnBack}>
              ← Back to Worksheet
            </button>
            <button onClick={() => { saveCurrentProject(getActiveProjectId()); }}
              style={{ ...S.btnBack, backgroundColor: "#3a5a3a", color: "#fff", border: "none", fontWeight: "700" }}>
              Save
            </button>
          </div>
          <button onClick={() => window.print()} style={S.btnPrint}>
            Print / Save PDF
          </button>
        </div>

        {/* Header */}
        <h1 style={S.h1}>Custom Closet Price Presentation</h1>
        <p style={S.headerSub}>
          Prepared for {layout.clientName || "Client"} &nbsp;·&nbsp; {today()}
        </p>

        {/* Discount banner */}
        <div style={S.discountBanner}>
          <span style={{ fontWeight: "700" }}>Special Offer:</span>
          &nbsp; 40% off every item, plus an additional 15% off your total — configured independently per wall.
        </div>

        {/* Client info */}
        <div style={S.infoGrid}>
          <InfoCell label="Client Name"    value={layout.clientName   || "—"} />
          <InfoCell label="Client #"       value={layout.clientNum    || "—"} />
          <InfoCell label="Location"       value={layout.locationName || "—"} />
          <InfoCell label="Project Type"   value={layout.projectType  || "—"} />
          <InfoCell label="System Height"  value={`${layout.systemHeightIn}"`} />
          <InfoCell label="Overall Depth"  value={`${layout.closetDepthIn}"`} />
        </div>

        {/* Empty state */}
        {wallDataList.length === 0 && (
          <div style={{ padding: "48px 0", textAlign: "center", color: "#999" }}>
            <p style={{ fontSize: "15px", marginBottom: "8px" }}>No walls have been designed yet.</p>
            <p style={{ fontSize: "13px" }}>
              Add sections to walls in the Design editor, then come back.
            </p>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            PER-WALL CARDS
        ═══════════════════════════════════════════════════════════════════════ */}
        {wallDataList.map((wd, idx) => {
          const sel    = wallSels[wd.wall.id] ?? defaultSel();
          const result = wallResults[wd.wall.id];
          if (!result) return null;
          return (
            <div key={wd.wall.id}>
              {idx > 0 && (
                <div style={{ borderTop: "3px solid #e0dbd4", margin: "44px 0" }} />
              )}
              <WallCard
                label={wd.label}
                run={wd.run}
                layout={layout}
                sel={sel}
                result={result}
                onUpdate={patch => patchWallSel(wd.wall.id, patch)}
              />
            </div>
          );
        })}

        {/* ═══════════════════════════════════════════════════════════════════════
            COMBINED PRESENTATION
        ═══════════════════════════════════════════════════════════════════════ */}
        {wallDataList.length > 0 && (
          <>
            <div style={{ borderTop: "3px solid #1a1a1a", margin: "52px 0 32px" }} />

            <h2 style={{ fontSize: "20px", fontWeight: "800", color: "#1a1a1a", margin: "0 0 6px" }}>
              Combined Presentation
            </h2>
            <p style={{ fontSize: "13px", color: "#888", margin: "0 0 20px" }}>
              Choose which walls to include. The combined total is the sum of each wall&rsquo;s
              independently configured final price — no discounts are re-applied.
            </p>

            {/* Wall checkboxes */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "28px" }}>
              {wallDataList.map(wd => {
                const checked = selectedWallIds.includes(wd.wall.id);
                const r       = wallResults[wd.wall.id];
                return (
                  <label key={wd.wall.id} style={{
                    display:         "flex",
                    alignItems:      "center",
                    gap:             "8px",
                    padding:         "10px 18px",
                    borderRadius:    "8px",
                    border:          `1.5px solid ${checked ? "#1a1a1a" : "#ddd"}`,
                    backgroundColor: checked ? "#1a1a1a" : "#fff",
                    color:           checked ? "#fff" : "#333",
                    cursor:          "pointer",
                    userSelect:      "none",
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleWallSelected(wd.wall.id)}
                      style={{ accentColor: "#fff", width: "14px", height: "14px", flexShrink: 0 }}
                    />
                    <span style={{ fontSize: "13px", fontWeight: "700" }}>{wd.label}</span>
                    <span style={{ fontSize: "11px", opacity: 0.65 }}>
                      {wd.wall.widthIn}" · {r ? fmt0(r.finalTotal) : "—"}
                    </span>
                  </label>
                );
              })}
            </div>

            {selectedData.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#aaa", textAlign: "center", padding: "20px 0" }}>
                Select at least one wall above to see the combined total.
              </p>
            ) : (
              <div style={{ maxWidth: "520px", marginLeft: "auto" }}>

                {/* Per-selected-wall sub-lines */}
                <div style={{ marginBottom: "16px" }}>
                  <p style={{ fontSize: "10px", fontWeight: "700", color: "#999",
                    textTransform: "uppercase", letterSpacing: "0.6px", margin: "0 0 8px" }}>
                    Included Walls
                  </p>
                  {selectedData.map(wd => {
                    const r    = wallResults[wd.wall.id];
                    const sel  = wallSels[wd.wall.id] ?? defaultSel();
                    if (!r) return null;
                    return (
                      <div key={wd.wall.id} style={{
                        display:        "flex",
                        justifyContent: "space-between",
                        alignItems:     "center",
                        padding:        "8px 0",
                        borderBottom:   "1px solid #f0ece6",
                      }}>
                        <div>
                          <span style={{ fontSize: "13px", fontWeight: "600", color: "#1a1a1a" }}>
                            {wd.label}
                          </span>
                          <span style={{ fontSize: "11px", color: "#aaa", marginLeft: "8px" }}>
                            {wd.wall.widthIn}" · {MATERIAL_TIERS[sel.tier].label}
                            {sel.material !== "none" ? ` · ${MATERIAL_OPTIONS[sel.material].label}` : ""}
                            {sel.backing  !== "none" ? ` · ${BACKING_OPTIONS[sel.backing].label}`  : ""}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column",
                          alignItems: "flex-end", gap: "1px" }}>
                          <span style={{ fontSize: "11px", color: "#aaa",
                            textDecoration: "line-through" }}>
                            {fmt(r.subtotalBeforeDiscount)}
                          </span>
                          <span style={{ fontSize: "14px", fontWeight: "700", color: "#1a6e40" }}>
                            {fmt(r.finalTotal)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Combined discount breakdown */}
                <div style={{ backgroundColor: "#f9f7f4", border: "1px solid #e8e4de",
                  borderRadius: "10px", padding: "18px 20px",
                  display: "flex", flexDirection: "column", gap: "8px" }}>
                  <TotalRow
                    label="Combined Subtotal Before Discounts"
                    value={fmt(combined.subtotalBefore)}
                    strikethrough
                  />
                  <TotalRow
                    label="40% Line-Item Discount"
                    value={`−${fmt(combined.discount40)}`}
                    discountLine
                  />
                  <TotalRow
                    label="Subtotal After 40% Discount"
                    value={fmt(combined.after40)}
                    bold
                  />
                  <div style={{ borderTop: "1px solid #e0dbd4", margin: "2px 0" }} />
                  <TotalRow
                    label={`Additional ${Math.round(FINAL_DISCOUNT_RATE * 100)}% Discount`}
                    value={`−${fmt(combined.discount15)}`}
                    discountLine
                  />
                  <div style={{ borderTop: "2px solid #1a1a1a", margin: "4px 0" }} />
                  <TotalRow
                    label={
                      selectedData.length === 1
                        ? `${selectedData[0].label} Final Total`
                        : `${selectedData.length} Walls — Combined Final Total`
                    }
                    value={fmt(combined.finalTotal)}
                    finalTotal
                  />
                </div>

              </div>
            )}
          </>
        )}

        {/* Bottom nav */}
        <div style={{ marginTop: "52px", display: "flex", justifyContent: "space-between" }}>
          <button onClick={() => router.push("/worksheet")} style={S.btnBack}>
            ← Back to Worksheet
          </button>
          <button onClick={() => window.print()} style={S.btnPrint}>
            Print / Save PDF
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── WallCard ─────────────────────────────────────────────────────────────────
// Renders all upgrade selectors and the pricing summary for one wall.
// All state lives in the parent; this component is purely presentational + event-firing.

function WallCard({
  label, run, layout, sel, result, onUpdate,
}: {
  label:    string;
  run:      StoredRun;
  layout:   RoomLayout;
  sel:      WallSel;
  result:   PresentationResult;
  onUpdate: (patch: Partial<WallSel>) => void;
}) {
  const counts      = result.layoutCounts;
  const wallWidthIn = run.endIn - run.startIn;
  const wallLfAuto  = Math.round((wallWidthIn / 12) * 10) / 10;
  const wallLf      = sel.moldingSel.lfOverride ?? wallLfAuto;

  function setAccessoryQty(key: AccessoryKey, qty: number) {
    onUpdate({ accessoryQtys: { ...sel.accessoryQtys, [key]: Math.max(0, Math.round(qty)) } });
  }

  function patchMolding(patch: Partial<MoldingInput>) {
    onUpdate({ moldingSel: { ...sel.moldingSel, ...patch } });
  }

  return (
    <div style={S.wallCard}>

      {/* ── Wall header ───────────────────────────────────────────────────── */}
      <div style={S.wallHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "800", color: "#1a1a1a" }}>
            {label}
          </h2>
          <span style={S.wallWidthBadge}>{wallWidthIn}" wide</span>
          <span style={S.wallWidthBadge}>{MATERIAL_TIERS[sel.tier].label}</span>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "11px", color: "#aaa", textDecoration: "line-through", marginBottom: "1px" }}>
            {fmt0(result.subtotalBeforeDiscount)}
          </div>
          <div style={{ fontSize: "22px", fontWeight: "800", color: "#1a6e40", lineHeight: 1 }}>
            {fmt0(result.finalTotal)}
          </div>
          <div style={{ fontSize: "10px", color: "#aaa", marginTop: "3px" }}>
            40% + 15% applied
          </div>
        </div>
      </div>

      {/* Counts strip */}
      <div style={S.countsStrip}>
        <CountBadge label="Sections" value={counts.sectionCount} />
        <CountBadge label="Panels"   value={counts.panelCount} />
        <CountBadge label="Shelves"  value={counts.shelfCount} />
        <CountBadge label="Rods"     value={counts.rodCount} />
        <CountBadge label="Drawers"  value={counts.drawerCount} />
        <CountBadge label="Backing"  value={counts.backingSquareFeet} decimals={1} unit="sqft" />
      </div>

      {/* ── Step 1: Collection / Tier ─────────────────────────────────────── */}
      <WallSection step="1" title="Collection">
        <div style={S.tierGrid}>
          {TIER_ORDER.map(tier => {
            const def       = MATERIAL_TIERS[tier];
            const selected  = sel.tier === tier;
            const origPrice = Math.round(result.baseLayoutPrice * (1 + def.ratePercent / 100));
            const discPrice = off40(origPrice);
            return (
              <button key={tier} onClick={() => onUpdate({ tier })} style={{
                ...S.tierCard,
                borderColor:     selected ? "#1a1a1a" : "#ddd",
                backgroundColor: selected ? "#1a1a1a" : "#fff",
                color:           selected ? "#fff"    : "#1a1a1a",
                boxShadow:       selected ? "0 3px 10px rgba(0,0,0,0.20)" : "none",
              }}>
                <span style={{ fontSize: "14px", fontWeight: "800", display: "block", marginBottom: "4px" }}>
                  {def.label}
                </span>
                <span style={{ fontSize: "10px", opacity: 0.65, display: "block",
                  marginBottom: "10px", lineHeight: 1.4 }}>
                  {def.tagline}
                </span>
                {result.baseLayoutPrice > 0 && (
                  <>
                    <span style={{ fontSize: "10px", display: "block",
                      textDecoration: "line-through", opacity: 0.5 }}>
                      {fmt0(origPrice)}
                    </span>
                    <span style={{ fontSize: "13px", fontWeight: "800", display: "block",
                      marginTop: "2px", color: selected ? "#fff" : "#1a6e40" }}>
                      {fmt0(discPrice)}
                    </span>
                  </>
                )}
                {def.ratePercent > 0 && (
                  <span style={{ fontSize: "10px", display: "block",
                    marginTop: "3px", opacity: 0.55 }}>
                    +{def.ratePercent}% upgrade
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </WallSection>

      <WallDivider />

      {/* ── Step 2: Material / Finish ─────────────────────────────────────── */}
      <WallSection step="2" title="Material &amp; Finish">
        <div style={S.radioGroup}>
          {MATERIAL_OPTION_ORDER.map(opt => {
            const def        = MATERIAL_OPTIONS[opt];
            const selected   = sel.material === opt;
            // Material % previewed from Everyday/base price — same basis as the pricing engine.
            const origImpact = Math.round(result.baseLayoutPrice * def.ratePercent / 100);
            const discImpact = off40(origImpact);
            const colorList  = opt !== "none" ? FINISH_COLORS[opt as FinishMaterial] : null;
            return (
              <div key={opt}>
                <label style={{ ...S.radioRow,
                  borderColor: selected ? "#b8a88a" : "#eee",
                  backgroundColor: selected ? "#f9f7f4" : "#fff" }}>
                  <input
                    type="radio"
                    name={`material-${run.wallId}`}
                    checked={selected}
                    onChange={() => onUpdate({ material: opt, finishColor: "" })}
                    style={{ marginRight: "10px", accentColor: "#1a1a1a", flexShrink: 0 }}
                  />
                  <span style={{ flex: 1, fontSize: "13px",
                    fontWeight: selected ? "700" : "500", color: "#1a1a1a" }}>
                    {def.label}
                  </span>
                  {def.ratePercent > 0 ? (
                    <div style={S.priceStack}>
                      <span style={{ fontSize: "11px", color: "#999",
                        textDecoration: "line-through" }}>+{fmt0(origImpact)}</span>
                      <span style={{ fontSize: "13px", fontWeight: "700",
                        color: "#1a6e40" }}>+{fmt0(discImpact)}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: "12px", color: "#888" }}>Included</span>
                  )}
                </label>
                {selected && colorList && (
                  <div style={{ paddingLeft: "34px", paddingTop: "8px", paddingBottom: "4px" }}>
                    <select
                      value={sel.finishColor}
                      onChange={e => onUpdate({ finishColor: e.target.value })}
                      style={{ padding: "6px 10px", fontSize: "12px",
                        border: "1px solid #d0c8be", borderRadius: "6px",
                        backgroundColor: "#fff", color: "#1a1a1a",
                        minWidth: "220px" }}>
                      <option value="">— Select color —</option>
                      {colorList.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    {sel.finishColor && (
                      <span style={{ marginLeft: "10px", fontSize: "11px",
                        color: "#888", fontWeight: "600" }}>
                        {sel.finishColor}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </WallSection>

      <WallDivider />

      {/* ── Step 3: Backing ───────────────────────────────────────────────── */}
      <WallSection step="3" title="Backing">
        <p style={S.sectionNote}>
          Backing area for this wall:{" "}
          <strong>{counts.backingSquareFeet.toFixed(1)} sq ft</strong>
          &nbsp;({counts.wallWidthIn}" wide × {counts.systemHeightIn}" system height ÷ 144)
          {layout.ceilingHeightIn !== counts.systemHeightIn && (
            <span style={{ color: "#888" }}>
              &nbsp;— ceiling is {layout.ceilingHeightIn}",&nbsp;
              {layout.ceilingHeightIn - counts.systemHeightIn}" above system
            </span>
          )}
        </p>
        <div style={S.radioGroup}>
          {BACKING_OPTION_ORDER.map(opt => {
            const def      = BACKING_OPTIONS[opt];
            const selected = sel.backing === opt;
            const origPrice = Math.round(counts.backingSquareFeet * def.ratePerSqFt * 100) / 100;
            const discPrice = off40(origPrice);
            return (
              <label key={opt} style={{ ...S.radioRow,
                borderColor: selected ? "#b8a88a" : "#eee",
                backgroundColor: selected ? "#f9f7f4" : "#fff" }}>
                <input
                  type="radio"
                  name={`backing-${run.wallId}`}
                  checked={selected}
                  onChange={() => onUpdate({ backing: opt })}
                  style={{ marginRight: "10px", accentColor: "#1a1a1a", flexShrink: 0 }}
                />
                <span style={{ flex: 1, fontSize: "13px",
                  fontWeight: selected ? "700" : "500", color: "#1a1a1a" }}>
                  {def.label}
                  {def.spec && (
                    <span style={{ color: "#555", fontWeight: "400" }}> — {def.spec}</span>
                  )}
                </span>
                {def.ratePerSqFt > 0 ? (
                  <>
                    <span style={{ fontSize: "11px", color: "#aaa", marginRight: "10px" }}>
                      ${def.ratePerSqFt.toFixed(2)}/sqft
                    </span>
                    <div style={S.priceStack}>
                      <span style={{ fontSize: "11px", color: "#999",
                        textDecoration: "line-through" }}>{fmt0(origPrice)}</span>
                      <span style={{ fontSize: "13px", fontWeight: "700",
                        color: "#1a6e40" }}>{fmt0(discPrice)}</span>
                    </div>
                  </>
                ) : (
                  <span style={{ fontSize: "12px", color: "#aaa" }}>—</span>
                )}
              </label>
            );
          })}
        </div>
      </WallSection>

      <WallDivider />

      {/* ── Step 4: Deco Doors & Drawers ─────────────────────────────────── */}
      <WallSection step="4" title="Deco Doors &amp; Drawers">
        <p style={S.sectionNote}>
          Piece count for this wall:&nbsp;
          <strong>{counts.drawerCount + counts.doorCount}</strong>
          &nbsp;({counts.drawerCount} drawer{counts.drawerCount !== 1 ? "s" : ""}
          {counts.doorCount > 0
            ? ` + ${counts.doorCount} door${counts.doorCount !== 1 ? "s" : ""}`
            : ""}
          )
          {counts.drawerCount + counts.doorCount === 0 && (
            <span style={{ color: "#b91c1c" }}> — no pieces; deco price is $0</span>
          )}
        </p>
        <div style={S.radioGroup}>
          {DECO_OPTION_ORDER.map(opt => {
            const def        = DECO_OPTIONS[opt];
            const selected   = sel.deco === opt;
            const pieces     = counts.drawerCount + counts.doorCount;
            const origPrice  = pieces > 0 ? def.pricePerPiece * pieces : 0;
            const discPrice  = off40(origPrice);
            const seriesList = DECO_SERIES_FOR[opt] ?? null;
            return (
              <div key={opt}>
                <label style={{ ...S.radioRow,
                  borderColor: selected ? "#b8a88a" : "#eee",
                  backgroundColor: selected ? "#f9f7f4" : "#fff" }}>
                  <input
                    type="radio"
                    name={`deco-${run.wallId}`}
                    checked={selected}
                    onChange={() => onUpdate({ deco: opt, decoStyle: "" })}
                    style={{ marginRight: "10px", accentColor: "#1a1a1a", flexShrink: 0 }}
                  />
                  <span style={{ flex: 1, fontSize: "13px",
                    fontWeight: selected ? "700" : "500", color: "#1a1a1a" }}>
                    {def.label}
                    {def.spec && (
                      <span style={{ color: "#555", fontWeight: "400" }}> — {def.spec}</span>
                    )}
                  </span>
                  {def.pricePerPiece > 0 ? (
                    pieces > 0 ? (
                      <>
                        <span style={{ fontSize: "11px", color: "#aaa", marginRight: "10px" }}>
                          {fmt0(def.pricePerPiece)}/piece
                        </span>
                        <div style={S.priceStack}>
                          <span style={{ fontSize: "11px", color: "#999",
                            textDecoration: "line-through" }}>{fmt0(origPrice)}</span>
                          <span style={{ fontSize: "13px", fontWeight: "700",
                            color: "#1a6e40" }}>{fmt0(discPrice)}</span>
                        </div>
                      </>
                    ) : (
                      <span style={{ fontSize: "11px", color: "#bbb" }}>no pieces in layout</span>
                    )
                  ) : (
                    <span style={{ fontSize: "12px", color: "#aaa" }}>—</span>
                  )}
                </label>
                {selected && seriesList && (
                  <div style={{ paddingLeft: "34px", paddingTop: "8px", paddingBottom: "4px" }}>
                    <select
                      value={sel.decoStyle}
                      onChange={e => onUpdate({ decoStyle: e.target.value })}
                      style={{ padding: "6px 10px", fontSize: "12px",
                        border: "1px solid #d0c8be", borderRadius: "6px",
                        backgroundColor: "#fff", color: "#1a1a1a",
                        minWidth: "160px" }}>
                      <option value="">— Select series —</option>
                      {seriesList.map(s => (
                        <option key={s} value={s}>Series {s}</option>
                      ))}
                    </select>
                    {sel.decoStyle && (
                      <span style={{ marginLeft: "10px", fontSize: "11px",
                        color: "#888", fontWeight: "600" }}>
                        Series {sel.decoStyle} selected
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </WallSection>

      <WallDivider />

      {/* ── Step 5: Molding ───────────────────────────────────────────────── */}
      <WallSection step="5" title="Molding">
        <p style={S.sectionNote}>
          Choose a package percentage, individual linear-foot items, or both.
          Package pricing applies to the base layout price. Linear-foot items are priced per foot of wall run.
          All Deco &amp; Brio finish rates apply where noted.
        </p>

        {/* ── Molding Package ── */}
        <div style={{ marginBottom: "18px" }}>
          <p style={S.subSectionLabel}>Molding Package (% of base layout price)</p>
          <div style={S.radioGroup}>
            {MOLDING_PACKAGE_ORDER.map(pkg => {
              const def      = MOLDING_PACKAGES[pkg];
              const selected = sel.moldingSel.package === pkg;
              const origAmt  = def.ratePercent > 0
                ? Math.round(result.baseLayoutPrice * def.ratePercent / 100) : 0;
              const discAmt  = off40(origAmt);
              return (
                <label key={pkg} style={{ ...S.radioRow,
                  borderColor:     selected ? "#b8a88a" : "#eee",
                  backgroundColor: selected ? "#f9f7f4" : "#fff",
                  alignItems:      "flex-start" }}>
                  <input
                    type="radio"
                    name={`mld-pkg-${run.wallId}`}
                    checked={selected}
                    onChange={() => patchMolding({ package: pkg as MoldingPackage })}
                    style={{ marginRight: "10px", accentColor: "#1a1a1a",
                      flexShrink: 0, marginTop: "2px" }}
                  />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: "13px",
                      fontWeight: selected ? "700" : "500", color: "#1a1a1a" }}>
                      {def.label}
                    </span>
                    {def.note && (
                      <span style={{ fontSize: "11px", color: "#888", display: "block",
                        marginTop: "1px" }}>
                        {def.note}
                      </span>
                    )}
                  </div>
                  {def.ratePercent > 0 ? (
                    <div style={{ textAlign: "right", minWidth: "110px" }}>
                      <span style={{ fontSize: "10px", color: "#aaa",
                        display: "block" }}>+{def.ratePercent}%</span>
                      <span style={{ fontSize: "11px", color: "#aaa",
                        textDecoration: "line-through" }}>+{fmt0(origAmt)}</span>
                      <span style={{ fontSize: "13px", fontWeight: "700",
                        color: "#1a6e40", marginLeft: "4px" }}>→ {fmt0(discAmt)}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: "12px", color: "#aaa", minWidth: "60px",
                      textAlign: "right" }}>—</span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* ── Linear Footage Control ── */}
        <div style={{ marginBottom: "16px", padding: "10px 14px",
          backgroundColor: "#f5f2ee", borderRadius: "7px",
          border: "1px solid #e0dbd4" }}>
          <p style={{ ...S.subSectionLabel, margin: "0 0 6px" }}>
            Linear Footage for LF-Priced Items
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", color: "#555" }}>
              Auto: <strong>{wallLfAuto.toFixed(1)} lf</strong>
              &nbsp;({wallWidthIn}" ÷ 12)
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "#555" }}>Override:</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={sel.moldingSel.lfOverride !== undefined ? sel.moldingSel.lfOverride : ""}
                placeholder={wallLfAuto.toFixed(1)}
                onChange={e => {
                  const raw = e.target.value;
                  patchMolding({ lfOverride: raw === "" ? undefined : Number(raw) });
                }}
                style={{ width: "72px", padding: "5px 8px", fontSize: "12px",
                  border: "1px solid #ccc", borderRadius: "5px",
                  backgroundColor: sel.moldingSel.lfOverride !== undefined ? "#fffbf0" : "#fff" }}
              />
              <span style={{ fontSize: "12px", color: "#555" }}>lf</span>
            </label>
            {sel.moldingSel.lfOverride !== undefined && (
              <button
                onClick={() => patchMolding({ lfOverride: undefined })}
                style={{ fontSize: "11px", color: "#b91c1c", background: "none",
                  border: "none", cursor: "pointer", padding: "0" }}>
                Reset to auto
              </button>
            )}
          </div>
        </div>

        {/* ── Base Molding ── */}
        <MoldingSubSection
          title="Base Molding"
          note="Attached to front of unit — runs from bottom of locked shelf to floor."
          groupName={`mld-base-${run.wallId}`}
          options={BASE_MOLDING_ORDER.map(k => ({ key: k, ...BASE_MOLDING[k] }))}
          selected={sel.moldingSel.baseMolding}
          wallLf={wallLf}
          onChange={k => patchMolding({ baseMolding: k as BaseMoldingKey | "none" })}
        />

        {/* ── Top Molding ── */}
        <MoldingSubSection
          title="Top Molding"
          note={'Install "below ceiling" requires minimum 10\u2033 clearance. "To ceiling" includes top fascia.'}
          groupName={`mld-top-${run.wallId}`}
          options={TOP_MOLDING_ORDER.map(k => ({ key: k, ...TOP_MOLDING[k] }))}
          selected={sel.moldingSel.topMolding}
          wallLf={wallLf}
          onChange={k => patchMolding({ topMolding: k as TopMoldingKey | "none" })}
        />

        {/* ── Valance ── */}
        <MoldingSubSection
          title="Valance"
          groupName={`mld-val-${run.wallId}`}
          options={VALANCE_ORDER.map(k => ({ key: k, ...VALANCE[k] }))}
          selected={sel.moldingSel.valance}
          wallLf={wallLf}
          onChange={k => patchMolding({ valance: k as ValanceKey | "none" })}
        />

        {/* ── Shoe / Scribe ── */}
        <MoldingSubSection
          title="Shoe &amp; Scribe Molding"
          note="Scribe covers gaps against wall. Shoe required for wood, tile, or hard surface floors."
          groupName={`mld-scribe-${run.wallId}`}
          options={SCRIBE_SHOE_ORDER.map(k => ({ key: k, ...SCRIBE_SHOE[k] }))}
          selected={sel.moldingSel.scribeShoe}
          wallLf={wallLf}
          sectionCount={counts.sectionCount}
          onChange={k => patchMolding({ scribeShoe: k as ScribeShoeKey | "none" })}
        />

        {/* ── Molding cost summary (inside the section) ── */}
        {result.moldingPricedItems.length > 0 && (
          <div style={{ marginTop: "14px", padding: "12px 16px",
            backgroundColor: "#f0faf4", border: "1px solid #a7d9b8",
            borderRadius: "8px" }}>
            <p style={{ fontSize: "10px", fontWeight: "700", color: "#1a5c36",
              textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 8px" }}>
              Molding Subtotal for {label}
            </p>
            {result.moldingPricedItems.map((item, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", padding: "3px 0",
                borderBottom: i < result.moldingPricedItems.length - 1
                  ? "1px solid #d4f0e0" : "none" }}>
                <span style={{ fontSize: "12px", color: "#1a4a30", flex: 1,
                  paddingRight: "12px" }}>
                  {item.label}
                </span>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: "11px", color: "#5a9970",
                    textDecoration: "line-through", marginRight: "6px" }}>
                    {fmt(item.originalPrice)}
                  </span>
                  <span style={{ fontSize: "13px", fontWeight: "700", color: "#1a6e40" }}>
                    {fmt(item.discountedPrice)}
                  </span>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", marginTop: "6px",
              paddingTop: "6px", borderTop: "1.5px solid #86c9a0" }}>
              <span style={{ fontSize: "11px", fontWeight: "700", color: "#1a5c36" }}>
                Molding total (after 40% discount)
              </span>
              <span style={{ fontSize: "14px", fontWeight: "800", color: "#1a6e40" }}>
                {fmt(result.moldingPricedItems.reduce((s, i) => s + i.discountedPrice, 0))}
              </span>
            </div>
          </div>
        )}
      </WallSection>

      <WallDivider />

      {/* ── Step 6: Add-ons ───────────────────────────────────────────────── */}
      <WallSection step="6" title="Add-ons">
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {(
            [
              { key: "softClose",   label: "Soft Close Slides" },
              { key: "accentShelf", label: "Accent Top Shelf" },
            ] as {
              key: "softClose" | "accentShelf";
              label: string;
            }[]
          ).map(({ key, label: addonLabel }) => {
            const checked = sel[key];
            return (
              <label key={key} style={{ ...S.radioRow,
                borderColor: checked ? "#b8a88a" : "#eee",
                backgroundColor: checked ? "#f9f7f4" : "#fff",
                cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onUpdate({ [key]: !checked })}
                  style={{ marginRight: "10px", accentColor: "#1a1a1a",
                    width: "15px", height: "15px", flexShrink: 0 }}
                />
                <span style={{ flex: 1, fontSize: "13px",
                  fontWeight: checked ? "700" : "500", color: "#1a1a1a" }}>
                  {addonLabel}
                </span>
                <span style={{ fontSize: "11px", color: "#aaa", fontStyle: "italic" }}>
                  pricing TBD
                </span>
              </label>
            );
          })}
        </div>
      </WallSection>

      <WallDivider />

      {/* ── Step 7: Accessories ───────────────────────────────────────────── */}
      <WallSection step="7" title="Accessories">
        <table style={S.table}>
          <thead>
            <tr style={S.tableHeadRow}>
              <th style={{ ...S.th, textAlign: "left" }}>Item</th>
              <th style={{ ...S.th, textAlign: "center", width: "70px" }}>Qty</th>
              <th style={{ ...S.th, textAlign: "right", width: "130px" }}>Unit Price</th>
              <th style={{ ...S.th, textAlign: "right", width: "130px" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {ACCESSORY_ORDER.map((key, i) => {
              const acc      = ACCESSORIES[key];
              const qty      = sel.accessoryQtys[key] ?? 0;
              const origUnit = acc.unitPrice;
              const discUnit = off40(origUnit);
              const origTot  = origUnit * qty;
              const discTot  = off40(origTot);
              return (
                <tr key={key} style={i % 2 === 0 ? S.rowEven : S.rowOdd}>
                  <td style={S.td}>{acc.label}</td>
                  <td style={{ ...S.td, textAlign: "center" }}>
                    <input
                      type="number"
                      min={0}
                      value={qty === 0 ? "" : qty}
                      placeholder="0"
                      onChange={e => setAccessoryQty(key, Number(e.target.value) || 0)}
                      style={S.qtyInput}
                    />
                  </td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <div style={{ display: "flex", flexDirection: "column",
                      alignItems: "flex-end", gap: "1px" }}>
                      <span style={{ fontSize: "11px", color: "#aaa",
                        textDecoration: "line-through" }}>{fmt0(origUnit)}</span>
                      <span style={{ fontSize: "13px", fontWeight: "600",
                        color: "#1a6e40" }}>{fmt0(discUnit)}</span>
                    </div>
                  </td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    {qty > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column",
                        alignItems: "flex-end", gap: "1px" }}>
                        <span style={{ fontSize: "11px", color: "#aaa",
                          textDecoration: "line-through" }}>{fmt0(origTot)}</span>
                        <span style={{ fontSize: "13px", fontWeight: "700",
                          color: "#1a1a1a" }}>{fmt0(discTot)}</span>
                      </div>
                    ) : (
                      <span style={{ color: "#ccc" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </WallSection>

      <WallDivider />

      {/* ── Step 8: Notes ─────────────────────────────────────────────────── */}
      <WallSection step="8" title="Notes">
        <textarea
          value={sel.notes}
          onChange={e => onUpdate({ notes: e.target.value })}
          placeholder={`Designer notes for ${label}…`}
          rows={3}
          style={S.notesArea}
        />
      </WallSection>

      <WallDivider />

      {/* ── Pricing summary ───────────────────────────────────────────────── */}
      <div>
        <p style={{ fontSize: "10px", fontWeight: "700", color: "#999",
          textTransform: "uppercase", letterSpacing: "0.6px", margin: "0 0 12px" }}>
          {label} Pricing Summary
        </p>

        <div style={{ maxWidth: "480px", marginLeft: "auto" }}>

          {/* Line items */}
          <div style={{ marginBottom: "14px" }}>
            <p style={{ fontSize: "10px", fontWeight: "700", color: "#aaa",
              textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 6px" }}>
              Line Items —{" "}
              <span style={{ fontWeight: "400" }}>
                {Math.round(LINE_DISCOUNT_RATE * 100)}% off each item
              </span>
            </p>
            {result.pricedItems.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#999", margin: "8px 0" }}>
                No items — complete your design to see pricing.
              </p>
            ) : (
              result.pricedItems.map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start",
                  justifyContent: "space-between", padding: "5px 0",
                  borderBottom: "1px solid #f5f2ee" }}>
                  <span style={{ flex: 1, fontSize: "13px", color: "#444",
                    paddingRight: "12px" }}>
                    {item.label}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column",
                    alignItems: "flex-end", gap: "1px", minWidth: "120px" }}>
                    <span style={{ fontSize: "11px", color: "#aaa",
                      textDecoration: "line-through" }}>
                      {fmt(item.originalPrice)}
                    </span>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#1a6e40" }}>
                      {fmt(item.discountedPrice)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Totals */}
          <div style={{ backgroundColor: "#f9f7f4", border: "1px solid #e8e4de",
            borderRadius: "8px", padding: "14px 16px",
            display: "flex", flexDirection: "column", gap: "7px" }}>
            <TotalRow
              label="Subtotal Before Discounts"
              value={fmt(result.subtotalBeforeDiscount)}
              strikethrough
            />
            <TotalRow
              label="40% Line-Item Discount"
              value={`−${fmt(result.discountAmount40)}`}
              discountLine
            />
            <TotalRow
              label="Subtotal After 40% Discount"
              value={fmt(result.subtotalAfter40)}
              bold
            />
            <div style={{ borderTop: "1px solid #e0dbd4", margin: "2px 0" }} />
            <TotalRow
              label={`Additional ${Math.round(FINAL_DISCOUNT_RATE * 100)}% Discount`}
              value={`−${fmt(result.discountAmount15)}`}
              discountLine
            />
            <div style={{ borderTop: "2px solid #1a1a1a", margin: "2px 0" }} />
            <TotalRow
              label={`${label} Final Total`}
              value={fmt(result.finalTotal)}
              finalTotal
            />
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div style={{ marginTop: "12px", display: "flex",
              flexDirection: "column", gap: "5px" }}>
              {result.warnings.map((w, i) => (
                <div key={i} style={S.warning}>⚠ {w}</div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

// ─── MoldingSubSection ────────────────────────────────────────────────────────
// Renders one category of individual molding items (base, top, valance, scribe/shoe)
// as a radio group with None + specific items, showing per-item pricing previews.

function MoldingSubSection({
  title, note, groupName, options, selected, wallLf, sectionCount, onChange,
}: {
  title:        string;
  note?:        string;
  groupName:    string;
  options:      (import("@/src/lib/presentation-pricing").MoldingLinItemDef & { key: string })[];
  selected:     string;
  wallLf:       number;
  sectionCount?: number;
  onChange:     (key: string) => void;
}) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <p style={S.subSectionLabel} dangerouslySetInnerHTML={{ __html: title }} />
      {note && (
        <p style={{ fontSize: "11px", color: "#888", margin: "-2px 0 6px" }}>{note}</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>

        {/* None option */}
        <label style={{ ...S.radioRowSm,
          borderColor:     selected === "none" ? "#b8a88a" : "#eee",
          backgroundColor: selected === "none" ? "#f9f7f4" : "#fff" }}>
          <input
            type="radio"
            name={groupName}
            checked={selected === "none"}
            onChange={() => onChange("none")}
            style={{ marginRight: "8px", accentColor: "#1a1a1a", flexShrink: 0 }}
          />
          <span style={{ fontSize: "12px", color: "#888" }}>None</span>
        </label>

        {/* Each item option */}
        {options.map(opt => {
          const isSel   = selected === opt.key;
          const isLf    = opt.pricePerLf      !== undefined;
          const isPerSec = opt.pricePerSection !== undefined;
          const sc      = sectionCount ?? 1;
          const origAmt = isLf
            ? Math.round((opt.pricePerLf ?? 0) * wallLf)
            : isPerSec
            ? Math.round((opt.pricePerSection ?? 0) * sc)
            : 0;
          const discAmt = off40(origAmt);
          const rateStr = isLf
            ? `$${opt.pricePerLf}/lf × ${wallLf.toFixed(1)} lf`
            : `$${opt.pricePerSection}/section × ${sc} section${sc !== 1 ? "s" : ""}`;

          return (
            <label key={opt.key} style={{ ...S.radioRowSm,
              borderColor:     isSel ? "#b8a88a" : "#eee",
              backgroundColor: isSel ? "#f9f7f4" : "#fff",
              alignItems:      "flex-start" }}>
              <input
                type="radio"
                name={groupName}
                checked={isSel}
                onChange={() => onChange(opt.key)}
                style={{ marginRight: "8px", accentColor: "#1a1a1a",
                  flexShrink: 0, marginTop: "2px" }}
              />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: "12px",
                  fontWeight: isSel ? "700" : "500", color: "#1a1a1a" }}>
                  {opt.label}
                </span>
                {opt.spec && (
                  <span style={{ fontSize: "11px", color: "#666",
                    marginLeft: "6px" }}>
                    {opt.spec}
                  </span>
                )}
                {opt.note && (
                  <span style={{ fontSize: "10px", color: "#999",
                    display: "block", marginTop: "1px" }}>
                    {opt.note}
                  </span>
                )}
                <span style={{ fontSize: "10px", color: "#aaa",
                  display: "block", marginTop: "1px" }}>
                  {rateStr}
                </span>
              </div>
              <div style={{ textAlign: "right", minWidth: "100px", flexShrink: 0 }}>
                <span style={{ fontSize: "11px", color: "#aaa",
                  textDecoration: "line-through", display: "block" }}>
                  {fmt0(origAmt)}
                </span>
                <span style={{ fontSize: "13px", fontWeight: "700",
                  color: "#1a6e40" }}>
                  {fmt0(discAmt)}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function WallSection({
  step, title, children,
}: {
  step: string; title: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "4px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "12px" }}>
        <span style={{ fontSize: "10px", fontWeight: "700", color: "#fff",
          backgroundColor: "#888", borderRadius: "3px", padding: "2px 7px",
          flexShrink: 0 }}>
          {step}
        </span>
        <h3
          style={{ margin: 0, fontSize: "14px", fontWeight: "700", color: "#1a1a1a" }}
          dangerouslySetInnerHTML={{ __html: title }}
        />
      </div>
      {children}
    </div>
  );
}

function WallDivider() {
  return <div style={{ borderTop: "1px solid #ede9e3", margin: "20px 0" }} />;
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={{ fontSize: "10px", fontWeight: "700", color: "#999",
        textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {label}
      </span>
      <span style={{ fontSize: "14px", color: "#111", fontWeight: "500" }}>{value}</span>
    </div>
  );
}

function CountBadge({
  label, value, unit, decimals,
}: {
  label: string; value: number; unit?: string; decimals?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
      <span style={{ fontSize: "16px", fontWeight: "800", color: "#1a1a1a" }}>
        {decimals != null ? value.toFixed(decimals) : value}
        {unit && (
          <span style={{ fontSize: "10px", fontWeight: "500", marginLeft: "2px" }}>{unit}</span>
        )}
      </span>
      <span style={{ fontSize: "10px", color: "#888",
        textTransform: "uppercase", letterSpacing: "0.4px" }}>
        {label}
      </span>
    </div>
  );
}

function TotalRow({
  label, value, bold, strikethrough, discountLine, finalTotal,
}: {
  label: string; value: string;
  bold?: boolean; strikethrough?: boolean; discountLine?: boolean; finalTotal?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between",
      alignItems: "center", padding: `${finalTotal ? 5 : 3}px 0` }}>
      <span style={{
        fontSize:       finalTotal ? "15px" : "13px",
        fontWeight:     (bold || finalTotal) ? "700" : "400",
        color:          discountLine ? "#b91c1c" : finalTotal ? "#1a1a1a" : "#555",
        textDecoration: strikethrough ? "line-through" : "none",
      }}>
        {label}
      </span>
      <span style={{
        fontSize:       finalTotal ? "20px" : "13px",
        fontWeight:     (bold || finalTotal) ? "800" : "500",
        color:          discountLine ? "#b91c1c" : finalTotal ? "#1a1a1a" : "#333",
        textDecoration: strikethrough ? "line-through" : "none",
        minWidth:       "130px",
        textAlign:      "right",
      }}>
        {value}
      </span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page:            { fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee", padding: "40px 24px" },
  sheet:           { maxWidth: "880px", margin: "0 auto", backgroundColor: "#fff", border: "1px solid #e0dbd4", borderRadius: "12px", padding: "40px 52px" },
  nav:             { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" },
  h1:              { fontSize: "26px", fontWeight: "800", color: "#1a1a1a", margin: 0, marginBottom: "6px" },
  headerSub:       { fontSize: "13px", color: "#888", margin: 0, marginBottom: "16px" },
  discountBanner:  { backgroundColor: "#f0faf4", border: "1px solid #a7d9b8", borderRadius: "8px", padding: "10px 16px", fontSize: "13px", color: "#1a5c36", marginBottom: "20px" },
  infoGrid:        { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px 28px", padding: "18px 22px", backgroundColor: "#f9f7f4", border: "1px solid #e8e4de", borderRadius: "8px", marginBottom: "20px" },
  wallCard:        { padding: "28px 32px", border: "1px solid #e0dbd4", borderRadius: "10px", backgroundColor: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" },
  wallHeader:      { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px", paddingBottom: "14px", borderBottom: "2px solid #1a1a1a" },
  wallWidthBadge:  { fontSize: "11px", color: "#888", backgroundColor: "#f0ece6", borderRadius: "12px", padding: "3px 10px", fontWeight: "600" },
  countsStrip:     { display: "flex", justifyContent: "space-around", padding: "12px 0", backgroundColor: "#f9f7f4", border: "1px solid #e8e4de", borderRadius: "8px", marginBottom: "24px" },
  tierGrid:        { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" },
  tierCard:        { padding: "14px 12px", borderRadius: "8px", border: "2px solid #ddd", cursor: "pointer", textAlign: "left", lineHeight: 1 },
  radioGroup:      { display: "flex", flexDirection: "column", gap: "6px" },
  radioRow:        { display: "flex", alignItems: "center", padding: "9px 13px", borderRadius: "7px", border: "1px solid #eee", cursor: "pointer" },
  radioRowSm:      { display: "flex", alignItems: "center", padding: "7px 11px", borderRadius: "6px", border: "1px solid #eee", cursor: "pointer" },
  priceStack:      { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "1px", minWidth: "80px" },
  sectionNote:     { fontSize: "12px", color: "#666", margin: "0 0 12px", lineHeight: 1.5 },
  subSectionLabel: { fontSize: "11px", fontWeight: "700", color: "#555", textTransform: "uppercase" as const, letterSpacing: "0.5px", margin: "0 0 6px" },
  table:           { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  tableHeadRow:    { borderBottom: "2px solid #1a1a1a" },
  th:              { padding: "8px 10px", fontSize: "11px", fontWeight: "700", color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" },
  td:              { padding: "9px 10px", color: "#222", verticalAlign: "middle" },
  rowEven:         { backgroundColor: "#fff",    borderBottom: "1px solid #f0ece6" },
  rowOdd:          { backgroundColor: "#faf8f5", borderBottom: "1px solid #f0ece6" },
  qtyInput:        { width: "52px", padding: "5px 6px", fontSize: "13px", border: "1px solid #ccc", borderRadius: "5px", textAlign: "center", color: "#111" },
  notesArea:       { width: "100%", padding: "10px 13px", fontSize: "13px", border: "1px solid #ddd", borderRadius: "7px", resize: "vertical", color: "#111", fontFamily: "sans-serif", boxSizing: "border-box" },
  btnBack:         { padding: "9px 18px", fontSize: "13px", fontWeight: "600", backgroundColor: "#fff", color: "#444", border: "1px solid #ccc", borderRadius: "7px", cursor: "pointer" },
  btnPrint:        { padding: "9px 18px", fontSize: "13px", fontWeight: "700", backgroundColor: "#1a1a1a", color: "#fff", border: "none", borderRadius: "7px", cursor: "pointer" },
  warning:         { fontSize: "12px", color: "#92400e", backgroundColor: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "5px", padding: "8px 12px" },
};
