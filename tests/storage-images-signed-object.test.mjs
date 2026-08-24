import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const storageImagesSource = readFileSync(
  new URL("../lib/storage-images.ts", import.meta.url),
  "utf8",
);
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
const { extractStoragePathFromSupabaseUrl } = await import(
  `data:text/javascript;base64,${Buffer.from(executableStorageImagesSource).toString("base64")}`
);

test("historical signed Supabase object URLs recover the durable thumbs key", () => {
  const signedUrl =
    "https://example.supabase.co/storage/v1/object/sign/thumbs/school-local-id/Class%202026/Student%20Name/portrait%2001.jpg?token=secret-token";

  assert.equal(
    extractStoragePathFromSupabaseUrl(signedUrl),
    "school-local-id/Class 2026/Student Name/portrait 01.jpg",
  );
});

test("signed Supabase object extraction honors a non-default bucket", () => {
  const signedUrl =
    "https://example.supabase.co/storage/v1/object/sign/private-media/folder/photo%20one.webp?token=secret-token#ignored";

  assert.equal(
    extractStoragePathFromSupabaseUrl(signedUrl, "private-media"),
    "folder/photo one.webp",
  );
});
