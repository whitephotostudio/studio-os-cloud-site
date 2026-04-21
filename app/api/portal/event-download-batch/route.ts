import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { verifyEventGalleryBatchToken } from "@/lib/event-gallery-download-tokens";
import { buildStoredMediaUrls } from "@/lib/storage-images";
import { createZipBytes, type ZipEntry } from "@/lib/zip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Upper bound on photos included in a single ZIP request. The /event-download-ready
// route already chunks batches (~72–100 photos per token depending on resolution
// and watermark), but we enforce a hard cap here as a defense-in-depth guard so
// a forged/tampered token cannot ask us to materialize thousands of full-size
// buffers in memory at once.
const MAX_MEDIA_PER_BATCH = 150;

type MediaRow = {
  id: string;
  storage_path: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  filename: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
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

async function fetchBuffer(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
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

async function fetchFirstAvailable(
  urls: string[],
  mediaId: string,
): Promise<{ buffer: Buffer; contentType: string; url: string }> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const result = await fetchBuffer(url);
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

function preferredDownloadUrls(
  row: Pick<MediaRow, "storage_path" | "preview_url" | "thumbnail_url">,
  resolution: "original" | "large" | "web",
) {
  const mediaUrls = buildStoredMediaUrls({
    storagePath: row.storage_path,
    previewUrl: row.preview_url,
    thumbnailUrl: row.thumbnail_url,
  });

  // For "original" we do NOT fall back to preview/thumbnail — the whole point of
  // requesting "original" is to get the full-resolution file. Silent fallback
  // previously masked a real bug where desktop uploads registered preview-sized
  // files as the original, so users got 1600px downloads while believing they
  // were getting full-res. If the original is missing, surface that instead.
  if (resolution === "original") {
    const originalCandidate = clean(mediaUrls.originalUrl);
    return originalCandidate ? [originalCandidate] : [];
  }

  // Primary ranked candidates from the canonical URL builder.
  const primary =
    resolution === "web"
      ? [mediaUrls.thumbnailUrl, mediaUrls.previewUrl, mediaUrls.originalUrl]
      : /* "large" */ [mediaUrls.previewUrl, mediaUrls.originalUrl, mediaUrls.thumbnailUrl];

  // ALSO try the raw DB-stored URLs as last-resort fallbacks. buildStoredMediaUrls
  // discards Supabase-hosted preview/thumbnail URLs in favour of the R2
  // originalUrl, so if R2 serves 404 for this key (which happens when a row was
  // migrated to R2 pointers but the object never made it across), we still have
  // working Supabase URLs to try.
  const rawFallbacks = [clean(row.preview_url), clean(row.thumbnail_url)];

  // De-dupe while preserving order.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of [...primary, ...rawFallbacks]) {
    const v = clean(value);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    ordered.push(v);
  }
  return ordered;
}

async function buildPrintReleasePdf(options: {
  studioName: string;
  galleryName: string;
  replyTo: string;
  logoUrl: string;
}) {
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

export async function GET(request: NextRequest) {
  try {
    const token = clean(request.nextUrl.searchParams.get("token"));
    if (!token) {
      return NextResponse.json(
        { ok: false, message: "Missing download token." },
        { status: 400 },
      );
    }

    const payload = verifyEventGalleryBatchToken(token);
    if (Array.isArray(payload.mediaIds) && payload.mediaIds.length > MAX_MEDIA_PER_BATCH) {
      return NextResponse.json(
        {
          ok: false,
          message: `This batch exceeds the ${MAX_MEDIA_PER_BATCH}-photo per-request limit. Please request a new download link.`,
        },
        { status: 400 },
      );
    }
    const service = createDashboardServiceClient();
    const { data: mediaRows, error: mediaError } = await service
      .from("media")
      .select("id,storage_path,preview_url,thumbnail_url,filename")
      .eq("project_id", payload.projectId)
      .in("id", payload.mediaIds);

    if (mediaError) throw mediaError;

    const mediaMap = new Map<string, MediaRow>();
    for (const row of (mediaRows ?? []) as MediaRow[]) {
      mediaMap.set(row.id, row);
    }

    let logoBuffer: Buffer | null = null;
    let logoMimeType: string | null = null;
    if (payload.applyWatermark && clean(payload.watermarkLogoUrl)) {
      try {
        const logoResult = await fetchBuffer(payload.watermarkLogoUrl);
        logoBuffer = logoResult.buffer;
        logoMimeType = logoResult.contentType || "image/png";
      } catch {
        logoBuffer = null;
        logoMimeType = null;
      }
    }

    const zipEntries: ZipEntry[] = [];
    const failedFileNames: string[] = [];
    const usedNames = new Map<string, number>();

    for (const mediaId of payload.mediaIds) {
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
        const source = await fetchFirstAvailable(candidateUrls, mediaId);
        sourceUrl = source.url;
        let outputBytes = new Uint8Array(source.buffer);
        let outputExt = clean(row.filename).toLowerCase().endsWith(".png") ? ".png" : ".jpg";
        if (payload.applyWatermark) {
          const watermarked = await addWatermarkToImageBuffer(source.buffer, {
            watermarkText: payload.watermarkText,
            logoBuffer,
            logoMimeType,
          });
          outputBytes = new Uint8Array(watermarked.buffer);
          outputExt = watermarked.outputExt;
        }

        const resolvedFallbackName = clean(row.filename) || fileNameFromUrl(sourceUrl, `photo${outputExt}`);
        const normalizedName = clean(resolvedFallbackName).includes(".")
          ? resolvedFallbackName
          : `${resolvedFallbackName}${outputExt}`;
        zipEntries.push({
          name: uniqueDownloadName(normalizedName, usedNames),
          data: outputBytes,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[event-download-batch] skipping media ${mediaId} (${fallbackName}): ${message}`);
        failedFileNames.push(clean(row.filename) || fileNameFromUrl(sourceUrl, fallbackName));
      }
    }

    if (payload.includePrintRelease && zipEntries.length > 0) {
      try {
        const printReleasePdf = await buildPrintReleasePdf({
          studioName: payload.studioName,
          galleryName: payload.galleryName,
          replyTo: payload.studioEmail,
          logoUrl: payload.watermarkLogoUrl,
        });
        zipEntries.push({
          name: uniqueDownloadName("Print Release.pdf", usedNames),
          data: printReleasePdf,
        });
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
      zipEntries.push({
        name: uniqueDownloadName("Skipped Files.txt", usedNames),
        data: new TextEncoder().encode(skippedText),
      });
    }

    if (!zipEntries.length) {
      return NextResponse.json(
        { ok: false, message: "Could not build this gallery ZIP file." },
        { status: 502 },
      );
    }

    const zipBytes = createZipBytes(zipEntries);
    const response = new NextResponse(zipBytes, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${payload.fileName}"`,
        "cache-control": "private, no-store",
      },
    });
    response.headers.set("content-length", String(zipBytes.length));
    return response;
  } catch (error) {
    console.error("[event-download-batch]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to build the gallery ZIP file." },
      { status: 500 },
    );
  }
}
