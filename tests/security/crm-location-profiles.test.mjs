import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import sharp from "sharp";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

process.env.R2_ACCOUNT_ID ||= "test-account";
process.env.R2_ACCESS_KEY_ID ||= "test-key";
process.env.R2_SECRET_ACCESS_KEY ||= "test-secret";

const {
  crmLocationPhotoPublicRow,
  prepareCrmLocationPhoto,
} = await import("../../lib/crm-location-photos.ts");
const { parseCrmValues } = await import("../../lib/crm.ts");

const migration = source(
  "supabase/migrations/20260826150000_add_crm_location_profiles_and_photos.sql",
);
const api = source("app/api/dashboard/crm/route.ts");
const crm = source("lib/crm.ts");
const detail = source("lib/studio-bookings-detail-server.ts");
const detailTypes = source("lib/studio-bookings.ts");
const photoHelper = source("lib/crm-location-photos.ts");
const workspace = source("components/crm/crm-clients-workspace.tsx");

test("location profile migration is additive and stores public and staff fields separately", () => {
  assert.match(migration, /\bbegin;/i);
  assert.match(migration, /\bcommit;\s*$/i);
  assert.match(migration, /alter table public\.crm_locations/i);
  for (const column of [
    "arrival_instructions",
    "parking_instructions",
    "setup_instructions",
    "internal_notes",
    "latitude",
    "longitude",
    "place_id",
    "archived_at",
  ]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`, "i"));
  }
  assert.match(migration, /\(latitude is null\) = \(longitude is null\)/i);
  assert.match(migration, /latitude between -90 and 90/i);
  assert.match(migration, /longitude between -180 and 180/i);
  assert.match(crm, /arrivalInstructions: "arrival_instructions"/);
  assert.match(crm, /setupInstructions: "setup_instructions"/);
  assert.match(migration, /booking_campaign_template[\s\S]*arrival_instructions = case/i);
  assert.match(migration, /nullif\(btrim\(location\.arrival_instructions\), ''\) is null/i);

  const parsed = parseCrmValues("location", {
    arrivalInstructions: "Use the north entrance",
    setupInstructions: "Load in at 6:30",
    latitude: 43.59,
    longitude: -79.64,
    placeId: "place-123",
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data, {
    arrival_instructions: "Use the north entrance",
    setup_instructions: "Load in at 6:30",
    latitude: 43.59,
    longitude: -79.64,
    place_id: "place-123",
  });
});

test("location photos are tenant-bound, private, bounded, and authenticated read-only", () => {
  assert.match(migration, /create table public\.crm_location_photos \(/i);
  assert.match(
    migration,
    /foreign key \(location_id, client_id, photographer_id\)[\s\S]*references public\.crm_locations\(id, client_id, photographer_id\)/i,
  );
  assert.match(migration, /audience in \('client', 'staff'\)/i);
  assert.match(
    migration,
    /category in \(\s*'exterior', 'entrance', 'parking', 'loading', 'room', 'setup', 'other'\s*\)/i,
  );
  assert.match(migration, /unique \(photographer_id, request_key\)/i);
  assert.match(migration, /payload_fingerprint.*\^\[0-9a-f\]\{64\}\$/i);
  assert.match(migration, /current_count >= 12/i);
  assert.match(migration, /for update;[\s\S]*current_count/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(
    migration,
    /for select[\s\S]*to authenticated[\s\S]*crm_owns_photographer\(photographer_id\)/i,
  );
  assert.doesNotMatch(migration, /for (?:insert|update|delete|all)[\s\S]{0,80}to authenticated/i);
  assert.match(migration, /grant all on table public\.crm_location_photos to service_role/i);
  assert.match(migration, /crm-locations\/.*photographer_id.*location_id/i);
});

test("location and contact removal is owner-bound and preserves durable history", () => {
  assert.match(migration, /create or replace function public\.crm_remove_location_or_contact/i);
  assert.match(migration, /photographer\.user_id = p_actor_user_id/i);
  assert.match(migration, /job\.location_id = p_id[\s\S]*job\.photographer_id = p_photographer_id/i);
  assert.match(migration, /crm_location_photos[\s\S]*photo\.location_id = p_id/i);
  assert.match(migration, /crm_email_outbox[\s\S]*outbox\.contact_id = p_id/i);
  assert.match(migration, /crm_activities[\s\S]*activity\.contact_id = p_id/i);
  assert.match(migration, /set archived_at = timezone\('utc', now\(\)\), is_primary = false/i);
  assert.match(migration, /set is_primary = true[\s\S]*archived_at is null/i);
  assert.match(migration, /'disposition', disposition/i);
  assert.match(
    migration,
    /revoke all on function public\.crm_remove_location_or_contact[\s\S]*public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.crm_remove_location_or_contact[\s\S]*to service_role/i,
  );
  assert.match(api, /disposition: z\.enum\(\["deleted", "archived"\]\)/);
  assert.match(api, /p_actor_user_id: user\.id/);
  assert.match(api, /contact_archive_action_required/);
  assert.match(api, /photoObjectKeys\.map\(\(key\) => r2Delete\(key\)\)/);
});

test("archived campuses cannot be reused by contacts or future booking jobs", () => {
  assert.match(migration, /create trigger crm_contacts_require_active_location/i);
  assert.match(migration, /create trigger crm_booking_jobs_require_active_location/i);
  assert.match(migration, /location\.archived_at is null/i);
  assert.match(api, /active_booking_location_required/);
  assert.match(api, /contact_active_location_required/);
});

test("CRM photo API validates bytes server-side and never accepts an object key", () => {
  assert.match(api, /action: z\.literal\("uploadLocationPhoto"\)/);
  assert.match(api, /action: z\.literal\("deleteLocationPhoto"\)/);
  assert.match(api, /content: z\.string\(\)\.min\(4\)\.max\(CRM_LOCATION_MAX_INPUT_PHOTO_BASE64\)/);
  assert.doesNotMatch(api, /UploadLocationPhotoAction[\s\S]{0,1500}objectKey:/);
  assert.match(api, /\.eq\("photographer_id", input\.photographerId\)/);
  assert.match(api, /\.is\("archived_at", null\)/);
  assert.match(api, /payload_fingerprint: payloadFingerprint/);
  assert.match(api, /r2Upload\(objectKey, prepared\.bytes, prepared\.contentType, "private, no-store"\)/);
  assert.match(api, /await cleanupUpload\(\)/);
  assert.match(api, /await r2Delete\(photo\.object_key\)/);
  assert.doesNotMatch(photoHelper, /^import sharp from ["']sharp["'];/m);
  assert.match(photoHelper, /await import\(["']sharp["']\)/);
  assert.match(photoHelper, /Sharp does not preserve metadata/);
  assert.match(photoHelper, /\.jpeg\(\{ quality: 84, progressive: true, mozjpeg: true \}\)/);
  assert.match(workspace, /createImageBitmap\(file\)/);
  assert.match(workspace, /longestSide > 1600/);
  assert.match(workspace, /blob\.size <= 1024 \* 1024/);
  const publicRow = crmLocationPhotoPublicRow({
    id: "photo-1",
    photographer_id: "private-tenant",
    client_id: "client-1",
    location_id: "location-1",
    object_key: "crm-locations/private-tenant/location-1/photo.jpg",
    filename: "Entrance.jpg",
    audience: "client",
    category: "entrance",
    byte_size: 100,
    sort_order: 0,
  });
  assert.equal("object_key" in publicRow, false);
  assert.equal("objectKey" in publicRow, false);
});

test("photo preparation re-encodes to bounded JPEG and strips input metadata", async () => {
  const input = await sharp({
    create: {
      width: 24,
      height: 16,
      channels: 3,
      background: "#2468aa",
    },
  })
    .withMetadata({ orientation: 6 })
    .png()
    .toBuffer();
  const prepared = await prepareCrmLocationPhoto({
    filename: "../North Entrance.png",
    contentType: "image/png",
    content: input.toString("base64"),
  });
  const metadata = await sharp(prepared.bytes).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  assert.equal(prepared.contentType, "image/jpeg");
  assert.equal(prepared.filename, "North Entrance.jpg");
  assert.ok(prepared.byteSize <= 1_310_720);
  assert.match(prepared.contentSha256, /^[0-9a-f]{64}$/);
});

test("CRM dashboard returns only active campuses with signed photo DTOs", () => {
  assert.match(crm, /loadedLocationRows\.filter\(\(row\) => row\.archived_at == null\)/);
  assert.match(crm, /table: "crm_location_photos"/);
  assert.match(crm, /locationPhotos: locationPhotoRows/);
  assert.match(crm, /crmLocationPhotoPublicRow\(row\)/);
  assert.match(photoHelper, /previewUrl: objectKey \? r2PresignedGetUrl\(objectKey, 15 \* 60\) : ""/);
  const publicPhoto = crmLocationPhotoPublicRow({
    id: "photo-1",
    photographer_id: "private-tenant",
    client_id: "client-1",
    location_id: "location-1",
    object_key: "crm-locations/private-tenant/location-1/photo.jpg",
    filename: "Entrance.jpg",
    audience: "client",
    category: "entrance",
    byte_size: 100,
    sort_order: 0,
  });
  assert.equal("objectKey" in publicPhoto, false);
  assert.equal("photographerId" in publicPhoto, false);
  assert.match(publicPhoto.previewUrl, /^https:\/\/test-account\.r2\.cloudflarestorage\.com\//);
});

test("booking detail joins the exact owned event job and exposes only client-safe reuse data", () => {
  assert.match(
    detail,
    /\.from\("crm_booking_jobs"\)[\s\S]*\.eq\("photographer_id", photographerId\)[\s\S]*\.eq\("booking_event_id", eventId\)/,
  );
  assert.match(
    detail,
    /\.from\("crm_locations"\)[\s\S]*\.eq\("id", locationId\)[\s\S]*\.eq\("client_id", clientId\)[\s\S]*\.eq\("photographer_id", input\.photographerId\)/,
  );
  assert.match(detail, /\.eq\("audience", "client"\)/);
  assert.match(detail, /\.is\("archived_at", null\)/);
  assert.match(detail, /assignedContacts\[0\][\s\S]*primaryFallback\.length === 1/);
  assert.doesNotMatch(
    detail,
    /\.select\("[^"]*(?:setup_instructions|internal_notes)[^"]*"\)/,
  );
  assert.match(detail, /const schedule = normalizeEventGallerySettings\(source\?\.gallery_settings\)\.schedule/);
  assert.match(detailTypes, /locationProfile\?: StudioBookingLocationProfile \| null/);
  for (const field of [
    "arrivalInstructions",
    "parkingInstructions",
    "contactName",
    "contactEmail",
    "photos",
  ]) {
    assert.match(detailTypes, new RegExp(`\\b${field}\\b`));
  }
});

test("location saves support optimistic concurrency and immutable ownership", () => {
  assert.match(api, /expectedUpdatedAt: z\.string\(\)\.datetime/);
  assert.match(api, /updateQuery = updateQuery\.eq\("updated_at", input\.expectedUpdatedAt\)/);
  assert.match(api, /"crm_edit_conflict"/);
  assert.match(api, /"location_client_immutable"/);
  assert.match(api, /"contact_client_immutable"/);
  assert.match(api, /"crm_client_immutable"/);
  assert.match(api, /Latitude and longitude must be saved or cleared together/);
});
