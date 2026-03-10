"use client";

import { useState } from "react";

// How many pixels represent 1 inch in the SVG drawings
const PX = 3;

export default function ClosetDesigner() {
  // --- Height settings ---
  const [ceilingHeight, setCeilingHeight] = useState(101); // inches
  const [systemHeight, setSystemHeight]   = useState(84);  // inches

  // --- Other dimensions ---
  const [wallWidth, setWallWidth]     = useState(96); // inches (8 ft)
  const [closetDepth, setClosetDepth] = useState(24); // inches (2 ft) — used in Top View

  // --- Rule: system height cannot exceed ceiling height ---
  const safeSystem  = Math.min(systemHeight, ceilingHeight);
  const spaceAbove  = ceilingHeight - safeSystem;
  const isOverLimit = systemHeight > ceilingHeight;

  // ─────────────────────────────────────────────
  // Front View SVG layout
  // ─────────────────────────────────────────────
  const frontLeftMargin  = 70;  // room for the left dimension label
  const frontRightMargin = 80;  // room for the right dimension label
  const frontTopMargin   = 30;
  const frontSvgWidth    = frontLeftMargin + wallWidth * PX + frontRightMargin;
  const frontSvgHeight   = frontTopMargin  + ceilingHeight * PX + 40;

  // Key Y positions (SVG y=0 is top)
  const ceilingY   = frontTopMargin;
  const floorY     = frontTopMargin + ceilingHeight * PX;
  const systemTopY = frontTopMargin + spaceAbove * PX; // system sits below the gap

  // ─────────────────────────────────────────────
  // Top View SVG layout
  // ─────────────────────────────────────────────
  const topLeftMargin = 50;
  const topTopMargin  = 30;
  const topSvgWidth   = topLeftMargin + wallWidth * PX + 60;
  const topSvgHeight  = topTopMargin  + closetDepth * PX + 50;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "28px", background: "#f5f5f5", minHeight: "100vh" }}>

      <h1 style={{ fontSize: "22px", fontWeight: "bold", color: "#111", marginBottom: "24px" }}>
        Closet Designer Workspace
      </h1>

      {/* ══════════════════════════════════════
          SETTINGS PANEL
      ══════════════════════════════════════ */}
      <div style={card}>
        <h2 style={sectionTitle}>Height Settings</h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
          <NumberInput
            label="Ceiling Height (inches)"
            value={ceilingHeight}
            min={1}
            onChange={(v) => setCeilingHeight(v)}
          />
          <NumberInput
            label="System Height (inches)"
            value={systemHeight}
            min={1}
            onChange={(v) => setSystemHeight(v)}
          />
          <NumberInput
            label="Wall Width (inches)"
            value={wallWidth}
            min={1}
            onChange={(v) => setWallWidth(v)}
          />
        </div>

        {/* Warning when user types a value over the ceiling */}
        {isOverLimit && (
          <div style={{ color: "#b91c1c", fontSize: "13px", marginBottom: "10px" }}>
            System height cannot exceed ceiling height. Drawing is clamped to {ceilingHeight}&quot;.
          </div>
        )}

        {/* Summary box */}
        <div style={summaryBox}>
          <div><strong>Ceiling Height:</strong> {ceilingHeight}&quot; &nbsp;({(ceilingHeight / 12).toFixed(1)} ft)</div>
          <div><strong>System Height:</strong>  {safeSystem}&quot; &nbsp;({(safeSystem / 12).toFixed(1)} ft)</div>
          <div><strong>Space Above System:</strong> {spaceAbove}&quot; &nbsp;({(spaceAbove / 12).toFixed(1)} ft)</div>
        </div>
      </div>

      {/* ══════════════════════════════════════
          FRONT VIEW (ELEVATION)
      ══════════════════════════════════════ */}
      <div style={{ ...card, overflowX: "auto" }}>
        <h2 style={sectionTitle}>Front View (Elevation)</h2>

        <svg width={frontSvgWidth} height={frontSvgHeight} style={{ display: "block" }}>

          {/* ── Empty space above the closet system (light blue tint) ── */}
          {spaceAbove > 0 && (
            <rect
              x={frontLeftMargin}
              y={ceilingY}
              width={wallWidth * PX}
              height={spaceAbove * PX}
              fill="#eef2ff"
            />
          )}

          {/* ── Closet system body ── */}
          <rect
            x={frontLeftMargin}
            y={systemTopY}
            width={wallWidth * PX}
            height={safeSystem * PX}
            fill="#e8ddd0"
            stroke="#7c5c3c"
            strokeWidth={1.5}
          />

          {/* ── Ceiling line ── */}
          <line
            x1={frontLeftMargin} y1={ceilingY}
            x2={frontLeftMargin + wallWidth * PX} y2={ceilingY}
            stroke="#111" strokeWidth={2}
          />

          {/* ── Floor line ── */}
          <line
            x1={frontLeftMargin} y1={floorY}
            x2={frontLeftMargin + wallWidth * PX} y2={floorY}
            stroke="#111" strokeWidth={3}
          />

          {/* ── Left wall ── */}
          <line
            x1={frontLeftMargin} y1={ceilingY}
            x2={frontLeftMargin} y2={floorY}
            stroke="#111" strokeWidth={2}
          />

          {/* ── Right wall ── */}
          <line
            x1={frontLeftMargin + wallWidth * PX} y1={ceilingY}
            x2={frontLeftMargin + wallWidth * PX} y2={floorY}
            stroke="#111" strokeWidth={2}
          />

          {/* ── Dashed line at top of closet system ── */}
          <line
            x1={frontLeftMargin} y1={systemTopY}
            x2={frontLeftMargin + wallWidth * PX} y2={systemTopY}
            stroke="#7c5c3c" strokeWidth={1.5} strokeDasharray="8,4"
          />

          {/* ── "Open space" label in the gap above ── */}
          {spaceAbove > 3 && (
            <text
              x={frontLeftMargin + (wallWidth * PX) / 2}
              y={ceilingY + (spaceAbove * PX) / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#6b7280"
              fontSize={12}
              fontStyle="italic"
            >
              {`${spaceAbove}" open space`}
            </text>
          )}

          {/* ── "Closet System" label inside the system body ── */}
          <text
            x={frontLeftMargin + (wallWidth * PX) / 2}
            y={systemTopY + (safeSystem * PX) / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#4a3728"
            fontSize={13}
            fontWeight="bold"
          >
            Closet System
          </text>

          {/* ── "Ceiling" label at top ── */}
          <text
            x={frontLeftMargin + (wallWidth * PX) / 2}
            y={ceilingY - 12}
            textAnchor="middle"
            fill="#6b7280"
            fontSize={11}
          >
            Ceiling
          </text>

          {/* ── "Floor" label at bottom ── */}
          <text
            x={frontLeftMargin + (wallWidth * PX) / 2}
            y={floorY + 18}
            textAnchor="middle"
            fill="#6b7280"
            fontSize={11}
          >
            Floor
          </text>

          {/* ════════════════════════════════
              LEFT DIMENSION: Ceiling Height
          ════════════════════════════════ */}
          <DimLine
            x={frontLeftMargin - 22}
            y1={ceilingY}
            y2={floorY}
            color="#2563eb"
            label={`Ceiling: ${ceilingHeight}"`}
            labelOffset={-38}
          />

          {/* ════════════════════════════════
              RIGHT DIMENSION: System Height
          ════════════════════════════════ */}
          <DimLineRight
            x={frontLeftMargin + wallWidth * PX + 22}
            y1={systemTopY}
            y2={floorY}
            color="#16a34a"
            label={`System: ${safeSystem}"`}
            labelOffset={52}
          />

        </svg>
      </div>

      {/* ══════════════════════════════════════
          TOP VIEW (OVERHEAD) — unchanged area
      ══════════════════════════════════════ */}
      <div style={{ ...card, overflowX: "auto" }}>
        <h2 style={sectionTitle}>Top View (Overhead)</h2>

        <div style={{ marginBottom: "12px" }}>
          <NumberInput
            label="Closet Depth (inches)"
            value={closetDepth}
            min={1}
            onChange={(v) => setClosetDepth(v)}
          />
        </div>

        <svg width={topSvgWidth} height={topSvgHeight} style={{ display: "block" }}>

          {/* Closet footprint rectangle */}
          <rect
            x={topLeftMargin}
            y={topTopMargin}
            width={wallWidth * PX}
            height={closetDepth * PX}
            fill="#e8ddd0"
            stroke="#7c5c3c"
            strokeWidth={1.5}
          />

          {/* Back wall — thick line at the top */}
          <line
            x1={topLeftMargin} y1={topTopMargin}
            x2={topLeftMargin + wallWidth * PX} y2={topTopMargin}
            stroke="#111" strokeWidth={3}
          />

          {/* Center label */}
          <text
            x={topLeftMargin + (wallWidth * PX) / 2}
            y={topTopMargin + (closetDepth * PX) / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#4a3728"
            fontSize={12}
            fontWeight="bold"
          >
            {`${wallWidth}" wide × ${closetDepth}" deep`}
          </text>

          {/* Width dimension line below the footprint */}
          <line
            x1={topLeftMargin}
            y1={topTopMargin + closetDepth * PX + 16}
            x2={topLeftMargin + wallWidth * PX}
            y2={topTopMargin + closetDepth * PX + 16}
            stroke="#7c5c3c" strokeWidth={1}
          />
          <line
            x1={topLeftMargin} y1={topTopMargin + closetDepth * PX + 10}
            x2={topLeftMargin} y2={topTopMargin + closetDepth * PX + 22}
            stroke="#7c5c3c" strokeWidth={1}
          />
          <line
            x1={topLeftMargin + wallWidth * PX} y1={topTopMargin + closetDepth * PX + 10}
            x2={topLeftMargin + wallWidth * PX} y2={topTopMargin + closetDepth * PX + 22}
            stroke="#7c5c3c" strokeWidth={1}
          />
          <text
            x={topLeftMargin + (wallWidth * PX) / 2}
            y={topTopMargin + closetDepth * PX + 36}
            textAnchor="middle"
            fill="#7c5c3c"
            fontSize={11}
          >
            {`${wallWidth}"`}
          </text>

        </svg>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────
// Helper: reusable number input with label
// ─────────────────────────────────────────────
function NumberInput({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={{ fontSize: "12px", color: "#555", fontWeight: "500" }}>{label}</span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (v >= min) onChange(v);
        }}
        style={{
          padding: "6px 10px",
          border: "1px solid #ccc",
          borderRadius: "4px",
          width: "150px",
          fontSize: "14px",
        }}
      />
    </label>
  );
}

// ─────────────────────────────────────────────
// Helper: vertical dimension line on the LEFT side
// Draws a line from y1 to y2 at a given x, with tick marks and a rotated label.
// ─────────────────────────────────────────────
function DimLine({
  x,
  y1,
  y2,
  color,
  label,
  labelOffset,
}: {
  x: number;
  y1: number;
  y2: number;
  color: string;
  label: string;
  labelOffset: number; // negative = move label further left
}) {
  const midY = (y1 + y2) / 2;
  return (
    <g>
      {/* Main vertical line */}
      <line x1={x} y1={y1} x2={x} y2={y2} stroke={color} strokeWidth={1} />
      {/* Top tick */}
      <line x1={x - 6} y1={y1} x2={x + 6} y2={y1} stroke={color} strokeWidth={1} />
      {/* Bottom tick */}
      <line x1={x - 6} y1={y2} x2={x + 6} y2={y2} stroke={color} strokeWidth={1} />
      {/* Rotated label */}
      <text
        x={x + labelOffset}
        y={midY}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={11}
        transform={`rotate(-90, ${x + labelOffset}, ${midY})`}
      >
        {label}
      </text>
    </g>
  );
}

// ─────────────────────────────────────────────
// Helper: vertical dimension line on the RIGHT side
// ─────────────────────────────────────────────
function DimLineRight({
  x,
  y1,
  y2,
  color,
  label,
  labelOffset,
}: {
  x: number;
  y1: number;
  y2: number;
  color: string;
  label: string;
  labelOffset: number; // positive = move label further right
}) {
  const midY = (y1 + y2) / 2;
  return (
    <g>
      {/* Main vertical line */}
      <line x1={x} y1={y1} x2={x} y2={y2} stroke={color} strokeWidth={1} />
      {/* Top tick */}
      <line x1={x - 6} y1={y1} x2={x + 6} y2={y1} stroke={color} strokeWidth={1} />
      {/* Bottom tick */}
      <line x1={x - 6} y1={y2} x2={x + 6} y2={y2} stroke={color} strokeWidth={1} />
      {/* Rotated label */}
      <text
        x={x + labelOffset}
        y={midY}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={11}
        transform={`rotate(90, ${x + labelOffset}, ${midY})`}
      >
        {label}
      </text>
    </g>
  );
}

// ─────────────────────────────────────────────
// Shared styles
// ─────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: "8px",
  padding: "20px",
  boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
  marginBottom: "20px",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: "600",
  color: "#222",
  marginBottom: "14px",
  marginTop: 0,
};

const summaryBox: React.CSSProperties = {
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: "6px",
  padding: "10px 14px",
  fontSize: "13px",
  color: "#1d4ed8",
  lineHeight: "1.8",
};
