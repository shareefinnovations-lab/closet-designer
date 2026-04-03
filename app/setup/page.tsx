"use client";
// app/setup/page.tsx
//
// Standalone setup page. Collects client info + dimensions + remarks,
// saves to localStorage["closet-setup"], generates a starter layout
// from remarks, saves it to localStorage["closet-design"], then
// navigates to /elevation.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Config } from "@/app/elevation/_lib/types";

const STORAGE_KEY = "closet-setup";

export default function SetupPage() {
  const router = useRouter();

  const [clientName,      setClientName]      = useState("");
  const [clientNum,       setClientNum]       = useState("");
  const [locationName,    setLocationName]    = useState("");
  const [wallWidthIn,     setWallWidthIn]     = useState(66);
  const [ceilingHeightIn, setCeilingHeightIn] = useState(101);
  const [closetDepthIn,   setClosetDepthIn]   = useState(25);
  const [leftReturnIn,    setLeftReturnIn]    = useState(0.5);
  const [rightReturnIn,   setRightReturnIn]   = useState(2.5);
  const [remarks,         setRemarks]         = useState("");
  const [projectType,     setProjectType]     = useState("");

  // Pre-fill from saved setup (returning to edit) or from dashboard session
  useEffect(() => {
    // 1. Try restoring a previous full setup
    const rawSetup = localStorage.getItem(STORAGE_KEY);
    if (rawSetup) {
      try {
        const saved = JSON.parse(rawSetup) as Config;
        setClientName(saved.clientName           ?? "");
        setClientNum(saved.clientNum             ?? "");
        setLocationName(saved.locationName       ?? "");
        setWallWidthIn(saved.wallWidthIn         ?? 66);
        setCeilingHeightIn(saved.ceilingHeightIn ?? 101);
        setClosetDepthIn(saved.closetDepthIn     ?? 25);
        setLeftReturnIn(saved.leftReturnIn       ?? 0.5);
        setRightReturnIn(saved.rightReturnIn     ?? 2.5);
        setRemarks(saved.remarks                 ?? "");
        setProjectType(saved.projectType         ?? "");
        return;
      } catch { /* ignore corrupt data */ }
    }

    // 2. No full setup yet — check if dashboard wrote a session (clientNum + projectType)
    const rawSession = localStorage.getItem("closet-session");
    if (rawSession) {
      try {
        const session = JSON.parse(rawSession) as { clientNum?: string; projectType?: string };
        if (session.clientNum)   setClientNum(session.clientNum);
        if (session.projectType) setProjectType(session.projectType);
      } catch { /* ignore */ }
    }
  }, []);

  const canStart = wallWidthIn > 0 && ceilingHeightIn > 0 && closetDepthIn > 0;

  function handleStart() {
    if (!canStart) return;

    const config: Config = {
      clientName, clientNum, locationName,
      wallWidthIn, ceilingHeightIn, closetDepthIn,
      leftReturnIn, rightReturnIn, remarks,
      projectType: projectType || undefined,
    };
    // Clear the temporary dashboard session now that the full config is saved
    localStorage.removeItem("closet-session");

    // Save setup — Room Layout Builder reads from this key
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    // Clear any stale design state so the new flow starts fresh
    localStorage.removeItem("room-layout");
    localStorage.removeItem("design-state");

    router.push("/room-layout");
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const fieldRow: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "4px" };
  const label:    React.CSSProperties = { fontSize: "12px", fontWeight: "700", color: "#1a1a1a" };
  const input:    React.CSSProperties = {
    padding: "8px 10px", fontSize: "14px", border: "1px solid #c8c4be",
    borderRadius: "6px", width: "100%", boxSizing: "border-box",
    color: "#111", backgroundColor: "#fff",
  };
  const card: React.CSSProperties = {
    backgroundColor: "#fff", border: "1px solid #e5e0d8",
    borderRadius: "10px", padding: "20px 24px", marginBottom: "20px",
  };
  const cardTitle: React.CSSProperties = {
    fontSize: "13px", fontWeight: "700", color: "#222",
    textTransform: "uppercase", letterSpacing: "0.6px",
    marginBottom: "16px", marginTop: 0,
  };
  const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" };

  return (
    <div style={{ fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "60px 24px" }}>
      <style>{`.setup-input::placeholder { color: #999; }`}</style>
      <div style={{ width: "100%", maxWidth: "540px" }}>

        {/* Back link */}
        <button onClick={() => router.push("/")} style={{
          fontSize: "12px", fontWeight: "600", color: "#888", background: "none",
          border: "none", cursor: "pointer", padding: "0 0 20px", display: "flex", alignItems: "center", gap: "4px",
        }}>
          ← Dashboard
        </button>

        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "4px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: "800", color: "#1a1a1a", margin: 0 }}>
            Project Setup
          </h1>
          {projectType && (
            <span style={{ fontSize: "13px", fontWeight: "600", color: "#fff", backgroundColor: "#1a1a1a", borderRadius: "5px", padding: "2px 9px" }}>
              {projectType}
            </span>
          )}
        </div>
        <p style={{ fontSize: "14px", color: "#888", marginTop: "4px", marginBottom: "32px" }}>
          Enter client details and closet dimensions to generate a starter layout.
        </p>

        {/* ── Client Info ─────────────────────────────────────────────────── */}
        <div style={card}>
          <p style={cardTitle}>Client Information</p>
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

        {/* ── Dimensions ──────────────────────────────────────────────────── */}
        <div style={card}>
          <p style={cardTitle}>Closet Dimensions</p>
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

        {/* ── Return Walls ────────────────────────────────────────────────── */}
        <div style={card}>
          <p style={cardTitle}>Return Walls</p>
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

        {/* ── Remarks ─────────────────────────────────────────────────────── */}
        <div style={card}>
          <p style={cardTitle}>Remarks / Client Needs</p>
          <div style={fieldRow}>
            <label style={label}>What does the client need? (optional)</label>
            <textarea
              className="setup-input"
              placeholder="e.g. Lots of hanging space for dresses and suits. Some drawers for folded clothes. Shoe shelf on the right side."
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              rows={4}
              style={{
                ...input,
                resize: "vertical",
                lineHeight: "1.5",
                fontFamily: "sans-serif",
              }}
            />
            <span style={{ fontSize: "11px", color: "#aaa", marginTop: "4px" }}>
              Notes about the client's needs — used to set up the room layout.
            </span>
          </div>
        </div>

        {/* ── Submit ──────────────────────────────────────────────────────── */}
        <button
          onClick={handleStart}
          disabled={!canStart}
          style={{
            width: "100%", padding: "14px", fontSize: "15px", fontWeight: "700",
            backgroundColor: canStart ? "#1a1a1a" : "#c5c0b8",
            color: "#fff", border: "none", borderRadius: "8px",
            cursor: canStart ? "pointer" : "default",
            letterSpacing: "0.3px",
          }}
        >
          Continue to Room Layout →
        </button>
        <p style={{ fontSize: "12px", color: "#bbb", textAlign: "center", marginTop: "12px" }}>
          * Required fields
        </p>

      </div>
    </div>
  );
}
