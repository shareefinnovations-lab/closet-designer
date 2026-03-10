// app/zones/page.tsx
//
// A simple demo page that shows two closet design zones on a wall.
// No database, no forms, no API routes — just a visual display.

import { computeDesignZones } from "@/src/lib/zone-computer";

// --- Example data (same as zone-test.ts) ---
const WALL_WIDTH_IN = 120;

const zones = computeDesignZones({
  wallWidthIn: WALL_WIDTH_IN,
  ceilingHeightIn: 96,
  returnWalls: [
    { side: "left", depthIn: 6, clearanceIn: 2 },
    { side: "right", depthIn: 6, clearanceIn: 2 },
  ],
  doorOpenings: [{ positionFromLeftIn: 52, widthIn: 8 }],
  obstacles: [],
});

// Colors for each zone block
const ZONE_COLORS = ["#4f86c6", "#e07b5a", "#5ab87e", "#b87abe"];

export default function ZonesPage() {
  return (
    <div style={{ fontFamily: "sans-serif", padding: "40px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>Closet Design Zones</h1>
      <p style={{ color: "#555", marginBottom: "32px" }}>
        Wall width: <strong>{WALL_WIDTH_IN} in</strong> &nbsp;|&nbsp; Zones found:{" "}
        <strong>{zones.length}</strong>
      </p>

      {/* --- Wall bar --- */}
      {/* The gray bar represents the full wall width. */}
      {/* Each colored block inside it is one usable design zone. */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "80px",
          backgroundColor: "#ddd",
          borderRadius: "4px",
          overflow: "hidden",
          marginBottom: "40px",
        }}
      >
        {zones.map((zone, index) => {
          // Convert inches to a percentage of the total wall width
          const leftPercent = (zone.startIn / WALL_WIDTH_IN) * 100;
          const widthPercent = (zone.usableWidthIn / WALL_WIDTH_IN) * 100;
          const color = ZONE_COLORS[index % ZONE_COLORS.length];

          return (
            <div
              key={index}
              style={{
                position: "absolute",
                left: `${leftPercent}%`,
                width: `${widthPercent}%`,
                height: "100%",
                backgroundColor: color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: "13px",
                fontWeight: "bold",
                boxSizing: "border-box",
                padding: "4px",
                textAlign: "center",
              }}
            >
              Zone {zone.sortOrder}
            </div>
          );
        })}
      </div>

      {/* --- Zone detail cards --- */}
      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
        {zones.map((zone, index) => {
          const color = ZONE_COLORS[index % ZONE_COLORS.length];

          return (
            <div
              key={index}
              style={{
                border: `3px solid ${color}`,
                borderRadius: "8px",
                padding: "20px 24px",
                minWidth: "180px",
              }}
            >
              <h2 style={{ margin: "0 0 12px 0", color, fontSize: "18px" }}>
                Zone {zone.sortOrder}
              </h2>
              <table style={{ borderSpacing: "0 6px", borderCollapse: "separate" }}>
                <tbody>
                  <tr>
                    <td style={{ color: "#888", paddingRight: "12px" }}>Start</td>
                    <td>
                      <strong>{zone.startIn} in</strong>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: "#888", paddingRight: "12px" }}>End</td>
                    <td>
                      <strong>{zone.endIn} in</strong>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: "#888", paddingRight: "12px" }}>Usable width</td>
                    <td>
                      <strong>{zone.usableWidthIn} in</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
