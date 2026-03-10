"use client";
// app/worksheet/page.tsx
//
// Internal pricing worksheet.
// Reads design state from localStorage["closet-design"], computes pricing,
// and presents a clean line-item sheet for internal use.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { computePricing, ADJUSTMENT_RATE, type PricingResult } from "@/src/lib/pricing";
import type { Config, Section } from "@/app/elevation/_lib/types";

interface DesignData {
  config: Config;
  sections: Section[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Worksheet ────────────────────────────────────────────────────────────────

export default function WorksheetPage() {
  const router = useRouter();
  const [data,   setData]   = useState<DesignData | null>(null);
  const [result, setResult] = useState<PricingResult | null>(null);
  const [error,  setError]  = useState<string | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("closet-design");
    if (!raw) {
      setError("No design found. Please complete the design first.");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as DesignData;
      const pricingSections = parsed.sections.map(s => ({
        widthIn: s.widthIn,
        depthIn: s.depthIn,
        components: s.components.map(c => ({
          type: c.type,
          drawerHeights: c.drawerHeights,
        })),
      }));
      const pricing = computePricing(pricingSections, parsed.config.closetDepthIn);
      setData(parsed);
      setResult(pricing);
    } catch {
      setError("Design data could not be read. Please go back and try again.");
    }
  }, []);

  // ── Error state ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={styles.page}>
        <div style={{ textAlign: "center", paddingTop: "80px" }}>
          <p style={{ fontSize: "15px", color: "#b91c1c", marginBottom: "24px" }}>{error}</p>
          <button onClick={() => router.push("/elevation")} style={styles.btnBack}>
            ← Back to Design
          </button>
        </div>
      </div>
    );
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (!data || !result) {
    return (
      <div style={styles.page}>
        <p style={{ color: "#888", paddingTop: "80px", textAlign: "center" }}>Loading…</p>
      </div>
    );
  }

  const { config, sections } = data;
  const { lineItems, subtotal, adjustment, total, warnings } = result;

  // Counts for summary header
  const panelCount  = sections.length + 1;
  const sectionSummary = sections.map((s, i) => `S${i + 1}: ${s.widthIn}"`).join(" · ");

  return (
    <div style={styles.page}>
      <div style={styles.sheet}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={styles.header}>
          <div>
            <h1 style={styles.h1}>Pricing Worksheet</h1>
            <p style={styles.subtitle}>Internal use only</p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => router.push("/elevation")} style={styles.btnBack}>
              ← Back to Design
            </button>
            <button onClick={() => router.push("/presentation")} style={styles.btnNext}>
              Continue to Price Presentation →
            </button>
          </div>
        </div>

        {/* ── Client Info ─────────────────────────────────────────────────── */}
        <div style={styles.infoGrid}>
          <InfoRow label="Client Name" value={config.clientName || "—"} />
          <InfoRow label="Client #"    value={config.clientNum  || "—"} />
          <InfoRow label="Location"    value={config.locationName || "—"} />
          <InfoRow label="Wall Width"  value={`${config.wallWidthIn}"`} />
          <InfoRow label="Ceiling Ht." value={`${config.ceilingHeightIn}"`} />
          <InfoRow label="Overall Depth" value={`${config.closetDepthIn}"`} />
        </div>

        {/* ── Design Summary ──────────────────────────────────────────────── */}
        <div style={styles.designSummary}>
          <span style={styles.summaryLabel}>Design</span>
          <span style={{ fontSize: "13px", color: "#555" }}>
            {sections.length} section{sections.length !== 1 ? "s" : ""} &nbsp;·&nbsp;
            {panelCount} panels &nbsp;·&nbsp; {sectionSummary}
          </span>
        </div>

        {/* ── Line Items Table ─────────────────────────────────────────────── */}
        <table style={styles.table}>
          <thead>
            <tr style={styles.tableHeadRow}>
              <th style={{ ...styles.th, textAlign: "left" }}>Item</th>
              <th style={{ ...styles.th, textAlign: "right" }}>Qty</th>
              <th style={{ ...styles.th, textAlign: "right" }}>Unit Price</th>
              <th style={{ ...styles.th, textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: "20px", textAlign: "center", color: "#999", fontSize: "13px" }}>
                  No items — add sections and components in the design.
                </td>
              </tr>
            ) : (
              lineItems.map((li, i) => (
                <tr key={i} style={i % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                  <td style={styles.td}>{li.label}</td>
                  <td style={{ ...styles.td, textAlign: "right" }}>{li.qty}</td>
                  <td style={{ ...styles.td, textAlign: "right" }}>{fmt(li.unitPrice)}</td>
                  <td style={{ ...styles.td, textAlign: "right", fontWeight: "600" }}>{fmt(li.total)}</td>
                </tr>
              ))
            )}

            {/* Bridge Shelf — not yet in pricing engine */}
            <tr style={styles.rowPlaceholder}>
              <td style={styles.td}>Bridge Shelf</td>
              <td style={{ ...styles.td, textAlign: "right", color: "#aaa" }}>—</td>
              <td style={{ ...styles.td, textAlign: "right", color: "#aaa" }}>—</td>
              <td style={{ ...styles.td, textAlign: "right", color: "#aaa", fontStyle: "italic", fontSize: "11px" }}>not yet priced</td>
            </tr>

            {/* Doors — not yet in pricing engine */}
            <tr style={styles.rowPlaceholder}>
              <td style={styles.td}>Doors</td>
              <td style={{ ...styles.td, textAlign: "right", color: "#aaa" }}>—</td>
              <td style={{ ...styles.td, textAlign: "right", color: "#aaa" }}>—</td>
              <td style={{ ...styles.td, textAlign: "right", color: "#aaa", fontStyle: "italic", fontSize: "11px" }}>not yet priced</td>
            </tr>
          </tbody>
        </table>

        {/* ── Totals ──────────────────────────────────────────────────────── */}
        <div style={styles.totalsBlock}>
          <TotalRow label="Subtotal" value={fmtDec(subtotal)} />
          <TotalRow label={`Adjustment (${Math.round(ADJUSTMENT_RATE * 100)}%)`} value={fmtDec(adjustment)} />
          <div style={styles.totalFinalDivider} />
          <TotalRow label="Worksheet Total" value={fmtDec(total)} bold />
        </div>

        {/* ── Warnings ────────────────────────────────────────────────────── */}
        {warnings.length > 0 && (
          <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ fontSize: "12px", fontWeight: "700", color: "#92400e", margin: 0, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Notes
            </p>
            {warnings.map((w, i) => (
              <div key={i} style={styles.warning}>⚠ {w}</div>
            ))}
          </div>
        )}

        {/* ── Bottom Nav ──────────────────────────────────────────────────── */}
        <div style={{ marginTop: "40px", display: "flex", justifyContent: "space-between" }}>
          <button onClick={() => router.push("/elevation")} style={styles.btnBack}>
            ← Back to Design
          </button>
          <button onClick={() => router.push("/presentation")} style={styles.btnNext}>
            Continue to Price Presentation →
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── Small presentational helpers ─────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={{ fontSize: "10px", fontWeight: "700", color: "#999", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
      <span style={{ fontSize: "14px", color: "#111", fontWeight: "500" }}>{value}</span>
    </div>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: bold ? "15px" : "13px", fontWeight: bold ? "700" : "400", color: bold ? "#111" : "#555" }}>
        {label}
      </span>
      <span style={{ fontSize: bold ? "18px" : "14px", fontWeight: bold ? "700" : "500", color: bold ? "#111" : "#333", minWidth: "120px", textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "sans-serif",
    minHeight: "100vh",
    backgroundColor: "#f5f2ee",
    padding: "40px 24px",
  },
  sheet: {
    maxWidth: "760px",
    margin: "0 auto",
    backgroundColor: "#fff",
    border: "1px solid #e0dbd4",
    borderRadius: "12px",
    padding: "40px 48px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "32px",
    flexWrap: "wrap",
    gap: "16px",
  },
  h1: {
    fontSize: "24px",
    fontWeight: "800",
    color: "#1a1a1a",
    margin: 0,
    marginBottom: "4px",
  },
  subtitle: {
    fontSize: "12px",
    color: "#999",
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  btnBack: {
    padding: "9px 18px",
    fontSize: "13px",
    fontWeight: "600",
    backgroundColor: "#fff",
    color: "#444",
    border: "1px solid #ccc",
    borderRadius: "7px",
    cursor: "pointer",
  },
  btnNext: {
    padding: "9px 18px",
    fontSize: "13px",
    fontWeight: "700",
    backgroundColor: "#1a1a1a",
    color: "#fff",
    border: "none",
    borderRadius: "7px",
    cursor: "pointer",
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "20px 32px",
    padding: "20px 24px",
    backgroundColor: "#f9f7f4",
    border: "1px solid #e8e4de",
    borderRadius: "8px",
    marginBottom: "24px",
  },
  designSummary: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "20px",
  },
  summaryLabel: {
    fontSize: "10px",
    fontWeight: "700",
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
    marginBottom: "0",
  },
  tableHeadRow: {
    borderBottom: "2px solid #1a1a1a",
  },
  th: {
    padding: "8px 12px",
    fontSize: "11px",
    fontWeight: "700",
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  td: {
    padding: "10px 12px",
    color: "#222",
    fontSize: "13px",
  },
  rowEven: {
    backgroundColor: "#fff",
    borderBottom: "1px solid #f0ece6",
  },
  rowOdd: {
    backgroundColor: "#faf8f5",
    borderBottom: "1px solid #f0ece6",
  },
  rowPlaceholder: {
    backgroundColor: "#fafafa",
    borderBottom: "1px solid #f0ece6",
    opacity: 0.6,
  },
  totalsBlock: {
    marginTop: "0",
    borderTop: "2px solid #e0dbd4",
    paddingTop: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    maxWidth: "360px",
    marginLeft: "auto",
  },
  totalFinalDivider: {
    borderTop: "2px solid #1a1a1a",
    marginTop: "4px",
    marginBottom: "4px",
  },
  warning: {
    fontSize: "12px",
    color: "#92400e",
    backgroundColor: "#fffbeb",
    border: "1px solid #fcd34d",
    borderRadius: "5px",
    padding: "8px 12px",
  },
};
