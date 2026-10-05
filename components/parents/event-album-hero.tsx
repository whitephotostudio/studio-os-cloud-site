"use client";

import { useState } from "react";
import type { EventGalleryBrandingSettings } from "@/lib/event-gallery-settings";
import { retryPortalPreviewImage } from "@/lib/portal-preview-retry";

/** Optional cover header inside the selected album's photo browser. */
export function EventAlbumHero(props: {
  title: string;
  imageUrl: string | null;
  imageFilter?: string;
  metadata: string[];
  branding: EventGalleryBrandingSettings;
  tone: { background: string; text: string; mutedText: string; border: string };
  overlayOpacity: number;
  accentColor: string;
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const showImage = !!props.imageUrl && failedImageUrl !== props.imageUrl;
  const centered = props.branding.heroTextAlign === "center";
  return <header className="event-album-hero" style={{ position: "relative", overflow: "hidden", background: props.tone.background, color: showImage ? "#ffffff" : props.tone.text, border: `1px solid ${props.tone.border}`, borderRadius: props.branding.themePreset === "editorial" ? 0 : 8 }}>
    <style>{`.event-album-hero .event-album-hero-content { min-height: 260px; padding: 40px 32px; } @media(max-width:560px) { .event-album-hero .event-album-hero-content { min-height: 180px; padding: 28px 22px; } }`}</style>
    {showImage ? <>
      <img src={props.imageUrl!} alt="" loading="lazy" onError={event => {
        if (retryPortalPreviewImage(event.currentTarget)) return;
        setFailedImageUrl(props.imageUrl);
      }} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: props.imageFilter }} />
      <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${props.overlayOpacity})` }} />
    </> : null}
    <div className="event-album-hero-content" style={{ position: "relative", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: centered ? "center" : "flex-start", textAlign: centered ? "center" : "left", gap: 16 }}>
      <span aria-hidden="true" style={{ width: 40, height: 3, background: props.accentColor }} />
      <h2 style={{ margin: 0, maxWidth: "100%", fontSize: "clamp(28px, 3.5vw, 48px)", lineHeight: 1.15, fontWeight: props.branding.themePreset === "editorial" ? 400 : 600, fontStyle: props.branding.themePreset === "editorial" ? "italic" : undefined, textTransform: props.branding.themePreset === "cinema" ? "uppercase" : undefined, letterSpacing: props.branding.themePreset === "cinema" ? "0.06em" : "-0.025em", overflowWrap: "anywhere", textShadow: showImage ? "0 2px 18px rgba(0,0,0,0.35)" : undefined }}>{props.title}</h2>
      {props.metadata.length ? <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7 }}>{props.metadata.join(" · ")}</p> : null}
    </div>
  </header>;
}
