"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { GraduationCap, Images, LogOut, Plus, School, Search, X } from "lucide-react";

type SchoolRow = {
  id: string;
  school_name: string;
  photographer_id: string | null;
  package_profile_id: string | null;
  local_school_id: string | null;
  created_at: string | null;
};

type StudentRow = {
  school_id: string;
  class_name: string | null;
  role: string | null;
  photo_url: string | null;
};

type SchoolCard = {
  id: string;
  school_name: string;
  local_school_id: string | null;
  created_at: string | null;
  peopleCount: number;
  classesCount: number;
  imagesCount: number;
};

type ProjectRow = {
  id: string;
  title: string | null;
  workflow_type: string | null;
  linked_local_school_id: string | null;
};

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

function normalizeRole(rawRole: string | null | undefined): string {
  const role = clean(rawRole).toLowerCase();
  if (!role) return "Unassigned";
  if (role === "student" || role === "students") return "Student";
  if (role === "teacher" || role === "teachers") return "Teacher";
  if (role === "coach" || role === "coaches") return "Coach";
  if (role === "principal" || role === "principle") return "Principal";
  if (role === "office staff" || role === "office" || role === "admin" || role === "administrator") {
    return "Office Staff";
  }
  if (role === "staff") return "Staff";
  return clean(rawRole) || "Unassigned";
}

function isStudentLike(role: string, className: string) {
  if (className) return true;
  return role === "Student";
}

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

function gradientForSchool(title: string) {
  const gradients = [
    "linear-gradient(135deg,#0f172a,#1d4ed8)",
    "linear-gradient(135deg,#111827,#065f46)",
    "linear-gradient(135deg,#1f2937,#7c3aed)",
    "linear-gradient(135deg,#172554,#0f766e)",
  ];

  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }

  return gradients[Math.abs(hash) % gradients.length];
}

export default function SchoolsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [schools, setSchools] = useState<SchoolCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

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
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (photographerErr) throw photographerErr;
      if (!photographerRow?.id) {
        setSchools([]);
        setLoading(false);
        return;
      }

      const { data: schoolRows, error: schoolErr } = await supabase
        .from("schools")
        .select("id,school_name,photographer_id,package_profile_id,local_school_id,created_at")
        .eq("photographer_id", photographerRow.id)
        .order("created_at", { ascending: false });

      if (schoolErr) throw schoolErr;

      const rawSchools = (schoolRows ?? []) as SchoolRow[];

      const { data: projectRows } = await supabase
        .from("projects")
        .select("id,title,workflow_type,linked_local_school_id")
        .eq("photographer_id", photographerRow.id)
        .eq("workflow_type", "event");

      const eventProjects = (projectRows ?? []) as ProjectRow[];
      const blockedLocalIds = new Set(
        eventProjects.map((p) => clean(p.linked_local_school_id)).filter(Boolean)
      );
      const blockedTitles = new Set(
        eventProjects.map((p) => clean(p.title).toLowerCase()).filter(Boolean)
      );

      const deduped = new Map<string, SchoolRow>();

      for (const school of rawSchools) {
        const localId = clean(school.local_school_id);
        const nameKey = clean(school.school_name).toLowerCase();
        if (localId && blockedLocalIds.has(localId)) continue;
        if (nameKey && blockedTitles.has(nameKey)) continue;
        const key = localId || nameKey;
        if (!key) continue;
        if (!deduped.has(key)) deduped.set(key, school);
      }

      const uniqueSchools = Array.from(deduped.values());
      if (uniqueSchools.length === 0) {
        setSchools([]);
        setLoading(false);
        return;
      }

      const schoolIds = uniqueSchools.map((s) => s.id);
      const { data: peopleRows, error: peopleErr } = await supabase
        .from("students")
        .select("school_id,class_name,role,photo_url")
        .in("school_id", schoolIds);

      if (peopleErr) throw peopleErr;

      const people = (peopleRows ?? []) as StudentRow[];
      const stats = new Map<string, { peopleCount: number; imagesCount: number; classNames: Set<string> }>();

      for (const school of uniqueSchools) {
        stats.set(school.id, { peopleCount: 0, imagesCount: 0, classNames: new Set<string>() });
      }

      for (const row of people) {
        const stat = stats.get(row.school_id);
        if (!stat) continue;
        stat.peopleCount += 1;
        if (clean(row.photo_url)) stat.imagesCount += 1;

        const className = clean(row.class_name);
        const role = normalizeRole(row.role);
        if (className && isStudentLike(role, className)) {
          stat.classNames.add(className);
        }
      }

      const cards = uniqueSchools.map<SchoolCard>((school) => {
        const stat = stats.get(school.id);
        return {
          id: school.id,
          school_name: school.school_name,
          local_school_id: school.local_school_id,
          created_at: school.created_at,
          peopleCount: stat?.peopleCount ?? 0,
          classesCount: stat?.classNames.size ?? 0,
          imagesCount: stat?.imagesCount ?? 0,
        };
      });

      setSchools(cards);
    } catch (err) {
      console.error("[schools] load error:", err);
      setError(err instanceof Error ? err.message : "Failed to load schools");
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  function openCreateModal() {
    setNewSchoolName("");
    setCreateError("");
    setShowCreateModal(true);
    setTimeout(() => createInputRef.current?.focus(), 50);
  }

  async function handleCreateSchool(e: React.FormEvent) {
    e.preventDefault();
    const name = newSchoolName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/dashboard/schools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ school_name: name }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; school?: { id: string } };
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to create school.");
      setShowCreateModal(false);
      if (data.school?.id) {
        router.push(`/dashboard/projects/schools/${data.school.id}/settings`);
      } else {
        void load();
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create school.");
    } finally {
      setCreating(false);
    }
  }

  const sortedSchools = useMemo(
    () => [...schools].sort((a, b) => a.school_name.localeCompare(b.school_name)),
    [schools]
  );
  const filteredSchools = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sortedSchools;

    return sortedSchools.filter((school) => {
      const schoolName = clean(school.school_name).toLowerCase();
      const localId = clean(school.local_school_id).toLowerCase();
      return schoolName.includes(query) || localId.includes(query);
    });
  }, [searchQuery, sortedSchools]);
  const [hoveredSchoolId, setHoveredSchoolId] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#ffffff" }}>
      <div style={sidebar}>
        <div style={{ background: "#fff", padding: "18px", borderBottom: "1px solid #e5e7eb" }}><div style={{ background: "#fff", borderRadius: 16, padding: "14px 16px" }}><Logo small /></div></div>
        <nav style={{ flex: 1, paddingTop: 16 }}>
          <Link href="/dashboard" style={navItem}>Dashboard</Link>
          <Link href="/dashboard/schools" style={navActive}>Schools</Link>
          <Link href="/dashboard/projects/events" style={navItem}>Events</Link>
          <Link href="/dashboard/orders" style={navItem}>Orders</Link>
          <Link href="/dashboard/packages" style={navItem}>Packages</Link>
          <Link href="/dashboard/settings" style={navItem}>Settings</Link>
        </nav>
        <div style={{ padding: "0 16px 8px", color: "#8f8f8f", fontSize: 12 }}>{userEmail}</div>
        <button onClick={signOut} style={{ margin: 16, padding: "10px", background: "transparent", border: "1px solid #333", borderRadius: 8, color: "#ccc", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <LogOut size={14} /> Sign Out
        </button>
      </div>

      <div style={{ flex: 1, padding: "40px" }}>
        <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "#111" }}>Schools</h1>
            <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 15 }}>
              All synced schools live here. Open a school to view classes, roles, and images.
            </p>
          </div>
          <button
            onClick={openCreateModal}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#111", color: "#fff", border: "none", borderRadius: 12, padding: "11px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            <Plus size={16} /> Create School
          </button>
        </div>

        <div style={{ marginBottom: 24, position: "relative", maxWidth: 460 }}>
          <Search
            size={16}
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#6b7280",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search schools or local ID..."
            style={{
              width: "100%",
              height: 44,
              borderRadius: 14,
              border: "1px solid #d1d5db",
              background: "#fff",
              padding: "0 14px 0 40px",
              fontSize: 14,
              color: "#111827",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {error && (
          <div style={{ marginBottom: 18, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "14px 18px", color: "#b91c1c", fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#666" }}>Loading schools...</div>
        ) : schools.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, background: "#fff", borderRadius: 16, border: "2px dashed #e5e7eb" }}>
            <School size={42} color="#c4c4c4" style={{ marginBottom: 12 }} />
            <p style={{ color: "#666", margin: 0 }}>No schools found yet. Sync from Studio OS app first.</p>
          </div>
        ) : filteredSchools.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, background: "#fff", borderRadius: 16, border: "2px dashed #e5e7eb" }}>
            <School size={42} color="#c4c4c4" style={{ marginBottom: 12 }} />
            <p style={{ color: "#666", margin: 0 }}>No schools match that search.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 20 }}>
            {filteredSchools.map((school) => {
              const href = `/dashboard/projects/schools/${school.id}`;
              const hovered = hoveredSchoolId === school.id;
              return (
              <Link
                key={school.id}
                href={href}
                onMouseEnter={() => setHoveredSchoolId(school.id)}
                onMouseLeave={() => setHoveredSchoolId((prev) => (prev === school.id ? null : prev))}
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
                <div style={{ background: gradientForSchool(school.school_name), color: "#fff", padding: "20px 20px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, padding: "7px 12px", fontSize: 12, fontWeight: 600 }}>
                      <School size={14} /> School
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>
                      local_school_sync
                    </div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>{school.school_name}</div>
                  <div style={{ marginTop: 6, color: "rgba(255,255,255,0.82)", fontSize: 14 }}>Synced from Studio OS app</div>
                </div>

                <div style={{ padding: 18 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12 }}>
                      <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 8 }}>Classes</div>
                      <div style={{ color: "#111827", fontSize: 17, fontWeight: 800 }}>{school.classesCount}</div>
                    </div>
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12 }}>
                      <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 8 }}>People</div>
                      <div style={{ color: "#111827", fontSize: 17, fontWeight: 800 }}>{school.peopleCount}</div>
                    </div>
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12 }}>
                      <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 8 }}>Images</div>
                      <div style={{ color: "#111827", fontSize: 17, fontWeight: 800 }}>{school.imagesCount}</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, color: "#6b7280", fontSize: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <GraduationCap size={14} /> {formatDate(school.created_at)}
                    </div>
                    <span style={{ color: hovered ? "#b91c1c" : "#111827", fontWeight: 700 }}>
                      Open school ›
                    </span>
                  </div>

                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#2563eb", borderRadius: 999, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>
                    <Images size={13} /> Synced school from app
                  </div>
                </div>
              </Link>
            )})}
          </div>
        )}
      </div>

      {/* Create School Modal */}
      {showCreateModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
        >
          <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: "100%", maxWidth: 440, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#111" }}>Create New School</h2>
              <button onClick={() => setShowCreateModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", padding: 4 }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={(e) => { void handleCreateSchool(e); }}>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
                  School Name
                </label>
                <input
                  ref={createInputRef}
                  type="text"
                  value={newSchoolName}
                  onChange={(e) => setNewSchoolName(e.target.value)}
                  placeholder="e.g. Westside Elementary"
                  style={{ width: "100%", height: 44, borderRadius: 12, border: "1px solid #d1d5db", padding: "0 14px", fontSize: 15, color: "#111", outline: "none", boxSizing: "border-box" }}
                  disabled={creating}
                />
              </div>
              {createError && (
                <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, color: "#b91c1c", fontSize: 13 }}>
                  {createError}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowCreateModal(false)} disabled={creating} style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  Cancel
                </button>
                <button type="submit" disabled={creating || !newSchoolName.trim()} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "#111", color: "#fff", fontSize: 14, fontWeight: 700, cursor: creating ? "not-allowed" : "pointer", opacity: creating || !newSchoolName.trim() ? 0.6 : 1 }}>
                  {creating ? "Creating…" : "Create School"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
