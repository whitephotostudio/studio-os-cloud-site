"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Download, FileArchive, LoaderCircle } from "lucide-react";
import {
  eventGalleryDownloadManifestStorageKey,
  type EventGalleryDownloadManifest,
} from "@/lib/event-gallery-downloads";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function readStoredManifest(manifestId: string) {
  if (typeof window === "undefined") return null;
  const storageKey = eventGalleryDownloadManifestStorageKey(manifestId);
  if (!storageKey) return null;

  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as EventGalleryDownloadManifest;
  } catch {
    return null;
  }
}

function formatTime(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function triggerBatchDownload(url: string, fileName: string) {
  if (typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export default function ParentGalleryDownloadsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pin = decodeURIComponent(String(params.pin ?? ""));
  const manifestId = clean(searchParams.get("manifest"));

  const [manifest, setManifest] = useState<EventGalleryDownloadManifest | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "expired">("loading");
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadedBatchCount, setDownloadedBatchCount] = useState(0);
  const [downloadNotice, setDownloadNotice] = useState("");

  useEffect(() => {
    const nextManifest = readStoredManifest(manifestId);
    if (!nextManifest) {
      setManifest(null);
      setStatus("missing");
      return;
    }

    if (Date.parse(nextManifest.expiresAt) <= Date.now()) {
      setManifest(nextManifest);
      setStatus("expired");
      return;
    }

    setManifest(nextManifest);
    setStatus("ready");
  }, [manifestId]);

  const backHref = useMemo(() => {
    if (manifest?.returnUrl) return manifest.returnUrl;
    return `/parents/${encodeURIComponent(pin)}`;
  }, [manifest?.returnUrl, pin]);

  const headerTitle =
    status === "ready"
      ? "Zip Files Ready"
      : status === "expired"
        ? "Download Session Expired"
        : "Download Files";

  async function handleDownloadAllBatches() {
    if (!manifest || downloadingAll) return;
    setDownloadingAll(true);
    setDownloadedBatchCount(0);
    setDownloadNotice("");

    try {
      for (let index = 0; index < manifest.batches.length; index += 1) {
        const batch = manifest.batches[index];
        triggerBatchDownload(
          `/api/portal/event-download-batch?token=${encodeURIComponent(batch.token)}`,
          batch.fileName,
        );
        setDownloadedBatchCount(index + 1);
        if (index < manifest.batches.length - 1) {
          await wait(1400);
        }
      }

      setDownloadNotice(
        manifest.batchCount === 1
          ? "Your ZIP download has started."
          : `Started ${manifest.batchCount} ZIP downloads. Your browser may ask you to allow multiple downloads.`,
      );
    } catch {
      setDownloadNotice("Could not start all ZIP downloads automatically.");
    } finally {
      setDownloadingAll(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f6f3ef 0%, #ffffff 42%, #f7f7f5 100%)",
        color: "#161616",
        padding: "32px 20px 48px",
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <button
          type="button"
          onClick={() => router.push(backHref)}
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            border: "none",
            background: "transparent",
            color: "#6b635b",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <ArrowLeft size={15} />
          Back To Gallery
        </button>

        <section
          style={{
            background: "#ffffff",
            border: "1px solid rgba(22,22,22,0.08)",
            borderRadius: 26,
            padding: "28px 24px",
            boxShadow: "0 18px 48px rgba(17, 17, 17, 0.08)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  background: "#111111",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                {status === "ready" ? <FileArchive size={24} /> : <AlertCircle size={24} />}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#8a837c",
                  }}
                >
                  {manifest?.galleryName || "Event Gallery"}
                </div>
                <h1
                  style={{
                    margin: "4px 0 0",
                    fontSize: "clamp(28px, 5vw, 40px)",
                    lineHeight: 1.05,
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                  }}
                >
                  {headerTitle}
                </h1>
              </div>
            </div>

            {status === "ready" && manifest ? (
              <>
                <p
                  style={{
                    margin: 0,
                    fontSize: 16,
                    lineHeight: 1.6,
                    color: "#4f4740",
                  }}
                >
                  Your gallery is split into smaller ZIP files so the downloads stay faster and
                  more reliable on large collections.
                </p>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    color: "#5b544d",
                    fontSize: 14,
                  }}
                >
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 14px",
                      borderRadius: 999,
                      background: "#f5f2ee",
                    }}
                  >
                    <FileArchive size={15} />
                    {manifest.batchCount} ZIP {manifest.batchCount === 1 ? "file" : "files"}
                  </div>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 14px",
                      borderRadius: 999,
                      background: "#f5f2ee",
                    }}
                  >
                    <Download size={15} />
                    {manifest.photoCount} photo{manifest.photoCount === 1 ? "" : "s"}
                  </div>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 14px",
                      borderRadius: 999,
                      background: "#f5f2ee",
                    }}
                  >
                    <Clock3 size={15} />
                    Ready until {formatTime(manifest.expiresAt)}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void handleDownloadAllBatches()}
                    disabled={downloadingAll}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 10,
                      border: "none",
                      borderRadius: 999,
                      background: "#111111",
                      color: "#fff",
                      padding: "14px 20px",
                      fontSize: 14,
                      fontWeight: 800,
                      cursor: downloadingAll ? "default" : "pointer",
                      opacity: downloadingAll ? 0.8 : 1,
                    }}
                  >
                    {downloadingAll ? <LoaderCircle size={16} /> : <Download size={16} />}
                    {downloadingAll
                      ? `Starting ZIP ${Math.max(1, downloadedBatchCount)} of ${manifest.batchCount}`
                      : manifest.batchCount === 1
                        ? "Download ZIP File"
                        : `Download All ${manifest.batchCount} ZIP Files`}
                  </button>

                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: "#655d56",
                      maxWidth: 430,
                    }}
                  >
                    One click will start each ZIP automatically. For very large galleries, your browser may ask for permission to allow multiple downloads.
                  </div>
                </div>

                {downloadNotice ? (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 16,
                      background: "#eef7ee",
                      color: "#245c2f",
                      padding: "12px 14px",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    <CheckCircle2 size={16} />
                    {downloadNotice}
                  </div>
                ) : null}

                {manifest.photoCount < manifest.requestedPhotoCount ? (
                  <div
                    style={{
                      borderRadius: 18,
                      background: "#fcf5e8",
                      color: "#7b5b20",
                      padding: "14px 16px",
                      fontSize: 14,
                      lineHeight: 1.5,
                    }}
                  >
                    {manifest.photoCount} of {manifest.requestedPhotoCount} requested photos were
                    included because this gallery&apos;s free download limit was reached.
                  </div>
                ) : null}

                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    marginTop: 4,
                  }}
                >
                  {manifest.batches.map((batch) => (
                    <a
                      key={batch.id}
                      href={`/api/portal/event-download-batch?token=${encodeURIComponent(batch.token)}`}
                      download={batch.fileName}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 16,
                        padding: "18px 18px",
                        borderRadius: 20,
                        border: "1px solid rgba(22,22,22,0.08)",
                        background: "#fbfaf8",
                        color: "inherit",
                        textDecoration: "none",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: 14,
                            background: "#111111",
                            color: "#fff",
                            display: "grid",
                            placeItems: "center",
                            flexShrink: 0,
                          }}
                        >
                          <FileArchive size={20} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 17,
                              fontWeight: 700,
                              color: "#161616",
                            }}
                          >
                            {batch.label}
                          </div>
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 14,
                              color: "#66605a",
                            }}
                          >
                            {batch.photoCount} photo{batch.photoCount === 1 ? "" : "s"} inside
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          borderRadius: 999,
                          padding: "11px 16px",
                          background: "#111111",
                          color: "#fff",
                          fontSize: 13,
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Download size={15} />
                        Download
                      </div>
                    </a>
                  ))}
                </div>
              </>
            ) : (
              <div
                style={{
                  borderRadius: 18,
                  background: "#fbfaf8",
                  border: "1px solid rgba(22,22,22,0.08)",
                  padding: "18px 18px",
                  color: "#544d47",
                  fontSize: 15,
                  lineHeight: 1.6,
                }}
              >
                {status === "loading"
                  ? "Checking your gallery download session..."
                  : status === "expired"
                    ? "This prepared download session expired. Go back to the gallery and press Download All again to build fresh ZIP files."
                    : "This download page could not find its prepared ZIP files. Go back to the gallery and press Download All again."}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
