import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

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
  assert.match(galleryContextSource, /namespace: "pin-auth-school"/);
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
