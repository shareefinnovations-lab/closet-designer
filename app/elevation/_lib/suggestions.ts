// app/elevation/_lib/suggestions.ts
//
// "Designing Lite" starter layout generator.
// Reads client remarks and builds a simple foundation layout:
//   Step 1 — Long hang sections  (dresses / coats / jackets / long clothing)
//   Step 2 — Shelf section       (folded / storage / shoes / handbags)
//   Step 3 — One drawer section  (drawers / accessories / underwear / organization)
//   Step 4 — Fill remaining wall with double hang sections
// Pure function — no React, no side effects.

import { LOCK_H_IN, DRAWER_MIN_DEPTH, MIN_DEPTH } from "./constants";
import { defaultPanelHeight } from "./helpers";
import type { Config, Section, ClosetComponent } from "./types";

// ─── Keyword groups ───────────────────────────────────────────────────────────

const LONG_HANG_KEYWORDS = ["dress", "dresses", "coat", "coats", "jacket", "jackets", "long"];
const SHELF_KEYWORDS     = ["folded", "folding", "fold", "storage", "shoe", "shoes", "handbag", "handbags", "bag", "bags"];
const DRAWER_KEYWORDS    = ["drawer", "drawers", "accessory", "accessories", "underwear", "organization", "organize"];

function has(text: string, keywords: string[]): boolean {
  return keywords.some(k => text.includes(k));
}

// ─── Component factories ──────────────────────────────────────────────────────

let _nextId = 100; // start high to avoid collisions with user-added components
function nextId() { return _nextId++; }

function makeRod(positionIn: number): ClosetComponent {
  return { id: nextId(), type: "Rod", positionIn, drawerHeights: [] };
}

function makeShelf(positionIn: number): ClosetComponent {
  return { id: nextId(), type: "Shelf", positionIn, drawerHeights: [] };
}

function makeDrawerStack(sectionH: number): ClosetComponent {
  // Default: 3 drawers
  const heights    = [10, 10, 10];
  const totalH     = heights.reduce((s, h) => s + h, 0);
  const positionIn = Math.max(LOCK_H_IN, sectionH - LOCK_H_IN - totalH);
  return { id: nextId(), type: "DrawerStack", positionIn, drawerHeights: heights };
}

// ─── Section builders ─────────────────────────────────────────────────────────

// Long Hang: 1 rod near top + 1 shelf in the lower quarter (for shoes/folded below hang)
function longHangSection(widthIn: number, sectionH: number): Section {
  const rod   = makeRod(LOCK_H_IN + 8);
  const shelf = makeShelf(Math.round(sectionH * 0.75));
  return { widthIn, depthIn: MIN_DEPTH, components: [rod, shelf] };
}

// Double Hang: 2 rods stacked (upper and lower hanging space)
function doubleHangSection(widthIn: number, sectionH: number): Section {
  const topRod    = makeRod(LOCK_H_IN + 8);
  const bottomRod = makeRod(Math.round(sectionH * 0.5));
  return { widthIn, depthIn: MIN_DEPTH, components: [topRod, bottomRod] };
}

// Shelf: 3 evenly-spaced adjustable shelves
function shelfSection(widthIn: number, sectionH: number): Section {
  const numShelves = 3;
  const spacing    = Math.floor(sectionH / (numShelves + 1));
  const components: ClosetComponent[] = Array.from({ length: numShelves }, (_, i) =>
    makeShelf(LOCK_H_IN + spacing * (i + 1))
  );
  return { widthIn, depthIn: MIN_DEPTH, components };
}

// Drawer: 1 stack of 3 drawers (standard starter)
function drawerSection(widthIn: number, sectionH: number): Section {
  return { widthIn, depthIn: DRAWER_MIN_DEPTH, components: [makeDrawerStack(sectionH)] };
}

// Empty fallback
function emptySection(widthIn: number): Section {
  return { widthIn, depthIn: MIN_DEPTH, components: [] };
}

// ─── Width distribution ───────────────────────────────────────────────────────

// Target section width for calculating how many sections fit the wall.
const TYPICAL_SECTION_W = 24;

function distributeWidths(wallW: number, count: number): number[] {
  const base  = Math.floor(wallW / count);
  const extra = wallW - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

// ─── Main generator ───────────────────────────────────────────────────────────

export interface SuggestionResult {
  sections:     Section[];
  panelHeights: number[];
  appliedRules: string[];  // human-readable list of what was applied
}

export function generateSuggestion(config: Config): SuggestionResult {
  const text     = config.remarks.toLowerCase().trim();
  const wallW    = config.wallWidthIn;
  const panelH   = defaultPanelHeight(config.ceilingHeightIn);
  const sectionH = panelH;

  const wantsLongHang = has(text, LONG_HANG_KEYWORDS);
  const wantsShelves  = has(text, SHELF_KEYWORDS);
  const wantsDrawers  = has(text, DRAWER_KEYWORDS);
  const appliedRules: string[] = [];

  // ── No remarks / no keywords → plain double hang layout ──────────────────
  const hasAnyKeyword = wantsLongHang || wantsShelves || wantsDrawers;
  if (!hasAnyKeyword || text === "") {
    const count    = Math.max(2, Math.round(wallW / TYPICAL_SECTION_W));
    const widths   = distributeWidths(wallW, count);
    const sections = widths.map(w => doubleHangSection(w, sectionH));
    return {
      sections,
      panelHeights: Array.from({ length: count + 1 }, () => panelH),
      appliedRules: ["No specific needs detected — double hang layout created."],
    };
  }

  // ── Steps 1–3: Foundation needs ───────────────────────────────────────────

  type Builder = (w: number) => Section;
  const foundation: Array<{ build: Builder; label: string }> = [];

  // Step 1 — Long hang
  if (wantsLongHang) {
    foundation.push({
      build: (w) => longHangSection(w, sectionH),
      label: "Long hanging needed (dresses/coats/jackets) → long hang section added",
    });
  }

  // Step 2 — Shelves
  if (wantsShelves) {
    foundation.push({
      build: (w) => shelfSection(w, sectionH),
      label: "Shelves needed (folded/storage/shoes/handbags) → shelf section added",
    });
  }

  // Step 3 — One drawer section only (never more)
  if (wantsDrawers) {
    foundation.push({
      build: (w) => drawerSection(w, sectionH),
      label: "Drawers needed (drawers/accessories/underwear/organization) → drawer section (3 drawers) added",
    });
  }

  for (const f of foundation) appliedRules.push(f.label);

  // ── Step 4 — Fill remaining space with double hang ────────────────────────
  const totalCount = Math.max(foundation.length + 1, Math.round(wallW / TYPICAL_SECTION_W));
  const fillCount  = totalCount - foundation.length;
  appliedRules.push(
    `Remaining ${fillCount} section${fillCount !== 1 ? "s" : ""} filled with double hang`
  );

  // ── Distribute widths evenly across all sections ──────────────────────────
  const widths   = distributeWidths(wallW, totalCount);
  const sections: Section[] = [
    ...foundation.map((f, i) => f.build(widths[i])),
    ...Array.from({ length: fillCount }, (_, i) =>
      doubleHangSection(widths[foundation.length + i], sectionH)
    ),
  ];

  return {
    sections,
    panelHeights: Array.from({ length: totalCount + 1 }, () => panelH),
    appliedRules,
  };
}
