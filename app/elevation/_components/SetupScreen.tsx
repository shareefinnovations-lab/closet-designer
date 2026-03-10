"use client";

import { useState } from "react";
import type { Config } from "../_lib/types";

export function SetupScreen({ onStart }: { onStart: (c: Config) => void }) {
  const [clientName,      setClientName]      = useState("");
  const [clientNum,       setClientNum]       = useState("");
  const [locationName,    setLocationName]    = useState("");
  const [wallWidthIn,     setWallWidthIn]     = useState(66);
  const [ceilingHeightIn, setCeilingHeightIn] = useState(101);
  const [closetDepthIn,   setClosetDepthIn]   = useState(25);
  const [leftReturnIn,    setLeftReturnIn]    = useState(0.5);
  const [rightReturnIn,   setRightReturnIn]   = useState(2.5);

  const canStart = wallWidthIn > 0 && ceilingHeightIn > 0 && closetDepthIn > 0;

  function handleStart() {
    if (!canStart) return;
    onStart({ clientName, clientNum, locationName, wallWidthIn, ceilingHeightIn, closetDepthIn, leftReturnIn, rightReturnIn });
  }

  const fieldRow: React.CSSProperties = {
    display: "flex", flexDirection: "column", gap: "4px",
  };
  const label: React.CSSProperties = {
    fontSize: "12px", fontWeight: "700", color: "#1a1a1a",
  };
  const input: React.CSSProperties = {
    padding: "8px 10px", fontSize: "14px", border: "1px solid #c8c4be",
    borderRadius: "6px", width: "100%", boxSizing: "border-box",
    color: "#111", backgroundColor: "#fff",
  };
  const section: React.CSSProperties = {
    backgroundColor: "#fff", border: "1px solid #e5e0d8", borderRadius: "10px",
    padding: "20px 24px", marginBottom: "20px",
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: "13px", fontWeight: "700", color: "#222",
    textTransform: "uppercase", letterSpacing: "0.6px",
    marginBottom: "16px", marginTop: 0,
  };
  const grid2: React.CSSProperties = {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px",
  };

  return (
    <div style={{ fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "60px 24px" }}>
      {/* Placeholder color — can only be set via CSS, not inline styles */}
      <style>{`.setup-input::placeholder { color: #999; }`}</style>
      <div style={{ width: "100%", maxWidth: "520px" }}>

        <h1 style={{ fontSize: "26px", fontWeight: "800", color: "#1a1a1a", marginBottom: "4px" }}>
          Closet Designer
        </h1>
        <p style={{ fontSize: "14px", color: "#888", marginTop: "0", marginBottom: "32px" }}>
          Reach-in closet configurator
        </p>

        {/* Client Information */}
        <div style={section}>
          <p style={sectionTitle}>Client Information</p>
          <div style={grid2}>
            <div style={fieldRow}>
              <label style={label}>Client Name</label>
              <input style={input} className="setup-input" type="text" placeholder="e.g. John Smith"
                value={clientName} onChange={e => setClientName(e.target.value)} />
            </div>
            <div style={fieldRow}>
              <label style={label}>Client #</label>
              <input style={input} className="setup-input" type="text" placeholder="e.g. 1042"
                value={clientNum} onChange={e => setClientNum(e.target.value)} />
            </div>
            <div style={{ ...fieldRow, gridColumn: "1 / -1" }}>
              <label style={label}>Location / Room Name</label>
              <input style={input} className="setup-input" type="text" placeholder="e.g. Master Bedroom, Walk-in"
                value={locationName} onChange={e => setLocationName(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Closet Dimensions */}
        <div style={section}>
          <p style={sectionTitle}>Closet Dimensions</p>
          <div style={grid2}>
            <div style={fieldRow}>
              <label style={label}>Wall Width (in) *</label>
              <input style={input} className="setup-input" type="number" min={12} value={wallWidthIn}
                onChange={e => setWallWidthIn(Number(e.target.value))} />
            </div>
            <div style={fieldRow}>
              <label style={label}>Ceiling Height (in) *</label>
              <input style={input} className="setup-input" type="number" min={48} value={ceilingHeightIn}
                onChange={e => setCeilingHeightIn(Number(e.target.value))} />
            </div>
            <div style={fieldRow}>
              <label style={label}>Closet Depth (in) *</label>
              <input style={input} className="setup-input" type="number" min={12} value={closetDepthIn}
                onChange={e => setClosetDepthIn(Number(e.target.value))} />
            </div>
          </div>
        </div>

        {/* Return Walls */}
        <div style={section}>
          <p style={sectionTitle}>Return Walls</p>
          <div style={grid2}>
            <div style={fieldRow}>
              <label style={label}>Left Return Wall — LRW (in)</label>
              <input style={input} className="setup-input" type="number" min={0} step={0.25} value={leftReturnIn}
                onChange={e => setLeftReturnIn(Number(e.target.value))} />
            </div>
            <div style={fieldRow}>
              <label style={label}>Right Return Wall — RRW (in)</label>
              <input style={input} className="setup-input" type="number" min={0} step={0.25} value={rightReturnIn}
                onChange={e => setRightReturnIn(Number(e.target.value))} />
            </div>
          </div>
        </div>

        <button
          onClick={handleStart}
          disabled={!canStart}
          style={{
            width: "100%", padding: "14px", fontSize: "15px", fontWeight: "700",
            backgroundColor: canStart ? "#1a1a1a" : "#c5c0b8", color: "#fff",
            border: "none", borderRadius: "8px", cursor: canStart ? "pointer" : "default",
            letterSpacing: "0.3px",
          }}
        >
          Start Designing →
        </button>
        <p style={{ fontSize: "12px", color: "#bbb", textAlign: "center", marginTop: "12px" }}>
          * Required fields
        </p>
      </div>
    </div>
  );
}
