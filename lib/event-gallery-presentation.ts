import type { EventGalleryBrandingSettings } from "./event-gallery-settings";

/** Shared by the owner preview and the client gallery. */
export function galleryPresentationTone(branding: EventGalleryBrandingSettings) {
  if (branding.backgroundMode === "light") {
    switch (branding.tone) {
      case "graphite": return { background: "#f4f6f8", surface: "#ffffff", surfaceMuted: "rgba(15,23,42,0.05)", border: "#d7dde5", text: "#27313b", mutedText: "#6b7280", heroOverlay: "rgba(247,249,251,0.64)" };
      case "smoke": return { background: "#f7f7f7", surface: "#ffffff", surfaceMuted: "rgba(17,24,39,0.04)", border: "#e1e4e8", text: "#2f2f2f", mutedText: "#777777", heroOverlay: "rgba(250,250,250,0.62)" };
      default: return { background: "#f8f8f8", surface: "#ffffff", surfaceMuted: "rgba(17,24,39,0.04)", border: "#e5e7eb", text: "#262626", mutedText: "#7b7b7b", heroOverlay: "rgba(248,248,248,0.68)" };
    }
  }
  switch (branding.tone) {
    case "graphite": return { background: "#0f1012", surface: "#17191d", surfaceMuted: "rgba(255,255,255,0.05)", border: "#23262b", text: "#c8ccd2", mutedText: "#8f97a3", heroOverlay: "rgba(8,9,11,0.58)" };
    case "smoke": return { background: "#141414", surface: "#1d1d1d", surfaceMuted: "rgba(255,255,255,0.06)", border: "#2d2d2d", text: "#cdcdcd", mutedText: "#9b9b9b", heroOverlay: "rgba(16,16,16,0.5)" };
    default: return { background: "#080808", surface: "#111111", surfaceMuted: "rgba(255,255,255,0.04)", border: "#1a1a1a", text: "#cfcfcf", mutedText: "#8f8f8f", heroOverlay: "rgba(6,6,6,0.62)" };
  }
}

export function galleryPresentationAccent(branding: EventGalleryBrandingSettings) {
  switch (branding.accentColor) {
    case "champagne": return { solid: "#c4a574", strong: "#a78758", muted: "rgba(196,165,116,0.18)", border: "rgba(196,165,116,0.34)", text: "#f3e7d2" };
    case "ivory": return { solid: "#f2ede5", strong: "#d9d0c1", muted: "rgba(242,237,229,0.16)", border: "rgba(242,237,229,0.28)", text: "#fffaf2" };
    default: return { solid: "#991b1b", strong: "#b91c1c", muted: "rgba(153,27,27,0.18)", border: "rgba(153,27,27,0.34)", text: "#fee2e2" };
  }
}

export function galleryIntroButtonLabel(savedLabel: string, defaultLabel: string) {
  const label = savedLabel.trim();
  return label && label !== "Enter Gallery" ? label : defaultLabel;
}
