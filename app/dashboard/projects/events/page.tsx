"use client";

import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { useIsMobile } from "@/lib/use-is-mobile";
import { ArrowLeft, CalendarDays, Check, ImagePlus, LogOut, MoreHorizontal, Search, Settings, Trash2, Users, X } from "lucide-react";

type ProjectRow = {
  id: string;
  title?: string | null;
  client_name?: string | null;
  workflow_type?: string | null;
  status?: string | null;
  portal_status?: string | null;
  shoot_date?: string | null;
  event_date?: string | null;
  cover_photo_url?: string | null;
  cover_focal_x?: number | null;
  cover_focal_y?: number | null;
};

type CollectionRow = {
  id: string;
  project_id?: string | null;
  kind?: string | null;
};

type MediaRow = {
  id: string;
  project_id?: string | null;
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

function projectNameOf(project: ProjectRow) {
  return clean(project.title) || "Untitled Event";
}

function projectSubtitleOf(project: ProjectRow) {
  return clean(project.client_name) || "Client gallery";
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "No date set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date set";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusLabel(project: ProjectRow) {
  return clean(project.portal_status) || clean(project.status) || "inactive";
}

function fallbackEventGradient(title: string) {
  const gradients = [
    "linear-gradient(135deg, rgba(17,24,39,0.96) 0%, rgba(185,28,28,0.94) 100%)",
    "linear-gradient(135deg, rgba(15,23,42,0.96) 0%, rgba(8,145,178,0.92) 100%)",
    "linear-gradient(135deg, rgba(6,78,59,0.96) 0%, rgba(17,24,39,0.96) 100%)",
    "linear-gradient(135deg, rgba(30,41,59,0.96) 0%, rgba(194,65,12,0.92) 100%)",
    "linear-gradient(135deg, rgba(30,58,138,0.94) 0%, rgba(15,118,110,0.92) 100%)",
    "linear-gradient(135deg, rgba(55,48,163,0.9) 0%, rgba(127,29,29,0.94) 100%)",
  ];

  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }

  return gradients[Math.abs(hash) % gradients.length];
}

function bgStyle(project: ProjectRow) {
  const cover = clean(project.cover_photo_url);
  if (cover) {
    const fx = Math.round((Number(project.cover_focal_x) || 0.5) * 100);
    const fy = Math.round((Number(project.cover_focal_y) || 0.5) * 100);
    return {
      backgroundImage: `linear-gradient(180deg, rgba(10,18,42,0.18) 0%, rgba(10,18,42,0.48) 100%), url(${cover})`,
      backgroundSize: "cover",
      backgroundPosition: `${fx}% ${fy}%`,
    } as const;
  }

  return {
    backgroundImage: fallbackEventGradient(projectNameOf(project)),
  } as const;
}

export default function EventsPage() {
  const supabase = createClient();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [albumCounts, setAlbumCounts] = useState<Record<string, number>>({});
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");

  // Selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Context menu for individual cards
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setUserEmail(user?.email ?? "");

        const response = await fetch("/api/dashboard/events", {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          projects?: ProjectRow[];
          albumCounts?: Record<string, number>;
          imageCounts?: Record<string, number>;
        };

        if (response.status === 401) {
          window.location.href = "/sign-in";
          return;
        }

        if (!response.ok || payload.ok === false) {
          throw new Error(payload.message || "Failed to load events.");
        }

        if (!mounted) return;
        setProjects(payload.projects ?? []);
        setAlbumCounts(payload.albumCounts ?? {});
        setImageCounts(payload.imageCounts ?? {});
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load events.");
        setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [supabase.auth]);

  // Close context menu on click elsewhere
  useEffect(() => {
    function handleClick() { setContextMenuId(null); setContextMenuPos(null); }
    if (contextMenuId) {
      window.addEventListener("click", handleClick);
      return () => window.removeEventListener("click", handleClick);
    }
  }, [contextMenuId]);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(filteredProjects.map((p) => p.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function handleDelete(ids: string[]) {
    if (!ids.length) return;
    setDeleting(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/dashboard/events/${id}`, { method: "DELETE" }).then((r) => r.json())
        )
      );
      setProjects((prev) => prev.filter((p) => !ids.includes(p.id)));
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
      setContextMenuId(null);
      setContextMenuPos(null);
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setDeleting(false);
    }
  }

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects;

    return projects.filter((project) => {
      const title = projectNameOf(project).toLowerCase();
      const subtitle = projectSubtitleOf(project).toLowerCase();
      const status = statusLabel(project).toLowerCase();
      return title.includes(q) || subtitle.includes(q) || status.includes(q);
    });
  }, [projects, searchQuery]);

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>, href: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(href);
    }
  }

  function handleCardClick(project: ProjectRow) {
    if (selectMode) {
      toggleSelect(project.id);
    } else {
      router.push(`/dashboard/projects/${project.id}`);
    }
  }

  function handleContextMenu(e: React.MouseEvent, projectId: string) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuId(projectId);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  }

  function handleThreeDotClick(e: React.MouseEvent, projectId: string) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenuId(projectId);
    setContextMenuPos({ x: rect.right, y: rect.bottom + 4 });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#ffffff" }}>
      <div
        className="flex-1 text-[#13234a] lg:px-10"
        style={{ padding: isMobile ? "14px" : "24px" }}
      >
        <div className="mx-auto max-w-[1480px]">
        <div
          className="mb-8"
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "stretch" : "flex-start",
            justifyContent: isMobile ? "flex-start" : "space-between",
            gap: isMobile ? 14 : 16,
          }}
        >
          <div>
            <Link href="/dashboard" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#667085] transition hover:text-[#13234a]">
              <ArrowLeft size={16} />
              Back to dashboard
            </Link>
            <h1
              className="font-bold tracking-[-0.04em] text-[#13234a]"
              style={{ fontSize: isMobile ? 28 : 48, lineHeight: 1.1 }}
            >
              Events
            </h1>
            <p
              className="text-[#667085]"
              style={{ fontSize: isMobile ? 14 : 20, marginTop: isMobile ? 8 : 16 }}
            >
              Weddings, baptisms, engagements, private events, and client galleries.
            </p>
          </div>

          <Link
            href="/dashboard/projects/new"
            className="inline-flex items-center gap-3 rounded-[22px] bg-[#0c1633] font-semibold text-white shadow-sm transition hover:-translate-y-0.5"
            style={{
              padding: isMobile ? "12px 18px" : "20px 28px",
              fontSize: isMobile ? 15 : 20,
              alignSelf: isMobile ? "flex-start" : undefined,
            }}
          >
            <span style={{ fontSize: isMobile ? 18 : 24, lineHeight: 1 }}>+</span>
            New Project
          </Link>
        </div>

        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-[560px]">
            <Search
              size={18}
              className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[#667085]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search events, client name, or status..."
              className="h-14 w-full rounded-[18px] border border-[#d9dfeb] bg-white pl-12 pr-4 text-[16px] text-[#13234a] outline-none transition focus:border-[#13234a] focus:ring-2 focus:ring-[#13234a]/10"
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!selectMode ? (
              <button
                onClick={() => setSelectMode(true)}
                style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
              >
                <Check size={14} /> Select
              </button>
            ) : (
              <>
                <button
                  onClick={selectedIds.size === filteredProjects.length ? deselectAll : selectAll}
                  style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  {selectedIds.size === filteredProjects.length ? "Deselect All" : "Select All"}
                </button>
                <button
                  onClick={exitSelectMode}
                  style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                >
                  <X size={14} /> Cancel
                </button>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <div className="rounded-[28px] border border-[#d9dfeb] bg-white p-10 text-lg text-[#667085]">Loading events…</div>
        ) : error ? (
          <div className="rounded-[28px] border border-[#f0c6c6] bg-[#fff5f5] p-6 text-[#b42318]">{error}</div>
        ) : filteredProjects.length === 0 ? (
          <div className="rounded-[28px] border border-[#d9dfeb] bg-white p-10 text-lg text-[#667085]">No events found.</div>
        ) : (
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 160 : 240}px, 1fr))`,
              gap: isMobile ? 12 : 20,
            }}
          >
            {filteredProjects.map((project) => {
              const href = `/dashboard/projects/${project.id}`;
              const hovered = hoveredProjectId === project.id;
              const cover = clean(project.cover_photo_url);
              const status = statusLabel(project);
              const selected = selectedIds.has(project.id);
              const statusColors: Record<string, { bg: string; fg: string }> = {
                active: { bg: "#dcfce7", fg: "#166534" },
                inactive: { bg: "#f3f4f6", fg: "#6b7280" },
                pre_release: { bg: "#fef9c3", fg: "#854d0e" },
                closed: { bg: "#fee2e2", fg: "#991b1b" },
              };
              const sc = statusColors[status] ?? { bg: "#f3f4f6", fg: "#6b7280" };
              return (
                <div
                  key={project.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => handleCardClick(project)}
                  onKeyDown={(event) => !selectMode && handleCardKeyDown(event, href)}
                  onContextMenu={(e) => handleContextMenu(e, project.id)}
                  onMouseEnter={() => setHoveredProjectId(project.id)}
                  onMouseLeave={() => setHoveredProjectId((prev) => (prev === project.id ? null : prev))}
                  className="cursor-pointer overflow-hidden bg-white transition"
                  style={{
                    border: selected ? "2px solid #2563eb" : hovered ? "2px solid #111" : "1px solid #e5e7eb",
                    borderRadius: 12,
                    boxShadow: selected ? "0 0 0 3px rgba(37,99,235,0.15)" : hovered ? "0 8px 24px rgba(0,0,0,0.1)" : "0 1px 4px rgba(0,0,0,0.04)",
                    transform: hovered ? "translateY(-2px)" : "translateY(0)",
                    position: "relative",
                  }}
                >
                  {/* Thumbnail — 2026-04-26: blurred backdrop fill +
                      objectFit:contain so portrait covers don't get
                      heads chopped off (was objectFit:cover). */}
                  <div style={{ position: "relative", paddingBottom: "75%", background: cover ? "#0f172a" : "#f3f4f6", overflow: "hidden" }}>
                    {cover ? (
                      <>
                        <img
                          src={cover}
                          alt=""
                          aria-hidden
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(28px) brightness(0.55) saturate(1.15)", transform: "scale(1.15)" }}
                        />
                        <img
                          src={cover}
                          alt={projectNameOf(project)}
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", objectPosition: `${Math.round((Number(project.cover_focal_x) || 0.5) * 100)}% ${Math.round((Number(project.cover_focal_y) || 0.5) * 100)}%` }}
                        />
                      </>
                    ) : (
                      <div style={{ position: "absolute", inset: 0, ...bgStyle(project), display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <ImagePlus size={32} color="rgba(255,255,255,0.5)" />
                      </div>
                    )}

                    {/* Selection checkbox (top-left) */}
                    {(selectMode || selected) && (
                      <div
                        onClick={(e) => { e.stopPropagation(); toggleSelect(project.id); }}
                        style={{
                          position: "absolute",
                          top: 10,
                          left: 10,
                          width: 26,
                          height: 26,
                          borderRadius: 8,
                          background: selected ? "#2563eb" : "rgba(255,255,255,0.85)",
                          border: selected ? "2px solid #2563eb" : "2px solid rgba(0,0,0,0.25)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          zIndex: 5,
                          transition: "all 150ms ease",
                        }}
                      >
                        {selected && <Check size={14} color="#fff" strokeWidth={3} />}
                      </div>
                    )}

                    {/* Three-dot menu (top-right) */}
                    {(hovered || selectMode) && !selected && (
                      <div
                        onClick={(e) => handleThreeDotClick(e, project.id)}
                        style={{
                          position: "absolute",
                          top: 10,
                          right: 10,
                          width: 30,
                          height: 30,
                          borderRadius: 8,
                          background: "rgba(0,0,0,0.45)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          zIndex: 5,
                        }}
                      >
                        <MoreHorizontal size={16} color="#fff" />
                      </div>
                    )}

                    {/* Hover overlay with quick links */}
                    {hovered && !selectMode && (
                      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <Link
                          href={`${href}/settings`}
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "rgba(255,255,255,0.95)", color: "#111", borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: "none" }}
                        >
                          <Settings size={13} /> Settings
                        </Link>
                        <Link
                          href={`${href}/visitors`}
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "rgba(255,255,255,0.95)", color: "#111", borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: "none" }}
                        >
                          <Users size={13} /> Visitors
                        </Link>
                      </div>
                    )}
                  </div>

                  {/* Info below thumbnail */}
                  <div style={{ padding: "14px 16px 16px" }}>
                    <h2 style={{ fontSize: 15, fontWeight: 800, color: "#111", margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {projectNameOf(project)}
                    </h2>
                    {projectSubtitleOf(project) && (
                      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>{projectSubtitleOf(project)}</div>
                    )}
                    <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                      {formatDisplayDate(project.event_date || project.shoot_date)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                      <span style={{ fontSize: 12, color: "#6b7280" }}>{imageCounts[project.id] ?? 0} photos</span>
                      <span style={{ fontSize: 12, color: "#d1d5db" }}>&middot;</span>
                      <span style={{ fontSize: 12, color: "#6b7280" }}>{albumCounts[project.id] ?? 0} albums</span>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.fg, textTransform: "capitalize" }}>
                        {status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Context menu */}
        {contextMenuId && contextMenuPos && (
          <div
            style={{
              position: "fixed",
              top: Math.min(
                contextMenuPos.y,
                (typeof window !== "undefined" ? window.innerHeight : 800) - 180,
              ),
              left: Math.max(
                8,
                Math.min(
                  contextMenuPos.x,
                  (typeof window !== "undefined" ? window.innerWidth : 1200) - 172,
                ),
              ),
              background: "#fff",
              borderRadius: 10,
              boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
              border: "1px solid #e5e7eb",
              zIndex: 999,
              padding: "6px 0",
              minWidth: 160,
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/dashboard/projects/${contextMenuId}`);
                setContextMenuId(null);
              }}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#374151", fontWeight: 500 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f3f4f6"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
            >
              <Settings size={14} /> Open
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!selectMode) setSelectMode(true);
                toggleSelect(contextMenuId);
                setContextMenuId(null);
              }}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#374151", fontWeight: 500 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f3f4f6"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
            >
              <Check size={14} /> Select
            </button>
            <div style={{ height: 1, background: "#e5e7eb", margin: "4px 0" }} />
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedIds(new Set([contextMenuId]));
                setShowDeleteConfirm(true);
                setContextMenuId(null);
              }}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#dc2626", fontWeight: 500 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#fef2f2"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}

        {/* Bottom action bar when items are selected */}
        {selectMode && selectedIds.size > 0 && (
          <div
            style={{
              position: "fixed",
              bottom: isMobile ? 14 : 28,
              left: isMobile ? 14 : "50%",
              right: isMobile ? 14 : "auto",
              transform: isMobile ? "none" : "translateX(-50%)",
              background: "#111827",
              borderRadius: 16,
              padding: isMobile ? "10px 14px" : "12px 24px",
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 10 : 20,
              boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
              zIndex: 900,
              color: "#fff",
              justifyContent: isMobile ? "space-between" : "flex-start",
            }}
          >
            <span style={{ fontSize: isMobile ? 12 : 14, fontWeight: 700 }}>
              {selectedIds.size} {selectedIds.size === 1 ? "event" : "events"} selected
            </span>
            {!isMobile && (
              <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.2)" }} />
            )}
            <div style={{ display: "flex", gap: isMobile ? 8 : 0, alignItems: "center" }}>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: isMobile ? "7px 12px" : "8px 16px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontSize: isMobile ? 12 : 13, fontWeight: 700, cursor: "pointer" }}
              >
                <Trash2 size={14} /> Delete
              </button>
              <button
                onClick={exitSelectMode}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "7px 12px" : "8px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#fff", fontSize: isMobile ? 12 : 13, fontWeight: 600, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Delete confirmation modal */}
        {showDeleteConfirm && (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
            onClick={(e) => { if (e.target === e.currentTarget && !deleting) { setShowDeleteConfirm(false); } }}
          >
            <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: "100%", maxWidth: 420, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Trash2 size={20} color="#dc2626" />
                </div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111" }}>Delete {selectedIds.size === 1 ? "Event" : "Events"}</h2>
              </div>
              <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14, lineHeight: 1.5 }}>
                Are you sure you want to delete {selectedIds.size === 1 ? "this event" : `these ${selectedIds.size} events`}? This will also remove all photos and albums associated with {selectedIds.size === 1 ? "it" : "them"}. This action cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDelete(Array.from(selectedIds))}
                  disabled={deleting}
                  style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontSize: 14, fontWeight: 700, cursor: deleting ? "not-allowed" : "pointer", opacity: deleting ? 0.6 : 1 }}
                >
                  {deleting ? "Deleting…" : `Delete ${selectedIds.size === 1 ? "Event" : `${selectedIds.size} Events`}`}
                </button>
              </div>
            </div>
          </div>
        )}

        </div>
      </div>
    </div>
  );
}
