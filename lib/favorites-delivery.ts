import { createHmac, timingSafeEqual } from "node:crypto";
import { buildArchiveBaseName } from "@/lib/event-gallery-downloads";
import { r2KeyFromAnyUrl, r2PresignedGetUrl } from "@/lib/r2-signed-urls";
import { buildSignedMediaUrls } from "@/lib/storage-images";
import { resendConfigured, resolveReplyTo, sendResendEmail } from "@/lib/resend";
import { createZipStream, type ZipStreamEntry } from "@/lib/zip";

// 2026-06-22 — "Email a client their favorites" delivery pipeline.
//
// A photographer can filter the event favorites view to a single
// client's email and send that client a secure link to JUST the photos
// they hearted.  The link opens a mobile-friendly landing page (tap a
// photo to save on a phone) and offers a one-click "Download all as
// ZIP" button.  Mirrors the proven digital-delivery token + ZIP
// streaming pattern but is keyed on (project, viewer email) instead of
// an order.
//
// SERVER-SIDE ONLY — reads R2 + signing secrets.

type ServiceClient = {
  from: (table: string) => any;
};

type FavoriteRow = {
  media_id: string | null;
  viewer_email: string | null;
  created_at: string | null;
};

type MediaRow = {
  id: string;
  storage_path?: string | null;
  preview_url?: string | null;
  thumbnail_url?: string | null;
  filename?: string | null;
};

type ProjectRow = {
  id: string;
  title?: string | null;
  photographer_id?: string | null;
};

type PhotographerRow = {
  id: string;
  business_name?: string | null;
  studio_email?: string | null;
  billing_email?: string | null;
};

export type FavoritesDeliveryPhoto = {
  key: string;
  fileName: string;
  previewUrl: string;
  originalUrl: string;
};

export type FavoritesDeliveryContext = {
  projectId: string;
  projectTitle: string;
  businessName: string;
  replyTo: string | null;
  recipientEmail: string;
  photos: FavoritesDeliveryPhoto[];
};

export type FavoritesDeliveryTokenPayload = {
  v: 1;
  kind: "favorites-delivery";
  projectId: string;
  recipientEmail: string;
  exp: number;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function lower(value: string | null | undefined) {
  return clean(value).toLowerCase();
}

function fileNameFromKey(key: string) {
  const name = clean(key).split("/").pop() ?? "";
  return name || "photo.jpg";
}

// Derive the original-resolution R2 object key from a stored
// storage_path (which may legacy-point at a _preview/_thumbnail
// derivative).  Matches buildSignedMediaUrls' key normalization.
function originalKeyFromStoragePath(storagePath: string | null | undefined) {
  const rawKey = r2KeyFromAnyUrl(storagePath) || clean(storagePath);
  if (!rawKey || rawKey.includes("..")) return "";
  const cleaned = rawKey.replace(/_(preview|thumbnail)\.[^.]+$/i, ".jpg");
  const baseNoExt = cleaned.replace(/\.[^./]+$/i, "");
  return `${baseNoExt}.jpg`;
}

function siteBaseUrl() {
  const configured =
    clean(process.env.NEXT_PUBLIC_SITE_URL) ||
    clean(process.env.NEXT_PUBLIC_APP_URL) ||
    clean(process.env.SITE_URL);
  if (configured) return configured.replace(/\/+$/, "");
  const vercelUrl = clean(process.env.VERCEL_URL);
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`;
  }
  return "https://www.studiooscloud.com";
}

function signingSecret() {
  const secret =
    clean(process.env.DIGITAL_DELIVERY_TOKEN_SECRET) ||
    clean(process.env.DOWNLOAD_TOKEN_SECRET) ||
    clean(process.env.EVENT_DOWNLOAD_TOKEN_SECRET) ||
    clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!secret) throw new Error("Missing favorites delivery signing secret.");
  return secret;
}

function encodePayload(payload: FavoritesDeliveryTokenPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value: string) {
  return JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  ) as FavoritesDeliveryTokenPayload;
}

function signEncodedPayload(value: string) {
  return createHmac("sha256", signingSecret()).update(value).digest("hex");
}

export function createFavoritesDeliveryToken(payload: FavoritesDeliveryTokenPayload) {
  const encoded = encodePayload(payload);
  return `${encoded}.${signEncodedPayload(encoded)}`;
}

export function verifyFavoritesDeliveryToken(token: string) {
  const [encoded, signature] = clean(token).split(".");
  if (!encoded || !signature) throw new Error("Invalid favorites link.");
  const expected = signEncodedPayload(encoded);
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid favorites link.");
  }
  const payload = decodePayload(encoded);
  if (payload.v !== 1 || payload.kind !== "favorites-delivery") {
    throw new Error("Unsupported favorites link.");
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
    throw new Error("This favorites link has expired.");
  }
  return payload;
}

export function createFavoritesDeliveryUrl(
  projectId: string,
  recipientEmail: string,
  options?: { expiresInDays?: number },
) {
  const days = Math.max(1, Math.min(120, options?.expiresInDays ?? 60));
  const token = createFavoritesDeliveryToken({
    v: 1,
    kind: "favorites-delivery",
    projectId,
    recipientEmail: lower(recipientEmail),
    exp: Date.now() + 1000 * 60 * 60 * 24 * days,
  });
  return `${siteBaseUrl()}/api/portal/favorites-delivery?token=${encodeURIComponent(token)}`;
}

export async function resolveFavoritesDeliveryContext(
  service: ServiceClient,
  params: { projectId: string; viewerEmail: string },
): Promise<FavoritesDeliveryContext> {
  const projectId = clean(params.projectId);
  const recipientEmail = lower(params.viewerEmail);
  if (!projectId) throw new Error("Missing project.");
  if (!recipientEmail) throw new Error("Missing client email.");

  const { data: project, error: projectError } = await service
    .from("projects")
    .select("id,title,photographer_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project?.id) throw new Error("Project not found.");
  const projectRow = project as ProjectRow;

  const { data: photographer, error: photographerError } = projectRow.photographer_id
    ? await service
        .from("photographers")
        .select("id,business_name,studio_email,billing_email")
        .eq("id", projectRow.photographer_id)
        .maybeSingle()
    : { data: null, error: null };
  if (photographerError) throw photographerError;
  const photographerRow = (photographer ?? null) as PhotographerRow | null;

  // Pull every favorite for the project and filter by email in JS.
  // Avoids ILIKE wildcard pitfalls (emails can contain `_`) and any
  // casing mismatch in how the portal stored viewer_email.
  const { data: favoriteRows, error: favoritesError } = await service
    .from("event_gallery_favorites")
    .select("media_id,viewer_email,created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (favoritesError) throw favoritesError;

  const orderedMediaIds: string[] = [];
  const seenMedia = new Set<string>();
  for (const row of (favoriteRows ?? []) as FavoriteRow[]) {
    if (lower(row.viewer_email) !== recipientEmail) continue;
    const mediaId = clean(row.media_id);
    if (!mediaId || seenMedia.has(mediaId)) continue;
    seenMedia.add(mediaId);
    orderedMediaIds.push(mediaId);
  }

  let mediaById = new Map<string, MediaRow>();
  if (orderedMediaIds.length) {
    const { data: mediaRows, error: mediaError } = await service
      .from("media")
      .select("id,storage_path,preview_url,thumbnail_url,filename")
      .eq("project_id", projectId)
      .in("id", orderedMediaIds);
    if (mediaError) throw mediaError;
    mediaById = new Map(
      ((mediaRows ?? []) as MediaRow[]).map((row) => [row.id, row] as const),
    );
  }

  const photos: FavoritesDeliveryPhoto[] = [];
  for (const mediaId of orderedMediaIds) {
    const media = mediaById.get(mediaId);
    if (!media) continue;
    const key = originalKeyFromStoragePath(media.storage_path);
    if (!key) continue;
    const signed = buildSignedMediaUrls(
      {
        storagePath: media.storage_path,
        previewUrl: media.preview_url,
        thumbnailUrl: media.thumbnail_url,
      },
      { ttlSeconds: 60 * 60 },
    );
    photos.push({
      key,
      fileName: clean(media.filename) || fileNameFromKey(key),
      previewUrl: signed.previewUrl || signed.originalUrl || "",
      originalUrl: signed.originalUrl || "",
    });
  }

  return {
    projectId,
    projectTitle: clean(projectRow.title) || "Your gallery",
    businessName: clean(photographerRow?.business_name) || "Studio OS",
    replyTo:
      resolveReplyTo(photographerRow?.studio_email) ||
      resolveReplyTo(photographerRow?.billing_email),
    recipientEmail,
    photos,
  };
}

export function favoritesZipFileName(context: FavoritesDeliveryContext) {
  const base = buildArchiveBaseName(
    [context.projectTitle, "favorites"].filter(Boolean).join(" - "),
    "favorite-photos",
  );
  return `${base}.zip`;
}

export function contentDispositionAttachment(fileName: string) {
  const cleaned = buildArchiveBaseName(fileName, "favorite-photos.zip");
  const zipName = cleaned.toLowerCase().endsWith(".zip") ? cleaned : `${cleaned}.zip`;
  const fallback = zipName
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const encoded = encodeURIComponent(zipName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function fetchR2Stream(key: string) {
  const url = r2PresignedGetUrl(key, 60 * 60);
  if (!url) throw new Error(`Could not sign ${key}.`);
  const response = await fetch(url, { cache: "no-store", redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Could not load ${key}: HTTP ${response.status}`);
  }
  return response.body;
}

function uniqueDownloadName(name: string, usedNames: Map<string, number>) {
  const cleaned = clean(name).replace(/[\\/:*?"<>|\r\n]+/g, " ") || "photo.jpg";
  const lastDot = cleaned.lastIndexOf(".");
  const base = lastDot > 0 ? cleaned.slice(0, lastDot) : cleaned;
  const ext = lastDot > 0 ? cleaned.slice(lastDot) : "";
  const nextCount = (usedNames.get(cleaned) ?? 0) + 1;
  usedNames.set(cleaned, nextCount);
  return nextCount === 1 ? cleaned : `${base}-${nextCount}${ext}`;
}

export async function* buildFavoritesZipEntries(
  photos: FavoritesDeliveryPhoto[],
): AsyncGenerator<ZipStreamEntry> {
  const usedNames = new Map<string, number>();
  const skipped: string[] = [];

  for (const photo of photos) {
    try {
      const stream = await fetchR2Stream(photo.key);
      yield {
        name: uniqueDownloadName(photo.fileName, usedNames),
        stream,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[favorites-delivery] skipping ${photo.key}: ${message}`);
      skipped.push(photo.fileName || photo.key || "photo");
    }
  }

  if (skipped.length) {
    yield {
      name: uniqueDownloadName("Skipped Files.txt", usedNames),
      data: new TextEncoder().encode(
        [
          "The following files could not be included in this ZIP:",
          "",
          ...skipped.map((name) => `- ${name}`),
        ].join("\n"),
      ),
    };
  }
}

export function createFavoritesDeliveryZipStream(context: FavoritesDeliveryContext) {
  return createZipStream(buildFavoritesZipEntries(context.photos));
}

function escHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendFavoritesDeliveryEmail(
  service: ServiceClient,
  params: { projectId: string; viewerEmail: string; expiresInDays?: number },
) {
  if (!resendConfigured()) {
    return {
      ok: false as const,
      skipped: true as const,
      reason: "email_not_configured" as const,
      message: "Email delivery is not configured on the server.",
    };
  }

  const context = await resolveFavoritesDeliveryContext(service, {
    projectId: params.projectId,
    viewerEmail: params.viewerEmail,
  });

  if (!context.photos.length) {
    return {
      ok: false as const,
      skipped: true as const,
      reason: "no_favorites" as const,
      message: "This client has no favorited photos to send yet.",
    };
  }

  const days = Math.max(1, Math.min(120, params.expiresInDays ?? 60));
  const viewUrl = createFavoritesDeliveryUrl(context.projectId, context.recipientEmail, {
    expiresInDays: days,
  });
  const count = context.photos.length;
  const plural = count === 1 ? "photo" : "photos";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <div style="max-width:620px;margin:0 auto;padding:24px 12px;">
    <div style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;color:#ffffff;padding:24px 28px;">
        <div style="font-size:22px;font-weight:900;">${escHtml(context.businessName)}</div>
        <div style="font-size:13px;color:#d1d5db;margin-top:4px;">Your favorite photos</div>
      </div>
      <div style="padding:28px;">
        <h1 style="margin:0 0 14px;font-size:23px;line-height:1.25;">Here are the photos you loved</h1>
        <p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0 0 18px;">
          Hi! You marked <strong>${count}</strong> ${plural} as favorites in <strong>${escHtml(context.projectTitle)}</strong>. Tap the button below to view them and save them to your phone or computer.
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:0 0 22px;color:#374151;font-size:14px;">
          Included: <strong>${count}</strong> favorite ${plural}
        </div>
        <a href="${escHtml(viewUrl)}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:800;border-radius:999px;padding:14px 24px;font-size:15px;">
          View &amp; download my photos
        </a>
        <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:22px 0 0;">
          On the next page you can download everything as a ZIP, or — on a phone — tap any photo and save it straight to your camera roll.
        </p>
        <p style="font-size:12px;line-height:1.5;color:#9ca3af;margin:14px 0 0;">
          This secure link expires in ${days} days. If you need help, just reply to this email.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const text = [
    "Hi!",
    "",
    `You marked ${count} ${plural} as favorites in ${context.projectTitle}.`,
    "",
    `View & download them here: ${viewUrl}`,
    "",
    `You can download everything as a ZIP, or on a phone tap any photo to save it to your camera roll.`,
    "",
    `This secure link expires in ${days} days. If you need help, reply to this email.`,
  ].join("\n");

  await sendResendEmail({
    to: context.recipientEmail,
    subject: `Your favorite photos from ${context.projectTitle}`,
    html,
    text,
    fromName: context.businessName,
    replyTo: context.replyTo,
    tags: [
      { name: "type", value: "favorites-delivery" },
      { name: "project_id", value: context.projectId },
    ],
  });

  return {
    ok: true as const,
    skipped: false as const,
    fileCount: count,
    recipientEmail: context.recipientEmail,
  };
}

// Mobile-friendly landing page the client lands on from the email.
// Shows every favorite as a tappable thumbnail (long-press / share to
// save on a phone) plus a one-click "Download all as ZIP" button.
export function renderFavoritesDeliveryPage(
  context: FavoritesDeliveryContext,
  options: { downloadUrl: string },
) {
  const count = context.photos.length;
  const plural = count === 1 ? "photo" : "photos";
  const tiles = context.photos
    .map((photo) => {
      const display = escHtml(photo.previewUrl || photo.originalUrl);
      const full = escHtml(photo.originalUrl || photo.previewUrl);
      const name = escHtml(photo.fileName);
      return `
        <figure class="tile">
          <a href="${full}" target="_blank" rel="noopener" download="${name}">
            <img src="${display}" alt="${name}" loading="lazy" />
          </a>
          <figcaption>
            <span class="name">${name}</span>
            <a class="save" href="${full}" target="_blank" rel="noopener" download="${name}">Save</a>
          </figcaption>
        </figure>`;
    })
    .join("");

  const emptyState = `<div class="empty">These favorites are no longer available. Please contact ${escHtml(
    context.businessName,
  )}.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Your favorite photos — ${escHtml(context.projectTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f4f6; color: #111827; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 20px 16px 64px; }
    header { background: #111827; color: #fff; border-radius: 16px; padding: 22px 24px; margin-bottom: 18px; }
    header .studio { font-size: 20px; font-weight: 900; }
    header .sub { font-size: 13px; color: #d1d5db; margin-top: 4px; }
    .bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;
           background: rgba(243,244,246,0.92); backdrop-filter: blur(8px); padding: 12px 4px; margin-bottom: 14px; }
    .count { font-size: 15px; font-weight: 800; }
    .download { display: inline-flex; align-items: center; gap: 8px; background: #dc2626; color: #fff; text-decoration: none;
                font-weight: 800; border-radius: 999px; padding: 12px 20px; font-size: 15px; }
    .download:active { transform: translateY(1px); }
    .hint { font-size: 13px; color: #6b7280; margin: 0 0 16px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
    .tile { margin: 0; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden; }
    .tile a { display: block; }
    .tile img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; display: block; background: #e5e7eb; }
    figcaption { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 11px; }
    figcaption .name { font-size: 12px; color: #4b5563; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    figcaption .save { font-size: 12px; font-weight: 800; color: #dc2626; text-decoration: none; flex: 0 0 auto; }
    .empty { background: #fff; border: 1px dashed #d1d5db; border-radius: 14px; padding: 28px; text-align: center; color: #6b7280; }
    @media (max-width: 520px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="studio">${escHtml(context.businessName)}</div>
      <div class="sub">${escHtml(context.projectTitle)} — your favorite photos</div>
    </header>
    <div class="bar">
      <span class="count">${count} favorite ${plural}</span>
      ${count ? `<a class="download" href="${escHtml(options.downloadUrl)}">Download all as ZIP</a>` : ""}
    </div>
    <p class="hint">On a phone, tap a photo to open it, then press <strong>Share &rarr; Save Image</strong> to add it to your camera roll. On a computer, use <strong>Download all as ZIP</strong> or the Save link under each photo.</p>
    ${count ? `<div class="grid">${tiles}</div>` : emptyState}
  </div>
</body>
</html>`;
}
