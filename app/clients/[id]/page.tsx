"use client";
// app/clients/[id]/page.tsx — Client detail page
//
// Shows:
//  1. Client profile (name, #, address, phone, email) with inline edit
//  2. All projects linked to this client's client number
//  3. Open / Rename / Duplicate / Delete per project
//  4. Multi-select → Generate Combined Quote (printable modal)
//  5. "New Project for this Client" → pre-fills setup and navigates to /setup

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { getClient, updateClient, type Client } from "@/app/_lib/clients";
import {
  listProjectsByClientNum, openProject, deleteProject,
  renameProject, duplicateProject, setActiveProjectId,
  formatProjectDate, type Project,
} from "@/app/_lib/projects";
import {
  computePresentationPricing,
  type MaterialTier, type MaterialOption, type BackingOption,
  type DecoOption, type AccessoryKey,
} from "@/src/lib/presentation-pricing";
import { runToPricingSections, runToPanelHeights, type StoredRun } from "@/src/lib/wall-pricing";

// ─── Pricing helpers ──────────────────────────────────────────────────────────

/**
 * Per-wall upgrade selections — mirrors the WallSel interface in presentation/page.tsx.
 * Defined here so we can parse snapshot.presentation without importing from a page component.
 */
interface WallSel {
  tier:          MaterialTier;
  material:      MaterialOption;
  backing:       BackingOption;
  deco:          DecoOption;
  accessoryQtys: Partial<Record<AccessoryKey, number>>;
}

interface PresentationSave {
  v:               2;
  wallSelections:  Record<string, WallSel>;
  selectedWallIds: string[];
}

interface LayoutSnap {
  closetDepthIn:   number;
  ceilingHeightIn: number;
  systemHeightIn:  number;
}

interface DesignSnap {
  v:    2;
  runs: StoredRun[];
}

/**
 * Compute the finalTotal for a saved project by re-running the presentation
 * pricing engine against the project's stored snapshots.
 *
 * Returns null if:
 *  - any required snapshot is missing
 *  - the presentation has no selected walls or no wallSelections saved
 *  - the computed total is 0 (pricing not yet configured)
 */
function computeProjectTotal(p: Project): number | null {
  try {
    const { roomLayout: rawLayout, designState: rawDesign, presentation: rawPres } = p.snapshot;
    if (!rawLayout || !rawDesign || !rawPres) return null;

    const layout = JSON.parse(rawLayout)  as LayoutSnap;
    const design = JSON.parse(rawDesign)  as DesignSnap;
    const pres   = JSON.parse(rawPres)    as Partial<PresentationSave>;

    if (design.v !== 2 || !Array.isArray(design.runs))           return null;
    if (pres.v !== 2 || !pres.wallSelections)                    return null;
    if (!Array.isArray(pres.selectedWallIds) || pres.selectedWallIds.length === 0) return null;

    let total = 0;
    for (const run of design.runs) {
      if (!pres.selectedWallIds.includes(run.wallId)) continue;
      const sel = pres.wallSelections[run.wallId];
      if (!sel) continue;

      const secs   = runToPricingSections(run);
      const phts   = runToPanelHeights(run, layout.systemHeightIn ?? 84);
      const result = computePresentationPricing(
        secs,
        layout.closetDepthIn    ?? 25,
        run.endIn - run.startIn,
        layout.ceilingHeightIn  ?? 101,
        phts,
        sel.tier          ?? "Classic",
        sel.material      ?? "none",
        sel.backing       ?? "none",
        sel.deco          ?? "none",
        sel.accessoryQtys ?? {},
      );
      total += result.finalTotal;
    }

    return total > 0 ? Math.round(total * 100) / 100 : null;
  } catch {
    return null;
  }
}

function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  "Reach-In Closet": "#4f7ef8",
  "Walk-In Closet":  "#7c5cbf",
  "Garage":          "#e07c3a",
  "Wall Bed":        "#3aa87c",
  "Office":          "#c45c5c",
};
function typeColor(t: string): string { return TYPE_COLORS[t] ?? "#888"; }

/**
 * In the context of a single client, the distinguishing info is
 * the room/location or project type — not the client number.
 * Priority: custom name → location name → project type → "Untitled Project"
 */
function projectLabel(p: Project): string {
  return p.name || p.locationName || p.projectType || "Untitled Project";
}

// ─── Types ────────────────────────────────────────────────────────────────────

const EMPTY_EDIT_FORM = { clientNumber: "", name: "", address: "", phone: "", email: "" };
type ClientEditForm = typeof EMPTY_EDIT_FORM;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const router   = useRouter();
  const params   = useParams();
  const clientId = params.id as string;

  // Client + projects
  const [client,      setClient]      = useState<Client | null>(null);
  const [projects,    setProjects]    = useState<Project[]>([]);
  const [notFound,    setNotFound]    = useState(false);

  // Edit client inline
  const [showEdit,    setShowEdit]    = useState(false);
  const [editForm,    setEditForm]    = useState<ClientEditForm>(EMPTY_EDIT_FORM);
  const [editError,   setEditError]   = useState("");

  // Project rename
  const [renameId,    setRenameId]    = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Project delete confirm
  const [deleteId,    setDeleteId]    = useState<string | null>(null);

  // Multi-select for combined quote
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [showQuote,   setShowQuote]   = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const c = getClient(clientId);
    if (!c) { setNotFound(true); return; }
    setClient(c);
    setProjects(listProjectsByClientNum(c.clientNumber));
  }, [clientId]);

  useEffect(() => {
    if (renameId) setTimeout(() => renameInputRef.current?.focus(), 50);
  }, [renameId]);

  // ── Client edit handlers ──────────────────────────────────────────────────────

  function handleStartEdit() {
    if (!client) return;
    setEditForm({
      clientNumber: client.clientNumber,
      name:         client.name,
      address:      client.address,
      phone:        client.phone,
      email:        client.email,
    });
    setEditError("");
    setShowEdit(true);
  }

  function handleEditSubmit() {
    if (!client) return;
    if (!editForm.name.trim())         { setEditError("Client name is required."); return; }
    if (!editForm.clientNumber.trim()) { setEditError("Client # is required."); return; }
    try {
      const updated = updateClient(client.id, {
        clientNumber: editForm.clientNumber.trim(),
        name:         editForm.name.trim(),
        address:      editForm.address.trim(),
        phone:        editForm.phone.trim(),
        email:        editForm.email.trim(),
      });
      if (updated) {
        setClient(updated);
        setProjects(listProjectsByClientNum(updated.clientNumber));
      }
      setShowEdit(false);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to update client.");
    }
  }

  // ── New project for this client ───────────────────────────────────────────────

  function handleNewProject() {
    if (!client) return;
    // Pre-fill the session so /setup auto-fills client fields
    localStorage.setItem("closet-session", JSON.stringify({
      clientNum:  client.clientNumber,
      clientName: client.name,
    }));
    // Clear stale working data so Room Layout starts fresh
    localStorage.removeItem("closet-setup");
    localStorage.removeItem("room-layout");
    localStorage.removeItem("design-state");
    localStorage.removeItem("closet-presentation");
    setActiveProjectId(null);
    router.push("/setup");
  }

  // ── Project action handlers ───────────────────────────────────────────────────

  function handleOpen(id: string) {
    const dest = openProject(id);
    router.push(dest);
  }

  function handleStartRename(p: Project) {
    setRenameId(p.id);
    setRenameValue(p.name || p.locationName || "");
    setDeleteId(null);
  }

  function handleCommitRename() {
    if (!renameId) return;
    const updated = renameProject(renameId, renameValue);
    if (updated) setProjects(prev => prev.map(p => p.id === renameId ? updated : p));
    setRenameId(null);
  }

  function handleDuplicate(id: string) {
    const copy = duplicateProject(id);
    if (copy && client) setProjects(listProjectsByClientNum(client.clientNumber));
  }

  function handleConfirmDelete() {
    if (!deleteId || !client) return;
    deleteProject(deleteId);
    setProjects(prev => prev.filter(p => p.id !== deleteId));
    setSelected(prev => { const s = new Set(prev); s.delete(deleteId); return s; });
    setDeleteId(null);
  }

  // ── Multi-select ──────────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  function toggleSelectAll() {
    setSelected(selected.size === projects.length
      ? new Set()
      : new Set(projects.map(p => p.id))
    );
  }

  const selectedProjects = projects.filter(p => selected.has(p.id));
  const projectToDelete  = deleteId ? projects.find(p => p.id === deleteId) : null;

  // ── Styles ────────────────────────────────────────────────────────────────────

  const inp: React.CSSProperties = {
    width: "100%", padding: "8px 10px", fontSize: "13px",
    border: "1.5px solid #d0cac2", borderRadius: "6px",
    color: "#111", backgroundColor: "#fff", boxSizing: "border-box", outline: "none",
  };
  const lbl: React.CSSProperties = {
    fontSize: "11px", fontWeight: "700", color: "#555", marginBottom: "4px", display: "block",
  };

  // ── Not found ─────────────────────────────────────────────────────────────────

  if (notFound) {
    return (
      <div style={{ fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee",
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "16px", color: "#888", marginBottom: "16px" }}>Client not found.</div>
          <button onClick={() => router.push("/clients")}
            style={{ padding: "8px 20px", borderRadius: "7px", border: "none",
              backgroundColor: "#1a1a1a", color: "#fff", fontSize: "13px",
              fontWeight: "600", cursor: "pointer" }}>
            ← Back to Clients
          </button>
        </div>
      </div>
    );
  }

  if (!client) return null; // still loading

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee",
      display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <header style={{
        backgroundColor: "#1a1a1a", color: "#fff", padding: "0 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100, height: "56px", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
          <button onClick={() => router.push("/clients")}
            style={{ background: "none", border: "none", color: "#aaa", fontSize: "20px",
              cursor: "pointer", lineHeight: 1, padding: "0 4px", flexShrink: 0 }}>
            ←
          </button>
          <span style={{ fontSize: "15px", fontWeight: "800", color: "#fff",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {client.name}
          </span>
          <span style={{ fontSize: "12px", color: "#777", flexShrink: 0 }}>
            #{client.clientNumber}
          </span>
        </div>
        <button onClick={handleNewProject}
          style={{ fontSize: "12px", fontWeight: "700", cursor: "pointer",
            padding: "7px 16px", borderRadius: "8px", flexShrink: 0,
            backgroundColor: "#fff", color: "#1a1a1a", border: "none" }}>
          + New Project
        </button>
      </header>

      {/* Body */}
      <main style={{ flex: 1, padding: "24px 20px", maxWidth: "860px", width: "100%",
        margin: "0 auto", boxSizing: "border-box" }}>

        {/* ── Client Info Card ─────────────────────────────────────────────────── */}
        <div style={{ backgroundColor: "#fff", border: "1.5px solid #e5e0d8",
          borderRadius: "10px", padding: "22px 24px", marginBottom: "32px" }}>

          {showEdit ? (
            /* ── Edit form ──────────────────────────────────────────────────── */
            <>
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: "16px" }}>
                <span style={{ fontSize: "13px", fontWeight: "800" }}>Edit Client Info</span>
                <button onClick={() => setShowEdit(false)}
                  style={{ background: "none", border: "none", fontSize: "16px",
                    color: "#aaa", cursor: "pointer" }}>✕</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={lbl}>Client Name *</label>
                    <input style={inp} type="text" value={editForm.name}
                      onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label style={lbl}>Client # *</label>
                    <input style={inp} type="text" value={editForm.clientNumber}
                      onChange={e => setEditForm(f => ({ ...f, clientNumber: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={lbl}>Address</label>
                  <input style={inp} type="text" placeholder="e.g. 123 Main St, City, State"
                    value={editForm.address}
                    onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={lbl}>Phone</label>
                    <input style={inp} type="tel" value={editForm.phone}
                      onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
                  </div>
                  <div>
                    <label style={lbl}>Email</label>
                    <input style={inp} type="email" value={editForm.email}
                      onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                </div>
              </div>
              {editError && (
                <p style={{ color: "#c0392b", fontSize: "12px", margin: "8px 0 0" }}>{editError}</p>
              )}
              <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                <button onClick={handleEditSubmit}
                  style={{ padding: "7px 20px", borderRadius: "6px", border: "none",
                    backgroundColor: "#1a1a1a", color: "#fff", fontSize: "13px",
                    fontWeight: "700", cursor: "pointer" }}>
                  Save Changes
                </button>
                <button onClick={() => setShowEdit(false)}
                  style={{ padding: "7px 16px", borderRadius: "6px",
                    border: "1.5px solid #d0ccc5", backgroundColor: "#fff",
                    fontSize: "13px", cursor: "pointer", color: "#555" }}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            /* ── Display mode ───────────────────────────────────────────────── */
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
              {/* Avatar */}
              <div style={{ width: "54px", height: "54px", borderRadius: "50%",
                backgroundColor: "#1a1a1a", color: "#fff", display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: "20px",
                fontWeight: "800", flexShrink: 0 }}>
                {client.name.charAt(0).toUpperCase()}
              </div>
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "20px", fontWeight: "800", color: "#1a1a1a" }}>
                    {client.name}
                  </span>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "#888",
                    backgroundColor: "#f0eee9", borderRadius: "4px", padding: "2px 9px" }}>
                    #{client.clientNumber}
                  </span>
                </div>
                <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap",
                  gap: "6px 24px", fontSize: "13px", color: "#555" }}>
                  {client.phone && (
                    <span>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#aaa",
                        textTransform: "uppercase", letterSpacing: "0.5px", marginRight: "5px" }}>
                        Phone
                      </span>
                      {client.phone}
                    </span>
                  )}
                  {client.email && (
                    <span>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#aaa",
                        textTransform: "uppercase", letterSpacing: "0.5px", marginRight: "5px" }}>
                        Email
                      </span>
                      {client.email}
                    </span>
                  )}
                  {client.address && (
                    <span>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#aaa",
                        textTransform: "uppercase", letterSpacing: "0.5px", marginRight: "5px" }}>
                        Address
                      </span>
                      {client.address}
                    </span>
                  )}
                  {!client.phone && !client.email && !client.address && (
                    <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>
                      No contact details saved
                    </span>
                  )}
                </div>
              </div>
              <button onClick={handleStartEdit}
                style={{ padding: "6px 14px", borderRadius: "6px",
                  border: "1.5px solid #d0ccc5", backgroundColor: "#fff",
                  fontSize: "12px", fontWeight: "600", cursor: "pointer",
                  color: "#333", flexShrink: 0 }}>
                Edit
              </button>
            </div>
          )}
        </div>

        {/* ── Projects Section header ──────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "14px", fontWeight: "800", color: "#1a1a1a" }}>
              All Projects
            </span>
            {projects.length > 0 && (
              <span style={{ fontSize: "11px", color: "#555", backgroundColor: "#e8e4de",
                borderRadius: "10px", padding: "2px 9px", fontWeight: "700" }}>
                {projects.length}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {projects.length > 1 && (
              <button onClick={toggleSelectAll}
                style={{ fontSize: "11px", color: "#888", background: "none",
                  border: "1px solid #d0ccc5", borderRadius: "5px",
                  padding: "4px 10px", cursor: "pointer" }}>
                {selected.size === projects.length ? "Deselect All" : "Select All"}
              </button>
            )}
            <button onClick={handleNewProject}
              style={{ fontSize: "12px", fontWeight: "700", cursor: "pointer",
                padding: "7px 16px", borderRadius: "7px",
                backgroundColor: "#1a1a1a", color: "#fff", border: "none" }}>
              + New Project
            </button>
          </div>
        </div>

        {/* ── Multi-select action bar ──────────────────────────────────────────── */}
        {selected.size > 0 && (
          <div style={{
            position: "sticky", top: "56px", zIndex: 80, marginBottom: "12px",
            backgroundColor: "#1a1a1a", color: "#fff",
            padding: "11px 18px", borderRadius: "9px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.20)",
          }}>
            <span style={{ fontSize: "13px", fontWeight: "700" }}>
              {selected.size} project{selected.size !== 1 ? "s" : ""} selected
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              {selected.size >= 2 && (
                <button onClick={() => setShowQuote(true)}
                  style={{ padding: "7px 16px", borderRadius: "6px", border: "none",
                    backgroundColor: "#c8a030", color: "#fff", fontSize: "12px",
                    fontWeight: "700", cursor: "pointer" }}>
                  Generate Combined Quote →
                </button>
              )}
              {selected.size === 1 && (
                <span style={{ fontSize: "12px", color: "#888", alignSelf: "center" }}>
                  Select at least 2 projects for a combined quote
                </span>
              )}
              <button onClick={() => setSelected(new Set())}
                style={{ padding: "7px 12px", borderRadius: "6px",
                  border: "1px solid rgba(255,255,255,0.25)", backgroundColor: "transparent",
                  color: "rgba(255,255,255,0.65)", fontSize: "12px", cursor: "pointer" }}>
                Clear
              </button>
            </div>
          </div>
        )}

        {/* ── Empty state ──────────────────────────────────────────────────────── */}
        {projects.length === 0 && (
          <div style={{ backgroundColor: "#fff", border: "1.5px solid #e5e0d8",
            borderRadius: "10px", padding: "56px 24px", textAlign: "center" }}>
            <div style={{ fontSize: "36px", marginBottom: "14px" }}>📂</div>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#444", marginBottom: "8px" }}>
              No projects yet for {client.name}
            </div>
            <div style={{ fontSize: "13px", color: "#888", marginBottom: "24px" }}>
              Create a project to link it to this client account.
            </div>
            <button onClick={handleNewProject}
              style={{ padding: "9px 24px", borderRadius: "8px", border: "none",
                backgroundColor: "#1a1a1a", color: "#fff", fontSize: "13px",
                fontWeight: "700", cursor: "pointer" }}>
              + New Project for {client.name}
            </button>
          </div>
        )}

        {/* ── Project list ─────────────────────────────────────────────────────── */}
        {projects.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {projects.map(p => (
              <ProjectRow
                key={p.id}
                project={p}
                isSelected={selected.has(p.id)}
                isRenaming={renameId === p.id}
                renameValue={renameValue}
                renameInputRef={renameId === p.id ? renameInputRef : undefined}
                onToggleSelect={() => toggleSelect(p.id)}
                onOpen={() => handleOpen(p.id)}
                onStartRename={() => handleStartRename(p)}
                onRenameChange={setRenameValue}
                onCommitRename={handleCommitRename}
                onCancelRename={() => setRenameId(null)}
                onDuplicate={() => handleDuplicate(p.id)}
                onDelete={() => { setRenameId(null); setDeleteId(p.id); }}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Delete Confirm Modal ─────────────────────────────────────────────── */}
      {deleteId && projectToDelete && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: "12px", padding: "28px 32px",
            width: "100%", maxWidth: "380px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "17px", fontWeight: "800" }}>Delete project?</h3>
            <p style={{ margin: "0 0 24px", fontSize: "14px", color: "#555", lineHeight: 1.5 }}>
              <strong>{projectLabel(projectToDelete)}</strong> will be permanently deleted.
              This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button onClick={() => setDeleteId(null)}
                style={{ padding: "8px 18px", borderRadius: "7px", border: "1.5px solid #d0ccc5",
                  backgroundColor: "#fff", fontSize: "13px", fontWeight: "600",
                  cursor: "pointer", color: "#333" }}>
                Cancel
              </button>
              <button onClick={handleConfirmDelete}
                style={{ padding: "8px 18px", borderRadius: "7px", border: "none",
                  backgroundColor: "#c0392b", color: "#fff", fontSize: "13px",
                  fontWeight: "600", cursor: "pointer" }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Combined Quote Modal ─────────────────────────────────────────────── */}
      {showQuote && selectedProjects.length >= 2 && (
        <CombinedQuoteModal
          client={client}
          projects={selectedProjects}
          onClose={() => setShowQuote(false)}
        />
      )}
    </div>
  );
}

// ─── ProjectRow ───────────────────────────────────────────────────────────────

interface ProjectRowProps {
  project:         Project;
  isSelected:      boolean;
  isRenaming:      boolean;
  renameValue:     string;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  onToggleSelect:  () => void;
  onOpen:          () => void;
  onStartRename:   () => void;
  onRenameChange:  (v: string) => void;
  onCommitRename:  () => void;
  onCancelRename:  () => void;
  onDuplicate:     () => void;
  onDelete:        () => void;
}

function ProjectRow({
  project: p, isSelected, isRenaming, renameValue, renameInputRef,
  onToggleSelect, onOpen, onStartRename, onRenameChange,
  onCommitRename, onCancelRename, onDuplicate, onDelete,
}: ProjectRowProps) {
  const color = typeColor(p.projectType);
  const label = projectLabel(p);

  return (
    <div style={{
      backgroundColor: "#fff", borderRadius: "10px", overflow: "hidden",
      border: isSelected ? "2px solid #1a1a1a" : "1.5px solid #e5e0d8",
      transition: "border-color 0.1s",
    }}>
      {/* Type color band */}
      <div style={{ height: "3px", backgroundColor: color }} />

      <div style={{ padding: "14px 16px", display: "flex", gap: "14px", alignItems: "flex-start" }}>

        {/* Checkbox */}
        <button
          onClick={onToggleSelect}
          aria-label={isSelected ? "Deselect project" : "Select project"}
          style={{
            width: "20px", height: "20px", borderRadius: "5px", flexShrink: 0, marginTop: "1px",
            border: isSelected ? "none" : "1.5px solid #c8c4be",
            backgroundColor: isSelected ? "#1a1a1a" : "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", padding: 0,
          }}>
          {isSelected && (
            <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
              <path d="M1 4.5l3 3 6-7" stroke="#fff" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Name / rename input */}
          {isRenaming ? (
            <div style={{ marginBottom: "8px" }}>
              <input
                ref={renameInputRef as React.RefObject<HTMLInputElement>}
                value={renameValue}
                onChange={e => onRenameChange(e.target.value)}
                placeholder="Project name or room name"
                onKeyDown={e => {
                  if (e.key === "Enter")  onCommitRename();
                  if (e.key === "Escape") onCancelRename();
                }}
                style={{
                  width: "100%", fontSize: "14px", fontWeight: "700",
                  padding: "5px 9px", borderRadius: "5px",
                  border: "1.5px solid #4a90e2", outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                <button onClick={onCommitRename}
                  style={{ fontSize: "12px", padding: "4px 12px", borderRadius: "5px",
                    border: "none", backgroundColor: "#1a1a1a", color: "#fff",
                    fontWeight: "600", cursor: "pointer" }}>
                  Save
                </button>
                <button onClick={onCancelRename}
                  style={{ fontSize: "12px", padding: "4px 12px", borderRadius: "5px",
                    border: "1.5px solid #d0ccc5", backgroundColor: "#fff",
                    cursor: "pointer", color: "#555" }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: "14px", fontWeight: "800", color: "#1a1a1a",
              marginBottom: "6px", lineHeight: 1.3 }}>
              {label}
            </div>
          )}

          {/* Meta badges */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center" }}>
            {p.projectType && (
              <span style={{ fontSize: "10px", fontWeight: "700", color,
                backgroundColor: color + "18", borderRadius: "4px", padding: "2px 7px" }}>
                {p.projectType}
              </span>
            )}
            {p.locationName && p.locationName !== label && (
              <span style={{ fontSize: "10px", color: "#666",
                backgroundColor: "#f0eee9", borderRadius: "4px", padding: "2px 7px" }}>
                {p.locationName}
              </span>
            )}
            {p.wallCount != null && p.wallCount > 0 && (
              <span style={{ fontSize: "10px", color: "#666",
                backgroundColor: "#f0eee9", borderRadius: "4px", padding: "2px 7px" }}>
                {p.wallCount} wall{p.wallCount !== 1 ? "s" : ""}
              </span>
            )}
            <span style={{ fontSize: "10px", color: "#bbb" }}>
              Updated {formatProjectDate(p.updatedAt)}
            </span>
          </div>

          {/* Remarks preview */}
          {p.remarks && (
            <div style={{
              fontSize: "11px", color: "#999", marginTop: "5px", fontStyle: "italic",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {p.remarks}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
          <button onClick={onOpen}
            style={{ padding: "7px 16px", borderRadius: "6px", border: "none",
              backgroundColor: "#1a1a1a", color: "#fff", fontSize: "12px",
              fontWeight: "700", cursor: "pointer" }}>
            Open
          </button>
          <button onClick={onStartRename} title="Rename"
            style={{ padding: "7px 9px", borderRadius: "6px",
              border: "1.5px solid #e0dbd4", backgroundColor: "#fff",
              fontSize: "13px", cursor: "pointer", color: "#555" }}>
            ✏️
          </button>
          <button onClick={onDuplicate} title="Duplicate"
            style={{ padding: "7px 9px", borderRadius: "6px",
              border: "1.5px solid #e0dbd4", backgroundColor: "#fff",
              fontSize: "13px", cursor: "pointer", color: "#555" }}>
            ⧉
          </button>
          <button onClick={onDelete} title="Delete"
            style={{ padding: "7px 9px", borderRadius: "6px",
              border: "1.5px solid #ffd5d5", backgroundColor: "#fff8f8",
              fontSize: "13px", cursor: "pointer", color: "#c0392b" }}>
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CombinedQuoteModal ───────────────────────────────────────────────────────
//
// Printable combined quote overlay.
// Computes each project's finalTotal from its saved snapshots, shows them
// per-project, and sums to a grand total.

function CombinedQuoteModal({
  client, projects, onClose,
}: {
  client:   Client;
  projects: Project[];
  onClose:  () => void;
}) {
  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  // Compute pricing for each project from its stored snapshots.
  // null = pricing not yet configured for that project.
  const totals = projects.map(computeProjectTotal);

  // Grand total: sum only the projects that have pricing data.
  const pricedTotals    = totals.filter((t): t is number => t !== null);
  const allHavePricing  = pricedTotals.length === projects.length;
  const someHavePricing = pricedTotals.length > 0;
  const grandTotal      = pricedTotals.reduce((sum, t) => sum + t, 0);

  return (
    <>
      {/* Print-only styles: isolate #cq-print-area on the page */}
      <style>{`
        @media print {
          body > * { visibility: hidden !important; }
          #cq-print-area, #cq-print-area * { visibility: visible !important; }
          #cq-print-area {
            position: fixed !important;
            top: 0 !important; left: 0 !important;
            width: 100% !important; height: auto !important;
            background: white !important;
            padding: 40px !important;
            box-sizing: border-box !important;
          }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.55)", zIndex: 400 }}
      />

      {/* Scroll container */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 401,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        overflowY: "auto", padding: "32px 20px",
        pointerEvents: "none",
      }}>
        <div
          onClick={e => e.stopPropagation()}
          style={{
            backgroundColor: "#fff", borderRadius: "12px", width: "100%", maxWidth: "700px",
            boxShadow: "0 20px 64px rgba(0,0,0,0.30)",
            pointerEvents: "auto",
          }}>

          {/* ── Modal chrome header (screen only — not printed) ─────────────── */}
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #e8e4de",
            display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "16px", fontWeight: "800", color: "#1a1a1a" }}>
                Combined Quote
              </div>
              <div style={{ fontSize: "12px", color: "#888", marginTop: "2px" }}>
                {projects.length} projects · {client.name} #{client.clientNumber}
                {someHavePricing && (
                  <span style={{ marginLeft: "8px", fontWeight: "700", color: "#1a1a1a" }}>
                    · {allHavePricing ? "" : "Partial "}{fmtPrice(grandTotal)}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => window.print()}
                style={{ padding: "7px 16px", borderRadius: "6px", border: "1.5px solid #d0ccc5",
                  backgroundColor: "#fff", fontSize: "12px", fontWeight: "700",
                  cursor: "pointer", color: "#333", display: "flex", alignItems: "center", gap: "6px" }}>
                🖨 Print / Save PDF
              </button>
              <button onClick={onClose}
                style={{ padding: "7px 10px", borderRadius: "6px", border: "none",
                  backgroundColor: "#f5f2ee", fontSize: "16px", cursor: "pointer", color: "#555",
                  lineHeight: 1 }}>
                ✕
              </button>
            </div>
          </div>

          {/* ── Printable area ────────────────────────────────────────────────── */}
          <div id="cq-print-area" style={{ padding: "32px 28px" }}>

            {/* Print document header */}
            <div style={{ textAlign: "center", marginBottom: "28px", paddingBottom: "24px",
              borderBottom: "2px solid #1a1a1a" }}>
              <div style={{ fontSize: "10px", fontWeight: "700", color: "#aaa",
                textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "10px" }}>
                Closets by Design — Design Studio
              </div>
              <div style={{ fontSize: "24px", fontWeight: "800", color: "#1a1a1a",
                marginBottom: "8px" }}>
                Combined Project Quote
              </div>
              <div style={{ fontSize: "15px", fontWeight: "700", color: "#333" }}>
                {client.name}
              </div>
              <div style={{ fontSize: "13px", color: "#666", marginTop: "3px" }}>
                Client #{client.clientNumber}
                {client.phone && ` · ${client.phone}`}
              </div>
              {client.address && (
                <div style={{ fontSize: "12px", color: "#888", marginTop: "3px" }}>
                  {client.address}
                </div>
              )}
              <div style={{ fontSize: "11px", color: "#bbb", marginTop: "8px" }}>
                Prepared: {today}
              </div>
            </div>

            {/* ── Project rows ────────────────────────────────────────────────── */}
            <div style={{ marginBottom: "28px" }}>
              <div style={{ fontSize: "10px", fontWeight: "700", color: "#aaa",
                textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "14px" }}>
                Projects Included ({projects.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {projects.map((p, idx) => {
                  const c     = typeColor(p.projectType);
                  const name  = projectLabel(p);
                  const total = totals[idx];
                  return (
                    <div key={p.id} style={{
                      border: "1.5px solid #e5e0d8", borderRadius: "8px",
                      borderLeft: `5px solid ${c}`,
                      padding: "14px 18px",
                      display: "flex", gap: "16px", alignItems: "center",
                    }}>
                      {/* Index bubble */}
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%",
                        backgroundColor: "#f0eee9", display: "flex", alignItems: "center",
                        justifyContent: "center", fontSize: "12px", fontWeight: "800",
                        color: "#555", flexShrink: 0 }}>
                        {idx + 1}
                      </div>

                      {/* Name + badges */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "14px", fontWeight: "800", color: "#1a1a1a",
                          marginBottom: "5px" }}>
                          {name}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                          {p.projectType && (
                            <span style={{ fontSize: "10px", fontWeight: "700", color: c,
                              backgroundColor: c + "18", borderRadius: "4px", padding: "2px 7px" }}>
                              {p.projectType}
                            </span>
                          )}
                          {p.locationName && p.locationName !== name && (
                            <span style={{ fontSize: "10px", color: "#666",
                              backgroundColor: "#f0eee9", borderRadius: "4px", padding: "2px 7px" }}>
                              {p.locationName}
                            </span>
                          )}
                          {p.wallCount != null && p.wallCount > 0 && (
                            <span style={{ fontSize: "10px", color: "#666",
                              backgroundColor: "#f0eee9", borderRadius: "4px", padding: "2px 7px" }}>
                              {p.wallCount} wall{p.wallCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        {p.remarks && (
                          <div style={{ fontSize: "11px", color: "#999", marginTop: "5px",
                            fontStyle: "italic" }}>
                            {p.remarks}
                          </div>
                        )}
                      </div>

                      {/* Price column */}
                      <div style={{ flexShrink: 0, textAlign: "right", minWidth: "90px" }}>
                        {total !== null ? (
                          <span style={{ fontSize: "16px", fontWeight: "800", color: "#1a1a1a" }}>
                            {fmtPrice(total)}
                          </span>
                        ) : (
                          <span style={{ fontSize: "12px", color: "#bbb", fontStyle: "italic" }}>
                            No pricing
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Grand total block ────────────────────────────────────────────── */}
            {someHavePricing && (
              <div style={{
                border: "2px solid #1a1a1a", borderRadius: "8px",
                padding: "18px 22px", marginBottom: "24px",
                backgroundColor: "#1a1a1a",
              }}>
                {/* Per-project subtotals */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px",
                  marginBottom: "14px" }}>
                  {projects.map((p, idx) => {
                    const total = totals[idx];
                    if (total === null) return null;
                    return (
                      <div key={p.id}
                        style={{ display: "flex", justifyContent: "space-between",
                          alignItems: "center" }}>
                        <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)" }}>
                          {projectLabel(p)}
                        </span>
                        <span style={{ fontSize: "13px", fontWeight: "600",
                          color: "rgba(255,255,255,0.85)" }}>
                          {fmtPrice(total)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Divider */}
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.2)",
                  marginBottom: "14px" }} />

                {/* Grand total */}
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center" }}>
                  <span style={{ fontSize: "14px", fontWeight: "700", color: "#fff" }}>
                    {allHavePricing ? "Combined Total" : `Combined Total (${pricedTotals.length} of ${projects.length} priced)`}
                  </span>
                  <span style={{ fontSize: "22px", fontWeight: "800", color: "#fff" }}>
                    {fmtPrice(grandTotal)}
                  </span>
                </div>

                {/* Pricing note */}
                <div style={{ marginTop: "12px", fontSize: "11px",
                  color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
                  {allHavePricing
                    ? "Includes 40% off every item + additional 15% off per project. Detailed line items available in each project's Presentation."
                    : "Some projects have no pricing configured yet. Open those projects and complete the Presentation step to include them."
                  }
                </div>
              </div>
            )}

            {/* No-pricing notice (shown only when nothing is priced at all) */}
            {!someHavePricing && (
              <div style={{ backgroundColor: "#f9f8f5", border: "1px solid #e8e4de",
                borderRadius: "8px", padding: "16px 20px", marginBottom: "24px" }}>
                <div style={{ fontSize: "13px", color: "#888", lineHeight: 1.6 }}>
                  No pricing has been configured for these projects yet.
                  Open each project and complete the Presentation step to add pricing
                  — it will automatically appear here.
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              paddingTop: "16px", borderTop: "1px solid #e8e4de",
              fontSize: "11px", color: "#bbb" }}>
              <span>Closets by Design · Internal Document</span>
              <span>{today}</span>
            </div>
          </div>
          {/* end #cq-print-area */}

        </div>
      </div>
    </>
  );
}
