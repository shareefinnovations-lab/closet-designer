"use client";

import { MIN_WIDTH, MAX_SECTIONS, C_SELECT } from "../_lib/constants";
import type { Section, View } from "../_lib/types";

interface SectionCardsProps {
  sections: Section[];
  selectedIndex: number | null;
  view: View;
  wallW: number;
  handleWidthChange: (index: number, raw: number) => void;
  handleRemoveSection: (index: number) => void;
  handleAddSection: () => void;
}

export function SectionCards({
  sections, selectedIndex, view, wallW,
  handleWidthChange, handleRemoveSection, handleAddSection,
}: SectionCardsProps) {
  return (
    <div style={{ padding: "20px", backgroundColor: "#f7f5f2", border: "1px solid #e0dbd4", borderRadius: "8px", marginBottom: "12px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
        {sections.map((section, i) => {
          const hasDrawers = section.components.some(c => c.type === "DrawerStack");
          return (
            <div key={i} style={{ flex: "1 1 120px", minWidth: "100px", maxWidth: "180px", backgroundColor: "#fff", border: (view === "front" && i === selectedIndex) ? `2px solid ${C_SELECT}` : "1px solid #ddd", borderRadius: "6px", padding: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <span style={{ fontSize: "11px", fontWeight: "700", color: "#222", textTransform: "uppercase", letterSpacing: "0.5px" }}>Section {i + 1}</span>
                {sections.length > 1 && (
                  <button onClick={() => handleRemoveSection(i)}
                    style={{ fontSize: "11px", color: "#c0392b", background: "none", border: "none", cursor: "pointer", padding: "0" }}>
                    Remove
                  </button>
                )}
              </div>
              <label style={{ display: "block", fontSize: "11px", color: "#444", marginBottom: "3px" }}>Width (in)</label>
              <input type="number" min={MIN_WIDTH} max={wallW - MIN_WIDTH * (sections.length - 1)} value={section.widthIn}
                onChange={e => handleWidthChange(i, Number(e.target.value))}
                style={{ width: "100%", padding: "5px 7px", fontSize: "13px", border: "1px solid #ccc", borderRadius: "4px", boxSizing: "border-box", color: "#111" }} />
              <div style={{ marginTop: "8px", fontSize: "11px", fontWeight: "600", color: hasDrawers ? "#b07030" : "#5a7a5a", backgroundColor: hasDrawers ? "#fff4e0" : "#f0f7f0", border: `1px solid ${hasDrawers ? "#e0c090" : "#c8e0c8"}`, borderRadius: "4px", padding: "3px 7px", display: "inline-block" }}>
                {section.depthIn}&Prime; D{hasDrawers ? " (drawers)" : ""}
              </div>
            </div>
          );
        })}
      </div>
      {sections.length < MAX_SECTIONS && (
        <button onClick={handleAddSection}
          style={{ padding: "8px 16px", fontSize: "13px", fontWeight: "600", backgroundColor: "#2b2b2b", color: "#fff", border: "none", borderRadius: "5px", cursor: "pointer" }}>
          + Add Section
        </button>
      )}
    </div>
  );
}
