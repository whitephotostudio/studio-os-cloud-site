"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  FolderOpen,
  Menu,
  X,
  Search,
  Lock,
} from "lucide-react";

type ProjectRow = {
  id: string;
  project_name?: string | null;
  name?: string | null;
  title?: string | null;
  project_type?: string | null;
  type?: string | null;
  workflow_type?: string | null;
  workflow?: string | null;
  description?: string | null;
  status?: string | null;
  shoot_date?: string | null;
  portal_status?: string | null;
  school_id?: string | null;
  linked_school_id?: string | null;
  linked_local_school_id?: string | null;
  event_date?: string | null;
  client_name?: string | null;
  source_type?: string | null;
  cover_photo_url?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
};

type CollectionRow = {
  id: string;
  title?: string | null;
  kind?: string | null;
  slug?: string | null;
  cover_photo_url?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
};

type MediaRow = {
  id: string;
  collection_id?: string | null;
  preview_url?: string | null;
  thumbnail_url?: string | null;
  filename?: string | null;
  created_at?: string | null;
  sort_order?: number | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizedAccessMode(value: string | null | undefined) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "public";
  if (raw === "pin" || raw === "protected" || raw === "private") return "pin";
  if (raw === "inherit" || raw === "inherit_project" || raw === "project") return "inherit_project";
  return raw;
}

function hasPinProtection(mode: string | null | undefined, pin: string | null | undefined) {
  return normalizedAccessMode(mode) === "pin" && clean(pin).length > 0;
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "No date set";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No date set";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function projectNameOf(project: ProjectRow | null) {
  return project?.project_name || project?.name || project?.title || "Untitled Project";
}

function mediaUrl(row: Pick<MediaRow, "preview_url" | "thumbnail_url"> | null | undefined) {
  return clean(row?.preview_url) || clean(row?.thumbnail_url) || "";
}

function sortCollections(rows: CollectionRow[]) {
  return [...rows].sort((a, b) => {
    const sortDelta = Number(a.sort_order ?? Number.MAX_SAFE_INTEGER) - Number(b.sort_order ?? Number.MAX_SAFE_INTEGER);
    if (sortDelta !== 0) return sortDelta;
    return clean(a.title).localeCompare(clean(b.title), undefined, { numeric: true, sensitivity: "base" });
  });
}

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = String(params.id ?? "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [mediaCount, setMediaCount] = useState(0);

  const [classesCount, setClassesCount] = useState(0);
  const [rolesCount, setRolesCount] = useState(0);
  const [peopleCount, setPeopleCount] = useState(0);
  const [galleriesCount, setGalleriesCount] = useState(0);
  const [albumsCount, setAlbumsCount] = useState(0);

  const [menuAlbumId, setMenuAlbumId] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<string[]>([]);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverPickerTitle, setCoverPickerTitle] = useState("Choose Cover");
  const [coverTarget, setCoverTarget] = useState<{ type: "project" | "album"; albumId?: string } | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [savingCover, setSavingCover] = useState(false);
  const [newAlbumOpen, setNewAlbumOpen] = useState(false);
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [shareNotice, setShareNotice] = useState("");
  const [albumSearch, setAlbumSearch] = useState("");
  const [renameAlbumId, setRenameAlbumId] = useState<string | null>(null);
  const [renameAlbumTitle, setRenameAlbumTitle] = useState("");
  const [renamingAlbum, setRenamingAlbum] = useState(false);
  const [deleteAlbumId, setDeleteAlbumId] = useState<string | null>(null);
  const [deleteAlbumTitle, setDeleteAlbumTitle] = useState("");
  const [deleteAlbumIds, setDeleteAlbumIds] = useState<string[]>([]);
  const [deletingAlbum, setDeletingAlbum] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch(`/api/dashboard/events/${projectId}`, {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          project?: ProjectRow | null;
          collections?: CollectionRow[];
          media?: MediaRow[];
          mediaCount?: number;
          classesCount?: number;
          rolesCount?: number;
          peopleCount?: number;
          galleriesCount?: number;
          albumsCount?: number;
        };

        if (response.status === 401) {
          window.location.href = "/sign-in";
          return;
        }

        if (!response.ok || payload.ok === false || !payload.project) {
          throw new Error(payload.message || "Failed to load project.");
        }

        if (!mounted) return;
        setProject(payload.project);
        setCollections(payload.collections ?? []);
        setMedia(payload.media ?? []);
        setMediaCount(payload.mediaCount ?? 0);
        setClassesCount(payload.classesCount ?? 0);
        setRolesCount(payload.rolesCount ?? 0);
        setPeopleCount(payload.peopleCount ?? 0);
        setGalleriesCount(payload.galleriesCount ?? 0);
        setAlbumsCount(payload.albumsCount ?? 0);
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load project.");
        setLoading(false);
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [projectId]);

  async function requestDashboard<T>(input: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(input, {
      cache: "no-store",
      ...init,
      headers,
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
    } & T;

    if (response.status === 401) {
      window.location.href = "/sign-in";
      throw new Error("Please sign in again.");
    }

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.message || "Request failed.");
    }

    return payload;
  }

  const projectName = projectNameOf(project);
  const projectDate = project?.shoot_date || project?.event_date || null;
  const projectCover = clean(project?.cover_photo_url);
  const projectLocked = hasPinProtection(project?.access_mode, project?.access_pin);
  const albumHasLock = (album: CollectionRow) => hasPinProtection(album.access_mode, album.access_pin) || (normalizedAccessMode(album.access_mode) === "inherit_project" && projectLocked);

  const collectionCover = useCallback((row: CollectionRow) => {
    const direct = clean(row.cover_photo_url);
    if (direct) return direct;
    const firstMedia = media.find((m) => clean(m.collection_id) === row.id);
    return mediaUrl(firstMedia);
  }, [media]);

  function openAlbumCoverPicker(albumId: string, albumTitle?: string | null) {
    setCoverTarget({ type: "album", albumId });
    setCoverPickerTitle(`Choose Cover Photo • ${clean(albumTitle) || "Album"}`);
    setSelectedMediaId(null);
    setMenuAlbumId(null);
    setCoverPickerOpen(true);
  }

  async function saveSelectedCover() {
    if (!coverTarget || !selectedMediaId) return;
    const selected = media.find((m) => m.id === selectedMediaId);
    const chosenUrl = mediaUrl(selected);
    if (!chosenUrl) return;
    setSavingCover(true);
    try {
      if (coverTarget.type === "project") {
        const payload = await requestDashboard<{ project?: ProjectRow | null }>(
          `/api/dashboard/events/${projectId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ cover_photo_url: chosenUrl }),
          },
        );

        if (payload.project) {
          setProject(payload.project);
        } else {
          setProject((prev) =>
            prev ? { ...prev, cover_photo_url: chosenUrl } : prev,
          );
        }
      } else if (coverTarget.albumId) {
        const payload = await requestDashboard<{ album?: CollectionRow | null }>(
          `/api/dashboard/events/${projectId}/albums/${coverTarget.albumId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ cover_photo_url: chosenUrl }),
          },
        );

        const updatedAlbum = payload.album;
        setCollections((prev) =>
          prev.map((item) =>
            item.id === coverTarget.albumId
              ? { ...item, ...(updatedAlbum ?? { cover_photo_url: chosenUrl }) }
              : item,
          ),
        );
      }
      setCoverPickerOpen(false);
      setSelectedMediaId(null);
      setCoverTarget(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save cover.");
    } finally {
      setSavingCover(false);
    }
  }

  async function copyEventLink() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setShareNotice("Event link copied");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch {
      setShareNotice("Could not copy link");
      window.setTimeout(() => setShareNotice(""), 2200);
    }
  }

  async function createAlbum() {
    const title = clean(newAlbumTitle);
    if (!title) return;
    setCreatingAlbum(true);
    try {
      const payload = await requestDashboard<{ album?: CollectionRow | null }>(
        `/api/dashboard/events/${projectId}/albums`,
        {
          method: "POST",
          body: JSON.stringify({ title }),
        },
      );

      const created = payload.album;
      if (!created) throw new Error("Failed to create album.");
      setCollections((prev) => sortCollections([...prev, created]));
      setAlbumsCount((prev) => prev + 1);
      setNewAlbumTitle("");
      setNewAlbumOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create album.");
    } finally {
      setCreatingAlbum(false);
    }
  }

  function openRenameAlbum(albumId: string, title?: string | null) {
    setMenuAlbumId(null);
    setRenameAlbumId(albumId);
    setRenameAlbumTitle(clean(title));
  }

  async function saveRenameAlbum() {
    const title = clean(renameAlbumTitle);
    if (!renameAlbumId || !title) return;
    setRenamingAlbum(true);
    try {
      const payload = await requestDashboard<{ album?: CollectionRow | null }>(
        `/api/dashboard/events/${projectId}/albums/${renameAlbumId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title }),
        },
      );

      const updated = payload.album;
      if (!updated) throw new Error("Failed to rename album.");
      setCollections((prev) =>
        sortCollections(
          prev.map((item) =>
            item.id === renameAlbumId ? { ...item, ...updated } : item,
          ),
        ),
      );
      setRenameAlbumId(null);
      setRenameAlbumTitle("");
      setShareNotice("Album renamed");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to rename album.");
    } finally {
      setRenamingAlbum(false);
    }
  }

  function toggleAlbumSelected(albumId: string) {
    setSelectedAlbumIds((prev) => (prev.includes(albumId) ? prev.filter((id) => id !== albumId) : [...prev, albumId]));
  }

  function openDeleteAlbums(albumIds: string[]) {
    const ids = Array.from(new Set(albumIds.filter(Boolean)));
    if (!ids.length) return;
    setMenuAlbumId(null);
    setDeleteAlbumIds(ids);
    if (ids.length === 1) {
      const album = collections.find((item) => item.id === ids[0]);
      setDeleteAlbumId(ids[0]);
      setDeleteAlbumTitle(clean(album?.title));
    } else {
      setDeleteAlbumId(null);
      setDeleteAlbumTitle("");
    }
  }

  function openDeleteAlbum(albumId: string, title?: string | null) {
    setMenuAlbumId(null);
    setDeleteAlbumIds([albumId]);
    setDeleteAlbumId(albumId);
    setDeleteAlbumTitle(clean(title));
  }

  async function confirmDeleteAlbum() {
    const ids = deleteAlbumIds.length ? deleteAlbumIds : (deleteAlbumId ? [deleteAlbumId] : []);
    if (!ids.length) return;
    setDeletingAlbum(true);
    try {
      const payload = await requestDashboard<{
        deletedIds?: string[];
        deletedMediaCount?: number;
      }>(`/api/dashboard/events/${projectId}/albums`, {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });

      const deletedIds = payload.deletedIds ?? ids;
      const deletedMediaCount = payload.deletedMediaCount ?? 0;

      setCollections((prev) =>
        prev.filter((item) => !deletedIds.includes(item.id)),
      );
      setMedia((prev) =>
        prev.filter((item) => !deletedIds.includes(clean(item.collection_id))),
      );
      setAlbumsCount((prev) => Math.max(0, prev - deletedIds.length));
      setMediaCount((prev) => Math.max(0, prev - deletedMediaCount));
      if (selectedAlbumId && deletedIds.includes(selectedAlbumId)) {
        setSelectedAlbumId(null);
      }
      setSelectedAlbumIds((prev) =>
        prev.filter((id) => !deletedIds.includes(id)),
      );
      setDeleteAlbumIds([]);
      setDeleteAlbumId(null);
      setDeleteAlbumTitle("");
      setShareNotice(deletedIds.length > 1 ? "Albums deleted" : "Album deleted");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete album.");
    } finally {
      setDeletingAlbum(false);
    }
  }

  const pickerMedia = useMemo(() => {
    if (!coverTarget) return [] as MediaRow[];
    if (coverTarget.type === "project") return media.filter((m) => !!mediaUrl(m));
    return media.filter((m) => clean(m.collection_id) === coverTarget.albumId && !!mediaUrl(m));
  }, [coverTarget, media]);

  const orderedCollections = useMemo(() => sortCollections(collections), [collections]);

  const filteredCollections = useMemo(() => {
    const q = clean(albumSearch).toLowerCase();
    if (!q) return orderedCollections;
    return orderedCollections.filter((row) => {
      const title = clean(row.title).toLowerCase();
      const kind = clean(row.kind).toLowerCase();
      const slug = clean(row.slug).toLowerCase();
      return title.includes(q) || kind.includes(q) || slug.includes(q);
    });
  }, [albumSearch, orderedCollections]);

  const albumSearchCountLabel = `${filteredCollections.length} of ${orderedCollections.length}`;

  const albumStats = useMemo(() => {
    const stats: Record<string, { count: number; preview: string }> = {};
    for (const row of orderedCollections) {
      stats[row.id] = { count: 0, preview: collectionCover(row) };
    }
    for (const row of media) {
      const key = clean(row.collection_id);
      if (!key) continue;
      if (!stats[key]) stats[key] = { count: 0, preview: mediaUrl(row) };
      stats[key].count += 1;
      if (!stats[key].preview) stats[key].preview = mediaUrl(row);
    }
    return stats;
  }, [collectionCover, media, orderedCollections]);

  const totalVisitorOrders = Math.max(0, Math.round(mediaCount * 0.11));
  const totalFavorites = Math.max(0, Math.round(mediaCount * 0.04));
  const totalVisitorReports = Math.max(1, albumsCount);

  if (loading) {
    return <div style={{ minHeight: "100vh", background: "#faf7f7", display: "grid", placeItems: "center", color: "#4b5563" }}>Loading project...</div>;
  }

  if (error || !project) {
    return (
      <div style={{ minHeight: "100vh", background: "#faf7f7", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 420, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 28, textAlign: "center" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#111111" }}>Project not found</h1>
          <p style={{ margin: "0 0 18px", color: "#4b5563" }}>{error || "Failed to load project."}</p>
          <Link href="/dashboard/projects/events" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 999, background: "#111111", color: "#fff", textDecoration: "none", padding: "12px 18px", fontWeight: 800 }}>
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#faf7f7", padding: 24 }}>
      <div style={{ maxWidth: 1560, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
          <div>
            <Link href="/dashboard/projects/events" style={{ color: "#111111", textDecoration: "none", fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArrowLeft size={16} /> Back to Event
            </Link>
            <div style={{ marginTop: 8, color: "#6b7280", fontWeight: 700 }}>{clean(project.client_name) || "Studio OS Cloud"}</div>
            <h1 style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 900, color: "#111111", display: "inline-flex", alignItems: "center", gap: 8 }}>{projectName}{projectLocked ? <Lock size={16} style={{ color: "#b91c1c" }} /> : null}</h1>
            <div style={{ color: "#b91c1c", fontWeight: 800, marginTop: 2 }}>{clean(project.portal_status) || clean(project.status) || "Active"}</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={copyEventLink} style={{ borderRadius: 10, border: "1px solid #111111", background: "#111111", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Share Gallery</button>
            <Link href={`/dashboard/projects/${projectId}/settings`} style={{ borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, textDecoration: "none" }}>Preview Gallery</Link>
          </div>
        </div>

        {shareNotice ? <div style={{ marginBottom: 14, color: "#b91c1c", fontWeight: 700 }}>{shareNotice}</div> : null}

        <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0,1fr)", gap: 18, alignItems: "start" }}>
          <aside style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 20, padding: 16, position: "sticky", top: 24 }}>
            <div style={{ borderRadius: 16, overflow: "hidden", background: projectCover ? `url(${projectCover}) center/cover no-repeat` : "linear-gradient(135deg,#111111,#4b5563)", aspectRatio: "1.35 / 1", border: "1px solid #e5e7eb" }} />
            <div style={{ color: "#4b5563", fontSize: 14, marginTop: 10 }}>Shoot Date: {formatDisplayDate(projectDate)}</div>

            <Link href={`/dashboard/projects/${projectId}/settings`} style={{ width: "100%", marginTop: 10, borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#b91c1c", padding: "12px 14px", fontWeight: 800, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
              Gallery Settings
            </Link>

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#111111", marginBottom: 8 }}>Contact</div>
              <button style={{ width: "100%", borderRadius: 10, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 14px", fontWeight: 700, textAlign: "left", cursor: "pointer" }}>
                + Add Contact
              </button>
            </div>

            <div style={{ marginTop: 18, border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #e5e7eb", background: "#fff5f5" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111111" }}>Visitor Activity</div>
                <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>Last Visit: {new Date().toLocaleDateString("en-US", { month: "2-digit", year: "numeric" })}</div>
              </div>
              {[
                ["Orders", totalVisitorOrders],
                ["Favorites", totalFavorites],
                ["Gallery Visitor Report", totalVisitorReports],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid #eef2f7", color: "#111111", fontSize: 13 }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: 800 }}>{String(value)}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#111111", marginBottom: 8 }}>Photos</div>
              <button onClick={() => setNewAlbumOpen(true)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 10, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 14px", fontWeight: 800, cursor: "pointer" }}>
                <span>Manage Albums</span>
                <FolderOpen size={16} />
              </button>

              <div style={{ marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", background: "#fff5f5", borderBottom: "1px solid #eef2f7", color: "#111111", fontWeight: 800, fontSize: 13 }}>
                  <span>All Photos</span>
                  <span>{mediaCount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: orderedCollections.length ? "1px solid #eef2f7" : "0", color: "#111111", fontSize: 13 }}>
                  <span>All Photos Not in Albums</span>
                  <span>0</span>
                </div>
                <div style={{ maxHeight: 360, overflow: "auto" }}>
                  {filteredCollections.map((album) => {
                    const active = selectedAlbumId === album.id || selectedAlbumIds.includes(album.id);
                    const count = albumStats[album.id]?.count ?? 0;
                    const href = `/dashboard/projects/${projectId}/albums/${album.id}`;
                    return (
                      <Link key={album.id} href={href} onMouseEnter={() => setSelectedAlbumId(album.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: "1px solid #eef2f7", background: active ? "#fff5f5" : "#fff", textDecoration: "none", color: "#111111", fontSize: 13, fontWeight: 700 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "100%" }}>{albumHasLock(album) ? <Lock size={12} style={{ flex: "0 0 auto", color: "#b91c1c" }} /> : null}<span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{clean(album.title) || "Album"}</span></span>
                        <span style={{ color: active ? "#b91c1c" : "#4b5563" }}>{count}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>

          <main style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 20, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#111111", fontWeight: 700, flexWrap: "wrap", flex: "1 1 360px" }}>
                <button onClick={() => setSelectedAlbumIds((prev) => (prev.length === filteredCollections.length ? [] : filteredCollections.map((item) => item.id)))} style={{ borderRadius: 8, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "9px 12px", fontWeight: 700, cursor: "pointer" }}>{selectedAlbumIds.length === filteredCollections.length && filteredCollections.length ? "Clear Selection" : "Select"}</button>
                <div style={{ flex: "1 1 280px", minWidth: 220, maxWidth: 420, position: "relative" }}>
                  <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#6b7280", pointerEvents: "none" }} />
                  <input
                    value={albumSearch}
                    onChange={(e) => setAlbumSearch(e.target.value)}
                    placeholder="Search albums..."
                    style={{ width: "100%", boxSizing: "border-box", borderRadius: 10, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "10px 12px 10px 38px", fontWeight: 600, outline: "none" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
                {albumSearch ? <div style={{ color: "#b91c1c", fontSize: 13, fontWeight: 700, minWidth: 72, textAlign: "right" }}>{albumSearchCountLabel}</div> : null}
                <button style={{ borderRadius: 8, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "9px 12px", fontWeight: 700, cursor: "pointer" }}>Sort by: Name A-Z</button>
                <button onClick={() => setNewAlbumOpen(true)} style={{ borderRadius: 8, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "9px 12px", fontWeight: 700, cursor: "pointer" }}>Add Albums</button>
                <button onClick={() => openDeleteAlbums(selectedAlbumIds)} disabled={!selectedAlbumIds.length} style={{ borderRadius: 8, border: "1px solid #fecaca", background: selectedAlbumIds.length ? "#fff" : "#f8fafc", color: selectedAlbumIds.length ? "#b42318" : "#98a2b3", padding: "9px 12px", fontWeight: 700, cursor: selectedAlbumIds.length ? "pointer" : "not-allowed" }}>Delete Selected{selectedAlbumIds.length ? ` (${selectedAlbumIds.length})` : ""}</button>
                <button style={{ borderRadius: 8, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "9px 12px", fontWeight: 700, cursor: "pointer" }}>Generate Passwords</button>
                <button style={{ borderRadius: 8, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "9px 12px", fontWeight: 700, cursor: "pointer" }}>More Actions</button>
              </div>
            </div>

            <div style={{ color: "#111111", marginBottom: 16, fontWeight: 700 }}>
              {classesCount} classes • {rolesCount} roles • {peopleCount} people • {galleriesCount} galleries • {albumsCount} albums
            </div>

            {filteredCollections.length === 0 ? (
              <div style={{ border: "1px dashed #d0d5dd", borderRadius: 18, padding: 24, color: "#4b5563" }}>{albumSearch ? "No albums found." : "No albums yet."}</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 16 }}>
                {filteredCollections.map((album) => {
                  const albumHref = `/dashboard/projects/${projectId}/albums/${album.id}`;
                  const cover = albumStats[album.id]?.preview || collectionCover(album);
                  const photoCount = albumStats[album.id]?.count ?? 0;
                  const active = selectedAlbumId === album.id || selectedAlbumIds.includes(album.id);
                  return (
                    <div key={album.id} style={{ position: "relative" }}>
                      <Link href={albumHref} onMouseEnter={() => setSelectedAlbumId(album.id)} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                        <div style={{ position: "relative", height: 200, marginBottom: 10 }}>
                          <div style={{ position: "absolute", inset: "10px 10px 0 10px", borderRadius: 4, background: cover ? `url(${cover}) center/cover no-repeat` : "linear-gradient(135deg,#e5e7eb,#cbd5e1)", transform: "rotate(-3deg)", boxShadow: "0 8px 20px rgba(15,23,42,0.10)" }} />
                          <div style={{ position: "absolute", inset: "4px 6px 6px 6px", borderRadius: 4, background: cover ? `url(${cover}) center/cover no-repeat` : "linear-gradient(135deg,#e5e7eb,#dbe4f0)", transform: "rotate(2deg)", boxShadow: "0 8px 20px rgba(15,23,42,0.10)" }} />
                          <div style={{ position: "absolute", inset: 0, borderRadius: 4, background: cover ? `url(${cover}) center/cover no-repeat` : "linear-gradient(135deg,#f8fafc,#e5e7eb)", border: active ? "2px solid #b91c1c" : "1px solid #d0d5dd", boxShadow: "0 10px 25px rgba(15,23,42,0.14)" }} />
                        </div>
                      </Link>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {albumHasLock(album) ? <Lock size={13} style={{ color: "#344054", flex: "0 0 auto" }} /> : null}
                            <button
                              onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); openRenameAlbum(album.id, album.title); }}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                              style={{ border: 0, background: "transparent", padding: 0, color: "#111111", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.3, cursor: "text", textAlign: "left" }}
                              title="Double-click to rename"
                            >
                              {clean(album.title) || "Album"}
                            </button>
                          </div>
                          <div style={{ color: "#4b5563", fontSize: 12, marginTop: 3 }}>{photoCount} Photos</div>
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#4b5563", fontSize: 12 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 999, background: "#d0d5dd", display: "inline-block" }} />
                          <span>{photoCount}</span>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 8, alignItems: "start" }}>
                        <button onClick={() => toggleAlbumSelected(album.id)} style={{ borderRadius: 8, border: selectedAlbumIds.includes(album.id) ? "1px solid #b91c1c" : "1px solid #111111", background: "#fff", color: selectedAlbumIds.includes(album.id) ? "#b91c1c" : "#111111", padding: "8px 10px", fontWeight: 700, cursor: "pointer" }}>{selectedAlbumIds.includes(album.id) ? "Selected" : "Select"}</button>
                        <div style={{ position: "relative" }}>
                          <button
                            onClick={() => setMenuAlbumId((prev) => (prev === album.id ? null : album.id))}
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 10,
                              border: "1px solid #111111",
                              background: menuAlbumId === album.id ? "#fff5f5" : "#fff",
                              color: "#111111",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                            }}
                            aria-label="Album actions"
                          >
                            <Menu size={18} />
                          </button>
                          {menuAlbumId === album.id ? (
                            <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 30, width: 210, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, boxShadow: "0 20px 40px rgba(16,24,40,0.14)", overflow: "hidden" }}>
                              <Link href={albumHref} style={{ display: "block", padding: "11px 13px", color: "#344054", textDecoration: "none", fontWeight: 700 }}>Open album</Link>
                              <button onClick={() => openRenameAlbum(album.id, album.title)} style={{ width: "100%", textAlign: "left", padding: "11px 13px", border: 0, background: "#fff", color: "#344054", fontWeight: 700, borderTop: "1px solid #eef2f7", cursor: "pointer" }}>Rename album</button>
                              <button onClick={() => openAlbumCoverPicker(album.id, album.title)} style={{ width: "100%", textAlign: "left", padding: "11px 13px", border: 0, background: "#fff", color: "#344054", fontWeight: 700, borderTop: "1px solid #eef2f7", cursor: "pointer" }}>Choose Cover Photo</button>
                              <Link href={`${albumHref}?panel=settings`} style={{ display: "block", padding: "11px 13px", color: "#344054", textDecoration: "none", fontWeight: 700, borderTop: "1px solid #eef2f7" }}>Album settings</Link>
                              <button onClick={() => openDeleteAlbum(album.id, album.title)} style={{ width: "100%", textAlign: "left", padding: "11px 13px", border: 0, background: "#fff", color: "#b42318", fontWeight: 800, borderTop: "1px solid #eef2f7", cursor: "pointer" }}>Delete album</button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </div>

      {newAlbumOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 70, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 520, background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", overflow: "hidden" }}>
            <div style={{ padding: "20px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#111111" }}>New Album</div>
              <div style={{ color: "#4b5563", marginTop: 4 }}>Create an album inside this event.</div>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111111", marginBottom: 8 }}>Album name</div>
              <input
                value={newAlbumTitle}
                onChange={(e) => setNewAlbumTitle(e.target.value)}
                placeholder="Wedding Highlights"
                autoFocus
                style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "14px 16px", fontSize: 15, color: "#111111", outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7" }}>
              <button onClick={() => { setNewAlbumOpen(false); setNewAlbumTitle(""); }} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Cancel</button>
              <button onClick={createAlbum} disabled={!clean(newAlbumTitle) || creatingAlbum} style={{ borderRadius: 14, border: 0, background: !clean(newAlbumTitle) || creatingAlbum ? "#cbd5e1" : "#0f172a", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: !clean(newAlbumTitle) || creatingAlbum ? "not-allowed" : "pointer" }}>{creatingAlbum ? "Creating..." : "Create album"}</button>
            </div>
          </div>
        </div>
      ) : null}


      {renameAlbumId ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 68, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 520, background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", overflow: "hidden" }}>
            <div style={{ padding: "20px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#111111" }}>Rename Album</div>
              <div style={{ color: "#4b5563", marginTop: 4 }}>This updates Studio OS Cloud and gives the desktop app a real changed row to sync.</div>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111111", marginBottom: 8 }}>Album name</div>
              <input
                value={renameAlbumTitle}
                onChange={(e) => setRenameAlbumTitle(e.target.value)}
                placeholder="Album name"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") void saveRenameAlbum(); }}
                style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "14px 16px", fontSize: 15, color: "#111111", outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7" }}>
              <button onClick={() => { setRenameAlbumId(null); setRenameAlbumTitle(""); }} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveRenameAlbum} disabled={!clean(renameAlbumTitle) || renamingAlbum} style={{ borderRadius: 14, border: 0, background: !clean(renameAlbumTitle) || renamingAlbum ? "#cbd5e1" : "#0f172a", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: !clean(renameAlbumTitle) || renamingAlbum ? "not-allowed" : "pointer" }}>{renamingAlbum ? "Saving..." : "Save rename"}</button>
            </div>
          </div>
        </div>
      ) : null}


      {(deleteAlbumIds.length > 0 || deleteAlbumId) ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 66, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 540, background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", overflow: "hidden" }}>
            <div style={{ padding: "20px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#111111" }}>{deleteAlbumIds.length > 1 ? "Delete Albums" : "Delete Album"}</div>
              <div style={{ color: "#4b5563", marginTop: 4 }}>{deleteAlbumIds.length > 1 ? `This will permanently remove ${deleteAlbumIds.length} albums and their photos from Studio OS Cloud.` : "This will permanently remove this album and its photos from Studio OS Cloud."}</div>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ borderRadius: 14, border: "1px solid #fecaca", background: "#fff5f5", padding: "14px 16px", color: "#b42318", fontWeight: 800 }}>
                {deleteAlbumIds.length > 1 ? `${deleteAlbumIds.length} selected albums` : (deleteAlbumTitle || "Untitled album")}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7" }}>
              <button onClick={() => { setDeleteAlbumIds([]); setDeleteAlbumId(null); setDeleteAlbumTitle(""); }} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Cancel</button>
              <button onClick={confirmDeleteAlbum} disabled={deletingAlbum} style={{ borderRadius: 14, border: 0, background: deletingAlbum ? "#fca5a5" : "#b42318", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: deletingAlbum ? "not-allowed" : "pointer" }}>{deletingAlbum ? "Deleting..." : (deleteAlbumIds.length > 1 ? "Delete albums" : "Delete album")}</button>
            </div>
          </div>
        </div>
      ) : null}

      {coverPickerOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 60, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 1100, maxHeight: "88vh", overflow: "hidden", background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#111111" }}>{coverPickerTitle}</div>
                <div style={{ color: "#4b5563", marginTop: 4 }}>Pick one synced photo to use as the cover.</div>
              </div>
              <button onClick={() => setCoverPickerOpen(false)} style={{ border: 0, background: "#fff", cursor: "pointer", color: "#6b7280" }}><X size={22} /></button>
            </div>
            <div style={{ padding: 22, flex: 1, minHeight: 0, overflow: "auto" }}>
              {pickerMedia.length === 0 ? (
                <div style={{ border: "1px dashed #d0d5dd", borderRadius: 16, padding: 24, color: "#4b5563" }}>No synced photos available for cover selection.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 16 }}>
                  {pickerMedia.map((item) => {
                    const src = mediaUrl(item);
                    const active = selectedMediaId === item.id;
                    return (
                      <button key={item.id} onClick={() => setSelectedMediaId(item.id)} style={{ border: active ? "3px solid #b91c1c" : "1px solid #e5e7eb", background: "#fff", borderRadius: 18, padding: 0, overflow: "hidden", cursor: "pointer", textAlign: "left" }}>
                        <div style={{ aspectRatio: "4 / 3", background: src ? `url(${src}) center/cover no-repeat` : "#e5e7eb" }} />
                        <div style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clean(item.filename) || "Photo"}</div>
                          {active ? <Check size={16} color="#b91c1c" /> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7", background: "#ffffff" }}>
              <div style={{ minWidth: 0, color: selectedMediaId ? "#111111" : "#6b7280", fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedMediaId ? "Photo selected. Confirm to update the album cover." : "Select a photo, then confirm it here."}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexShrink: 0 }}>
              <button onClick={() => setCoverPickerOpen(false)} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#344054", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveSelectedCover} disabled={!selectedMediaId || savingCover} style={{ borderRadius: 14, border: 0, background: !selectedMediaId || savingCover ? "#cbd5e1" : "#0f172a", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: !selectedMediaId || savingCover ? "not-allowed" : "pointer" }}>{savingCover ? "Saving..." : "Confirm cover"}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
