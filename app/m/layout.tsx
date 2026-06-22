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
//   - a sticky bottom tab bar (Home / Orders / Schools / Events / Calendar)
//   - a centered max-width 480 column so it degrades sanely on desktop
//
// Session enforcement mirrors app/dashboard/layout.tsx.  Non-authenticated
// users get bounced to /sign-in?redirect=/m/…

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, GraduationCap, Home, PlusCircle, Search, ShoppingBag } from "lucide-react";
import { AgreementGate } from "@/components/agreement-gate";
import { SpotlightModal, type SpotlightHit } from "@/components/spotlight-search";
import { createClient } from "@/lib/supabase/client";
import {
  MOBILE_ORDER_SELECT_MONEY,
  isMobileCustomerOrder,
  isMobilePaidOrder,
  isMobileUnreadOrder,
  mobileOrderTotalCents,
  mobileRevenueDate,
} from "@/lib/mobile-order-utils";

const TRANSIENT_SESSION_FLAG = "studio-os-transient-session";
const SESSION_STARTED_FLAG = "studio-os-session-started";
const ORDER_ALERTS_ENABLED_KEY = "studio-os-mobile-order-alerts-enabled";

type TabDef = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  match: (pathname: string) => boolean;
};

type LatestOrderRow = {
  id: string;
  created_at: string | null;
  parent_name?: string | null;
  customer_name?: string | null;
  package_name?: string | null;
  total_cents: number | null;
  total_amount: number | null;
  subtotal_cents?: number | null;
  package_price?: number | null;
  currency: string | null;
  payment_status: string | null;
  paid_at: string | null;
  seen_by_photographer?: boolean | null;
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id: string | null;
  items?: Array<{
    product_name?: string | null;
    quantity?: number | null;
    price?: number | null;
    unit_price_cents?: number | null;
    line_total_cents?: number | null;
    sku?: string | null;
  }> | null;
};

type OrderAlert = {
  id: string;
  title: string;
  message: string;
  href: string;
};

type AudioCapableWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
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
  {
    href: "/m/calendar",
    label: "Calendar",
    icon: CalendarDays,
    match: (p) => p.startsWith("/m/calendar"),
  },
];

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

/** Route a global-search hit to the matching /m mobile page (instead of the
 *  desktop /dashboard pages the shared search defaults to). */
function mobileHrefForHit(hit: SpotlightHit): string {
  switch (hit.kind) {
    case "school":
      return `/m/schools/${hit.id}`;
    case "event":
      return `/m/events/${hit.id}`;
    case "order":
      return `/m/orders/${hit.id}`;
    case "student": {
      // The student hit's href carries the school id: /dashboard/projects/
      // schools/<schoolId>?student=<id>. Keep BOTH the school id and the
      // student id so the /m school page can scroll to + blue-highlight the
      // student, matching the desktop behavior.
      const m = hit.href.match(/schools\/([^/?]+)/);
      return m
        ? `/m/schools/${m[1]}?student=${encodeURIComponent(hit.id)}`
        : "/m/schools";
    }
  }
}

function moneyFromCents(cents: number, currency = "CAD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function orderCustomerName(order: LatestOrderRow) {
  return clean(order.parent_name) || clean(order.customer_name) || "A client";
}

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/m";
  const [supabase] = useState(() => createClient());
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [photographerId, setPhotographerId] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [orderAlert, setOrderAlert] = useState<OrderAlert | null>(null);
  const latestOrderCreatedRef = useRef<string | null>(null);
  const latestOrderIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const notificationPermissionRef = useRef<NotificationPermission | "unsupported">(
    "unsupported",
  );

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
        setPhotographerId(photog.id);
        const { data: unreadRows } = await supabase
          .from("orders")
          .select(`id, created_at, status, parent_email, customer_email, seen_by_photographer, ${MOBILE_ORDER_SELECT_MONEY}`)
          .eq("photographer_id", photog.id)
          .eq("seen_by_photographer", false)
          .order("created_at", { ascending: false })
          .limit(500);
        const nextUnread = ((unreadRows ?? []) as LatestOrderRow[])
          .filter(isMobileCustomerOrder)
          .filter(isMobileUnreadOrder).length;
        if (!cancelled) setUnreadCount(nextUnread);
      }
    }
    void guard();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setNotificationPermission(
      "Notification" in window ? Notification.permission : "unsupported",
    );
    setSoundEnabled(window.localStorage.getItem(ORDER_ALERTS_ENABLED_KEY) === "1");
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    notificationPermissionRef.current = notificationPermission;
  }, [notificationPermission]);

  async function playOrderChime() {
    if (typeof window === "undefined") return;
    const audioWindow = window as AudioCapableWindow;
    const AudioContextCtor =
      audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextCtor) return;

    const ctx = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = ctx;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
    master.connect(ctx.destination);

    [880, 1174.66, 1567.98].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + index * 0.11;
      osc.type = index === 2 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 0.26);
    });
  }

  async function enableOrderAlerts() {
    try {
      await playOrderChime();
      setSoundEnabled(true);
      window.localStorage.setItem(ORDER_ALERTS_ENABLED_KEY, "1");
    } catch {
      setSoundEnabled(false);
      window.localStorage.removeItem(ORDER_ALERTS_ENABLED_KEY);
    }

    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        setNotificationPermission(permission);
      } else {
        setNotificationPermission(Notification.permission);
      }
    }

    setOrderAlert({
      id: "alerts-enabled",
      title: "Order alerts enabled",
      message: "New paid orders will beep and show here while Studio OS Mobile is open.",
      href: "/m/orders",
    });
    window.setTimeout(() => {
      setOrderAlert((current) =>
        current?.id === "alerts-enabled" ? null : current,
      );
    }, 4200);
  }

  useEffect(() => {
    if (!photographerId) return;

    let cancelled = false;

    async function pollLatestOrder(initial = false) {
      const [latestResult, unreadResult] = await Promise.all([
        supabase
          .from("orders")
          .select(
            `id, created_at, parent_name, customer_name, package_name, seen_by_photographer, ${MOBILE_ORDER_SELECT_MONEY}`,
          )
          .eq("photographer_id", photographerId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("orders")
          .select(`id, created_at, status, parent_email, customer_email, seen_by_photographer, ${MOBILE_ORDER_SELECT_MONEY}`)
          .eq("photographer_id", photographerId)
          .eq("seen_by_photographer", false)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      if (cancelled) return;
      setUnreadCount(
        ((unreadResult.data ?? []) as LatestOrderRow[])
          .filter(isMobileCustomerOrder)
          .filter(isMobileUnreadOrder).length,
      );

      const latestOrder = ((latestResult.data ?? []) as LatestOrderRow[])
        .filter(isMobileCustomerOrder)
        .filter(isMobilePaidOrder)
        .sort((a, b) => {
          const aTime = new Date(mobileRevenueDate(a) || a.created_at || 0).getTime();
          const bTime = new Date(mobileRevenueDate(b) || b.created_at || 0).getTime();
          return bTime - aTime;
        })[0];
      if (!latestOrder?.id) return;

      const latestOrderTime = mobileRevenueDate(latestOrder);
      const previousCreated = latestOrderCreatedRef.current;
      const previousId = latestOrderIdRef.current;
      latestOrderCreatedRef.current = latestOrderTime;
      latestOrderIdRef.current = latestOrder.id;

      const latestCreatedMs = latestOrderTime
        ? new Date(latestOrderTime).getTime()
        : 0;
      const previousCreatedMs = previousCreated
        ? new Date(previousCreated).getTime()
        : 0;
      const isNewOrder =
        !initial &&
        !!previousId &&
        latestOrder.id !== previousId &&
        latestCreatedMs > previousCreatedMs;

      if (!isNewOrder) return;

      const amount = moneyFromCents(
        mobileOrderTotalCents(latestOrder),
        clean(latestOrder.currency).toUpperCase() || "CAD",
      );
      const customer = orderCustomerName(latestOrder);
      const alert: OrderAlert = {
        id: latestOrder.id,
        title: "New order placed",
        message: `${customer} placed an order for ${amount}.`,
        href: `/m/orders/${latestOrder.id}`,
      };

      setOrderAlert(alert);
      window.setTimeout(() => {
        setOrderAlert((current) => (current?.id === latestOrder.id ? null : current));
      }, 12000);

      if (soundEnabledRef.current) {
        void playOrderChime();
      }

      if (
        notificationPermissionRef.current === "granted" &&
        typeof window !== "undefined" &&
        "Notification" in window
      ) {
        new Notification(alert.title, {
          body: alert.message,
          icon: "/studio_os_logo_official_cropped.png",
          tag: `studio-os-order-${latestOrder.id}`,
        });
      }
    }

    void pollLatestOrder(true);
    const interval = window.setInterval(() => {
      void pollLatestOrder(false);
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [photographerId, supabase]);

  const activeHref = useMemo(() => {
    const hit = TABS.find((t) => t.match(pathname));
    return hit?.href ?? "/m";
  }, [pathname]);

  return (
    <AgreementGate>
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
              minWidth: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/studio_os_logo_official_cropped.png"
              alt=""
              style={{ width: 34, height: 34, borderRadius: 10, objectFit: "contain" }}
            />
            <div style={{ fontWeight: 900, fontSize: 15, whiteSpace: "nowrap" }}>
              Studio OS Mobile
            </div>
          </Link>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search everything"
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "#fff",
                border: "1px solid #e5e7eb",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#111827",
                cursor: "pointer",
              }}
            >
              <Search size={18} />
            </button>

            <Link
              href="/m/new"
              aria-label="Create event or school"
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "#111827",
                border: "1px solid #111827",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                textDecoration: "none",
              }}
            >
              <PlusCircle size={19} />
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
          </div>
        </header>

        {/* Global "Search everything" — same engine as the desktop dashboard,
            but results route to the /m mobile pages. */}
        <SpotlightModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          hrefFor={mobileHrefForHit}
        />

        {checkedAuth && (!soundEnabled || notificationPermission === "default") ? (
          <div
            style={{
              borderBottom: "1px solid #fde68a",
              background: "#fffbeb",
              color: "#92400e",
              padding: "9px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            <span style={{ lineHeight: 1.35 }}>
              Enable beeps and phone banners for new orders.
            </span>
            <button
              type="button"
              onClick={() => void enableOrderAlerts()}
              style={{
                border: "1px solid #f59e0b",
                background: "#fff",
                color: "#92400e",
                borderRadius: 999,
                padding: "7px 10px",
                fontSize: 12,
                fontWeight: 900,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Enable
            </button>
          </div>
        ) : null}

        {orderAlert ? (
          <Link
            href={orderAlert.href}
            style={{
              borderBottom: "1px solid #bbf7d0",
              background: "#f0fdf4",
              color: "#14532d",
              padding: "10px 14px",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block" }}>{orderAlert.title}</span>
              <span
                style={{
                  display: "block",
                  marginTop: 2,
                  color: "#166534",
                  fontSize: 12,
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {orderAlert.message}
              </span>
            </span>
            <span style={{ fontSize: 12, fontWeight: 900, flexShrink: 0 }}>
              Open
            </span>
          </Link>
        ) : null}

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
    </AgreementGate>
  );
}
