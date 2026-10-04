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
  tone: { background: string; surface: string; text: string; mutedText: string; border: string };
}) {
  return <section aria-label={props.albumsLabel} style={{ flex: 1, minHeight: 0, overflow: "auto", background: props.tone.background, color: props.tone.text, padding: props.isMobile ? "22px 16px 30px" : "32px 36px 40px" }}>
    <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 22 }}>
      <header style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: props.tone.mutedText, fontSize: 12, fontWeight: 700 }}>
          {props.brandLogoUrl ? <img src={props.brandLogoUrl} alt="" style={{ maxWidth: 150, height: 28, objectFit: "contain" }} /> : null}
          <span>{props.brandName}</span>
        </div>
        <h1 style={{ margin: 0, fontSize: props.isMobile ? 28 : 38, fontWeight: 600, lineHeight: 1.15 }}>{props.title}</h1>
        {props.metadata.length ? <div style={{ color: props.tone.mutedText, fontSize: 12 }}>{props.metadata.join(" · ")}</div> : null}
        <p style={{ margin: 0, color: props.tone.mutedText, fontSize: 14, lineHeight: 1.5 }}>{props.description}</p>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: props.isMobile ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        {props.choices.map(choice => <button key={choice.value} type="button" onClick={() => props.onSelect(choice.value)}
          style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, width: "100%", padding: 12, textAlign: "left", border: `1px solid ${props.tone.border}`, borderRadius: 12, background: props.tone.surface, color: props.tone.text, cursor: "pointer", fontFamily: "inherit" }}>
          <AlbumThumbnail choice={choice} size={props.isMobile ? 76 : 90} />
          <span style={{ minWidth: 0, flex: 1, display: "grid", gap: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }}>{choice.title}</span>
            {!props.hidePhotoCount ? <span style={{ fontSize: 12, color: props.tone.mutedText }}>{photoCount(choice, props)}</span> : null}
          </span>
          <ChevronRight size={18} aria-hidden="true" />
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
