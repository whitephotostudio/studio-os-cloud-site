import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/gallery-image-cache.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, URL, setTimeout, clearTimeout });
const { createGalleryImageCache, galleryThumbnailUrl } = exports;

function fixture(options = {}) {
  const images = [];
  let time = 0;
  const cache = createGalleryImageCache({
    now: () => time,
    createImage() {
      const image = {
        naturalWidth: 0, naturalHeight: 0, decodeCalls: 0,
        async decode() { this.decodeCalls++; },
        set src(value) { this.source = value; this.corsAtLoad = this.crossOrigin; this.priorityAtLoad = this.fetchPriority; },
        succeed(width = 800, height = 1200) { this.naturalWidth = width; this.naturalHeight = height; this.onload?.(); },
        fail() { this.onerror?.(); },
      };
      images.push(image);
      return image;
    },
    ...options,
  });
  return { cache, images, setTime(value) { time = value; } };
}

test("canvas consumers share one load and decode, including a warmed adjacent pose", async () => {
  const h = fixture();
  const url = "/api/portal/school-preview/pose.png?token=viewer-token";
  const preload = h.cache.load(url, "low");
  const main = h.cache.load(url, "high");
  const strip = h.cache.load(url);
  assert.equal(main, preload);
  assert.equal(strip, preload);
  assert.equal(h.images.length, 1);
  assert.equal(h.images[0].fetchPriority, "high");
  assert.equal(h.cache.peek(url), null);
  h.images[0].succeed();
  assert.equal(await main, h.images[0]);
  assert.equal(h.images[0].decodeCalls, 1);
  assert.equal(h.cache.peek(url), h.images[0]);
  assert.equal(h.cache.load(url), preload);
  assert.equal(h.images.length, 1);
});

test("failed and timed-out loads can retry rather than retaining a rejected preview", async () => {
  const h = fixture({ loadTimeoutMs: 15 });
  const failed = h.cache.load("/failed.png");
  const failure = assert.rejects(failed, /could not be loaded/);
  h.images[0].fail();
  await failure;
  const retry = h.cache.load("/failed.png");
  h.images[1].succeed();
  await retry;
  assert.equal(h.images.length, 2);
  assert.equal(h.cache.peek("/failed.png"), h.images[1]);
  await assert.rejects(h.cache.load("/timeout.png"), /could not be loaded/);
  assert.equal(h.cache.peek("/timeout.png"), null);
  const recovered = h.cache.load("/timeout.png");
  h.images[3].succeed();
  await recovered;
});

test("least recently used images and expired viewer URLs leave the bounded cache", async () => {
  const h = fixture({ maxEntries: 2, ttlMs: 50 });
  async function loaded(url) {
    const pending = h.cache.load(url);
    h.images.at(-1).succeed();
    return pending;
  }
  const a = await loaded("/a.png");
  await loaded("/b.png");
  assert.equal(h.cache.peek("/a.png"), a);
  await loaded("/c.png");
  assert.equal(h.cache.peek("/b.png"), null);
  assert.equal(h.cache.peek("/a.png"), a);
  h.setTime(51);
  assert.equal(h.cache.peek("/a.png"), null);
  assert.equal(h.cache.peek("/c.png"), null);
  await loaded("/a.png");
  assert.equal(h.images.length, 4);
});

test("decoded pixel budget bounds memory independently of image count", async () => {
  const h = fixture({ maxEntries: 20, maxDecodedPixels: 1_000_000 });
  const first = h.cache.load("/one.png");
  h.images[0].succeed(800, 800);
  await first;
  const second = h.cache.load("/two.png");
  h.images[1].succeed(800, 800);
  await second;
  assert.equal(h.cache.peek("/one.png"), null);
  assert.equal(h.cache.peek("/two.png"), h.images[1]);
  const oversized = h.cache.load("/giant.png");
  h.images[2].succeed(4000, 4000);
  assert.equal(await oversized, h.images[2]);
  assert.equal(h.cache.peek("/giant.png"), null);
});

test("signed URLs retain exact viewer credentials and configure CORS before starting", async () => {
  const h = fixture();
  const urls = [
    "/api/portal/school-preview/pose.png?token=first-viewer",
    "/api/portal/school-preview/pose.png?token=second-viewer",
    "https://bucket.account.r2.cloudflarestorage.com/pose.png?X-Amz-Signature=fixture",
    "/api/r2/img/backdrops/blue.jpg?mediaToken=viewer%2Bfirst",
    "https://gallery.example/api/r2/img/backdrops/blue.jpg?mediaToken=viewer%2Bsecond",
    "/api/storage/legacy-media/nobg-photos/pose.png?token=viewer%2Bfirst",
    "https://gallery.example/api/storage/legacy-media/thumbs/pose.png?token=viewer%2Bsecond",
    "/api/portal/event-preview/pose.png?token=event-viewer",
  ];
  for (const url of urls) {
    const pending = h.cache.load(url, "high");
    h.images.at(-1).succeed();
    await pending;
  }
  assert.equal(h.images.length, urls.length);
  assert.deepEqual(h.images.map(image => image.source), urls);
  assert.deepEqual(h.images.map(image => image.corsAtLoad), ["anonymous", "anonymous", null, null, null, null, null, "anonymous"]);
  assert.ok(h.images.every(image => image.priorityAtLoad === "high"));
});

test("private gateway redirects load from storage without CORS while retaining exact capabilities", async () => {
  const requests = [];
  const cache = createGalleryImageCache({
    createImage() {
      return {
        naturalWidth: 0, naturalHeight: 0,
        async decode() {},
        set src(value) {
          requests.push(value);
          // Model a redirect to a storage response without ACAO: CORS-mode
          // image requests fail before onload, while display-mode images load.
          Promise.resolve().then(() => {
            if (this.crossOrigin === "anonymous") { this.onerror?.(); return; }
            this.naturalWidth = 600; this.naturalHeight = 900; this.onload?.();
          });
        },
      };
    },
  });
  for (const src of [
    "/api/r2/img/backdrops/blue.jpg?mediaToken=exact%2Bcapability",
    "/api/storage/legacy-media/nobg-photos/pose.png?token=exact%2Bcapability",
  ]) {
    const first = cache.load(src, "low");
    assert.equal(cache.load(src, "high"), first);
    const image = await first;
    assert.equal(image.naturalWidth, 600);
    assert.equal(cache.peek(src), image, "composite canvases can reuse the decoded image");
  }
  assert.deepEqual(requests, [
    "/api/r2/img/backdrops/blue.jpg?mediaToken=exact%2Bcapability",
    "/api/storage/legacy-media/nobg-photos/pose.png?token=exact%2Bcapability",
  ]);
});

test("unrelated and derivative URLs keep anonymous CORS rather than a broad retry", async () => {
  const h = fixture();
  for (const src of [
    "/api/r2/img-not-a-gateway/photo.jpg",
    "/api/storage/legacy-media-not-a-gateway/photo.jpg",
    "https://images.example/portrait.png?mediaToken=fixture",
    "/api/portal/school-preview/pose.png?token=fixture",
  ]) {
    const pending = h.cache.load(src);
    assert.equal(h.images.at(-1).corsAtLoad, "anonymous");
    h.images.at(-1).succeed();
    await pending;
  }
});

test("thumbnail sizing uses only existing protected preview derivatives", () => {
  const relative = "/api/portal/school-preview/pose.png?token=a%2Bb%3D#preview";
  const small = galleryThumbnailUrl(relative);
  const parsed = new URL(small, "https://fixture.test");
  assert.equal(parsed.searchParams.get("token"), "a+b=");
  assert.equal(parsed.searchParams.get("size"), "thumbnail");
  assert.equal(parsed.hash, "#preview");
  assert.ok(small.startsWith("/api/portal/school-preview/"));
  assert.equal(galleryThumbnailUrl(small), small);
  assert.equal(new URL(galleryThumbnailUrl("https://fixture.test/api/portal/event-preview/pose.jpg?token=x")).searchParams.get("size"), "thumbnail");
  for (const url of ["https://fixture.test/original.png?token=paid", "/api/portal/school-download-file?token=paid", "data:image/png;base64,fixture", ""]) {
    assert.equal(galleryThumbnailUrl(url), url);
  }
});
