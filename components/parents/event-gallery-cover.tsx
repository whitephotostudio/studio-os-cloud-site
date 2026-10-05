"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

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
  layout?: "split" | "centered" | "minimal";
  themePreset?: "signature" | "editorial" | "cinema";
  tone?: { background: string; surface: string; text: string; mutedText: string; border: string };
  accentColor?: string;
  preview?: boolean;
};

function accentTextColor(color: string) {
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!hex) return /^(white|ivory|snow)$/i.test(color) ? "#151719" : "#fff";
  const expanded = hex.length === 3 ? [...hex].map(character => character.repeat(2)).join("") : hex;
  const channels = [0, 2, 4].map(index => {
    const value = Number.parseInt(expanded.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000" : "#fff";
}

/** A welcome screen before the album chooser, with one clear way forward. */
export function EventGalleryCover(props: EventGalleryCoverProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [loadedImageUrl, setLoadedImageUrl] = useState<string | null>(null);
  const [timedOutImageUrl, setTimedOutImageUrl] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const enterButtonRef = useRef<HTMLButtonElement>(null);
  const layout = props.layout ?? "centered";
  const themePreset = props.themePreset ?? "signature";
  const preview = props.preview ?? false;
  const tone = props.tone ?? { background: "#151719", surface: "#151719", text: "#fff", mutedText: "#d6d6d6", border: "#3d4043" };
  const accentColor = props.accentColor || "#fff";
  const showImage = !!props.imageUrl && props.imageUrl !== failedImageUrl;
  const revealReady = preview || !showImage || loadedImageUrl === props.imageUrl || timedOutImageUrl === props.imageUrl;
  const overPhoto = layout === "centered" && showImage;
  const textColor = overPhoto ? "#fff" : tone.text;
  const mutedColor = overPhoto ? "rgba(255,255,255,0.86)" : tone.mutedText;
  const overlayOpacity = Math.max(0, Math.min(1, props.overlayOpacity));
  const titleStyle: CSSProperties = {
    margin: 0,
    fontFamily: props.fontFamily,
    fontSize: layout === "minimal" ? "clamp(30px, 4vw, 52px)" : props.serifTitle ? "clamp(38px, 5.5vw, 76px)" : "clamp(34px, 5vw, 68px)",
    lineHeight: themePreset === "editorial" ? 1.06 : 1.1,
    fontWeight: themePreset === "cinema" ? 800 : themePreset === "editorial" ? 400 : 600,
    fontStyle: themePreset === "editorial" ? "italic" : "normal",
    textTransform: themePreset === "cinema" ? "uppercase" : "none",
    letterSpacing: themePreset === "cinema" ? "0.065em" : themePreset === "editorial" ? "-0.035em" : "-0.025em",
    overflowWrap: "anywhere",
  };
  const Title = preview ? "h2" : "h1";

  useEffect(() => {
    if (preview || !showImage) return;
    const imageUrl = props.imageUrl;
    // A cached image may finish before React attaches its load listener.
    const frame = window.requestAnimationFrame(() => {
      if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) setLoadedImageUrl(imageUrl);
    });
    // Slow or unavailable media must never leave the gallery inaccessible.
    const timeout = window.setTimeout(() => setTimedOutImageUrl(imageUrl), 2500);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [props.imageUrl, showImage, preview]);

  useEffect(() => {
    if (preview || !revealReady) return;
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1000;
    const timeout = window.setTimeout(() => enterButtonRef.current?.focus({ preventScroll: true }), delay);
    return () => window.clearTimeout(timeout);
  }, [revealReady, preview]);

  const photo = showImage ? <div className="event-cover-photo-frame" style={{ position: "relative", overflow: "hidden", background: tone.surface, border: layout === "minimal" ? `1px solid ${tone.border}` : undefined }}>
    <img ref={imageRef} src={props.imageUrl!} alt="" fetchPriority={preview ? "auto" : "high"} onLoad={() => setLoadedImageUrl(props.imageUrl)} onError={() => setFailedImageUrl(props.imageUrl)}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: props.imageFilter }} />
    {layout !== "minimal" ? <div className="event-cover-photo-overlay" aria-hidden="true" style={{ position: "absolute", inset: 0, background: layout === "centered" ? `linear-gradient(180deg, rgba(0,0,0,${overlayOpacity * 0.44}), rgba(0,0,0,${overlayOpacity}) 50%, rgba(0,0,0,${overlayOpacity}))` : `rgba(0,0,0,${overlayOpacity * 0.3})` }} /> : null}
  </div> : null;

  return <section className="event-gallery-cover" data-layout={layout} data-theme={themePreset} data-preview={preview} data-has-image={showImage} data-reveal-ready={revealReady} aria-label={props.title} style={{ position: preview ? "relative" : "fixed", inset: preview ? undefined : 0, zIndex: preview ? undefined : 80, minHeight: preview ? 520 : undefined, width: preview ? "100%" : undefined, borderRadius: preview ? 20 : undefined, overflowY: "auto", background: tone.background, color: textColor, fontFamily: props.fontFamily, containerType: "inline-size", containerName: "event-gallery-welcome" }}>
    <style>{`
      .event-gallery-cover .event-cover-frame { position: relative; min-height: 100%; display: grid; }
      .event-gallery-cover[data-preview="true"] .event-cover-frame { min-height: 520px; }
      .event-gallery-cover .event-cover-panel { position: relative; box-sizing: border-box; display: flex; flex-direction: column; padding: 32px 24px; min-width: 0; min-height: 100%; gap: 32px; }
      .event-gallery-cover .event-cover-brand { min-height: 40px; display: grid; place-items: center; }
      .event-gallery-cover .event-cover-copy { flex: 1; width: 100%; max-width: 940px; margin: 0 auto; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 32px 0 72px; box-sizing: border-box; }
      .event-gallery-cover[data-layout="centered"] .event-cover-frame > .event-cover-photo-frame { position: absolute !important; inset: 0; }
      .event-gallery-cover[data-layout="split"][data-has-image="true"] .event-cover-frame { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); }
      .event-gallery-cover[data-layout="split"] .event-cover-panel { padding: 44px clamp(28px, 5vw, 80px); }
      .event-gallery-cover[data-layout="split"] .event-cover-copy { max-width: 580px; align-items: flex-start; text-align: left; padding: 40px 0; }
      .event-gallery-cover[data-layout="split"] .event-cover-brand { justify-items: start; }
      .event-gallery-cover[data-layout="minimal"] .event-cover-panel { padding: 32px 24px; gap: 20px; }
      .event-gallery-cover[data-layout="minimal"] .event-cover-copy { max-width: 680px; padding: 20px 0 40px; }
      .event-gallery-cover[data-layout="minimal"] .event-cover-photo-frame { width: min(340px, 68%); aspect-ratio: 4 / 3; flex-shrink: 0; margin: 0 auto 30px; border-radius: 4px; }
      .event-gallery-cover .event-cover-action:focus-visible { outline: 3px solid currentColor; outline-offset: 5px; }
      .event-gallery-cover .event-cover-reveal { opacity: 0; visibility: hidden; transform: translateY(12px); }
      .event-gallery-cover[data-reveal-ready="true"] .event-cover-reveal {
        opacity: 1; visibility: visible; transform: none;
        transition: opacity 700ms ease var(--event-cover-delay), transform 700ms cubic-bezier(.22,1,.36,1) var(--event-cover-delay), visibility 0s linear var(--event-cover-delay);
      }
      .event-gallery-cover .event-cover-brand { --event-cover-delay: 100ms; }
      .event-gallery-cover .event-cover-title { --event-cover-delay: 200ms; }
      .event-gallery-cover .event-cover-client { --event-cover-delay: 350ms; }
      .event-gallery-cover .event-cover-details { --event-cover-delay: 450ms; }
      .event-gallery-cover .event-cover-action { --event-cover-delay: 700ms; }
      .event-gallery-cover[data-preview="true"] .event-cover-reveal { opacity: 1; visibility: visible; transform: none; transition: none; }
      @media (max-width: 720px) {
        .event-gallery-cover[data-layout="split"][data-has-image="true"] .event-cover-frame { grid-template-columns: 1fr; }
        .event-gallery-cover[data-layout="split"] .event-cover-frame > .event-cover-photo-frame { min-height: 40dvh; }
        .event-gallery-cover[data-layout="split"] .event-cover-panel { padding: 28px 24px; gap: 20px; }
        .event-gallery-cover[data-layout="split"] .event-cover-copy { align-items: center; text-align: center; padding: 16px 0 40px; }
        .event-gallery-cover[data-layout="split"] .event-cover-brand { justify-items: center; }
      }
      @container event-gallery-welcome (max-width: 660px) {
        .event-gallery-cover[data-preview="true"][data-layout="split"] .event-cover-frame { grid-template-columns: 1fr; }
        .event-gallery-cover[data-preview="true"][data-layout="split"] .event-cover-frame > .event-cover-photo-frame { min-height: 210px; }
        .event-gallery-cover[data-preview="true"] .event-cover-panel { padding: 24px; gap: 20px; }
        .event-gallery-cover[data-preview="true"] .event-cover-copy { align-items: center; text-align: center; padding: 12px 0 28px; }
        .event-gallery-cover[data-preview="true"] .event-cover-brand { justify-items: center; }
      }
      @media (prefers-reduced-motion: reduce) {
        .event-gallery-cover .event-cover-reveal,
        .event-gallery-cover[data-reveal-ready="true"] .event-cover-reveal {
          opacity: 1; visibility: visible; transform: none; transition: none;
        }
      }
    `}</style>
    <div className="event-cover-frame">
      {layout !== "minimal" ? photo : null}
      <div className="event-cover-panel" style={{ background: layout === "split" && showImage ? tone.surface : undefined, border: layout === "split" && showImage ? `1px solid ${tone.border}` : undefined }}>
      {props.showStudioMark ? <header className="event-cover-reveal event-cover-brand">
        {props.brandLogoUrl ? <img src={props.brandLogoUrl} alt={props.brandName} style={{ maxWidth: "min(200px, 70vw)", maxHeight: 44, objectFit: "contain" }} />
          : <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>{props.brandName}</span>}
      </header> : null}
      <div className="event-cover-copy" style={{ textShadow: overPhoto ? "0 2px 20px rgba(0,0,0,0.35)" : undefined }}>
        {layout === "minimal" ? photo : null}
        <Title className="event-cover-reveal event-cover-title" style={titleStyle}>{props.title}</Title>
        {props.clientName ? <p className="event-cover-reveal event-cover-client" style={{ margin: "20px 0 0", fontSize: 14, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", lineHeight: 1.6, overflowWrap: "anywhere", maxWidth: "100%" }}>{props.clientName}</p> : null}
        {props.metadata.length ? <p className="event-cover-reveal event-cover-details" style={{ margin: "18px 0 0", color: mutedColor, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", lineHeight: 1.8 }}>{props.metadata.join(" · ")}</p> : null}
        {props.message ? <p className="event-cover-reveal event-cover-details" style={{ margin: "18px 0 0", color: mutedColor, maxWidth: 560, fontSize: 15, lineHeight: 1.7 }}>{props.message}</p> : null}
        <button ref={enterButtonRef} className="event-cover-reveal event-cover-action" type="button" onClick={props.onEnter} style={{ marginTop: 30, minHeight: 48, padding: "12px 28px", border: `1px solid ${accentColor}`, borderRadius: themePreset === "cinema" ? 4 : 999, background: accentColor, color: accentTextColor(accentColor), fontFamily: "inherit", fontSize: 14, fontWeight: 700, letterSpacing: themePreset === "cinema" ? "0.08em" : undefined, cursor: "pointer" }}>{props.buttonLabel}</button>
      </div>
      </div>
    </div>
  </section>;
}
