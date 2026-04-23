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
// ⚠ Fundamental Phase-1 limit (hardening pass, 2026-04-23):
//   macOS ⌘⇧3 captures the framebuffer SYNCHRONOUSLY — the OS takes the
//   snapshot before the browser's keydown listener is ever invoked.  That
//   means no reactive JS blur can hide a ⌘⇧3 capture.  So this pass takes
//   a different angle:
//     (a) make every successful capture already contain a strong, always-on
//         watermark (parent email + date) so leaks are visibly branded
//     (b) on mobile, keep the gallery half-blurred at all times so any
//         screenshot yields a partially-obscured image; a parent presses
//         and holds a photo to reveal it
//     (c) fire blur PRE-EMPTIVELY on cursor-leaves-viewport, visibility
//         change, focus loss — the earliest signals that a screenshot tool
//         is about to run — so the region-select variants (⌘⇧4, ⌘⇧5,
//         Screenshot.app) blur before the crop frame even appears
//
// Layers (each gated by a separate settings toggle):
//
//   1. Desktop
//      - right-click / context menu disabled
//      - drag-start disabled on images (blocks "drag into new tab")
//      - keystroke listener for ⌘⇧3/4/5/6 + PrtSc (last-ditch blur)
//      - PROACTIVE blur triggers: mouseleave from viewport, visibilitychange,
//        window.blur — fires the blur BEFORE the user can initiate a capture
//        crop.  Instant application (no transition) so the blur lands in the
//        same paint frame.
//
//   2. Mobile ("strong" half-blur mode)
//      - long-press contextmenu disabled
//      - every gallery tile is covered by a diagonal blur overlay at all
//        times — screenshots are always partially obscured
//      - press and hold a photo to remove the overlay and see the full
//        image; release to re-blur
//
//   3. Visible watermark (always-on, boosted opacity + density)
//      - a tiled SVG overlay painted at ~38% opacity across the whole
//        viewport, carrying the viewer's session info (email + date)
//      - pointer-events: none so it doesn't interfere with tapping
//
// Usage: drop <ScreenshotProtection flags={...} watermarkText={...} /> anywhere
// in the tree — it attaches window listeners and renders fixed-position
// overlays.  No wrapping required.  Gallery tiles that should be protected
// on mobile must carry the `data-gallery-image` attribute on their outer
// container (already the convention in the parents portal).

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
const SCREENSHOT_BLUR_DURATION_MS = 5000;

function ScreenshotProtection({ flags, watermarkText }: Props) {
  const [blurred, setBlurred] = useState(false);
  // idleBlur = the always-present backdrop-filter overlay that's visible
  // whenever the user isn't actively interacting.  This is the primary
  // screenshot defense — by the time any capture shortcut fires, the
  // blur is already painted (no race with OS capture).
  const [idleBlur, setIdleBlur] = useState<boolean>(
    // Start blurred on mobile immediately; desktop fades in on idle.
    typeof window !== "undefined"
      ? flags.mobile && window.matchMedia?.("(pointer: coarse)").matches
      : false,
  );
  const blurTimerRef = useRef<number | null>(null);
  // Direct DOM handle to the idle-blur overlay so triggerBlur can
  // force-paint it synchronously in the event-handler tick — no React
  // render round-trip, no 60ms fade, no capture race with ⌘⇧3.
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Synchronous DOM apply — we paint the blur into the current frame and
  // THEN kick React state so the notice / other effects render.  Waiting
  // for React to flush means one frame of unblurred paint, which is the
  // exact window macOS ⌘⇧4 needs to grab a clean image.
  //
  // SPEED NOTE (2026-04-23): earlier versions also set
  // `document.body.style.filter = "blur(26px)"` as a second layer.  That
  // forced the browser to re-raster the ENTIRE page through a blur
  // shader every frame — visibly laggy on content-heavy galleries.  Now
  // we rely solely on the overlay's `backdrop-filter`, which is
  // GPU-composited over an already-rendered page.  Paint is 1-frame.
  const triggerBlur = useCallback((ms: number = BLUR_DURATION_MS) => {
    // Direct DOM poke on the overlay (no React round-trip) so the blur
    // lands in the same tick the event handler runs.
    if (overlayRef.current) {
      overlayRef.current.style.transition = "none";
      overlayRef.current.style.opacity = "1";
    }
    setBlurred(true);
    if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current);
    blurTimerRef.current = window.setTimeout(() => {
      setBlurred(false);
    }, ms);
  }, []);

  // Desktop keystroke + focus + contextmenu listeners + proactive triggers.
  useEffect(() => {
    if (!flags.desktop) return;

    function onKeyDown(e: KeyboardEvent) {
      // Ignore auto-repeated keydowns from a held key.  Without this,
      // holding Shift/Cmd fires this handler every ~30ms, each call
      // re-triggering the 5s blur — the user sees a strobing overlay.
      if (e.repeat) return;

      const key = e.key;
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;

      // TARGETED PREDICTIVE TRIGGER: fire on the Command / Shift / Ctrl
      // key press itself.  Every screenshot shortcut starts with one of
      // these being held down (⌘⇧3, ⌘⇧4, ⌘⇧5, PrtSc).  Blurring on
      // the modifier keydown covers the typically 50-200ms gap before
      // the digit is pressed — crucial for ⌘⇧3 which the OS captures
      // instantly at the frame after the digit.
      //
      // Single event (e.repeat already guarded above), so no strobing.
      // Covers the case where the user presses Shift FIRST then Cmd.
      if (key === "Meta" || key === "Control" || key === "Shift") {
        triggerBlur(SCREENSHOT_BLUR_DURATION_MS);
      }

      // Specific screenshot key combos — preventDefault is a no-op on
      // macOS (OS consumes it) but the blur gives a 5s buffer in case
      // anything slips through on other platforms.
      if (meta && shift && ["3", "4", "5", "6"].includes(key)) {
        e.preventDefault();
        triggerBlur(SCREENSHOT_BLUR_DURATION_MS);
      }

      // Windows: PrtSc — can't actually block it but blur ASAP.
      if (key === "PrintScreen") {
        triggerBlur(SCREENSHOT_BLUR_DURATION_MS);
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

    // PROACTIVE TRIGGER 1: cursor leaving the viewport.  On macOS, moving
    // toward the menu bar (to click the Screenshot.app menu extra) or
    // toward another app window fires mouseleave on the root element.  This
    // is the earliest signal we can get that the user is about to switch
    // context to capture.
    function onDocumentMouseLeave(e: MouseEvent) {
      // Only fire when actually exiting the window (relatedTarget null).
      if (!e.relatedTarget) {
        triggerBlur(1500);
      }
    }

    // PROACTIVE TRIGGER 2: tab visibility change.  If the tab becomes
    // hidden for any reason, blur immediately so returning to the tab
    // doesn't briefly show the gallery before re-blurring.
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") {
        triggerBlur(2200);
      }
    }

    // PROACTIVE TRIGGER 3: pointer leaving the viewport (covers trackpad
    // + mouse on macOS where mouseleave sometimes doesn't fire on fast
    // flick to top-of-screen).
    function onPointerLeave(e: PointerEvent) {
      if (!e.relatedTarget) {
        triggerBlur(1500);
      }
    }

    // Attach on BOTH window and document (capture phase) so we see the
    // keydown as early as possible — some browsers route system shortcuts
    // differently and we want to grab the event on its first hop.
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("dragstart", onDragStart, true);
    document.documentElement.addEventListener("mouseleave", onDocumentMouseLeave);
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("dragstart", onDragStart, true);
      document.documentElement.removeEventListener("mouseleave", onDocumentMouseLeave);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [flags.desktop, triggerBlur]);

  // MOBILE-ONLY idle blur.  Desktop used to have an idle-timer-based
  // overlay too but it strobed every reading pause (~400ms pause while
  // looking at a photo → blur appears → look away → blur goes → repeat).
  // Desktop now relies SOLELY on the reactive Cmd/Shift keypress blur,
  // which fires instantly via triggerBlur's synchronous DOM apply.
  //
  // Mobile: overlay is always present unless a finger is actively
  // touching the screen.  iOS Volume+Power and Android Power+VolDown
  // don't touch the page, so the capture lands on a blurred frame.
  // Press to reveal; release to re-blur.
  useEffect(() => {
    if (!flags.mobile) return;

    const isCoarsePointer =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches;
    if (!isCoarsePointer) return;

    // Start blurred and only clear while actively touching.
    setIdleBlur(true);

    function onTouchStart() {
      setIdleBlur(false);
    }
    function onTouchEnd() {
      setIdleBlur(true);
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
  }, [flags.mobile]);

  // Click / tap anywhere clears the reactive blur immediately.  Once
  // the user has acknowledged the "Screenshot protection on" notice by
  // clicking through, there's no reason to hold the 5-second blur —
  // they already got the message.  The idle blur will re-arm normally
  // on the next idle timeout.
  const clearReactiveBlur = useCallback(() => {
    if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current);
    setBlurred(false);
    // Restore the overlay's CSS transition so future fades feel smooth.
    if (overlayRef.current) {
      overlayRef.current.style.transition = "";
      overlayRef.current.style.opacity = "";
    }
  }, []);

  useEffect(() => {
    if (!blurred) return;
    function onClick() {
      clearReactiveBlur();
    }
    // pointerdown fires before click, so we dismiss as early as possible.
    window.addEventListener("pointerdown", onClick, true);
    window.addEventListener("touchstart", onClick, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", onClick, true);
      window.removeEventListener("touchstart", onClick, { capture: true } as EventListenerOptions);
    };
  }, [blurred, clearReactiveBlur]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  // Nothing to render if every flag is off.
  if (!flags.desktop && !flags.mobile && !flags.watermark) {
    return null;
  }

  return (
    <>
      {/* CSS-level defenses: block native drag + selection on all images. */}
      {(flags.desktop || flags.mobile) ? (
        <style>{`
          img { -webkit-user-drag: none; user-select: none; }
          ${flags.mobile ? `
          img {
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
          }
          ` : ""}
        `}</style>
      ) : null}
      {(flags.desktop || flags.mobile) ? (
        <IdleBlurOverlay active={idleBlur || blurred} overlayRef={overlayRef} />
      ) : null}
      {flags.watermark ? <WatermarkOverlay text={watermarkText || ""} /> : null}
      {blurred ? <BlurNotice /> : null}
    </>
  );
}

/**
 * The primary screenshot defense.  A fixed-position overlay with
 * `backdrop-filter: blur` that sits ABOVE gallery content but BELOW
 * UI chrome (z-index 8 vs typical sticky-header z-index of 20-50).
 *
 * When active=true, gallery images behind this overlay appear blurred.
 * Buttons, headers, tabs rendered at higher z-index stay crisp so the
 * parent can still operate the portal.
 *
 * Because the overlay is ALWAYS in the DOM (just with opacity toggled
 * via state), the blur is already painted and composited when any OS
 * screenshot shortcut fires — no race with the capture.
 */
function IdleBlurOverlay({
  active,
  overlayRef,
}: {
  active: boolean;
  overlayRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      <div
        ref={overlayRef}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          // High z-index so the overlay covers gallery tiles AND the
          // photo lightbox / modal viewers (which typically stack at
          // z-index 50-1000).  Stays below the watermark (99990) and
          // the blur-active notice (99999).
          zIndex: 99980,
          backdropFilter: "blur(32px) saturate(0.4)",
          WebkitBackdropFilter: "blur(32px) saturate(0.4)",
          // Visible dark tint so the user can clearly SEE the blur
          // kicked in — a barely-visible 4% tint let them think
          // nothing was happening even though the blur was firing.
          background: "rgba(10, 15, 30, 0.55)",
          // Fade-IN = 0ms (instant, so it paints same frame a modifier
          // is pressed — critical for ⌘⇧3).  Fade-OUT = 140ms so when
          // the user clicks to dismiss it eases out smoothly.
          transition: active
            ? "opacity 0ms linear"
            : "opacity 140ms ease-out",
          opacity: active ? 1 : 0,
          // GPU-compositing hints.  `translateZ(0)` promotes the overlay
          // to its own compositor layer so flipping opacity doesn't
          // trigger a repaint of any ancestor.  `willChange` tells the
          // browser to keep the layer warm and the backdrop-filter
          // shader pre-compiled, eliminating the first-paint stall that
          // was causing the "hit Cmd → wait ~100ms → see blur" lag.
          transform: "translateZ(0)",
          willChange: "opacity, backdrop-filter, transform",
        }}
      />
      {/* Small status pill shown whenever the idle blur is active.
          Same 60ms fade as the blur so they appear/disappear together. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "fixed",
          top: 22,
          left: "50%",
          transform: "translateX(-50%)",
          // Above watermark (99990) so the pill text reads clearly.
          // Still below the centered BlurNotice (99999) for layering.
          zIndex: 99995,
          pointerEvents: "none",
          opacity: active ? 1 : 0,
          transition: "opacity 60ms linear",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 22px",
          borderRadius: 999,
          background: "rgba(15, 23, 42, 0.92)",
          color: "#f8fafc",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: 0.4,
          boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          textTransform: "uppercase",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: 999,
            background: "#22c55e",
            boxShadow: "0 0 10px rgba(34,197,94,0.95)",
          }}
        />
        Screenshot protection on
      </div>
    </>
  );
}

function WatermarkOverlay({ text }: { text: string }) {
  const label = text?.trim() || "Do not copy";
  const bigLabel = `${label}  ·  DO NOT SHARE`;
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 99990,
        overflow: "hidden",
        mixBlendMode: "normal",
        opacity: 0.55,
      }}
    >
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/* Primary dense diagonal pattern at higher opacity — visible over
              bright backgrounds like skin tones / white shirts. */}
          <pattern
            id="screenshot-watermark-primary"
            patternUnits="userSpaceOnUse"
            width="160"
            height="92"
            patternTransform="rotate(-24)"
          >
            <text
              x="0"
              y="26"
              fontFamily="Inter, system-ui, sans-serif"
              fontSize="14"
              fontWeight="800"
              fill="#ffffff"
              stroke="#000000"
              strokeWidth="0.6"
              opacity="0.9"
            >
              {label}
            </text>
            <text
              x="46"
              y="72"
              fontFamily="Inter, system-ui, sans-serif"
              fontSize="14"
              fontWeight="800"
              fill="#ffffff"
              stroke="#000000"
              strokeWidth="0.6"
              opacity="0.9"
            >
              {label}
            </text>
          </pattern>
          {/* Secondary counter-rotated pattern — fills gaps between the
              primary so no bright region of the photo is free of the stamp. */}
          <pattern
            id="screenshot-watermark-secondary"
            patternUnits="userSpaceOnUse"
            width="200"
            height="110"
            patternTransform="rotate(18)"
          >
            <text
              x="16"
              y="52"
              fontFamily="Inter, system-ui, sans-serif"
              fontSize="12"
              fontWeight="700"
              fill="#ffffff"
              stroke="#000000"
              strokeWidth="0.5"
              opacity="0.85"
            >
              {label}
            </text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#screenshot-watermark-primary)" />
        <rect width="100%" height="100%" fill="url(#screenshot-watermark-secondary)" />

        {/* Three BIG diagonal bands across the middle third of the screen
            carrying the viewer's email + DO NOT SHARE.  Can't be missed
            in any screenshot — the band crosses the subject's face / body. */}
        <g style={{ mixBlendMode: "normal" }}>
          <text
            x="50%"
            y="30%"
            textAnchor="middle"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="42"
            fontWeight="900"
            fill="#ffffff"
            stroke="#000000"
            strokeWidth="1.2"
            opacity="0.45"
            transform="rotate(-22 500 300)"
            style={{ letterSpacing: "4px" }}
          >
            {bigLabel}
          </text>
          <text
            x="50%"
            y="58%"
            textAnchor="middle"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="42"
            fontWeight="900"
            fill="#ffffff"
            stroke="#000000"
            strokeWidth="1.2"
            opacity="0.45"
            transform="rotate(-22 500 500)"
            style={{ letterSpacing: "4px" }}
          >
            {bigLabel}
          </text>
          <text
            x="50%"
            y="86%"
            textAnchor="middle"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="42"
            fontWeight="900"
            fill="#ffffff"
            stroke="#000000"
            strokeWidth="1.2"
            opacity="0.45"
            transform="rotate(-22 500 700)"
            style={{ letterSpacing: "4px" }}
          >
            {bigLabel}
          </text>
        </g>
      </svg>
    </div>
  );
}

function BlurNotice() {
  // Portal the notice up to <html> so it renders above every other
  // stacking context on the page — the parents-portal lightbox /
  // modal uses its own container with transform, which traps
  // fixed-position children.  Hoisting out to <html> sidesteps that.
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
