"use client";

import { useEffect, useState } from "react";

/**
 * Returns `true` when the viewport width is below the given breakpoint.
 * SSR-safe: always returns `false` on the first render to avoid hydration
 * mismatches; updates immediately after mount.
 *
 * Default breakpoint (640px) matches Tailwind's `sm:` — use the same
 * breakpoint everywhere in the app so mobile toggles stay consistent.
 */
export function useIsMobile(breakpointPx = 640) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpointPx]);

  return isMobile;
}
