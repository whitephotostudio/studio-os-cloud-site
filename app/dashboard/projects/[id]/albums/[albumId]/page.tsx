"use client";

import { ChangeEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckSquare, FolderPlus, Lock, Menu, Settings, Trash2, Upload, X, ZoomIn } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ProjectRow = {
  id: string;
  title?: string | null;
  client_name?: string | null;
  status?: string | null;
  portal_status?: string | null;
  event_date?: string | null;
  shoot_date?: string | null;
};

type CollectionRow = {
  id: string;
  project_id?: string | null;
  title?: string | null;
  kind?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
};

type MediaRow = {
  id: string;
  storage_path?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  created_at?: string | null;
  sort_order?: number | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function labelForProject(project: ProjectRow | null) {
  return clean(project?.title) || "Untitled Event";
}

export default function ProjectAlbumPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = String(params?.id ?? "");
  const albumId = String(params?.albumId ?? "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [album, setAlbum] = useState<CollectionRow | null>(null);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const [albumAccessMode, setAlbumAccessMode] = useState<"inherit_project" | "public" | "pin">("inherit_project");
  const [albumPin, setAlbumPin] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [busyPhotoIds, setBusyPhotoIds] = useState<string[]>([]);
  const [openPhotoMenuId, setOpenPhotoMenuId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/dashboard/events/${projectId}/albums/${albumId}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          project?: ProjectRow | null;
          album?: CollectionRow | null;
          media?: MediaRow[];
        };

        if (response.status === 401) {
          window.location.href = "/sign-in";
          return;
        }

        if (!response.ok || payload.ok === false || !payload.project || !payload.album) {
          throw new Error(payload.message || "Failed to load album.");
        }

        if (!cancelled) {
          const nextAlbum = payload.album;
          const nextMedia = payload.media ?? [];
          setProject(payload.project);
          setAlbum(nextAlbum);
          setAlbumAccessMode(nextAlbum.access_mode === "pin" ? "pin" : nextAlbum.access_mode === "public" ? "public" : "inherit_project");
          setAlbumPin(nextAlbum.access_pin || "");
          setMedia(nextMedia);
          setSelectedIds((prev) => prev.filter((id) => nextMedia.some((item) => item.id === id)));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load album.");
          setProject(null);
          setAlbum(null);
          setMedia([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (projectId && albumId) void load();

    return () => {
      cancelled = true;
    };
  }, [projectId, albumId]);

  useEffect(() => {
    if (searchParams?.get("panel") === "settings") {
      setSettingsOpen(true);
      setManageOpen(false);
    }
  }, [searchParams]);

  async function copyAlbumLink() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyNotice("Album link copied");
      setTimeout(() => setCopyNotice(""), 2200);
    } catch {
      setCopyNotice("Could not copy link");
      setTimeout(() => setCopyNotice(""), 2200);
    }
  }

  async function saveAlbumAccess() {
    try {
      const response = await fetch(
        `/api/dashboard/events/${projectId}/albums/${albumId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_mode: albumAccessMode,
            access_pin: albumAccessMode === "pin" ? albumPin || null : null,
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        album?: CollectionRow | null;
      };

      if (response.status === 401) {
        window.location.href = "/sign-in";
        return;
      }

      if (!response.ok || payload.ok === false || !payload.album) {
        throw new Error(payload.message || "Could not save album settings");
      }

      setAlbum(payload.album);
      setSavedNotice("Album settings saved");
      setTimeout(() => setSavedNotice(""), 2200);
      setSettingsOpen(false);
    } catch {
      setSavedNotice("Could not save album settings");
      setTimeout(() => setSavedNotice(""), 2200);
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    if (!projectId || !albumId || !album) {
      setError("Album not found.");
      event.target.value = "";
      return;
    }

    setUploading(true);
    setError("");

    try {
      const uploadedRows: MediaRow[] = [];

      for (const file of files) {
        const originalExt = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
        const ext = clean(originalExt).toLowerCase() || "jpg";
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const storagePath = `projects/${projectId}/albums/${albumId}/${safeName}`;

        const { error: uploadError } = await supabase.storage.from("thumbs").upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });

        if (uploadError) {
          throw new Error(uploadError.message || "Failed to upload file to storage.");
        }

        const { data: publicData } = supabase.storage.from("thumbs").getPublicUrl(storagePath);
        const publicUrl = clean(publicData?.publicUrl);

        const payload = {
          project_id: projectId,
          collection_id: albumId,
          storage_path: storagePath,
          filename: file.name,
          mime_type: file.type || null,
          preview_url: publicUrl || null,
          thumbnail_url: publicUrl || null,
          sort_order: media.length + uploadedRows.length,
          is_cover: false,
        };

        const { data: insertedRow, error: insertError } = await supabase
          .from("media")
          .insert(payload)
          .select("id,storage_path,thumbnail_url,preview_url,filename,mime_type,created_at,sort_order")
          .single();

        if (insertError) {
          throw new Error(insertError.message || "Failed to save photo record.");
        }

        uploadedRows.push((insertedRow ?? {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          storage_path: storagePath,
          filename: file.name,
          mime_type: file.type || null,
          preview_url: publicUrl || null,
          thumbnail_url: publicUrl || null,
          created_at: new Date().toISOString(),
          sort_order: media.length + uploadedRows.length,
        }) as MediaRow);
      }

      setMedia((prev) => [...prev, ...uploadedRows]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload photos.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function openViewer(index: number) {
    setOpenPhotoMenuId(null);
    setViewerIndex(index);
  }

  function toggleSelectAll() {
    if (!media.length) return;
    setSelectedIds((prev) => (prev.length === media.length ? [] : media.map((item) => item.id)));
  }

  async function renamePhoto(item: MediaRow) {
    setOpenPhotoMenuId(null);
    const currentName = clean(item.filename) || "Photo";
    const nextName = typeof window !== "undefined" ? window.prompt("Rename photo", currentName) : null;
    const finalName = clean(nextName);
    if (!finalName || finalName === currentName) return;

    setBusyPhotoIds((prev) => [...prev, item.id]);
    try {
      const { error } = await supabase.from("media").update({ filename: finalName }).eq("id", item.id).eq("project_id", projectId);
      if (error) throw error;
      setMedia((prev) => prev.map((row) => (row.id === item.id ? { ...row, filename: finalName } : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename photo.");
    } finally {
      setBusyPhotoIds((prev) => prev.filter((id) => id !== item.id));
    }
  }

  async function deletePhotos(ids: string[]) {
    if (!ids.length) return;
    const confirmed = typeof window !== "undefined" ? window.confirm(ids.length === 1 ? "Delete this photo?" : `Delete ${ids.length} selected photos?`) : false;
    if (!confirmed) return;

    setOpenPhotoMenuId((prev) => (prev && ids.includes(prev) ? null : prev));
    setBusyPhotoIds((prev) => [...new Set([...prev, ...ids])]);
    try {
      const targets = media.filter((item) => ids.includes(item.id));
      for (const item of targets) {
        const path = clean(item.storage_path);
        if (path) {
          const { error: storageError } = await supabase.storage.from("thumbs").remove([path]);
          if (storageError) {
            throw new Error(storageError.message || "Failed to delete file from storage.");
          }
        }
      }

      const { error: deleteError } = await supabase.from("media").delete().in("id", ids).eq("project_id", projectId);
      if (deleteError) throw deleteError;

      setMedia((prev) => prev.filter((item) => !ids.includes(item.id)));
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
      setViewerIndex((prev) => {
        if (prev === null) return null;
        const remaining = media.filter((item) => !ids.includes(item.id));
        return remaining.length ? Math.min(prev, remaining.length - 1) : null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete photo(s).");
    } finally {
      setBusyPhotoIds((prev) => prev.filter((id) => !ids.includes(id)));
    }
  }

  const folderInputProps: Record<string, string> = { webkitdirectory: "", directory: "" };
  const selectedCount = selectedIds.length;
  const allSelected = media.length > 0 && selectedCount === media.length;
  const viewerItem = viewerIndex === null ? null : media[viewerIndex] ?? null;

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#faf7f7", color: "#4b5563" }}>
        Loading album…
      </div>
    );
  }

  if (error || !project || !album) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#faf7f7", padding: 24 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 28, width: "100%", maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 28, color: "#111827" }}>{project && album ? "Upload failed" : "Album not found"}</h1>
          <p style={{ color: "#6b7280", margin: "10px 0 18px" }}>{error || "Failed to load album."}</p>
          <Link href={`/dashboard/projects/${projectId}`} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#111827", color: "#fff", borderRadius: 999, padding: "12px 18px", textDecoration: "none", fontWeight: 800 }}>
            Back to Event
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#faf7f7", padding: 36 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
          <div>
            <Link href={`/dashboard/projects/${projectId}`} style={{ color: "#111111", textDecoration: "none", fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArrowLeft size={16} /> Back to Event
            </Link>
            <div style={{ color: "#6b7280", fontSize: 14, marginTop: 10 }}>{labelForProject(project)}</div>
            <h1 style={{ fontSize: 34, fontWeight: 900, color: "#111827", margin: "8px 0 0" }}>{clean(album.title) || "Album"}</h1>
            <div style={{ color: "#4b5563", marginTop: 8 }}>{media.length} photos</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleUpload} style={{ display: "none" }} />
            <input ref={folderInputRef} type="file" multiple accept="image/*" onChange={handleUpload} style={{ display: "none" }} {...folderInputProps} />
            <button onClick={toggleSelectAll} disabled={!media.length} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #111111", borderRadius: 12, padding: "12px 16px", fontWeight: 700, color: !media.length ? "#98a2b3" : "#111827", cursor: !media.length ? "default" : "pointer" }}>
              <CheckSquare size={16} /> {allSelected ? "Clear Selection" : "Select Multiple"}
            </button>
            <button onClick={() => void deletePhotos(selectedIds)} disabled={!selectedCount} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: `1px solid ${selectedCount ? "#ef4444" : "#e5e7eb"}`, borderRadius: 12, padding: "12px 16px", fontWeight: 700, color: selectedCount ? "#dc2626" : "#98a2b3", cursor: selectedCount ? "pointer" : "default" }}>
              <Trash2 size={16} /> Delete Selected{selectedCount ? ` (${selectedCount})` : ""}
            </button>
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #111111", borderRadius: 12, padding: "12px 16px", fontWeight: 700, color: "#111827", cursor: "pointer", opacity: uploading ? 0.7 : 1 }}>
              <Upload size={16} /> {uploading ? "Uploading..." : "Upload Photos"}
            </button>
            <button onClick={() => folderInputRef.current?.click()} disabled={uploading} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #111111", borderRadius: 12, padding: "12px 16px", fontWeight: 700, color: "#111827", cursor: "pointer", opacity: uploading ? 0.7 : 1 }}>
              <FolderPlus size={16} /> {uploading ? "Uploading..." : "Upload Folder"}
            </button>
            <div style={{ position: "relative" }}>
              <button onClick={() => setManageOpen((prev) => !prev)} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #111111", borderRadius: 12, padding: "12px 16px", fontWeight: 700, color: "#111827", cursor: "pointer" }}>
                <Settings size={16} /> Manage
              </button>
              {manageOpen ? (
                <div style={{ position: "absolute", right: 0, top: "calc(100% + 10px)", zIndex: 30, minWidth: 220, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 20px 40px rgba(16,24,40,0.14)", overflow: "hidden" }}>
                  <button onClick={() => { setSettingsOpen(true); setManageOpen(false); }} style={{ width: "100%", textAlign: "left", padding: "12px 14px", border: 0, background: "#fff", color: "#111827", fontWeight: 700, cursor: "pointer" }}>Album access</button>
                  <button onClick={() => { void copyAlbumLink(); setManageOpen(false); }} style={{ width: "100%", textAlign: "left", padding: "12px 14px", border: 0, borderTop: "1px solid #eef2f7", background: "#fff", color: "#111827", fontWeight: 700, cursor: "pointer" }}>Share album</button>
                  <Link href={`/dashboard/projects/${projectId}/settings`} style={{ display: "block", padding: "12px 14px", color: "#111827", textDecoration: "none", fontWeight: 700, borderTop: "1px solid #eef2f7" }}>Event settings</Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {copyNotice ? <div style={{ marginBottom: 14, color: "#b91c1c", fontWeight: 700 }}>{copyNotice}</div> : null}
        {savedNotice ? <div style={{ marginBottom: 14, color: "#b91c1c", fontWeight: 700 }}>{savedNotice}</div> : null}
        {error ? <div style={{ marginBottom: 14, color: "#b42318", fontWeight: 700 }}>{error}</div> : null}

        {media.length === 0 ? (
          <div style={{ background: "#fff", border: "1px dashed #d0d5dd", borderRadius: 18, padding: 28, color: "#4b5563" }}>
            No photos in this album yet.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 18 }}>
            {media.map((item, index) => {
              const src = clean(item.preview_url) || clean(item.thumbnail_url) || "";
              const selected = selectedIds.includes(item.id);
              const busy = busyPhotoIds.includes(item.id);
              return (
                <div key={item.id} style={{ background: "#fff", border: selected ? "2px solid #b91c1c" : "1px solid #e5e7eb", borderRadius: 18, overflow: "visible", boxShadow: "0 8px 24px rgba(16,24,40,0.05)", position: "relative", zIndex: openPhotoMenuId === item.id ? 30 : 1 }}>
                  <button onClick={() => toggleSelect(item.id)} style={{ position: "absolute", top: 12, left: 12, zIndex: 3, width: 28, height: 28, borderRadius: 999, border: selected ? "1px solid #111111" : "1px solid rgba(17,24,39,0.16)", background: selected ? "#111111" : "rgba(255,255,255,0.95)", color: selected ? "#fff" : "#667085", display: "grid", placeItems: "center", cursor: "pointer" }}>
                    <CheckSquare size={15} />
                  </button>
                  <button onDoubleClick={() => openViewer(index)} onClick={() => openViewer(index)} style={{ display: "block", width: "100%", border: 0, padding: 0, background: "#f8fafc", cursor: "zoom-in", overflow: "hidden", borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
                    <div style={{ aspectRatio: "3 / 4", background: src ? `url(${src}) center/contain no-repeat` : "#e5e7eb" }} />
                  </button>
                  <div style={{ padding: 14 }}>
                    <div style={{ color: "#111827", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {clean(item.filename) || "Photo"}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 12, alignItems: "start" }}>
                      <button onClick={() => openViewer(index)} style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 10, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "8px 10px", fontWeight: 700, cursor: "pointer" }}>
                        <ZoomIn size={14} /> View
                      </button>
                      <div style={{ position: "relative" }}>
                        <button
                          onClick={() => setOpenPhotoMenuId((prev) => (prev === item.id ? null : item.id))}
                          disabled={busy}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            border: "1px solid #111111",
                            background: openPhotoMenuId === item.id ? "#fff5f5" : "#fff",
                            color: "#111111",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: busy ? "default" : "pointer",
                            opacity: busy ? 0.6 : 1,
                          }}
                          aria-label="Photo actions"
                        >
                          <Menu size={18} />
                        </button>
                        {openPhotoMenuId === item.id ? (
                          <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 20, minWidth: 180, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, boxShadow: "0 18px 36px rgba(17,17,17,0.12)", overflow: "hidden" }}>
                            <button
                              type="button"
                              onClick={() => void renamePhoto(item)}
                              style={{ width: "100%", textAlign: "left", padding: "12px 14px", color: "#111111", background: "#fff", border: 0, fontWeight: 700, cursor: "pointer" }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => void deletePhotos([item.id])}
                              style={{ width: "100%", textAlign: "left", padding: "12px 14px", color: "#dc2626", background: "#fff", border: 0, borderTop: "1px solid #f1f5f9", fontWeight: 700, cursor: "pointer" }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {viewerItem ? (
        <div onClick={() => setViewerIndex(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.88)", display: "grid", placeItems: "center", zIndex: 90, padding: 24 }}>
          <div onClick={(e: ReactMouseEvent<HTMLDivElement>) => e.stopPropagation()} style={{ width: "100%", maxWidth: 1180, maxHeight: "92vh", background: "#0f172a", borderRadius: 24, border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 30px 80px rgba(0,0,0,0.4)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", color: "#fff" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{clean(viewerItem.filename) || "Photo"}</div>
                <div style={{ color: "rgba(255,255,255,0.65)", marginTop: 4, fontSize: 13 }}>{(viewerIndex ?? 0) + 1} of {media.length}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => setViewerIndex((prev) => (prev === null ? prev : (prev - 1 + media.length) % media.length))} style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", padding: "10px 14px", fontWeight: 800, cursor: "pointer" }}>Prev</button>
                <button onClick={() => setViewerIndex((prev) => (prev === null ? prev : (prev + 1) % media.length))} style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", padding: "10px 14px", fontWeight: 800, cursor: "pointer" }}>Next</button>
                <button onClick={() => setViewerIndex(null)} style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", padding: "10px 14px", fontWeight: 800, cursor: "pointer" }}>Close</button>
              </div>
            </div>
            <div style={{ display: "grid", placeItems: "center", padding: 18, height: "calc(92vh - 82px)", background: "#020617" }}>
              <img src={clean(viewerItem.preview_url) || clean(viewerItem.thumbnail_url) || ""} alt={clean(viewerItem.filename) || "Photo"} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain", borderRadius: 18 }} />
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 70, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 560, background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "20px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#111827" }}>Album access</div>
                <div style={{ color: "#4b5563", marginTop: 4 }}>Choose whether this album inherits the project PIN, stays public, or uses its own PIN.</div>
              </div>
              <button onClick={() => setSettingsOpen(false)} style={{ border: 0, background: "#fff", cursor: "pointer", color: "#6b7280" }}><X size={22} /></button>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ paddingTop: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111111", marginBottom: 10 }}>Album access</div>
                <div style={{ display: "grid", gap: 12 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, border: "1px solid #e5e7eb", borderRadius: 16, padding: 14 }}>
                    <input type="radio" checked={albumAccessMode === "inherit_project"} onChange={() => setAlbumAccessMode("inherit_project")} style={{ accentColor: "#b91c1c" }} />
                    <div>
                      <div style={{ fontWeight: 800, color: "#111827" }}>Inherit project</div>
                      <div style={{ color: "#4b5563", marginTop: 4 }}>Use whatever project access is currently set.</div>
                    </div>
                  </label>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, border: "1px solid #e5e7eb", borderRadius: 16, padding: 14 }}>
                    <input type="radio" checked={albumAccessMode === "public"} onChange={() => setAlbumAccessMode("public")} style={{ accentColor: "#b91c1c" }} />
                    <div>
                      <div style={{ fontWeight: 800, color: "#111827" }}>Public</div>
                      <div style={{ color: "#4b5563", marginTop: 4 }}>This album opens without a PIN.</div>
                    </div>
                  </label>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, border: "1px solid #e5e7eb", borderRadius: 16, padding: 14 }}>
                    <input type="radio" checked={albumAccessMode === "pin"} onChange={() => setAlbumAccessMode("pin")} style={{ accentColor: "#b91c1c" }} />
                    <div>
                      <div style={{ fontWeight: 800, color: "#111827" }}>Album PIN</div>
                      <div style={{ color: "#4b5563", marginTop: 4 }}>Set a different PIN just for this album.</div>
                    </div>
                  </label>
                </div>
              </div>
              {albumAccessMode === "pin" ? (
                <div style={{ paddingTop: 18 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#111111", marginBottom: 8 }}>Album PIN</div>
                  <div style={{ position: "relative" }}>
                    <Lock size={16} style={{ position: "absolute", left: 14, top: 15, color: "#6b7280" }} />
                    <input
                      type="text"
                      value={albumPin}
                      onChange={(e) => setAlbumPin(e.target.value)}
                      placeholder="Set album PIN"
                      style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "13px 14px 13px 42px", fontSize: 15, color: "#111827", outline: "none" }}
                    />
                  </div>
                </div>
              ) : null}
              <div style={{ marginTop: 18, borderRadius: 16, background: "#fff5f5", border: "1px solid #fecaca", padding: 14, color: "#4b5563", fontSize: 14 }}>
                Album access now saves to the real collections table so Studio OS Cloud and the desktop app can sync the same PIN.
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7" }}>
              <button onClick={() => setSettingsOpen(false)} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111827", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveAlbumAccess} style={{ borderRadius: 14, border: 0, background: "#111827", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Save</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
