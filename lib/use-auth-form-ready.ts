"use client";

import { useEffect, useState } from "react";

/** Native forms must stay disabled until React owns their submit events. */
export function useAuthFormReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  return ready;
}
