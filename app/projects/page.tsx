"use client";
// app/projects/page.tsx — View & manage saved projects

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  listProjects, deleteProject, renameProject, duplicateProject,
  openProject, projectDisplayName, formatProjectDate,
  type Project,
} from "@/app/_lib/projects";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  "Reach-In Closet": "#4f7ef8",
  "Walk-In Closet":  "#7c5cbf",
  "Garage":          "#e07c3a",
  "Wall Bed":        "#3aa87c",
  "Office":          "#c45c5c",
};

function typeColor(t: string): string {
  return TYPE_COLORS[t] ?? "#888";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const router = useRouter();

  const [projects,      setProjects]      = useState<Project[]>([]);
  const [renameId,      setRenameId]      = useState<string | null>(null);
  const [renameValue,   setRenameValue]   = useState("");
  const [deleteId,      setDeleteId]      = useState<string | null>(null);
  const [search,        setSearch]        = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProjects(listProjects());
  }, []);

  // Focus rename input when it opens
  useEffect(() => {
    if (renameId) setTimeout(() => renameInputRef.current?.focus(), 50);
  }, [renameId]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleOpen(id: string) {
    const dest = openProject(id);
    router.push(dest);
  }

  function handleStartRename(p: Project) {
    setRenameId(p.id);
    setRenameValue(p.name || p.clientNum || "");
  }

  function handleCommitRename() {
    if (!renameId) return;
    const updated = renameProject(renameId, renameValue);
    if (updated) {
      setProjects(prev => prev.map(p => p.id === renameId ? updated : p));
    }
    setRenameId(null);
  }

  function handleDuplicate(id: string) {
    const copy = duplicateProject(id);
    if (copy) setProjects(listProjects());
  }

  function handleConfirmDelete() {
    if (!deleteId) return;
    deleteProject(deleteId);
    setProjects(prev => prev.filter(p => p.id !== deleteId));
    setDeleteId(null);
  }

  // ── Filter ──────────────────────────────────────────────────────────────────

  const q = search.trim().toLowerCase();
  const filtered = q
    ? projects.filter(p =>
        (p.clientNum   || "").toLowerCase().includes(q) ||
        (p.clientName  || "").toLowerCase().includes(q) ||
        (p.projectType || "").toLowerCase().includes(q) ||
        (p.locationName|| "").toLowerCase().includes(q)
      )
    : projects;

  const projectToDelete = deleteId ? projects.find(p => p.id === deleteId) : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee",
      display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <header style={{
        backgroundColor: "#1a1a1a", color: "#fff", padding: "12px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button onClick={() => router.push("/")}
            style={{ background: "none", border: "none", color: "#aaa", fontSize: "20px",
              cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>
            ←
          </button>
          <span style={{ fontSize: "15px", fontWeight: "800" }}>Projects</span>
          {projects.length > 0 && (
            <span style={{ fontSize: "11px", color: "#888", backgroundColor: "#333",
              borderRadius: "12px", padding: "2px 8px" }}>
              {projects.length}
            </span>
          )}
        </div>
        <button
          onClick={() => router.push("/")}
          style={{
            fontSize: "12px", fontWeight: "600", cursor: "pointer",
            padding: "6px 16px", borderRadius: "8px",
            backgroundColor: "#fff", color: "#1a1a1a", border: "none",
          }}>
          + New Project
        </button>
      </header>

      {/* Search bar */}
      {projects.length > 0 && (
        <div style={{ backgroundColor: "#fff", borderBottom: "1px solid #e5e0d8",
          padding: "10px 20px" }}>
          <input
            type="text"
            placeholder="Search by client, type, or location…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: "100%", maxWidth: "400px", padding: "7px 12px",
              fontSize: "13px", borderRadius: "8px",
              border: "1.5px solid #d8d4cc", outline: "none",
              backgroundColor: "#fafaf8", boxSizing: "border-box",
            }}
          />
        </div>
      )}

      {/* Body */}
      <main style={{ flex: 1, padding: "24px 20px", maxWidth: "1000px", width: "100%",
        margin: "0 auto", boxSizing: "border-box" }}>

        {/* Empty state */}
        {projects.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 20px", color: "#888" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>📂</div>
            <div style={{ fontSize: "18px", fontWeight: "700", color: "#444",
              marginBottom: "8px" }}>No saved projects yet</div>
            <div style={{ fontSize: "14px", marginBottom: "24px" }}>
              Start a new project from the dashboard and use Save to keep your work.
            </div>
            <button onClick={() => router.push("/")}
              style={{ padding: "10px 24px", borderRadius: "8px", border: "none",
                backgroundColor: "#1a1a1a", color: "#fff", fontSize: "14px",
                fontWeight: "600", cursor: "pointer" }}>
              Go to Dashboard
            </button>
          </div>
        )}

        {/* No results */}
        {projects.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#888" }}>
            <div style={{ fontSize: "16px" }}>No projects match &ldquo;{search}&rdquo;</div>
          </div>
        )}

        {/* Project grid */}
        {filtered.length > 0 && (
          <div style={{ display: "grid", gap: "12px",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {filtered.map(p => (
              <ProjectCard
                key={p.id}
                project={p}
                isRenaming={renameId === p.id}
                renameValue={renameValue}
                renameInputRef={renameId === p.id ? renameInputRef : undefined}
                onOpen={() => handleOpen(p.id)}
                onStartRename={() => handleStartRename(p)}
                onRenameChange={setRenameValue}
                onCommitRename={handleCommitRename}
                onCancelRename={() => setRenameId(null)}
                onDuplicate={() => handleDuplicate(p.id)}
                onDelete={() => setDeleteId(p.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Delete confirm modal */}
      {deleteId && projectToDelete && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
        }}>
          <div style={{
            backgroundColor: "#fff", borderRadius: "12px", padding: "28px 32px",
            width: "100%", maxWidth: "380px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "17px", fontWeight: "800" }}>
              Delete project?
            </h3>
            <p style={{ margin: "0 0 24px", fontSize: "14px", color: "#555", lineHeight: 1.5 }}>
              <strong>{projectDisplayName(projectToDelete)}</strong> will be permanently deleted.
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
    </div>
  );
}

// ─── ProjectCard ──────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project:         Project;
  isRenaming:      boolean;
  renameValue:     string;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  onOpen:          () => void;
  onStartRename:   () => void;
  onRenameChange:  (v: string) => void;
  onCommitRename:  () => void;
  onCancelRename:  () => void;
  onDuplicate:     () => void;
  onDelete:        () => void;
}

function ProjectCard({
  project: p, isRenaming, renameValue, renameInputRef,
  onOpen, onStartRename, onRenameChange, onCommitRename, onCancelRename,
  onDuplicate, onDelete,
}: ProjectCardProps) {
  const color = typeColor(p.projectType);
  const displayName = projectDisplayName(p);

  return (
    <div style={{
      backgroundColor: "#fff", borderRadius: "10px",
      border: "1.5px solid #e5e0d8", overflow: "hidden",
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Color band + type */}
      <div style={{ height: "4px", backgroundColor: color }} />
      <div style={{ padding: "14px 16px 10px" }}>

        {/* Name row */}
        {isRenaming ? (
          <div style={{ marginBottom: "8px" }}>
            <input
              ref={renameInputRef as React.RefObject<HTMLInputElement>}
              value={renameValue}
              onChange={e => onRenameChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") onCommitRename();
                if (e.key === "Escape") onCancelRename();
              }}
              style={{
                width: "100%", fontSize: "14px", fontWeight: "700",
                padding: "4px 8px", borderRadius: "5px",
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
            marginBottom: "4px", lineHeight: 1.3, wordBreak: "break-word" }}>
            {displayName}
          </div>
        )}

        {/* Meta badges */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" }}>
          {p.projectType && (
            <span style={{ fontSize: "10px", fontWeight: "700", color,
              backgroundColor: color + "18", borderRadius: "4px", padding: "2px 7px" }}>
              {p.projectType}
            </span>
          )}
          {p.clientName && p.clientName !== displayName && (
            <span style={{ fontSize: "10px", color: "#666",
              backgroundColor: "#f0eee9", borderRadius: "4px", padding: "2px 7px" }}>
              {p.clientName}
            </span>
          )}
          {p.locationName && (
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

        {/* Date */}
        <div style={{ fontSize: "11px", color: "#aaa" }}>
          {formatProjectDate(p.updatedAt)}
        </div>
      </div>

      {/* Actions */}
      <div style={{
        borderTop: "1px solid #f0eee9", padding: "10px 16px",
        display: "flex", gap: "6px", marginTop: "auto",
      }}>
        <button onClick={onOpen}
          style={{
            flex: 1, padding: "7px 0", borderRadius: "7px", border: "none",
            backgroundColor: "#1a1a1a", color: "#fff", fontSize: "12px",
            fontWeight: "700", cursor: "pointer",
          }}>
          Open
        </button>
        <button onClick={onStartRename}
          title="Rename"
          style={{ padding: "7px 10px", borderRadius: "7px",
            border: "1.5px solid #e0dbd4", backgroundColor: "#fff",
            fontSize: "13px", cursor: "pointer", color: "#555" }}>
          ✏️
        </button>
        <button onClick={onDuplicate}
          title="Duplicate"
          style={{ padding: "7px 10px", borderRadius: "7px",
            border: "1.5px solid #e0dbd4", backgroundColor: "#fff",
            fontSize: "13px", cursor: "pointer", color: "#555" }}>
          ⧉
        </button>
        <button onClick={onDelete}
          title="Delete"
          style={{ padding: "7px 10px", borderRadius: "7px",
            border: "1.5px solid #ffd5d5", backgroundColor: "#fff8f8",
            fontSize: "13px", cursor: "pointer", color: "#c0392b" }}>
          🗑
        </button>
      </div>
    </div>
  );
}
