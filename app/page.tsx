"use client";
// app/page.tsx
//
// Main dashboard — entry point of the app.
// Shows action cards, detects in-progress work, and opens the
// Start Project flow (client number + project type selection).

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_TYPES = [
  "Reach-In Closet",
  "Walk-In Closet",
  "Garage",
  "Wall Bed",
  "Office",
];

// ─── Minimal shapes for localStorage reads ────────────────────────────────────

interface InProgressDesign {
  config?: {
    clientName?: string;
    clientNum?: string;
    locationName?: string;
    projectType?: string;
  };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();

  const [showModal,     setShowModal]     = useState(false);
  const [clientNum,     setClientNum]     = useState("");
  const [projectType,   setProjectType]   = useState("");
  const [inProgress,    setInProgress]    = useState<InProgressDesign | null>(null);
  const [hasSetup,      setHasSetup]      = useState(false);

  // Detect any in-progress work saved in localStorage
  useEffect(() => {
    try {
      const rawLayout  = localStorage.getItem("room-layout");
      const rawDesign  = localStorage.getItem("closet-design");
      const rawWalkin  = localStorage.getItem("walkin-design");
      const rawSetup   = localStorage.getItem("closet-setup");
      // Prefer new flow (room-layout) → then legacy walk-in → then reach-in
      if (rawLayout) {
        const lay = JSON.parse(rawLayout);
        setInProgress({ config: {
          clientName: lay.clientName, clientNum: lay.clientNum,
          locationName: lay.locationName, projectType: lay.projectType,
        }});
        setHasSetup(true);
      } else if (rawWalkin) {
        const setupInfo = rawSetup ? JSON.parse(rawSetup) : {};
        setInProgress({ config: { ...setupInfo, projectType: setupInfo.projectType ?? "Walk-In Closet" } });
        setHasSetup(true);
      } else if (rawDesign) {
        setInProgress(JSON.parse(rawDesign) as InProgressDesign);
        if (rawSetup) setHasSetup(true);
      }
    } catch { /* ignore corrupt data */ }
  }, []);

  const canContinue = clientNum.trim().length > 0 && projectType.length > 0;

  function openModal() {
    setClientNum("");
    setProjectType("");
    setShowModal(true);
  }

  function handleContinue() {
    if (!canContinue) return;
    // Write the session so setup can pre-fill client number and project type
    localStorage.setItem("closet-session", JSON.stringify({
      clientNum:   clientNum.trim(),
      projectType,
    }));
    // Clear any previous design so setup starts fresh
    localStorage.removeItem("closet-design");
    localStorage.removeItem("closet-setup");
    localStorage.removeItem("room-layout");
    localStorage.removeItem("design-state");
    localStorage.removeItem("closet-presentation");
    localStorage.removeItem("walkin-design");
    router.push("/setup");
  }

  function handleResume() {
    // Prefer the new design flow
    const rawLayout = (() => { try { return localStorage.getItem("room-layout"); } catch { return null; } })();
    if (rawLayout)  { router.push("/design"); return; }
    if (hasSetup)   { router.push("/room-layout"); return; }
    router.push("/setup");
  }

  function handleClearProject() {
    localStorage.removeItem("closet-design");
    localStorage.removeItem("closet-setup");
    localStorage.removeItem("closet-presentation");
    localStorage.removeItem("walkin-design");
    localStorage.removeItem("room-layout");
    localStorage.removeItem("design-state");
    setInProgress(null);
    setHasSetup(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>

      {/* ── Modal overlay ──────────────────────────────────────────────────── */}
      {showModal && (
        <div style={S.overlay} onClick={() => setShowModal(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>

            <div style={S.modalHeader}>
              <h2 style={S.modalTitle}>Start New Project</h2>
              <button onClick={() => setShowModal(false)} style={S.closeBtn} aria-label="Close">✕</button>
            </div>
            <p style={S.modalSubtitle}>Enter a client number and choose the project type to begin.</p>

            {/* Client Number */}
            <div style={S.fieldGroup}>
              <label style={S.fieldLabel}>Client Number <span style={{ color: "#b91c1c" }}>*</span></label>
              <input
                type="text"
                placeholder="e.g. 1042"
                value={clientNum}
                onChange={e => setClientNum(e.target.value)}
                onKeyDown={e => e.key === "Enter" && projectType && handleContinue()}
                autoFocus
                style={S.textInput}
              />
            </div>

            {/* Project Type */}
            <div style={S.fieldGroup}>
              <label style={S.fieldLabel}>Project Type <span style={{ color: "#b91c1c" }}>*</span></label>
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

            {/* Continue button */}
            <button
              onClick={handleContinue}
              disabled={!canContinue}
              style={{
                ...S.continueBtn,
                opacity: canContinue ? 1 : 0.38,
                cursor:  canContinue ? "pointer" : "default",
              }}
            >
              Continue to Project Setup →
            </button>

          </div>
        </div>
      )}

      {/* ── App Header ─────────────────────────────────────────────────────── */}
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

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main style={S.main}>

        {/* Welcome */}
        <div style={S.welcome}>
          <h1 style={S.welcomeTitle}>Dashboard</h1>
          <p style={S.welcomeSub}>Design, price, and present custom closet systems.</p>
        </div>

        {/* ── In-Progress Banner ─────────────────────────────────────────── */}
        {inProgress && (
          <div style={S.inProgressBanner}>
            <div style={S.inProgressLeft}>
              <div style={S.inProgressDot} />
              <div>
                <div style={S.inProgressLabel}>Project In Progress</div>
                <div style={S.inProgressMeta}>
                  {inProgress.config?.clientName && (
                    <span>{inProgress.config.clientName}</span>
                  )}
                  {inProgress.config?.clientNum && (
                    <span style={{ color: "#888" }}> · #{inProgress.config.clientNum}</span>
                  )}
                  {inProgress.config?.locationName && (
                    <span style={{ color: "#888" }}> · {inProgress.config.locationName}</span>
                  )}
                  {inProgress.config?.projectType && (
                    <span style={{ color: "#888" }}> · {inProgress.config.projectType}</span>
                  )}
                  {!inProgress.config?.clientName && !inProgress.config?.clientNum && (
                    <span style={{ color: "#888" }}>Unsaved project</span>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", flexShrink: 0 }}>
              <button onClick={handleResume} style={S.resumeBtn}>Resume Project →</button>
              <button onClick={handleClearProject} style={S.discardBtn} title="Discard this project">Discard</button>
            </div>
          </div>
        )}

        {/* ── Action Cards ───────────────────────────────────────────────── */}
        <div style={S.sectionLabel}>Actions</div>
        <div style={S.cardGrid}>

          {/* Start Project — primary action */}
          <button onClick={openModal} style={S.startCard}>
            <div style={S.startCardIcon}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 6v10M6 11h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={S.startCardTitle}>Start Project</div>
              <div style={S.startCardSub}>Create a new closet design for a client</div>
            </div>
          </button>

          {/* View Projects — placeholder */}
          <div style={S.placeholderCard}>
            <div style={S.placeholderTitle}>View Projects</div>
            <div style={S.placeholderSub}>Browse and resume existing projects</div>
            <div style={S.badge}>Coming Soon</div>
          </div>

          {/* View Clients — placeholder */}
          <div style={S.placeholderCard}>
            <div style={S.placeholderTitle}>View Clients</div>
            <div style={S.placeholderSub}>Search and manage client records</div>
            <div style={S.badge}>Coming Soon</div>
          </div>

        </div>

        {/* ── Project Flow Steps ─────────────────────────────────────────── */}
        <div style={{ ...S.sectionLabel, marginTop: "36px" }}>Project Flow</div>
        <div style={S.flowRow}>
          {[
            { step: "1", label: "Setup",        desc: "Client info & dimensions",   route: "/setup" },
            { step: "2", label: "Room Layout",  desc: "Define walls & openings",    route: "/room-layout" },
            { step: "3", label: "Design",       desc: "Configure the closet layout", route: "/design" },
            { step: "4", label: "Worksheet",    desc: "Internal pricing sheet",     route: "/worksheet" },
            { step: "5", label: "Presentation", desc: "Client-facing price sheet",  route: "/presentation" },
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
  // Page shell
  page: {
    fontFamily: "sans-serif",
    minHeight:  "100vh",
    backgroundColor: "#f5f2ee",
  },

  // Header
  header: {
    backgroundColor: "#1a1a1a",
    borderBottom:    "1px solid #2e2e2e",
    position:        "sticky",
    top:             0,
    zIndex:          50,
  },
  headerInner: {
    maxWidth:       "1100px",
    margin:         "0 auto",
    padding:        "0 32px",
    height:         "56px",
    display:        "flex",
    alignItems:     "center",
    justifyContent: "space-between",
  },
  brand: {
    display:    "flex",
    alignItems: "center",
    gap:        "10px",
  },
  brandName: {
    fontSize:   "15px",
    fontWeight: "800",
    color:      "#fff",
    letterSpacing: "0.2px",
  },
  brandSep: {
    color:    "#555",
    fontSize: "16px",
  },
  brandApp: {
    fontSize:   "14px",
    fontWeight: "400",
    color:      "#aaa",
  },
  headerRight: {
    display:    "flex",
    alignItems: "center",
    gap:        "16px",
  },
  headerVersion: {
    fontSize:        "11px",
    fontWeight:      "600",
    color:           "#555",
    textTransform:   "uppercase",
    letterSpacing:   "0.6px",
    backgroundColor: "#2a2a2a",
    padding:         "3px 10px",
    borderRadius:    "4px",
    border:          "1px solid #333",
  },

  // Main
  main: {
    maxWidth: "860px",
    margin:   "0 auto",
    padding:  "48px 32px 80px",
  },
  welcome: {
    marginBottom: "32px",
  },
  welcomeTitle: {
    fontSize:     "28px",
    fontWeight:   "800",
    color:        "#1a1a1a",
    margin:       0,
    marginBottom: "6px",
  },
  welcomeSub: {
    fontSize: "14px",
    color:    "#777",
    margin:   0,
  },

  // In-progress banner
  inProgressBanner: {
    display:         "flex",
    alignItems:      "center",
    justifyContent:  "space-between",
    backgroundColor: "#fff",
    border:          "1px solid #d6edda",
    borderLeft:      "4px solid #22c55e",
    borderRadius:    "8px",
    padding:         "14px 20px",
    marginBottom:    "32px",
    gap:             "16px",
    flexWrap:        "wrap",
  },
  inProgressLeft: {
    display:    "flex",
    alignItems: "center",
    gap:        "12px",
  },
  inProgressDot: {
    width:           "10px",
    height:          "10px",
    borderRadius:    "50%",
    backgroundColor: "#22c55e",
    flexShrink:      0,
  },
  inProgressLabel: {
    fontSize:   "13px",
    fontWeight: "700",
    color:      "#1a1a1a",
    marginBottom: "2px",
  },
  inProgressMeta: {
    fontSize: "12px",
    color:    "#555",
  },
  resumeBtn: {
    padding:         "8px 18px",
    fontSize:        "13px",
    fontWeight:      "700",
    backgroundColor: "#1a1a1a",
    color:           "#fff",
    border:          "none",
    borderRadius:    "6px",
    cursor:          "pointer",
  },
  discardBtn: {
    padding:         "8px 14px",
    fontSize:        "12px",
    fontWeight:      "500",
    backgroundColor: "transparent",
    color:           "#999",
    border:          "1px solid #ddd",
    borderRadius:    "6px",
    cursor:          "pointer",
  },

  // Section label
  sectionLabel: {
    fontSize:      "11px",
    fontWeight:    "700",
    color:         "#aaa",
    textTransform: "uppercase",
    letterSpacing: "0.8px",
    marginBottom:  "12px",
  },

  // Card grid
  cardGrid: {
    display:             "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap:                 "14px",
  },

  // Start Project card (primary)
  startCard: {
    display:         "flex",
    alignItems:      "center",
    gap:             "16px",
    padding:         "22px 24px",
    backgroundColor: "#1a1a1a",
    color:           "#fff",
    border:          "none",
    borderRadius:    "10px",
    cursor:          "pointer",
    textAlign:       "left",
    transition:      "transform 0.1s ease, box-shadow 0.1s ease",
  },
  startCardIcon: {
    width:           "44px",
    height:          "44px",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius:    "10px",
    display:         "flex",
    alignItems:      "center",
    justifyContent:  "center",
    flexShrink:      0,
  },
  startCardTitle: {
    fontSize:     "15px",
    fontWeight:   "800",
    marginBottom: "3px",
  },
  startCardSub: {
    fontSize:   "12px",
    color:      "rgba(255,255,255,0.6)",
    lineHeight: 1.4,
  },

  // Placeholder cards (coming soon)
  placeholderCard: {
    padding:         "22px 24px",
    backgroundColor: "#fff",
    border:          "1px solid #e8e4de",
    borderRadius:    "10px",
    opacity:         0.7,
  },
  placeholderTitle: {
    fontSize:     "14px",
    fontWeight:   "700",
    color:        "#555",
    marginBottom: "4px",
  },
  placeholderSub: {
    fontSize:     "12px",
    color:        "#aaa",
    lineHeight:   1.4,
    marginBottom: "12px",
  },
  badge: {
    display:         "inline-block",
    fontSize:        "10px",
    fontWeight:      "700",
    color:           "#aaa",
    border:          "1px solid #ddd",
    borderRadius:    "4px",
    padding:         "2px 8px",
    textTransform:   "uppercase",
    letterSpacing:   "0.5px",
  },

  // Flow steps
  flowRow: {
    display:             "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap:                 "10px",
  },
  flowStep: {
    display:         "flex",
    flexDirection:   "column",
    alignItems:      "flex-start",
    padding:         "16px 18px",
    backgroundColor: "#fff",
    border:          "1px solid #e8e4de",
    borderRadius:    "8px",
    cursor:          "pointer",
    textAlign:       "left",
    gap:             "4px",
  },
  flowNum: {
    fontSize:        "11px",
    fontWeight:      "700",
    color:           "#fff",
    backgroundColor: "#1a1a1a",
    borderRadius:    "4px",
    padding:         "1px 7px",
    marginBottom:    "4px",
  },
  flowLabel: {
    fontSize:   "13px",
    fontWeight: "700",
    color:      "#1a1a1a",
  },
  flowDesc: {
    fontSize:   "11px",
    color:      "#999",
    lineHeight: 1.3,
  },

  // ── Modal ──────────────────────────────────────────────────────────────────
  overlay: {
    position:        "fixed",
    inset:           0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display:         "flex",
    alignItems:      "center",
    justifyContent:  "center",
    zIndex:          100,
    padding:         "24px",
  },
  modal: {
    backgroundColor: "#fff",
    borderRadius:    "12px",
    padding:         "32px",
    width:           "100%",
    maxWidth:        "480px",
    boxShadow:       "0 20px 60px rgba(0,0,0,0.25)",
  },
  modalHeader: {
    display:        "flex",
    justifyContent: "space-between",
    alignItems:     "center",
    marginBottom:   "6px",
  },
  modalTitle: {
    fontSize:   "20px",
    fontWeight: "800",
    color:      "#1a1a1a",
    margin:     0,
  },
  modalSubtitle: {
    fontSize:     "13px",
    color:        "#888",
    margin:       "0 0 24px",
    lineHeight:   1.5,
  },
  closeBtn: {
    width:           "32px",
    height:          "32px",
    display:         "flex",
    alignItems:      "center",
    justifyContent:  "center",
    fontSize:        "16px",
    color:           "#aaa",
    backgroundColor: "transparent",
    border:          "none",
    borderRadius:    "6px",
    cursor:          "pointer",
    padding:         0,
  },

  // Form fields
  fieldGroup: {
    marginBottom: "20px",
  },
  fieldLabel: {
    display:      "block",
    fontSize:     "12px",
    fontWeight:   "700",
    color:        "#1a1a1a",
    marginBottom: "8px",
    letterSpacing: "0.2px",
  },
  textInput: {
    width:           "100%",
    padding:         "10px 12px",
    fontSize:        "14px",
    border:          "1px solid #d0cac2",
    borderRadius:    "7px",
    color:           "#111",
    backgroundColor: "#fff",
    boxSizing:       "border-box",
    outline:         "none",
  },
  typeGrid: {
    display:             "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap:                 "8px",
  },
  typeCard: {
    padding:      "10px 8px",
    fontSize:     "12px",
    border:       "1.5px solid #e0dbd4",
    borderRadius: "7px",
    cursor:       "pointer",
    textAlign:    "center",
    lineHeight:   1.3,
    transition:   "all 0.1s ease",
  },
  continueBtn: {
    width:           "100%",
    padding:         "13px",
    fontSize:        "14px",
    fontWeight:      "700",
    backgroundColor: "#1a1a1a",
    color:           "#fff",
    border:          "none",
    borderRadius:    "8px",
    letterSpacing:   "0.2px",
  },
};
