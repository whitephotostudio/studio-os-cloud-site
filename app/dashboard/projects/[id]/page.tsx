"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Heart,
  Mail,
  Menu,
  Send,
  X,
  Search,
  Lock,
  UserPlus,
  ImagePlus,
} from "lucide-react";
import {
  defaultEventGalleryShareSettings,
  normalizeEventGallerySettings,
  type EventGalleryLinkedContact,
  type EventGalleryShareSettings,
} from "@/lib/event-gallery-settings";

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
  cover_focal_x?: number | null;
  cover_focal_y?: number | null;
  gallery_slug?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  gallery_settings?: unknown;
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

type FavoritesAlbumRow = {
  collectionId: string;
  title: string;
  favoritesCount: number;
  lastFavoritedAt?: string | null;
  previewUrl?: string | null;
};

type FavoritesViewerRow = {
  viewerEmail: string;
  favoritesCount: number;
  lastActivityAt?: string | null;
  albums: string[];
  preRegistered?: boolean;
  openedGallery?: boolean;
};

type RecentFavoriteRow = {
  mediaId: string;
  collectionId?: string | null;
  collectionTitle: string;
  viewerEmail: string;
  createdAt?: string | null;
  previewUrl?: string | null;
  filename: string;
};

type FavoriteMediaRow = {
  mediaId: string;
  collectionId?: string | null;
  collectionTitle: string;
  favoritesCount: number;
  latestFavoritedAt?: string | null;
  previewUrl?: string | null;
  filename: string;
  storagePath?: string | null;
};

type FavoritesSummary = {
  ordersCount: number;
  totalFavorites: number;
  uniqueViewers: number;
  albumsWithFavorites: number;
  preRegisteredCount: number;
  viewers: FavoritesViewerRow[];
  albums: FavoritesAlbumRow[];
  recentFavorites: RecentFavoriteRow[];
  favoriteMedia: FavoriteMediaRow[];
  warning?: string | null;
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

function formatActivityDate(value: string | null | undefined) {
  if (!value) return "No activity yet";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Recently";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
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

function emptyFavoritesSummary(): FavoritesSummary {
  return {
    ordersCount: 0,
    totalFavorites: 0,
    uniqueViewers: 0,
    albumsWithFavorites: 0,
    preRegisteredCount: 0,
    viewers: [],
    albums: [],
    recentFavorites: [],
    favoriteMedia: [],
    warning: null,
  };
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const MEDIA_BUCKET = "thumbs";

function publicStorageUrl(path: string | null | undefined) {
  const safePath = clean(path);
  if (!SUPABASE_URL || !safePath) return "";
  return `${SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${safePath}`;
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
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
  const [favoritesSummary, setFavoritesSummary] = useState<FavoritesSummary>(() => emptyFavoritesSummary());
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoritesError, setFavoritesError] = useState("");

  const [menuAlbumId, setMenuAlbumId] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<string[]>([]);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverPickerTitle, setCoverPickerTitle] = useState("Choose Cover");
  const [coverTarget, setCoverTarget] = useState<{ type: "project" | "album"; albumId?: string } | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [savingCover, setSavingCover] = useState(false);
  const [focalEditorOpen, setFocalEditorOpen] = useState(false);
  const [focalX, setFocalX] = useState(0.5);
  const [focalY, setFocalY] = useState(0.5);
  const [savingFocal, setSavingFocal] = useState(false);
  const [newAlbumOpen, setNewAlbumOpen] = useState(false);
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [shareNotice, setShareNotice] = useState("");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareView, setShareView] = useState<"menu" | "compose" | "report" | "favorites">("menu");
  const [photoSidebarOpen, setPhotoSidebarOpen] = useState(true);
  const [favoritesLibraryMode, setFavoritesLibraryMode] = useState<"photos" | "albums">("photos");
  const [hoveredActivityMetric, setHoveredActivityMetric] = useState<string | null>(null);
  const [downloadingFavoriteMedia, setDownloadingFavoriteMedia] = useState(false);
  const [favoriteLibraryNotice, setFavoriteLibraryNotice] = useState("");
  const [shareRecipientMode, setShareRecipientMode] = useState<"visitors" | "others">("visitors");
  const [shareRecipientInput, setShareRecipientInput] = useState("");
  const [shareSubject, setShareSubject] = useState(defaultEventGalleryShareSettings.emailSubject);
  const [shareHeadline, setShareHeadline] = useState(defaultEventGalleryShareSettings.emailHeadline);
  const [shareButtonLabel, setShareButtonLabel] = useState(defaultEventGalleryShareSettings.emailButtonLabel);
  const [shareMessage, setShareMessage] = useState(defaultEventGalleryShareSettings.emailMessage);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareSending, setShareSending] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactRole, setContactRole] = useState("Linked Contact");
  const [contactNote, setContactNote] = useState("");
  const [contactVip, setContactVip] = useState(false);
  const [contactLabelPhotos, setContactLabelPhotos] = useState(false);
  const [contactHidePhotos, setContactHidePhotos] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
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
        setFocalX(Number((payload.project as Record<string, unknown>)?.cover_focal_x) || 0.5);
        setFocalY(Number((payload.project as Record<string, unknown>)?.cover_focal_y) || 0.5);

        // Auto-generate gallery slug if missing
        const proj = payload.project as Record<string, unknown>;
        if (!proj.gallery_slug) {
          const name = String(proj.title || proj.project_name || proj.name || "").trim();
          if (name) {
            const autoSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            if (autoSlug) {
              fetch(`/api/dashboard/events/${projectId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gallery_slug: autoSlug }),
              }).then((r) => r.json()).then((res) => {
                if (mounted && (res as { project?: ProjectRow }).project) {
                  setProject((res as { project: ProjectRow }).project);
                }
              }).catch(() => {/* ignore slug generation errors */});
            }
          }
        }

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

  useEffect(() => {
    let mounted = true;

    async function loadFavorites() {
      try {
        setFavoritesLoading(true);
        setFavoritesError("");

        const response = await fetch(`/api/dashboard/events/${projectId}/favorites`, {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          summary?: FavoritesSummary;
        };

        if (response.status === 401) {
          window.location.href = "/sign-in";
          return;
        }

        if (!response.ok || payload.ok === false) {
          throw new Error(payload.message || "Failed to load favorite activity.");
        }

        if (!mounted) return;
        setFavoritesSummary(payload.summary ?? emptyFavoritesSummary());
        setFavoritesLoading(false);
      } catch (err) {
        if (!mounted) return;
        setFavoritesSummary(emptyFavoritesSummary());
        setFavoritesError(
          err instanceof Error ? err.message : "Failed to load favorite activity.",
        );
        setFavoritesLoading(false);
      }
    }

    if (projectId) void loadFavorites();

    return () => {
      mounted = false;
    };
  }, [projectId]);

  async function requestDashboard<T>(input: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    // Attach auth token so server-side resolveDashboardAuth succeeds
    if (!headers.has("Authorization")) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.set("Authorization", `Bearer ${session.access_token}`);
      }
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

  const gallerySettings = useMemo(
    () => normalizeEventGallerySettings(project?.gallery_settings),
    [project?.gallery_settings],
  );
  const projectName = projectNameOf(project);
  const projectDate = project?.shoot_date || project?.event_date || null;
  const projectCover = clean(project?.cover_photo_url);
  const projectLocked = hasPinProtection(project?.access_mode, project?.access_pin);
  const albumHasLock = (album: CollectionRow) => hasPinProtection(album.access_mode, album.access_pin) || (normalizedAccessMode(album.access_mode) === "inherit_project" && projectLocked);
  const linkedContacts = gallerySettings.linkedContacts;
  const visitorEmails = useMemo(
    () =>
      Array.from(
        new Set(
          favoritesSummary.viewers
            .map((viewer) => clean(viewer.viewerEmail))
            .filter(Boolean),
        ),
      ),
    [favoritesSummary.viewers],
  );
  const galleryEntryUrl = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const slug = clean(project?.gallery_slug);
    if (slug) {
      return `${origin}/g/${slug}`;
    }
    const params = new URLSearchParams({
      mode: "event",
      project: projectId,
    });
    return `${origin}/parents?${params.toString()}`;
  }, [projectId, project?.gallery_slug]);
  const accessSummary = projectLocked
    ? `Access PIN: ${clean(project?.access_pin)}`
    : "Access PIN: Use the PIN provided by your photographer.";
  const emailRequirementSummary = project?.email_required
    ? "Email required: Enter the invited email address when opening the gallery."
    : "Email required: Optional unless the photographer asks for it.";

  const collectionCover = useCallback((row: CollectionRow) => {
    const direct = clean(row.cover_photo_url);
    if (direct) return direct;
    const firstMedia = media.find((m) => clean(m.collection_id) === row.id);
    return mediaUrl(firstMedia);
  }, [media]);

  useEffect(() => {
    setShareSubject(gallerySettings.share.emailSubject);
    setShareHeadline(gallerySettings.share.emailHeadline || projectName);
    setShareButtonLabel(gallerySettings.share.emailButtonLabel);
    setShareMessage(gallerySettings.share.emailMessage);
  }, [gallerySettings.share, projectName]);

  async function persistGallerySettings(update: {
    linkedContacts?: EventGalleryLinkedContact[];
    share?: EventGalleryShareSettings;
  }) {
    const nextSettings = normalizeEventGallerySettings({
      ...gallerySettings,
      linkedContacts: update.linkedContacts ?? gallerySettings.linkedContacts,
      share: update.share ?? gallerySettings.share,
    });
    const payload = await requestDashboard<{ project?: ProjectRow | null }>(
      `/api/dashboard/events/${projectId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ gallery_settings: nextSettings }),
      },
    );
    if (payload.project) {
      setProject(payload.project);
    } else {
      setProject((prev) => (prev ? { ...prev, gallery_settings: nextSettings } : prev));
    }
  }

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
    if (!galleryEntryUrl) return;
    try {
      await navigator.clipboard.writeText(galleryEntryUrl);
      setShareNotice("Event link copied");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch {
      setShareNotice("Could not copy link");
      window.setTimeout(() => setShareNotice(""), 2200);
    }
  }

  function openShareComposer(mode: "visitors" | "others") {
    setShareRecipientMode(mode);
    setShareRecipientInput(mode === "visitors" ? visitorEmails.join(", ") : "");
    setShareView("compose");
    setShareModalOpen(true);
  }

  function shareEmailBody() {
    const intro = clean(shareHeadline) || projectName;
    const buttonLabel = clean(shareButtonLabel) || "View Gallery";
    return [
      intro,
      "",
      shareMessage,
      "",
      `Gallery link: ${galleryEntryUrl}`,
      accessSummary,
      emailRequirementSummary,
      "",
      `${buttonLabel}: ${galleryEntryUrl}`,
    ]
      .join("\n")
      .trim();
  }

  async function copyShareMessage() {
    try {
      await navigator.clipboard.writeText(shareEmailBody());
      setShareNotice("Email content copied");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch {
      setShareNotice("Could not copy email content");
      window.setTimeout(() => setShareNotice(""), 2200);
    }
  }

  async function sendShareEmails() {
    setShareSending(true);
    try {
      const payload = await requestDashboard<{
        sent?: number;
        failed?: number;
        recipients?: number;
      }>(`/api/dashboard/events/${projectId}/emails`, {
        method: "POST",
        body: JSON.stringify({
          recipientMode: shareRecipientMode,
          recipients:
            shareRecipientMode === "visitors"
              ? visitorEmails
              : shareRecipientInput
                  .split(",")
                  .map((value) => clean(value))
                  .filter(Boolean),
          subject: clean(shareSubject) || defaultEventGalleryShareSettings.emailSubject,
          headline: clean(shareHeadline) || projectName,
          buttonLabel:
            clean(shareButtonLabel) ||
            defaultEventGalleryShareSettings.emailButtonLabel,
          message: clean(shareMessage) || defaultEventGalleryShareSettings.emailMessage,
        }),
      });

      const sent = payload.sent ?? 0;
      const failed = payload.failed ?? 0;
      const recipients = payload.recipients ?? sent + failed;

      // Close the modal after successful send
      setShareModalOpen(false);
      setShareView("menu");

      if (failed > 0) {
        setShareNotice(`Done — sent ${sent} of ${recipients} emails. ${failed} failed.`);
      } else {
        setShareNotice(`Done — ${sent} email${sent === 1 ? "" : "s"} sent successfully!`);
      }
      window.setTimeout(() => setShareNotice(""), 4000);
    } catch (err) {
      setShareNotice(err instanceof Error ? err.message : "Failed to send emails.");
      window.setTimeout(() => setShareNotice(""), 3200);
    } finally {
      setShareSending(false);
    }
  }

  async function saveShareTemplate() {
    setShareSaving(true);
    try {
      await persistGallerySettings({
        share: {
          emailSubject:
            clean(shareSubject) || defaultEventGalleryShareSettings.emailSubject,
          emailHeadline: clean(shareHeadline),
          emailButtonLabel:
            clean(shareButtonLabel) ||
            defaultEventGalleryShareSettings.emailButtonLabel,
          emailMessage:
            clean(shareMessage) || defaultEventGalleryShareSettings.emailMessage,
        },
      });
      setShareNotice("Share template saved");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save share template.");
    } finally {
      setShareSaving(false);
    }
  }

  function downloadVisitorCsv() {
    const header = ["Visitor", "Status", "Last Activity", "Favorites", "Albums", "Orders"];
    const rows = favoritesSummary.viewers.map((viewer) => [
      viewer.viewerEmail,
      viewerStatusLabel(viewer),
      viewer.lastActivityAt || "",
      String(viewer.favoritesCount),
      viewer.albums.join(" | "),
      "0",
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${projectName.replace(/\s+/g, "-").toLowerCase()}-visitors.csv`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  function viewerStatusLabel(viewer: FavoritesViewerRow) {
    if (viewer.favoritesCount > 0) return "Viewed and favorited";
    if (viewer.openedGallery) return "Opened gallery";
    if (viewer.preRegistered) return "Pre-registered";
    return "Visitor";
  }

  function openFavoritesLibrary(mode: "photos" | "albums" = "photos") {
    setFavoritesLibraryMode(mode);
    setShareView("favorites");
    setShareModalOpen(true);
  }

  async function downloadFavoriteMediaRows(rows: FavoriteMediaRow[]) {
    const items = rows.filter((item) => clean(item.storagePath) || clean(item.previewUrl));
    if (!items.length) {
      setFavoriteLibraryNotice("No favorited photos are ready to download yet.");
      window.setTimeout(() => setFavoriteLibraryNotice(""), 2600);
      return;
    }

    setDownloadingFavoriteMedia(true);
    setFavoriteLibraryNotice("");

    try {
      for (const item of items) {
        const sourceUrl = publicStorageUrl(item.storagePath) || clean(item.previewUrl);
        if (!sourceUrl) continue;
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error(`Download failed for ${item.filename}.`);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = blobUrl;
        anchor.download = clean(item.filename) || `favorite-${item.mediaId}.jpg`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(blobUrl);
      }
      setFavoriteLibraryNotice(`Downloading ${items.length} favorite photo${items.length === 1 ? "" : "s"}.`);
      window.setTimeout(() => setFavoriteLibraryNotice(""), 2600);
    } catch (err) {
      setFavoriteLibraryNotice(err instanceof Error ? err.message : "Could not download favorites.");
      window.setTimeout(() => setFavoriteLibraryNotice(""), 2600);
    } finally {
      setDownloadingFavoriteMedia(false);
    }
  }

  async function saveLinkedContact() {
    const email = clean(contactEmail).toLowerCase();
    if (!email) return;
    setContactSaving(true);
    try {
      const nextContacts = [
        ...linkedContacts,
        {
          id: crypto.randomUUID(),
          name: clean(contactName),
          email,
          role: clean(contactRole) || "Linked Contact",
          labelPhotos: contactLabelPhotos,
          hidePhotos: contactHidePhotos,
          isVip: contactVip,
          note: clean(contactNote),
        },
      ];
      await persistGallerySettings({ linkedContacts: nextContacts });
      setContactModalOpen(false);
      setContactName("");
      setContactEmail("");
      setContactRole("Linked Contact");
      setContactNote("");
      setContactVip(false);
      setContactLabelPhotos(false);
      setContactHidePhotos(false);
      setShareNotice("Linked contact saved");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save linked contact.");
    } finally {
      setContactSaving(false);
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

  const favoriteAlbumCounts = useMemo(() => {
    const next: Record<string, number> = {};
    for (const album of favoritesSummary.albums) {
      next[album.collectionId] = album.favoritesCount;
    }
    return next;
  }, [favoritesSummary.albums]);

  const latestFavoriteAt = favoritesSummary.recentFavorites[0]?.createdAt || null;
  const recentFavoriteItems = favoritesSummary.recentFavorites.slice(0, 3);
  const topViewerItems = favoritesSummary.viewers.slice(0, 3);
  const favoriteMediaItems = favoritesSummary.favoriteMedia;
  const favoriteAlbumItems = favoritesSummary.albums;

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
            <button onClick={() => { setShareView("menu"); setShareModalOpen(true); }} style={{ borderRadius: 10, border: "1px solid #111111", background: "#111111", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Share Gallery</button>
            <Link href={`/dashboard/projects/${projectId}/settings`} style={{ borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, textDecoration: "none" }}>Preview Gallery</Link>
          </div>
        </div>

        {shareNotice ? <div style={{ marginBottom: 14, color: "#b91c1c", fontWeight: 700 }}>{shareNotice}</div> : null}

        <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0,1fr)", gap: 18, alignItems: "start" }}>
          <aside style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 20, padding: 16, position: "sticky", top: 24 }}>
            <div
              onClick={() => {
                setCoverTarget({ type: "project" });
                setCoverPickerTitle("Choose Event Cover Photo");
                setSelectedMediaId(null);
                setCoverPickerOpen(true);
              }}
              style={{ borderRadius: 16, overflow: "hidden", background: projectCover ? `url(${projectCover}) ${Math.round(focalX * 100)}% ${Math.round(focalY * 100)}%/cover no-repeat` : "linear-gradient(135deg,#111111,#4b5563)", aspectRatio: "1.35 / 1", border: "1px solid #e5e7eb", cursor: "pointer", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", opacity: 0, transition: "opacity 0.2s", borderRadius: 16 }} className="hover-overlay" />
              <div style={{ color: "#fff", fontSize: 13, fontWeight: 700, background: "rgba(0,0,0,0.5)", borderRadius: 10, padding: "8px 14px", zIndex: 1 }}>
                <ImagePlus size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
                {projectCover ? "Change Cover" : "Set Cover Photo"}
              </div>
            </div>
            {projectCover && (
              <button
                type="button"
                onClick={() => setFocalEditorOpen(true)}
                style={{ width: "100%", marginTop: 8, padding: "10px 14px", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#111", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>
                Edit Cover Photo
              </button>
            )}
            <div style={{ color: "#4b5563", fontSize: 14, marginTop: 10 }}>Shoot Date: {formatDisplayDate(projectDate)}</div>

            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <Link href={`/dashboard/projects/${projectId}/settings`} style={{ flex: 1, borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#b91c1c", padding: "12px 14px", fontWeight: 800, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
                Gallery Settings
              </Link>
              <Link href={`/dashboard/projects/${projectId}/visitors`} style={{ flex: 1, borderRadius: 10, border: "1px solid #111111", background: "#111", color: "#fff", padding: "12px 14px", fontWeight: 800, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                Visitors
              </Link>
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#111111", marginBottom: 8 }}>Contact</div>
              <button onClick={() => setContactModalOpen(true)} style={{ width: "100%", borderRadius: 10, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 14px", fontWeight: 700, textAlign: "left", cursor: "pointer" }}>
                + Add Linked Contact
              </button>
              {linkedContacts.length ? (
                <div style={{ marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
                  {linkedContacts.slice(0, 4).map((contact) => (
                    <div key={contact.id} style={{ padding: "11px 14px", borderTop: "1px solid #eef2f7" }}>
                      <div style={{ color: "#111111", fontSize: 13, fontWeight: 800 }}>{contact.name || contact.email}</div>
                      <div style={{ color: "#4b5563", fontSize: 12, marginTop: 3 }}>{contact.role || "Linked Contact"} • {contact.email}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ marginTop: 18, border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #e5e7eb", background: "#fff5f5" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111111" }}>Visitor Activity</div>
                <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>
                  {favoritesLoading ? "Loading client activity..." : `Latest favorite: ${formatActivityDate(latestFavoriteAt)}`}
                </div>
              </div>
              {[
                {
                  key: "orders",
                  label: "Orders",
                  value: favoritesSummary.ordersCount,
                  onClick: () => {
                    window.location.href = "/dashboard/orders";
                  },
                },
                {
                  key: "favorites",
                  label: "Favorites",
                  value: favoritesSummary.totalFavorites,
                  onClick: () => openFavoritesLibrary("photos"),
                },
                {
                  key: "favorite-viewers",
                  label: "Favorite Viewers",
                  value: favoritesSummary.uniqueViewers,
                  onClick: () => {
                    setShareView("report");
                    setShareModalOpen(true);
                  },
                },
                {
                  key: "favorite-albums",
                  label: "Albums with Favorites",
                  value: favoritesSummary.albumsWithFavorites,
                  onClick: () => openFavoritesLibrary("albums"),
                },
              ].map((item) => {
                const hovered = hoveredActivityMetric === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={item.onClick}
                    onMouseEnter={() => setHoveredActivityMetric(item.key)}
                    onMouseLeave={() => setHoveredActivityMetric((prev) => (prev === item.key ? null : prev))}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      width: "100%",
                      padding: "10px 14px",
                      border: 0,
                      borderTop: "1px solid #eef2f7",
                      background: hovered ? "#fff5f5" : "#fff",
                      color: hovered ? "#b91c1c" : "#111111",
                      fontSize: 13,
                      cursor: "pointer",
                      transition: "background 0.16s ease, color 0.16s ease",
                    }}
                  >
                    <span>{item.label}</span>
                    <span style={{ fontWeight: 800 }}>{String(item.value)}</span>
                  </button>
                );
              })}
              {favoritesError ? (
                <div style={{ padding: "10px 14px", borderTop: "1px solid #eef2f7", color: "#b42318", fontSize: 12, fontWeight: 700 }}>
                  {favoritesError}
                </div>
              ) : null}
              {!favoritesError && favoritesSummary.warning ? (
                <div style={{ padding: "10px 14px", borderTop: "1px solid #eef2f7", color: "#4b5563", fontSize: 12 }}>
                  {favoritesSummary.warning}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => { setShareView("report"); setShareModalOpen(true); }}
                style={{ width: "100%", textAlign: "left", padding: "11px 14px", border: 0, borderTop: "1px solid #eef2f7", background: "#fff", color: "#111111", fontWeight: 800, cursor: "pointer" }}
              >
                Gallery Visitor Report
              </button>
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111111" }}>Photos</div>
                <button
                  type="button"
                  onClick={() => setPhotoSidebarOpen((prev) => !prev)}
                  style={{
                    borderRadius: 999,
                    border: "1px solid #d0d5dd",
                    background: "#fff",
                    color: "#111111",
                    padding: "6px 10px",
                    fontSize: 12,
                    fontWeight: 800,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                  }}
                >
                  {photoSidebarOpen ? (
                    <>
                      <ChevronUp size={14} />
                      Hide list
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} />
                      Show list
                    </>
                  )}
                </button>
              </div>
              <button onClick={() => setNewAlbumOpen(true)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 10, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 14px", fontWeight: 800, cursor: "pointer" }}>
                <span>Add New Album</span>
                <FolderOpen size={16} />
              </button>

              {photoSidebarOpen ? (
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
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: active ? "#b91c1c" : "#4b5563", whiteSpace: "nowrap" }}>
                            <span>{count}</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: favoriteAlbumCounts[album.id] ? "#b91c1c" : "#98a2b3" }}>
                              <Heart size={11} fill={favoriteAlbumCounts[album.id] ? "currentColor" : "none"} />
                              {favoriteAlbumCounts[album.id] ?? 0}
                            </span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: "11px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#4b5563", fontSize: 13 }}>
                  <span>{albumsCount} album{albumsCount === 1 ? "" : "s"} hidden</span>
                  <span>{mediaCount} photos</span>
                </div>
              )}
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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16, marginBottom: 18 }}>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 18, padding: 16, background: "#fffaf9" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#111111", fontSize: 15, fontWeight: 900 }}>
                      <Heart size={16} style={{ color: "#b91c1c" }} />
                      Recent Client Favorites
                    </div>
                    <div style={{ color: "#4b5563", fontSize: 12, marginTop: 4 }}>
                      {favoritesSummary.totalFavorites
                        ? `${favoritesSummary.totalFavorites} total favorite${favoritesSummary.totalFavorites === 1 ? "" : "s"} across ${favoritesSummary.uniqueViewers} viewer${favoritesSummary.uniqueViewers === 1 ? "" : "s"}`
                        : "Latest hearts from the gallery appear here."}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openFavoritesLibrary("photos")}
                    style={{
                      borderRadius: 999,
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      color: "#111111",
                      padding: "8px 12px",
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    View all favorites
                  </button>
                </div>
                {favoritesLoading ? (
                  <div style={{ color: "#4b5563", fontSize: 14 }}>Loading favorite activity...</div>
                ) : recentFavoriteItems.length === 0 ? (
                  <div style={{ color: "#4b5563", fontSize: 14 }}>No client favorites yet. Hearts from the event gallery will appear here.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {recentFavoriteItems.map((item) => (
                      <div key={`${item.mediaId}-${item.viewerEmail}-${item.createdAt || "recent"}`} style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr)", gap: 10, alignItems: "center" }}>
                        <div style={{ width: 56, height: 56, borderRadius: 12, border: "1px solid #ead7d7", background: item.previewUrl ? `url(${item.previewUrl}) center/cover no-repeat` : "linear-gradient(135deg,#f3f4f6,#e5e7eb)" }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: "#111111", fontWeight: 800, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.filename}</div>
                          <div style={{ color: "#4b5563", fontSize: 12, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.collectionTitle} • {item.viewerEmail}</div>
                          <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 2 }}>{formatActivityDate(item.createdAt)}</div>
                        </div>
                      </div>
                    ))}
                    {favoritesSummary.totalFavorites > recentFavoriteItems.length ? (
                      <button
                        type="button"
                        onClick={() => openFavoritesLibrary("photos")}
                        style={{
                          border: 0,
                          background: "transparent",
                          color: "#b91c1c",
                          padding: 0,
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        Show all {favoritesSummary.totalFavorites} favorites
                      </button>
                    ) : null}
                  </div>
                )}
              </div>

              <div style={{ border: "1px solid #e5e7eb", borderRadius: 18, padding: 16, background: "#fff" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={{ color: "#111111", fontSize: 15, fontWeight: 900 }}>Top Favorite Viewers</div>
                    <div style={{ color: "#4b5563", fontSize: 12, marginTop: 4 }}>
                      Quick summary of the most active client emails.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShareView("report");
                      setShareModalOpen(true);
                    }}
                    style={{
                      borderRadius: 999,
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      color: "#111111",
                      padding: "8px 12px",
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Open report
                  </button>
                </div>
                {favoritesLoading ? (
                  <div style={{ color: "#4b5563", fontSize: 14 }}>Loading viewer activity...</div>
                ) : topViewerItems.length === 0 ? (
                  <div style={{ color: "#4b5563", fontSize: 14 }}>When clients favorite images, their email and album activity will show here.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {topViewerItems.map((viewer) => (
                      <div key={viewer.viewerEmail} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "start", paddingBottom: 10, borderBottom: "1px solid #f1f5f9" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: "#111111", fontWeight: 800, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{viewer.viewerEmail}</div>
                          <div style={{ color: "#4b5563", fontSize: 12, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{viewer.albums.join(", ") || "Album activity pending"}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ color: "#b91c1c", fontWeight: 900, fontSize: 13 }}>{viewer.favoritesCount} fav</div>
                          <div style={{ color: "#4b5563", fontSize: 12, marginTop: 3 }}>{formatActivityDate(viewer.lastActivityAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {filteredCollections.length === 0 ? (
              <div style={{ border: "1px dashed #d0d5dd", borderRadius: 18, padding: 24, color: "#4b5563" }}>{albumSearch ? "No albums found." : "No albums yet."}</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 16 }}>
                {filteredCollections.map((album) => {
                  const albumHref = `/dashboard/projects/${projectId}/albums/${album.id}`;
                  const cover = albumStats[album.id]?.preview || collectionCover(album);
                  const photoCount = albumStats[album.id]?.count ?? 0;
                  const favoriteCount = favoriteAlbumCounts[album.id] ?? 0;
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
                          <div style={{ color: "#4b5563", fontSize: 12, marginTop: 3, display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span>{photoCount} Photos</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: favoriteCount ? "#b91c1c" : "#98a2b3" }}>
                              <Heart size={12} fill={favoriteCount ? "currentColor" : "none"} />
                              {favoriteCount}
                            </span>
                          </div>
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

      {shareModalOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 78, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: shareView === "compose" ? 1280 : shareView === "favorites" ? 1160 : 980, maxHeight: "88vh", overflow: "hidden", background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#111111" }}>
                  {shareView === "menu"
                    ? "Share Gallery"
                    : shareView === "report"
                      ? "Gallery Visitors"
                      : shareView === "favorites"
                        ? favoritesLibraryMode === "albums"
                          ? "Albums with Favorites"
                          : "Favorite Photos"
                        : "Share Gallery with Visitors"}
                </div>
                <div style={{ color: "#4b5563", fontSize: 13, marginTop: 4 }}>
                  {shareView === "menu"
                    ? `Share the ${projectName} gallery`
                    : shareView === "report"
                      ? "View who has opened and favorited this event gallery."
                      : shareView === "favorites"
                        ? "Review the photos clients loved most and download them in one step."
                      : "Compose a gallery email and launch it in your mail app."}
                </div>
              </div>
              <button onClick={() => { setShareModalOpen(false); setShareView("menu"); }} style={{ border: 0, background: "transparent", cursor: "pointer", color: "#6b7280" }}>
                <X size={22} />
              </button>
            </div>

            {shareView === "menu" ? (
              <div style={{ padding: 24, display: "grid", gap: 16 }}>
                <button onClick={() => openShareComposer("visitors")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderRadius: 18, border: "1px solid #e5e7eb", background: "#fff", padding: "18px 20px", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 999, background: "#fff3e8", color: "#f97316", display: "grid", placeItems: "center" }}><Mail size={20} /></div>
                    <div>
                      <div style={{ color: "#111111", fontWeight: 800 }}>Email Gallery Visitors</div>
                      <div style={{ color: "#4b5563", fontSize: 13, marginTop: 4 }}>
                        {visitorEmails.length} registered email{visitorEmails.length === 1 ? "" : "s"} available
                        {favoritesSummary.preRegisteredCount
                          ? ` • ${favoritesSummary.preRegisteredCount} prerelease`
                          : ""}
                      </div>
                    </div>
                  </div>
                  <ExternalLink size={18} color="#6b7280" />
                </button>

                <button onClick={() => openShareComposer("others")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderRadius: 18, border: "1px solid #e5e7eb", background: "#fff", padding: "18px 20px", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 999, background: "#eef2ff", color: "#4f46e5", display: "grid", placeItems: "center" }}><Send size={20} /></div>
                    <div>
                      <div style={{ color: "#111111", fontWeight: 800 }}>Email Others</div>
                      <div style={{ color: "#4b5563", fontSize: 13, marginTop: 4 }}>Compose a gallery email for custom recipients.</div>
                    </div>
                  </div>
                  <ExternalLink size={18} color="#6b7280" />
                </button>

                <button onClick={copyEventLink} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderRadius: 18, border: "1px solid #e5e7eb", background: "#fff", padding: "18px 20px", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 999, background: "#fff1f2", color: "#dc2626", display: "grid", placeItems: "center" }}><Copy size={20} /></div>
                    <div>
                      <div style={{ color: "#111111", fontWeight: 800 }}>Copy Gallery Link</div>
                      <div style={{ color: "#4b5563", fontSize: 13, marginTop: 4 }}>Copies a project-aware event access link.</div>
                    </div>
                  </div>
                  <ExternalLink size={18} color="#6b7280" />
                </button>

                <button onClick={() => setShareView("report")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderRadius: 18, border: "1px solid #e5e7eb", background: "#fff", padding: "18px 20px", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 999, background: "#eff6ff", color: "#0284c7", display: "grid", placeItems: "center" }}><Heart size={20} /></div>
                    <div>
                      <div style={{ color: "#111111", fontWeight: 800 }}>Gallery Visitors</div>
                      <div style={{ color: "#4b5563", fontSize: 13, marginTop: 4 }}>See visitor activity, favorites, and export a quick report.</div>
                    </div>
                  </div>
                  <ExternalLink size={18} color="#6b7280" />
                </button>
              </div>
            ) : shareView === "report" ? (
              <div style={{ padding: 24, overflow: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button onClick={downloadVisitorCsv} style={{ borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "10px 14px", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}><Download size={16} />Download as CSV</button>
                    <button onClick={() => openShareComposer("visitors")} style={{ borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "10px 14px", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}><Mail size={16} />Email</button>
                  </div>
                  <button onClick={() => setContactModalOpen(true)} style={{ borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "10px 14px", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}><UserPlus size={16} />Add Email Address</button>
                </div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.1fr 1fr 1fr 0.7fr 0.7fr", gap: 12, padding: "14px 18px", background: "#f8fafc", color: "#344054", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    <div>Gallery Name</div>
                    <div>Visitor</div>
                    <div>Status</div>
                    <div>Last Activity</div>
                    <div>Favorites</div>
                    <div>Orders</div>
                  </div>
                  {(favoritesSummary.viewers.length ? favoritesSummary.viewers : []).map((viewer) => (
                    <div key={viewer.viewerEmail} style={{ display: "grid", gridTemplateColumns: "1.3fr 1.1fr 1fr 1fr 0.7fr 0.7fr", gap: 12, padding: "16px 18px", borderTop: "1px solid #eef2f7", alignItems: "center", fontSize: 14, color: "#111111" }}>
                      <div>{projectName}</div>
                      <div style={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{viewer.viewerEmail}</div>
                      <div style={{ color: viewer.preRegistered && !viewer.openedGallery && !viewer.favoritesCount ? "#1d4ed8" : "#4b5563", fontWeight: viewer.preRegistered || viewer.openedGallery ? 700 : 500 }}>
                        {viewerStatusLabel(viewer)}
                      </div>
                      <div style={{ color: "#4b5563" }}>
                        {viewer.lastActivityAt ? formatActivityDate(viewer.lastActivityAt) : viewer.preRegistered ? "Waiting for release" : "No activity yet"}
                      </div>
                      <div>{viewer.favoritesCount}</div>
                      <div>-</div>
                    </div>
                  ))}
                  {!favoritesSummary.viewers.length ? (
                    <div style={{ padding: "22px 18px", color: "#4b5563", fontSize: 14 }}>
                      No gallery visitors yet. Once clients register or open the gallery, they will appear here.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : shareView === "favorites" ? (
              <div style={{ padding: 24, overflow: "auto", display: "grid", gap: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "inline-flex", gap: 8, padding: 4, borderRadius: 999, border: "1px solid #e5e7eb", background: "#f8fafc" }}>
                    {[
                      { key: "photos" as const, label: `Favorited Photos (${favoriteMediaItems.length})` },
                      { key: "albums" as const, label: `Albums (${favoriteAlbumItems.length})` },
                    ].map((option) => {
                      const active = favoritesLibraryMode === option.key;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setFavoritesLibraryMode(option.key)}
                          style={{
                            borderRadius: 999,
                            border: 0,
                            background: active ? "#111111" : "transparent",
                            color: active ? "#ffffff" : "#4b5563",
                            padding: "10px 14px",
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {favoritesLibraryMode === "photos" ? (
                      <button
                        type="button"
                        onClick={() => void downloadFavoriteMediaRows(favoriteMediaItems)}
                        disabled={!favoriteMediaItems.length || downloadingFavoriteMedia}
                        style={{
                          borderRadius: 12,
                          border: "1px solid #d0d5dd",
                          background: !favoriteMediaItems.length || downloadingFavoriteMedia ? "#f8fafc" : "#111111",
                          color: !favoriteMediaItems.length || downloadingFavoriteMedia ? "#98a2b3" : "#ffffff",
                          padding: "10px 14px",
                          fontWeight: 800,
                          cursor: !favoriteMediaItems.length || downloadingFavoriteMedia ? "not-allowed" : "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Download size={16} />
                        {downloadingFavoriteMedia ? "Preparing downloads..." : "Download All"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setShareView("report")}
                      style={{ borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}
                    >
                      Open Visitor Report
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 18, padding: 16, background: "#fffaf9" }}>
                    <div style={{ color: "#4b5563", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 800 }}>Favorite Actions</div>
                    <div style={{ color: "#111111", fontSize: 28, fontWeight: 900, marginTop: 8 }}>{favoritesSummary.totalFavorites}</div>
                  </div>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 18, padding: 16, background: "#fff" }}>
                    <div style={{ color: "#4b5563", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 800 }}>Unique Photos</div>
                    <div style={{ color: "#111111", fontSize: 28, fontWeight: 900, marginTop: 8 }}>{favoriteMediaItems.length}</div>
                  </div>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 18, padding: 16, background: "#fff" }}>
                    <div style={{ color: "#4b5563", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 800 }}>Favorite Viewers</div>
                    <div style={{ color: "#111111", fontSize: 28, fontWeight: 900, marginTop: 8 }}>{favoritesSummary.uniqueViewers}</div>
                  </div>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 18, padding: 16, background: "#fff" }}>
                    <div style={{ color: "#4b5563", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 800 }}>Albums with Favorites</div>
                    <div style={{ color: "#111111", fontSize: 28, fontWeight: 900, marginTop: 8 }}>{favoritesSummary.albumsWithFavorites}</div>
                  </div>
                </div>

                {favoriteLibraryNotice ? (
                  <div style={{ borderRadius: 14, border: "1px solid #ead7d7", background: "#fff5f5", color: "#b91c1c", fontSize: 13, fontWeight: 700, padding: "12px 14px" }}>
                    {favoriteLibraryNotice}
                  </div>
                ) : null}

                {favoritesLibraryMode === "photos" ? (
                  favoriteMediaItems.length ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 16 }}>
                      {favoriteMediaItems.map((item) => {
                        const downloadUrl = publicStorageUrl(item.storagePath) || clean(item.previewUrl);
                        return (
                          <div key={item.mediaId} style={{ borderRadius: 20, overflow: "hidden", border: "1px solid #e5e7eb", background: "#fff" }}>
                            <div style={{ aspectRatio: "4 / 5", background: item.previewUrl ? `url(${item.previewUrl}) center/cover no-repeat` : "linear-gradient(135deg,#f3f4f6,#e5e7eb)" }} />
                            <div style={{ padding: 14, display: "grid", gap: 8 }}>
                              <div>
                                <div style={{ color: "#111111", fontSize: 14, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.filename}</div>
                                <div style={{ color: "#4b5563", fontSize: 12, marginTop: 3 }}>{item.collectionTitle}</div>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, color: "#4b5563", fontSize: 12 }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#b91c1c", fontWeight: 800 }}>
                                  <Heart size={12} fill="currentColor" />
                                  {item.favoritesCount}
                                </span>
                                <span>{formatActivityDate(item.latestFavoritedAt)}</span>
                              </div>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {item.collectionId ? (
                                  <Link
                                    href={`/dashboard/projects/${projectId}/albums/${item.collectionId}`}
                                    style={{ borderRadius: 10, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "8px 10px", fontSize: 12, fontWeight: 800, textDecoration: "none" }}
                                  >
                                    Open Album
                                  </Link>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => void downloadFavoriteMediaRows([item])}
                                  disabled={!downloadUrl || downloadingFavoriteMedia}
                                  style={{
                                    borderRadius: 10,
                                    border: "1px solid #111111",
                                    background: "#111111",
                                    color: "#ffffff",
                                    padding: "8px 10px",
                                    fontSize: 12,
                                    fontWeight: 800,
                                    cursor: !downloadUrl || downloadingFavoriteMedia ? "not-allowed" : "pointer",
                                    opacity: !downloadUrl || downloadingFavoriteMedia ? 0.55 : 1,
                                  }}
                                >
                                  Download
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ border: "1px dashed #d0d5dd", borderRadius: 18, padding: 24, color: "#4b5563" }}>
                      No favorited photos yet. Once clients heart images, they will appear here and can be downloaded in one step.
                    </div>
                  )
                ) : favoriteAlbumItems.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 16 }}>
                    {favoriteAlbumItems.map((album) => (
                      <Link
                        key={album.collectionId}
                        href={`/dashboard/projects/${projectId}/albums/${album.collectionId}`}
                        style={{ textDecoration: "none", color: "inherit", borderRadius: 20, overflow: "hidden", border: "1px solid #e5e7eb", background: "#fff" }}
                      >
                        <div style={{ aspectRatio: "16 / 11", background: album.previewUrl ? `url(${album.previewUrl}) center/cover no-repeat` : "linear-gradient(135deg,#f3f4f6,#e5e7eb)" }} />
                        <div style={{ padding: 14, display: "grid", gap: 8 }}>
                          <div style={{ color: "#111111", fontSize: 16, fontWeight: 900 }}>{album.title}</div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, color: "#4b5563", fontSize: 12 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#b91c1c", fontWeight: 800 }}>
                              <Heart size={12} fill="currentColor" />
                              {album.favoritesCount}
                            </span>
                            <span>{formatActivityDate(album.lastFavoritedAt)}</span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div style={{ border: "1px dashed #d0d5dd", borderRadius: 18, padding: 24, color: "#4b5563" }}>
                    No albums have favorites yet.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "340px minmax(0,1fr)", minHeight: 0, flex: 1 }}>
                <div style={{ padding: 20, borderRight: "1px solid #eef2f7", overflow: "auto" }}>
                  <div style={{ display: "grid", gap: 14 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#344054", textTransform: "uppercase", letterSpacing: "0.08em" }}>To</span>
                      {shareRecipientMode === "visitors" ? (
                        <div style={{ borderRadius: 12, border: "1px solid #d0d5dd", background: "#f8fafc", padding: "12px 14px", color: "#111111", fontSize: 14 }}>
                          {visitorEmails.length ? `${visitorEmails.length} gallery visitors` : "No visitor emails yet"}
                        </div>
                      ) : (
                        <textarea value={shareRecipientInput} onChange={(e) => setShareRecipientInput(e.target.value)} placeholder="harout@me.com, client@example.com" style={{ minHeight: 80, width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #d0d5dd", padding: "12px 14px", fontSize: 14, color: "#111111", outline: "none" }} />
                      )}
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#344054", textTransform: "uppercase", letterSpacing: "0.08em" }}>Subject</span>
                      <input value={shareSubject} onChange={(e) => setShareSubject(e.target.value)} style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #d0d5dd", padding: "12px 14px", fontSize: 14, color: "#111111", outline: "none" }} />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#344054", textTransform: "uppercase", letterSpacing: "0.08em" }}>Headline</span>
                      <input value={shareHeadline} onChange={(e) => setShareHeadline(e.target.value)} style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #d0d5dd", padding: "12px 14px", fontSize: 14, color: "#111111", outline: "none" }} />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#344054", textTransform: "uppercase", letterSpacing: "0.08em" }}>Button Text</span>
                      <input value={shareButtonLabel} onChange={(e) => setShareButtonLabel(e.target.value)} style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #d0d5dd", padding: "12px 14px", fontSize: 14, color: "#111111", outline: "none" }} />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#344054", textTransform: "uppercase", letterSpacing: "0.08em" }}>Message</span>
                      <textarea value={shareMessage} onChange={(e) => setShareMessage(e.target.value)} style={{ minHeight: 220, width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #d0d5dd", padding: "12px 14px", fontSize: 14, color: "#111111", outline: "none" }} />
                    </label>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button onClick={saveShareTemplate} disabled={shareSaving} style={{ borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>{shareSaving ? "Saving..." : "Save Template"}</button>
                      <button onClick={copyShareMessage} style={{ borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>Copy Email</button>
                      <button onClick={sendShareEmails} disabled={shareSending} style={{ borderRadius: 12, border: 0, background: "#0f172a", color: "#fff", padding: "10px 14px", fontWeight: 800, cursor: shareSending ? "wait" : "pointer", opacity: shareSending ? 0.7 : 1 }}>
                        {shareSending ? "Sending..." : "Send Emails"}
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ background: "#f3f4f6", overflow: "auto", padding: 20 }}>
                  <div style={{ maxWidth: 420, margin: "0 auto", background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 18px 40px rgba(15,23,42,0.12)" }}>
                    <div style={{ aspectRatio: "1.3 / 1", background: projectCover ? `url(${projectCover}) center/cover no-repeat` : "linear-gradient(135deg,#111111,#4b5563)" }} />
                    <div style={{ padding: 24 }}>
                      <div style={{ color: "#98a2b3", fontSize: 12, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", textAlign: "center" }}>Studio OS</div>
                      <div style={{ marginTop: 18, color: "#111111", fontSize: 28, fontWeight: 900, textAlign: "center" }}>{clean(shareHeadline) || projectName}</div>
                      <div style={{ marginTop: 18, display: "flex", justifyContent: "center" }}>
                        <div style={{ borderRadius: 999, background: "#111111", color: "#fff", padding: "12px 22px", fontSize: 12, fontWeight: 800 }}>{clean(shareButtonLabel) || "View Gallery"}</div>
                      </div>
                      <div style={{ marginTop: 22, borderRadius: 16, background: "#f8fafc", padding: 18, color: "#344054", fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-line" }}>
                        {shareMessage}
                        {"\n\n"}
                        {accessSummary}
                        {"\n"}
                        {emailRequirementSummary}
                        {"\n"}
                        {galleryEntryUrl}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {contactModalOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 76, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 560, background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", overflow: "hidden" }}>
            <div style={{ padding: "20px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#111111" }}>Add Linked Contact</div>
              <div style={{ color: "#4b5563", marginTop: 4 }}>Keep a VIP, client rep, or proofing helper attached to this event.</div>
            </div>
            <div style={{ padding: 22, display: "grid", gap: 14 }}>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact name" style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "14px 16px", fontSize: 15, color: "#111111", outline: "none" }} />
              <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Email address" style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "14px 16px", fontSize: 15, color: "#111111", outline: "none" }} />
              <input value={contactRole} onChange={(e) => setContactRole(e.target.value)} placeholder="Role" style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "14px 16px", fontSize: 15, color: "#111111", outline: "none" }} />
              <textarea value={contactNote} onChange={(e) => setContactNote(e.target.value)} placeholder="Internal notes" style={{ minHeight: 90, width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "14px 16px", fontSize: 15, color: "#111111", outline: "none" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#111111", fontWeight: 700 }}><input type="checkbox" checked={contactVip} onChange={(e) => setContactVip(e.target.checked)} /> VIP / Admin contact</label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#111111", fontWeight: 700 }}><input type="checkbox" checked={contactLabelPhotos} onChange={(e) => setContactLabelPhotos(e.target.checked)} /> Can help label or shortlist photos</label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#111111", fontWeight: 700 }}><input type="checkbox" checked={contactHidePhotos} onChange={(e) => setContactHidePhotos(e.target.checked)} /> Can request hidden photos</label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7" }}>
              <button onClick={() => setContactModalOpen(false)} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveLinkedContact} disabled={!clean(contactEmail) || contactSaving} style={{ borderRadius: 14, border: 0, background: !clean(contactEmail) || contactSaving ? "#cbd5e1" : "#0f172a", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: !clean(contactEmail) || contactSaving ? "not-allowed" : "pointer" }}>{contactSaving ? "Saving..." : "Save contact"}</button>
            </div>
          </div>
        </div>
      ) : null}

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

      {/* ── Focal Point Editor Modal ── */}
      {focalEditorOpen && projectCover ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "#fff", borderRadius: 20, width: "90%", maxWidth: 680, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
            {/* Header */}
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#111" }}>Edit Cover Photo</h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>Adjust the focal point to control how the cover photo is cropped.</p>
              </div>
              <button onClick={() => setFocalEditorOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#6b7280" }}>
                <X size={20} />
              </button>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {/* Image with focal point */}
            <div style={{ padding: "24px 24px 16px", display: "flex", justifyContent: "center" }}>
              <div
                style={{ position: "relative", width: "100%", maxWidth: 600, cursor: "crosshair", borderRadius: 12, overflow: "hidden", border: "1px solid #e5e7eb" }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                  setFocalX(x);
                  setFocalY(y);
                }}
              >
                <img
                  src={projectCover}
                  alt="Cover"
                  draggable={false}
                  style={{ width: "100%", maxHeight: "50vh", objectFit: "contain", display: "block", userSelect: "none" }}
                />
                {/* Focal point indicator */}
                <div
                  style={{
                    position: "absolute",
                    left: `${focalX * 100}%`,
                    top: `${focalY * 100}%`,
                    transform: "translate(-50%, -50%)",
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    border: "3px solid #fff",
                    boxShadow: "0 0 0 2px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(0,0,0,0.2)",
                    pointerEvents: "none",
                    transition: "left 0.1s, top 0.1s",
                  }}
                >
                  <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(255,255,255,0.25)" }} />
                  {/* Crosshair lines */}
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.8)", transform: "translateX(-50%)" }} />
                  <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.8)", transform: "translateY(-50%)" }} />
                </div>
              </div>
            </div>

            {/* Preview strip */}
            <div style={{ padding: "0 24px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", marginBottom: 6 }}>Crop preview</div>
              <div style={{ width: "100%", height: 80, borderRadius: 10, overflow: "hidden", border: "1px solid #e5e7eb", backgroundImage: `url(${projectCover})`, backgroundSize: "cover", backgroundPosition: `${Math.round(focalX * 100)}% ${Math.round(focalY * 100)}%` }} />
            </div>
            </div>{/* end scrollable body */}

            {/* Footer */}
            <div style={{ padding: "16px 24px 20px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: 12, flexShrink: 0 }}>
              <button
                onClick={() => setFocalEditorOpen(false)}
                style={{ borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#344054", padding: "12px 20px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}
              >
                Cancel
              </button>
              <button
                disabled={savingFocal}
                onClick={async () => {
                  setSavingFocal(true);
                  try {
                    const res = await fetch(`/api/dashboard/events/${projectId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ cover_focal_x: focalX, cover_focal_y: focalY }),
                    });
                    if (!res.ok) throw new Error("Failed to save focal point");
                    setFocalEditorOpen(false);
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "Failed to save");
                  } finally {
                    setSavingFocal(false);
                  }
                }}
                style={{ borderRadius: 12, border: 0, background: savingFocal ? "#94a3b8" : "#0f172a", color: "#fff", padding: "12px 24px", fontWeight: 700, cursor: savingFocal ? "not-allowed" : "pointer", fontSize: 14 }}
              >
                {savingFocal ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
