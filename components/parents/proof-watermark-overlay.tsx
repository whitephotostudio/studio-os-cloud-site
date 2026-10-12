import type { CSSProperties } from "react";
import { normalizeProofWatermarkOpacity, proofWatermarkOpacity } from "@/lib/proof-watermark";

/** Shared by gallery proofs and the photographer's settings preview. */
export function ProofWatermarkOverlay({
  text,
  logoUrl,
  opacity,
  variant = "wall",
}: {
  text: string;
  logoUrl?: string;
  opacity?: number | null;
  variant?: "wall" | "viewer";
}) {
  const isViewer = variant === "viewer";
  const customOpacity = normalizeProofWatermarkOpacity(opacity);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 4, borderRadius: 6 }} aria-hidden="true">
      <div style={{
        position: "absolute", top: isViewer ? "-28%" : "-50%", left: isViewer ? "-28%" : "-50%",
        width: isViewer ? "156%" : "200%", height: isViewer ? "156%" : "200%", transform: "rotate(-30deg)",
        display: "flex", flexDirection: "column", gap: isViewer ? (logoUrl ? 96 : 84) : logoUrl ? 64 : 48, justifyContent: "center",
      }}>
        {Array.from({ length: isViewer ? 10 : 20 }).map((_, row) => (
          <div key={row} style={{ display: "flex", gap: isViewer ? (logoUrl ? 108 : 92) : logoUrl ? 48 : 32, whiteSpace: "nowrap", paddingLeft: row % 2 === 0 ? 0 : isViewer ? 120 : 80, alignItems: "center" }}>
            {Array.from({ length: isViewer ? 6 : 12 }).map((_, col) => logoUrl ? (
              <img key={col} src={logoUrl} alt="" draggable={false} style={{
                width: isViewer ? 92 : 60, height: isViewer ? 92 : 60, objectFit: "contain",
                opacity: proofWatermarkOpacity(opacity, isViewer ? 0.16 : 0.22), userSelect: "none", pointerEvents: "none",
                filter: isViewer ? "drop-shadow(0 1px 2px rgba(0,0,0,0.14))" : "drop-shadow(0 0 2px rgba(0,0,0,0.4))",
              }} />
            ) : (
              <span key={col} style={{
                fontSize: isViewer ? 21 : 14, fontWeight: 700,
                color: customOpacity === null ? (isViewer ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.28)") : "#fff",
                opacity: customOpacity ?? 1, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "system-ui, sans-serif",
                textShadow: isViewer ? "0 1px 2px rgba(0,0,0,0.18)" : "0 0 4px rgba(0,0,0,0.5)",
                WebkitTextStroke: isViewer ? "0.25px rgba(0,0,0,0.08)" : "0.3px rgba(0,0,0,0.15)",
              } as CSSProperties}>{text}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
