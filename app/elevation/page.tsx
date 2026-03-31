"use client";
// app/elevation/page.tsx
//
// Closet Designer — Front View + Top View.
// Loads config from localStorage["closet-setup"]; redirects to /setup if missing.
// Restores and auto-saves design state via localStorage["closet-design"].

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  SCALE, MIN_WIDTH, LOCK_H_IN, DRAWER_MIN_DEPTH, DRAWER_MIN_H,
  DRAWER_MAX_HEIGHT_FROM_FLOOR, C_PANEL_BD, C_SELECT, PAD_LEFT,
} from "./_lib/constants";
import {
  rebalance, defaultSectionDepth, defaultPanelHeight,
  makeInitialSections, minDepthFor, compHeight, resolvePosition,
} from "./_lib/helpers";
import type { View, ComponentType, ClosetComponent, Section, Config } from "./_lib/types";

import { DesignerHeader } from "./_components/DesignerHeader";
import { FrontView }      from "./_components/FrontView";
import { TopView }        from "./_components/TopView";
import { SectionCards }   from "./_components/SectionCards";
import { SectionEditor }  from "./_components/SectionEditor";

// ─── Saved design shape ───────────────────────────────────────────────────────

interface SavedDesign {
  config:       Config;
  sections:     Section[];
  panelHeights: number[];
  ceilingH:     number;
}

// ─── Designer Page ────────────────────────────────────────────────────────────

export default function ElevationPage() {
  const router = useRouter();

  // ── Bootstrap from localStorage ──────────────────────────────────────────────
  // null  = not yet loaded (avoids flash)
  // false = loaded but missing → redirect
  const [config,       setConfig]       = useState<Config | null>(null);
  const [ready,        setReady]        = useState(false);   // true once localStorage is read

  // Design state — initialised after localStorage read
  const [sections,      setSections]      = useState<Section[]>([]);
  const [panelHeights,  setPanelHeights]  = useState<number[]>([]);
  const [ceilingH,      setCeilingH]      = useState(101);

  const nextId = useRef(1);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const rawSetup  = localStorage.getItem("closet-setup");
    const rawDesign = localStorage.getItem("closet-design");

    if (!rawSetup) {
      router.replace("/setup");
      return;
    }

    try {
      const cfg = JSON.parse(rawSetup) as Config;
      setConfig(cfg);

      if (rawDesign) {
        // Restore saved design state
        const saved = JSON.parse(rawDesign) as Partial<SavedDesign>;
        setSections(saved.sections     ?? makeInitialSections(cfg.wallWidthIn));
        setPanelHeights(saved.panelHeights ?? Array.from({ length: 4 }, () => defaultPanelHeight(cfg.ceilingHeightIn)));
        setCeilingH(saved.ceilingH     ?? cfg.ceilingHeightIn);
      } else {
        // No design yet — use defaults
        setSections(makeInitialSections(cfg.wallWidthIn));
        setPanelHeights(Array.from({ length: 4 }, () => defaultPanelHeight(cfg.ceilingHeightIn)));
        setCeilingH(cfg.ceilingHeightIn);
      }

      setReady(true);
    } catch {
      // Corrupt data — send back to setup
      router.replace("/setup");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save design state whenever sections / panelHeights / ceilingH change
  useEffect(() => {
    if (!ready || !config) return;
    const payload: SavedDesign = { config, sections, panelHeights, ceilingH };
    localStorage.setItem("closet-design", JSON.stringify(payload));
  }, [sections, panelHeights, ceilingH, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── View toggle ───────────────────────────────────────────────────────────────
  const [view, setView] = useState<View>("front");

  // ── Section selection ─────────────────────────────────────────────────────────
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // ── Drag state ────────────────────────────────────────────────────────────────
  const [drag, setDrag] = useState<{
    compId: number; secIdx: number; startClientY: number; startPosIn: number;
  } | null>(null);

  // ── Drag mouse handlers ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!drag) return;
    const d = drag;
    function onMove(e: MouseEvent) {
      updateComponentPosition(d.secIdx, d.compId, d.startPosIn + (e.clientY - d.startClientY) / SCALE);
    }
    function onUp() { setDrag(null); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [drag]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading / redirect guard ──────────────────────────────────────────────────
  if (!ready || !config) {
    return (
      <div style={{ fontFamily: "sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f5f2ee" }}>
        <p style={{ color: "#aaa", fontSize: "14px" }}>Loading…</p>
      </div>
    );
  }

  // ── Derived from config ───────────────────────────────────────────────────────
  const wallW        = config.wallWidthIn;
  const overallDepth = config.closetDepthIn;
  const leftReturn   = config.leftReturnIn;
  const rightReturn  = config.rightReturnIn;

  // ── Height helpers ────────────────────────────────────────────────────────────
  function clampPanel(h: number): number {
    return Math.min(Math.max(1, h), ceilingH);
  }
  function handlePanelHeightChange(index: number, raw: number) {
    if (raw < 1) return;
    setPanelHeights(prev => prev.map((h, i) => i === index ? Math.min(raw, ceilingH) : h));
  }
  function getSectionHeight(i: number): number {
    const left  = Math.min(panelHeights[i]     ?? ceilingH, ceilingH);
    const right = Math.min(panelHeights[i + 1] ?? ceilingH, ceilingH);
    return Math.min(left, right);
  }
  const ceilingHpx = ceilingH * SCALE;

  // ── Derived ───────────────────────────────────────────────────────────────────
  const selectedSection = selectedIndex !== null ? sections[selectedIndex] : null;

  // ── Navigation ────────────────────────────────────────────────────────────────
  function handleBackToSetup() {
    router.push("/setup");
  }

  function handleContinueToWorksheet() {
    // Design is already auto-saved; just navigate
    router.push("/worksheet");
  }

  // ── Section handlers ──────────────────────────────────────────────────────────

  function handleAddSection() {
    setSections(prev => rebalance([...prev, { widthIn: 0, depthIn: defaultSectionDepth(), components: [] }], wallW));
    setPanelHeights(prev => [...prev, defaultPanelHeight(ceilingH)]);
  }

  function handleRemoveSection(index: number) {
    setSections(prev => rebalance(prev.filter((_, i) => i !== index), wallW));
    setPanelHeights(prev => prev.filter((_, i) => i !== index));
    setSelectedIndex(prev => {
      if (prev === null || prev === index) return null;
      return prev > index ? prev - 1 : prev;
    });
  }

  function handleWidthChange(index: number, raw: number) {
    const maxForThis = wallW - MIN_WIDTH * (sections.length - 1);
    const value      = Math.max(MIN_WIDTH, Math.min(maxForThis, raw));
    const remaining  = wallW - value;
    const baseW      = Math.floor(remaining / (sections.length - 1));
    const extra      = remaining - baseW * (sections.length - 1);
    let otherIdx = 0;
    setSections(prev =>
      prev.map((s, i) => {
        if (i === index) return { ...s, widthIn: value };
        const w = baseW + (otherIdx < extra ? 1 : 0);
        otherIdx++;
        return { ...s, widthIn: w };
      })
    );
  }

  function handleDepthChange(index: number, raw: number) {
    const minD  = minDepthFor(sections[index].components);
    const value = Math.max(minD, Math.min(overallDepth, raw));
    setSections(prev => prev.map((s, i) => i === index ? { ...s, depthIn: value } : s));
  }

  function handleSectionClick(index: number) {
    setSelectedIndex(prev => prev === index ? null : index);
  }

  // ── Component handlers ────────────────────────────────────────────────────────

  function handleAddComponent(type: ComponentType) {
    if (selectedIndex === null) return;
    const id       = nextId.current++;
    const sectionH = getSectionHeight(selectedIndex);

    let comp: ClosetComponent;
    if (type === "DrawerStack") {
      const defaultHeights = [10, 10];
      const totalH         = defaultHeights.reduce((s, h) => s + h, 0);
      const positionIn     = Math.max(LOCK_H_IN, sectionH - LOCK_H_IN - totalH);
      comp = { id, type, positionIn, drawerHeights: defaultHeights };
    } else if (type === "Rod") {
      comp = { id, type, positionIn: LOCK_H_IN + 8, drawerHeights: [] };
    } else {
      comp = { id, type, positionIn: Math.round(sectionH / 2), drawerHeights: [] };
    }

    setSections(prev =>
      prev.map((s, i) => {
        if (i !== selectedIndex) return s;
        const newComponents = [...s.components, comp];
        const newDepth = type === "DrawerStack" ? Math.max(s.depthIn, DRAWER_MIN_DEPTH) : s.depthIn;
        return { ...s, components: newComponents, depthIn: newDepth };
      })
    );
  }

  function handleRemoveComponent(compId: number) {
    if (selectedIndex === null) return;
    setSections(prev =>
      prev.map((s, i) => {
        if (i !== selectedIndex) return s;
        const newComponents = s.components.filter(c => c.id !== compId);
        return { ...s, components: newComponents, depthIn: minDepthFor(newComponents) };
      })
    );
  }

  function updateComponentPosition(secIdx: number, compId: number, rawPosIn: number) {
    setSections(prev =>
      prev.map((s, si) => {
        if (si !== secIdx) return s;
        const comp = s.components.find(c => c.id === compId);
        if (!comp) return s;
        const newPos = resolvePosition(comp, getSectionHeight(si), rawPosIn, s.components);
        return { ...s, components: s.components.map(c => c.id === compId ? { ...c, positionIn: newPos } : c) };
      })
    );
  }

  // ── Drawer handlers ───────────────────────────────────────────────────────────

  function handleAddDrawer(compId: number) {
    if (selectedIndex === null) return;
    setSections(prev =>
      prev.map((s, si) => {
        if (si !== selectedIndex) return s;
        return { ...s, components: s.components.map(c =>
          c.id === compId && c.type === "DrawerStack"
            ? { ...c, drawerHeights: [...c.drawerHeights, 10] } : c
        )};
      })
    );
  }

  function handleRemoveDrawer(compId: number) {
    if (selectedIndex === null) return;
    setSections(prev =>
      prev.map((s, si) => {
        if (si !== selectedIndex) return s;
        return { ...s, components: s.components.map(c =>
          c.id === compId && c.type === "DrawerStack" && c.drawerHeights.length > 1
            ? { ...c, drawerHeights: c.drawerHeights.slice(0, -1) } : c
        )};
      })
    );
  }

  function handleDrawerHeightChange(compId: number, drawerIdx: number, raw: number) {
    if (selectedIndex === null) return;
    const newH = Math.max(DRAWER_MIN_H, Math.round(raw));
    setSections(prev =>
      prev.map((s, si) => {
        if (si !== selectedIndex) return s;
        return { ...s, components: s.components.map(c =>
          c.id === compId && c.type === "DrawerStack"
            ? { ...c, drawerHeights: c.drawerHeights.map((h, i) => i === drawerIdx ? newH : h) } : c
        )};
      })
    );
  }

  // ── Drag handlers ─────────────────────────────────────────────────────────────

  function handleStartDrag(secIdx: number, compId: number, clientY: number, positionIn: number) {
    setDrag({ compId, secIdx, startClientY: clientY, startPosIn: positionIn });
  }

  // ── Derived SVG values ────────────────────────────────────────────────────────

  const wallWpx = wallW * SCALE;
  const wx      = PAD_LEFT;

  const sectionStartXs: number[] = [];
  let cumX = wx;
  for (const s of sections) { sectionStartXs.push(cumX); cumX += s.widthIn * SCALE; }

  const totalWidthIn = sections.reduce((sum, s) => sum + s.widthIn, 0);
  const isValid      = totalWidthIn === wallW;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "sans-serif", padding: "40px", maxWidth: "700px", margin: "0 auto" }}>

      {/* ── Top nav ───────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "20px" }}>
        <button onClick={handleBackToSetup} style={{
          padding: "7px 16px", fontSize: "13px", fontWeight: "600",
          backgroundColor: "#fff", color: "#444",
          border: "1px solid #ccc", borderRadius: "7px", cursor: "pointer",
        }}>
          ← Back to Setup
        </button>
      </div>

      <DesignerHeader
        config={config}
        wallW={wallW}
        overallDepth={overallDepth}
        leftReturn={leftReturn}
        rightReturn={rightReturn}
      />

      {/* ── Remarks badge (if present) ────────────────────────────────────── */}
      {config.remarks && (
        <div style={{ fontSize: "12px", color: "#5a7a5a", backgroundColor: "#f0f7f0", border: "1px solid #c8e0c8", borderRadius: "6px", padding: "8px 12px", marginBottom: "20px" }}>
          <strong>Client notes:</strong> {config.remarks}
        </div>
      )}

      {/* ── Height Settings ───────────────────────────────────────────────── */}
      <div style={{ padding: "16px 18px", backgroundColor: "#f7f5f2", border: "1px solid #e0dbd4", borderRadius: "8px", marginBottom: "20px" }}>
        <div style={{ marginBottom: "14px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "12px", fontWeight: "700", color: "#333", minWidth: "130px" }}>Ceiling Height (in)</span>
            <input type="number" min={1} value={ceilingH}
              onChange={e => { const v = Number(e.target.value); if (v > 0) setCeilingH(v); }}
              style={{ width: "90px", padding: "5px 8px", fontSize: "14px", border: "1px solid #ccc", borderRadius: "4px", color: "#111" }} />
          </label>
        </div>
        <div style={{ fontSize: "12px", fontWeight: "700", color: "#333", marginBottom: "8px" }}>Panel Heights (in)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          {panelHeights.map((ph, i) => {
            const clamped = Math.min(ph, ceilingH);
            const space   = ceilingH - clamped;
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: "4px", backgroundColor: "#fff", border: "1px solid #ddd", borderRadius: "6px", padding: "8px 10px", minWidth: "100px" }}>
                <span style={{ fontSize: "11px", fontWeight: "600", color: C_PANEL_BD }}>Panel {i + 1}</span>
                <input type="number" min={1} value={ph}
                  onChange={e => handlePanelHeightChange(i, Number(e.target.value))}
                  style={{ width: "80px", padding: "4px 7px", fontSize: "13px", border: "1px solid #ccc", borderRadius: "4px", color: "#111" }} />
                {ph > ceilingH && <span style={{ fontSize: "10px", color: "#b91c1c" }}>Clamped to {ceilingH}&Prime;</span>}
                <span style={{ fontSize: "10px", color: "#2563eb" }}>{space}&Prime; above</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── View Toggle ───────────────────────────────────────────────────── */}
      <div style={{ display: "inline-flex", border: "1px solid #d0d0d0", borderRadius: "7px", overflow: "hidden", marginBottom: "24px" }}>
        {(["top", "front"] as View[]).map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{ padding: "8px 20px", fontSize: "13px", fontWeight: "600", border: "none", cursor: "pointer", backgroundColor: view === v ? "#2b2b2b" : "#fff", color: view === v ? "#fff" : "#555" }}>
            {v === "top" ? "Top View" : "Front View"}
          </button>
        ))}
      </div>

      {/* ── Section Editor ────────────────────────────────────────────────── */}
      {view === "front" && selectedSection && selectedIndex !== null && (
        <SectionEditor
          selectedIndex={selectedIndex}
          selectedSection={selectedSection}
          overallDepth={overallDepth}
          getSectionHeight={getSectionHeight}
          handleDepthChange={handleDepthChange}
          handleRemoveComponent={handleRemoveComponent}
          updateComponentPosition={updateComponentPosition}
          handleAddDrawer={handleAddDrawer}
          handleRemoveDrawer={handleRemoveDrawer}
          handleDrawerHeightChange={handleDrawerHeightChange}
          handleAddComponent={handleAddComponent}
          onClose={() => setSelectedIndex(null)}
        />
      )}

      {/* ── Section Cards ─────────────────────────────────────────────────── */}
      <SectionCards
        sections={sections}
        selectedIndex={selectedIndex}
        view={view}
        wallW={wallW}
        handleWidthChange={handleWidthChange}
        handleRemoveSection={handleRemoveSection}
        handleAddSection={handleAddSection}
      />

      <p style={{ fontSize: "13px", color: "#444", marginTop: "0", marginBottom: "20px" }}>
        {sections.length} section{sections.length !== 1 ? "s" : ""}&nbsp;&middot;&nbsp;
        {sections.map((s, i) => <span key={i}>{i > 0 ? " + " : ""}{s.widthIn}&Prime;</span>)} ={" "}
        <strong style={{ color: isValid ? "#2a7a4f" : "#c0392b" }}>{totalWidthIn}&Prime;</strong>
        {view === "front" && <span style={{ color: "#555" }}>&nbsp;&middot;&nbsp; Click a section to configure</span>}
      </p>

      {/* ── Front View ────────────────────────────────────────────────────── */}
      {view === "front" && (
        <FrontView
          sections={sections}
          sectionStartXs={sectionStartXs}
          panelHeights={panelHeights}
          selectedIndex={selectedIndex}
          drag={drag}
          ceilingH={ceilingH}
          getSectionHeight={getSectionHeight}
          clampPanel={clampPanel}
          handleSectionClick={handleSectionClick}
          handleStartDrag={handleStartDrag}
          svgRef={svgRef}
        />
      )}

      {/* ── Top View ──────────────────────────────────────────────────────── */}
      {view === "top" && (
        <TopView
          sections={sections}
          sectionStartXs={sectionStartXs}
          wx={wx}
          wallWpx={wallWpx}
          overallDepth={overallDepth}
          leftReturn={leftReturn}
          rightReturn={rightReturn}
        />
      )}

      {/* ── Continue to Worksheet ─────────────────────────────────────────── */}
      <div style={{ marginTop: "32px", display: "flex", justifyContent: "flex-end" }}>
        <button onClick={handleContinueToWorksheet} style={{
          padding: "12px 28px", fontSize: "14px", fontWeight: "700",
          backgroundColor: "#1a1a1a", color: "#fff",
          border: "none", borderRadius: "8px", cursor: "pointer",
          letterSpacing: "0.3px",
        }}>
          Continue to Worksheet →
        </button>
      </div>

    </div>
  );
}
