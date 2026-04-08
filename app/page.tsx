"use client";
// app/page.tsx — Dashboard

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  listProjects, getActiveProjectId, setActiveProjectId,
  openProject, projectDisplayName, formatProjectDate,
  type Project,
} from "@/app/_lib/projects";
import { getClientByNumber, listClients, type Client } from "@/app/_lib/clients";

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_TYPES = [
  "Reach-In Closet",
  "Walk-In Closet",
  "Garage",
  "Wall Bed",
  "Office",
];

// ─── Minimal shapes for localStorage reads ────────────────────────────────────

interface InProgressInfo {
  clientName?:   string;
  clientNum?:    string;
  locationName?: string;
  projectType?:  string;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();

  // Modal state
  const [showModal,      setShowModal]      = useState(false);
  const [clientNum,      setClientNum]      = useState("");
  const [clientName,     setClientName]     = useState("");
  const [projectType,    setProjectType]    = useState("");
  const [matchedClient,  setMatchedClient]  = useState<Client | null>(null);
  const [clientEdited,   setClientEdited]   = useState(false); // true if user manually typed clientName

  // Dashboard state
  const [inProgress,     setInProgress]     = useState<InProgressInfo | null>(null);
  const [hasSetup,       setHasSetup]       = useState(false);
  const [activeProject,  setActiveProject]  = useState<Project | null>(null);
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [clientCount,    setClientCount]    = useState(0);

  useEffect(() => {
    const all = listProjects();
    setRecentProjects(all.slice(0, 3));

    const activeId = getActiveProjectId();
    if (activeId) {
      const found = all.find(p => p.id === activeId) ?? null;
      setActiveProject(found);
    }

    setClientCount(listClients().length);

    try {
      const rawLayout = localStorage.getItem("room-layout");
      const rawDesign = localStorage.getItem("closet-design");
      const rawWalkin = localStorage.getItem("walkin-design");
      const rawSetup  = localStorage.getItem("closet-setup");

      if (rawLayout) {
        const lay = JSON.parse(rawLayout);
        setInProgress({
          clientName:   lay.clientName,
          clientNum:    lay.clientNum,
          locationName: lay.locationName,
          projectType:  lay.projectType,
        });
        setHasSetup(true);
      } else if (rawWalkin) {
        const setupInfo = rawSetup ? JSON.parse(rawSetup) : {};
        setInProgress({ ...setupInfo, projectType: setupInfo.projectType ?? "Walk-In Closet" });
        setHasSetup(true);
      } else if (rawDesign) {
        const d = JSON.parse(rawDesign) as { config?: InProgressInfo };
        setInProgress(d.config ?? null);
        if (rawSetup) setHasSetup(true);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Client # lookup ──────────────────────────────────────────────────────────

  function handleClientNumChange(value: string) {
    setClientNum(value);
    setClientEdited(false);

    const found = getClientByNumber(value);
    setMatchedClient(found);
    if (found && !clientEdited) {
      setClientName(found.name);
    } else if (!found) {
      // Only clear auto-filled name — don't clear if user typed their own
      setClientName(prev => (matchedClient && prev === matchedClient.name) ? "" : prev);
    }
  }

  function handleClientNameChange(value: string) {
    setClientName(value);
    setClientEdited(true);
  }

  // ── Modal ────────────────────────────────────────────────────────────────────

  function openModal() {
    setClientNum("");
    setClientName("");
    setProjectType("");
    setMatchedClient(null);
    setClientEdited(false);
    setShowModal(true);
  }

  const canContinue = clientNum.trim().length > 0 && projectType.length > 0;

  function handleStartNewProject() {
    if (!canContinue) return;
    localStorage.setItem("closet-session", JSON.stringify({
      clientNum:   clientNum.trim(),
      clientName:  clientName.trim(),
      projectType,
    }));
    localStorage.removeItem("closet-design");
    localStorage.removeItem("closet-setup");
    localStorage.removeItem("room-layout");
    localStorage.removeItem("design-state");
    localStorage.removeItem("closet-presentation");
    localStorage.removeItem("walkin-design");
    setActiveProjectId(null);
    router.push("/setup");
  }

  // ── In-progress ──────────────────────────────────────────────────────────────

  function handleResume() {
    const rawLayout = (() => { try { return localStorage.getItem("room-layout"); } catch { return null; } })();
    if (rawLayout)  { router.push("/design"); return; }
    if (hasSetup)   { router.push("/room-layout"); return; }
    router.push("/setup");
  }

  function handleDiscard() {
    localStorage.removeItem("closet-design");
    localStorage.removeItem("closet-setup");
    localStorage.removeItem("closet-presentation");
    localStorage.removeItem("walkin-design");
    localStorage.removeItem("room-layout");
    localStorage.removeItem("design-state");
    setActiveProjectId(null);
    setInProgress(null);
    setHasSetup(false);
    setActiveProject(null);
  }

  function handleOpenProject(project: Project) {
    const route = openProject(project.id);
    router.push(route);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>

      {/* ── Start New Project Modal ─────────────────────────────────────────── */}
      {showModal && (
        <div style={S.overlay} onClick={() => setShowModal(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <h2 style={S.modalTitle}>Start New Project</h2>
              <button onClick={() => setShowModal(false)} style={S.closeBtn}>✕</button>
            </div>
            <p style={S.modalSubtitle}>Enter a client number to look up an existing client, or fill in manually.</p>

            {/* Client # — lookup field */}
            <div style={S.fieldGroup}>
              <label style={S.fieldLabel}>
                Client # <span style={{ color: "#b91c1c" }}>*</span>
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  placeholder="e.g. 1042"
                  value={clientNum}
                  onChange={e => handleClientNumChange(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && canContinue && handleStartNewProject()}
                  autoFocus
                  style={S.textInput}
                />
                {/* Match badge */}
                {matchedClient && (
                  <span style={{
                    position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)",
                    fontSize: "11px", fontWeight: "700", color: "#16a34a",
                    backgroundColor: "#dcfce7", borderRadius: "4px", padding: "2px 8px",
                    pointerEvents: "none",
                  }}>
                    ✓ Found
                  </span>
                )}
              </div>
              {matchedClient && (
                <div style={{ marginTop: "6px", fontSize: "12px", color: "#555",
                  backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0",
                  borderRadius: "6px", padding: "8px 12px", lineHeight: 1.5 }}>
                  <strong>{matchedClient.name}</strong>
                  {matchedClient.phone   && <span style={{ color: "#888" }}> · {matchedClient.phone}</span>}
                  {matchedClient.address && <span style={{ color: "#888" }}> · {matchedClient.address}</span>}
                </div>
              )}
              {!matchedClient && clientNum.trim().length > 0 && (
                <div style={{ marginTop: "5px", fontSize: "11px", color: "#aaa" }}>
                  No saved client found — continue to enter details manually.
                </div>
              )}
            </div>

            {/* Client Name — auto-filled or manual */}
            <div style={S.fieldGroup}>
              <label style={S.fieldLabel}>Client Name</label>
              <input
                type="text"
                placeholder="e.g. John Smith"
                value={clientName}
                onChange={e => handleClientNameChange(e.target.value)}
                style={{
                  ...S.textInput,
                  backgroundColor: (matchedClient && !clientEdited) ? "#f9fafb" : "#fff",
                  color: (matchedClient && !clientEdited) ? "#374151" : "#111",
                }}
              />
            </div>

            {/* Project Type */}
            <div style={S.fieldGroup}>
              <label style={S.fieldLabel}>
                Project Type <span style={{ color: "#b91c1c" }}>*</span>
              </label>
              <div style={S.typeGrid}>
                {PROJECT_TYPES.map(pt => {
                  const sel = projectType === pt;
                  return (
                    <button key={pt} onClick={() => setProjectType(pt)} style={{
                      ...S.typeCard,
                      borderColor:     sel ? "#1a1a1a" : "#e0dbd4",
                      backgroundColor: sel ? "#1a1a1a" : "#fff",
                      color:           sel ? "#fff"    : "#1a1a1a",
                      fontWeight:      sel ? "700"     : "500",
                    }}>
                      {pt}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={handleStartNewProject}
              disabled={!canContinue}
              style={{ ...S.continueBtn, opacity: canContinue ? 1 : 0.38,
                cursor: canContinue ? "pointer" : "default" }}
            >
              Continue to Project Setup →
            </button>
          </div>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header style={S.header}>
        <div style={S.headerInner}>
          <div style={S.brand}>
            <span style={S.brandName}>Closets by Design</span>
            <span style={S.brandSep}>/</span>
            <span style={S.brandApp}>Design Studio</span>
          </div>
          <div style={S.headerRight}>
            <span style={S.headerVersion}>Internal Tool</span>
          </div>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main style={S.main}>

        <div style={S.welcome}>
          <h1 style={S.welcomeTitle}>Dashboard</h1>
          <p style={S.welcomeSub}>Design, price, and present custom closet systems.</p>
        </div>

        {/* ── In-Progress Banner ──────────────────────────────────────────────── */}
        {inProgress && (
          <div style={S.inProgressBanner}>
            <div style={S.inProgressLeft}>
              <div style={S.inProgressDot} />
              <div>
                <div style={S.inProgressLabel}>
                  {activeProject
                    ? <>Project In Progress — <span style={{ color: "#22c55e" }}>{projectDisplayName(activeProject)}</span></>
                    : "Unsaved Project In Progress"
                  }
                </div>
                <div style={S.inProgressMeta}>
                  {inProgress.clientName  && <span>{inProgress.clientName}</span>}
                  {inProgress.clientNum   && <span style={{ color: "#888" }}> · #{inProgress.clientNum}</span>}
                  {inProgress.locationName && <span style={{ color: "#888" }}> · {inProgress.locationName}</span>}
                  {inProgress.projectType && <span style={{ color: "#888" }}> · {inProgress.projectType}</span>}
                  {!activeProject && (
                    <span style={{ color: "#e07020", marginLeft: "8px", fontSize: "11px", fontWeight: "700" }}>
                      · Not saved
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", flexShrink: 0 }}>
              <button onClick={handleResume}  style={S.resumeBtn}>Resume →</button>
              <button onClick={handleDiscard} style={S.discardBtn} title="Discard unsaved changes">Discard</button>
            </div>
          </div>
        )}

        {/* ── Primary Actions ──────────────────────────────────────────────────── */}
        <div style={S.sectionLabel}>Actions</div>
        <div style={S.cardGrid}>

          {/* Start New Project */}
          <button onClick={openModal} style={S.startCard}>
            <div style={S.startCardIcon}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 6v10M6 11h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={S.startCardTitle}>Start New Project</div>
              <div style={S.startCardSub}>Create a fresh closet design</div>
            </div>
          </button>

          {/* View Projects */}
          <button onClick={() => router.push("/projects")} style={S.actionCard}>
            <div style={S.actionCardIcon}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="4"  width="16" height="3" rx="1.5" fill="currentColor" opacity="0.9" />
                <rect x="2" y="9"  width="16" height="3" rx="1.5" fill="currentColor" opacity="0.65" />
                <rect x="2" y="14" width="10" height="3" rx="1.5" fill="currentColor" opacity="0.4" />
              </svg>
            </div>
            <div>
              <div style={S.actionCardTitle}>View Projects</div>
              <div style={S.actionCardSub}>
                {recentProjects.length > 0
                  ? `${recentProjects.length} saved project${recentProjects.length !== 1 ? "s" : ""}`
                  : "Browse and reopen saved projects"}
              </div>
            </div>
          </button>

          {/* Clients */}
          <button onClick={() => router.push("/clients")} style={S.actionCard}>
            <div style={S.actionCardIcon}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M3 17c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={S.actionCardTitle}>Clients</div>
              <div style={S.actionCardSub}>
                {clientCount > 0
                  ? `${clientCount} saved client${clientCount !== 1 ? "s" : ""}`
                  : "Add and manage client records"}
              </div>
            </div>
          </button>

        </div>

        {/* ── Recent Projects ───────────────────────────────────────────────────── */}
        {recentProjects.length > 0 && (
          <>
            <div style={{ ...S.sectionLabel, marginTop: "36px" }}>Recent Projects</div>
            <div style={S.recentList}>
              {recentProjects.map(p => (
                <div key={p.id} style={S.recentRow}>
                  <div style={S.recentLeft}>
                    <div style={S.recentName}>{projectDisplayName(p)}</div>
                    <div style={S.recentMeta}>
                      {p.projectType  && <span>{p.projectType}</span>}
                      {p.clientName   && <span style={{ color: "#aaa" }}> · {p.clientName}</span>}
                      {p.wallCount !== undefined && (
                        <span style={{ color: "#aaa" }}> · {p.wallCount} wall{p.wallCount !== 1 ? "s" : ""}</span>
                      )}
                      <span style={{ color: "#ccc" }}> · {formatProjectDate(p.updatedAt)}</span>
                    </div>
                  </div>
                  <button onClick={() => handleOpenProject(p)} style={S.openBtn}>
                    Open →
                  </button>
                </div>
              ))}
              <button onClick={() => router.push("/projects")} style={S.allProjectsLink}>
                View all projects →
              </button>
            </div>
          </>
        )}

        {/* ── Project Flow Steps ────────────────────────────────────────────────── */}
        <div style={{ ...S.sectionLabel, marginTop: "36px" }}>Project Flow</div>
        <div style={S.flowRow}>
          {[
            { step: "1", label: "Setup",        desc: "Client info & project type",  route: "/setup" },
            { step: "2", label: "Room Layout",  desc: "Define walls & openings",     route: "/room-layout" },
            { step: "3", label: "Design",       desc: "Configure the closet layout", route: "/design" },
            { step: "4", label: "Worksheet",    desc: "Internal pricing sheet",      route: "/worksheet" },
            { step: "5", label: "Presentation", desc: "Client-facing price sheet",   route: "/presentation" },
          ].map(({ step, label, desc, route }) => (
            <button key={step} onClick={() => router.push(route)} style={S.flowStep}>
              <span style={S.flowNum}>{step}</span>
              <span style={S.flowLabel}>{label}</span>
              <span style={S.flowDesc}>{desc}</span>
            </button>
          ))}
        </div>

      </main>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee" },

  header: {
    backgroundColor: "#1a1a1a", borderBottom: "1px solid #2e2e2e",
    position: "sticky", top: 0, zIndex: 50,
  },
  headerInner: {
    maxWidth: "1100px", margin: "0 auto", padding: "0 32px",
    height: "56px", display: "flex", alignItems: "center", justifyContent: "space-between",
  },
  brand: { display: "flex", alignItems: "center", gap: "10px" },
  brandName: { fontSize: "15px", fontWeight: "800", color: "#fff", letterSpacing: "0.2px" },
  brandSep:  { color: "#555", fontSize: "16px" },
  brandApp:  { fontSize: "14px", fontWeight: "400", color: "#aaa" },
  headerRight: { display: "flex", alignItems: "center", gap: "16px" },
  headerVersion: {
    fontSize: "11px", fontWeight: "600", color: "#555",
    textTransform: "uppercase", letterSpacing: "0.6px",
    backgroundColor: "#2a2a2a", padding: "3px 10px",
    borderRadius: "4px", border: "1px solid #333",
  },

  main: { maxWidth: "860px", margin: "0 auto", padding: "48px 32px 80px" },
  welcome: { marginBottom: "32px" },
  welcomeTitle: { fontSize: "28px", fontWeight: "800", color: "#1a1a1a", margin: 0, marginBottom: "6px" },
  welcomeSub: { fontSize: "14px", color: "#777", margin: 0 },

  inProgressBanner: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#fff", border: "1px solid #d6edda", borderLeft: "4px solid #22c55e",
    borderRadius: "8px", padding: "14px 20px", marginBottom: "32px", gap: "16px", flexWrap: "wrap",
  },
  inProgressLeft:  { display: "flex", alignItems: "center", gap: "12px" },
  inProgressDot:   { width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#22c55e", flexShrink: 0 },
  inProgressLabel: { fontSize: "13px", fontWeight: "700", color: "#1a1a1a", marginBottom: "2px" },
  inProgressMeta:  { fontSize: "12px", color: "#555" },
  resumeBtn: {
    padding: "8px 18px", fontSize: "13px", fontWeight: "700",
    backgroundColor: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer",
  },
  discardBtn: {
    padding: "8px 14px", fontSize: "12px", fontWeight: "500",
    backgroundColor: "transparent", color: "#999", border: "1px solid #ddd", borderRadius: "6px", cursor: "pointer",
  },

  sectionLabel: {
    fontSize: "11px", fontWeight: "700", color: "#aaa",
    textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "12px",
  },
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" },

  // Start New Project card (dark)
  startCard: {
    display: "flex", alignItems: "center", gap: "16px",
    padding: "22px 24px", backgroundColor: "#1a1a1a", color: "#fff",
    border: "none", borderRadius: "10px", cursor: "pointer", textAlign: "left",
  },
  startCardIcon: {
    width: "44px", height: "44px", backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  startCardTitle: { fontSize: "15px", fontWeight: "800", marginBottom: "3px" },
  startCardSub:   { fontSize: "12px", color: "rgba(255,255,255,0.6)", lineHeight: 1.4 },

  // Action cards (light)
  actionCard: {
    display: "flex", alignItems: "center", gap: "16px",
    padding: "22px 24px", backgroundColor: "#fff", color: "#1a1a1a",
    border: "1.5px solid #1a1a1a", borderRadius: "10px", cursor: "pointer", textAlign: "left",
  },
  actionCardIcon: {
    width: "44px", height: "44px", backgroundColor: "#f5f2ee",
    borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, color: "#555",
  },
  actionCardTitle: { fontSize: "15px", fontWeight: "800", marginBottom: "3px" },
  actionCardSub:   { fontSize: "12px", color: "#888", lineHeight: 1.4 },

  // Recent projects list
  recentList: {
    backgroundColor: "#fff", border: "1px solid #e8e4de",
    borderRadius: "10px", overflow: "hidden",
  },
  recentRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 20px", borderBottom: "1px solid #f0ece4", gap: "16px",
  },
  recentLeft:  { flex: 1, minWidth: 0 },
  recentName:  { fontSize: "14px", fontWeight: "700", color: "#1a1a1a", marginBottom: "3px" },
  recentMeta:  { fontSize: "11px", color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  openBtn: {
    padding: "6px 16px", fontSize: "12px", fontWeight: "700", cursor: "pointer",
    border: "1.5px solid #1a1a1a", borderRadius: "6px",
    backgroundColor: "transparent", color: "#1a1a1a", flexShrink: 0,
  },
  allProjectsLink: {
    display: "block", width: "100%", padding: "12px 20px",
    fontSize: "12px", fontWeight: "600", color: "#888", textAlign: "left",
    backgroundColor: "transparent", border: "none", cursor: "pointer",
  },

  // Flow steps
  flowRow: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px" },
  flowStep: {
    display: "flex", flexDirection: "column", alignItems: "flex-start",
    padding: "16px 18px", backgroundColor: "#fff",
    border: "1px solid #e8e4de", borderRadius: "8px", cursor: "pointer", textAlign: "left", gap: "4px",
  },
  flowNum: {
    fontSize: "11px", fontWeight: "700", color: "#fff",
    backgroundColor: "#1a1a1a", borderRadius: "4px", padding: "1px 7px", marginBottom: "4px",
  },
  flowLabel: { fontSize: "13px", fontWeight: "700", color: "#1a1a1a" },
  flowDesc:  { fontSize: "11px", color: "#999", lineHeight: 1.3 },

  // Modal
  overlay: {
    position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "24px",
  },
  modal: {
    backgroundColor: "#fff", borderRadius: "12px", padding: "32px",
    width: "100%", maxWidth: "480px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
    maxHeight: "90vh", overflowY: "auto",
  },
  modalHeader:   { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" },
  modalTitle:    { fontSize: "20px", fontWeight: "800", color: "#1a1a1a", margin: 0 },
  modalSubtitle: { fontSize: "13px", color: "#888", margin: "0 0 24px", lineHeight: 1.5 },
  closeBtn: {
    width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "16px", color: "#aaa", backgroundColor: "transparent",
    border: "none", borderRadius: "6px", cursor: "pointer", padding: 0,
  },
  fieldGroup: { marginBottom: "20px" },
  fieldLabel: {
    display: "block", fontSize: "12px", fontWeight: "700", color: "#1a1a1a",
    marginBottom: "8px", letterSpacing: "0.2px",
  },
  textInput: {
    width: "100%", padding: "10px 12px", fontSize: "14px",
    border: "1px solid #d0cac2", borderRadius: "7px",
    color: "#111", backgroundColor: "#fff", boxSizing: "border-box", outline: "none",
  },
  typeGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" },
  typeCard: {
    padding: "10px 8px", fontSize: "12px", border: "1.5px solid #e0dbd4",
    borderRadius: "7px", cursor: "pointer", textAlign: "center", lineHeight: 1.3,
  },
  continueBtn: {
    width: "100%", padding: "13px", fontSize: "14px", fontWeight: "700",
    backgroundColor: "#1a1a1a", color: "#fff", border: "none",
    borderRadius: "8px", letterSpacing: "0.2px", cursor: "pointer",
  },
};
