"use client";
// app/presentation/page.tsx
//
// Client-facing price presentation sheet.
// Loads design from localStorage["closet-design"],
// lets the designer select material tier + options + accessories,
// shows a live-updating pricing summary.
// Persists selections to localStorage["closet-presentation"].

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  computePresentationPricing,
  computeLayoutCounts,
  MATERIAL_TIERS,
  TIER_ORDER,
  OPTIONS,
  OPTION_ORDER,
  ACCESSORIES,
  ACCESSORY_ORDER,
  type MaterialTier,
  type OptionKey,
  type AccessoryKey,
  type PresentationResult,
} from "@/src/lib/presentation-pricing";
import type { PricingSection } from "@/src/lib/pricing";
import type { Config, Section } from "@/app/elevation/_lib/types";

// ─── Saved shape ──────────────────────────────────────────────────────────────

interface PresentationSave {
  materialTier:    MaterialTier;
  selectedOptions: OptionKey[];
  accessoryQtys:   Partial<Record<AccessoryKey, number>>;
  promoDiscount:   number;
  designerNotes:   string;
}

interface DesignData {
  config:      Config;
  sections:    Section[];
  panelHeights: number[];
  ceilingH:    number;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}
function fmtDec(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
function today(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PresentationPage() {
  const router = useRouter();

  // ── All hooks first, unconditionally ─────────────────────────────────────────
  const [data,            setData]            = useState<DesignData | null>(null);
  const [error,           setError]           = useState<string | null>(null);
  const [ready,           setReady]           = useState(false);
  const [materialTier,    setMaterialTier]    = useState<MaterialTier>("Classic");
  const [selectedOptions, setSelectedOptions] = useState<Set<OptionKey>>(new Set());
  const [accessoryQtys,   setAccessoryQtys]   = useState<Partial<Record<AccessoryKey, number>>>({});
  const [promoDiscount,   setPromoDiscount]   = useState(0);
  const [designerNotes,   setDesignerNotes]   = useState("");

  // Load design + saved presentation state
  useEffect(() => {
    const rawDesign = localStorage.getItem("closet-design");
    if (!rawDesign) {
      setError("No design found. Please complete the design first.");
      return;
    }
    try {
      const design = JSON.parse(rawDesign) as DesignData;
      setData(design);

      const rawPres = localStorage.getItem("closet-presentation");
      if (rawPres) {
        const saved = JSON.parse(rawPres) as Partial<PresentationSave>;
        if (saved.materialTier)    setMaterialTier(saved.materialTier);
        if (saved.selectedOptions) setSelectedOptions(new Set(saved.selectedOptions));
        if (saved.accessoryQtys)   setAccessoryQtys(saved.accessoryQtys);
        if (typeof saved.promoDiscount === "number") setPromoDiscount(saved.promoDiscount);
        if (saved.designerNotes)   setDesignerNotes(saved.designerNotes);
      }
      setReady(true);
    } catch {
      setError("Design data could not be read. Please go back and try again.");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save presentation state whenever anything changes
  useEffect(() => {
    if (!ready) return;
    const save: PresentationSave = {
      materialTier,
      selectedOptions: [...selectedOptions],
      accessoryQtys,
      promoDiscount,
      designerNotes,
    };
    localStorage.setItem("closet-presentation", JSON.stringify(save));
  }, [ready, materialTier, selectedOptions, accessoryQtys, promoDiscount, designerNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Early returns (after all hooks) ──────────────────────────────────────────
  if (error) {
    return (
      <div style={S.page}>
        <div style={{ textAlign: "center", paddingTop: "80px" }}>
          <p style={{ color: "#b91c1c", fontSize: "15px", marginBottom: "24px" }}>{error}</p>
          <button onClick={() => router.push("/worksheet")} style={S.btnBack}>
            ← Back to Worksheet
          </button>
        </div>
      </div>
    );
  }

  if (!ready || !data) {
    return (
      <div style={S.page}>
        <p style={{ color: "#888", paddingTop: "80px", textAlign: "center" }}>Loading…</p>
      </div>
    );
  }

  // ── Derive pricing sections from design ───────────────────────────────────────
  const pricingSections: PricingSection[] = data.sections.map(s => ({
    widthIn:    s.widthIn,
    depthIn:    s.depthIn,
    components: s.components.map(c => ({ type: c.type, drawerHeights: c.drawerHeights })),
  }));

  const result: PresentationResult = computePresentationPricing(
    pricingSections,
    data.config.closetDepthIn,
    data.config.wallWidthIn,
    materialTier,
    selectedOptions,
    accessoryQtys,
    promoDiscount,
  );

  const counts  = result.layoutCounts;
  const { config } = data;

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function toggleOption(key: OptionKey) {
    setSelectedOptions(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function setAccessoryQty(key: AccessoryKey, qty: number) {
    setAccessoryQtys(prev => ({ ...prev, [key]: Math.max(0, Math.round(qty)) }));
  }

  // Projected base price for a given tier (for display in tier cards)
  function projectedBase(tier: MaterialTier): number {
    return Math.round(result.baseTotal * MATERIAL_TIERS[tier].multiplier);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      <div style={S.sheet}>

        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <div style={S.nav}>
          <button onClick={() => router.push("/worksheet")} style={S.btnBack}>
            ← Back to Worksheet
          </button>
          <button onClick={() => window.print()} style={S.btnPrint}>
            Print / Save PDF
          </button>
        </div>

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div style={S.headerBlock}>
          <div>
            <h1 style={S.h1}>Custom Closet Price Presentation</h1>
            <p style={S.headerSub}>Prepared for {config.clientName || "Client"} &nbsp;·&nbsp; {today()}</p>
          </div>
        </div>

        {/* ── Client info strip ────────────────────────────────────────────── */}
        <div style={S.infoGrid}>
          <InfoCell label="Client Name"    value={config.clientName  || "—"} />
          <InfoCell label="Client #"       value={config.clientNum   || "—"} />
          <InfoCell label="Location"       value={config.locationName || "—"} />
          <InfoCell label="Wall Width"     value={`${config.wallWidthIn}"`} />
          <InfoCell label="Ceiling Height" value={`${config.ceilingHeightIn}"`} />
          <InfoCell label="Closet Depth"   value={`${config.closetDepthIn}"`} />
        </div>

        {/* ── Layout counts strip ──────────────────────────────────────────── */}
        <div style={S.countsStrip}>
          <CountBadge label="Sections" value={counts.sectionCount} />
          <CountBadge label="Panels"   value={counts.panelCount} />
          <CountBadge label="Shelves"  value={counts.shelfCount} />
          <CountBadge label="Rods"     value={counts.rodCount} />
          <CountBadge label="Drawers"  value={counts.drawerCount} />
        </div>

        <Divider />

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SECTION 1 — Material Tier                                         */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <SectionHeading step="1" title="Choose Your Custom Closet" />

        <div style={S.tierGrid}>
          {TIER_ORDER.map(tier => {
            const def      = MATERIAL_TIERS[tier];
            const selected = materialTier === tier;
            const price    = projectedBase(tier);
            return (
              <button
                key={tier}
                onClick={() => setMaterialTier(tier)}
                style={{
                  ...S.tierCard,
                  borderColor:       selected ? "#1a1a1a" : "#ddd",
                  backgroundColor:   selected ? "#1a1a1a" : "#fff",
                  color:             selected ? "#fff"    : "#1a1a1a",
                  boxShadow:         selected ? "0 2px 8px rgba(0,0,0,0.18)" : "none",
                }}
              >
                <span style={{ fontSize: "16px", fontWeight: "800", display: "block", marginBottom: "6px" }}>
                  {def.label}
                </span>
                <span style={{ fontSize: "11px", opacity: 0.7, display: "block", marginBottom: "10px", lineHeight: 1.4 }}>
                  {def.tagline}
                </span>
                {result.baseTotal > 0 && (
                  <span style={{
                    fontSize: "13px", fontWeight: "700", display: "block",
                    color: selected ? "#fff" : "#1a7a4a",
                  }}>
                    from {fmt(price)}
                  </span>
                )}
                {def.multiplier > 1 && (
                  <span style={{
                    fontSize: "10px", display: "block", marginTop: "3px", opacity: 0.65,
                  }}>
                    +{Math.round((def.multiplier - 1) * 100)}% upgrade
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <Divider />

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SECTION 2 — Custom Options                                        */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <SectionHeading step="2" title="Choose Your Custom Options" />

        <div style={S.optionsGrid}>
          {OPTION_ORDER.map(key => {
            const opt     = OPTIONS[key];
            const qty     = opt.calcQty(counts);
            const checked = selectedOptions.has(key);
            const subtot  = qty * opt.unitPrice;
            const isStd   = opt.unitPrice === 0;
            return (
              <label key={key} style={{
                ...S.optionRow,
                backgroundColor: checked ? "#f9f7f4" : "#fff",
                borderColor:     checked ? "#c8b99a" : "#eee",
              }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleOption(key)}
                  style={{ marginRight: "10px", accentColor: "#1a1a1a", flexShrink: 0 }}
                />
                <span style={{ flex: 1, fontSize: "13px", color: "#1a1a1a", fontWeight: checked ? "600" : "400" }}>
                  {opt.label}
                </span>
                <span style={{ fontSize: "11px", color: "#999", marginRight: "12px", whiteSpace: "nowrap" }}>
                  {isStd ? "standard" : `${fmt(opt.unitPrice)} / ${opt.unitLabel}`}
                </span>
                <span style={{
                  fontSize: "13px", fontWeight: "600", minWidth: "70px", textAlign: "right",
                  color: checked && !isStd ? "#1a1a1a" : "#bbb",
                }}>
                  {isStd ? "Included" : (checked ? fmt(subtot) : "—")}
                </span>
              </label>
            );
          })}
        </div>

        <Divider />

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SECTION 3 — Accessories                                           */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <SectionHeading step="3" title="Accessories" />

        <table style={S.table}>
          <thead>
            <tr style={S.tableHeadRow}>
              <th style={{ ...S.th, textAlign: "left" }}>Item</th>
              <th style={{ ...S.th, textAlign: "center", width: "100px" }}>Qty</th>
              <th style={{ ...S.th, textAlign: "right", width: "110px" }}>Unit Price</th>
              <th style={{ ...S.th, textAlign: "right", width: "110px" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {ACCESSORY_ORDER.map((key, i) => {
              const acc = ACCESSORIES[key];
              const qty = accessoryQtys[key] ?? 0;
              const total = qty * acc.unitPrice;
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
                  <td style={{ ...S.td, textAlign: "right", color: "#555" }}>
                    {fmt(acc.unitPrice)}
                  </td>
                  <td style={{ ...S.td, textAlign: "right", fontWeight: qty > 0 ? "600" : "400", color: qty > 0 ? "#1a1a1a" : "#bbb" }}>
                    {qty > 0 ? fmt(total) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <Divider />

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SECTION 4 — Designer Notes                                        */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <SectionHeading step="4" title="Notes" />

        <textarea
          value={designerNotes}
          onChange={e => setDesignerNotes(e.target.value)}
          placeholder="Designer notes for this proposal…"
          rows={4}
          style={S.notesArea}
        />

        <Divider />

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SECTION 5 — Pricing Summary                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <SectionHeading step="5" title="Pricing Summary" />

        <div style={S.summaryWrap}>

          {/* Base layout breakdown */}
          <div style={S.summaryGroup}>
            <div style={S.summaryGroupLabel}>Base Layout</div>
            {result.baseLineItems.map((li, i) => (
              <SummaryRow key={i} label={`${li.label} × ${li.qty}`} value={fmt(li.total)} indent />
            ))}
            <SummaryRow label="Subtotal" value={fmt(result.baseSubtotal)} />
            <SummaryRow label={`Adjustment (11%)`} value={fmt(result.baseAdjustment)} />
            <SummaryRow label="Base Layout Price" value={fmt(result.baseTotal)} bold />
          </div>

          {/* Material tier upgrade */}
          {result.tierUpgrade > 0 && (
            <div style={S.summaryGroup}>
              <div style={S.summaryGroupLabel}>Material Tier</div>
              <SummaryRow
                label={`${materialTier} (+${Math.round((result.tierMultiplier - 1) * 100)}% upgrade)`}
                value={`+${fmt(result.tierUpgrade)}`}
                accent
              />
              <SummaryRow label="Material-Adjusted Base" value={fmt(result.materialBase)} bold />
            </div>
          )}

          {/* Options */}
          {result.optionLines.length > 0 && (
            <div style={S.summaryGroup}>
              <div style={S.summaryGroupLabel}>Custom Options</div>
              {result.optionLines.map((ol, i) => (
                <SummaryRow
                  key={i}
                  label={`${ol.label} × ${ol.qty} ${OPTIONS[ol.key].unitLabel}`}
                  value={`+${fmt(ol.total)}`}
                  indent
                />
              ))}
              <SummaryRow label="Options Total" value={fmt(result.optionsTotal)} bold />
            </div>
          )}

          {/* Accessories */}
          {result.accessoryLines.length > 0 && (
            <div style={S.summaryGroup}>
              <div style={S.summaryGroupLabel}>Accessories</div>
              {result.accessoryLines.map((al, i) => (
                <SummaryRow
                  key={i}
                  label={`${al.label} × ${al.qty}`}
                  value={`+${fmt(al.total)}`}
                  indent
                />
              ))}
              <SummaryRow label="Accessories Total" value={fmt(result.accessoriesTotal)} bold />
            </div>
          )}

          {/* Totals block */}
          <div style={{ ...S.summaryGroup, borderTop: "2px solid #1a1a1a", paddingTop: "16px" }}>
            <SummaryRow label="Subtotal" value={fmtDec(result.subtotal)} />

            {/* Promotion discount */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
              <span style={{ fontSize: "13px", color: "#555" }}>Promotion Discount</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "13px", color: "#555" }}>−$</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={promoDiscount === 0 ? "" : promoDiscount}
                  placeholder="0"
                  onChange={e => setPromoDiscount(Math.max(0, Number(e.target.value) || 0))}
                  style={S.promoInput}
                />
                {result.promoDiscount > 0 && (
                  <span style={{ fontSize: "13px", color: "#b91c1c", fontWeight: "600", minWidth: "80px", textAlign: "right" }}>
                    −{fmtDec(result.promoDiscount)}
                  </span>
                )}
              </div>
            </div>

            <div style={S.finalDivider} />
            <SummaryRow label="Final Total" value={fmtDec(result.finalTotal)} finalTotal />
          </div>
        </div>

        {/* Warnings */}
        {result.warnings.length > 0 && (
          <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {result.warnings.map((w, i) => (
              <div key={i} style={S.warning}>⚠ {w}</div>
            ))}
          </div>
        )}

        {/* ── Bottom nav ───────────────────────────────────────────────────── */}
        <div style={{ marginTop: "40px", display: "flex", justifyContent: "space-between" }}>
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

// ─── Small presentational helpers ─────────────────────────────────────────────

function Divider() {
  return <div style={{ borderTop: "1px solid #e8e4de", margin: "28px 0" }} />;
}

function SectionHeading({ step, title }: { step: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "16px" }}>
      <span style={{ fontSize: "11px", fontWeight: "700", color: "#fff", backgroundColor: "#1a1a1a", borderRadius: "4px", padding: "2px 7px" }}>
        {step}
      </span>
      <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#1a1a1a" }}>{title}</h2>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={{ fontSize: "10px", fontWeight: "700", color: "#999", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
      <span style={{ fontSize: "14px", color: "#111", fontWeight: "500" }}>{value}</span>
    </div>
  );
}

function CountBadge({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
      <span style={{ fontSize: "18px", fontWeight: "800", color: "#1a1a1a" }}>{value}</span>
      <span style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</span>
    </div>
  );
}

function SummaryRow({
  label, value, indent, bold, accent, finalTotal,
}: {
  label: string; value: string;
  indent?: boolean; bold?: boolean; accent?: boolean; finalTotal?: boolean;
}) {
  return (
    <div style={{
      display:        "flex",
      justifyContent: "space-between",
      alignItems:     "center",
      padding:        `${finalTotal ? 8 : 5}px ${indent ? 12 : 0}px`,
      borderLeft:     indent ? "2px solid #e8e4de" : "none",
      marginLeft:     indent ? "4px" : "0",
    }}>
      <span style={{
        fontSize: finalTotal ? "16px" : "13px",
        fontWeight: (bold || finalTotal) ? "700" : "400",
        color:  finalTotal ? "#1a1a1a" : (accent ? "#1a7a4a" : "#555"),
      }}>
        {label}
      </span>
      <span style={{
        fontSize: finalTotal ? "20px" : "13px",
        fontWeight: (bold || finalTotal) ? "700" : "500",
        color:  finalTotal ? "#1a1a1a" : (accent ? "#1a7a4a" : "#333"),
        minWidth: "100px",
        textAlign: "right",
      }}>
        {value}
      </span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: {
    fontFamily:      "sans-serif",
    minHeight:       "100vh",
    backgroundColor: "#f5f2ee",
    padding:         "40px 24px",
  },
  sheet: {
    maxWidth:        "820px",
    margin:          "0 auto",
    backgroundColor: "#fff",
    border:          "1px solid #e0dbd4",
    borderRadius:    "12px",
    padding:         "40px 52px",
  },
  nav: {
    display:         "flex",
    justifyContent:  "space-between",
    alignItems:      "center",
    marginBottom:    "28px",
  },
  headerBlock: {
    marginBottom: "24px",
  },
  h1: {
    fontSize:    "26px",
    fontWeight:  "800",
    color:       "#1a1a1a",
    margin:      0,
    marginBottom: "6px",
  },
  headerSub: {
    fontSize: "13px",
    color:    "#888",
    margin:   0,
  },
  infoGrid: {
    display:               "grid",
    gridTemplateColumns:   "repeat(3, 1fr)",
    gap:                   "16px 28px",
    padding:               "18px 22px",
    backgroundColor:       "#f9f7f4",
    border:                "1px solid #e8e4de",
    borderRadius:          "8px",
    marginBottom:          "16px",
  },
  countsStrip: {
    display:         "flex",
    gap:             "0",
    justifyContent:  "space-around",
    padding:         "14px 0",
    backgroundColor: "#f9f7f4",
    border:          "1px solid #e8e4de",
    borderRadius:    "8px",
  },
  tierGrid: {
    display:             "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap:                 "12px",
  },
  tierCard: {
    padding:      "18px 14px",
    borderRadius: "10px",
    border:       "2px solid #ddd",
    cursor:       "pointer",
    textAlign:    "left",
    transition:   "all 0.15s ease",
    lineHeight:   1,
  },
  optionsGrid: {
    display:       "flex",
    flexDirection: "column",
    gap:           "6px",
  },
  optionRow: {
    display:       "flex",
    alignItems:    "center",
    padding:       "10px 14px",
    borderRadius:  "7px",
    border:        "1px solid #eee",
    cursor:        "pointer",
    transition:    "background 0.1s",
  },
  table: {
    width:           "100%",
    borderCollapse:  "collapse",
    fontSize:        "13px",
  },
  tableHeadRow: {
    borderBottom: "2px solid #1a1a1a",
  },
  th: {
    padding:         "8px 10px",
    fontSize:        "11px",
    fontWeight:      "700",
    color:           "#666",
    textTransform:   "uppercase",
    letterSpacing:   "0.5px",
  },
  td: {
    padding: "9px 10px",
    color:   "#222",
  },
  rowEven: {
    backgroundColor: "#fff",
    borderBottom:    "1px solid #f0ece6",
  },
  rowOdd: {
    backgroundColor: "#faf8f5",
    borderBottom:    "1px solid #f0ece6",
  },
  qtyInput: {
    width:        "60px",
    padding:      "5px 8px",
    fontSize:     "13px",
    border:       "1px solid #ccc",
    borderRadius: "5px",
    textAlign:    "center",
    color:        "#111",
  },
  notesArea: {
    width:        "100%",
    padding:      "12px 14px",
    fontSize:     "13px",
    border:       "1px solid #ddd",
    borderRadius: "7px",
    resize:       "vertical",
    color:        "#111",
    fontFamily:   "sans-serif",
    boxSizing:    "border-box",
  },
  summaryWrap: {
    maxWidth:     "480px",
    marginLeft:   "auto",
    display:      "flex",
    flexDirection: "column",
    gap:          "0",
  },
  summaryGroup: {
    borderTop:    "1px solid #e8e4de",
    paddingTop:   "12px",
    paddingBottom: "12px",
  },
  summaryGroupLabel: {
    fontSize:       "10px",
    fontWeight:     "700",
    color:          "#999",
    textTransform:  "uppercase",
    letterSpacing:  "0.6px",
    marginBottom:   "8px",
  },
  finalDivider: {
    borderTop:   "2px solid #1a1a1a",
    margin:      "8px 0",
  },
  btnBack: {
    padding:         "9px 18px",
    fontSize:        "13px",
    fontWeight:      "600",
    backgroundColor: "#fff",
    color:           "#444",
    border:          "1px solid #ccc",
    borderRadius:    "7px",
    cursor:          "pointer",
  },
  btnPrint: {
    padding:         "9px 18px",
    fontSize:        "13px",
    fontWeight:      "700",
    backgroundColor: "#1a1a1a",
    color:           "#fff",
    border:          "none",
    borderRadius:    "7px",
    cursor:          "pointer",
  },
  promoInput: {
    width:        "90px",
    padding:      "5px 8px",
    fontSize:     "13px",
    border:       "1px solid #ccc",
    borderRadius: "5px",
    textAlign:    "right",
    color:        "#111",
  },
  warning: {
    fontSize:        "12px",
    color:           "#92400e",
    backgroundColor: "#fffbeb",
    border:          "1px solid #fcd34d",
    borderRadius:    "5px",
    padding:         "8px 12px",
  },
};
