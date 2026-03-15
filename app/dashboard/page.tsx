// app/dashboard/page.tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronDown,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Plus,
  School2,
  Settings,
  ShoppingBag,
  UserCircle2,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";

type Photographer = {
  id: string;
  user_id: string;
  business_name: string | null;
  stripe_account_id: string | null;
};

type School = {
  id: string;
  photographer_id: string;
  school_name: string;
  event_date: string | null;
  created_at: string | null;
  local_school_id: string | null;
};

function makeLocalSchoolId() {
  return Math.random().toString(36).slice(2, 12);
}

function formatDate(d: string | null) {
  if (!d) return null;
  const p = new Date(d);
  return isNaN(p.getTime())
    ? null
    : p.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

function schoolGradient(name: string) {
  const g = [
    "linear-gradient(135deg,#1a1a2e,#0f3460)",
    "linear-gradient(135deg,#0d1b2a,#1b4332)",
    "linear-gradient(135deg,#2d1b69,#11998e)",
    "linear-gradient(135deg,#141e30,#243b55)",
    "linear-gradient(135deg,#3a1c71,#d76d77)",
    "linear-gradient(135deg,#1f4037,#99f2c8)",
    "linear-gradient(135deg,#373b44,#4286f4)",
    "linear-gradient(135deg,#200122,#6f0000)",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = name.charCodeAt(i) + ((h << 5) - h);
  }
  return g[Math.abs(h) % g.length];
}

export default function DashboardPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formMsg, setFormMsg] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [photographer, setPhotographer] = useState<Photographer | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [newOrderCount, setNewOrderCount] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [expandedNav, setExpandedNav] = useState<string[]>([]);
  const [schoolName, setSchoolName] = useState("");
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
  const [eventDate, setEventDate] = useState("");

  useEffect(() => {
    load();
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
        setUserEmail("");
        setPhotographer(null);
        setSchools([]);
        setNewOrderCount(0);
        return;
      }

      setUserEmail(user.email ?? "");

      const { data: pg, error: pgErr } = await supabase
        .from("photographers")
        .select("id,user_id,business_name,stripe_account_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (pgErr) throw pgErr;

      if (!pg) {
        setPhotographer(null);
        setSchools([]);
        setNewOrderCount(0);
        return;
      }

      setPhotographer(pg);

      const { data: rows, error: sErr } = await supabase
        .from("schools")
        .select("id,photographer_id,school_name,event_date,created_at,local_school_id")
        .eq("photographer_id", pg.id)
        .order("created_at", { ascending: false });

      if (sErr) throw sErr;

      setSchools(rows ?? []);

      const { count, error: orderErr } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("photographer_id", pg.id)
        .eq("seen_by_photographer", false);

      if (orderErr) {
        console.error("[dashboard] orders count failed:", orderErr);
        setNewOrderCount(0);
      } else {
        setNewOrderCount(count ?? 0);
      }
    } catch (err) {
      console.error("[dashboard] load error:", err);
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
      setPhotographer(null);
      setSchools([]);
      setNewOrderCount(0);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!photographer) return;

    setSaving(true);
    setFormMsg("");

    const { error: err } = await supabase.from("schools").insert({
      photographer_id: photographer.id,
      school_name: schoolName.trim(),
      event_date: eventDate || null,
      local_school_id: makeLocalSchoolId(),
    });

    if (err) {
      setFormMsg(err.message);
      setSaving(false);
      return;
    }

    setSchoolName("");
    setEventDate("");
    setShowForm(false);
    await load();
    setSaving(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  function toggleNav(label: string) {
    setExpandedNav((p) =>
      p.includes(label) ? p.filter((l) => l !== label) : [...p, label]
    );
  }

  const NAV = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard", active: true },
    {
      icon: School2,
      label: "Schools",
      expandable: true,
      children: [{ label: "All Schools", href: "/dashboard" }],
    },
    {
      icon: Users,
      label: "Students",
      expandable: true,
      children: [{ label: "All Students", href: "#" }],
    },
    {
      icon: FolderOpen,
      label: "Galleries",
      expandable: true,
      children: [{ label: "All Galleries", href: "#" }],
    },
    {
      icon: ShoppingBag,
      label: "Orders",
      href: "/dashboard/orders",
      badge: newOrderCount,
    },
    { icon: Settings, label: "Settings", href: "#" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          background: "#000",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div style={{ background: "#fff", padding: "16px 20px" }}>
          <Logo />
        </div>

        <div style={{ padding: "16px 12px 8px" }}>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: "100%",
              background: "#fff",
              color: "#000",
              border: "none",
              borderRadius: 8,
              padding: "10px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Plus size={14} strokeWidth={2.5} /> Create School
          </button>
        </div>

        <nav style={{ flex: 1, padding: "4px 8px" }}>
          {NAV.map((item) => {
            const Icon = item.icon;
            const isExp = expandedNav.includes(item.label);

            return (
              <div key={item.label}>
                {item.href && !item.expandable ? (
                  <Link
                    href={item.href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: item.active ? "rgba(255,255,255,0.15)" : "transparent",
                      color: item.active ? "#fff" : "rgba(255,255,255,0.65)",
                      borderRadius: 7,
                      padding: "10px 12px",
                      fontSize: 13,
                      fontWeight: 500,
                      textDecoration: "none",
                      marginBottom: 2,
                      position: "relative",
                    }}
                  >
                    <Icon size={16} />
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.badge ? (
                      <span
                        style={{
                          background: "#ef4444",
                          color: "#fff",
                          borderRadius: 999,
                          padding: "2px 7px",
                          fontSize: 11,
                          fontWeight: 700,
                          animation: "pulse 1.5s infinite",
                        }}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => item.expandable && toggleNav(item.label)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      background: "transparent",
                      color: "rgba(255,255,255,0.65)",
                      border: "none",
                      borderRadius: 7,
                      padding: "10px 12px",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    <Icon size={16} />
                    <span style={{ flex: 1, textAlign: "left" }}>{item.label}</span>
                    {item.expandable && (
                      <ChevronDown
                        size={13}
                        style={{
                          opacity: 0.5,
                          transform: isExp ? "rotate(180deg)" : "none",
                          transition: "transform 0.2s",
                        }}
                      />
                    )}
                  </button>
                )}

                {item.expandable && isExp && item.children && (
                  <div style={{ marginLeft: 28, marginBottom: 4 }}>
                    {item.children.map((c) => (
                      <Link
                        key={c.label}
                        href={c.href}
                        style={{
                          display: "block",
                          borderRadius: 6,
                          padding: "7px 12px",
                          fontSize: 12,
                          color: "rgba(255,255,255,0.5)",
                          textDecoration: "none",
                        }}
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "8px 8px 16px" }}>
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              background: "transparent",
              border: "none",
              borderRadius: 7,
              padding: "10px 12px",
              fontSize: 13,
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
            }}
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#fff",
            borderBottom: "1px solid #e5e5e5",
            padding: "12px 32px",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, color: "#333", margin: 0 }}>
            Dashboard
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {newOrderCount > 0 && (
              <Link
                href="/dashboard/orders"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#ef4444",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  textDecoration: "none",
                  animation: "pulse 1.5s infinite",
                }}
              >
                <ShoppingBag size={14} /> {newOrderCount} New Order{newOrderCount > 1 ? "s" : ""}
              </Link>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid #e5e5e5",
                borderRadius: 999,
                padding: "6px 14px",
              }}
            >
              <UserCircle2 size={16} color="#aaa" />
              <span style={{ fontSize: 13, fontWeight: 500, color: "#444" }}>
                {userEmail}
              </span>
            </div>
          </div>
        </header>

        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}`}</style>

        <main style={{ flex: 1, overflowY: "auto", padding: "28px 32px", background: "#f0f0f0" }}>
          {error && (
            <div
              style={{
                marginBottom: 16,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 10,
                padding: "14px 18px",
                color: "#b91c1c",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {loading && <p style={{ color: "#999", fontSize: 13 }}>Loading…</p>}

          {!loading && photographer && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4,1fr)",
                  gap: 16,
                  marginBottom: 28,
                }}
              >
                {[
                  { label: "Schools", value: schools.length, sub: "In your workspace" },
                  {
                    label: "New Orders",
                    value: newOrderCount,
                    sub: "Awaiting your review",
                    highlight: newOrderCount > 0,
                  },
                  {
                    label: "Signed In",
                    value: userEmail,
                    sub: "Authenticated account",
                    small: true,
                  },
                  {
                    label: "Stripe",
                    value: photographer.stripe_account_id ? "Connected" : "Not connected",
                    sub: "Payments",
                    green: !!photographer.stripe_account_id,
                  },
                ].map(({ label, value, sub, highlight, small, green }) => (
                  <div
                    key={label}
                    style={{
                      background: "#fff",
                      border: highlight ? "2px solid #ef4444" : "1px solid #e5e5e5",
                      borderRadius: 12,
                      padding: 24,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    <p
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "#999",
                        margin: 0,
                      }}
                    >
                      {label}
                    </p>
                    <p
                      style={{
                        fontSize: small ? 13 : 36,
                        fontWeight: 800,
                        color: green ? "#16a34a" : highlight ? "#ef4444" : "#111",
                        margin: "8px 0 0",
                        lineHeight: 1,
                        wordBreak: "break-all",
                      }}
                    >
                      {value}
                    </p>
                    <p style={{ fontSize: 11, color: "#888", marginTop: 6 }}>{sub}</p>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 18,
                }}
              >
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111", margin: 0 }}>
                    Schools
                  </h2>
                  <p style={{ fontSize: 12, color: "#888", marginTop: 3 }}>
                    {schools.length} school{schools.length !== 1 ? "s" : ""} — click to manage
                    classes & students
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowForm((p) => !p);
                    setFormMsg("");
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#000",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px 18px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={14} strokeWidth={2.5} /> {showForm ? "Close" : "New School"}
                </button>
              </div>

              {showForm && (
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #e5e5e5",
                    borderRadius: 12,
                    padding: "20px 24px",
                    marginBottom: 20,
                  }}
                >
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: "#222", margin: "0 0 16px" }}>
                    Create a new school
                  </h4>

                  <form
                    onSubmit={handleCreate}
                    style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
                  >
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#555",
                          marginBottom: 6,
                        }}
                      >
                        School Name *
                      </label>
                      <input
                        type="text"
                        value={schoolName}
                        onChange={(e) => setSchoolName(e.target.value)}
                        required
                        placeholder="e.g. Sahag Mesrob 2026"
                        style={{
                          width: "100%",
                          border: "1px solid #ddd",
                          borderRadius: 8,
                          padding: "9px 13px",
                          fontSize: 13,
                          outline: "none",
                          boxSizing: "border-box",
                          color: "#111",
                        }}
                      />
                    </div>

                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#555",
                          marginBottom: 6,
                        }}
                      >
                        Photo Day Date
                      </label>
                      <input
                        type="date"
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        style={{
                          width: "100%",
                          border: "1px solid #ddd",
                          borderRadius: 8,
                          padding: "9px 13px",
                          fontSize: 13,
                          outline: "none",
                          boxSizing: "border-box",
                          color: "#111",
                        }}
                      />
                    </div>

                    {formMsg && (
                      <div
                        style={{
                          gridColumn: "span 2",
                          background: "#fef2f2",
                          border: "1px solid #fecaca",
                          borderRadius: 8,
                          padding: "10px 14px",
                          fontSize: 12,
                          color: "#b91c1c",
                        }}
                      >
                        {formMsg}
                      </div>
                    )}

                    <div style={{ gridColumn: "span 2", display: "flex", gap: 10 }}>
                      <button
                        type="submit"
                        disabled={saving}
                        style={{
                          background: "#000",
                          color: "#fff",
                          border: "none",
                          borderRadius: 8,
                          padding: "10px 20px",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                          opacity: saving ? 0.5 : 1,
                        }}
                      >
                        {saving ? "Creating…" : "Save School"}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowForm(false);
                          setFormMsg("");
                        }}
                        style={{
                          background: "#fff",
                          color: "#444",
                          border: "1px solid #ddd",
                          borderRadius: 8,
                          padding: "10px 20px",
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {schools.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    border: "2px dashed #ddd",
                    borderRadius: 12,
                    padding: "60px 32px",
                    textAlign: "center",
                  }}
                >
                  <School2 size={40} color="#ccc" style={{ margin: "0 auto 12px" }} />
                  <p style={{ fontSize: 15, fontWeight: 600, color: "#555", margin: 0 }}>
                    No schools yet
                  </p>
                  <p style={{ fontSize: 13, color: "#999", marginTop: 6 }}>
                    Create your first school to start organizing photo days
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
                    gap: 20,
                  }}
                >
                  {schools.map((school) => (
                    <div key={school.id} style={{ position: "relative" }}>
                      <div
                        style={{
                          background: "#fff",
                          borderRadius: 10,
                          overflow: "hidden",
                          border: "1px solid #e5e5e5",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
                          transition: "transform 0.15s,box-shadow 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
                          (e.currentTarget as HTMLDivElement).style.boxShadow =
                            "0 6px 20px rgba(0,0,0,0.12)";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLDivElement).style.transform = "none";
                          (e.currentTarget as HTMLDivElement).style.boxShadow =
                            "0 1px 4px rgba(0,0,0,0.07)";
                        }}
                      >
                        <Link href={`/schools/${school.id}`} style={{ textDecoration: "none", display: "block" }}>
                          <div
                            style={{
                              height: 150,
                              background: schoolGradient(school.school_name),
                              position: "relative",
                              cursor: "pointer",
                            }}
                          >
                            <div
                              style={{
                                position: "absolute",
                                inset: 0,
                                background:
                                  "linear-gradient(to top,rgba(0,0,0,0.5) 0%,transparent 60%)",
                              }}
                            />
                            <div style={{ position: "absolute", bottom: 10, left: 12, right: 12 }}>
                              <p
                                style={{
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: "#fff",
                                  margin: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {school.school_name}
                              </p>
                            </div>
                          </div>
                        </Link>

                        <div style={{ padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
                            <CalendarDays size={11} color="#999" />
                            <span style={{ fontSize: 11, color: "#888" }}>
                              {formatDate(school.event_date) ?? "No date set"}
                            </span>
                          </div>

                          <div style={{ display: "flex", gap: 6 }}>
                            <Link
                              href={`/schools/${school.id}`}
                              style={{
                                flex: 1,
                                padding: "6px 0",
                                background: "#f5f5f5",
                                border: "none",
                                borderRadius: 6,
                                color: "#333",
                                fontSize: 12,
                                fontWeight: 600,
                                textDecoration: "none",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 4,
                              }}
                            >
                              <GraduationCap size={12} color="#555" /> Classes
                            </Link>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenActionMenu(openActionMenu === school.id ? null : school.id);
                              }}
                              style={{
                                padding: "6px 10px",
                                background: "#f5f5f5",
                                border: "none",
                                borderRadius: 6,
                                color: "#333",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              Actions <MoreHorizontal size={13} />
                            </button>
                          </div>
                        </div>
                      </div>

                      {openActionMenu === school.id && (
                        <>
                          <div
                            onClick={() => setOpenActionMenu(null)}
                            style={{ position: "fixed", inset: 0, zIndex: 40 }}
                          />
                          <div
                            style={{
                              position: "absolute",
                              bottom: "100%",
                              right: 0,
                              marginBottom: 4,
                              background: "#fff",
                              border: "1px solid #e5e5e5",
                              borderRadius: 10,
                              boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                              zIndex: 50,
                              minWidth: 200,
                              overflow: "hidden",
                            }}
                          >
                            {[
                              { label: "Manage Classes", icon: "👥", href: `/schools/${school.id}` },
                              { label: "School Settings", icon: "⚙️", href: `/schools/${school.id}/settings` },
                              {
                                label: "Assign Price Sheet",
                                icon: "🏷️",
                                href: `/schools/${school.id}/settings?tab=pricing`,
                              },
                              {
                                label: "Set Dates",
                                icon: "📅",
                                href: `/schools/${school.id}/settings?tab=dates`,
                              },
                            ].map((action) => (
                              <Link
                                key={action.label}
                                href={action.href}
                                onClick={() => setOpenActionMenu(null)}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 10,
                                  padding: "10px 14px",
                                  fontSize: 13,
                                  color: "#111",
                                  textDecoration: "none",
                                  borderBottom: "1px solid #f5f5f5",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = "#f8f8f8";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = "transparent";
                                }}
                              >
                                <span>{action.icon}</span> {action.label}
                              </Link>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}