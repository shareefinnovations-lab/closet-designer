"use client";

import {
  C_SELECT, LOCK_H_IN, DRAWER_MIN_H, DRAWER_MAX_HEIGHT_FROM_FLOOR,
} from "../_lib/constants";
import { minDepthFor, compHeight } from "../_lib/helpers";
import type { Section, ClosetComponent, ComponentType } from "../_lib/types";

interface SectionEditorProps {
  selectedIndex: number;
  selectedSection: Section;
  overallDepth: number;
  getSectionHeight: (i: number) => number;
  handleDepthChange: (index: number, raw: number) => void;
  handleRemoveComponent: (compId: number) => void;
  updateComponentPosition: (secIdx: number, compId: number, rawPosIn: number) => void;
  handleAddDrawer: (compId: number) => void;
  handleRemoveDrawer: (compId: number) => void;
  handleDrawerHeightChange: (compId: number, drawerIdx: number, raw: number) => void;
  handleAddComponent: (type: ComponentType) => void;
  onClose: () => void;
}

export function SectionEditor({
  selectedIndex, selectedSection, overallDepth,
  getSectionHeight, handleDepthChange,
  handleRemoveComponent, updateComponentPosition,
  handleAddDrawer, handleRemoveDrawer, handleDrawerHeightChange,
  handleAddComponent, onClose,
}: SectionEditorProps) {
  const minD       = minDepthFor(selectedSection.components);
  const hasDrawers = selectedSection.components.some(c => c.type === "DrawerStack");

  return (
    <div style={{ padding: "16px 20px", backgroundColor: "#eef4ff", border: `2px solid ${C_SELECT}`, borderRadius: "8px", marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "13px", fontWeight: "700", color: C_SELECT }}>
          Section {selectedIndex + 1} — Interior Components
        </span>
        <button onClick={onClose}
          style={{ fontSize: "12px", color: "#666", background: "none", border: "none", cursor: "pointer" }}>
          Close ✕
        </button>
      </div>

      <div style={{ fontSize: "12px", color: "#5a7a5a", backgroundColor: "#f0f7f0", border: "1px solid #c8e0c8", borderRadius: "5px", padding: "8px 10px", marginBottom: "14px" }}>
        <strong>Top Lock</strong> and <strong>Bottom Lock</strong> shelves are structural and always present.
        Drag components in the drawing to reposition them.
      </div>

      {/* Section depth control */}
      <div style={{ backgroundColor: "#fff", border: "1px solid #d0d8f0", borderRadius: "6px", padding: "10px 12px", marginBottom: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <span style={{ fontSize: "12px", fontWeight: "700", color: "#444" }}>Section Depth</span>
          <span style={{ fontSize: "11px", fontWeight: "600", color: hasDrawers ? "#b07030" : "#5a7a5a", backgroundColor: hasDrawers ? "#fff4e0" : "#f0f7f0", border: `1px solid ${hasDrawers ? "#e0c090" : "#c8e0c8"}`, borderRadius: "4px", padding: "2px 7px" }}>
            Min: {minD}&Prime; {hasDrawers ? "(drawers)" : "(default)"}
          </span>
        </div>
        <label style={{ fontSize: "11px", color: "#666" }}>
          {selectedSection.depthIn}&Prime; of {overallDepth}&Prime; overall
        </label>
        <input type="range" min={minD} max={overallDepth} value={selectedSection.depthIn}
          onChange={e => handleDepthChange(selectedIndex, Number(e.target.value))}
          style={{ width: "100%", marginTop: "4px" }} />
      </div>

      {/* Component list */}
      {selectedSection.components.length === 0 ? (
        <p style={{ fontSize: "13px", color: "#555", marginBottom: "14px" }}>No components yet. Add one below.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
          {selectedSection.components.map(comp => {
            const sectionH = getSectionHeight(selectedIndex);
            return (
              <ComponentCard
                key={comp.id}
                comp={comp}
                sectionH={sectionH}
                selectedIndex={selectedIndex}
                handleRemoveComponent={handleRemoveComponent}
                updateComponentPosition={updateComponentPosition}
                handleAddDrawer={handleAddDrawer}
                handleRemoveDrawer={handleRemoveDrawer}
                handleDrawerHeightChange={handleDrawerHeightChange}
              />
            );
          })}
        </div>
      )}

      {/* Add component buttons */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {(["Shelf", "DrawerStack", "Rod"] as ComponentType[]).map(type => (
          <button key={type} onClick={() => handleAddComponent(type)}
            style={{ padding: "7px 13px", fontSize: "12px", fontWeight: "600", backgroundColor: "#fff", color: C_SELECT, border: `1px solid ${C_SELECT}`, borderRadius: "5px", cursor: "pointer" }}>
            + {type === "DrawerStack" ? "Drawer Stack" : type === "Rod" ? "Hanging Rod" : "Shelf"}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── ComponentCard ─────────────────────────────────────────────────────────────

interface ComponentCardProps {
  comp: ClosetComponent;
  sectionH: number;
  selectedIndex: number;
  handleRemoveComponent: (compId: number) => void;
  updateComponentPosition: (secIdx: number, compId: number, rawPosIn: number) => void;
  handleAddDrawer: (compId: number) => void;
  handleRemoveDrawer: (compId: number) => void;
  handleDrawerHeightChange: (compId: number, drawerIdx: number, raw: number) => void;
}

function ComponentCard({
  comp, sectionH, selectedIndex,
  handleRemoveComponent, updateComponentPosition,
  handleAddDrawer, handleRemoveDrawer, handleDrawerHeightChange,
}: ComponentCardProps) {
  return (
    <div style={{ backgroundColor: "#fff", border: "1px solid #d0d8f0", borderRadius: "6px", padding: "12px" }}>
      {/* Component header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <strong style={{ fontSize: "13px", color: "#444" }}>
          {comp.type === "DrawerStack" ? "Drawer Stack" : comp.type === "Rod" ? "Hanging Rod" : "Shelf"}
        </strong>
        <button onClick={() => handleRemoveComponent(comp.id)}
          style={{ fontSize: "11px", color: "#c0392b", background: "none", border: "none", cursor: "pointer" }}>
          Remove
        </button>
      </div>

      {/* Position row (all component types) */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
        <span style={{ fontSize: "11px", color: "#444" }}>Position from top:</span>
        <strong style={{ fontSize: "12px", color: "#111" }}>{comp.positionIn}&Prime;</strong>
        <span style={{ fontSize: "11px", color: "#666" }}>— drag on canvas to move</span>
      </div>

      {/* Fine-tune position with number input */}
      <label style={{ fontSize: "11px", color: "#444", display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
        Fine-tune:
        <input type="number"
          min={comp.type === "DrawerStack"
            ? Math.max(LOCK_H_IN, sectionH - DRAWER_MAX_HEIGHT_FROM_FLOOR)
            : LOCK_H_IN}
          max={sectionH - LOCK_H_IN - compHeight(comp)}
          value={comp.positionIn}
          onChange={e => updateComponentPosition(selectedIndex, comp.id, Number(e.target.value))}
          style={{ width: "70px", padding: "3px 6px", fontSize: "12px", border: "1px solid #ccc", borderRadius: "4px", color: "#111" }} />
        <span style={{ color: "#555" }}>inches</span>
      </label>

      {/* Drawer-specific UI */}
      {comp.type === "DrawerStack" && (
        <DrawerStackEditor
          comp={comp}
          sectionH={sectionH}
          handleAddDrawer={handleAddDrawer}
          handleRemoveDrawer={handleRemoveDrawer}
          handleDrawerHeightChange={handleDrawerHeightChange}
        />
      )}
    </div>
  );
}

// ─── DrawerStackEditor ─────────────────────────────────────────────────────────

interface DrawerStackEditorProps {
  comp: ClosetComponent;
  sectionH: number;
  handleAddDrawer: (compId: number) => void;
  handleRemoveDrawer: (compId: number) => void;
  handleDrawerHeightChange: (compId: number, drawerIdx: number, raw: number) => void;
}

function DrawerStackEditor({ comp, sectionH, handleAddDrawer, handleRemoveDrawer, handleDrawerHeightChange }: DrawerStackEditorProps) {
  const total     = comp.drawerHeights.reduce((s, h) => s + h, 0);
  const fromFloor = sectionH - comp.positionIn;
  const overLimit = fromFloor > DRAWER_MAX_HEIGHT_FROM_FLOOR;

  return (
    <div style={{ marginTop: "10px", borderTop: "1px solid #e8edf8", paddingTop: "10px" }}>
      {/* Floor-distance note */}
      <div style={{ fontSize: "11px", color: overLimit ? "#b91c1c" : "#666", backgroundColor: overLimit ? "#fff0f0" : "#fef9ef", border: `1px solid ${overLimit ? "#fca5a5" : "#f0e0b0"}`, borderRadius: "4px", padding: "6px 8px", marginBottom: "12px" }}>
        Top of stack is <strong>{fromFloor}&Prime;</strong> from the floor.{" "}
        Drawers cannot extend above {DRAWER_MAX_HEIGHT_FROM_FLOOR}&Prime; from the floor.
        {overLimit && <span style={{ fontWeight: "600" }}> Position will be clamped when dragged.</span>}
      </div>

      {/* Per-drawer height inputs */}
      <div style={{ fontSize: "11px", fontWeight: "600", color: "#222", marginBottom: "6px" }}>
        Individual drawer heights ({total}&Prime; total):
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
        {comp.drawerHeights.map((dh, di) => (
          <label key={di} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#333" }}>
            <span style={{ minWidth: "60px" }}>Drawer {di + 1}</span>
            <input type="number" min={DRAWER_MIN_H} value={dh}
              onChange={e => handleDrawerHeightChange(comp.id, di, Number(e.target.value))}
              style={{ width: "65px", padding: "3px 6px", fontSize: "12px", border: "1px solid #ccc", borderRadius: "4px", color: "#111" }} />
            <span style={{ color: "#555" }}>in</span>
            {dh < DRAWER_MIN_H && <span style={{ color: "#b91c1c", fontSize: "10px" }}>min {DRAWER_MIN_H}&Prime;</span>}
          </label>
        ))}
      </div>

      {/* Add / Remove drawer buttons */}
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={() => handleAddDrawer(comp.id)}
          style={{ padding: "5px 12px", fontSize: "11px", fontWeight: "600", backgroundColor: "#fff", color: C_SELECT, border: `1px solid ${C_SELECT}`, borderRadius: "4px", cursor: "pointer" }}>
          + Add Drawer
        </button>
        {comp.drawerHeights.length > 1 && (
          <button onClick={() => handleRemoveDrawer(comp.id)}
            style={{ padding: "5px 12px", fontSize: "11px", fontWeight: "600", backgroundColor: "#fff", color: "#c0392b", border: "1px solid #c0392b", borderRadius: "4px", cursor: "pointer" }}>
            Remove Last
          </button>
        )}
      </div>
    </div>
  );
}
