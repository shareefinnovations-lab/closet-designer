// app/_lib/projects.ts
//
// Project persistence store — localStorage-backed.
// All functions are pure / side-effect isolated so they can be called
// from any page component or utility.
//
// Storage layout
// ─────────────
//   closet-projects          JSON: Project[]
//   closet-active-project-id string: currently open project id (or absent)
//
// Working keys (snapshotted when saving)
// ──────────────────────────────────────
//   closet-setup             setup config
//   room-layout              room geometry
//   design-state             wall runs / panels / components
//   closet-presentation      presentation finish + pricing selections
//
// This module is a clean adapter layer. Switching to a real backend later
// means only this file needs to change.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectSnapshot {
  setup?:        string | null;
  roomLayout?:   string | null;
  designState?:  string | null;
  presentation?: string | null;
}

export interface Project {
  id:            string;
  name?:         string;       // optional display name (default: clientNum or "Untitled")
  clientNum:     string;
  clientName?:   string;
  projectType:   string;
  locationName?: string;
  remarks?:      string;
  createdAt:     string;       // ISO 8601
  updatedAt:     string;       // ISO 8601
  snapshot:      ProjectSnapshot;
  // Derived counts (cached at save time for display purposes)
  wallCount?:    number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECTS_KEY   = "closet-projects";
const ACTIVE_ID_KEY  = "closet-active-project-id";

// Working localStorage keys that get snapshotted
const SETUP_KEY        = "closet-setup";
const ROOM_LAYOUT_KEY  = "room-layout";
const DESIGN_STATE_KEY = "design-state";
const PRESENTATION_KEY = "closet-presentation";

// ─── ID generation ────────────────────────────────────────────────────────────

export function createProjectId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Low-level store ──────────────────────────────────────────────────────────

function readProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
}

function writeProjects(projects: Project[]): void {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** List all saved projects, newest first. */
export function listProjects(): Project[] {
  return readProjects().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/** Find one project by ID. Returns null if not found. */
export function getProject(id: string): Project | null {
  return readProjects().find(p => p.id === id) ?? null;
}

/** Return the currently active project ID (may be undefined). */
export function getActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ID_KEY);
  } catch {
    return null;
  }
}

/** Set the active project ID. Pass null to clear it. */
export function setActiveProjectId(id: string | null): void {
  if (id) {
    localStorage.setItem(ACTIVE_ID_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_ID_KEY);
  }
}

/**
 * Snapshot the current working localStorage keys and save as a project.
 * - If id is provided and that project exists → update it.
 * - If id is null / not found → create a new project.
 * Returns the saved project.
 */
export function saveCurrentProject(id: string | null): Project {
  const rawSetup        = localStorage.getItem(SETUP_KEY);
  const rawRoomLayout   = localStorage.getItem(ROOM_LAYOUT_KEY);
  const rawDesignState  = localStorage.getItem(DESIGN_STATE_KEY);
  const rawPresentation = localStorage.getItem(PRESENTATION_KEY);

  const snapshot: ProjectSnapshot = {
    setup:        rawSetup,
    roomLayout:   rawRoomLayout,
    designState:  rawDesignState,
    presentation: rawPresentation,
  };

  // Extract identity fields from room-layout (most reliable source) → fallback to setup
  let clientNum     = "";
  let clientName    = "";
  let projectType   = "";
  let locationName  = "";
  let remarks       = "";
  let wallCount: number | undefined;

  if (rawRoomLayout) {
    try {
      const lay = JSON.parse(rawRoomLayout);
      clientNum    = lay.clientNum    ?? "";
      clientName   = lay.clientName   ?? "";
      projectType  = lay.projectType  ?? "";
      locationName = lay.locationName ?? "";
      remarks      = lay.remarks      ?? "";
      // Count segments selected for design
      if (Array.isArray(lay.segments)) {
        wallCount = lay.segments.filter((s: { selectedForDesign?: boolean }) => s.selectedForDesign).length;
      }
    } catch { /* ignore */ }
  } else if (rawSetup) {
    try {
      const setup = JSON.parse(rawSetup);
      clientNum   = setup.clientNum    ?? "";
      clientName  = setup.clientName   ?? "";
      projectType = setup.projectType  ?? "";
      locationName= setup.locationName ?? "";
      remarks     = setup.remarks      ?? "";
    } catch { /* ignore */ }
  }

  const now      = new Date().toISOString();
  const projects = readProjects();

  // Try to find existing project to update
  const existingIdx = id ? projects.findIndex(p => p.id === id) : -1;

  if (existingIdx >= 0) {
    // Update existing
    const updated: Project = {
      ...projects[existingIdx],
      clientNum,
      clientName,
      projectType,
      locationName,
      remarks,
      updatedAt: now,
      snapshot,
      wallCount,
    };
    projects[existingIdx] = updated;
    writeProjects(projects);
    setActiveProjectId(updated.id);
    return updated;
  } else {
    // Create new
    const newProject: Project = {
      id:          createProjectId(),
      name:        clientNum || undefined,
      clientNum,
      clientName,
      projectType,
      locationName,
      remarks,
      createdAt:   now,
      updatedAt:   now,
      snapshot,
      wallCount,
    };
    writeProjects([...projects, newProject]);
    setActiveProjectId(newProject.id);
    return newProject;
  }
}

/**
 * Open a saved project: write snapshot values back to working keys and
 * set the active project ID. Returns the page to navigate to.
 */
export function openProject(id: string): "/design" | "/room-layout" | "/setup" {
  const project = getProject(id);
  if (!project) return "/setup";

  const { snapshot } = project;

  if (snapshot.setup) {
    localStorage.setItem(SETUP_KEY, snapshot.setup);
  } else {
    localStorage.removeItem(SETUP_KEY);
  }

  if (snapshot.roomLayout) {
    localStorage.setItem(ROOM_LAYOUT_KEY, snapshot.roomLayout);
  } else {
    localStorage.removeItem(ROOM_LAYOUT_KEY);
  }

  if (snapshot.designState) {
    localStorage.setItem(DESIGN_STATE_KEY, snapshot.designState);
  } else {
    localStorage.removeItem(DESIGN_STATE_KEY);
  }

  if (snapshot.presentation) {
    localStorage.setItem(PRESENTATION_KEY, snapshot.presentation);
  } else {
    localStorage.removeItem(PRESENTATION_KEY);
  }

  setActiveProjectId(id);

  // Determine best entry point
  if (snapshot.designState || snapshot.roomLayout) return "/design";
  if (snapshot.setup) return "/room-layout";
  return "/setup";
}

/** Delete a project. Also clears active project if it matches. */
export function deleteProject(id: string): void {
  const projects = readProjects().filter(p => p.id !== id);
  writeProjects(projects);
  if (getActiveProjectId() === id) {
    setActiveProjectId(null);
  }
}

/** Rename a project (updates name + updatedAt). */
export function renameProject(id: string, name: string): Project | null {
  const projects = readProjects();
  const idx      = projects.findIndex(p => p.id === id);
  if (idx < 0) return null;
  projects[idx] = { ...projects[idx], name: name.trim() || undefined, updatedAt: new Date().toISOString() };
  writeProjects(projects);
  return projects[idx];
}

/** Duplicate a project with a new ID and timestamps. */
export function duplicateProject(id: string): Project | null {
  const original = getProject(id);
  if (!original) return null;
  const now = new Date().toISOString();
  const copy: Project = {
    ...original,
    id:        createProjectId(),
    name:      original.name ? `${original.name} (copy)` : undefined,
    createdAt: now,
    updatedAt: now,
  };
  writeProjects([...readProjects(), copy]);
  return copy;
}

/** Format a date string for display (e.g. "Apr 5, 2026 · 2:30 PM"). */
export function formatProjectDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      + " · "
      + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/** Display name for a project (name → clientNum → "Untitled Project"). */
export function projectDisplayName(p: Project): string {
  return p.name || p.clientNum || "Untitled Project";
}

/**
 * List all projects for a given client number (case-insensitive trim match).
 * Returns newest-first.
 */
export function listProjectsByClientNum(clientNum: string): Project[] {
  const q = clientNum.trim().toLowerCase();
  if (!q) return [];
  return readProjects()
    .filter(p => p.clientNum.trim().toLowerCase() === q)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
