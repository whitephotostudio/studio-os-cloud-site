import { schoolClassAllowsFreeDownloads } from "@/lib/school-gallery-downloads";
import { hasCurrentDigitalPayment } from "@/lib/digital-entitlement-payment";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { hasCalendarBoundaryPassed } from "@/lib/calendar-dates";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { privateMediaKeyFromReference } from "@/lib/private-media-references";
import { extractStoragePathFromSupabaseUrl } from "@/lib/storage-images";
import { hasActiveSubscription } from "@/lib/subscription-gate";
import { filterTombstonedSchoolPhotoAssets, loadSchoolPhotoTombstones, tombstoneFamilySet } from "@/lib/school-photo-deletions";
import { readPaidCutout, isManagedCutoutKey } from "@/lib/credit-cutout-access";
import { loadScopedSchoolCompositeMedia } from "@/lib/school-order-media";
import { buildSchoolCandidateFolders } from "@/lib/storage-folder";
import { eventImageBytes, transformEventImage, isFullDigitalPurchaseLabel } from "@/lib/event-media-delivery";
import { normalizeProofWatermarkOpacity, proofWatermarkVersion } from "@/lib/proof-watermark";

type Service = ReturnType<typeof createDashboardServiceClient>;
type School = { id: string; photographer_id?: string | null; local_school_id?: string | null; status?: string | null; portal_status?: string | null; expiration_date?: string | null; gallery_settings?: unknown };
type Student = { id: string; school_id?: string | null; pin?: string | null; photo_url?: string | null; class_id?: string | null; class_name?: string | null; folder_name?: string | null };
type Media = { id: string; storage_path: string | null; preview_url?: string | null; thumbnail_url?: string | null; download_url?: string | null };
export type SchoolMediaToken = {
  v: 1; kind: "school-gallery-preview" | "school-photo-download"; schoolId: string; photographerId: string | null;
  mediaKey: string; viewerEmail: string; studentGrants: Record<string, string>; schoolGrant: string; exp: number;
  resolution?: "original" | "large" | "web"; watermark?: boolean; watermarkText?: string;
  policyGrant?: string; downloadType?: "gallery" | "favorites";
};
function secret() { const value = process.env.EVENT_DOWNLOAD_TOKEN_SECRET || process.env.DOWNLOAD_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY; if (!value) throw new Error("Missing portal media secret."); return value; }
function grant(value: unknown) { return createHmac("sha256", secret()).update(JSON.stringify(value)).digest("hex"); }
function schoolGrant(row: School) { return grant(["school-media-access", row.id, row.photographer_id ?? null, row.local_school_id ?? null, row.status ?? null, row.portal_status ?? null, row.expiration_date ?? null]); }
function studentGrant(row: Student) { return grant(["school-student-access", row.id, row.school_id, row.pin, row.photo_url, row.class_id, row.class_name, row.folder_name]); }
function policyGrant(settings: unknown) { return grant(["school-media-policy", normalizeEventGallerySettings(settings).extras]); }
function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export function createSchoolMediaToken(payload: SchoolMediaToken) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${grant(encoded)}`;
}
export function verifySchoolMediaToken(token: string, kind: SchoolMediaToken["kind"]) {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || encoded.length > 25000) throw new Error("Invalid school media token.");
  const expected = Buffer.from(grant(encoded)), actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid school media token.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SchoolMediaToken;
  if (payload.v !== 1 || payload.kind !== kind || !Number.isFinite(payload.exp) || payload.exp <= Date.now() || !payload.mediaKey || !payload.studentGrants || !Object.keys(payload.studentGrants).length) throw new Error("Expired school media token.");
  return payload;
}

export function schoolMediaGrant(options: { school: School; students: Student[]; email: string; mediaKey: string; kind: SchoolMediaToken["kind"]; downloadType?: "gallery" | "favorites" }) {
  const extras = normalizeEventGallerySettings(options.school.gallery_settings).extras;
  return createSchoolMediaToken({
    v: 1, kind: options.kind, schoolId: options.school.id, photographerId: options.school.photographer_id ?? null,
    mediaKey: options.mediaKey, viewerEmail: options.email.toLowerCase(), studentGrants: Object.fromEntries(options.students.map(row => [row.id, studentGrant(row)])), schoolGrant: schoolGrant(options.school),
    exp: Date.now() + (options.kind === "school-gallery-preview" ? 6 * 60 * 60 : 10 * 60) * 1000,
    ...(options.kind === "school-photo-download" ? { resolution: extras.freeDigitalResolution, watermark: extras.watermarkDownloads, watermarkText: "PROOF", policyGrant: policyGrant(options.school.gallery_settings), downloadType: options.downloadType ?? "gallery" } : {}),
  });
}

export function schoolPreviewUrl(options: Parameters<typeof schoolMediaGrant>[0] & { watermarkOpacity?: number | null }) {
  const token = schoolMediaGrant({ ...options, kind: "school-gallery-preview" });
  // Stable image path also lets saved carts recover identity after token expiry.
  const name = createHash("sha256").update(options.mediaKey).digest("hex");
  return `/api/portal/school-preview/${name}.jpg?token=${encodeURIComponent(token)}&proof=${encodeURIComponent(proofWatermarkVersion(options.watermarkOpacity))}`;
}

export function schoolPreviewPresentation<M extends Media, C extends Media, S extends Student>(options: { school: School; students: Student[]; visibleStudents: S[]; email: string; media: M[]; composites: C[]; nobgUrls: Record<string, string>; watermarkOpacity?: number | null }) {
  const preview = (mediaKey: string) => schoolPreviewUrl({ school: options.school, students: options.students, email: options.email, mediaKey, kind: "school-gallery-preview", watermarkOpacity: options.watermarkOpacity });
  const present = <T extends Media>(row: T) => {
    if (!row.storage_path) return { ...row, preview_url: null, thumbnail_url: null, download_url: undefined };
    const url = preview(row.storage_path);
    return { ...row, preview_url: url, thumbnail_url: `${url}&size=thumbnail`, download_url: undefined };
  };
  return {
    media: options.media.map(present), composites: options.composites.map(present),
    students: options.visibleStudents.map(row => {
      const key = privateMediaKeyFromReference(row.photo_url) || extractStoragePathFromSupabaseUrl(row.photo_url);
      return { ...row, photo_storage_path: key || null, photo_url: key ? preview(key) : null };
    }),
    nobgUrls: Object.fromEntries(Object.entries(options.nobgUrls).flatMap(([id, url]) => {
      const key = privateMediaKeyFromReference(url) || extractStoragePathFromSupabaseUrl(url);
      return key ? [[id, preview(key)]] : [];
    })),
  };
}

export async function hasSchoolAllDigitalsPurchase(service: Service, schoolId: string, studentIds: string[], email: string, photographerId: string | null) {
  const covered = new Set<string>();
  for (let offset = 0; offset < 20000; offset += 500) {
    const { data, error } = await service.from("orders").select("id,photographer_id,student_id,package_name,status,payment_status,paid_at,refund_status,refund_amount_cents,parent_email,customer_email,cart_snapshot").eq("school_id", schoolId).in("student_id", studentIds).order("id", { ascending: true }).range(offset, offset + 499);
    if (error) throw error;
    for (const row of data ?? []) {
      if (photographerId && row.photographer_id !== photographerId) continue;
      if (!hasCurrentDigitalPayment(row)) continue;
      if (![row.parent_email, row.customer_email].some(value => clean(value).toLowerCase() === email.toLowerCase())) continue;
      if (!isFullDigitalPurchaseLabel(clean(row.package_name))) continue;
      if (Array.isArray(row.cart_snapshot) && row.cart_snapshot.length && !row.cart_snapshot.some(entry => entry && typeof entry === "object" && !(Number(entry.digitalLimit) > 0) && isFullDigitalPurchaseLabel(clean(entry.packageName), entry.category))) continue;
      covered.add(row.student_id);
    }
    if ((data?.length ?? 0) < 500) return studentIds.length > 0 && studentIds.every(id => covered.has(id));
  }
  throw new Error("Too many school orders to verify download permissions safely.");
}

export function schoolStudentsForMediaKey(school: School, students: Student[], key: string) {
  return students.filter(student => {
    const ownKey = privateMediaKeyFromReference(student.photo_url) || extractStoragePathFromSupabaseUrl(student.photo_url);
    return ownKey === key || buildSchoolCandidateFolders({ activeSchool: school, studentCandidates: [student], selectedSchoolId: school.id }).some(prefix => key.startsWith(`${prefix}/`));
  });
}
export async function buildSchoolFavoriteDownloadAccess(service: Service, school: School, students: Student[], email: string, mediaKeys?: string[]) {
  const requiredStudents = mediaKeys ? [...new Map(mediaKeys.flatMap(key => schoolStudentsForMediaKey(school, students, key)).map(row => [row.id, row])).values()] : students;
  const settings = normalizeEventGallerySettings(school.gallery_settings).extras;
  const raw = school.gallery_settings && typeof school.gallery_settings === "object" ? school.gallery_settings as Record<string, unknown> : {};
  const extras = raw.extras && typeof raw.extras === "object" ? raw.extras as Record<string, unknown> : raw;
  const enabled = extras.allowClientFavoriteDownloads === true || extras.allowClientFavoriteDownloads === "true";
  const hasPurchasedAllDigitals = enabled && settings.favoriteDownloadsRequireAllDigitalsPurchase && (!mediaKeys || mediaKeys.every(key => schoolStudentsForMediaKey(school, students, key).length > 0)) && await hasSchoolAllDigitalsPurchase(service, school.id, requiredStudents.map(row => row.id), email, school.photographer_id ?? null);
  return { enabled, requiresAllDigitalsPurchase: settings.favoriteDownloadsRequireAllDigitalsPurchase, hasPaidDigitalOrder: hasPurchasedAllDigitals, hasPurchasedAllDigitals,
    canDownload: enabled && (!settings.favoriteDownloadsRequireAllDigitalsPurchase || hasPurchasedAllDigitals),
    message: !enabled ? "Favorites download is turned off for this gallery." : settings.favoriteDownloadsRequireAllDigitalsPurchase && !hasPurchasedAllDigitals ? "Favorites download unlocks after the full digital package is purchased." : null };
}

export async function authorizeSchoolMediaToken(service: Service, token: SchoolMediaToken) {
  const { data: school, error } = await service.from("schools").select("id,photographer_id,local_school_id,status,portal_status,expiration_date,gallery_settings").eq("id", token.schoolId).maybeSingle();
  if (error) throw error;
  if (!school || schoolGrant(school) !== token.schoolGrant || (school.photographer_id ?? null) !== token.photographerId || hasCalendarBoundaryPassed(school.expiration_date) || ["pre_release", "closed", "inactive"].includes(clean(school.portal_status ?? school.status).toLowerCase().replaceAll("-", "_"))) return null;
  const { data: students, error: studentError } = await service.from("students").select("id,school_id,pin,photo_url,class_id,class_name,folder_name").eq("school_id", token.schoolId).in("id", Object.keys(token.studentGrants));
  if (studentError) throw studentError;
  if (!students?.length || students.length !== Object.keys(token.studentGrants).length || students.some(row => studentGrant(row) !== token.studentGrants[row.id])) return null;
  const plainKey = token.mediaKey.replace(/^nobg-photos\//i, "");
  if (!schoolStudentsForMediaKey(school, students, plainKey).length) {
    const composites = await loadScopedSchoolCompositeMedia(service, school, students.map(row => row.class_name));
    if (!composites.some(row => row.storage_path === token.mediaKey)) return null;
  }
  let watermarkEnabled = true;
  let watermarkOpacity: number | null = null;
  if (school.photographer_id) {
    const { data: owner, error: ownerError } = await service.from("photographers").select("id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at,watermark_enabled,watermark_opacity").eq("id", school.photographer_id).maybeSingle();
    if (ownerError) throw ownerError;
    if (!hasActiveSubscription(owner)) return null;
    watermarkEnabled = owner?.watermark_enabled !== false;
    watermarkOpacity = normalizeProofWatermarkOpacity(owner?.watermark_opacity);
  }
  const visible = filterTombstonedSchoolPhotoAssets([{ key: token.mediaKey, name: "photo.jpg", url: "" }], tombstoneFamilySet(await loadSchoolPhotoTombstones(service, school.id, { fresh: true })));
  if (!visible.length) return null;
  if (token.kind === "school-photo-download") {
    if (token.policyGrant !== policyGrant(school.gallery_settings)) return null;
    const extras = normalizeEventGallerySettings(school.gallery_settings).extras;
    if (token.downloadType === "favorites") {
      if (!extras.allowClientFavoriteDownloads || (extras.favoriteDownloadsRequireAllDigitalsPurchase && !await hasSchoolAllDigitalsPurchase(service, school.id, students.map(row => row.id), token.viewerEmail, school.photographer_id))) return null;
    } else if (!extras.freeDigitalRuleEnabled || !extras.showDownloadAllButton || students.some(student => !schoolClassAllowsFreeDownloads(school.gallery_settings, student.class_id, student.class_name))) return null;
  }
  return { school, students, watermarkEnabled, watermarkOpacity };
}

export async function schoolImageBytes(service: Service, token: SchoolMediaToken, preview = true, thumbnail = false, watermarkEnabled = true, watermarkOpacity: number | null = null) {
  const options = { resolution: preview ? thumbnail ? "thumbnail" as const : "preview" as const : token.resolution || "original" as const, watermark: preview ? watermarkEnabled : !!token.watermark, watermarkText: token.watermarkText || "PROOF", watermarkOpacity: preview ? watermarkOpacity : null };
  if (isManagedCutoutKey(token.mediaKey)) return transformEventImage(await readPaidCutout(service, token.photographerId || "", token.mediaKey), { ...options, preserveTransparency: true, watermark: preview ? false : options.watermark });
  return eventImageBytes({ id: token.mediaKey, collection_id: null, storage_path: token.mediaKey }, options);
}
