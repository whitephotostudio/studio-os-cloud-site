"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Images } from "lucide-react";
import type { EventAlbumChoice } from "@/lib/event-album-navigation";

type AlbumNavigationProps = {
  choices: EventAlbumChoice[];
  onSelect: (value: string) => void;
  hidePhotoCount: boolean;
  photoLabel: string;
  photosLabel: string;
};

function photoCount(choice: EventAlbumChoice, props: AlbumNavigationProps) {
  return `${choice.photoCount} ${choice.photoCount === 1 ? props.photoLabel : props.photosLabel}`;
}

function AlbumThumbnail({ choice, size = 48 }: { choice: EventAlbumChoice; size?: number }) {
  return <span style={{ width: size, height: size, flex: "0 0 auto", background: "#e4e4e7", borderRadius: 6, overflow: "hidden", display: "grid", placeItems: "center" }}>
    {choice.thumbnailUrl
      ? <img src={choice.thumbnailUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      : <Images size={22} color="#71717a" aria-hidden="true" />}
  </span>;
}

export function EventAlbumOverview(props: AlbumNavigationProps & {
  title: string;
  description: string;
  albumsLabel: string;
  brandName: string;
  brandLogoUrl?: string | null;
  metadata: string[];
  isMobile: boolean;
  themePreset?: "signature" | "editorial" | "cinema";
  accentColor?: string;
  tone: { background: string; surface: string; text: string; mutedText: string; border: string };
}) {
  const secondaryText = `color-mix(in srgb, ${props.tone.mutedText} 80%, ${props.tone.text})`;
  return <section className="event-album-overview" aria-label={props.albumsLabel} style={{ flex: 1, minHeight: 0, overflow: "auto", background: props.tone.background, color: props.tone.text, padding: props.isMobile ? "30px 22px 44px" : "48px 36px 64px" }}>
    <style>{`
      .event-album-overview .event-album-cards { display: flex; flex-wrap: wrap; justify-content: center; gap: 32px 24px; }
      .event-album-overview .event-album-card { width: calc((100% - 48px) / 3); min-width: 0; padding: 0; border: 0; border-radius: 8px; background: transparent; color: inherit; text-align: left; cursor: pointer; font-family: inherit; }
      .event-album-overview .event-album-card:focus-visible { outline: 2px solid currentColor; outline-offset: 6px; }
      .event-album-overview .event-album-cover { display: grid; place-items: center; width: 100%; aspect-ratio: 3 / 2; overflow: hidden; border-radius: 8px; }
      .event-album-overview .event-album-cover img { width: 100%; height: 100%; object-fit: cover; transition: transform 450ms cubic-bezier(.22,1,.36,1); }
      .event-album-overview .event-album-arrow { flex-shrink: 0; transition: transform 250ms ease; }
      @media (hover: hover) {
        .event-album-overview .event-album-card:hover .event-album-cover img { transform: scale(1.035); }
        .event-album-overview .event-album-card:hover .event-album-arrow { transform: translateX(3px); }
      }
      @media (max-width: 960px) { .event-album-overview .event-album-card { width: calc((100% - 24px) / 2); } }
      @media (max-width: 560px) {
        .event-album-overview .event-album-card { width: 100%; }
        .event-album-overview .event-album-cards { gap: 26px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .event-album-overview .event-album-cover img, .event-album-overview .event-album-arrow { transition: none; }
        .event-album-overview .event-album-card:hover .event-album-cover img, .event-album-overview .event-album-card:hover .event-album-arrow { transform: none; }
      }
    `}</style>
    <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gap: props.isMobile ? 32 : 42 }}>
      <header style={{ display: "grid", justifyItems: "center", textAlign: "center", gap: 14, paddingBottom: 4 }}>
        <div style={{ minHeight: 40, display: "grid", placeItems: "center", marginBottom: props.isMobile ? 8 : 16 }}>
          {props.brandLogoUrl ? <img src={props.brandLogoUrl} alt={props.brandName} style={{ maxWidth: "min(200px, 70vw)", maxHeight: 44, objectFit: "contain" }} />
            : <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", overflowWrap: "anywhere" }}>{props.brandName}</span>}
        </div>
        <h1 style={{ margin: 0, maxWidth: "100%", fontSize: "clamp(30px, 3.4vw, 46px)", fontWeight: props.themePreset === "editorial" ? 400 : 500, fontStyle: props.themePreset === "editorial" ? "italic" : undefined, textTransform: props.themePreset === "cinema" ? "uppercase" : undefined, letterSpacing: props.themePreset === "cinema" ? "0.06em" : "-0.025em", lineHeight: 1.15, overflowWrap: "anywhere" }}>{props.title}</h1>
        {props.metadata.length ? <div style={{ color: secondaryText, fontSize: 12, lineHeight: 1.7, letterSpacing: "0.04em" }}>{props.metadata.join(" · ")}</div> : null}
        <span aria-hidden="true" style={{ width: 40, height: 2, background: props.accentColor ?? props.tone.border, margin: "4px 0" }} />
        <p style={{ margin: 0, maxWidth: 560, color: secondaryText, fontSize: 14, lineHeight: 1.7 }}>{props.description}</p>
      </header>
      <div className="event-album-cards">
        {props.choices.map(choice => <button className="event-album-card" key={choice.value} type="button" onClick={() => props.onSelect(choice.value)}>
          <span className="event-album-cover" style={{ background: props.tone.surface, border: `1px solid ${props.tone.border}`, boxSizing: "border-box" }}>
            {choice.thumbnailUrl ? <img src={choice.thumbnailUrl} alt="" loading="lazy" />
              : <Images size={36} color={props.tone.mutedText} aria-hidden="true" />}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 3px 6px" }}>
            <span style={{ minWidth: 0, flex: 1, display: "grid", gap: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.4, overflowWrap: "anywhere" }}>{choice.title}</span>
              {!props.hidePhotoCount ? <span style={{ fontSize: 12, color: secondaryText, lineHeight: 1.5 }}>{photoCount(choice, props)}</span> : null}
            </span>
            <ChevronRight className="event-album-arrow" size={18} color={props.accentColor ?? props.tone.mutedText} aria-hidden="true" />
          </span>
        </button>)}
      </div>
    </div>
  </section>;
}

/** Native disclosure keeps the thumbnail picker usable with touch and keyboard. */
export function EventAlbumSwitcher(props: AlbumNavigationProps & {
  value: string;
  label: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const selected = props.choices.find(choice => choice.value === props.value) ?? props.choices[0];

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        detailsRef.current.open = false;
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  if (!selected) return null;
  return <details ref={detailsRef} style={{ position: "relative", width: "100%", maxWidth: 360, minWidth: 0 }}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (detailsRef.current) detailsRef.current.open = false;
        summaryRef.current?.focus();
      }
    }}>
    <summary ref={summaryRef} aria-label={`${props.label}: ${selected.title}`}
      style={{ display: "flex", alignItems: "center", gap: 10, listStyle: "none", cursor: "pointer", minHeight: 52, padding: "6px 10px", background: "#ffffff", border: "1px solid #d4d4d8", borderRadius: 8, color: "#18181b" }}>
      <AlbumThumbnail choice={selected} size={40} />
      <span style={{ minWidth: 0, flex: 1, display: "grid", gap: 2 }}>
        <span style={{ color: "#71717a", fontSize: 10, fontWeight: 700 }}>{props.label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>{selected.title}</span>
        {!props.hidePhotoCount ? <span style={{ color: "#71717a", fontSize: 11 }}>{photoCount(selected, props)}</span> : null}
      </span>
      <ChevronDown size={16} aria-hidden="true" />
    </summary>
    <nav aria-label={props.label} style={{ position: "absolute", top: "calc(100% + 6px)", insetInline: 0, maxHeight: "min(440px, 65svh)", overflow: "auto", zIndex: 40, padding: 6, border: "1px solid #d4d4d8", borderRadius: 10, background: "#ffffff", boxShadow: "0 12px 30px rgba(0,0,0,0.16)" }}>
      {props.choices.map(choice => <button key={choice.value} type="button" aria-current={choice.value === selected.value ? "true" : undefined}
        onClick={() => {
          props.onSelect(choice.value);
          if (detailsRef.current) detailsRef.current.open = false;
          summaryRef.current?.focus();
        }}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 60, padding: 8, border: 0, borderRadius: 6, background: choice.value === selected.value ? "#f4f4f5" : "#ffffff", color: "#18181b", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
        <AlbumThumbnail choice={choice} size={44} />
        <span style={{ minWidth: 0, display: "grid", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{choice.title}</span>
          {!props.hidePhotoCount ? <span style={{ color: "#71717a", fontSize: 11 }}>{photoCount(choice, props)}</span> : null}
        </span>
      </button>)}
    </nav>
  </details>;
}
