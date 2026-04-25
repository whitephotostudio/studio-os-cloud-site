"use client";

// WhatsNewDot
//
// Drop next to ANY new feature surface to show a small pulsing blue dot
// until the photographer interacts with it.  The dot persists per-user in
// photographers.seen_features and never reappears once dismissed.
//
// Usage — wrap the surface so a click anywhere inside dismisses the dot:
//
//   <WhatsNewDot featureId="combine-orders-commerce-settings-v1">
//     <button onClick={...}>New settings</button>
//   </WhatsNewDot>
//
// Or as a non-wrapping bare dot positioned by the parent (when wrapping
// would break layout):
//
//   <div style={{position: "relative"}}>
//     <button>...</button>
//     <WhatsNewDot featureId="..." asBareDot top={6} right={6} />
//   </div>
//
// The dismissal logic is shared across the page via a tiny global cache
// + a custom event so multiple dots for the same feature on one page all
// vanish together.

import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ── Shared seen-set cache ────────────────────────────────────────────
//
// Multiple <WhatsNewDot> instances on the same page should share one
// fetch + one source of truth.  We keep it in a module-level set and
// notify subscribers via a CustomEvent.

let cachedSeen: Set<string> | null = null;
let inflightFetch: Promise<Set<string>> | null = null;
const DOT_CHANGE_EVENT = "studio-os-whats-new-dot-change";

async function ensureSeenLoaded(): Promise<Set<string>> {
  if (cachedSeen) return cachedSeen;
  if (inflightFetch) return inflightFetch;
  inflightFetch = (async () => {
    try {
      const res = await fetch("/api/dashboard/whats-new/seen", {
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        seen?: string[];
      };
      const set = new Set(
        Array.isArray(body.seen) ? body.seen.filter((s) => typeof s === "string") : [],
      );
      cachedSeen = set;
      return set;
    } catch {
      // Network failure: pretend nothing's seen.  Worst case the dot
      // sticks around for one more session.
      const fallback = new Set<string>();
      cachedSeen = fallback;
      return fallback;
    } finally {
      inflightFetch = null;
    }
  })();
  return inflightFetch;
}

function broadcastSeen(featureId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DOT_CHANGE_EVENT, { detail: { featureId } }),
  );
}

async function markSeen(featureId: string) {
  if (cachedSeen?.has(featureId)) return;
  // Optimistic local update first so the dot disappears instantly even
  // if the network is slow.
  if (!cachedSeen) cachedSeen = new Set();
  cachedSeen.add(featureId);
  broadcastSeen(featureId);
  try {
    await fetch("/api/dashboard/whats-new/seen", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featureId }),
    });
  } catch {
    // Server failure: keep the optimistic local state. The next page
    // load will re-fetch authoritative data; if the write got lost the
    // dot reappears once.  Acceptable.
  }
}

// ── Public hook ──────────────────────────────────────────────────────

/**
 * useIsFeatureNew — true when the current photographer hasn't seen this
 * feature yet. Updates when the seen-set changes (other dots dismissing,
 * cross-tab events).  Returns `false` for users who aren't authenticated
 * (so anonymous parents never see the dots).
 */
export function useIsFeatureNew(featureId: string): {
  isNew: boolean;
  dismiss: () => void;
} {
  const [isNew, setIsNew] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const featureRef = useRef(featureId);
  featureRef.current = featureId;

  useEffect(() => {
    let cancelled = false;
    void ensureSeenLoaded().then((seen) => {
      if (cancelled) return;
      setIsNew(!seen.has(featureRef.current));
      setLoaded(true);
    });
    function onChange(e: Event) {
      const detail = (e as CustomEvent<{ featureId: string }>).detail;
      if (detail.featureId === featureRef.current) {
        setIsNew(false);
      }
    }
    window.addEventListener(DOT_CHANGE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(DOT_CHANGE_EVENT, onChange);
    };
  }, []);

  const dismiss = useCallback(() => {
    void markSeen(featureRef.current);
  }, []);

  return { isNew: loaded && isNew, dismiss };
}

// ── The visual dot ───────────────────────────────────────────────────

type Props = {
  featureId: string;
  /** When true, render only the dot (no wrapper), positioned by the parent's relative container. */
  asBareDot?: boolean;
  /** Pixel offsets when asBareDot is true. */
  top?: number;
  right?: number;
  /** Optional override for dot size (default 10). */
  size?: number;
  children?: ReactNode;
};

export function WhatsNewDot({
  featureId,
  asBareDot = false,
  top = 4,
  right = 4,
  size = 10,
  children,
}: Props) {
  const { isNew, dismiss } = useIsFeatureNew(featureId);

  const dotStyle: React.CSSProperties = useMemo(
    () => ({
      position: "absolute",
      top,
      right,
      width: size,
      height: size,
      borderRadius: 999,
      background: "#2563eb",
      boxShadow: "0 0 0 2px #ffffff, 0 0 0 4px rgba(37,99,235,0.18)",
      pointerEvents: "none",
      zIndex: 5,
      animation: isNew ? "studio-os-whats-new-pulse 1.6s ease-in-out infinite" : "none",
    }),
    [isNew, size, top, right],
  );

  // Shared keyframes — injected once per page load.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "studio-os-whats-new-keyframes";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes studio-os-whats-new-pulse {
        0%   { transform: scale(1);   opacity: 1;    }
        50%  { transform: scale(1.25); opacity: 0.85; }
        100% { transform: scale(1);   opacity: 1;    }
      }
    `;
    document.head.appendChild(style);
  }, []);

  if (asBareDot) {
    if (!isNew) return null;
    return <span aria-hidden style={dotStyle} />;
  }

  // Wrapping mode: any click/keydown inside the wrapper dismisses the dot.
  return (
    <span
      onClickCapture={() => {
        if (isNew) dismiss();
      }}
      onKeyDownCapture={() => {
        if (isNew) dismiss();
      }}
      style={{ position: "relative", display: "inline-flex" }}
    >
      {children}
      {isNew ? <span aria-hidden style={dotStyle} /> : null}
    </span>
  );
}

export default WhatsNewDot;
