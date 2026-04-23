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
const BODY_BLUR_FILTER = "blur(26px) saturate(0.5)";

function ScreenshotProtection({ flags, watermarkText }: Props) {
  const [blurred, setBlurred] = useState(false);
  const blurTimerRef = useRef<number | null>(null);

  // Synchronous DOM apply — we paint the blur into the current frame and
  // THEN kick React state so the notice / other effects render.  Waiting
  // for React to flush means one frame of unblurred paint, which is the
  // exact window macOS ⌘⇧4 needs to grab a clean image.
  const triggerBlur = useCallback((ms: number = BLUR_DURATION_MS) => {
    if (typeof document !== "undefined" && document.body) {
      document.body.style.transition = "";
      document.body.style.filter = BODY_BLUR_FILTER;
    }
    setBlurred(true);
    if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current);
    blurTimerRef.current = window.setTimeout(() => {
      setBlurred(false);
    }, ms);
  }, []);

  // Apply a blur filter to <body> whenever `blurred` flips on.  Using body
  // (not html) means the floating watermark + overlay notice are also blurred
  // — which is fine, the point is to hide the gallery.
  //
  // NOTE: no CSS transition here.  Any animated easing would mean the OS
  // frame-grab happens during the fade-in and captures a barely-blurred
  // image.  We want instant, full blur the same frame we detect the threat.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    if (!body) return;
    if (blurred) {
      body.style.transition = "";
      body.style.filter = "blur(26px) saturate(0.5)";
    } else {
      body.style.filter = "";
    }
    return () => {
      body.style.filter = "";
    };
  }, [blurred]);

  // Desktop keystroke + focus + contextmenu listeners + proactive triggers.
  useEffect(() => {
    if (!flags.desktop) return;

    // Skip modifier-triggered blur when the user is typing in a real input
    // so typing Shift-H for a capital H etc. doesn't strobe the gallery.
    function targetIsInput(t: EventTarget | null): boolean {
      if (!(t instanceof Element)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t instanceof HTMLElement && t.isContentEditable) return true;
      return false;
    }

    function onKeyDown(e: KeyboardEvent) {
      const key = e.key;
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      const inInput = targetIsInput(e.target);

      // MAX-AGGRESSIVE PREDICTIVE TRIGGER (desktop only, outside inputs):
      // Blur on ANY modifier-key activity.  The goal is to beat macOS
      // consuming ⌘⇧3/4/5 before the browser ever sees those specific
      // keydowns.  By firing on the Command/Shift/Control press itself —
      // BEFORE the user can press the digit — we guarantee the blur is
      // already painted by the time the capture shortcut runs.
      //
      // What fires:
      //   - Command / Meta press alone (user is starting a keyboard shortcut)
      //   - Shift press alone (user is starting ⌘⇧x or a shift-shortcut)
      //   - Any Meta-held or Shift-held keydown
      //
      // What's excluded:
      //   - Anything typed in an <input>, <textarea>, <select>, or
      //     contenteditable element (so text entry still works).
      //
      // Cost: pressing ⌘R / ⌘T / ⌘W etc. while the gallery has focus
      // briefly blurs for 5s.  Trade accepted — one leaked photo is
      // worse than a 5-second re-render on an unrelated shortcut.
      if (!inInput) {
        // Modifier press alone (Meta / Control / Shift)
        if (key === "Meta" || key === "Control" || key === "Shift") {
          triggerBlur(SCREENSHOT_BLUR_DURATION_MS);
        }
        // Any keydown while a modifier is held (catches the printable
        // keys of combos, including ⌘⇧4 keydown on browsers that still
        // deliver it).
        if (meta || shift) {
          triggerBlur(SCREENSHOT_BLUR_DURATION_MS);
        }
      }

      // Specific screenshot keys — try to preventDefault even though
      // macOS will consume them at the OS level before this runs.
      if (meta && shift && ["3", "4", "5", "6"].includes(key)) {
        e.preventDefault();
        triggerBlur(SCREENSHOT_BLUR_DURATION_MS);
      }

      // Windows: PrtSc — can't actually block it but blur ASAP.
      if (key === "PrintScreen") {
        triggerBlur(SCREENSHOT_BLUR_DURATION_MS);
      }
    }

    // Keep blur alive while ANY modifier is still held.  For ⌘⇧4 the
    // user presses keys and then drags with the mouse — by the time they
    // release, we've had seconds of modifier-down events firing this.
    function onKeyUp(e: KeyboardEvent) {
      if (targetIsInput(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      const wasModifier =
        e.key === "Meta" ||
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt";
      if (meta || shift || wasModifier) {
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
    window.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("dragstart", onDragStart, true);
    document.documentElement.addEventListener("mouseleave", onDocumentMouseLeave);
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("dragstart", onDragStart, true);
      document.documentElement.removeEventListener("mouseleave", onDocumentMouseLeave);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [flags.desktop, triggerBlur]);

  // Mobile: always-on half-blur mode + press-and-hold reveal.
  //
  // The CSS injected below applies a diagonal blurred overlay to every
  // `[data-gallery-image]` container.  The overlay covers the lower-right
  // triangle of each photo at all times.  When a parent presses and holds
  // a photo, we add the `ss-reveal` class which removes the overlay; on
  // release we remove the class and the overlay restores.
  //
  // The overlay uses `backdrop-filter: blur(...)` so the underlying image
  // is actually obscured — not just covered.  This means any OS screenshot
  // (iOS "Save Image" sheet, Android native capture, ⌘⇧3 on a connected
  // touchscreen) yields a half-blurred image.
  useEffect(() => {
    if (!flags.mobile) return;

    let heldTarget: Element | null = null;

    function findGalleryTile(el: EventTarget | null): Element | null {
      if (!(el instanceof Element)) return null;
      return el.closest("[data-gallery-image]");
    }

    function onPressStart(e: TouchEvent | MouseEvent) {
      const tile = findGalleryTile(e.target);
      if (!tile) return;
      if (heldTarget && heldTarget !== tile) {
        heldTarget.classList.remove("ss-reveal");
      }
      heldTarget = tile;
      tile.classList.add("ss-reveal");
    }

    function onPressEnd() {
      if (heldTarget) {
        heldTarget.classList.remove("ss-reveal");
        heldTarget = null;
      }
    }

    function onContextMenu(e: Event) {
      e.preventDefault();
    }

    window.addEventListener("touchstart", onPressStart, { passive: true });
    window.addEventListener("touchend", onPressEnd, { passive: true });
    window.addEventListener("touchcancel", onPressEnd, { passive: true });
    // Mouse fallback so the same pattern works on tablets with a trackpad.
    window.addEventListener("mousedown", onPressStart, true);
    window.addEventListener("mouseup", onPressEnd, true);
    window.addEventListener("contextmenu", onContextMenu, true);

    return () => {
      window.removeEventListener("touchstart", onPressStart);
      window.removeEventListener("touchend", onPressEnd);
      window.removeEventListener("touchcancel", onPressEnd);
      window.removeEventListener("mousedown", onPressStart, true);
      window.removeEventListener("mouseup", onPressEnd, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      if (heldTarget) {
        (heldTarget as Element).classList.remove("ss-reveal");
      }
    };
  }, [flags.mobile]);

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
      {/* CSS-level defenses.  The mobile half-blur overlay is the key
          "always-on" deterrent — applied via ::after on every gallery tile
          container.  `ss-reveal` is toggled by the press-and-hold JS above. */}
      {(flags.desktop || flags.mobile) ? (
        <style>{`
          img { -webkit-user-drag: none; user-select: none; }
          ${flags.mobile ? `
          img, [data-gallery-image] {
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
          }
          [data-gallery-image] {
            position: relative;
            isolation: isolate;
          }
          [data-gallery-image]::after {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 3;
            backdrop-filter: blur(16px) saturate(0.7);
            -webkit-backdrop-filter: blur(16px) saturate(0.7);
            clip-path: polygon(100% 0%, 100% 100%, 0% 100%);
            background: linear-gradient(135deg, transparent 45%, rgba(20,20,30,0.08) 50%, transparent 55%);
            transition: opacity 120ms ease;
            opacity: 1;
          }
          [data-gallery-image].ss-reveal::after {
            opacity: 0;
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
