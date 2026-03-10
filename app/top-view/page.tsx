// app/top-view/page.tsx
//
// Closet Top View (Plan View)
// A simple bird's-eye drawing of one closet wall.
// Shows the wall width, closet depth, and both return wall conditions.
// Static page — no state, no forms, no database, no drag-and-drop.

export default function TopViewPage() {

  // ─── Dimensions (inches) ─────────────────────────────────────────────────
  // These are the real-world measurements this page visualises.

  const WALL_W       = 66;    // total wall width
  const DEPTH        = 25;    // closet depth (back wall → front opening)
  const LEFT_RETURN  = 0.5;   // left return wall thickness
  const RIGHT_RETURN = 2.5;   // right return wall thickness

  // ─── Drawing scale ────────────────────────────────────────────────────────
  // 1 inch = SCALE pixels on screen.
  const SCALE = 6;

  // ─── SVG canvas padding ───────────────────────────────────────────────────
  const PAD_LEFT   = 80;   // room for the 0.5" callout label on the left
  const PAD_TOP    = 70;   // room for the 66" dimension line above
  const PAD_RIGHT  = 90;   // room for the 25" depth dimension on the right
  const PAD_BOTTOM = 80;   // room for the front-opening label + return labels

  // ─── Pixel dimensions ─────────────────────────────────────────────────────
  const wallWpx    = WALL_W       * SCALE;   // 396 px
  const depthPx    = DEPTH        * SCALE;   // 150 px
  const leftRetPx  = LEFT_RETURN  * SCALE;   //   3 px  (thin but correct to scale)
  const rightRetPx = RIGHT_RETURN * SCALE;   //  15 px

  const svgW = PAD_LEFT + wallWpx + PAD_RIGHT;   // total SVG width
  const svgH = PAD_TOP  + depthPx + PAD_BOTTOM;  // total SVG height

  // Top-left corner of the closet rectangle in SVG coordinates
  const wx = PAD_LEFT;
  const wy = PAD_TOP;

  // ─── Colors ───────────────────────────────────────────────────────────────
  const C_WALL     = "#6b7280";   // return wall fill — medium grey
  const C_INTERIOR = "#f5f0e8";   // open interior — warm off-white
  const C_FRAME    = "#1f2937";   // structural border — near-black
  const C_DIM      = "#666";      // dimension lines and labels
  const C_OPEN     = "#5a9abf";   // front opening — blue to stand out
  const C_HATCH    = "#c0bab5";   // back wall hatch lines

  // ─── Derived positions (used repeatedly in the SVG) ───────────────────────
  const rightRetX = wx + wallWpx - rightRetPx;   // left edge of right return wall
  const frontY    = wy + depthPx;                // y of front opening

  return (
    <div style={{ fontFamily: "sans-serif", padding: "40px", maxWidth: "760px", margin: "0 auto" }}>

      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <h1 style={{ fontSize: "22px", fontWeight: "700", marginBottom: "4px", color: "#111" }}>
        Closet Top View
      </h1>
      <p style={{ fontSize: "14px", color: "#777", marginTop: "0", marginBottom: "8px" }}>
        Plan view from above — looking straight down at the closet footprint.
      </p>

      {/* Quick-reference table so the numbers are readable at a glance */}
      <div style={{
        display: "inline-flex", gap: "24px",
        fontSize: "13px", color: "#555",
        backgroundColor: "#f7f5f2", border: "1px solid #e0dbd4",
        borderRadius: "6px", padding: "10px 18px",
        marginBottom: "32px",
      }}>
        <span>Wall width: <strong>{WALL_W}&Prime;</strong></span>
        <span>Depth: <strong>{DEPTH}&Prime;</strong></span>
        <span>Left return: <strong>{LEFT_RETURN}&Prime;</strong></span>
        <span>Right return: <strong>{RIGHT_RETURN}&Prime;</strong></span>
      </div>

      {/* ── SVG Drawing ───────────────────────────────────────────────────── */}
      <svg
        width={svgW}
        height={svgH}
        style={{ display: "block", overflow: "visible" }}
        aria-label="Closet plan view"
      >
        {/* ═══════════════════════════════════════════════════════════════════
            DEFS — back-wall hatch pattern
            Diagonal lines drawn at 45°, used inside the back wall band.
        ═══════════════════════════════════════════════════════════════════ */}
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={C_HATCH} strokeWidth="1.5" />
          </pattern>
        </defs>

        {/* ═══════════════════════════════════════════════════════════════════
            CLOSET BODY
        ═══════════════════════════════════════════════════════════════════ */}

        {/* 1. Interior fill — the open space inside the closet */}
        <rect x={wx} y={wy} width={wallWpx} height={depthPx} fill={C_INTERIOR} />

        {/* 2. Back wall band — a hatched strip along the top edge.
               In a plan view, walls are shown with hatching to indicate solid material.
               The back wall is the room wall the closet sits against. */}
        <rect x={wx} y={wy} width={wallWpx} height={10}
          fill="url(#hatch)" stroke={C_FRAME} strokeWidth={2} />

        {/* 3. Left return wall — 0.5" thick, runs the full depth */}
        <rect x={wx} y={wy} width={leftRetPx} height={depthPx}
          fill={C_WALL} stroke={C_FRAME} strokeWidth={0.5} />

        {/* 4. Right return wall — 2.5" thick, runs the full depth */}
        <rect x={rightRetX} y={wy} width={rightRetPx} height={depthPx}
          fill={C_WALL} stroke={C_FRAME} strokeWidth={0.5} />

        {/* 5. Outer structural frame — three sides (no bottom = front is open)
               Drawn as a path so the front opening is left without a line. */}
        <path
          d={`M ${wx} ${frontY} L ${wx} ${wy} L ${wx + wallWpx} ${wy} L ${wx + wallWpx} ${frontY}`}
          fill="none" stroke={C_FRAME} strokeWidth={2.5}
        />

        {/* ═══════════════════════════════════════════════════════════════════
            FRONT OPENING
            A dashed blue line shows the open face of the closet.
        ═══════════════════════════════════════════════════════════════════ */}
        <line
          x1={wx} y1={frontY}
          x2={wx + wallWpx} y2={frontY}
          stroke={C_OPEN} strokeWidth={2} strokeDasharray="10 6"
        />

        {/* ═══════════════════════════════════════════════════════════════════
            TEXT LABELS INSIDE THE DRAWING
        ═══════════════════════════════════════════════════════════════════ */}

        {/* "Back Wall" label sits just above the drawing */}
        <text x={wx + wallWpx / 2} y={wy - 16}
          textAnchor="middle" fontSize={11} fill="#555" fontWeight="600">
          Back Wall
        </text>

        {/* "Front Opening" label below the dashed line */}
        <text x={wx + wallWpx / 2} y={frontY + 18}
          textAnchor="middle" fontSize={11} fill={C_OPEN} fontWeight="600">
          Front Opening
        </text>

        {/* Interior label in the centre of the open space */}
        <text x={wx + wallWpx / 2} y={wy + depthPx / 2 + 4}
          textAnchor="middle" fontSize={12} fill="#bbb" fontStyle="italic">
          Interior
        </text>

        {/* "2.5"" label inside the right return wall (rotated to fit vertically) */}
        <text
          x={rightRetX + rightRetPx / 2}
          y={wy + depthPx / 2}
          textAnchor="middle" fontSize={9} fill="#fff" fontWeight="bold"
          transform={`rotate(-90, ${rightRetX + rightRetPx / 2}, ${wy + depthPx / 2})`}
        >
          2.5&Prime;
        </text>

        {/* ═══════════════════════════════════════════════════════════════════
            DIMENSION ANNOTATIONS
        ═══════════════════════════════════════════════════════════════════ */}

        {/* ── Wall width: 66" — horizontal line above the drawing ── */}
        {/* Dimension line */}
        <line x1={wx} y1={wy - 36} x2={wx + wallWpx} y2={wy - 36}
          stroke={C_DIM} strokeWidth={1} />
        {/* End ticks */}
        <line x1={wx}            y1={wy - 41} x2={wx}            y2={wy - 31} stroke={C_DIM} strokeWidth={1} />
        <line x1={wx + wallWpx}  y1={wy - 41} x2={wx + wallWpx}  y2={wy - 31} stroke={C_DIM} strokeWidth={1} />
        {/* Label */}
        <text x={wx + wallWpx / 2} y={wy - 43}
          textAnchor="middle" fontSize={12} fill={C_DIM}>
          {WALL_W}&Prime;
        </text>

        {/* ── Closet depth: 25" — vertical line to the right ── */}
        {/* Dimension line */}
        <line x1={wx + wallWpx + 36} y1={wy} x2={wx + wallWpx + 36} y2={frontY}
          stroke={C_DIM} strokeWidth={1} />
        {/* End ticks */}
        <line x1={wx + wallWpx + 31} y1={wy}     x2={wx + wallWpx + 41} y2={wy}     stroke={C_DIM} strokeWidth={1} />
        <line x1={wx + wallWpx + 31} y1={frontY}  x2={wx + wallWpx + 41} y2={frontY}  stroke={C_DIM} strokeWidth={1} />
        {/* Label — rotated so it reads top-to-bottom */}
        <text
          x={wx + wallWpx + 56}
          y={wy + depthPx / 2}
          textAnchor="middle" fontSize={12} fill={C_DIM}
          transform={`rotate(-90, ${wx + wallWpx + 56}, ${wy + depthPx / 2})`}
        >
          {DEPTH}&Prime;
        </text>

        {/* ── Left return: 0.5"
               Because the wall is only 3 px wide, we use a leader line
               that points from the wall face out to a label on the left.
        ── */}
        {/* Vertical leader line down from the bottom-left corner of left return */}
        <line x1={wx + leftRetPx / 2} y1={frontY}
              x2={wx + leftRetPx / 2} y2={frontY + 28}
          stroke={C_DIM} strokeWidth={0.8} />
        {/* Horizontal line going left to the label */}
        <line x1={wx + leftRetPx / 2} y1={frontY + 28}
              x2={wx - 10}             y2={frontY + 28}
          stroke={C_DIM} strokeWidth={0.8} />
        {/* Arrow dot at the wall */}
        <circle cx={wx + leftRetPx / 2} cy={frontY} r={2} fill={C_DIM} />
        {/* Label */}
        <text x={wx - 13} y={frontY + 32}
          textAnchor="end" fontSize={11} fill={C_DIM}>
          {LEFT_RETURN}&Prime; return
        </text>

        {/* ── Right return: 2.5"
               A leader line from the bottom-right corner of the right return.
        ── */}
        {/* Vertical leader line down */}
        <line x1={rightRetX + rightRetPx / 2} y1={frontY}
              x2={rightRetX + rightRetPx / 2} y2={frontY + 28}
          stroke={C_DIM} strokeWidth={0.8} />
        {/* Horizontal line going right */}
        <line x1={rightRetX + rightRetPx / 2} y1={frontY + 28}
              x2={wx + wallWpx + 10}           y2={frontY + 28}
          stroke={C_DIM} strokeWidth={0.8} />
        {/* Arrow dot */}
        <circle cx={rightRetX + rightRetPx / 2} cy={frontY} r={2} fill={C_DIM} />
        {/* Label */}
        <text x={wx + wallWpx + 13} y={frontY + 32}
          textAnchor="start" fontSize={11} fill={C_DIM}>
          {RIGHT_RETURN}&Prime; return
        </text>

      </svg>

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div style={{ marginTop: "32px", fontSize: "13px", color: "#777" }}>
        <div style={{ fontWeight: "600", color: "#444", marginBottom: "6px" }}>Legend</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {/* Hatched back wall swatch */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <svg width={24} height={14}>
              <rect width={24} height={14} fill={`url(#hatch)`} stroke="#333" strokeWidth={1} />
              <defs>
                <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke={C_HATCH} strokeWidth="1.5" />
                </pattern>
              </defs>
            </svg>
            <span>Back wall (room wall)</span>
          </div>
          {/* Return wall swatch */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <svg width={24} height={14}>
              <rect width={24} height={14} fill={C_WALL} stroke="#333" strokeWidth={1} />
            </svg>
            <span>Return walls (left 0.5&Prime; / right 2.5&Prime;)</span>
          </div>
          {/* Interior swatch */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <svg width={24} height={14}>
              <rect width={24} height={14} fill={C_INTERIOR} stroke="#aaa" strokeWidth={1} />
            </svg>
            <span>Open interior space</span>
          </div>
          {/* Front opening swatch */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <svg width={24} height={14}>
              <line x1={0} y1={7} x2={24} y2={7} stroke={C_OPEN} strokeWidth={2} strokeDasharray="5 3" />
            </svg>
            <span>Front opening (no wall)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
