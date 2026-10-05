"use client";

import { useState } from "react";

type EventGalleryCoverProps = {
  title: string;
  clientName: string;
  imageUrl: string | null;
  imageFilter?: string;
  brandName: string;
  brandLogoUrl?: string | null;
  showStudioMark: boolean;
  metadata: string[];
  message: string;
  buttonLabel: string;
  onEnter: () => void;
  fontFamily: string;
  serifTitle: boolean;
  overlayOpacity: number;
};

/** A welcome screen before the album chooser, with one clear way forward. */
export function EventGalleryCover(props: EventGalleryCoverProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const showImage = !!props.imageUrl && props.imageUrl !== failedImageUrl;

  return <section aria-label={props.title} style={{ position: "fixed", inset: 0, zIndex: 80, overflowY: "auto", background: "#151719", color: "#fff", fontFamily: props.fontFamily }}>
    {showImage ? <img src={props.imageUrl!} alt="" fetchPriority="high" onError={() => setFailedImageUrl(props.imageUrl)}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: props.imageFilter }} /> : null}
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, rgba(0,0,0,0.22), rgba(0,0,0,${Math.max(0.3, Math.min(0.65, props.overlayOpacity))}) 50%, rgba(0,0,0,0.5))` }} />
    <div style={{ position: "relative", minHeight: "100%", boxSizing: "border-box", padding: "32px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
      {props.showStudioMark ? <header style={{ minHeight: 40, display: "grid", placeItems: "center" }}>
        {props.brandLogoUrl ? <img src={props.brandLogoUrl} alt={props.brandName} style={{ maxWidth: "min(200px, 70vw)", maxHeight: 44, objectFit: "contain" }} />
          : <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>{props.brandName}</span>}
      </header> : null}
      <div style={{ flex: 1, width: "100%", maxWidth: 940, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "32px 0 72px", textShadow: "0 2px 20px rgba(0,0,0,0.35)" }}>
        <h1 style={{ margin: 0, fontSize: props.serifTitle ? "clamp(38px, 5.5vw, 76px)" : "clamp(34px, 5vw, 68px)", lineHeight: 1.1, fontWeight: 600, letterSpacing: "-0.025em", overflowWrap: "anywhere" }}>{props.title}</h1>
        {props.clientName ? <p style={{ margin: "20px 0 0", fontSize: 14, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", lineHeight: 1.6, overflowWrap: "anywhere", maxWidth: "100%" }}>{props.clientName}</p> : null}
        {props.metadata.length ? <p style={{ margin: "18px 0 0", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", lineHeight: 1.8 }}>{props.metadata.join(" · ")}</p> : null}
        {props.message ? <p style={{ margin: "18px 0 0", maxWidth: 560, fontSize: 15, lineHeight: 1.7 }}>{props.message}</p> : null}
        <button type="button" autoFocus onClick={props.onEnter} style={{ marginTop: 30, minHeight: 48, padding: "12px 28px", border: "1px solid rgba(255,255,255,0.85)", borderRadius: 999, background: "rgba(0,0,0,0.16)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", backdropFilter: "blur(8px)" }}>{props.buttonLabel}</button>
      </div>
    </div>
  </section>;
}
