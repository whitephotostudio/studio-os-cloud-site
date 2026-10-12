import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const helperSource = source("lib/school-photo-deletions.ts");
const storageFolderSource = source("lib/storage-folder.ts");
const digitalDeliverySource = source("lib/digital-delivery.ts");
const routeSource = source(
  "app/api/dashboard/schools/[schoolId]/students/[studentId]/photos/route.ts",
);
const folderRouteSource = source("app/api/dashboard/storage-folder/route.ts");
const imageProxySource = source("app/api/r2/img/[...path]/route.ts");
const desktopSyncSource = source("app/api/dashboard/schools/desktop-sync/route.ts");
const captureDeleteSource = source("app/api/dashboard/capture/delete/route.ts");
const captureMoveSource = source("app/api/dashboard/capture/move/route.ts");
const galleryContextSource = source("app/api/portal/gallery-context/route.ts");
const schoolAccessSource = source("app/api/portal/school-access/route.ts");
const schoolDownloadsSource = source("app/api/portal/school-downloads/route.ts");
const migrationSource = source(
  "supabase/migrations/20260824153000_create_school_photo_deletions.sql",
);

const executableHelperSource = ts.transpileModule(
  helperSource
    .replace('import type { SupabaseClient } from "@supabase/supabase-js";\n', "")
    .replace(
      'import { normalizeR2Key } from "@/lib/r2-access-security";',
      `const normalizeR2Key = (value, options = {}) => {
        const raw = String(value ?? "").trim();
        const unsafeQueryChars = !options.allowQueryCharacters && (raw.includes("?") || raw.includes("#"));
        if (!raw || raw.startsWith("/") || raw.includes("\\\\") || raw.includes("..") || raw.includes("://") || unsafeQueryChars) return null;
        if (raw.split("/").some((segment) => !segment || segment === "." || segment === "..")) return null;
        return raw;
      };`,
    )
    .replace(
      'import { r2KeyFromAnyUrl } from "@/lib/r2-signed-urls";',
      `const r2KeyFromAnyUrl = (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "";
        const marker = "/api/r2/img/";
        if (raw.includes(marker)) return decodeURIComponent(raw.split(marker)[1].split("?")[0]);
        if (raw.includes("://")) {
          const parsed = new URL(raw);
          const path = parsed.pathname.replace(/^\\/+/, "");
          if (/\\.r2\\.cloudflarestorage\\.com$/i.test(parsed.host)) {
            return decodeURIComponent(path.split("/").slice(1).join("/"));
          }
          return decodeURIComponent(path);
        }
        return raw;
      };`,
    )
    .replace(
      'import { extractStoragePathFromSupabaseUrl } from "@/lib/storage-images";',
      `const extractStoragePathFromSupabaseUrl = (value) => {
        const raw = String(value ?? "").trim();
        const marker = "/api/r2/img/";
        if (raw.includes(marker)) return decodeURIComponent(raw.split(marker)[1].split("?")[0]);
        return raw && !raw.includes("://") ? raw : null;
      };`,
    ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const helper = await import(
  `data:text/javascript;base64,${Buffer.from(executableHelperSource).toString("base64")}`
);

test("canonicalizes every representation into one school photo family", () => {
  const family = "2026/Jane Smith/portrait 01";
  for (const key of [
    `local-school/${family}.jpg`,
    `database-id/${family}_preview.jpg`,
    `schools/database-id/${family}_thumbnail.jpg`,
    `photos/local-school/${family}_cutout.png`,
    `nobg-photos/local-school/${family}.jpg.png`,
    `thumbs/schools/database-id/${family}_nobg.png`,
  ]) {
    assert.equal(helper.schoolPhotoFamilyForKey(key), family, key);
  }
});

test("decodes URL references, strips an R2 S3 bucket, and preserves bare percent keys", () => {
  const encodedProxy =
    "/api/r2/img/schools/school-id/Class%20A/Student/portrait%20%26%20caf%C3%A9%20%28final%29%20%231.jpg";
  assert.equal(
    helper.schoolPhotoFamilyForKey(
      helper.storageKeyFromSchoolPhotoReference(encodedProxy),
    ),
    "Class A/Student/portrait & café (final) #1",
  );
  assert.equal(
    helper.storageKeyFromSchoolPhotoReference(
      "https://account.r2.cloudflarestorage.com/whitephoto-media/local-id/Class%20A/Student/photo.jpg?X-Amz-Signature=test",
    ),
    "local-id/Class A/Student/photo.jpg",
  );
  assert.equal(
    helper.storageKeyFromSchoolPhotoReference(
      "local-id/Class A/Student/literal%26name.jpg",
    ),
    "local-id/Class A/Student/literal%26name.jpg",
  );
});

test("accepts only canonical original keys and identifies the full cleanup family", () => {
  const original = "schools/school-id/Class A/Student One/photo.png";
  assert.equal(helper.canonicalOriginalSchoolPhotoKey(original), original);
  assert.equal(
    helper.canonicalOriginalSchoolPhotoKey(
      "schools/school-id/Class A/Student One/photo_preview.jpg",
    ),
    null,
  );
  assert.equal(helper.canonicalOriginalSchoolPhotoKey("https://bad.test/photo.jpg"), null);
  const variants = helper.schoolPhotoVariantKeys(original);
  assert.ok(variants.includes(original));
  assert.ok(variants.includes("schools/school-id/Class A/Student One/photo_preview.jpg"));
  assert.ok(variants.includes("nobg-photos/schools/school-id/Class A/Student One/photo_cutout.png"));
});

test("authorizes exact student folders across legacy and namespaced school roots", () => {
  const folders = helper.buildStudentPhotoFolderPrefixes({
    school: { id: "school-id", local_school_id: "local-id" },
    student: {
      class_name: "Class A",
      folder_name: "Student One",
      photo_url: "/api/r2/img/local-id/Class%20A/Student%20One/photo.jpg",
    },
  });
  assert.ok(folders.includes("local-id/Class A/Student One"));
  assert.ok(folders.includes("school-id/Class A/Student One"));
  assert.ok(folders.includes("schools/school-id/Class A/Student One"));
  assert.ok(folders.includes("photos/local-id/Class A/Student One"));
  assert.equal(
    helper.keyBelongsToStudentPhotoFolders(
      "schools/school-id/Class A/Student One/photo.jpg",
      folders,
    ),
    true,
  );
  assert.equal(
    helper.keyBelongsToStudentPhotoFolders(
      "schools/school-id/Class A/Other Student/photo.jpg",
      folders,
    ),
    false,
  );
  assert.equal(
    helper.keyBelongsToStudentPhotoFolders(
      "schools/school-id/Class A/Student One/nested/photo.jpg",
      folders,
    ),
    false,
  );
});

test("rejects representative folders and rows outside the selected school's roots", () => {
  const school = { id: "owned-id", local_school_id: "owned-local" };
  const folders = helper.buildStudentPhotoFolderPrefixes({
    school,
    student: {
      school_id: "owned-id",
      class_name: "Class A",
      folder_name: "Student One",
      photo_url: "victim-id/Class A/Student One/stolen.jpg",
    },
  });
  assert.ok(!folders.includes("victim-id/Class A/Student One"));
  assert.deepEqual(
    helper.buildStudentPhotoFolderPrefixes({
      school,
      student: {
        school_id: "victim-id",
        class_name: "Class A",
        folder_name: "Student One",
      },
    }),
    [],
  );

  const [owned, forged] = helper.clearOutOfScopeSchoolPhotoReferences(
    [
      {
        school_id: "owned-id",
        photo_url: "schools/owned-id/Class A/Student One/owned.jpg",
      },
      {
        school_id: "owned-id",
        photo_url: "schools/victim-id/Class A/Student One/stolen.jpg",
      },
    ],
    school,
  );
  assert.equal(owned.photo_url, "schools/owned-id/Class A/Student One/owned.jpg");
  assert.equal(forged.photo_url, null);
});

test("rejects path-shaped, padded, control, query, and reserved local school ids", () => {
  for (const malicious of [
    "schools/victim-id",
    "../victim",
    " local-id",
    "local-id ",
    "local?id",
    "local#id",
    "schools",
    "photos",
    "nobg-photos",
  ]) {
    assert.equal(helper.safeLocalSchoolStorageId(malicious), null, malicious);
    assert.ok(
      !helper
        .schoolStorageRoots({ id: "owned-id", local_school_id: malicious })
        .includes(malicious),
      malicious,
    );
  }
  assert.equal(helper.safeLocalSchoolStorageId("local-id"), "local-id");
});

test("filters preserved R2 objects by tombstoned family", () => {
  const family = "Class A/Student One/photo";
  const rows = [
    { key: `local-id/${family}.jpg`, url: "a", name: "photo.jpg" },
    { key: `schools/school-id/${family}_cutout.png`, url: "b", name: "photo_cutout.png" },
    { key: "local-id/Class A/Student One/keep.jpg", url: "c", name: "keep.jpg" },
  ];
  assert.deepEqual(
    helper
      .filterTombstonedSchoolPhotoAssets(rows, new Set([family]))
      .map((row) => row.key),
    ["local-id/Class A/Student One/keep.jpg"],
  );
});

test("DELETE is authenticated, agreement-gated, owner scoped, tombstone-first, and idempotent", () => {
  assert.match(routeSource, /export async function DELETE/);
  assert.match(routeSource, /resolveDashboardAuth\(request\)/);
  assert.match(routeSource, /guardAgreement/);
  assert.match(routeSource, /eq\("photographer_id", photographer\.id\)/);
  assert.match(routeSource, /eq\("school_id", schoolId\)/);
  assert.match(routeSource, /canonicalOriginalSchoolPhotoKey/);
  assert.match(routeSource, /keyBelongsToStudentPhotoFolders/);
  assert.match(routeSource, /safeLocalSchoolStorageId/);
  assert.match(routeSource, /isUuid\(localSchoolId\)/);
  assert.match(
    routeSource,
    /isUuid\(localSchoolId\)[\s\S]*?\.eq\("id", localSchoolId\)[\s\S]*?Promise\.resolve\(\{ data: \[\], error: null \}\)/,
  );
  assert.match(routeSource, /matchingSchoolIds\.size === 1/);
  assert.match(routeSource, /listR2FolderImages/);
  assert.match(routeSource, /from\("school_photo_deletions"\)[\s\S]*\.upsert/);
  assert.match(routeSource, /ignoreDuplicates: true/);
  assert.match(routeSource, /disposition: "removed_from_gallery"/);
  assert.match(routeSource, /deletedKeys: keys/);
  assert.match(routeSource, /remainingPhotos: remainingAssets/);
  assert.match(routeSource, /photoUrl: nextRepresentativeKey/);
  assert.doesNotMatch(routeSource, /r2Delete|DeleteObjectsCommand/);
});

test("legacy mobile capture removal also uses durable soft deletion", () => {
  assert.match(captureDeleteSource, /guardAgreement/);
  assert.match(captureDeleteSource, /keyBelongsToStudentPhotoFolders/);
  assert.match(captureDeleteSource, /from\("school_photo_deletions"\)[\s\S]*\.upsert/);
  assert.match(captureDeleteSource, /invalidateSchoolPhotoTombstones/);
  assert.match(captureDeleteSource, /storage_family: family/);
  assert.match(captureDeleteSource, /disposition: "removed_from_gallery"/);
  assert.doesNotMatch(captureDeleteSource, /r2DeleteWithVariants|DeleteObjectsCommand/);
});

test("mobile photo moves cannot resurrect a tombstoned source", () => {
  assert.match(captureMoveSource, /keyBelongsToStudentPhotoFolders/);
  assert.match(captureMoveSource, /deletedFamilies\.has\(sourceFamily\)/);
  assert.match(captureMoveSource, /status: 410/);
  assert.match(captureMoveSource, /from\("school_photo_deletions"\)[\s\S]*\.upsert/);
  assert.match(captureMoveSource, /sourceBytesPreserved: true/);
  assert.doesNotMatch(
    captureMoveSource,
    /source delete failed \(copy already done\)/,
  );
});

test("all gallery reload paths and direct image reads respect tombstones", () => {
  assert.match(folderRouteSource, /filterTombstonedSchoolPhotoAssets/);
  assert.match(folderRouteSource, /ownership\.schoolId/);
  assert.match(imageProxySource, /authorizedSchoolId/);
  assert.match(helperSource, /\.eq\("school_id", normalizedSchoolId\)/);
  assert.match(
    imageProxySource,
    /loadTombstonedFamilies\([\s\S]*authorizedSchoolId/,
  );
  assert.match(imageProxySource, /status: 410/);
  assert.match(desktopSyncSource, /photoDeletions:/);
  assert.match(desktopSyncSource, /incomingPhotoWasDeleted/);
  assert.match(helperSource, /\.order\("created_at", \{ ascending: true \}\)/);
  assert.match(helperSource, /\.order\("id", \{ ascending: true \}\)/);
  assert.match(helperSource, /\.range\(from, from \+ TOMBSTONE_PAGE_SIZE - 1\)/);
  assert.match(helperSource, /TOMBSTONE_CACHE_MAX_ENTRIES/);
  assert.match(routeSource, /invalidateSchoolPhotoTombstones\(schoolId\)/);
});

test("portal routes cannot sign tombstoned representatives or cross school scope", () => {
  assert.match(galleryContextSource, /!isUuid\(selectedSchoolId\)/);
  assert.doesNotMatch(galleryContextSource, /: await studentQuery;/);
  assert.match(galleryContextSource, /await refundPortalPinAttempt\(request, \{ kind: "school", galleryId: selectedSchoolId, pin: selectedPin, email: selectedEmail \}\)/);
  assert.match(galleryContextSource, /looksLikeEmail\(selectedEmail\)/);
  assert.match(galleryContextSource, /hasCalendarBoundaryPassed/);
  assert.match(galleryContextSource, /clearTombstonedSchoolPhotoReferences/);
  assert.match(galleryContextSource, /clearOutOfScopeSchoolPhotoReferences/);
  assert.match(galleryContextSource, /tombstonedFamilies/);
  assert.match(galleryContextSource, /schoolId: activeSchool\.id/);
  assert.doesNotMatch(galleryContextSource, /\.ilike\("school_name"/);
  assert.match(
    galleryContextSource,
    /\.eq\("pin", selectedPin\)[\s\S]*?\.eq\("school_id", selectedSchoolId\)/,
  );
  assert.match(schoolAccessSource, /clearTombstonedSchoolPhotoReferences/);
  assert.match(schoolAccessSource, /clearOutOfScopeSchoolPhotoReferences/);
  assert.match(
    storageFolderSource,
    /buildStudentPhotoFolderPrefixes\(\{ school, student \}\)/,
  );
  assert.doesNotMatch(storageFolderSource, /folderFromPhotoUrl/);
  assert.match(
    digitalDeliverySource,
    /service: params\.service,[\s\S]*?schoolId: params\.order\.school_id/,
    "digital delivery must keep removed school photos filtered",
  );
  assert.doesNotMatch(schoolAccessSource, /\.ilike\("school_name"/);
  assert.doesNotMatch(schoolDownloadsSource, /\.ilike\("school_name"/);
});

test("actual school revalidation refunds only the exact successful durable failed-PIN reservation", async () => {
  const schoolId = "10000000-0000-4000-8000-000000000001";
  const foreignSchoolId = "10000000-0000-4000-8000-000000000002";
  const student = { id: "child", school_id: schoolId, pin: "12345", first_name: "Synthetic", class_name: "Class" };
  const school = { id: schoolId, school_name: "Synthetic school", photographer_id: null };
  const counts = new Map(), reservations = new Map();
  let successfulRefunds = 0, signed = 0;
  const compile = (value) => ts.transpileModule(value, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const execute = (value, dependencies) => {
    const exports = {};
    new Function("require", "exports", "process", compile(value))((name) => {
      if (name in dependencies) return dependencies[name];
      if (name.startsWith("node:")) return require(name);
      assert.fail(`Unexpected school authorization fixture import: ${name}`);
    }, exports, { env: { DOWNLOAD_TOKEN_SECRET: "synthetic-school-photo-reservation-key",
      UPSTASH_REDIS_REST_URL: "https://redis.invalid", UPSTASH_REDIS_REST_TOKEN: "synthetic" } });
    return exports;
  };
  const budget = execute(source("lib/portal-pin-rate-limit.ts"), {
    "@/lib/rate-limit": { getClientIp: () => "192.0.2.1" },
    "@upstash/redis": { Redis: class {
      async eval(script, keys, args) {
        if (script.includes("redis.call('INCR'")) {
          assert.equal(keys.length, 3);
          counts.set(keys[0], (counts.get(keys[0]) || 0) + 1);
          counts.set(keys[1], (counts.get(keys[1]) || 0) + 1);
          reservations.set(keys[2], args[0]);
          return [1, Date.now()];
        }
        assert.match(script, /redis\.call\('DEL', KEYS\[3\]\)/);
        if (reservations.get(keys[2]) !== args[0]) return 0;
        reservations.delete(keys[2]); successfulRefunds++;
        for (const key of keys.slice(0, 2)) counts.set(key, Math.max(0, (counts.get(key) || 0) - 1));
        return 1;
      }
    } },
  });
  const service = { from(table) {
    const filters = []; let single = false;
    const query = { select() { return query; }, eq(key, value) { filters.push(row => row[key] === value); return query; },
      maybeSingle() { single = true; return query; }, then(resolve, reject) {
        const rows = (table === "schools" ? [school] : table === "students" ? [student] : [])
          .filter(row => filters.every(filter => filter(row)));
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
      } };
    return query;
  } };
  const route = execute(galleryContextSource, {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/parent-gallery-session-request": { runParentGallerySessionRoute: () => assert.fail("Legacy revalidation is required") },
    "@/lib/dashboard-auth": { createDashboardServiceClient: () => service },
    "@/lib/portal-pin-rate-limit": budget,
    "@/lib/order-currency": {}, "@/lib/proof-watermark": {},
    "@/lib/school-order-media": { loadScopedSchoolCompositeMedia: async () => [] },
    "@/lib/school-portal-media": { schoolPreviewPresentation: input => { signed++; return {
      students: input.visibleStudents, media: [], composites: [], nobgUrls: {},
    }; }, buildSchoolFavoriteDownloadAccess: async () => ({}) },
    "@/lib/event-gallery-settings": { sanitizeEventGallerySettingsForClient: () => ({ extras: {} }) },
    "@/lib/school-gallery-downloads": { buildSchoolGalleryDownloadAccess: async () => ({}) },
    "@/lib/package-profile-selection": {},
    "@/lib/storage-folder": { buildSchoolCandidateFolders: () => [], loadFolderMediaRows: async () => [], loadNoBgUrlMapForMediaRows: async () => ({}) },
    "@/lib/subscription-gate": {}, "@/lib/checkout-tax": {}, "@/lib/storage-images": {},
    "@/lib/backdrop-media-references": {}, "@/lib/online-backdrop-policy": {}, "@/lib/private-media-references": {},
    "@/lib/calendar-dates": { hasCalendarBoundaryPassed: () => false },
    "@/lib/r2-access-security": { isUuid: value => /^[a-f0-9-]{36}$/i.test(value) },
    "@/lib/school-photo-deletions": { loadSchoolPhotoTombstones: async () => [], tombstoneFamilySet: () => new Set(),
      clearTombstonedSchoolPhotoReferences: rows => rows, clearOutOfScopeSchoolPhotoReferences: rows => rows },
  });
  const request = (pin, selectedSchoolId = schoolId) => new Request("https://fixture.invalid/api/portal/gallery-context", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schoolId: selectedSchoolId, pin, email: "parent@example.test" }),
  });
  const good = request(student.pin);
  assert.equal(await budget.portalPinAttemptLimit(good), null);
  assert.equal((await route.POST(good)).status, 200);
  assert.equal(successfulRefunds, 1, "explicit refund and proof-cookie grant cannot refund twice");
  assert.equal([...counts.values()].reduce((total, value) => total + value, 0), 0);
  for (const bad of [request("wrong-pin"), request(student.pin, foreignSchoolId)]) {
    assert.equal(await budget.portalPinAttemptLimit(bad), null);
    assert.equal((await route.POST(bad)).status, 404);
  }
  assert.equal(successfulRefunds, 1, "unknown schools and wrong PINs never refund a failed attempt");
  assert.equal([...counts.values()].reduce((total, value) => total + value, 0), 4, "both shared failure windows retain both failures");
  assert.equal(signed, 1, "only current exact school/PIN validation reaches media presentation");
});

test("migration provides owner-only reads and blocks legacy representative resurrection", () => {
  assert.match(migrationSource, /create table if not exists public\.school_photo_deletions/i);
  assert.match(migrationSource, /unique \(school_id, storage_key\)/i);
  assert.match(migrationSource, /schools_local_school_id_safe_storage_segment/i);
  assert.match(migrationSource, /schools_local_school_id_unique_nonblank_idx/i);
  assert.match(migrationSource, /create table if not exists public\.school_storage_root_claims/i);
  assert.match(migrationSource, /root text primary key/i);
  assert.match(migrationSource, /sync_school_storage_root_claims/i);
  assert.match(
    migrationSource,
    /revoke all on table public\.school_storage_root_claims from authenticated/i,
  );
  assert.match(migrationSource, /alter table public\.school_photo_deletions enable row level security/i);
  assert.match(migrationSource, /for select[\s\S]*to authenticated[\s\S]*user_id = auth\.uid\(\)/i);
  assert.match(
    migrationSource,
    /revoke all on table public\.school_photo_deletions from authenticated;[\s\S]*grant select on table public\.school_photo_deletions to authenticated;/i,
  );
  assert.match(migrationSource, /prevent_tombstoned_student_photo_resurrection/i);
  assert.match(migrationSource, /school_photo_percent_decode/i);
  assert.match(migrationSource, /convert_from\(encoded_bytes, 'UTF8'\)/i);
  assert.match(migrationSource, /storage\/v1\/render\/image\/public\/thumbs/i);
  assert.match(migrationSource, /d\.student_id = new\.id/i);
  assert.match(migrationSource, /before insert or update of photo_url, school_id on public\.students/i);
  assert.match(migrationSource, /new\.photo_url := old\.photo_url/i);
  assert.match(migrationSource, /new\.photo_url := null/i);
  assert.match(
    migrationSource,
    /revoke execute on function public\.school_photo_percent_decode\(text\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migrationSource,
    /revoke execute on function public\.school_photo_storage_family\(text\)[\s\S]*from public, anon, authenticated/i,
  );
});
