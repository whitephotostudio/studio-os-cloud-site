import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const storageImagesSource = source("lib/storage-images.ts");
const executablePhotoUrlSource = ts.transpileModule(source("lib/photo-url.ts"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const photoUrlModuleUrl = `data:text/javascript;base64,${Buffer.from(executablePhotoUrlSource).toString("base64")}`;
const executableLegacyTokenSource = ts.transpileModule(source("lib/legacy-storage-token.ts").replace('from "@/lib/photo-url"', `from "${photoUrlModuleUrl}"`), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const legacyTokenModuleUrl = `data:text/javascript;base64,${Buffer.from(executableLegacyTokenSource).toString("base64")}`;
const r2SecurityModuleUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source("lib/r2-access-security.ts"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const r2TokenModuleUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source("lib/r2-media-token.ts").replace('from "@/lib/r2-access-security"', `from "${r2SecurityModuleUrl}"`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const executableStorageImagesSource = ts.transpileModule(
  storageImagesSource.replace(
    'import { r2KeyFromAnyUrl } from "@/lib/storage-hosts";',
    [
      "const r2PresignedGetUrl = () => '';",
      "const r2KeyFromAnyUrl = () => null;",
    ].join("\n"),
  ).replace('from "@/lib/photo-url"', `from "${photoUrlModuleUrl}"`).replace('from "@/lib/legacy-storage-token"', `from "${legacyTokenModuleUrl}"`).replace('from "@/lib/r2-media-token"', `from "${r2TokenModuleUrl}"`),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const storageImagesModule = await import(
  `data:text/javascript;base64,${Buffer.from(executableStorageImagesSource).toString("base64")}`
);
const {
  buildStoredMediaUrls,
  extractStoragePathFromSupabaseUrl,
} = storageImagesModule;

const classPageSource = source(
  "app/dashboard/projects/schools/[schoolId]/classes/[classId]/page.tsx",
);
const rolePageSource = source(
  "app/dashboard/projects/schools/[schoolId]/roles/[role]/page.tsx",
);
const storageFolderRouteSource = source(
  "app/api/dashboard/storage-folder/route.ts",
);

test("authenticated R2 display URLs round-trip to the original student folder", () => {
  const storagePath =
    "school-local-id/Class 2026/Student Name/portrait 01_preview.jpg";
  const displayUrl = buildStoredMediaUrls({
    storagePath,
    previewUrl: storagePath,
  }).previewUrl;

  assert.equal(
    displayUrl,
    "/api/r2/img/school-local-id/Class%202026/Student%20Name/portrait%2001_preview.jpg",
  );
  assert.equal(extractStoragePathFromSupabaseUrl(displayUrl), storagePath);
  assert.equal(
    extractStoragePathFromSupabaseUrl(`${displayUrl}?width=640&v=photo-2`),
    storagePath,
  );
  assert.equal(
    extractStoragePathFromSupabaseUrl(
      `https://www.studiooscloud.com${displayUrl}?width=640&v=photo-2`,
    ),
    storagePath,
  );

  const recoveredPath = extractStoragePathFromSupabaseUrl(displayUrl);
  assert.equal(
    recoveredPath?.slice(0, recoveredPath.lastIndexOf("/")),
    "school-local-id/Class 2026/Student Name",
  );
});

for (const [galleryKind, gallerySource, personName] of [
  ["class", classPageSource, "student"],
  ["role", rolePageSource, "person"],
]) {
  test(`${galleryKind} galleries treat a successful folder load as authoritative`, () => {
    assert.match(
      gallerySource,
      new RegExp(
        `const folderPath = extractFolderPathFromPublicUrl\\(${personName}\\.photo_url\\)`,
      ),
    );
    assert.match(
      gallerySource,
      /const urls = await loadFolderImageUrls\(folderPath\)/,
    );
    assert.match(
      gallerySource,
      new RegExp(
        `urlMap\\[${personName}\\.id\\] = Array\\.from\\(new Set\\(urls\\)\\)`,
      ),
    );
    assert.match(
      gallerySource,
      new RegExp(
        `assetMap\\[${personName}\\.id\\] = dedupeGalleryPhotoAssets\\(folderAssets\\)`,
      ),
    );
    assert.doesNotMatch(
      gallerySource,
      new RegExp(
        `const mergedUrls = \\[${personName}\\.photo_url, \\.\\.\\.urls\\]`,
      ),
    );
  });

  test(`${galleryKind} galleries use the representative only when folder loading fails`, () => {
    assert.match(
      gallerySource,
      new RegExp(
        `urlMap\\[${personName}\\.id\\] = \\[${personName}\\.photo_url!\\]`,
      ),
    );
    assert.match(
      gallerySource,
      new RegExp(
        `photoAssetFromStoredReference\\(${personName}\\.photo_url\\)`,
      ),
    );
    assert.match(
      gallerySource,
      new RegExp(`photoAssetsMap\\[${personName}\\.id\\]`),
    );
  });
}

test("student folder listing accepts legacy and namespaced school roots", () => {
  assert.match(storageFolderRouteSource, /resolveR2MediaOwnership\(service, folderPath, photographerId, \{ prefix: true \}\)/);
  assert.match(storageFolderRouteSource, /allowed: ownership.owned, schoolId: ownership.schoolId/);
  assert.doesNotMatch(storageFolderRouteSource, /ownedSchoolId|local_school_id/);
  assert.match(storageFolderRouteSource, /filterTombstonedSchoolPhotoAssets/);
  assert.doesNotMatch(storageFolderRouteSource, /\.or\(`id\.eq\./);
});
