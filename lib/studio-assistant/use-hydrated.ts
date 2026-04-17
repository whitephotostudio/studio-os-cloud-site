"use client";

// Tiny utility — returns `false` on the server AND during the client's
// first render (the one that must match the server HTML for hydration),
// then `true` afterwards.  Use this to gate any logic that would otherwise
// make server HTML differ from client HTML (reading localStorage, checking
// `window.SpeechRecognition`, etc.).
//
// Implemented on top of `useSyncExternalStore` because React treats that
// hook specially for hydration: it always uses the server snapshot until
// hydration is complete, then switches to the live snapshot — so there is
// no mismatch warning.

import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => {};
}

function getClientSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
