"use client";

import { ChangeEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckSquare, FolderPlus, Lock, Menu, Settings, Trash2, Upload, X, ZoomIn, LoaderCircle, Image as ImageIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { buildStoredMediaUrls } from "@/lib/storage-images";
import { generateThumbnails } from "@/lib/generate-thumbnails-client";
import { uploadToR2 } from "@/lib/upload-to-r2-client";

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
  download_url?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  created_at?: string | null;
  sort_order?: number | null;
};

type UploadQueueItem = {
  id: string;
  filename: string;
  status: "queued" | "uploading" | "processing" | "done" | "error";
};

type UploadSession = {
  total: number;
  completed: number;
  failed: number;
  activeFileName: string;
  activePreviewUrl: string | null;
  phase: "uploading" | "complete" | "complete_with_errors";
  items: UploadQueueItem[];
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function shortFileName(value: string | null | undefined) {
  const cleaned = clean(value);
  if (!cleaned) return "Photo";
  const parts = cleaned.split("/");
  return clean(parts[parts.length - 1]) || cleaned;
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
  const [viewerAspectRatio, setViewerAspectRatio] = useState<number | null>(null);
  const [busyPhotoIds, setBusyPhotoIds] = useState<string[]>([]);
  const [openPhotoMenuId, setOpenPhotoMenuId] = useState<string | null>(null);
  const [uploadSession, setUploadSession] = useState<UploadSession | null>(null);
  const [loadedMediaIds, setLoadedMediaIds] = useState<Set<string>>(new Set());
  const uploadPreviewRef = useRef<string | null>(null);
  const uploadResetTimeoutRef = useRef<number | null>(null);

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

  useEffect(() => {
    setLoadedMediaIds((prev) => {
      const validIds = new Set(media.map((item) => item.id));
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [media]);

  useEffect(() => {
    return () => {
      if (uploadPreviewRef.current && typeof URL !== "undefined") {
        URL.revokeObjectURL(uploadPreviewRef.current);
      }
      if (uploadResetTimeoutRef.current && typeof window !== "undefined") {
        window.clearTimeout(uploadResetTimeoutRef.current);
      }
    };
  }, []);

  function clearUploadPreview() {
    if (uploadPreviewRef.current && typeof URL !== "undefined") {
      URL.revokeObjectURL(uploadPreviewRef.current);
      uploadPreviewRef.current = null;
    }
  }

  function markMediaLoaded(id: string) {
    setLoadedMediaIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function setUploadPreview(file: File | null) {
    clearUploadPreview();
    if (!file || typeof URL === "undefined" || !file.type.startsWith("image/")) {
      setUploadSession((prev) => (prev ? { ...prev, activePreviewUrl: null } : prev));
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    uploadPreviewRef.current = nextUrl;
    setUploadSession((prev) => (prev ? { ...prev, activePreviewUrl: nextUrl } : prev));
  }

  function scheduleUploadReset(delayMs: number) {
    if (typeof window === "undefined") return;
    if (uploadResetTimeoutRef.current) {
      window.clearTimeout(uploadResetTimeoutRef.current);
    }
    uploadResetTimeoutRef.current = window.setTimeout(() => {
      clearUploadPreview();
      setUploadSession(null);
      uploadResetTimeoutRef.current = null;
    }, delayMs);
  }

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

    if (uploadResetTimeoutRef.current && typeof window !== "undefined") {
      window.clearTimeout(uploadResetTimeoutRef.current);
      uploadResetTimeoutRef.current = null;
    }

    setUploading(true);
    setError("");
    const batchId = Date.now();
    const queueItems: UploadQueueItem[] = files.map((file, index) => ({
      id: `${batchId}-${index}`,
      filename: shortFileName(file.webkitRelativePath || file.name),
      status: index === 0 ? "uploading" : "queued",
    }));

    setUploadSession({
      total: files.length,
      completed: 0,
      failed: 0,
      activeFileName: queueItems[0]?.filename ?? "",
      activePreviewUrl: null,
      phase: "uploading",
      items: queueItems,
    });
    setUploadPreview(files[0] ?? null);

    try {
      let uploadedCount = 0;
      let failedCount = 0;

      for (const file of files) {
        const queueId = `${batchId}-${files.indexOf(file)}`;
        const displayName = shortFileName(file.webkitRelativePath || file.name);
        setUploadPreview(file);
        setUploadSession((prev) =>
          prev
            ? {
                ...prev,
                activeFileName: displayName,
                items: prev.items.map((item) =>
                  item.id === queueId
                    ? { ...item, status: "uploading" }
                    : item.status === "uploading"
                      ? { ...item, status: "queued" }
                      : item,
                ),
              }
            : prev,
        );

        const originalExt = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
        const ext = clean(originalExt).toLowerCase() || "jpg";
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const storagePath = `projects/${projectId}/albums/${albumId}/${safeName}`;

        try {
          // Upload original to Cloudflare R2 (zero egress fees for downloads)
          const accessToken = (await supabase.auth.getSession()).data.session?.access_token || "";
          const r2Result = await uploadToR2(file, storagePath, accessToken);

          if (!r2Result) {
            throw new Error("Failed to upload file to storage.");
          }

          setUploadSession((prev) =>
            prev
              ? {
                  ...prev,
                  items: prev.items.map((item) =>
                    item.id === queueId ? { ...item, status: "processing" } : item,
                  ),
                }
              : prev,
          );

          // Generate pre-sized thumbnails server-side on R2
          const generated = await generateThumbnails(storagePath, accessToken);

          const previewUrl = generated.previewUrl || r2Result.publicUrl;
          const thumbnailUrl = generated.thumbnailUrl || r2Result.publicUrl;

          const payload = {
            project_id: projectId,
            collection_id: albumId,
            storage_path: storagePath,
            filename: file.name,
            mime_type: file.type || null,
            preview_url: previewUrl || null,
            thumbnail_url: thumbnailUrl || null,
            sort_order: media.length + uploadedCount + failedCount,
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

          const nextRow = ({
            ...(insertedRow ?? {
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              storage_path: storagePath,
              filename: file.name,
              mime_type: file.type || null,
              preview_url: previewUrl || null,
              thumbnail_url: thumbnailUrl || null,
              created_at: new Date().toISOString(),
              sort_order: media.length + uploadedCount + failedCount,
            }),
            download_url: r2Result.publicUrl,
          }) as MediaRow;

          uploadedCount += 1;
          setMedia((prev) => [...prev, nextRow]);
          setUploadSession((prev) =>
            prev
              ? {
                  ...prev,
                  completed: uploadedCount,
                  items: prev.items.map((item) =>
                    item.id === queueId ? { ...item, status: "done" } : item,
                  ),
                }
              : prev,
          );
        } catch (fileError) {
          failedCount += 1;
          setUploadSession((prev) =>
            prev
              ? {
                  ...prev,
                  failed: failedCount,
                  items: prev.items.map((item) =>
                    item.id === queueId ? { ...item, status: "error" } : item,
                  ),
                }
              : prev,
          );
          console.error(fileError);
        }
      }

      const successCount = uploadedCount;
      if (failedCount > 0 && successCount > 0) {
        setError(`Uploaded ${successCount} of ${files.length} photo${files.length === 1 ? "" : "s"}. ${failedCount} failed.`);
      } else if (failedCount > 0) {
        setError(`Could not upload ${failedCount} photo${failedCount === 1 ? "" : "s"}. Please try again.`);
      }

      setUploadSession((prev) =>
        prev
          ? {
              ...prev,
              activeFileName: failedCount > 0 ? `${successCount} uploaded • ${failedCount} failed` : `${successCount} uploaded`,
              phase: failedCount > 0 ? "complete_with_errors" : "complete",
            }
          : prev,
      );
      scheduleUploadReset(failedCount > 0 ? 5000 : 2600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload photos.");
      setUploadSession((prev) =>
        prev
          ? {
              ...prev,
              phase: "complete_with_errors",
              activeFileName: "Upload could not be completed.",
            }
          : prev,
      );
      scheduleUploadReset(5000);
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
    setViewerAspectRatio(null);
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
      const response = await fetch(`/api/dashboard/events/${projectId}/albums/${albumId}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ ids }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "Failed to delete photo(s).");
      }

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
  const viewerIsPortrait =
    viewerAspectRatio !== null ? viewerAspectRatio < 0.95 : false;
  const viewerSrc = viewerItem
    ? clean(viewerItem.download_url) ||
      buildStoredMediaUrls({
        storagePath: clean(viewerItem.storage_path),
        previewUrl: viewerItem.preview_url,
        thumbnailUrl: viewerItem.thumbnail_url,
      }).originalUrl ||
      clean(viewerItem.preview_url) ||
      clean(viewerItem.thumbnail_url) ||
      ""
    : "";
  const pendingUploadItems =
    uploadSession?.items.filter(
      (item) => item.status === "queued" || item.status === "uploading" || item.status === "processing",
    ) ?? [];
  const uploadPlaceholders = pendingUploadItems.slice(0, 8);
  const uploadProcessedCount = (uploadSession?.completed ?? 0) + (uploadSession?.failed ?? 0);
  const uploadDisplayCount = uploadSession
    ? uploadSession.phase === "uploading"
      ? Math.min(uploadProcessedCount + 1, uploadSession.total)
      : uploadProcessedCount
    : 0;
  const uploadProgress =
    uploadSession && uploadSession.total > 0
      ? Math.min(100, Math.round((uploadProcessedCount / uploadSession.total) * 100))
      : 0;
  const hasGridContent = media.length > 0 || uploadPlaceholders.length > 0;

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
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 8 }}>
              <div style={{ color: "#4b5563" }}>{media.length} photos</div>
              {uploadSession ? (
                <div
                  style={{
                    borderRadius: 999,
                    border: "1px solid #fde68a",
                    background: "#fffbeb",
                    color: uploadSession.phase === "complete_with_errors" ? "#b45309" : "#92400e",
                    padding: "6px 10px",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {uploadSession.phase === "uploading"
                    ? `Uploading ${uploadDisplayCount} of ${uploadSession.total}`
                    : uploadSession.phase === "complete_with_errors"
                      ? `${uploadSession.completed} uploaded • ${uploadSession.failed} failed`
                      : `${uploadSession.completed} uploaded`}
                </div>
              ) : null}
            </div>
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
              <Upload size={16} /> {uploadSession?.phase === "uploading" ? `Uploading ${uploadDisplayCount}/${uploadSession.total}` : "Upload Photos"}
            </button>
            <button onClick={() => folderInputRef.current?.click()} disabled={uploading} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #111111", borderRadius: 12, padding: "12px 16px", fontWeight: 700, color: "#111827", cursor: "pointer", opacity: uploading ? 0.7 : 1 }}>
              <FolderPlus size={16} /> {uploadSession?.phase === "uploading" ? `Uploading ${uploadDisplayCount}/${uploadSession.total}` : "Upload Folder"}
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

        {!hasGridContent ? (
          <div style={{ background: "#fff", border: "1px dashed #d0d5dd", borderRadius: 18, padding: 28, color: "#4b5563" }}>
            No photos in this album yet.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 18 }}>
            {uploadPlaceholders.map((item) => {
              const isActive = item.status === "uploading" || item.status === "processing";
              return (
                <div
                  key={item.id}
                  style={{
                    background: "#fff",
                    border: "1px dashed #d0d5dd",
                    borderRadius: 18,
                    overflow: "hidden",
                    boxShadow: "0 8px 24px rgba(16,24,40,0.05)",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      aspectRatio: "3 / 4",
                      background:
                        "linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(241,245,249,1) 100%)",
                      display: "grid",
                      placeItems: "center",
                      color: isActive ? "#111827" : "#94a3b8",
                    }}
                  >
                    {isActive ? <LoaderCircle size={34} /> : <ImageIcon size={34} />}
                  </div>
                  <div style={{ padding: 14 }}>
                    <div
                      style={{
                        color: "#111827",
                        fontWeight: 700,
                        fontSize: 14,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.filename}
                    </div>
                    <div style={{ color: "#6b7280", fontSize: 13, marginTop: 8 }}>
                      {item.status === "queued" ? "Waiting in queue..." : "Processing..."}
                    </div>
                  </div>
                </div>
              );
            })}
            {media.map((item, index) => {
              const src = clean(item.thumbnail_url) || clean(item.preview_url) || "";
              const selected = selectedIds.includes(item.id);
              const busy = busyPhotoIds.includes(item.id);
              const loaded = loadedMediaIds.has(item.id);
              return (
                <div key={item.id} style={{ background: "#fff", border: selected ? "2px solid #b91c1c" : "1px solid #e5e7eb", borderRadius: 18, overflow: "visible", boxShadow: "0 8px 24px rgba(16,24,40,0.05)", position: "relative", zIndex: openPhotoMenuId === item.id ? 30 : 1 }}>
                  <button onClick={() => toggleSelect(item.id)} style={{ position: "absolute", top: 12, left: 12, zIndex: 3, width: 28, height: 28, borderRadius: 999, border: selected ? "1px solid #111111" : "1px solid rgba(17,24,39,0.16)", background: selected ? "#111111" : "rgba(255,255,255,0.95)", color: selected ? "#fff" : "#667085", display: "grid", placeItems: "center", cursor: "pointer" }}>
                    <CheckSquare size={15} />
                  </button>
                  <button onDoubleClick={() => openViewer(index)} onClick={() => openViewer(index)} style={{ display: "block", width: "100%", border: 0, padding: 0, background: "#f8fafc", cursor: "zoom-in", overflow: "hidden", borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
                    <div style={{ aspectRatio: "3 / 4", background: "linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(241,245,249,1) 100%)", position: "relative", display: "grid", placeItems: "center" }}>
                      {!loaded ? <LoaderCircle size={28} color="#94a3b8" /> : null}
                      {src ? (
                        <img
                          loading="lazy"
                          decoding="async"
                          src={src}
                          alt={clean(item.filename) || "Photo"}
                          onLoad={() => markMediaLoaded(item.id)}
                          style={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            opacity: loaded ? 1 : 0,
                            transition: "opacity 0.18s ease",
                          }}
                        />
                      ) : null}
                    </div>
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

      {uploadSession ? (
        <div
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            zIndex: 95,
            width: "min(360px, calc(100vw - 32px))",
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 22,
            boxShadow: "0 24px 48px rgba(15,23,42,0.18)",
            padding: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 58,
                height: 58,
                flex: "0 0 auto",
                borderRadius: 16,
                border: "1px solid #e5e7eb",
                background: uploadSession.activePreviewUrl
                  ? `url(${uploadSession.activePreviewUrl}) center/cover no-repeat`
                  : "linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)",
                display: "grid",
                placeItems: "center",
                color: "#111827",
                overflow: "hidden",
              }}
            >
              {uploadSession.activePreviewUrl ? null : <Upload size={22} />}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: "#111827", fontWeight: 900, fontSize: 16 }}>
                {uploadSession.phase === "uploading"
                  ? "Uploading Photos..."
                  : uploadSession.phase === "complete_with_errors"
                    ? "Upload finished with issues"
                    : "Upload complete"}
              </div>
              <div style={{ color: "#4b5563", fontSize: 13, marginTop: 4 }}>
                {uploadSession.phase === "uploading"
                  ? `${uploadDisplayCount} of ${uploadSession.total} photos`
                  : uploadSession.phase === "complete_with_errors"
                    ? `${uploadSession.completed} uploaded • ${uploadSession.failed} failed`
                    : `${uploadSession.completed} photos uploaded`}
              </div>
              <div
                style={{
                  color: "#6b7280",
                  fontSize: 12,
                  marginTop: 6,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {uploadSession.activeFileName}
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: 14,
              height: 8,
              borderRadius: 999,
              background: "#eef2f7",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${uploadSession.phase === "uploading" ? uploadProgress : 100}%`,
                background:
                  uploadSession.phase === "complete_with_errors"
                    ? "linear-gradient(90deg, #f59e0b 0%, #f97316 100%)"
                    : "linear-gradient(90deg, #0ea5e9 0%, #2563eb 100%)",
                transition: "width 0.25s ease",
              }}
            />
          </div>
        </div>
      ) : null}

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
              <img
                loading="eager"
                src={viewerSrc}
                alt={clean(viewerItem.filename) || "Photo"}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  const naturalWidth = image.naturalWidth || image.width;
                  const naturalHeight = image.naturalHeight || image.height;
                  if (!naturalWidth || !naturalHeight) return;
                  setViewerAspectRatio(naturalWidth / naturalHeight);
                }}
                style={{
                  maxWidth: viewerIsPortrait ? "min(54vw, 620px)" : "100%",
                  maxHeight: viewerIsPortrait ? "calc(92vh - 150px)" : "100%",
                  width: "auto",
                  height: "auto",
                  objectFit: "contain",
                  borderRadius: 18,
                }}
              />
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
