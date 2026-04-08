"use client";
// app/setup/page.tsx
//
// Project Setup — collects client/project info only.
// Room geometry (dimensions, segments) is built in Room Layout.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getActiveProjectId, saveCurrentProject } from "@/app/_lib/projects";

const STORAGE_KEY = "closet-setup";

const PROJECT_TYPES = [
  "Reach-In Closet",
  "Walk-In Closet",
  "Garage",
  "Wall Bed",
  "Office",
];

export default function SetupPage() {
  const router = useRouter();

  const [clientName,   setClientName]   = useState("");
  const [clientNum,    setClientNum]    = useState("");
  const [locationName, setLocationName] = useState("");
  const [projectType,  setProjectType]  = useState("");
  const [remarks,      setRemarks]      = useState("");

  // Pre-fill from saved setup or from dashboard session
  useEffect(() => {
    const rawSetup = localStorage.getItem(STORAGE_KEY);
    if (rawSetup) {
      try {
        const saved = JSON.parse(rawSetup);
        setClientName(saved.clientName    ?? "");
        setClientNum(saved.clientNum      ?? "");
        setLocationName(saved.locationName ?? "");
        setProjectType(saved.projectType  ?? "");
        setRemarks(saved.remarks          ?? "");
        return;
      } catch { /* ignore corrupt data */ }
    }

    // No full setup — check for dashboard session (clientNum + clientName + projectType)
    const rawSession = localStorage.getItem("closet-session");
    if (rawSession) {
      try {
        const session = JSON.parse(rawSession) as { clientNum?: string; clientName?: string; projectType?: string };
        if (session.clientNum)   setClientNum(session.clientNum);
        if (session.clientName)  setClientName(session.clientName);
        if (session.projectType) setProjectType(session.projectType);
      } catch { /* ignore */ }
    }
  }, []);

  function handleContinue() {
    const config = { clientName, clientNum, locationName, projectType: projectType || undefined, remarks };
    localStorage.removeItem("closet-session");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    // Clear stale geometry so Room Layout starts fresh
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
    <div style={{ fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee",
      display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "60px 24px" }}>
      <style>{`.setup-input::placeholder { color: #999; }`}</style>
      <div style={{ width: "100%", maxWidth: "540px" }}>

        {/* Back link + Save */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "20px" }}>
          <button onClick={() => router.push("/")} style={{
            fontSize: "12px", fontWeight: "600", color: "#888", background: "none",
            border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px",
          }}>
            ← Dashboard
          </button>
          <button onClick={() => {
            const config = { clientName, clientNum, locationName, projectType: projectType || undefined, remarks };
            localStorage.setItem("closet-setup", JSON.stringify(config));
            saveCurrentProject(getActiveProjectId());
          }} style={{
            fontSize: "12px", fontWeight: "700", color: "#fff", backgroundColor: "#3a5a3a",
            border: "none", borderRadius: "6px", cursor: "pointer", padding: "6px 16px",
          }}>
            Save
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "4px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: "800", color: "#1a1a1a", margin: 0 }}>
            Project Setup
          </h1>
          {projectType && (
            <span style={{ fontSize: "13px", fontWeight: "600", color: "#fff",
              backgroundColor: "#1a1a1a", borderRadius: "5px", padding: "2px 9px" }}>
              {projectType}
            </span>
          )}
        </div>
        <p style={{ fontSize: "14px", color: "#888", marginTop: "4px", marginBottom: "32px" }}>
          Enter client and project details. You&apos;ll set room dimensions in the next step.
        </p>

        {/* ── Client Information ───────────────────────────────────────────── */}
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
              <input style={input} className="setup-input" type="text"
                placeholder="e.g. Master Bedroom, Walk-in"
                value={locationName} onChange={e => setLocationName(e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Project Type ─────────────────────────────────────────────────── */}
        <div style={card}>
          <p style={cardTitle}>Project Type</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {PROJECT_TYPES.map(t => (
              <button key={t} onClick={() => setProjectType(projectType === t ? "" : t)}
                style={{
                  padding: "7px 16px", fontSize: "13px", fontWeight: "600",
                  borderRadius: "20px", border: "1.5px solid",
                  backgroundColor: projectType === t ? "#1a1a1a" : "#fff",
                  borderColor:     projectType === t ? "#1a1a1a" : "#c8c4be",
                  color:           projectType === t ? "#fff" : "#444",
                  cursor: "pointer",
                }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* ── Remarks ─────────────────────────────────────────────────────── */}
        <div style={card}>
          <p style={cardTitle}>Remarks / Client Needs</p>
          <div style={fieldRow}>
            <label style={label}>Notes about the client&apos;s needs (optional)</label>
            <textarea
              className="setup-input"
              placeholder="e.g. Lots of hanging space for dresses and suits. Some drawers for folded clothes."
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              rows={4}
              style={{ ...input, resize: "vertical", lineHeight: "1.5", fontFamily: "sans-serif" }}
            />
          </div>
        </div>

        {/* ── Submit ──────────────────────────────────────────────────────── */}
        <button
          onClick={handleContinue}
          style={{
            width: "100%", padding: "14px", fontSize: "15px", fontWeight: "700",
            backgroundColor: "#1a1a1a", color: "#fff", border: "none",
            borderRadius: "8px", cursor: "pointer", letterSpacing: "0.3px",
          }}
        >
          Continue to Room Layout →
        </button>

      </div>
    </div>
  );
}
