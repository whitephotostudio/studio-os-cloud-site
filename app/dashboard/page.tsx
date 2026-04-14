"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import {
  getFreeTrialDaysRemaining,
  isFreeTrialActive,
  resolveFreeTrialEndsAt,
} from "@/lib/payments";
import {
  FolderOpen,
  GraduationCap,
  Images,
  LogOut,
  Package2,
  ShoppingBag,
  Users,
  Bell,
  Activity,
  ArrowUpRight,
  X,
  RefreshCw,
  Plus,
  CheckCircle2,
  Clock3,
  AlertCircle,
  TrendingUp,
  Download,
  MonitorSmartphone,
} from "lucide-react";

type Photographer = {
  id: string;
  business_name: string | null;
  is_platform_admin?: boolean | null;
  subscription_status?: string | null;
  trial_starts_at?: string | null;
  trial_ends_at?: string | null;
  created_at?: string | null;
};

type SchoolRow = {
  id: string;
  school_name: string;
  local_school_id: string | null;
  created_at: string | null;
};

type ProjectRow = {
  id: string;
  title: string | null;
  workflow_type: string | null;
  client_name: string | null;
  event_date: string | null;
  created_at: string | null;
  status: string | null;
};

type StudentRow = {
  school_id: string;
  photo_url: string | null;
};

type OrderRow = {
  id: string;
  customer_name: string | null;
  total_cents: number | null;
  created_at: string | null;
  status: string | null;
};

type EventsPayload = {
  ok?: boolean;
  message?: string;
  projects?: ProjectRow[];
};

type StudioWelcomeStatus = {
  release: {
    version: string;
    macDownloadUrl: string | null;
    windowsDownloadUrl: string | null;
  };
  entitlement: {
    planCode: string | null;
    appAccessEnabled: boolean;
    canDownload: boolean;
  };
};

const pageBg = "#ffffff";
const cardBg = "#ffffff";
const textPrimary = "#111827";
const textMuted = "#667085";
const borderSoft = "#e5e7eb";

const DISMISSED_KEY = "dashboard_dismissed_orders";
const STUDIO_WELCOME_PREFIX = "studio_os_download_welcome_seen:";

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set();
}

function saveDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)));
  } catch {}
}

const sidebar: React.CSSProperties = {
  width: 220,
  minHeight: "100vh",
  background: "#000",
  display: "flex",
  flexDirection: "column",
};

const navItem: React.CSSProperties = {
  padding: "12px 24px",
  fontSize: 14,
  color: "#ccc",
  textDecoration: "none",
  display: "block",
};

const navActive: React.CSSProperties = {
  ...navItem,
  color: "#fff",
  background: "#1a1a1a",
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function dedupeSchools(rows: SchoolRow[]) {
  const map = new Map<string, SchoolRow>();
  for (const row of rows) {
    const key = clean(row.local_school_id) || clean(row.school_name).toLowerCase() || row.id;
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

function moneyFromCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents || 0) / 100);
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No date";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "2d ago", "5h ago", "just now" */
function relativeTime(value: string | null): string {
  if (!value) return "No date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No date";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

function statusStyle(status: string): React.CSSProperties {
  const s = status.toLowerCase();
  if (s === "completed" || s === "paid" || s === "digital_paid")
    return { background: "#f0fdf4", color: "#15803d" };
  if (s === "ready")
    return { background: "#f5f5f5", color: "#374151" };
  if (s === "pending" || s === "needs_attention")
    return { background: "#fff7ed", color: "#c2410c" };
  return { background: "#f3f4f6", color: "#374151" };
}

function StatusIcon({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "completed" || s === "paid" || s === "digital_paid")
    return <CheckCircle2 size={13} />;
  if (s === "ready")
    return <TrendingUp size={13} />;
  if (s === "pending" || s === "needs_attention")
    return <AlertCircle size={13} />;
  return <Clock3 size={13} />;
}

function overviewCardStyle(clickable = false): React.CSSProperties {
  return {
    background: cardBg,
    border: `1px solid ${borderSoft}`,
    borderRadius: 24,
    padding: 22,
    minHeight: 170,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    boxShadow: "0 10px 30px rgba(17,24,39,0.04)",
    transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
    cursor: clickable ? "pointer" : "default",
    textDecoration: "none",
    color: "inherit",
  };
}

function OverviewLinkCard({
  href,
  icon,
  label,
  value,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string | number;
  description: string;
}) {
  return (
    <Link
      href={href}
      style={overviewCardStyle(true)}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 18px 40px rgba(17,24,39,0.08)";
        e.currentTarget.style.borderColor = "#cc0000";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 10px 30px rgba(17,24,39,0.04)";
        e.currentTarget.style.borderColor = borderSoft;
      }}
    >
      <div>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            background: "#f5f5f5",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#cc0000",
            marginBottom: 16,
          }}
        >
          {icon}
        </div>
        <div style={{ fontSize: 14, letterSpacing: "0.08em", fontWeight: 800, color: textMuted }}>{label}</div>
        <div style={{ fontSize: 34, lineHeight: 1.1, fontWeight: 900, color: textPrimary, marginTop: 10 }}>{value}</div>
        <div style={{ fontSize: 14, color: textMuted, marginTop: 10, lineHeight: 1.6 }}>{description}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: "#cc0000",
            fontSize: 13,
            fontWeight: 800,
          }}
        >
          Open <ArrowUpRight size={15} />
        </div>
      </div>
    </Link>
  );
}

// ── Mini stat chip in Quick Stats panel ──────────────────────────────────────
function QuickStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div style={{ background: "#fff", border: `1px solid #e5e5e5`, borderRadius: 18, padding: 16 }}>
      <div style={{ color: textMuted, fontSize: 13, fontWeight: 800, letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ color: accent ?? textPrimary, fontSize: 30, fontWeight: 900, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function DashboardPageContent() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [photographer, setPhotographer] = useState<Photographer | null>(null);
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [eventProjects, setEventProjects] = useState<ProjectRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [studioWelcome, setStudioWelcome] = useState<StudioWelcomeStatus | null>(null);
  const [showStudioWelcome, setShowStudioWelcome] = useState(false);
  // Dismissed notification IDs (persisted in localStorage)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDismissed(loadDismissed());
    void load();
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr) throw userErr;
      if (!user) {
        window.location.href = "/sign-in";
        return;
      }

      setUserEmail(user.email ?? "");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const authHeaders: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      let { data: photographerRow, error: photographerErr } = await supabase
        .from("photographers")
        .select("id,business_name,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at")
        .eq("user_id", user.id)
        .maybeSingle();

      if (photographerErr) throw photographerErr;

      // First-visit bootstrap: if no photographer row exists yet, hit the
      // status endpoint which creates one (with a fresh 30-day trial) via
      // getOrCreatePhotographerByUser, then re-query so the rest of the
      // dashboard (trial banner, schools, projects, orders) renders right
      // away instead of showing an empty state.
      if (!photographerRow) {
        try {
          await fetch("/api/studio-os-app/status", {
            method: "GET",
            cache: "no-store",
            credentials: "include",
            headers: authHeaders,
          });
          const retry = await supabase
            .from("photographers")
            .select("id,business_name,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at")
            .eq("user_id", user.id)
            .maybeSingle();
          photographerRow = retry.data;
          if (retry.error) throw retry.error;
        } catch (bootstrapErr) {
          console.error("[dashboard] bootstrap failed:", bootstrapErr);
        }
      }

      // Trial / billing gate — redirect expired trials to pricing.
      // Platform admins and users with active Stripe subs skip this.
      if (photographerRow && !photographerRow.is_platform_admin) {
        const sub = (photographerRow.subscription_status ?? "").trim().toLowerCase();
        const hasPaidSub = sub === "active" || sub === "trialing";
        if (!hasPaidSub) {
          const trialOk = isFreeTrialActive(photographerRow);
          if (!trialOk) {
            window.location.href = "/pricing?trial_expired=1";
            return;
          }
        }
      }

      if (!photographerRow) {
        setPhotographer(null);
        setSchools([]);
        setProjects([]);
        setEventProjects([]);
        setStudents([]);
        setOrders([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      setPhotographer(photographerRow as Photographer);

      const [schoolRes, projectRes, orderRes, eventRes, studioAppRes] = await Promise.all([
        supabase
          .from("schools")
          .select("id,school_name,local_school_id,created_at")
          .eq("photographer_id", photographerRow.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("projects")
          .select("id,title,workflow_type,client_name,event_date,created_at,status")
          .eq("photographer_id", photographerRow.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("orders")
          .select("id,customer_name,total_cents,created_at,status")
          .eq("photographer_id", photographerRow.id)
          .order("created_at", { ascending: false })
          .limit(20),
        fetch("/api/dashboard/events", {
          method: "GET",
          cache: "no-store",
        }),
        fetch("/api/studio-os-app/status", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: authHeaders,
        }).catch(() => null),
      ]);

      if (schoolRes.error) throw schoolRes.error;
      if (projectRes.error) throw projectRes.error;
      if (orderRes.error) throw orderRes.error;

      const eventPayload = (await eventRes.json()) as EventsPayload;
      if (eventRes.status === 401) {
        window.location.href = "/sign-in";
        return;
      }
      if (!eventRes.ok || eventPayload.ok === false) {
        throw new Error(eventPayload.message || "Failed to load event projects");
      }

      const dedupedSchools = dedupeSchools((schoolRes.data ?? []) as SchoolRow[]);
      setSchools(dedupedSchools);
      setProjects((projectRes.data ?? []) as ProjectRow[]);
      setEventProjects(eventPayload.projects ?? []);
      setOrders((orderRes.data ?? []) as OrderRow[]);

      if (dedupedSchools.length > 0) {
        const { data: studentRows, error: studentErr } = await supabase
          .from("students")
          .select("school_id,photo_url")
          .in(
            "school_id",
            dedupedSchools.map((s) => s.id),
          );

        if (studentErr) throw studentErr;
        setStudents((studentRows ?? []) as StudentRow[]);
      } else {
        setStudents([]);
      }

      if (studioAppRes && studioAppRes.ok) {
        const studioJson = (await studioAppRes.json().catch(() => null)) as
          | ({
              ok?: boolean;
              release?: StudioWelcomeStatus["release"];
              entitlement?: StudioWelcomeStatus["entitlement"];
            })
          | null;

        const eligible =
          Boolean(studioJson?.ok) &&
          Boolean(studioJson?.release) &&
          Boolean(studioJson?.entitlement?.appAccessEnabled) &&
          Boolean(studioJson?.entitlement?.canDownload) &&
          (studioJson?.entitlement?.planCode === "core" ||
            studioJson?.entitlement?.planCode === "studio");

        if (eligible && studioJson?.release) {
          const versionKey = `${STUDIO_WELCOME_PREFIX}${studioJson.release.version}`;
          const queryRequestedWelcome = searchParams.get("studio-os-welcome") === "1";
          const alreadySeen = typeof window !== "undefined" && localStorage.getItem(versionKey) === "1";

          setStudioWelcome({
            release: studioJson.release,
            entitlement: studioJson.entitlement!,
          });
          setShowStudioWelcome(queryRequestedWelcome || !alreadySeen);
        } else {
          setStudioWelcome(null);
          setShowStudioWelcome(false);
        }
      } else {
        setStudioWelcome(null);
        setShowStudioWelcome(false);
      }
    } catch (err) {
      console.error("[dashboard] load error:", err);
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchParams, supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  function dismissOrder(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  }

  function clearAllNotifications() {
    setDismissed((prev) => {
      const next = new Set(prev);
      orders.forEach((o) => next.add(o.id));
      saveDismissed(next);
      return next;
    });
  }

  function dismissStudioWelcome() {
    if (studioWelcome?.release.version) {
      try {
        localStorage.setItem(`${STUDIO_WELCOME_PREFIX}${studioWelcome.release.version}`, "1");
      } catch {}
    }
    setShowStudioWelcome(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("studio-os-welcome");
      window.history.replaceState({}, "", url.toString());
    }
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const schoolProjects = projects.filter((p) => p.workflow_type === "school");
  const revenueTracked = orders.reduce((sum, order) => sum + (order.total_cents || 0), 0);
  const imageCount = students.filter((row) => clean(row.photo_url)).length;
  const coveragePct =
    students.length > 0 ? Math.round((imageCount / students.length) * 100) : 0;
  const businessName = clean(photographer?.business_name) || "My Photography Business";
  const dashboardTrialActive = Boolean(
    photographer &&
      !photographer.is_platform_admin &&
      isFreeTrialActive(photographer),
  );
  const dashboardTrialEndsAt =
    dashboardTrialActive && photographer
      ? resolveFreeTrialEndsAt(photographer)
      : null;
  const dashboardTrialDaysRemaining =
    dashboardTrialActive && photographer
      ? Math.max(1, getFreeTrialDaysRemaining(photographer))
      : 0;
  const dashboardTrialEndsLabel =
    dashboardTrialEndsAt
      ? new Date(dashboardTrialEndsAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null;

  const pendingOrders = orders.filter(
    (o) => (clean(o.status) || "pending").toLowerCase() === "pending" ||
            clean(o.status).toLowerCase() === "needs_attention",
  );

  const visibleOrders = orders.filter((o) => !dismissed.has(o.id));
  const unreadCount = visibleOrders.length;

  const recentItems = [
    ...eventProjects.slice(0, 3).map((project) => ({
      id: `project-${project.id}`,
      href: `/dashboard/projects/${project.id}`,
      title: clean(project.title) || "Untitled event",
      subtitle: "Event project",
      date: relativeTime(project.event_date || project.created_at),
    })),
    ...schools.slice(0, 3).map((school) => ({
      id: `school-${school.id}`,
      href: `/dashboard/projects/schools/${school.id}`,
      title: clean(school.school_name) || "Untitled school",
      subtitle: "School synced",
      date: relativeTime(school.created_at),
    })),
  ].slice(0, 5);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: pageBg }}>
      {showStudioWelcome && studioWelcome ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.42)",
            display: "grid",
            placeItems: "center",
            zIndex: 80,
            padding: 24,
          }}
        >
          <div
            style={{
              width: "min(680px, 100%)",
              borderRadius: 28,
              background: "#ffffff",
              border: `1px solid ${borderSoft}`,
              boxShadow: "0 30px 90px rgba(15,23,42,0.18)",
              padding: 28,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 13, letterSpacing: "0.12em", fontWeight: 800, color: textMuted, marginBottom: 8 }}>
                  WELCOME TO STUDIO OS
                </div>
                <h2 style={{ margin: 0, fontSize: 34, lineHeight: 1.1, color: textPrimary, fontWeight: 900 }}>
                  Your app access is ready.
                </h2>
                <p style={{ margin: "12px 0 0", color: textMuted, fontSize: 15, lineHeight: 1.8 }}>
                  Download the app on your computer, then sign in inside the app with this same account.
                  If you are on Core or Studio, your desktop access is ready now.
                </p>
              </div>
              <button
                onClick={dismissStudioWelcome}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: 4,
                }}
                aria-label="Close Studio OS welcome"
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 22 }}>
              {studioWelcome.release.macDownloadUrl ? (
                <a
                  href="/api/studio-os-app/public-download?platform=mac"
                  style={{
                    border: "1px solid #0f172a",
                    borderRadius: 18,
                    background: "#0f172a",
                    padding: "14px 18px",
                    fontWeight: 800,
                    color: "#fff",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <Download size={16} /> Download Mac App
                </a>
              ) : (
                <div
                  style={{
                    border: "1px solid #d6dfef",
                    borderRadius: 18,
                    background: "#f8fafc",
                    padding: "14px 18px",
                    fontWeight: 800,
                    color: "#94a3b8",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <Download size={16} /> Mac Download
                </div>
              )}

              {studioWelcome.release.windowsDownloadUrl ? (
                <a
                  href="/api/studio-os-app/public-download?platform=windows"
                  style={{
                    border: "1px solid #2563eb",
                    borderRadius: 18,
                    background: "#eff6ff",
                    padding: "14px 18px",
                    fontWeight: 800,
                    color: "#1d4ed8",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <MonitorSmartphone size={16} /> Download Windows App
                </a>
              ) : (
                <div
                  style={{
                    border: "1px solid #d6dfef",
                    borderRadius: 18,
                    background: "#f8fafc",
                    padding: "14px 18px",
                    fontWeight: 800,
                    color: "#94a3b8",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <MonitorSmartphone size={16} /> Windows Coming Soon
                </div>
              )}
            </div>

            <div
              style={{
                marginTop: 18,
                borderRadius: 18,
                border: "1px solid #d6dfef",
                background: "#f8fafc",
                padding: "14px 16px",
                color: textMuted,
                fontSize: 14,
                lineHeight: 1.7,
              }}
            >
              Tip: once the app opens, use your photographer login there too. If a computer is outside your allowed plan keys,
              the app will tell you to purchase another key before it unlocks.
            </div>
          </div>
        </div>
      ) : null}

      <aside style={sidebar}>
        <div style={{ padding: 18, background: "#ffffff", borderBottom: "1px solid #e5e7eb" }}>
          <div
            style={{
              background: "#ffffff",
              borderRadius: 16,
              padding: "14px 16px",
            }}
          >
            <Link href="/" style={{ display: "inline-flex" }}>
              <Logo small />
            </Link>
          </div>
        </div>

        <nav style={{ paddingTop: 18 }}>
          <Link href="/dashboard" style={navActive}>Dashboard</Link>
          <Link href="/dashboard/schools" style={navItem}>Schools</Link>
          <Link href="/dashboard/projects/events" style={navItem}>Projects</Link>
          <Link href="/dashboard/orders" style={navItem}>Orders</Link>
          <Link href="/dashboard/packages" style={navItem}>Packages</Link>
          <Link href="/dashboard/settings" style={navItem}>Settings</Link>
          {userEmail?.toLowerCase() === "harout@me.com" || photographer?.is_platform_admin ? (
            <Link href="/dashboard/admin/users" style={navItem}>Admin</Link>
          ) : null}
        </nav>

        <div style={{ marginTop: 24, padding: "0 16px", color: "#888", fontSize: 13 }}>{userEmail}</div>
        <button
          onClick={handleSignOut}
          style={{
            margin: "12px 16px 16px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "center",
            background: "transparent",
            color: "#ccc",
            border: "1px solid #333",
            borderRadius: 10,
            padding: "10px 12px",
            cursor: "pointer",
          }}
        >
          <LogOut size={16} /> Sign Out
        </button>
      </aside>

      <main style={{ flex: 1, padding: 32 }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>

          {/* ── Header ──────────────────────────────────────────────────── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, marginBottom: 28 }}>
            <div>
              <div style={{ fontSize: 14, letterSpacing: "0.12em", fontWeight: 800, color: textMuted, marginBottom: 10 }}>
                STUDIO OS OVERVIEW
              </div>
              <h1 style={{ fontSize: 48, lineHeight: 1.05, margin: 0, color: textPrimary, fontWeight: 900 }}>{businessName}</h1>
              <p style={{ margin: "12px 0 0", color: textMuted, fontSize: 15, maxWidth: 860, lineHeight: 1.8 }}>
                High-level studio view only. Schools and event projects stay separated in the left menu, while the dashboard focuses on orders, activity, revenue, and quick access.
              </p>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              {/* Refresh button */}
              <button
                onClick={() => load(true)}
                disabled={refreshing}
                title="Refresh dashboard"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  border: `1px solid ${borderSoft}`,
                  background: "#fff",
                  cursor: refreshing ? "default" : "pointer",
                  color: textMuted,
                  transition: "transform 0.3s ease",
                  transform: refreshing ? "rotate(360deg)" : "none",
                }}
              >
                <RefreshCw size={17} style={{ animation: refreshing ? "spin 0.8s linear infinite" : "none" }} />
              </button>

              {/* Quick actions */}
              <Link href="/dashboard/schools" style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", background: "#fff", color: textPrimary, border: `1px solid ${borderSoft}`, borderRadius: 14, padding: "10px 16px", fontWeight: 700, fontSize: 13 }}>
                <Plus size={15} /> Add School
              </Link>
              <Link href="/dashboard/projects/events" style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", background: "#fff", color: textPrimary, border: `1px solid ${borderSoft}`, borderRadius: 14, padding: "10px 16px", fontWeight: 700, fontSize: 13 }}>
                <Plus size={15} /> New Project
              </Link>

              <Link href="/dashboard/schools" style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none", background: "#0f172a", color: "#fff", borderRadius: 16, padding: "14px 18px", fontWeight: 800 }}>
                <GraduationCap size={16} /> Open Schools
              </Link>
              <Link href="/dashboard/projects/events" style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none", background: "#fff", color: textPrimary, border: `1px solid ${borderSoft}`, borderRadius: 16, padding: "14px 18px", fontWeight: 800 }}>
                <FolderOpen size={16} /> Open Projects
              </Link>
            </div>
          </div>

          {error ? (
            <div style={{ marginBottom: 18, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "12px 14px", borderRadius: 10, fontSize: 13 }}>
              {error}
            </div>
          ) : null}

          {dashboardTrialActive ? (
            <div
              style={{
                marginBottom: 22,
                borderRadius: 24,
                border: "1px solid #bfdbfe",
                background: "linear-gradient(180deg,#eff6ff 0%,#ffffff 100%)",
                padding: "18px 22px",
                boxShadow: "0 12px 30px rgba(59,130,246,0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 13, letterSpacing: "0.12em", fontWeight: 800, color: "#2563eb", marginBottom: 8 }}>
                    30-DAY TRIAL ACTIVE
                  </div>
                  <div style={{ fontSize: 24, lineHeight: 1.2, fontWeight: 900, color: "#0f172a" }}>
                    {dashboardTrialDaysRemaining} day{dashboardTrialDaysRemaining === 1 ? "" : "s"} left in your Studio OS trial
                  </div>
                  <div style={{ marginTop: 8, color: "#475569", fontSize: 15, lineHeight: 1.7 }}>
                    You have full Studio OS access right now. Download the app, test your workflow, and choose a paid plan before
                    {dashboardTrialEndsLabel ? ` ${dashboardTrialEndsLabel}` : " your trial ends"}.
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <Link
                    href="/studio-os/download"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 10,
                      textDecoration: "none",
                      background: "#0f172a",
                      color: "#fff",
                      borderRadius: 16,
                      padding: "14px 18px",
                      fontWeight: 800,
                    }}
                  >
                    <Download size={16} /> Download App
                  </Link>
                  <Link
                    href="/pricing"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 10,
                      textDecoration: "none",
                      background: "#fff",
                      color: textPrimary,
                      border: `1px solid ${borderSoft}`,
                      borderRadius: 16,
                      padding: "14px 18px",
                      fontWeight: 800,
                    }}
                  >
                    View Pricing
                  </Link>
                </div>
              </div>
            </div>
          ) : null}

          {/* ── Top stat cards ────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 18, marginBottom: 24 }}>
            <OverviewLinkCard href="/dashboard/schools" icon={<GraduationCap size={20} />} label="SCHOOLS" value={schools.length} description="Synced school jobs available from the desktop app." />
            <OverviewLinkCard href="/dashboard/projects/events" icon={<FolderOpen size={20} />} label="EVENT PROJECTS" value={eventProjects.length} description="Weddings, baptisms, engagements, and private events." />
            <OverviewLinkCard href="/dashboard/orders" icon={<ShoppingBag size={20} />} label="ORDERS" value={orders.length} description="Total orders received across all schools and events." />
            <div style={overviewCardStyle(false)}>
              <div>
                <div style={{ width: 42, height: 42, borderRadius: 14, background: "#f5f5f5", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#cc0000", marginBottom: 16 }}>
                  <Images size={20} />
                </div>
                <div style={{ fontSize: 14, letterSpacing: "0.08em", fontWeight: 800, color: textMuted }}>PHOTO COVERAGE</div>
                <div style={{ fontSize: 34, lineHeight: 1.1, fontWeight: 900, color: textPrimary, marginTop: 10 }}>
                  {coveragePct}%
                </div>
                <div style={{ fontSize: 14, color: textMuted, marginTop: 10, lineHeight: 1.6 }}>
                  {imageCount} of {students.length} subjects have at least one synced photo.
                </div>
              </div>
              {/* Coverage bar */}
              <div style={{ height: 6, borderRadius: 99, background: "#e5e7eb", overflow: "hidden", marginTop: 10 }}>
                <div style={{ height: "100%", width: `${coveragePct}%`, borderRadius: 99, background: coveragePct >= 80 ? "#22c55e" : "#cc0000", transition: "width 0.6s ease" }} />
              </div>
            </div>
          </div>

          {/* ── Bottom panels ─────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 0.9fr", gap: 18 }}>

            {/* Notifications */}
            <div style={{ background: cardBg, borderRadius: 24, border: `1px solid ${borderSoft}`, padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 800, color: textPrimary }}>
                  {/* Bell with unread badge */}
                  <div style={{ position: "relative", display: "inline-flex" }}>
                    <Bell size={18} color="#cc0000" />
                    {unreadCount > 0 && (
                      <span style={{
                        position: "absolute",
                        top: -6,
                        right: -8,
                        background: "#ef4444",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 900,
                        borderRadius: 99,
                        minWidth: 16,
                        height: 16,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "0 4px",
                      }}>
                        {unreadCount}
                      </span>
                    )}
                  </div>
                  Notifications
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {unreadCount > 0 && (
                    <button
                      onClick={clearAllNotifications}
                      style={{ color: textMuted, fontSize: 13, fontWeight: 700, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      Clear all
                    </button>
                  )}
                  <Link href="/dashboard/orders" style={{ color: "#cc0000", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>View all</Link>
                </div>
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                {loading ? (
                  <>
                    {[1, 2, 3].map((i) => (
                      <div key={i} style={{ border: `1px solid ${borderSoft}`, borderRadius: 18, padding: 16, background: "#fff" }}>
                        <div style={{ height: 12, borderRadius: 6, background: "#f3f4f6", width: "60%", marginBottom: 10 }} />
                        <div style={{ height: 10, borderRadius: 6, background: "#f3f4f6", width: "40%" }} />
                      </div>
                    ))}
                  </>
                ) : visibleOrders.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 16px" }}>
                    <CheckCircle2 size={32} color="#22c55e" style={{ marginBottom: 10 }} />
                    <div style={{ color: textPrimary, fontWeight: 800, fontSize: 15 }}>All caught up!</div>
                    <div style={{ color: textMuted, fontSize: 13, marginTop: 6 }}>No unread order notifications.</div>
                  </div>
                ) : (
                  visibleOrders.slice(0, 4).map((order) => {
                    const status = clean(order.status) || "pending";
                    const ss = statusStyle(status);
                    return (
                      <div key={order.id} style={{ border: `1px solid ${borderSoft}`, borderRadius: 18, padding: 16, background: "#fff", position: "relative" }}>
                        {/* Dismiss button */}
                        <button
                          onClick={() => dismissOrder(order.id)}
                          title="Dismiss"
                          style={{
                            position: "absolute",
                            top: 12,
                            right: 12,
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "#9ca3af",
                            padding: 2,
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <X size={14} />
                        </button>

                        <Link href="/dashboard/orders" style={{ textDecoration: "none", color: "inherit" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10, paddingRight: 20 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", gap: 4, ...ss }}>
                                <StatusIcon status={status} /> {status}
                              </span>
                              <span style={{ color: textMuted, fontSize: 12 }}>{relativeTime(order.created_at)}</span>
                            </div>
                            <span style={{ color: textPrimary, fontSize: 14, fontWeight: 900 }}>{moneyFromCents(order.total_cents || 0)}</span>
                          </div>
                          <div style={{ color: textPrimary, fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{clean(order.customer_name) || "Client order"}</div>
                          <div style={{ color: textMuted, fontSize: 13 }}>Tap to view in orders →</div>
                        </Link>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Recent activity */}
            <div style={{ background: cardBg, borderRadius: 24, border: `1px solid ${borderSoft}`, padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 800, color: textPrimary }}>
                  <Activity size={18} color="#cc0000" /> Recent activity
                </div>
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                {loading ? (
                  <>
                    {[1, 2, 3].map((i) => (
                      <div key={i} style={{ border: `1px solid ${borderSoft}`, borderRadius: 18, padding: 16, background: "#fff" }}>
                        <div style={{ height: 12, borderRadius: 6, background: "#f3f4f6", width: "55%", marginBottom: 8 }} />
                        <div style={{ height: 10, borderRadius: 6, background: "#f3f4f6", width: "35%" }} />
                      </div>
                    ))}
                  </>
                ) : recentItems.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 16px" }}>
                    <Activity size={28} color="#d1d5db" style={{ marginBottom: 10 }} />
                    <div style={{ color: textMuted, fontSize: 14 }}>No recent activity yet.</div>
                    <div style={{ color: textMuted, fontSize: 13, marginTop: 6 }}>Sync your first school or project to see activity here.</div>
                  </div>
                ) : (
                  recentItems.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      style={{ border: `1px solid ${borderSoft}`, borderRadius: 18, padding: 16, background: "#fff", display: "flex", justifyContent: "space-between", gap: 12, textDecoration: "none", color: "inherit", transition: "border-color 0.15s, background 0.15s" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "#cc0000";
                        e.currentTarget.style.background = "#fff9f9";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = borderSoft;
                        e.currentTarget.style.background = "#fff";
                      }}
                    >
                      <div>
                        <div style={{ color: textPrimary, fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{item.title}</div>
                        <div style={{ color: textMuted, fontSize: 13 }}>{item.subtitle}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ color: textMuted, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", marginTop: 2 }}>{item.date}</div>
                        <ArrowUpRight size={14} color="#9ca3af" style={{ marginTop: 3, flexShrink: 0 }} />
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>

            {/* Quick stats */}
            <div style={{ background: "#f5f5f5", borderRadius: 24, border: `1px solid #e5e5e5`, padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 800, color: textPrimary, marginBottom: 16 }}>
                <Package2 size={18} color="#cc0000" /> Quick stats
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                <QuickStat label="TOTAL ORDERS" value={orders.length} />
                <QuickStat
                  label="PENDING ORDERS"
                  value={pendingOrders.length}
                  accent={pendingOrders.length > 0 ? "#c2410c" : textPrimary}
                />
                <QuickStat label="REVENUE TRACKED" value={moneyFromCents(revenueTracked)} />
                <QuickStat label="SCHOOL PROJECTS LINKED" value={schoolProjects.length} />
                <QuickStat label="PHOTO COVERAGE" value={`${coveragePct}%`} accent={coveragePct >= 80 ? "#15803d" : "#cc0000"} />
              </div>
            </div>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#ffffff" }} />}>
      <DashboardPageContent />
    </Suspense>
  );
}
