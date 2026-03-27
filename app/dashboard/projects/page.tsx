"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { CalendarDays, LogOut, Plus } from "lucide-react";

type Photographer = {
  id: string;
  user_id: string;
  business_name: string | null;
};

type ProjectRow = {
  id: string;
  photographer_id: string;
  workflow_type: "event" | "school";
  source_type: "local_school_sync" | "cloud_only" | "hybrid";
  linked_school_id: string | null;
  title: string;
  client_name: string | null;
  event_date: string | null;
  status: string | null;
  cover_photo_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type CollectionCountRow = {
  project_id: string;
  kind: string;
};

const textPrimary = "#111827";
const textSecondary = "#374151";
const borderSoft = "#d1d5db";

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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  border: `1px solid ${borderSoft}`,
  fontSize: 14,
  color: textPrimary,
  background: "#ffffff",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: textSecondary,
  marginBottom: 6,
  fontWeight: 600,
};

function formatDate(value: string | null) {
  if (!value) return "No date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No date";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function cardGradient(title: string) {
  const gradients = [
    "linear-gradient(135deg,#1f2937,#b91c1c)",
    "linear-gradient(135deg,#111827,#d97706)",
    "linear-gradient(135deg,#312e81,#be185d)",
    "linear-gradient(135deg,#3f3f46,#a21caf)",
  ];

  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }

  return gradients[Math.abs(hash) % gradients.length];
}

export default function EventsPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [photographer, setPhotographer] = useState<Photographer | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [collectionRows, setCollectionRows] = useState<CollectionCountRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<"cloud_only" | "hybrid">("cloud_only");
  const [clientName, setClientName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [status, setStatus] = useState("active");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        .select("id,user_id,business_name")
        .eq("user_id", user.id)
        .maybeSingle();

      if (photographerErr) throw photographerErr;
      if (!photographerRow) {
        setPhotographer(null);
        setProjects([]);
        setCollectionRows([]);
        setLoading(false);
        return;
      }

      setPhotographer(photographerRow);

      const { data: projectRows, error: projectErr } = await supabase
        .from("projects")
        .select(
          "id,photographer_id,workflow_type,source_type,linked_school_id,title,client_name,event_date,status,cover_photo_url,created_at,updated_at"
        )
        .eq("photographer_id", photographerRow.id)
        .eq("workflow_type", "event")
        .order("created_at", { ascending: false });

      if (projectErr) throw projectErr;

      const safeProjects = (projectRows ?? []) as ProjectRow[];
      setProjects(safeProjects);

      if (safeProjects.length > 0) {
        const projectIds = safeProjects.map((p) => p.id);
        const { data: collectionData, error: collectionErr } = await supabase
          .from("collections")
          .select("project_id,kind")
          .in("project_id", projectIds);

        if (collectionErr) throw collectionErr;
        setCollectionRows((collectionData ?? []) as CollectionCountRow[]);
      } else {
        setCollectionRows([]);
      }
    } catch (err) {
      console.error("[events] load error:", err);
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!photographer) return;
    if (!title.trim()) return;

    setSaving(true);
    setError("");

    try {
      const payload = {
        photographer_id: photographer.id,
        workflow_type: "event",
        source_type: sourceType,
        title: title.trim(),
        client_name: clientName.trim() || null,
        event_date: eventDate || null,
        status: status || "active",
      };

      const { error: insertErr } = await supabase.from("projects").insert(payload);
      if (insertErr) throw insertErr;

      setTitle("");
      setClientName("");
      setEventDate("");
      setStatus("active");
      setSourceType("cloud_only");
      setShowCreate(false);
      await load();
    } catch (err) {
      console.error("[events] create error:", err);
      setError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  const collectionCounts = useMemo(() => {
    const map = new Map<string, { albums: number; galleries: number }>();
    for (const row of collectionRows) {
      const current = map.get(row.project_id) ?? { albums: 0, galleries: 0 };
      if (row.kind === "album") current.albums += 1;
      if (row.kind === "gallery") current.galleries += 1;
      map.set(row.project_id, current);
    }
    return map;
  }, [collectionRows]);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f3f4f6" }}>
      <div style={sidebar}>
        <div style={{ background: "#fff", padding: "20px 24px" }}><Logo /></div>
        <nav style={{ flex: 1, paddingTop: 16 }}>
          <Link href="/dashboard" style={navItem}>Dashboard</Link>
          <Link href="/dashboard/schools" style={navItem}>Schools</Link>
          <Link href="/dashboard/projects" style={navActive}>Events</Link>
          <Link href="/dashboard/orders" style={navItem}>Orders</Link>
          <Link href="/dashboard/packages" style={navItem}>Packages</Link>
          <Link href="/dashboard/settings" style={navItem}>Settings</Link>
        </nav>
        <div style={{ padding: "0 16px 8px", color: "#8f8f8f", fontSize: 12 }}>{userEmail}</div>
        <button onClick={signOut} style={{ margin: 16, padding: "10px", background: "transparent", border: "1px solid #333", borderRadius: 8, color: "#ccc", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <LogOut size={14} /> Sign Out
        </button>
      </div>

      <div style={{ flex: 1, padding: "42px 40px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: "#111827", margin: 0 }}>Events</h1>
            <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 15 }}>
              Weddings, baptisms, engagements, and private event projects only.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#111", color: "#fff", border: "none", borderRadius: 12, padding: "14px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            <Plus size={16} /> New Event
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 20, marginBottom: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 18 }}>
              <div>
                <label style={labelStyle}>Event title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Wedding, baptism, engagement..." style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Client name</label>
                <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client or family name" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Event date</label>
                <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Source type</label>
                <select value={sourceType} onChange={(e) => setSourceType(e.target.value as "cloud_only" | "hybrid")} style={inputStyle}>
                  <option value="cloud_only">cloud_only</option>
                  <option value="hybrid">hybrid</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button type="button" onClick={() => setShowCreate(false)} style={{ padding: "11px 16px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button type="submit" disabled={saving} style={{ padding: "11px 16px", borderRadius: 10, border: "none", background: "#111827", color: "#fff", fontWeight: 700, cursor: "pointer" }}>{saving ? "Creating..." : "Create event"}</button>
            </div>
          </form>
        )}

        {error && (
          <div style={{ marginBottom: 18, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "14px 18px", color: "#b91c1c", fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#666" }}>Loading events...</div>
        ) : projects.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, background: "#fff", borderRadius: 16, border: "2px dashed #e5e7eb" }}>
            <CalendarDays size={42} color="#c4c4c4" style={{ marginBottom: 12 }} />
            <p style={{ color: "#666", margin: 0 }}>No event projects yet.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 20 }}>
            {projects.map((project) => {
              const counts = collectionCounts.get(project.id) ?? { albums: 0, galleries: 0 };
              const hovered = hoveredProjectId === project.id;
              return (
                <Link
                  key={project.id}
                  href={`/dashboard/projects/${project.id}`}
                  onMouseEnter={() => setHoveredProjectId(project.id)}
                  onMouseLeave={() => setHoveredProjectId((prev) => (prev === project.id ? null : prev))}
                  style={{
                    background: "#fff",
                    borderRadius: 20,
                    overflow: "hidden",
                    border: hovered ? "2px solid #b91c1c" : "1px solid #e5e7eb",
                    boxShadow: "0 8px 28px rgba(15,23,42,0.06)",
                    display: "block",
                    textDecoration: "none",
                    color: "inherit",
                    transform: hovered ? "translateY(-1px)" : "translateY(0)",
                    transition: "border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease",
                  }}
                >
                  <div style={{ background: cardGradient(project.title), color: "#fff", padding: "20px 20px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, padding: "7px 12px", fontSize: 12, fontWeight: 600 }}>
                        Event
                      </div>
                      <div style={{ display: "inline-flex", alignItems: "center", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>
                        {project.source_type}
                      </div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>{project.title}</div>
                    <div style={{ marginTop: 6, color: "rgba(255,255,255,0.82)", fontSize: 14 }}>{project.client_name || "Event workflow"}</div>
                  </div>
                  <div style={{ padding: 18 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
                      <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12 }}><div style={{ color: "#6b7280", fontSize: 12, marginBottom: 8 }}>Albums</div><div style={{ color: "#111827", fontSize: 17, fontWeight: 800 }}>{counts.albums}</div></div>
                      <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12 }}><div style={{ color: "#6b7280", fontSize: 12, marginBottom: 8 }}>Galleries</div><div style={{ color: "#111827", fontSize: 17, fontWeight: 800 }}>{counts.galleries}</div></div>
                      <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12 }}><div style={{ color: "#6b7280", fontSize: 12, marginBottom: 8 }}>Status</div><div style={{ color: "#111827", fontSize: 17, fontWeight: 800, textTransform: "capitalize" }}>{project.status || "active"}</div></div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, color: "#6b7280", fontSize: 13 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}><CalendarDays size={14} /> {formatDate(project.event_date || project.created_at)}</div>
                      <span style={{ color: hovered ? "#b91c1c" : "#111827", fontWeight: 700 }}>Open event ›</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
