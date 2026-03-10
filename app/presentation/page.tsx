"use client";
// app/presentation/page.tsx
//
// Placeholder — price presentation sheet (coming soon).

import { useRouter } from "next/navigation";

export default function PresentationPage() {
  const router = useRouter();

  return (
    <div style={{
      fontFamily: "sans-serif", minHeight: "100vh",
      backgroundColor: "#f5f2ee", display: "flex",
      alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "22px", fontWeight: "800", color: "#1a1a1a", marginBottom: "8px" }}>
          Price Presentation
        </h1>
        <p style={{ fontSize: "14px", color: "#888", marginBottom: "32px" }}>
          Coming soon — presentation sheet not yet built.
        </p>
        <button
          onClick={() => router.push("/worksheet")}
          style={{
            padding: "10px 22px", fontSize: "13px", fontWeight: "600",
            backgroundColor: "#fff", color: "#444",
            border: "1px solid #ccc", borderRadius: "7px", cursor: "pointer",
          }}
        >
          ← Back to Worksheet
        </button>
      </div>
    </div>
  );
}
