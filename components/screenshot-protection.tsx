"use client";

// components/screenshot-protection.tsx
//
// Phase-1 in-browser defenses for the parents portal.  These toggles are
// per-school / per-event and apply ONLY to the parents-facing gallery.  The
// photographer dashboard never receives this treatment.
//
// This is intentionally a layered, best-effort defense — a motivated attacker
// with full OS access can always capture the screen.  The goal here is to
// stop the casual "⌘⇧3 / long-press save image" flow that produces 95% of
// real-world leaks, and to stamp every successful capture with a visible
// watermark so it's obvious where it came from.
//
// Layers (each gated by a separate settings toggle):
//
//   1. Desktop
//      - right-click / context menu disabled
//      - keystroke listener for ⌘⇧3, ⌘⇧4, ⌘⇧5, ⌘⇧6, PrtSc
//      - focus-loss (window.blur) briefly blurs the whole page — defends
//        against screenshot tools that steal focus before shooting.
//      - drag-start disabled on images to block "drag into new tab".
//
//   2. Mobile
//      - long-press contextmenu disabled
//      - touchstart + timer: if the finger stays down for > 420ms the whole
//        page gets a half-blur so the iOS / Android "Save Image" system sheet
//        captures a blurred image, not the real one.
//
//   3. Visible watermark
//      - a tiled SVG overlay painted at 20% opacity across the whole viewport,
//        carrying the viewer's session info (email + date).
//      - pointer-events: none so it doesn't interfere with tapping.
//
// Usage: drop <ScreenshotProtection flags={...} watermarkText={...} /> anywhere
// in the tree — it attaches window listeners and renders a fixed-position
// overlay.  No wrapping required.  The blur effect applies `filter: blur(...)`
// to document.body so the whole page is affected momentarily.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ScreenshotProtectionFlags = {
  desktop: boolean;
  mobile: boolean;
  watermark: boolean;
};

type Props = {
  flags: ScreenshotProtectionFlags;
  /** Text stamped on the watermark overlay — usually "viewer@email · 2026-04-23". */
  watermarkText?: string;
};

const BLUR_DURATION_MS = 2200;
const LONG_PRESS_THRESHOLD_MS = 420;

function ScreenshotProtection({ flags, watermarkText }: Props) {
  const [blurred, setBlurred] = useState(false);
  const blurTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const triggerBlur = useCallback((ms: number = BLUR_DURATION_MS) => {
    setBlurred(true);
    if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current);
    blurTimerRef.current = window.setTimeout(() => {
      setBlurred(false);
    }, ms);
  }, []);

  // Apply a blur filter to <body> whenever `blurred` flips on.  Using body
  // (not html) means the floating watermark + overlay notice are also blurred
  // — which is fine, the point is to hide the gallery.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    if (!body) return;
    if (blurred) {
      body.style.transition = "filter 280ms ease";
      body.style.filter = "blur(22px) saturate(0.6)";
    } else {
      body.style.filter = "";
    }
    return () => {
      body.style.filter = "";
    };
  }, [blurred]);

  // Desktop keystroke + focus + contextmenu listeners.
  useEffect(() => {
    if (!flags.desktop) return;

    function onKeyDown(e: KeyboardEvent) {
      const key = e.key;
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;

      // macOS: ⌘⇧3 (full), ⌘⇧4 (region), ⌘⇧5 (capture app), ⌘⇧6 (touchbar).
      if (meta && shift && ["3", "4", "5", "6"].includes(key)) {
        e.preventDefault();
        triggerBlur();
      }
      // Windows: PrtSc — we can't actually block it but we can blur the
      // page the instant it's pressed so any delayed capture misses.
      if (key === "PrintScreen") {
        triggerBlur();
      }
      // Chrome DevTools screenshot shortcut ⌘⇧P → Capture full-size screenshot.
      if (meta && shift && (key === "P" || key === "p")) {
        triggerBlur();
      }
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
    }

    function onBlur() {
      // Most screenshot tools briefly steal focus. Blur the page while
      // focus is gone so the capture lands on a blurred frame.
      triggerBlur(1800);
    }

    function onDragStart(e: DragEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "IMG") {
        e.preventDefault();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("dragstart", onDragStart, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("dragstart", onDragStart, true);
    };
  }, [flags.desktop, triggerBlur]);

  // Mobile long-press + contextmenu.
  useEffect(() => {
    if (!flags.mobile) return;

    function onTouchStart(e: TouchEvent) {
      // Only arm the long-press guard when the touch target looks like an
      // image / gallery tile.  Typing in a field or scrolling shouldn't
      // trigger a blur.
      const target = e.target as HTMLElement | null;
      const insideImage =
        !!target && (target.tagName === "IMG" || target.closest("img, [data-gallery-image]") !== null);
      if (!insideImage) return;
      if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = window.setTimeout(() => {
        triggerBlur(2800);
      }, LONG_PRESS_THRESHOLD_MS);
    }

    function onTouchEnd() {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }

    function onContextMenu(e: Event) {
      e.preventDefault();
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("contextmenu", onContextMenu, true);

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [flags.mobile, triggerBlur]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current);
      if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    };
  }, []);

  // Nothing to render if every flag is off.
  if (!flags.desktop && !flags.mobile && !flags.watermark) {
    return null;
  }

  return (
    <>
      {/* CSS-level defenses — small but effective: disable the iOS long-press
          context sheet on every <img>, and kill native selection / dragging.
          These rules only affect the parents portal because the component
          is mounted inside /parents/[pin] — they don't touch the dashboard. */}
      {(flags.desktop || flags.mobile) ? (
        <style>{`
          img { -webkit-user-drag: none; user-select: none; }
          ${flags.mobile ? `
          img, [data-gallery-image] {
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
          }
          ` : ""}
        `}</style>
      ) : null}
      {flags.watermark ? <WatermarkOverlay text={watermarkText || ""} /> : null}
      {blurred ? <BlurNotice /> : null}
    </>
  );
}

function WatermarkOverlay({ text }: { text: string }) {
  const label = text?.trim() || "Do not copy";
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 99990,
        overflow: "hidden",
        mixBlendMode: "overlay",
        opacity: 0.22,
      }}
    >
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id="screenshot-watermark"
            patternUnits="userSpaceOnUse"
            width="320"
            height="180"
            patternTransform="rotate(-24)"
          >
            <text
              x="0"
              y="40"
              fontFamily="Inter, system-ui, sans-serif"
              fontSize="16"
              fontWeight="600"
              fill="#ffffff"
              stroke="#000000"
              strokeWidth="0.4"
            >
              {label}
            </text>
            <text
              x="80"
              y="120"
              fontFamily="Inter, system-ui, sans-serif"
              fontSize="16"
              fontWeight="600"
              fill="#ffffff"
              stroke="#000000"
              strokeWidth="0.4"
            >
              {label}
            </text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#screenshot-watermark)" />
      </svg>
    </div>
  );
}

function BlurNotice() {
  // Portal the notice up to <html> so it sits outside <body>.  Since we
  // apply `filter: blur(...)` to <body>, anything inside body inherits the
  // blur.  Hoisting the notice out of body keeps its text crisp while the
  // rest of the page is blurred.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 99999,
      }}
    >
      <div
        style={{
          background: "rgba(15, 23, 42, 0.85)",
          color: "#f8fafc",
          padding: "12px 18px",
          borderRadius: 14,
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.2,
          boxShadow: "0 8px 26px rgba(0,0,0,0.35)",
          maxWidth: "80%",
          textAlign: "center",
        }}
      >
        Gallery hidden — screenshots are not permitted.
      </div>
    </div>,
    document.documentElement,
  );
}

export default ScreenshotProtection;
