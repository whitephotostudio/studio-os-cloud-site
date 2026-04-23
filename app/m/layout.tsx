"use client";

// Mobile-only surface for Studio OS Cloud.
//
// Why this exists: Harout spends half his day in motion — between schools,
// driving between events, fielding parent calls.  The desktop dashboard is
// beautiful but dense; on a phone the one-handed, thumb-reach affordances
// matter more than any individual feature.
//
// This layout gives every /m/* route:
//   - a sticky top header with the studio logo + a bell icon (unread orders)
//   - a sticky bottom tab bar (Home / Orders / Schools / Events)
//   - a centered max-width 480 column so it degrades sanely on desktop
//
// Session enforcement mirrors app/dashboard/layout.tsx.  Non-authenticated
// users get bounced to /sign-in?redirect=/m/…

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, GraduationCap, Home, ShoppingBag } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const TRANSIENT_SESSION_FLAG = "studio-os-transient-session";
const SESSION_STARTED_FLAG = "studio-os-session-started";

type TabDef = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  match: (pathname: string) => boolean;
};

const TABS: TabDef[] = [
  {
    href: "/m",
    label: "Home",
    icon: Home,
    match: (p) => p === "/m",
  },
  {
    href: "/m/orders",
    label: "Orders",
    icon: ShoppingBag,
    match: (p) => p.startsWith("/m/orders"),
  },
  {
    href: "/m/schools",
    label: "Schools",
    icon: GraduationCap,
    match: (p) => p.startsWith("/m/schools"),
  },
  {
    href: "/m/events",
    label: "Events",
    icon: CalendarDays,
    match: (p) => p.startsWith("/m/events"),
  },
];

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/m";
  const [supabase] = useState(() => createClient());
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [checkedAuth, setCheckedAuth] = useState(false);

  // ── Session guard ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function guard() {
      try {
        const transient =
          window.localStorage.getItem(TRANSIENT_SESSION_FLAG) === "1";
        const sessionTagged =
          window.sessionStorage.getItem(SESSION_STARTED_FLAG) === "1";
        if (transient && !sessionTagged) {
          await supabase.auth.signOut({ scope: "local" });
          if (cancelled) return;
          window.localStorage.removeItem(TRANSIENT_SESSION_FLAG);
          window.location.href = `/sign-in?redirect=${encodeURIComponent(
            window.location.pathname + window.location.search,
          )}`;
          return;
        }
      } catch {
        // Best effort.
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        window.location.href = `/sign-in?redirect=${encodeURIComponent(
          window.location.pathname + window.location.search,
        )}`;
        return;
      }
      setCheckedAuth(true);

      // Fetch the unread-order count once per mount.  The bell icon exposes
      // this so Harout sees "new orders waiting" without opening the list.
      const { data: photog } = await supabase
        .from("photographers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (photog?.id) {
        const { count } = await supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("photographer_id", photog.id)
          .eq("seen_by_photographer", false);
        if (!cancelled) setUnreadCount(count ?? 0);
      }
    }
    void guard();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const activeHref = useMemo(() => {
    const hit = TABS.find((t) => t.match(pathname));
    return hit?.href ?? "/m";
  }, [pathname]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f7f5f2",
        display: "flex",
        justifyContent: "center",
      }}
    >
      {/* Phone-width column, centered on desktop so /m doesn't stretch. */}
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          minHeight: "100vh",
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          boxShadow: "0 0 0 1px #e5e7eb",
        }}
      >
        {/* ── Sticky top header ──────────────────────────────────── */}
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            background: "#fff",
            borderBottom: "1px solid #eef2f7",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <Link
            href="/m"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              textDecoration: "none",
              color: "#111827",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: "#cc0000",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 900,
                fontSize: 14,
                letterSpacing: "0.02em",
              }}
            >
              SO
            </div>
            <div style={{ fontWeight: 900, fontSize: 15 }}>Studio OS</div>
          </Link>

          <Link
            href="/m/orders"
            aria-label={
              unreadCount > 0
                ? `${unreadCount} new orders`
                : "No new orders"
            }
            style={{
              position: "relative",
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "#fff",
              border: "1px solid #e5e7eb",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#111827",
              textDecoration: "none",
            }}
          >
            <Bell size={18} />
            {unreadCount > 0 ? (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 5,
                  right: 5,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 999,
                  background: "#cc0000",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 900,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 4px",
                  border: "2px solid #fff",
                }}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Link>
        </header>

        {/* ── Content ────────────────────────────────────────────── */}
        <main
          style={{
            flex: 1,
            padding: "16px 14px 90px",
            // Bottom padding reserves space for the sticky tab bar so the
            // last content row never sits under it.
          }}
        >
          {checkedAuth ? (
            children
          ) : (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#6b7280",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Loading…
            </div>
          )}
        </main>

        {/* ── Sticky bottom tab bar ─────────────────────────────── */}
        <nav
          aria-label="Primary"
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 20,
            background: "#ffffff",
            borderTop: "1px solid #eef2f7",
            display: "grid",
            gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
            boxShadow: "0 -2px 12px rgba(15,23,42,0.04)",
          }}
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.href === activeHref;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                style={{
                  padding: "10px 4px 12px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                  textDecoration: "none",
                  color: active ? "#cc0000" : "#6b7280",
                  fontWeight: 800,
                  fontSize: 11,
                  letterSpacing: "0.02em",
                }}
              >
                <Icon size={21} />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
