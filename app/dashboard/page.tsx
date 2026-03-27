"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
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
} from "lucide-react";

type Photographer = {
  id: string;
  business_name: string | null;
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

const pageBg = "#f3f5f8";
const cardBg = "#ffffff";
const textPrimary = "#111827";
const textMuted = "#667085";
const borderSoft = "#e5e7eb";

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
        e.currentTarget.style.borderColor = "#c7d2fe";
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
            background: "#eef2ff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#3b82f6",
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
            color: "#2563eb",
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

function StatCard({ icon, label, value, description }: { icon: React.ReactNode; label: string; value: string | number; description: string }) {
  return (
    <div style={overviewCardStyle(false)}>
      <div>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            background: "#eef2ff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#3b82f6",
            marginBottom: 16,
          }}
        >
          {icon}
        </div>
        <div style={{ fontSize: 14, letterSpacing: "0.08em", fontWeight: 800, color: textMuted }}>{label}</div>
        <div style={{ fontSize: 34, lineHeight: 1.1, fontWeight: 900, color: textPrimary, marginTop: 10 }}>{value}</div>
        <div style={{ fontSize: 14, color: textMuted, marginTop: 10, lineHeight: 1.6 }}>{description}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [photographer, setPhotographer] = useState<Photographer | null>(null);
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [eventProjects, setEventProjects] = useState<ProjectRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
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

      const { data: photographerRow, error: photographerErr } = await supabase
        .from("photographers")
        .select("id,business_name")
        .eq("user_id", user.id)
        .maybeSingle();

      if (photographerErr) throw photographerErr;
      if (!photographerRow) {
        setPhotographer(null);
        setSchools([]);
        setProjects([]);
        setEventProjects([]);
        setStudents([]);
        setOrders([]);
        setLoading(false);
        return;
      }

      setPhotographer(photographerRow as Photographer);

      const [schoolRes, projectRes, orderRes, eventRes] = await Promise.all([
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
          .limit(6),
        fetch("/api/dashboard/events", {
          method: "GET",
          cache: "no-store",
        }),
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
    } catch (err) {
      console.error("[dashboard] load error:", err);
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  const schoolProjects = projects.filter((p) => p.workflow_type === "school");
  const revenueTracked = orders.reduce((sum, order) => sum + (order.total_cents || 0), 0);
  const imageCount = students.filter((row) => clean(row.photo_url)).length;
  const businessName = clean(photographer?.business_name) || "My Photography Business";
  const recentItems = [
    ...eventProjects.slice(0, 3).map((project) => ({
      id: `project-${project.id}`,
      title: clean(project.title) || "Untitled event",
      subtitle: "Event project",
      date: formatDate(project.event_date || project.created_at),
    })),
    ...schools.slice(0, 2).map((school) => ({
      id: `school-${school.id}`,
      title: clean(school.school_name) || "Untitled school",
      subtitle: "School synced",
      date: formatDate(school.created_at),
    })),
  ].slice(0, 5);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: pageBg }}>
      <aside style={sidebar}>
        <div style={{ padding: 24, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <Logo />
        </div>

        <nav style={{ paddingTop: 18 }}>
          <Link href="/dashboard" style={navActive}>Dashboard</Link>
          <Link href="/dashboard/schools" style={navItem}>Schools</Link>
          <Link href="/dashboard/projects/events" style={navItem}>Projects</Link>
          <Link href="/dashboard/orders" style={navItem}>Orders</Link>
          <Link href="/dashboard/packages" style={navItem}>Packages</Link>
          <Link href="/dashboard/settings" style={navItem}>Settings</Link>
        </nav>

        <div style={{ marginTop: "auto", padding: 16, color: "#888", fontSize: 13 }}>{userEmail}</div>
        <button
          onClick={handleSignOut}
          style={{
            margin: 16,
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

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 18, marginBottom: 24 }}>
            <OverviewLinkCard href="/dashboard/schools" icon={<GraduationCap size={20} />} label="SCHOOLS" value={schools.length} description="Synced school jobs available from the desktop app." />
            <OverviewLinkCard href="/dashboard/projects/events" icon={<FolderOpen size={20} />} label="EVENT PROJECTS" value={eventProjects.length} description="Weddings, baptisms, engagements, and private events." />
            <StatCard icon={<Users size={20} />} label="PEOPLE" value={students.length} description="Students and subjects currently available in synced school galleries." />
            <StatCard icon={<Images size={20} />} label="IMAGES" value={imageCount} description="Subjects that already have at least one synced photo preview." />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 0.9fr", gap: 18 }}>
            <div style={{ background: cardBg, borderRadius: 24, border: `1px solid ${borderSoft}`, padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 800, color: textPrimary }}>
                  <Bell size={18} color="#2563eb" /> Notifications
                </div>
                <span style={{ color: textMuted, fontSize: 14, fontWeight: 700 }}>View all</span>
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                {loading ? (
                  <div style={{ color: textMuted }}>Loading notifications…</div>
                ) : orders.length === 0 ? (
                  <div style={{ color: textMuted }}>No recent orders yet.</div>
                ) : (
                  orders.slice(0, 4).map((order) => (
                    <div key={order.id} style={{ border: `1px solid ${borderSoft}`, borderRadius: 18, padding: 16, background: "#fff" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ padding: "4px 10px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontSize: 12, fontWeight: 800 }}>
                            {clean(order.status) || "pending"}
                          </span>
                          <span style={{ color: textMuted, fontSize: 13, fontWeight: 700 }}>{formatDate(order.created_at)}</span>
                        </div>
                        <span style={{ color: textPrimary, fontSize: 14, fontWeight: 900 }}>{moneyFromCents(order.total_cents || 0)}</span>
                      </div>
                      <div style={{ color: textPrimary, fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{clean(order.customer_name) || "Client order"}</div>
                      <div style={{ color: textMuted, fontSize: 14 }}>Package order is waiting in the order queue.</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ background: cardBg, borderRadius: 24, border: `1px solid ${borderSoft}`, padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 800, color: textPrimary, marginBottom: 16 }}>
                <Activity size={18} color="#2563eb" /> Recent activity
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                {loading ? (
                  <div style={{ color: textMuted }}>Loading activity…</div>
                ) : recentItems.length === 0 ? (
                  <div style={{ color: textMuted }}>No recent activity yet.</div>
                ) : (
                  recentItems.map((item) => (
                    <div key={item.id} style={{ border: `1px solid ${borderSoft}`, borderRadius: 18, padding: 16, background: "#fff", display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <div style={{ color: textPrimary, fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{item.title}</div>
                        <div style={{ color: textMuted, fontSize: 14 }}>{item.subtitle}</div>
                      </div>
                      <div style={{ color: textMuted, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{item.date}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ background: "#eef5ff", borderRadius: 24, border: `1px solid #dbeafe`, padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 800, color: textPrimary, marginBottom: 16 }}>
                <Package2 size={18} color="#2563eb" /> Quick stats
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ background: "#fff", border: `1px solid #cfe0ff`, borderRadius: 18, padding: 16 }}>
                  <div style={{ color: textMuted, fontSize: 13, fontWeight: 800, letterSpacing: "0.08em" }}>NEW ORDERS</div>
                  <div style={{ color: textPrimary, fontSize: 30, fontWeight: 900, marginTop: 6 }}>{orders.length}</div>
                </div>
                <div style={{ background: "#fff", border: `1px solid #cfe0ff`, borderRadius: 18, padding: 16 }}>
                  <div style={{ color: textMuted, fontSize: 13, fontWeight: 800, letterSpacing: "0.08em" }}>REVENUE TRACKED</div>
                  <div style={{ color: textPrimary, fontSize: 30, fontWeight: 900, marginTop: 6 }}>{moneyFromCents(revenueTracked)}</div>
                </div>
                <div style={{ background: "#fff", border: `1px solid #cfe0ff`, borderRadius: 18, padding: 16 }}>
                  <div style={{ color: textMuted, fontSize: 13, fontWeight: 800, letterSpacing: "0.08em" }}>SCHOOL PROJECTS LINKED</div>
                  <div style={{ color: textPrimary, fontSize: 30, fontWeight: 900, marginTop: 6 }}>{schoolProjects.length}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
