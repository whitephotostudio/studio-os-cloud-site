"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-is-mobile";

// Keep these keys in sync with app/sign-in/page.tsx.  When a photographer
// opts out of "Keep me signed in", we mark the session as transient in
// localStorage and tag the active browser session in sessionStorage.  On a
// fresh browser (sessionStorage cleared) we find the transient flag without
// the session tag → sign the user out so they have to re-authenticate.
const TRANSIENT_SESSION_FLAG = "studio-os-transient-session";
const SESSION_STARTED_FLAG = "studio-os-session-started";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function enforceTransientSession() {
      try {
        const transient =
          window.localStorage.getItem(TRANSIENT_SESSION_FLAG) === "1";
        if (!transient) return;
        const sessionTagged =
          window.sessionStorage.getItem(SESSION_STARTED_FLAG) === "1";
        if (sessionTagged) return; // Same browser session the user signed in with.

        // New browser session and the user opted out of being remembered –
        // clear their local session and send them back to sign-in.
        const supabase = createClient();
        await supabase.auth.signOut({ scope: "local" });
        if (cancelled) return;
        window.localStorage.removeItem(TRANSIENT_SESSION_FLAG);
        const current = window.location.pathname + window.location.search;
        window.location.href = `/sign-in?redirect=${encodeURIComponent(current)}`;
      } catch {
        // Best effort – never block the dashboard if storage is locked down.
      }
    }
    enforceTransientSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-close the mobile drawer if the viewport grows past the breakpoint
  // (e.g. tablet rotation) so desktop users never see a stuck overlay.
  useEffect(() => {
    if (!isMobile && drawerOpen) setDrawerOpen(false);
  }, [isMobile, drawerOpen]);

  // Lock page scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  // --- Mobile: topbar + slide-in drawer, no fixed sidebar ---
  if (isMobile) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: "100vh",
          background: "#f0f0f0",
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            background: "#000",
            borderBottom: "1px solid #1a1a1a",
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center" }}>
            <Logo small />
          </div>
          <button
            type="button"
            aria-label={drawerOpen ? "Close menu" : "Open menu"}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "transparent",
              color: "#fff",
              border: "1px solid #333",
              cursor: "pointer",
            }}
          >
            {drawerOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>

        {drawerOpen && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              display: "flex",
            }}
          >
            <div
              style={{
                width: "min(86vw, 320px)",
                height: "100%",
                background: "#000",
                boxShadow: "0 0 32px rgba(0,0,0,0.4)",
                overflowY: "auto",
              }}
            >
              <DashboardSidebar
                mobileOverlay
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setDrawerOpen(false)}
              style={{
                flex: 1,
                background: "rgba(0,0,0,0.45)",
                border: "none",
                cursor: "pointer",
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // --- Desktop: unchanged from before. ---
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
      <DashboardSidebar />
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
