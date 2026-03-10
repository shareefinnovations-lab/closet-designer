"use client";

import { computePricing, ADJUSTMENT_RATE, type PricingSection } from "@/src/lib/pricing";
import type { Section } from "../_lib/types";

interface PricingPanelProps {
  sections: Section[];
  overallDepthIn: number;
}

export function PricingPanel({ sections, overallDepthIn }: PricingPanelProps) {
  const pricingSections: PricingSection[] = sections.map(s => ({
    widthIn: s.widthIn,
    depthIn: s.depthIn,
    components: s.components.map(c => ({
      type: c.type,
      drawerHeights: c.drawerHeights,
    })),
  }));

  const { lineItems, subtotal, adjustment, total, warnings } = computePricing(pricingSections, overallDepthIn);

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const panelStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    border: "1px solid #e0dbd4",
    borderRadius: "8px",
    padding: "20px 24px",
    marginTop: "28px",
  };
  const headingStyle: React.CSSProperties = {
    fontSize: "13px", fontWeight: "700", color: "#222",
    textTransform: "uppercase", letterSpacing: "0.6px",
    marginBottom: "14px", marginTop: 0,
  };
  const rowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr auto auto auto",
    gap: "0 16px",
    alignItems: "center",
    fontSize: "13px",
    color: "#333",
    padding: "7px 0",
    borderBottom: "1px solid #f0ece6",
  };
  const colHdr: React.CSSProperties = {
    fontSize: "11px", fontWeight: "700", color: "#888",
    textTransform: "uppercase", letterSpacing: "0.5px",
  };

  return (
    <div style={panelStyle}>
      <p style={headingStyle}>Pricing Summary</p>

      {/* Column headers */}
      <div style={{ ...rowStyle, borderBottom: "2px solid #e0dbd4", paddingBottom: "8px", marginBottom: "2px" }}>
        <span style={colHdr}>Item</span>
        <span style={{ ...colHdr, textAlign: "right" }}>Qty</span>
        <span style={{ ...colHdr, textAlign: "right" }}>Unit</span>
        <span style={{ ...colHdr, textAlign: "right" }}>Total</span>
      </div>

      {/* Line items */}
      {lineItems.length === 0 ? (
        <p style={{ fontSize: "13px", color: "#999", margin: "12px 0" }}>
          No items yet — add sections and components to see pricing.
        </p>
      ) : (
        lineItems.map((li, i) => (
          <div key={i} style={rowStyle}>
            <span>{li.label}</span>
            <span style={{ textAlign: "right", color: "#555" }}>{li.qty}</span>
            <span style={{ textAlign: "right", color: "#555" }}>{fmt(li.unitPrice)}</span>
            <span style={{ textAlign: "right", fontWeight: "600" }}>{fmt(li.total)}</span>
          </div>
        ))
      )}

      {/* Subtotal / Adjustment / Total */}
      <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: "32px", fontSize: "13px", color: "#555" }}>
          <span>Subtotal</span>
          <span style={{ minWidth: "80px", textAlign: "right" }}>{fmt(subtotal)}</span>
        </div>
        <div style={{ display: "flex", gap: "32px", fontSize: "13px", color: "#555" }}>
          <span>Adjustment ({Math.round(ADJUSTMENT_RATE * 100)}%)</span>
          <span style={{ minWidth: "80px", textAlign: "right" }}>{fmt(adjustment)}</span>
        </div>
        <div style={{ display: "flex", gap: "32px", fontSize: "15px", fontWeight: "700", color: "#1a1a1a", borderTop: "2px solid #1a1a1a", paddingTop: "8px", marginTop: "4px" }}>
          <span>Total</span>
          <span style={{ minWidth: "80px", textAlign: "right" }}>{fmt(total)}</span>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: "12px", color: "#92400e", backgroundColor: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "5px", padding: "7px 10px" }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
