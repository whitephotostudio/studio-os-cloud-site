"use client";

// Mobile home — /m
//
// The landing screen when Harout opens Studio OS on his phone.  Three jobs:
//   1. Tell him at a glance: new orders today, how many schools are live.
//   2. Give him a Spotlight-style search he can tap once and find a student,
//      order, school, or event across everything.
//   3. Big thumb-reach tiles for the subpages.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  Camera,
  GraduationCap,
  LayoutGrid,
  PartyPopper,
  Search,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  MOBILE_ORDER_SELECT_MONEY,
  cleanMobileOrderValue,
  isMobileCustomerOrder,
  isMobileMainWorkflowOrder,
  isMobilePaidOrder,
  isMobileUnreadOrder,
  mobileOrderTotalCents,
  mobileRevenueDate,
  type MobileOrderMoneyRow,
} from "@/lib/mobile-order-utils";
import { SpotlightModal, type SpotlightHit } from "@/components/spotlight-search";

// ── Types ────────────────────────────────────────────────────────────

// Route a global-search hit to the matching /m mobile page so the home search
// box behaves exactly like the header search icon (one shared smart palette).
function mobileHrefForHit(hit: SpotlightHit): string {
  switch (hit.kind) {
    case "school":
      return `/m/schools/${hit.id}`;
    case "event":
      return `/m/events/${hit.id}`;
    case "order":
      return `/m/orders/${hit.id}`;
    case "student": {
      const m = hit.href.match(/schools\/([^/?]+)/);
      return m
        ? `/m/schools/${m[1]}?student=${encodeURIComponent(hit.id)}`
        : "/m/schools";
    }
  }
}

type StatsOrderRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  parent_email: string | null;
  customer_email: string | null;
  total_cents: number | null;
  total_amount: number | null;
  subtotal_cents: number | null;
  package_price: number | null;
  currency: string | null;
  payment_status: string | null;
  paid_at: string | null;
  seen_by_photographer: boolean | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
} & MobileOrderMoneyRow;

// ── Helpers ──────────────────────────────────────────────────────────

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function moneyFromCents(cents: number, currency = "CAD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents >= 1000000 ? 0 : 2,
  }).format(cents / 100);
}

export default function MobileHomePage() {
  const [supabase] = useState(() => createClient());
  const [photographerId, setPhotographerId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [todaysOrders, setTodaysOrders] = useState(0);
  const [unreadOrders, setUnreadOrders] = useState(0);
  const [activeSchools, setActiveSchools] = useState(0);
  const [visibleRevenueCents, setVisibleRevenueCents] = useState(0);
  const [monthRevenueCents, setMonthRevenueCents] = useState(0);
  const [statsCurrency, setStatsCurrency] = useState("CAD");

  const [searchOpen, setSearchOpen] = useState(false);

  // ── Bootstrap: user, stats ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: photog } = await supabase
        .from("photographers")
        .select("id, business_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!photog?.id || cancelled) return;
      setPhotographerId(photog.id);
      setFirstName(
        clean(
          (photog as { business_name?: string | null }).business_name ?? "",
        ).split(" ")[0] ?? "",
      );

      const now = new Date();
      const startOfTodayDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const startOfMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfMonth = startOfMonthDate.toISOString();
      const orderStatsSelect = `
        id, created_at, status, parent_email, customer_email, seen_by_photographer,
        ${MOBILE_ORDER_SELECT_MONEY}
      `;
      const [recentOrders, monthOrders, schools] = await Promise.all([
        supabase
          .from("orders")
          .select(orderStatsSelect)
          .eq("photographer_id", photog.id)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("orders")
          .select(orderStatsSelect)
          .eq("photographer_id", photog.id)
          .or(`created_at.gte.${startOfMonth},paid_at.gte.${startOfMonth}`)
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("schools")
          .select("id", { count: "exact", head: true })
          .eq("photographer_id", photog.id),
      ]);
      if (cancelled) return;
      const visibleOrders = ((recentOrders.data ?? []) as StatsOrderRow[])
        .filter(isMobileCustomerOrder);
      const monthOrderRows = ((monthOrders.data ?? []) as StatsOrderRow[])
        .filter(isMobileCustomerOrder);
      const resolvedCurrency =
        cleanMobileOrderValue(visibleOrders.find((order) => cleanMobileOrderValue(order.currency))?.currency) ||
        cleanMobileOrderValue(monthOrderRows.find((order) => cleanMobileOrderValue(order.currency))?.currency) ||
        "CAD";
      setStatsCurrency(resolvedCurrency.toUpperCase());
      setTodaysOrders(
        visibleOrders.filter((order) => {
          if (!order.created_at || !isMobileMainWorkflowOrder(order)) return false;
          const createdAt = new Date(order.created_at);
          return createdAt >= startOfTodayDate;
        }).length,
      );
      setUnreadOrders(visibleOrders.filter(isMobileUnreadOrder).length);
      setActiveSchools(schools.count ?? 0);
      setVisibleRevenueCents(
        visibleOrders
          .filter(isMobilePaidOrder)
          .reduce((sum, order) => sum + mobileOrderTotalCents(order), 0),
      );
      setMonthRevenueCents(
        monthOrderRows
          .filter((order) => {
            if (!isMobilePaidOrder(order)) return false;
            const revenueDate = mobileRevenueDate(order);
            if (!revenueDate) return false;
            return new Date(revenueDate) >= startOfMonthDate;
          })
          .reduce((sum, order) => sum + mobileOrderTotalCents(order), 0),
      );
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Global search now lives in the shared SpotlightModal, opened from the
  // search box below and the header icon (see mobileHrefForHit above).

  const tiles = useMemo(
    () => [
      {
        href: "/m/capture",
        label: "Picture Day",
        icon: <Camera size={22} />,
        accent: "#cc0000",
        note: "Scan + shoot",
      },
      {
        href: "/m/sort",
        label: "Sort & Review",
        icon: <LayoutGrid size={22} />,
        accent: "#1d4ed8",
        note: "By student",
      },
      {
        href: "/m/orders",
        label: "Orders",
        icon: <ShoppingBag size={22} />,
        accent: "#cc0000",
        note: unreadOrders > 0 ? `${unreadOrders} new` : "All caught up",
      },
      {
        href: "/m/schools",
        label: "Schools",
        icon: <GraduationCap size={22} />,
        accent: "#1d4ed8",
        note: `${activeSchools} active`,
      },
      {
        href: "/m/calendar",
        label: "Calendar",
        icon: <CalendarCheck size={22} />,
        accent: "#cc0000",
        note: "Dates + notes",
      },
      {
        href: "/m/events",
        label: "Events",
        icon: <PartyPopper size={22} />,
        accent: "#b45309",
        note: "Gallery + PIN",
      },
      {
        href: "/dashboard",
        label: "Full desktop",
        icon: <Sparkles size={22} />,
        accent: "#6b7280",
        note: "Open on web",
      },
    ],
    [unreadOrders, activeSchools],
  );

  return (
    <div>
      {/* Greeting */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontWeight: 800,
            color: "#6b7280",
          }}
        >
          {greeting()}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 900,
            color: "#111827",
            marginTop: 2,
          }}
        >
          {firstName ? `Hi ${firstName} 👋` : "Studio OS"}
        </div>
      </div>

      {/* 3-stat strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <MiniStat label="New Orders Today" value={todaysOrders} tone="red" />
        <MiniStat
          label="Visible Revenue"
          value={moneyFromCents(visibleRevenueCents, statsCurrency)}
          tone="amber"
        />
        <MiniStat
          label="Revenue This Month"
          value={moneyFromCents(monthRevenueCents, statsCurrency)}
          tone="blue"
        />
      </div>

      {/* Search — opens the same smart palette as the header search icon */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        aria-label="Search students, schools, events"
        style={{
          width: "100%",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          background: "#fff",
          color: "#6b7280",
          padding: "13px 14px",
          fontSize: 15,
          fontWeight: 600,
          marginBottom: 16,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <Search size={16} style={{ color: "#6b7280", flexShrink: 0 }} />
        <span>Search students, schools, events…</span>
      </button>

      {/* Quick tiles */}
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontWeight: 800,
          color: "#6b7280",
          margin: "6px 2px 10px",
        }}
      >
        Jump to
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
        }}
      >
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              textDecoration: "none",
              color: "#111827",
              boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: `${tile.accent}14`,
                color: tile.accent,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {tile.icon}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: "#111827",
              }}
            >
              {tile.label}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "#6b7280",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {tile.note} <ArrowRight size={12} />
            </div>
          </Link>
        ))}
      </div>

      <SpotlightModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        hrefFor={mobileHrefForHit}
      />
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "red" | "amber" | "blue";
}) {
  const bg =
    tone === "red" ? "#fff5f5" : tone === "amber" ? "#fffbeb" : "#eff6ff";
  const fg =
    tone === "red" ? "#cc0000" : tone === "amber" ? "#b45309" : "#1d4ed8";
  return (
    <div
      style={{
        background: bg,
        borderRadius: 14,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 800,
          color: fg,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: typeof value === "string" && value.length > 8 ? 17 : 20,
          fontWeight: 900,
          color: "#111827",
          marginTop: 2,
          lineHeight: 1.1,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
}


