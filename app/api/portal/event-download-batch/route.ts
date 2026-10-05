import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  createEventCollectionDownloadGrant,
  createEventProjectDownloadGrant,
  verifyEventGalleryBatchToken,
  type EventGalleryBatchTokenPayload,
} from "@/lib/event-gallery-download-tokens";
import {
  buildSignedMediaUrls,
  SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
} from "@/lib/storage-images";
import { fetchEventProjectCollections } from "@/lib/event-download-scope";
import { validateUuid, validateUuidArray } from "@/lib/request-validation";
import { authorizeEventMediaToken, transformEventImage } from "@/lib/event-media-delivery";
import { galleryZipBatchSize } from "@/lib/event-gallery-downloads";
import { reserveGalleryDownload, finishGalleryDownload } from "@/lib/gallery-download-quota";
import { recordAfterZipCompletion } from "@/lib/gallery-download-quota-stream";
import { createZipStream, type ZipStreamEntry } from "@/lib/zip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Hard upper bound for legacy or tampered tokens. The ZIP response streams now,
// so larger professional batches are safe, but we still cap untrusted token
// payloads to prevent one request from tying up a function for too long.
const MAX_MEDIA_PER_BATCH = 800;
const MEDIA_LOOKUP_CHUNK_SIZE = 100;

type MediaRow = {
  id: string;
  collection_id: string | null;
  storage_path: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  filename: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function safeZipFileName(value: string | null | undefined) {
  const cleaned = clean(value)
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const fileName = cleaned || "gallery-download.zip";
  return fileName.toLowerCase().endsWith(".zip") ? fileName : `${fileName}.zip`;
}

function headerFallbackFileName(value: string) {
  return (
    safeZipFileName(value)
      .replace(/[^\x20-\x7E]+/g, "_")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"') || "gallery-download.zip"
  );
}

function encodeRfc5987Value(value: string) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDispositionAttachment(fileName: string) {
  const safeFileName = safeZipFileName(fileName);
  return `attachment; filename="${headerFallbackFileName(safeFileName)}"; filename*=UTF-8''${encodeRfc5987Value(
    safeFileName,
  )}`;
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileNameFromUrl(url: string, fallback: string) {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").pop() || "";
    return decodeURIComponent(lastSegment) || fallback;
  } catch {
    return fallback;
  }
}

function uniqueDownloadName(name: string, usedNames: Map<string, number>) {
  const cleaned = clean(name) || "download";
  const lastDot = cleaned.lastIndexOf(".");
  const base = lastDot > 0 ? cleaned.slice(0, lastDot) : cleaned;
  const ext = lastDot > 0 ? cleaned.slice(lastDot) : "";
  const nextCount = (usedNames.get(cleaned) ?? 0) + 1;
  usedNames.set(cleaned, nextCount);
  return nextCount === 1 ? cleaned : `${base}-${nextCount}${ext}`;
}

function chunkValues<T>(values: T[], size: number) {
  const safeSize = Math.max(1, Math.floor(size) || 1);
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += safeSize) {
    chunks.push(values.slice(index, index + safeSize));
  }
  return chunks;
}

async function fetchMediaRows(
  service: SupabaseClient,
  projectId: string,
  mediaIds: string[],
) {
  const rows: MediaRow[] = [];
  for (const chunk of chunkValues(mediaIds, MEDIA_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await service
      .from("media")
      .select("id,collection_id,storage_path,preview_url,thumbnail_url,filename")
      .eq("project_id", projectId)
      .in("id", chunk);

    if (error) throw error;
    rows.push(...((data ?? []) as MediaRow[]));
  }
  return rows;
}

function buildPdfFromJpegBytes(imageBytes: Uint8Array, width: number, height: number) {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;

  const push = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    const chunk = new Uint8Array(bytes.byteLength);
    chunk.set(bytes);
    parts.push(chunk);
    size += bytes.length;
  };

  push("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");

  offsets.push(size);
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  offsets.push(size);
  push("2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n");

  offsets.push(size);
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );

  offsets.push(size);
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
  );
  push(imageBytes);
  push("\nendstream\nendobj\n");

  const contentStream = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
  offsets.push(size);
  push(
    `5 0 obj\n<< /Length ${encoder.encode(contentStream).length} >>\nstream\n${contentStream}endstream\nendobj\n`,
  );

  const xrefOffset = size;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (const offset of offsets) {
    push(`${offset.toString().padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  let totalLength = 0;
  for (const part of parts) totalLength += part.length;
  const result = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of parts) {
    result.set(part, cursor);
    cursor += part.length;
  }
  return result;
}

async function fetchBuffer(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: clean(response.headers.get("content-type")),
  };
}

async function fetchStream(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Could not load ${url}: HTTP ${response.status} ${response.statusText}`);
  }

  return {
    stream: response.body,
    contentType: clean(response.headers.get("content-type")),
  };
}

async function fetchFirstAvailable(
  urls: string[],
  mediaId: string,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; contentType: string; url: string }> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      signal?.throwIfAborted();
      const result = await fetchBuffer(url, signal);
      return { ...result, url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      console.warn(`[event-download-batch] fetch failed for media ${mediaId}: ${message}`);
    }
  }
  throw new Error(
    `All ${urls.length} candidate URL(s) failed for media ${mediaId}: ${errors.join(" | ")}`,
  );
}

async function fetchFirstAvailableStream(
  urls: string[],
  mediaId: string,
  signal?: AbortSignal,
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; url: string }> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      signal?.throwIfAborted();
      const result = await fetchStream(url, signal);
      return { ...result, url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      console.warn(`[event-download-batch] stream fetch failed for media ${mediaId}: ${message}`);
    }
  }
  throw new Error(
    `All ${urls.length} candidate URL(s) failed for media ${mediaId}: ${errors.join(" | ")}`,
  );
}

function preferredDownloadUrls(
  row: Pick<MediaRow, "storage_path" | "preview_url" | "thumbnail_url">,
  resolution: "original" | "large" | "web",
) {
  // 2026-04-30 — Sign with parents-portal TTL so the download path
  // can fetch from R2 directly via SigV4 instead of dead public URLs.
  const mediaUrls = buildSignedMediaUrls({
    storagePath: row.storage_path,
    previewUrl: row.preview_url,
    thumbnailUrl: row.thumbnail_url,
  }, { ttlSeconds: SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS });

  // For "original" we do NOT fall back to preview/thumbnail — the whole point of
  // requesting "original" is to get the full-resolution file. Silent fallback
  // previously masked a real bug where desktop uploads registered preview-sized
  // files as the original, so users got 1600px downloads while believing they
  // were getting full-res. If the original is missing, surface that instead.
  if (resolution === "original") {
    const originalCandidate = clean(mediaUrls.originalUrl);
    return originalCandidate ? [originalCandidate] : [];
  }

  const originalCandidate = clean(mediaUrls.originalUrl);
  return originalCandidate ? [originalCandidate] : [];
}

async function buildPrintReleasePdf(options: {
  studioName: string;
  galleryName: string;
  replyTo: string;
  logoUrl: string;
}) {
  const { default: sharp } = await import("sharp");
  let logoMarkup = "";
  if (clean(options.logoUrl)) {
    try {
      const { buffer: logoBuffer, contentType } = await fetchBuffer(options.logoUrl);
      const metadata = await sharp(logoBuffer).metadata();
      const logoWidth = 280;
      const ratio = (metadata.width ?? logoWidth) / Math.max(1, metadata.height ?? logoWidth);
      const logoHeight = Math.round(logoWidth / ratio);
      const mimeType = contentType || "image/png";
      const dataUri = `data:${mimeType};base64,${logoBuffer.toString("base64")}`;
      logoMarkup = `<image href="${dataUri}" x="90" y="56" width="${logoWidth}" height="${logoHeight}" preserveAspectRatio="xMinYMin meet" />`;
    } catch {
      logoMarkup = "";
    }
  }

  const detailLines = [
    `Gallery: ${clean(options.galleryName) || "Event Gallery"}`,
    clean(options.replyTo) ? `Reply-to: ${clean(options.replyTo)}` : "",
    `Issued: ${new Date().toLocaleDateString()}`,
  ].filter(Boolean);

  const paragraphs = [
    "This print release grants the recipient permission to make personal print reproductions of the downloaded images from this gallery.",
    "This release does not include commercial use, resale, redistribution, editing for third parties, publication, or transfer of copyright unless separately licensed in writing by the studio.",
    "Please retain this release with your downloaded files for your records.",
  ];

  const detailMarkup = detailLines
    .map(
      (line, index) =>
        `<text x="90" y="${338 + index * 36}" font-family="Arial, sans-serif" font-size="24" font-weight="500" fill="#111111">${xmlEscape(line)}</text>`,
    )
    .join("");

  const paragraphMarkup = paragraphs
    .map((paragraph, index) => {
      const lines = paragraph.match(/.{1,76}(\s|$)/g) ?? [paragraph];
      const baseY = 488 + index * 150;
      return lines
        .map(
          (line, lineIndex) =>
            `<text x="90" y="${baseY + lineIndex * 42}" font-family="Arial, sans-serif" font-size="30" font-weight="500" fill="#18181b">${xmlEscape(line.trim())}</text>`,
        )
        .join("");
    })
    .join("");

  const svg = `
    <svg width="1240" height="1754" viewBox="0 0 1240 1754" xmlns="http://www.w3.org/2000/svg">
      <rect width="1240" height="1754" fill="#f7f7f5" />
      <rect width="1240" height="200" fill="#111111" />
      ${logoMarkup}
      <text x="90" y="286" font-family="Arial, sans-serif" font-size="46" font-weight="700" fill="#111111">Print Release</text>
      <text x="90" y="328" font-family="Arial, sans-serif" font-size="22" font-weight="600" fill="#4b5563">${xmlEscape(clean(options.studioName) || "Studio OS")}</text>
      ${detailMarkup}
      <line x1="90" y1="420" x2="1150" y2="420" stroke="#d4d4d8" stroke-width="2" />
      ${paragraphMarkup}
      <text x="90" y="1644" font-family="Arial, sans-serif" font-size="24" font-style="italic" fill="#52525b">Studio OS Galleries</text>
    </svg>
  `;

  const jpegBuffer = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
  const metadata = await sharp(jpegBuffer).metadata();
  return buildPdfFromJpegBytes(
    new Uint8Array(jpegBuffer),
    metadata.width ?? 1240,
    metadata.height ?? 1754,
  );
}

async function addWatermarkToImageBuffer(
  imageBuffer: Buffer,
  options: {
    watermarkText: string;
    logoBuffer?: Buffer | null;
    logoMimeType?: string | null;
  },
) {
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(imageBuffer, { animated: false }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    return { buffer: imageBuffer, outputExt: metadata.format === "png" ? ".png" : ".jpg" };
  }

  let overlaySvg = "";
  if (options.logoBuffer && clean(options.logoMimeType)) {
    const logoMetadata = await sharp(options.logoBuffer).metadata();
    const drawWidth = Math.max(120, Math.round(width / 5));
    const ratio =
      (logoMetadata.width ?? drawWidth) / Math.max(1, logoMetadata.height ?? drawWidth);
    const drawHeight = Math.round(drawWidth / ratio);
    const stepX = Math.max(Math.round(drawWidth * 1.6), 240);
    const stepY = Math.max(Math.round(drawHeight * 1.7), 180);
    const encodedLogo = options.logoBuffer.toString("base64");
    const href = `data:${options.logoMimeType};base64,${encodedLogo}`;
    const items: string[] = [];
    for (let y = -height; y <= height; y += stepY) {
      for (let x = -width; x <= width; x += stepX) {
        items.push(
          `<image href="${href}" x="${x}" y="${y}" width="${drawWidth}" height="${drawHeight}" preserveAspectRatio="xMidYMid meet" />`,
        );
      }
    }

    overlaySvg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <g opacity="0.12" transform="translate(${width / 2} ${height / 2}) rotate(-24)">
          ${items.join("")}
        </g>
      </svg>
    `;
  } else {
    const text = xmlEscape(clean(options.watermarkText) || "PROOF");
    const fontSize = Math.max(24, Math.round(width / 18));
    const stepX = Math.max(Math.round(fontSize * 3.6), 260);
    const stepY = Math.max(Math.round(fontSize * 2.2), 180);
    const items: string[] = [];
    for (let y = -height; y <= height; y += stepY) {
      for (let x = -width; x <= width; x += stepX) {
        items.push(
          `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#dc2626" fill-opacity="0.16">${text}</text>`,
        );
      }
    }

    overlaySvg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <g transform="translate(${width / 2} ${height / 2}) rotate(-28)">
          ${items.join("")}
        </g>
      </svg>
    `;
  }

  const pipeline = sharp(imageBuffer, { animated: false }).composite([
    {
      input: Buffer.from(overlaySvg),
      top: 0,
      left: 0,
    },
  ]);

  if (metadata.format === "png") {
    return {
      buffer: await pipeline.png().toBuffer(),
      outputExt: ".png",
    };
  }

  return {
    buffer: await pipeline.jpeg({ quality: 92 }).toBuffer(),
    outputExt: ".jpg",
  };
}

async function* buildDownloadZipEntries(options: {
  payload: EventGalleryBatchTokenPayload;
  mediaMap: Map<string, MediaRow>;
  logoBuffer: Buffer | null;
  logoMimeType: string | null;
  onPhotoComplete?: (mediaId: string) => void;
  signal?: AbortSignal;
}): AsyncGenerator<ZipStreamEntry> {
  const { payload, mediaMap, logoBuffer, logoMimeType, onPhotoComplete } = options;
  const failedFileNames: string[] = [];
  const archivedMediaIds: string[] = [];
  const usedNames = new Map<string, number>();

  for (const mediaId of payload.mediaIds) {
    options.signal?.throwIfAborted();
    const row = mediaMap.get(mediaId);
    if (!row) {
      failedFileNames.push(mediaId);
      continue;
    }

    const candidateUrls = preferredDownloadUrls(row, payload.resolution);
    const fallbackName = clean(row.filename) || `${mediaId}.jpg`;
    if (!candidateUrls.length) {
      console.warn(`[event-download-batch] no candidate URLs for media ${mediaId}`);
      failedFileNames.push(fallbackName);
      continue;
    }

    let sourceUrl = candidateUrls[0];
    try {
      if (payload.applyWatermark || payload.resolution !== "original") {
        const source = await fetchFirstAvailable(candidateUrls, mediaId, options.signal);
        sourceUrl = source.url;
        const resized = await transformEventImage(source.buffer, { resolution: payload.resolution, watermark: false });
        const watermarked = payload.applyWatermark ? await addWatermarkToImageBuffer(resized.buffer, {
          watermarkText: payload.watermarkText,
          logoBuffer,
          logoMimeType,
        }) : { buffer: resized.buffer, outputExt: ".jpg" };
        const resolvedFallbackName =
          clean(row.filename) || fileNameFromUrl(sourceUrl, `photo${watermarked.outputExt}`);
        const normalizedName = clean(resolvedFallbackName).includes(".")
          ? resolvedFallbackName
          : `${resolvedFallbackName}${watermarked.outputExt}`;
        yield {
          name: uniqueDownloadName(normalizedName, usedNames),
          data: new Uint8Array(watermarked.buffer),
        };
        archivedMediaIds.push(mediaId);
        onPhotoComplete?.(mediaId);
        continue;
      }

      const source = await fetchFirstAvailableStream(candidateUrls, mediaId, options.signal);
      sourceUrl = source.url;
      const outputExt = clean(row.filename).toLowerCase().endsWith(".png") ? ".png" : ".jpg";
      const resolvedFallbackName =
        clean(row.filename) || fileNameFromUrl(sourceUrl, `photo${outputExt}`);
      const normalizedName = clean(resolvedFallbackName).includes(".")
        ? resolvedFallbackName
        : `${resolvedFallbackName}${outputExt}`;
      yield {
        name: uniqueDownloadName(normalizedName, usedNames),
        stream: source.stream,
      };
      archivedMediaIds.push(mediaId);
      onPhotoComplete?.(mediaId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[event-download-batch] skipping media ${mediaId} (${fallbackName}): ${message}`);
      failedFileNames.push(clean(row.filename) || fileNameFromUrl(sourceUrl, fallbackName));
    }
  }

  if (payload.includePrintRelease && archivedMediaIds.length > 0) {
    try {
      const printReleasePdf = await buildPrintReleasePdf({
        studioName: payload.studioName,
        galleryName: payload.galleryName,
        replyTo: payload.studioEmail,
        logoUrl: payload.watermarkLogoUrl,
      });
      yield {
        name: uniqueDownloadName("Print Release.pdf", usedNames),
        data: printReleasePdf,
      };
    } catch {
      // Keep the photo archive available even if the print release could not be generated.
    }
  }

  if (failedFileNames.length) {
    const skippedText = [
      "The following files could not be included in this ZIP:",
      "",
      ...failedFileNames.map((name) => `- ${name}`),
    ].join("\n");
    yield {
      name: uniqueDownloadName("Skipped Files.txt", usedNames),
      data: new TextEncoder().encode(skippedText),
    };
  }
}

export async function GET(request: NextRequest) {
  let releaseQuota: (() => Promise<void>) | null = null;
  try {
    const token = clean(request.nextUrl.searchParams.get("token"));
    const wantsJson = clean(request.nextUrl.searchParams.get("format")) === "json";
    if (!token) {
      return NextResponse.json(
        { ok: false, message: "Missing download token." },
        { status: 400 },
      );
    }

    const payload = verifyEventGalleryBatchToken(token);
    const maxMediaForThisBatch = Math.min(
      MAX_MEDIA_PER_BATCH,
      galleryZipBatchSize(payload.resolution, payload.applyWatermark),
    );
    if (Array.isArray(payload.mediaIds) && payload.mediaIds.length > MAX_MEDIA_PER_BATCH) {
      return NextResponse.json(
        {
          ok: false,
          message: "This prepared ZIP is too large. Go back to the gallery and press Download All again to create smaller ZIP files.",
        },
        { status: 413 },
      );
    }
    if (Array.isArray(payload.mediaIds) && payload.mediaIds.length > maxMediaForThisBatch) {
      return NextResponse.json(
        {
          ok: false,
          message: "This download session was prepared before the safer ZIP split. Go back to the gallery and press Download All again.",
        },
        { status: 409 },
      );
    }

    const scopedCollections = validateUuidArray(payload.collectionIds, "collectionIds", { min: 1, max: 5000 });
    const scopedMedia = validateUuidArray(payload.mediaIds, "mediaIds", { min: 1, max: MAX_MEDIA_PER_BATCH });
    const projectId = validateUuid(payload.projectId, "projectId");
    if (!scopedCollections.ok || !scopedMedia.ok || !projectId.ok ||
      !payload.collectionGrants || typeof payload.collectionGrants !== "object" || typeof payload.projectAccessGrant !== "string" ||
      scopedCollections.value.some(id => typeof payload.collectionGrants?.[id] !== "string") ||
      (payload.collectionId && !scopedCollections.value.includes(payload.collectionId))) {
      return NextResponse.json(
        { ok: false, message: "This prepared download needs to be refreshed. Go back to the gallery and prepare the download again." },
        { status: 409 },
      );
    }

    if (wantsJson) {
      return NextResponse.json(
        {
          ok: true,
          fileName: safeZipFileName(payload.fileName),
          downloadUrl: `/api/portal/event-download-batch?token=${encodeURIComponent(token)}`,
          expiresAt: new Date(payload.exp).toISOString(),
        },
        {
          headers: {
            "cache-control": "private, no-store",
          },
        },
      );
    }

    const service = createDashboardServiceClient();
    const { data: project, error: projectError } = await service.from("projects")
      .select("id,workflow_type,status,photographer_id,access_mode,access_pin,email_required").eq("id", payload.projectId).maybeSingle();
    if (projectError) throw projectError;
    if (!project || clean(project.workflow_type).toLowerCase() !== "event" ||
      clean(project.status).toLowerCase() === "inactive" ||
      (project.photographer_id ?? null) !== (payload.photographerId ?? null) ||
      createEventProjectDownloadGrant(project) !== payload.projectAccessGrant) {
      return NextResponse.json({ ok: false, message: "This gallery is no longer available for download." }, { status: 403 });
    }
    // Match current gallery access policy: invitation removal revokes prepared
    // ZIPs too. An empty invitation list keeps the existing open-email policy.
    if (project.email_required !== false) {
      const { data: invitation, error: invitationError } = await service.from("pre_release_emails")
        .select("id").eq("project_id", payload.projectId)
        .eq("email", clean(payload.viewerEmail).toLowerCase()).limit(1);
      if (invitationError) throw invitationError;
      if (!invitation?.length) {
        const { data: anyInvitation, error: whitelistError } = await service.from("pre_release_emails")
          .select("id").eq("project_id", payload.projectId).limit(1);
        if (whitelistError) throw whitelistError;
        if (anyInvitation?.length) {
          return NextResponse.json({ ok: false, message: "That email is no longer approved for this event gallery." }, { status: 403 });
        }
      }
    }
    const tokenAccess = await authorizeEventMediaToken(service, payload, true);
    if (!tokenAccess) {
      return NextResponse.json({ ok: false, message: "Download permission changed. Prepare the download again." }, { status: 403 });
    }
    const currentCollections = await fetchEventProjectCollections(service, payload.projectId, "id,kind,slug,access_mode,access_pin");
    const allowedCollections = new Set(currentCollections.filter(row =>
      scopedCollections.value.includes(row.id) &&
      (!payload.collectionId || row.id === payload.collectionId) &&
      createEventCollectionDownloadGrant(payload.projectId, row) === payload.collectionGrants?.[row.id],
    ).map(row => row.id));
    const mediaRows = await fetchMediaRows(service, payload.projectId, [...new Set(payload.mediaIds)]);

    const mediaMap = new Map<string, MediaRow>();
    for (const row of mediaRows) {
      if (row.collection_id && allowedCollections.has(row.collection_id)) mediaMap.set(row.id, row);
    }
    if (mediaRows.some(row => !row.collection_id || !allowedCollections.has(row.collection_id)) || mediaMap.size !== new Set(payload.mediaIds).size) {
      return NextResponse.json({ ok: false, message: "Album access changed. Return to the gallery and prepare the download again." }, { status: 403 });
    }

    // Legacy sessions without a log ID were already charged at preparation.
    // Current signed batches hold capacity before any original is fetched.
    const reservation = payload.downloadLogId ? await reserveGalleryDownload({ service, galleryKind: "event", galleryId: payload.projectId,
      photographerId: payload.photographerId ?? null, viewerEmail: payload.viewerEmail,
      collectionId: payload.collectionId, mediaIds: [...new Set(payload.mediaIds)], mode: "zip", reservationId: payload.downloadLogId,
      gallerySettings: tokenAccess.project.gallery_settings }) : null;
    if (reservation && (!reservation.allowedMediaIds.length || reservation.busy)) {
      return NextResponse.json({ ok: false, message: reservation.busy ? "This ZIP is already downloading. Please wait before retrying." :
        "The remaining free allowance changed. Return to the gallery and prepare the download again.",
        downloadsUsed: reservation.downloadsUsed, downloadsRemaining: reservation.downloadsRemaining }, { status: reservation.busy ? 409 : 403 });
    }
    const upstream = new AbortController();
    if (reservation) releaseQuota = () => { upstream.abort(); return finishGalleryDownload(service, reservation, [], true); };
    let logoBuffer: Buffer | null = null;
    let logoMimeType: string | null = null;
    if (payload.applyWatermark && clean(payload.watermarkLogoUrl)) {
      try {
        const logoResult = await fetchBuffer(payload.watermarkLogoUrl, upstream.signal);
        logoBuffer = logoResult.buffer;
        logoMimeType = logoResult.contentType || "image/png";
      } catch {
        logoBuffer = null;
        logoMimeType = null;
      }
    }

    const completedMediaIds: string[] = [];
    const sourceZipStream = createZipStream(
      buildDownloadZipEntries({
        payload,
        mediaMap,
        logoBuffer,
        logoMimeType,
        onPhotoComplete: (mediaId) => completedMediaIds.push(mediaId),
        signal: upstream.signal,
      }),
    );
    const zipStream = recordAfterZipCompletion(sourceZipStream,
      () => reservation ? finishGalleryDownload(service, reservation, completedMediaIds) : Promise.resolve(),
      () => reservation ? finishGalleryDownload(service, reservation, [], true) : Promise.resolve(),
      240000, () => upstream.abort(),
    );

    const response = new NextResponse(zipStream, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": contentDispositionAttachment(payload.fileName),
        "cache-control": "private, no-store",
      },
    });
    releaseQuota = null; // Stream completion/cancellation now owns the hold.
    return response;
  } catch (error) {
    if (releaseQuota) {
      try { await releaseQuota(); } catch (releaseError) { console.error("[event-download-batch] quota release failed", releaseError); }
    }
    console.error("[event-download-batch]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to build the gallery ZIP file." },
      { status: 500 },
    );
  }
}
