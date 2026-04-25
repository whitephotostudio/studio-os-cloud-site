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

/**
 * Strict mobile-device detection.  ALL THREE signals must be true for
 * the always-on idle blur to activate — any one being false means we
 * treat the device as desktop (where idle blur is theater: a motivated
 * attacker just wiggles the mouse to bypass it, and legitimate parents
 * get a janky flashing gallery for no real security benefit).
 *
 *   (pointer: coarse)   → primary input is touch, not precise mouse/trackpad
 *   (hover: none)       → device can't hover — rules out hybrid laptops
 *   innerWidth < 900    → actual phone/tablet form factor
 *
 * Only real phones and narrow tablets satisfy all three.  Mac
 * trackpads, touchscreen monitors, and 2-in-1 laptops all fail at
 * least one check, so the desktop gallery stays crisp.
 */
function detectMobileGalleryMode(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia;
  if (!mm) return false;
  try {
    const coarse = mm("(pointer: coarse)").matches;
    const noHover = mm("(hover: none)").matches;
    const narrow = window.innerWidth < 900;
    return coarse && noHover && narrow;
  } catch {
    return false;
  }
}

function ScreenshotProtection({ flags, watermarkText }: Props) {
  const [blurred, setBlurred] = useState(false);
  // idleBlur = the always-on half-blur overlay, active ONLY on real
  // mobile devices (strict detection below).  Desktop never uses this —
  // idle-blur on desktop is security theater and looks janky.
  const [idleBlur, setIdleBlur] = useState(false);
  // Locked-in mobile detection.  Computed on mount and on resize.  The
  // overlay's active prop hard-gates idleBlur on this, so even if some
  // edge case sets idleBlur=true on desktop, the overlay ignores it.
  const [isMobileDevice, setIsMobileDevice] = useState(false);
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

  // Desktop keystroke + contextmenu + dragstart listeners.
  //
  // PROACTIVE TRIGGERS REMOVED (2026-04-23): mouseleave / pointerleave /
  // window.blur / visibilitychange were firing phantom blurs every time
  // the cursor left the viewport or the user clicked on another window
  // (switching tabs, clicking the URL bar, reaching for the dock, even
  // moving toward the browser's own close button).  The result was
  // near-constant blur-on-blur-off cycling that had NOTHING to do with a
  // screenshot being taken.  Now we only blur on real screenshot
  // keystrokes (⌘⇧3/4/5/6 + modifier pre-triggers + PrtSc).
  useEffect(() => {
    if (!flags.desktop) return;

    function onKeyDown(e: KeyboardEvent) {
      // Only respond to REAL hardware keystrokes.  Synthetic keydown
      // events from browser extensions, password managers, autofill
      // tools, accessibility software, or automation have
      // isTrusted=false and would otherwise trigger phantom blurs.
      if (!e.isTrusted) return;
      // Ignore auto-repeated keydowns from a held key.  Without this,
      // holding Shift/Cmd fires this handler every ~30ms, each call
      // re-triggering the 5s blur — the user sees a strobing overlay.
      if (e.repeat) return;

      const key = e.key;
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;

      // AGGRESSIVE PRE-TRIGGER (2026-04-23 pass #3): blur on the FIRST
      // modifier keydown — bare Cmd, bare Ctrl, or bare Shift.  We don't
      // wait for the second modifier because macOS ⌘⇧3 captures the
      // framebuffer as SOON as "3" is pressed, and on a fast typist the
      // gap between Shift and 3 is <20ms — not enough time to paint a
      // blur if we only start blurring on Shift.
      //
      // Press Cmd → blur for 5s.  Press Shift → blur for 5s.  Press
      // Ctrl → blur for 5s.  This catches every screenshot shortcut on
      // macOS + Windows + Linux the moment the first qualifying key
      // goes down, which is several hundred ms before the digit.
      //
      // Trade-off: Cmd+R to reload, Cmd+T for new tab, Cmd+L for URL
      // bar, bare Shift to type a capital letter will also blur the
      // gallery for 5s.  Acceptable because (a) the parents portal
      // has no text inputs to capitalize in, (b) a click dismisses the
      // blur instantly, (c) the ⌘⇧3 defense only works if we fire on
      // the FIRST modifier.  Gallery > minor UX friction on Cmd-combos.
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

    function onDragStart(e: DragEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "IMG") {
        e.preventDefault();
      }
    }

    // Attach on BOTH window and document (capture phase) so we see the
    // keydown as early as possible — some browsers route system shortcuts
    // differently and we want to grab the event on its first hop.
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("dragstart", onDragStart, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("dragstart", onDragStart, true);
    };
  }, [flags.desktop, triggerBlur]);

  // Detect real mobile on mount + on resize.  Desktop stays false
  // permanently, which hard-kills the idle-blur behavior on desktop —
  // the gallery reads crisp and clean unless the viewer actually
  // presses a screenshot key.
  useEffect(() => {
    function updateIsMobile() {
      const next = detectMobileGalleryMode();
      setIsMobileDevice((prev) => (prev === next ? prev : next));
      if (!next) setIdleBlur(false);
    }
    updateIsMobile();
    window.addEventListener("resize", updateIsMobile);
    return () => window.removeEventListener("resize", updateIsMobile);
  }, []);

  // REAL-MOBILE-ONLY idle blur.  Gated on BOTH flags.mobile (the
  // school enabled it) AND isMobileDevice (strict 3-signal detection).
  // Desktop never reaches this effect, so touchstart/touchend
  // listeners never attach on desktop — which means no
  // mouse-synthesized touch events can ever flip the blur on a Mac.
  //
  // UX MODEL (updated 2026-04-23 — the "press-and-hold to reveal"
  // design we shipped first made the gallery unusable; parents tapped
  // a photo, saw it for the duration of the tap, then it snapped back
  // to blur the instant they lifted their finger):
  //
  //   - On mount: blur is ON (catches a drive-by screenshot attempt
  //     the moment the page loads)
  //   - First touch OR scroll anywhere: blur lifts, STAYS OFF while
  //     the user is actively interacting
  //   - Every touch / scroll resets a 4-second idle timer
  //   - When the timer fires (4s of no activity): blur re-arms
  //
  // Net effect for a real parent: the gallery reads crisp and clean
  // once they tap the screen.  Net effect for an iOS Power+VolUp
  // screenshot attempt: if the attacker sets the phone down to line
  // up the shot, blur comes back and the capture is blurred; if they
  // screenshot while mid-swipe, the watermark is still burned in.
  useEffect(() => {
    if (!flags.mobile) return;
    if (!isMobileDevice) return;

    setIdleBlur(true);
    let idleTimerId: number | null = null;

    function armIdleTimer() {
      if (idleTimerId !== null) window.clearTimeout(idleTimerId);
      idleTimerId = window.setTimeout(() => {
        setIdleBlur(true);
      }, 4000);
    }

    function onActivity() {
      setIdleBlur(false);
      armIdleTimer();
    }
    function onContextMenu(e: Event) {
      e.preventDefault();
    }

    window.addEventListener("touchstart", onActivity, { passive: true });
    window.addEventListener("touchmove", onActivity, { passive: true });
    window.addEventListener("touchend", onActivity, { passive: true });
    window.addEventListener("touchcancel", onActivity, { passive: true });
    // scroll with capture:true so we catch scroll inside any nested
    // scroll container (the parents portal has several).
    window.addEventListener("scroll", onActivity, { capture: true, passive: true });
    window.addEventListener("contextmenu", onContextMenu, true);

    return () => {
      if (idleTimerId !== null) window.clearTimeout(idleTimerId);
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("touchmove", onActivity);
      window.removeEventListener("touchend", onActivity);
      window.removeEventListener("touchcancel", onActivity);
      window.removeEventListener(
        "scroll",
        onActivity,
        { capture: true } as EventListenerOptions,
      );
      window.removeEventListener("contextmenu", onContextMenu, true);
      setIdleBlur(false);
    };
  }, [flags.mobile, isMobileDevice]);

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
        // HARD GATE: desktop overlay is driven PURELY by `blurred`
        // (which only flips true on a real screenshot keystroke).
        // idleBlur can only contribute on a strictly-detected mobile
        // device.  Desktop gallery stays crisp until a modifier key
        // is pressed — no phantom flashing, no phone-camera theater.
        <IdleBlurOverlay
          active={isMobileDevice ? (idleBlur || blurred) : blurred}
          overlayRef={overlayRef}
        />
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
  // 2026-04-26: portal to document.body so the blur overlay always sits
  // at the document root.  Without this, modal-style sibling panels
  // (cart drawer, etc.) can outpaint the overlay even though it's at
  // z-index 99980, because they live in the same parent stacking
  // context.  Same fix as WatermarkOverlay below.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
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
    </>,
    document.body,
  );
}

function WatermarkOverlay({ text }: { text: string }) {
  const label = text?.trim() || "Do not copy";
  const bigLabel = `${label}  ·  DO NOT SHARE`;
  // 2026-04-26: portal the watermark to document.body so it ALWAYS sits
  // at the document root, outside any parent stacking context.  Without
  // the portal, the watermark gets trapped inside whichever parent has a
  // transform/filter/contain rule — and modal-style sibling panels
  // (e.g. the cart drawer at flex-row right side) paint OVER it even
  // though the watermark's z-index is 99990.  Symptom Harout flagged:
  // "I just did a screenshot of the basket panel" — drawer thumbnails
  // showed clean.  Portaling escapes the stacking trap.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
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
    </div>,
    document.body,
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
