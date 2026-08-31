import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { proxiedPhotoUrl } from "../lib/photo-url.ts";

const panelSource = readFileSync(
  new URL(
    "../components/gallery-orders/gallery-orders-panel.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("order thumbnails turn durable R2 keys into working browser URLs", () => {
  assert.equal(
    proxiedPhotoUrl(
      "schools/463e6864-d9e3-4a4c-9362-662609b7005b/students/alysia/photo 1_thumbnail.jpg",
    ),
    "/api/r2/img/schools/463e6864-d9e3-4a4c-9362-662609b7005b/students/alysia/photo%201_thumbnail.jpg",
  );
});

test("order thumbnails preserve usable absolute image URLs", () => {
  assert.equal(
    proxiedPhotoUrl("https://cdn.example.com/students/alysia.jpg"),
    "https://cdn.example.com/students/alysia.jpg",
  );
});

test("order thumbnails use the empty-state fallback when no image is usable", () => {
  assert.equal(proxiedPhotoUrl(null), "");
  assert.equal(proxiedPhotoUrl("   "), "");
  assert.equal(proxiedPhotoUrl("students/alysia/not-an-image"), "");
});

test("the school orders panel resolves student thumbnail references before rendering", () => {
  assert.match(
    panelSource,
    /import\s+\{\s*proxiedPhotoUrl\s*\}\s+from\s+["']@\/lib\/photo-url["']/,
  );
  assert.match(
    panelSource,
    /proxiedPhotoUrl\(order\.student\?\.photo_url\)/,
  );
});
