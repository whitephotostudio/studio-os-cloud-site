import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const storageImagesSource = source("lib/storage-images.ts");
const executableStorageImagesSource = ts.transpileModule(
  storageImagesSource.replace(
    'import { r2PresignedGetUrl, r2KeyFromAnyUrl } from "./r2-signed-urls";',
    [
      "const r2PresignedGetUrl = () => '';",
      "const r2KeyFromAnyUrl = () => null;",
    ].join("\n"),
  ),
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
  test(`${galleryKind} galleries retain all-photo folder loading`, () => {
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
        `const mergedUrls = \\[${personName}\\.photo_url, \\.\\.\\.urls\\]`,
      ),
    );
    assert.match(gallerySource, /Array\.from\(new Set\(mergedUrls\)\)/);
    assert.match(
      gallerySource,
      new RegExp(`photoUrlsMap\\[${personName}\\.id\\]`),
    );
  });
}
