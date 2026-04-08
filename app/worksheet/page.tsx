"use client";
// app/worksheet/page.tsx — Multi-wall pricing worksheet (v2)
//
// Reads design-state (all walls) + room-layout from localStorage.
// Computes per-wall and combined internal pricing using the 11% adjustment engine.
// Internal use only — leads to the client-facing presentation page.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getActiveProjectId, saveCurrentProject } from "@/app/_lib/projects";
import { ADJUSTMENT_RATE } from "@/src/lib/pricing";
import { computeWallWorksheet } from "@/src/lib/wall-pricing";
import type { WallWorksheetResult, DesignStateV2 } from "@/src/lib/wall-pricing";
import type { RoomLayout } from "@/app/_lib/room-types";
import { getSelectedWalls } from "@/app/_lib/room-types";

// ─── Formatters ───────────────────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorksheetPage() {
  const router = useRouter();

  const [layout,  setLayout]  = useState<RoomLayout | null>(null);
  const [results, setResults] = useState<WallWorksheetResult[]>([]);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    const rawLayout = localStorage.getItem("room-layout");
    const rawState  = localStorage.getItem("design-state");

    if (!rawLayout) {
      setError("No room layout found. Please complete the room layout first.");
      return;
    }
    if (!rawState) {
      setError("No design found. Please complete the design first.");
      return;
    }

    try {
      const layout      = JSON.parse(rawLayout) as RoomLayout;
      const designState = JSON.parse(rawState)  as DesignStateV2;

      if (designState.v !== 2 || !Array.isArray(designState.runs)) {
        setError("Design data format is not recognized. Please go back and re-save your design.");
        return;
      }

      const selectedWalls = getSelectedWalls(layout);
      const sysH          = layout.systemHeightIn;
      const overallDepth  = layout.closetDepthIn;

      // Build a result for every wall that has sections designed
      const wallResults: WallWorksheetResult[] = [];
      for (let idx = 0; idx < selectedWalls.length; idx++) {
        const wall  = selectedWalls[idx];
        const run   = designState.runs.find(r => r.wallId === wall.id);
        const label = `Wall ${String.fromCharCode(65 + idx)}`; // A, B, C…

        if (!run || run.sections.length === 0) continue;

        wallResults.push(
          computeWallWorksheet(run, label, overallDepth, sysH)
        );
      }

      setLayout(layout);
      setResults(wallResults);
    } catch {
      setError("Could not read design data. Please go back and try again.");
    }
  }, []);

  // ── Error state ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={S.page}>
        <div style={{ textAlign: "center", paddingTop: "80px" }}>
          <p style={{ fontSize: "15px", color: "#b91c1c", marginBottom: "24px" }}>{error}</p>
          <button onClick={() => router.push("/design")} style={S.btnBack}>
            ← Back to Design
          </button>
        </div>
      </div>
    );
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (!layout) {
    return (
      <div style={S.page}>
        <p style={{ color: "#888", paddingTop: "80px", textAlign: "center" }}>Loading…</p>
      </div>
    );
  }

  // ── Combined totals ───────────────────────────────────────────────────────────
  const combinedSubtotal   = results.reduce((s, r) => s + r.pricing.subtotal,   0);
  const combinedAdjustment = results.reduce((s, r) => s + r.pricing.adjustment, 0);
  const combinedTotal      = results.reduce((s, r) => s + r.pricing.total,      0);
  const combinedPanels     = results.reduce((s, r) => s + r.panelCount,         0);
  const combinedShelves    = results.reduce((s, r) => s + r.shelfCount,         0);
  const combinedRods       = results.reduce((s, r) => s + r.rodCount,           0);
  const combinedDrawers    = results.reduce((s, r) => s + r.drawerCount,        0);

  return (
    <div style={S.page}>
      <div style={S.sheet}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={S.header}>
          <div>
            <h1 style={S.h1}>Pricing Worksheet</h1>
            <p style={S.subtitle}>Internal use only</p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => router.push("/")} style={S.btnBack}>
              Dashboard
            </button>
            <button onClick={() => router.push("/design")} style={S.btnBack}>
              ← Back to Design
            </button>
            <button onClick={() => { saveCurrentProject(getActiveProjectId()); }}
              style={{ ...S.btnBack, backgroundColor: "#3a5a3a", color: "#fff", border: "none", fontWeight: "700" }}>
              Save
            </button>
            <button onClick={() => router.push("/design-preview")} style={S.btnNext}>
              Design Preview →
            </button>
          </div>
        </div>

        {/* ── Client Info ─────────────────────────────────────────────────── */}
        <div style={S.infoGrid}>
          <InfoRow label="Client Name"    value={layout.clientName   || "—"} />
          <InfoRow label="Client #"       value={layout.clientNum    || "—"} />
          <InfoRow label="Location"       value={layout.locationName || "—"} />
          <InfoRow label="System Height"  value={`${layout.systemHeightIn}"`} />
          <InfoRow label="Ceiling Height" value={`${layout.ceilingHeightIn}"`} />
          <InfoRow label="Overall Depth"  value={`${layout.closetDepthIn}"`} />
        </div>

        {/* ── Project summary strip ────────────────────────────────────────── */}
        {results.length > 0 && (
          <div style={S.summaryStrip}>
            <SummaryBadge label="Walls"    value={results.length} />
            <SummaryBadge label="Panels"   value={combinedPanels} />
            <SummaryBadge label="Shelves"  value={combinedShelves} />
            <SummaryBadge label="Rods"     value={combinedRods} />
            <SummaryBadge label="Drawers"  value={combinedDrawers} />
          </div>
        )}

        {/* ── Empty state ──────────────────────────────────────────────────── */}
        {results.length === 0 && (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#999" }}>
            <p style={{ fontSize: "15px", marginBottom: "8px" }}>No walls have been designed yet.</p>
            <p style={{ fontSize: "13px" }}>Add sections to walls in the Design editor, then come back here.</p>
          </div>
        )}

        {/* ── Per-wall sections ────────────────────────────────────────────── */}
        {results.map((res, wi) => (
          <div key={res.wallId} style={{ marginTop: wi === 0 ? "32px" : "40px" }}>

            {/* Wall heading */}
            <div style={S.wallHeading}>
              <span style={S.wallLabel}>{res.label}</span>
              <span style={S.wallMeta}>
                {res.wallWidthIn}" wide · {res.pricing.lineItems.length} line item{res.pricing.lineItems.length !== 1 ? "s" : ""}
                {" · "}{res.panelCount} panel{res.panelCount !== 1 ? "s" : ""}
                {" · "}{res.shelfCount} shelf{res.shelfCount !== 1 ? "ves" : ""}
                {res.rodCount > 0 ? ` · ${res.rodCount} rod${res.rodCount !== 1 ? "s" : ""}` : ""}
                {res.drawerCount > 0 ? ` · ${res.drawerCount} drawer${res.drawerCount !== 1 ? "s" : ""}` : ""}
              </span>
            </div>

            {/* Line items table */}
            <table style={S.table}>
              <thead>
                <tr style={S.tableHeadRow}>
                  <th style={{ ...S.th, textAlign: "left" }}>Item</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Qty</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Unit Price</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {res.pricing.lineItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: "20px", textAlign: "center", color: "#999", fontSize: "13px" }}>
                      No priced items for this wall.
                    </td>
                  </tr>
                ) : (
                  res.pricing.lineItems.map((li, i) => (
                    <tr key={i} style={i % 2 === 0 ? S.rowEven : S.rowOdd}>
                      <td style={S.td}>{li.label}</td>
                      <td style={{ ...S.td, textAlign: "right" }}>{li.qty}</td>
                      <td style={{ ...S.td, textAlign: "right" }}>{fmt(li.unitPrice)}</td>
                      <td style={{ ...S.td, textAlign: "right", fontWeight: "600" }}>{fmt(li.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Wall totals */}
            {res.pricing.lineItems.length > 0 && (
              <div style={S.wallTotals}>
                <WallTotalRow label="Subtotal"                                         value={fmtDec(res.pricing.subtotal)} />
                <WallTotalRow label={`Adjustment (${Math.round(ADJUSTMENT_RATE * 100)}%)`} value={fmtDec(res.pricing.adjustment)} />
                <div style={{ borderTop: "1.5px solid #1a1a1a", margin: "4px 0" }} />
                <WallTotalRow label={`${res.label} Total`} value={fmtDec(res.pricing.total)} bold />
              </div>
            )}

            {/* Per-wall warnings */}
            {res.pricing.warnings.length > 0 && (
              <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "5px" }}>
                {res.pricing.warnings.map((w, i) => (
                  <div key={i} style={S.warning}>⚠ {w}</div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* ── Divider before combined totals ───────────────────────────────── */}
        {results.length > 1 && (
          <div style={{ borderTop: "2px solid #1a1a1a", margin: "40px 0 28px" }} />
        )}

        {/* ── Combined totals (shown when 2+ walls) ────────────────────────── */}
        {results.length > 1 && (
          <>
            <p style={{ fontSize: "13px", fontWeight: "700", color: "#555", textTransform: "uppercase",
              letterSpacing: "0.6px", margin: "0 0 14px" }}>
              Full Closet Combined
            </p>
            <div style={S.combinedTotals}>
              <CombinedRow label="Combined Subtotal"                                       value={fmtDec(combinedSubtotal)} />
              <CombinedRow label={`Adjustment (${Math.round(ADJUSTMENT_RATE * 100)}%)`}   value={fmtDec(combinedAdjustment)} />
              <div style={{ borderTop: "2px solid #1a1a1a", margin: "6px 0" }} />
              <CombinedRow label="Worksheet Total" value={fmtDec(combinedTotal)} bold />
            </div>
          </>
        )}

        {/* Single-wall — just show the total block at the bottom */}
        {results.length === 1 && (
          <div style={{ marginTop: "0", borderTop: "2px solid #e0dbd4", paddingTop: "20px" }}>
            <div style={S.combinedTotals}>
              <CombinedRow label="Subtotal"                                                value={fmtDec(results[0].pricing.subtotal)} />
              <CombinedRow label={`Adjustment (${Math.round(ADJUSTMENT_RATE * 100)}%)`}   value={fmtDec(results[0].pricing.adjustment)} />
              <div style={{ borderTop: "2px solid #1a1a1a", margin: "6px 0" }} />
              <CombinedRow label="Worksheet Total" value={fmtDec(results[0].pricing.total)} bold />
            </div>
          </div>
        )}

        {/* ── Placeholder rows (not yet in pricing engine) ─────────────────── */}
        <div style={{ marginTop: "24px" }}>
          <p style={{ fontSize: "10px", fontWeight: "700", color: "#aaa", textTransform: "uppercase",
            letterSpacing: "0.5px", margin: "0 0 8px" }}>
            Not yet priced
          </p>
          <table style={{ ...S.table, opacity: 0.5 }}>
            <tbody>
              <tr style={S.rowEven}>
                <td style={S.td}>Bridge Shelf</td>
                <td style={{ ...S.td, textAlign: "right", color: "#aaa" }}>—</td>
                <td style={{ ...S.td, textAlign: "right", color: "#aaa" }}>—</td>
                <td style={{ ...S.td, textAlign: "right", color: "#aaa", fontStyle: "italic", fontSize: "11px" }}>TBD</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Bottom nav ───────────────────────────────────────────────────── */}
        <div style={{ marginTop: "40px", display: "flex", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => router.push("/")} style={S.btnBack}>Dashboard</button>
            <button onClick={() => router.push("/design")} style={S.btnBack}>← Back to Design</button>
          </div>
          <button onClick={() => router.push("/design-preview")} style={S.btnNext}>
            Design Preview →
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
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

function SummaryBadge({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
      <span style={{ fontSize: "18px", fontWeight: "800", color: "#1a1a1a" }}>{value}</span>
      <span style={{ fontSize: "10px", color: "#888", textTransform: "uppercase",
        letterSpacing: "0.4px" }}>
        {label}
      </span>
    </div>
  );
}

function WallTotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: bold ? "14px" : "13px", fontWeight: bold ? "700" : "400",
        color: bold ? "#111" : "#555" }}>
        {label}
      </span>
      <span style={{ fontSize: bold ? "15px" : "13px", fontWeight: bold ? "700" : "500",
        color: bold ? "#111" : "#333", minWidth: "120px", textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function CombinedRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: bold ? "15px" : "13px", fontWeight: bold ? "700" : "400",
        color: bold ? "#1a1a1a" : "#555" }}>
        {label}
      </span>
      <span style={{ fontSize: bold ? "18px" : "14px", fontWeight: bold ? "800" : "500",
        color: bold ? "#1a1a1a" : "#333", minWidth: "130px", textAlign: "right" }}>
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
    maxWidth:        "800px",
    margin:          "0 auto",
    backgroundColor: "#fff",
    border:          "1px solid #e0dbd4",
    borderRadius:    "12px",
    padding:         "40px 48px",
  },
  header: {
    display:        "flex",
    justifyContent: "space-between",
    alignItems:     "flex-start",
    marginBottom:   "28px",
    flexWrap:       "wrap",
    gap:            "16px",
  },
  h1: {
    fontSize:     "24px",
    fontWeight:   "800",
    color:        "#1a1a1a",
    margin:       0,
    marginBottom: "4px",
  },
  subtitle: {
    fontSize:        "12px",
    color:           "#999",
    margin:          0,
    textTransform:   "uppercase",
    letterSpacing:   "0.5px",
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
  btnNext: {
    padding:         "9px 18px",
    fontSize:        "13px",
    fontWeight:      "700",
    backgroundColor: "#1a1a1a",
    color:           "#fff",
    border:          "none",
    borderRadius:    "7px",
    cursor:          "pointer",
  },
  infoGrid: {
    display:              "grid",
    gridTemplateColumns:  "repeat(3, 1fr)",
    gap:                  "20px 32px",
    padding:              "20px 24px",
    backgroundColor:      "#f9f7f4",
    border:               "1px solid #e8e4de",
    borderRadius:         "8px",
    marginBottom:         "20px",
  },
  summaryStrip: {
    display:         "flex",
    justifyContent:  "space-around",
    padding:         "14px 0",
    backgroundColor: "#f9f7f4",
    border:          "1px solid #e8e4de",
    borderRadius:    "8px",
    marginBottom:    "4px",
  },
  wallHeading: {
    display:        "flex",
    alignItems:     "baseline",
    gap:            "12px",
    marginBottom:   "10px",
    paddingBottom:  "8px",
    borderBottom:   "2px solid #1a1a1a",
  },
  wallLabel: {
    fontSize:   "16px",
    fontWeight: "800",
    color:      "#1a1a1a",
  },
  wallMeta: {
    fontSize: "12px",
    color:    "#888",
  },
  table: {
    width:           "100%",
    borderCollapse:  "collapse",
    fontSize:        "13px",
    marginBottom:    "0",
  },
  tableHeadRow: {
    borderBottom: "2px solid #1a1a1a",
  },
  th: {
    padding:         "8px 12px",
    fontSize:        "11px",
    fontWeight:      "700",
    color:           "#555",
    textTransform:   "uppercase",
    letterSpacing:   "0.5px",
  },
  td: {
    padding:  "10px 12px",
    color:    "#222",
    fontSize: "13px",
  },
  rowEven: {
    backgroundColor: "#fff",
    borderBottom:    "1px solid #f0ece6",
  },
  rowOdd: {
    backgroundColor: "#faf8f5",
    borderBottom:    "1px solid #f0ece6",
  },
  wallTotals: {
    marginTop:     "0",
    borderTop:     "1px solid #e0dbd4",
    paddingTop:    "12px",
    display:       "flex",
    flexDirection: "column",
    gap:           "7px",
    maxWidth:      "340px",
    marginLeft:    "auto",
  },
  combinedTotals: {
    display:       "flex",
    flexDirection: "column",
    gap:           "10px",
    maxWidth:      "380px",
    marginLeft:    "auto",
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
