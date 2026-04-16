"use client";

import { useEffect } from "react";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { createClient } from "@/lib/supabase/client";

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

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
      <DashboardSidebar />
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
