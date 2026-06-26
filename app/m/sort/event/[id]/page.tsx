"use client";

// Sort & Review — event photo grid (/m/sort/event/[id])
//
// Events store photos in `media` (by album), not a student roster — so this is
// a flat photo grid with delete, plus a prominent "Show QR" button at the top
// so a client can scan the photographer's phone and open their gallery.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, QrCode as QrIcon, Share2, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { proxiedPhotoUrl } from "@/lib/photo-url";
import QrCode from "@/components/qr-code";

type Photo = { id: string; key: string; name: string; albumId: string };

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

export default function SortEventPage() {
  const params = useParams();
  const rawId = (params as Record<string, string | string[]>)?.id;
  const projectId = Array.isArray(rawId) ? rawId[0] : clean(rawId);

  const [supabase] = useState(() => createClient());
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [accessPin, setAccessPin] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId) {
        setLoading(false);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: pg } = await supabase
        .from("photographers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!pg?.id || cancelled) return;
      const { data: proj } = await supabase
        .from("projects")
        .select("id, title, gallery_slug, access_pin, access_mode")
        .eq("id", projectId)
        .eq("photographer_id", pg.id)
        .maybeSingle();
      if (cancelled) return;
      if (!proj) {
        setLoading(false);
        return;
      }
      setTitle(clean((proj as { title: string | null }).title) || "Event");
      setSlug(clean((proj as { gallery_slug: string | null }).gallery_slug));
      const accessMode = clean((proj as { access_mode: string | null }).access_mode);
      const pin = clean((proj as { access_pin: string | null }).access_pin);
      setAccessPin(accessMode === "pin" && pin ? pin : "");
      try {
        const res = await fetch("/api/dashboard/capture/event-list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          photos?: Photo[];
        };
        if (!cancelled) setPhotos(res.ok && json.ok ? json.photos ?? [] : []);
      } catch {
        if (!cancelled) setPhotos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, projectId]);

  function galleryUrl() {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (slug) return `${origin}/g/${slug}`;
    return `${origin}/parents?mode=event&project=${projectId}`;
  }

  async function shareGallery() {
    const url = galleryUrl();
    const label = title || "Gallery";
    const message = accessPin
      ? `${label} — view the photos at ${url}\nAccess PIN: ${accessPin}`
      : `${label} — view the photos at ${url}`;
    try {
      const nav = navigator as Navigator & {
        share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
      };
      if (nav.share) {
        await nav.share({ title: label, text: message, url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(message);
        window.alert("Link and PIN copied — paste into an email or text.");
      }
    } catch {
      /* user cancelled the share sheet, or sharing is unavailable */
    }
  }

  async function deletePhoto(p: Photo) {
    if (
      !window.confirm(
        "Delete this photo? This removes it from the gallery permanently.",
      )
    ) {
      return;
    }
    setDeletingId(p.id);
    try {
      const res = await fetch("/api/dashboard/capture/event-photo-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, mediaId: p.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && json.ok) {
        setPhotos((prev) => prev.filter((x) => x.id !== p.id));
      } else {
        window.alert(json.error || "Could not delete the photo.");
      }
    } catch {
      window.alert("Could not delete the photo.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <Link
        href="/m/sort"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "#6b7280",
          fontSize: 13,
          fontWeight: 700,
          textDecoration: "none",
          marginBottom: 10,
        }}
      >
        <ArrowLeft size={15} /> Sort
      </Link>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#111827" }}>
        {title || "Event"}
      </div>
      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2, marginBottom: 12 }}>
        {loading ? "Loading photos…" : `${photos.length} photo${photos.length === 1 ? "" : "s"}`} · tap a photo to delete.
      </div>

      {/* QR — show to clients to scan */}
      <button
        type="button"
        onClick={() => setShowQr(true)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          borderRadius: 14,
          border: "1px solid #1d4ed8",
          background: "#eff6ff",
          color: "#1d4ed8",
          padding: "13px",
          fontSize: 15,
          fontWeight: 800,
          cursor: "pointer",
          marginBottom: 16,
        }}
      >
        <QrIcon size={18} /> Show QR for clients to scan
      </button>

      {loading ? null : photos.length === 0 ? (
        <div style={{ fontSize: 13, color: "#9ca3af", padding: 12 }}>
          No photos in this event yet.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {photos.map((p) => (
            <div
              key={p.id}
              style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 10, overflow: "hidden", background: "#f3f4f6" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${proxiedPhotoUrl(p.key)}?w=400`}
                alt=""
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <button
                type="button"
                onClick={() => void deletePhoto(p)}
                disabled={deletingId === p.id}
                aria-label="Delete photo"
                style={{
                  position: "absolute",
                  top: 5,
                  right: 5,
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: "none",
                  background: "rgba(204,0,0,0.92)",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  cursor: deletingId === p.id ? "default" : "pointer",
                  opacity: deletingId === p.id ? 0.6 : 1,
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showQr ? (
        <div
          onClick={() => setShowQr(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: 22,
              maxWidth: 340,
              width: "100%",
              textAlign: "center",
              position: "relative",
            }}
          >
            <button
              type="button"
              onClick={() => setShowQr(false)}
              aria-label="Close"
              style={{ position: "absolute", top: 12, right: 12, background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", padding: 0 }}
            >
              <X size={22} />
            </button>
            <div style={{ fontSize: 17, fontWeight: 900, color: "#111827", marginBottom: 4 }}>
              {title || "Event"}
            </div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
              Clients scan this to open the gallery
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ background: "#fff", padding: 10, borderRadius: 14, border: "1px solid #e5e7eb" }}>
                <QrCode value={galleryUrl()} size={250} />
              </div>
            </div>
            {accessPin ? (
              <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 14, background: "#fff7ed", border: "1px solid #fed7aa" }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#c2410c" }}>
                  Access PIN
                </div>
                <div style={{ fontSize: 30, fontWeight: 900, color: "#9a3412", letterSpacing: "0.18em", marginTop: 4, fontFamily: "ui-monospace, monospace" }}>
                  {accessPin}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void shareGallery()}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                marginTop: 16,
                borderRadius: 12,
                border: "none",
                background: "#111827",
                color: "#fff",
                padding: "13px",
                fontSize: 15,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              <Share2 size={16} /> Share link &amp; PIN
            </button>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 14, wordBreak: "break-all", fontFamily: "ui-monospace, monospace" }}>
              {galleryUrl()}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
