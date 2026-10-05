import { hasCalendarBoundaryPassed } from "@/lib/calendar-dates";
import { hasCurrentDigitalPayment } from "@/lib/digital-entitlement-payment";
import sharp from "sharp";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { createEventCollectionDownloadGrant, createEventDownloadPolicyGrant, createEventProjectDownloadGrant, createEventGalleryBatchToken, type EventPreviewTokenPayload, type EventGalleryBatchTokenPayload } from "@/lib/event-gallery-download-tokens";
import type { EventDownloadCollection } from "@/lib/event-download-scope";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { validateUuid, validateUuidArray } from "@/lib/request-validation";
import { privateMediaKeyFromReference } from "@/lib/private-media-references";
import { buildSignedMediaUrls } from "@/lib/storage-images";
import { hasActiveSubscription } from "@/lib/subscription-gate";

type Service = ReturnType<typeof createDashboardServiceClient>;
export type EventDeliveryMedia = { id: string; collection_id: string | null; storage_path: string | null; preview_url?: string | null; thumbnail_url?: string | null; filename?: string | null };
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 50_000_000;

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
export function isFullDigitalPurchaseLabel(text: string, category?: unknown) {
  return (/digital|download|\bfiles?\b/i.test(text) || clean(category).toLowerCase() === "digital") && /\b(all|full|entire|complete)\s+(digitals?|downloads?|files?|gallery|album|collection|photos|images)\b|\b(digitals?|downloads?|files?)\s+(all|full|entire|complete)\b|\bbuy all\b/i.test(text);
}

export async function buildEventFileDeliveries(options: {
  service: Service; project: { id: string; title: string | null; photographer_id: string | null; access_mode: string | null; access_pin: string | null; gallery_settings: unknown };
  email: string; mediaIds: string[]; collections: EventDownloadCollection[]; deliveryType: "gallery" | "favorites";
}) {
  const extras = normalizeEventGallerySettings(options.project.gallery_settings).extras;
  const albums = new Map(options.collections.map(row => [row.id, row]));
  const rows = new Map<string, Pick<EventDeliveryMedia, "id" | "collection_id" | "filename">>();
  for (let index = 0; index < options.mediaIds.length; index += 100) {
    const { data, error } = await options.service.from("media").select("id,collection_id,filename").eq("project_id", options.project.id).in("id", options.mediaIds.slice(index, index + 100));
    if (error) throw error;
    for (const row of data ?? []) rows.set(row.id, row);
  }
  return options.mediaIds.map(mediaId => {
    const row = rows.get(mediaId), album = row?.collection_id ? albums.get(row.collection_id) : null;
    if (!row || !album) throw new Error("Gallery photos changed. Prepare the download again.");
    const token = createEventGalleryBatchToken({
      v: 1, kind: "event-gallery-download-batch", projectId: options.project.id, viewerEmail: options.email,
      galleryName: clean(options.project.title) || "Gallery", archiveBaseName: "Gallery", resolution: extras.freeDigitalResolution,
      applyWatermark: extras.watermarkDownloads, includePrintRelease: false, watermarkText: clean(options.project.title) || "PROOF", watermarkLogoUrl: "", studioName: "", studioEmail: "",
      fileName: clean(row.filename) || "photo.jpg", mediaIds: [mediaId], collectionId: album.id, collectionIds: [album.id],
      collectionGrants: { [album.id]: createEventCollectionDownloadGrant(options.project.id, album) }, photographerId: options.project.photographer_id,
      projectAccessGrant: createEventProjectDownloadGrant(options.project), downloadPolicyGrant: createEventDownloadPolicyGrant(options.project.gallery_settings), deliveryType: options.deliveryType, exp: Date.now() + 10 * 60 * 1000,
    });
    return { mediaId, url: `/api/portal/event-download-file?token=${encodeURIComponent(token)}`, resolution: extras.freeDigitalResolution, watermarked: extras.watermarkDownloads };
  });
}

export async function hasEventAllDigitalsPurchase(service: Service, projectId: string, email: string, photographerId: string | null, requestedCollectionIds?: string[]) {
  const orders: Array<Record<string, unknown>> = [];
  // Filter in SQL and page explicitly; a matching order after row 1000 is still valid.
  for (let offset = 0; offset < 20000; offset += 500) {
    const { data, error } = await service.from("orders")
      .select("id,photographer_id,package_id,package_name,status,payment_status,paid_at,refund_status,refund_amount_cents,parent_email,customer_email,cart_snapshot")
      .eq("project_id", projectId).order("id", { ascending: true }).range(offset, offset + 499);
    if (error) throw error;
    orders.push(...(data ?? []));
    if ((data?.length ?? 0) < 500) break;
    if (offset === 19500) throw new Error("Too many orders to verify digital access safely.");
  }
  const matching = orders.filter(row => {
    if (photographerId && row.photographer_id !== photographerId) return false;
    return hasCurrentDigitalPayment(row) && [row.parent_email, row.customer_email].some(value => clean(value).toLowerCase() === email.toLowerCase());
  });
  const packageIds = [...new Set(matching.map(row => clean(row.package_id)).filter(Boolean))];
  const packages = new Map<string, Record<string, unknown>>();
  for (let start = 0; start < packageIds.length; start += 300) {
    let query = service.from("packages").select("id,photographer_id,name,description,category").in("id", packageIds.slice(start, start + 300));
    if (photographerId) query = query.eq("photographer_id", photographerId);
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data ?? []) packages.set(row.id, row);
  }
  const covered = new Set<string>();
  for (const row of matching) {
    const pkg = packages.get(clean(row.package_id));
    const text = [row.package_name, pkg?.name, pkg?.description].map(clean).join(" ").toLowerCase();
    if (!isFullDigitalPurchaseLabel(text, pkg?.category)) continue;
    for (const entry of Array.isArray(row.cart_snapshot) ? row.cart_snapshot : []) {
      if (!entry || typeof entry !== "object" || (Number(entry.digitalLimit) > 0) || !isFullDigitalPurchaseLabel(clean(entry.packageName), entry.category)) continue;
      const scope = entry.purchasedEventScope;
      const ids = validateUuidArray(scope?.collectionIds, "purchasedCollectionIds", { min: 1, max: 5000 });
      if (scope?.version === 1 && scope.projectId === projectId && ids.ok) for (const id of ids.value) covered.add(id);
    }
  }
  // A paid album purchase never unlocks another album. Legacy purchases without
  // a saved scope need photographer review, as in the paid ZIP delivery flow.
  return requestedCollectionIds?.length ? requestedCollectionIds.every(id => covered.has(id)) : covered.size > 0;
}

export async function eventRequestedCollectionIds(service: Service, projectId: string, mediaIds: string[]) {
  const ids = new Set<string>();
  for (let offset = 0; offset < mediaIds.length; offset += 100) {
    const { data, error } = await service.from("media").select("id,collection_id").eq("project_id", projectId).in("id", mediaIds.slice(offset, offset + 100));
    if (error) throw error;
    for (const row of data ?? []) if (row.collection_id) ids.add(row.collection_id);
  }
  return [...ids];
}

// Bearer URLs remain bound to current owner, project/album grants, and invitations.
// Preview grants intentionally do not grant delivery or depend on purchase status.
export async function authorizeEventMediaToken(service: Service, payload: EventPreviewTokenPayload | EventGalleryBatchTokenPayload, delivery = false) {
  const projectId = validateUuid(payload.projectId, "projectId");
  const ids = validateUuidArray(payload.collectionIds, "collectionIds", { min: 1, max: 5000 });
  if (!projectId.ok || !ids.ok || !payload.collectionGrants || !clean(payload.viewerEmail)) return null;
  const { data: project, error } = await service.from("projects")
    .select("id,workflow_type,status,portal_status,expiration_date,photographer_id,access_mode,access_pin,email_required,gallery_settings")
    .eq("id", projectId.value).maybeSingle();
  if (error) throw error;
  if (!project || clean(project.workflow_type).toLowerCase() !== "event" || clean(project.status).toLowerCase() === "inactive" ||
    hasCalendarBoundaryPassed(project.expiration_date) || ["inactive", "closed", "pre_release"].includes(clean(project.portal_status).toLowerCase()) ||
    (project.photographer_id ?? null) !== (payload.photographerId ?? null) || createEventProjectDownloadGrant(project) !== payload.projectAccessGrant) return null;
  if (project.email_required !== false) {
    const { data: invited, error: inviteError } = await service.from("pre_release_emails").select("id").eq("project_id", project.id).eq("email", payload.viewerEmail.toLowerCase()).limit(1);
    if (inviteError) throw inviteError;
    if (!invited?.length) {
      const { data: any, error: anyError } = await service.from("pre_release_emails").select("id").eq("project_id", project.id).limit(1);
      if (anyError) throw anyError;
      if (any?.length) return null;
    }
  }
  let watermarkEnabled = true;
  if (project.photographer_id) {
    const { data: photographer, error: ownerError } = await service.from("photographers").select("id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at,watermark_enabled,business_name").eq("id", project.photographer_id).maybeSingle();
    if (ownerError) throw ownerError;
    if (!hasActiveSubscription(photographer)) return null;
    watermarkEnabled = photographer?.watermark_enabled !== false;
  }
  const allowed = new Set<string>();
  for (let start = 0; start < ids.value.length; start += 300) {
    const { data: rows, error: albumError } = await service.from("collections").select("id,kind,slug,access_mode,access_pin").eq("project_id", project.id).in("id", ids.value.slice(start, start + 300));
    if (albumError) throw albumError;
    for (const row of rows ?? []) if (createEventCollectionDownloadGrant(project.id, row) === payload.collectionGrants[row.id]) allowed.add(row.id);
  }
  if (allowed.size !== new Set(ids.value).size) return null;
  if (delivery) {
    const token = payload as EventGalleryBatchTokenPayload;
    if (token.downloadPolicyGrant !== createEventDownloadPolicyGrant(project.gallery_settings)) return null;
    const extras = normalizeEventGallerySettings(project.gallery_settings).extras;
    if (token.deliveryType === "favorites") {
      if (!extras.allowClientFavoriteDownloads || (extras.favoriteDownloadsRequireAllDigitalsPurchase && !await hasEventAllDigitalsPurchase(service, project.id, payload.viewerEmail.toLowerCase(), project.photographer_id, [...allowed]))) return null;
    } else if (!extras.freeDigitalRuleEnabled || !extras.showDownloadAllButton) return null;
  }
  return { project, collectionIds: allowed, watermarkEnabled };
}

async function readBoundedImage(url: string) {
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new Error(`Image unavailable (${response.status}).`);
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) { await response.body.cancel(); throw new Error("Image exceeds preview size limit."); }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("Image exceeds preview size limit.");
      parts.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}

export async function transformEventImage(input: Buffer, options: { resolution: "original" | "large" | "web" | "preview" | "thumbnail"; watermark: boolean; watermarkText?: string; preserveTransparency?: boolean }) {
  if (!input.length || input.length > MAX_IMAGE_BYTES) throw new Error("Invalid image size.");
  const source = sharp(input, { animated: false, limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" });
  const metadata = await source.metadata();
  if (!["jpeg", "png", "webp", "avif", "tiff", "heif"].includes(metadata.format || "") || !metadata.width || !metadata.height) throw new Error("Invalid preview image.");
  if (options.resolution === "original" && !options.watermark) {
    // Header parsing alone can succeed for a truncated file. Decode within the
    // same pixel limit before presenting it as a successfully delivered source.
    await source.clone().stats();
    return { buffer: input, contentType: metadata.format === "png" ? "image/png" : metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}` };
  }
  const bound = options.resolution === "thumbnail" ? 400 : options.resolution === "preview" ? 1200 : options.resolution === "web" ? 1600 : options.resolution === "large" ? 3600 : Math.max(metadata.width, metadata.height);
  const resized = source.rotate().resize(bound, bound, { fit: "inside", withoutEnlargement: true });
  let buffer = await (options.preserveTransparency ? resized.png() : resized.jpeg({ quality: options.resolution === "thumbnail" ? 72 : options.resolution === "preview" ? 78 : 92 })).toBuffer();
  if (options.watermark) {
    const output = await sharp(buffer).metadata(), width = output.width!, height = output.height!;
    const text = (clean(options.watermarkText) || "PROOF").slice(0, 100).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]!));
    const size = Math.max(18, Math.round(width / 17));
    const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g fill="white" stroke="black" stroke-width="0.5" opacity="0.38" font-family="Arial,sans-serif" font-size="${size}" font-weight="700" text-anchor="middle"><text x="50%" y="35%">${text}</text><text x="50%" y="65%">${text}</text></g></svg>`);
    const marked = sharp(buffer).composite([{ input: svg }]);
    buffer = await (options.preserveTransparency ? marked.png() : marked.jpeg({ quality: 90 })).toBuffer();
  }
  return { buffer, contentType: options.preserveTransparency ? "image/png" : "image/jpeg" };
}

export async function imageBytesFromSignedUrl(url: string, options: Parameters<typeof transformEventImage>[1]) {
  return transformEventImage(await readBoundedImage(url), options);
}

export async function eventImageBytes(row: EventDeliveryMedia, options: Parameters<typeof transformEventImage>[1]) {
  // DB row identity is authoritative. Never fetch a caller URL or redirect.
  const key = privateMediaKeyFromReference(row.storage_path);
  if (!key) throw new Error("A canonical private image key is required.");
  const urls = buildSignedMediaUrls({ storagePath: key, previewUrl: privateMediaKeyFromReference(row.preview_url) || null, thumbnailUrl: privateMediaKeyFromReference(row.thumbnail_url) || null });
  const candidates = options.resolution === "preview" || options.resolution === "thumbnail" ? [...new Set([options.resolution === "thumbnail" ? urls.thumbnailUrl : urls.previewUrl, urls.originalUrl].filter(Boolean))] : [urls.originalUrl].filter(Boolean);
  for (let index = 0; index < candidates.length; index++) {
    try { return await transformEventImage(await readBoundedImage(candidates[index]), options); }
    catch (error) { if (index === candidates.length - 1) throw error; }
  }
  throw new Error("No image is available.");
}
