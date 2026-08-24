"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Images,
  Trash2,
  X,
} from "lucide-react";
import { extractStoragePathFromSupabaseUrl } from "@/lib/storage-images";

export type GalleryPhotoAsset = {
  key: string;
  name: string;
  url: string;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function originalKeyFromVariant(key: string) {
  return key.replace(/_(preview|thumbnail|cutout|nobg)\.[^./]+$/i, ".jpg");
}

function logicalPhotoKey(key: string) {
  return originalKeyFromVariant(key)
    .replace(/\.[^./]+$/i, "")
    .toLowerCase();
}

export function photoAssetFromStoredReference(
  reference: string | null | undefined,
  fallbackName?: string | null,
): GalleryPhotoAsset | null {
  const url = clean(reference);
  if (!url) return null;

  const extractedKey = extractStoragePathFromSupabaseUrl(url);
  if (!extractedKey) return null;
  const key = originalKeyFromVariant(extractedKey);
  const name =
    clean(fallbackName) ||
    decodeURIComponent(key.split("/").filter(Boolean).at(-1) || "photo.jpg");

  return { key, name, url };
}

export function dedupeGalleryPhotoAssets(
  assets: Array<GalleryPhotoAsset | null | undefined>,
) {
  const deduped = new Map<string, GalleryPhotoAsset>();

  for (const asset of assets) {
    if (!asset) continue;
    const key = originalKeyFromVariant(clean(asset.key));
    const url = clean(asset.url);
    if (!key || !url) continue;
    const normalized: GalleryPhotoAsset = {
      key,
      name:
        clean(asset.name) ||
        decodeURIComponent(key.split("/").filter(Boolean).at(-1) || "photo.jpg"),
      url,
    };
    const identity = logicalPhotoKey(key);
    if (!deduped.has(identity)) deduped.set(identity, normalized);
  }

  return Array.from(deduped.values());
}

type StudentPhotoLightboxProps = {
  personName: string;
  photos: GalleryPhotoAsset[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onRemoveSelected: (keys: string[]) => Promise<GalleryPhotoAsset[]>;
};

export function StudentPhotoLightbox({
  personName,
  photos,
  index,
  onIndexChange,
  onClose,
  onRemoveSelected,
}: StudentPhotoLightboxProps) {
  const [selecting, setSelecting] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const cancelConfirmRef = useRef<HTMLButtonElement | null>(null);

  const safeIndex = Math.max(0, Math.min(index, Math.max(photos.length - 1, 0)));
  const currentPhoto = photos[safeIndex];
  const selectedCount = selectedKeys.length;

  useEffect(() => {
    if (index !== safeIndex) onIndexChange(safeIndex);
  }, [index, onIndexChange, safeIndex]);

  useEffect(() => {
    setSelectedKeys((current) =>
      current.filter((key) => photos.some((photo) => photo.key === key)),
    );
  }, [photos]);

  useEffect(() => {
    if (confirming) cancelConfirmRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (removing) return;
      if (event.key === "Escape") {
        if (confirming) {
          setConfirming(false);
        } else if (selecting) {
          setSelecting(false);
          setSelectedKeys([]);
          setRemoveError("");
        } else {
          onClose();
        }
        return;
      }

      if (confirming || selecting) return;
      if (event.key === "ArrowLeft" && safeIndex > 0) {
        onIndexChange(safeIndex - 1);
      }
      if (event.key === "ArrowRight" && safeIndex < photos.length - 1) {
        onIndexChange(safeIndex + 1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirming, onClose, onIndexChange, photos.length, removing, safeIndex, selecting]);

  function closeViewer() {
    if (removing) return;
    setSelecting(false);
    setSelectedKeys([]);
    setRemoveError("");
    onClose();
  }

  function cancelSelection() {
    if (removing) return;
    setSelecting(false);
    setSelectedKeys([]);
    setRemoveError("");
  }

  function togglePhoto(photo: GalleryPhotoAsset) {
    setRemoveError("");
    setSelectedKeys((current) =>
      current.includes(photo.key)
        ? current.filter((key) => key !== photo.key)
        : [...current, photo.key],
    );
  }

  async function confirmRemoval() {
    if (!selectedKeys.length || removing) return;
    setRemoving(true);
    setRemoveError("");

    try {
      const remainingPhotos = await onRemoveSelected(selectedKeys);
      setConfirming(false);
      setSelecting(false);
      setSelectedKeys([]);
      if (!remainingPhotos.length) {
        onClose();
        return;
      }
      onIndexChange(Math.min(safeIndex, remainingPhotos.length - 1));
    } catch (error) {
      setConfirming(false);
      setRemoveError(
        error instanceof Error
          ? error.message
          : "The selected photos could not be removed. Please try again.",
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <div
        onClick={closeViewer}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.9)",
          zIndex: 200,
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${personName} photos`}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 201,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            color: "#fff",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{personName}</div>
            <div
              aria-live="polite"
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.72)",
                marginTop: 4,
              }}
            >
              {selecting
                ? `${selectedCount} selected`
                : photos.length
                  ? `${safeIndex + 1} of ${photos.length}`
                  : "No photos"}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {selecting ? (
              <>
                <button
                  type="button"
                  onClick={cancelSelection}
                  disabled={removing}
                  style={{
                    border: "1px solid rgba(255,255,255,0.3)",
                    background: "rgba(255,255,255,0.08)",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "9px 13px",
                    fontWeight: 800,
                    cursor: removing ? "default" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={!selectedCount || removing}
                  style={{
                    border: "1px solid #ef4444",
                    background: selectedCount ? "#dc2626" : "rgba(127,29,29,0.45)",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "9px 13px",
                    fontWeight: 900,
                    cursor: selectedCount && !removing ? "pointer" : "default",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    opacity: selectedCount ? 1 : 0.55,
                  }}
                >
                  <Trash2 size={16} /> Remove selected ({selectedCount})
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSelecting(true);
                  setRemoveError("");
                }}
                disabled={!photos.length}
                style={{
                  border: "1px solid rgba(255,255,255,0.3)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  borderRadius: 10,
                  padding: "9px 13px",
                  fontWeight: 800,
                  cursor: photos.length ? "pointer" : "default",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  opacity: photos.length ? 1 : 0.5,
                }}
              >
                <Images size={16} /> Select photos
              </button>
            )}

            <button
              type="button"
              onClick={closeViewer}
              disabled={removing}
              aria-label="Close photo viewer"
              style={{
                background: "none",
                border: "none",
                color: "#fff",
                cursor: removing ? "default" : "pointer",
                padding: 6,
              }}
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {removeError ? (
          <div
            role="alert"
            style={{
              alignSelf: "center",
              margin: "0 18px 8px",
              maxWidth: 720,
              borderRadius: 10,
              border: "1px solid rgba(248,113,113,0.6)",
              background: "rgba(127,29,29,0.78)",
              color: "#fff",
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {removeError}
          </div>
        ) : null}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px 24px",
            gap: 16,
          }}
        >
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => onIndexChange(Math.max(0, safeIndex - 1))}
            disabled={selecting || safeIndex === 0}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.1)",
              color: "#fff",
              cursor: !selecting && safeIndex > 0 ? "pointer" : "default",
              opacity: !selecting && safeIndex > 0 ? 1 : 0.3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ChevronLeft size={22} />
          </button>

          <div
            style={{
              maxWidth: "min(1000px, 75vw)",
              maxHeight: "70vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {currentPhoto ? (
              <img
                src={currentPhoto.url}
                alt={`${personName}, photo ${safeIndex + 1}`}
                style={{
                  maxWidth: "100%",
                  maxHeight: "70vh",
                  objectFit: "contain",
                  borderRadius: 18,
                  boxShadow: "0 30px 80px rgba(0,0,0,0.4)",
                }}
              />
            ) : (
              <div
                style={{
                  width: 400,
                  height: 500,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px dashed rgba(255,255,255,0.25)",
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "rgba(255,255,255,0.6)",
                }}
              >
                No photo available
              </div>
            )}
          </div>

          <button
            type="button"
            aria-label="Next photo"
            onClick={() =>
              onIndexChange(Math.min(photos.length - 1, safeIndex + 1))
            }
            disabled={selecting || safeIndex >= photos.length - 1}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.1)",
              color: "#fff",
              cursor:
                !selecting && safeIndex < photos.length - 1
                  ? "pointer"
                  : "default",
              opacity: !selecting && safeIndex < photos.length - 1 ? 1 : 0.3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ChevronRight size={22} />
          </button>
        </div>

        <div
          aria-label="Photo thumbnails"
          style={{
            padding: "16px 24px 24px",
            display: "flex",
            justifyContent: "center",
            gap: 10,
            overflowX: "auto",
          }}
        >
          {photos.map((photo, photoIndex) => {
            const selected = selectedKeys.includes(photo.key);
            const active = photoIndex === safeIndex;
            return (
              <button
                key={photo.key}
                type="button"
                aria-label={`${selecting ? (selected ? "Deselect" : "Select") : "View"} photo ${photoIndex + 1}`}
                aria-pressed={selecting ? selected : active}
                onClick={() => {
                  if (selecting) {
                    togglePhoto(photo);
                    return;
                  }
                  onIndexChange(photoIndex);
                }}
                style={{
                  position: "relative",
                  border: selected
                    ? "3px solid #ef4444"
                    : active
                      ? "2px solid #fff"
                      : "1px solid rgba(255,255,255,0.2)",
                  background: "none",
                  padding: 0,
                  borderRadius: 7,
                  overflow: "hidden",
                  width: 72,
                  height: 90,
                  flexShrink: 0,
                  cursor: "pointer",
                  opacity: selected || active ? 1 : 0.72,
                }}
              >
                <img
                  src={photo.url}
                  alt={`${personName} ${photoIndex + 1}`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
                {selecting ? (
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      top: 5,
                      right: 5,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      border: selected
                        ? "2px solid #fff"
                        : "2px solid rgba(255,255,255,0.9)",
                      background: selected ? "#dc2626" : "rgba(15,23,42,0.65)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                    }}
                  >
                    {selected ? <Check size={14} strokeWidth={3} /> : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {confirming ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-gallery-photos-title"
          aria-describedby="remove-gallery-photos-description"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 220,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "rgba(2,6,23,0.55)",
          }}
        >
          <div
            style={{
              width: "min(500px, 100%)",
              borderRadius: 20,
              background: "#fff",
              color: "#111827",
              padding: 24,
              boxShadow: "0 30px 90px rgba(0,0,0,0.42)",
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#fee2e2",
                color: "#b91c1c",
                marginBottom: 16,
              }}
            >
              <Trash2 size={22} />
            </div>
            <h2
              id="remove-gallery-photos-title"
              style={{ fontSize: 21, lineHeight: 1.25, margin: 0, fontWeight: 900 }}
            >
              Remove from online gallery?
            </h2>
            <p
              id="remove-gallery-photos-description"
              style={{ color: "#475467", lineHeight: 1.55, margin: "10px 0 0" }}
            >
              Remove {selectedCount} selected photo{selectedCount === 1 ? "" : "s"} from {personName}&apos;s online gallery? Originals remain on the photographer&apos;s computer. Cloud Sync will honor this choice and will not restore {selectedCount === 1 ? "it" : "them"} to this gallery.
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 24,
              }}
            >
              <button
                ref={cancelConfirmRef}
                type="button"
                onClick={() => setConfirming(false)}
                disabled={removing}
                style={{
                  borderRadius: 10,
                  border: "1px solid #d0d5dd",
                  background: "#fff",
                  color: "#344054",
                  padding: "10px 14px",
                  fontWeight: 800,
                  cursor: removing ? "default" : "pointer",
                }}
              >
                Keep photos
              </button>
              <button
                type="button"
                onClick={() => void confirmRemoval()}
                disabled={removing}
                style={{
                  borderRadius: 10,
                  border: "1px solid #b91c1c",
                  background: "#dc2626",
                  color: "#fff",
                  padding: "10px 14px",
                  fontWeight: 900,
                  cursor: removing ? "default" : "pointer",
                  opacity: removing ? 0.7 : 1,
                }}
              >
                {removing
                  ? "Removing..."
                  : `Remove ${selectedCount} photo${selectedCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
