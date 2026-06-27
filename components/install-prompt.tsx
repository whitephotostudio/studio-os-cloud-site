"use client";

// "Install on your phone" nudge for the /m mobile app.
//
// iOS doesn't allow installing an app from a website download — but because the
// mobile app is a PWA, a photographer can "Add to Home Screen" in Safari and get
// the same full-screen app + icon. This banner explains how. On Android/desktop
// Chrome it uses the native beforeinstallprompt for a one-tap install.

import { useEffect, useState } from "react";
import { Plus, Share, X } from "lucide-react";

const DISMISS_KEY = "studio-os-install-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [variant, setVariant] = useState<"ios" | "android">("ios");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* ignore */
    }

    const nav = window.navigator as Navigator & { standalone?: boolean };
    const isStandalone =
      nav.standalone === true ||
      window.matchMedia?.("(display-mode: standalone)").matches === true;
    if (isStandalone) return; // already installed — nothing to nudge

    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    // Only Safari can "Add to Home Screen" on iOS — Chrome/Firefox/Edge iOS can't.
    const isIOSSafari = isIOS && !/crios|fxios|edgios|opios/i.test(ua);

    if (isIOSSafari) {
      setVariant("ios");
      setShow(true);
      return;
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVariant("android");
      setShow(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  function dismiss() {
    setShow(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function androidInstall() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    dismiss();
  }

  if (!show) return null;

  return (
    <div
      style={{
        borderBottom: "1px solid #bfdbfe",
        background: "#eff6ff",
        color: "#1e3a8a",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 12.5,
        fontWeight: 700,
        lineHeight: 1.4,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {variant === "ios" ? (
          <span>
            Install Studio OS on your phone: tap{" "}
            <Share size={13} style={{ verticalAlign: "-2px" }} /> Share, then{" "}
            <strong>“Add to Home Screen”</strong>.
          </span>
        ) : (
          <span>Install Studio OS for quick one-tap access.</span>
        )}
      </div>
      {variant === "android" ? (
        <button
          type="button"
          onClick={() => void androidInstall()}
          style={{
            border: "1px solid #1d4ed8",
            background: "#1d4ed8",
            color: "#fff",
            borderRadius: 999,
            padding: "7px 12px",
            fontSize: 12,
            fontWeight: 900,
            cursor: "pointer",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Plus size={13} /> Install
        </button>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "#3b5bbf",
          cursor: "pointer",
          padding: 2,
          flexShrink: 0,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
