import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { z } from "zod";
import ts from "typescript";

const id = value => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const projectId = id(1);
const otherProjectId = id(2);
const photographerId = id(3);
const timestamp = "2026-10-11T22:24:52.000Z";
const routeSource = readFileSync(new URL("../app/api/dashboard/events/[id]/visitors/route.ts", import.meta.url), "utf8");
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ visitors = [], downloads = [], favorites = [], media = [], signedOut = false, foreignOwner = false, mediaErrorAt = null, sourceError = null } = {}) {
  const queries = [];
  let mediaRequests = 0;
  const tables = {
    photographers: [{ id: photographerId, user_id: "owner-user" }],
    projects: [{ id: projectId, photographer_id: foreignOwner ? id(4) : photographerId, title: "Fixture event" }],
    event_gallery_visitors: visitors,
    event_gallery_downloads: downloads,
    event_gallery_favorites: favorites,
    orders: [],
    media,
  };
  const service = {
    from(table) {
      const query = { table, filters: [], selected: "", ids: null };
      queries.push(query);
      const chain = {
        select(selected) { query.selected = selected; return chain; },
        eq(key, value) { query.filters.push([key, value]); return chain; },
        in(key, values) { query.filters.push([key, values]); query.ids = values; return chain; },
        order() { return chain; },
        async maybeSingle() { return run(true); },
        then(resolve, reject) { return Promise.resolve().then(() => run(false)).then(resolve, reject); },
      };
      function run(single) {
        if (table === sourceError?.table) return { data: null, error: sourceError.error };
        if (table === "media") {
          mediaRequests++;
          // Reproduce the production gateway rejecting a large PostgREST URL.
          if (query.ids.length > 100) return { data: null, error: { message: "Bad Request" } };
          if (mediaRequests === mediaErrorAt) return { data: null, error: { message: "Media query failed", code: "XX000" } };
        }
        const rows = (tables[table] ?? []).filter(row => query.filters.every(([key, value]) =>
          Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
        ));
        // Database return order must not change the order of each download's photos.
        return { data: single ? rows[0] ?? null : table === "media" ? rows.toReversed() : rows, error: null };
      }
      return chain;
    },
  };
  const dependencies = {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    zod: { z },
    "@/lib/dashboard-auth": {
      resolveDashboardAuth: async () => ({ user: signedOut ? null : { id: "owner-user" } }),
      createDashboardServiceClient: () => service,
    },
    "@/lib/api-validation": {},
    "@/lib/audit": {},
    "@/lib/require-agreement": {},
    "@/lib/storage-images": {
      SIGNED_URL_TTL_DASHBOARD_SECONDS: 3600,
      buildSignedMediaUrls: ({ storagePath }) => ({ thumbnailUrl: `https://fixture.test/thumb/${storagePath}` }),
      publicStorageUrl: path => `https://fixture.test/public/${path}`,
    },
  };
  const exports = {};
  vm.runInNewContext(compiledRoute, {
    exports,
    require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
  });
  return {
    queries,
    async get() {
      const response = await exports.GET(new Request("https://fixture.test/api"), { params: Promise.resolve({ id: projectId }) });
      return { status: response.status, body: await response.json() };
    },
  };
}

const visitor = (value = 10) => ({
  id: id(value), project_id: projectId, viewer_email: `viewer-${value}@example.test`,
  created_at: timestamp, last_opened_at: timestamp,
});
const mediaRow = value => ({
  id: id(value), project_id: projectId, storage_path: `fixture/photo-${value}.jpg`,
  preview_url: null, thumbnail_url: null, filename: `photo-${value}.jpg`,
});
const download = (visitorRow, mediaIds, value = 20) => ({
  id: id(value), project_id: projectId, viewer_email: visitorRow.viewer_email,
  media_ids: mediaIds, download_type: "gallery", download_count: mediaIds.length, created_at: timestamp,
});

test("974 downloaded photos load complete previews through bounded, project-scoped lookups", async () => {
  const visitors = Array.from({ length: 6 }, (_, index) => visitor(10 + index));
  const media = Array.from({ length: 974 }, (_, index) => mediaRow(1000 + index));
  const downloads = Array.from({ length: 77 }, (_, index) => download(
    visitors[index % visitors.length],
    media.slice(Math.floor(index * media.length / 77), Math.floor((index + 1) * media.length / 77)).map(row => row.id),
    2000 + index,
  ));
  const h = harness({ visitors, downloads, media });
  const { status, body } = await h.get();

  assert.equal(status, 200);
  assert.equal(body.totalVisitors, 6);
  const mediaQueries = h.queries.filter(query => query.table === "media");
  assert.equal(mediaQueries.length, 10);
  assert.ok(mediaQueries.every(query => query.ids.length <= 100));
  assert.deepEqual(mediaQueries.flatMap(query => Array.from(query.ids)), media.map(row => row.id));
  assert.ok(mediaQueries.every(query => query.filters.some(([key, value]) => key === "project_id" && value === projectId)));

  const loadedDownloads = body.visitors.flatMap(row => row.downloads);
  assert.equal(loadedDownloads.length, 77);
  assert.equal(loadedDownloads.flatMap(row => row.media).length, 974);
  for (const loaded of loadedDownloads) {
    const original = downloads.find(row => row.id === loaded.id);
    assert.deepEqual(loaded.mediaIds, original.media_ids);
    assert.deepEqual(loaded.media.map(row => row.id), original.media_ids);
    assert.ok(loaded.media.every(row => row.thumbnailUrl === `https://fixture.test/thumb/fixture/${row.filename}`));
  }
  for (const loadedVisitor of body.visitors) {
    const expected = downloads.filter(row => row.viewer_email === loadedVisitor.email);
    assert.deepEqual(loadedVisitor.downloads.map(row => row.id), expected.map(row => row.id));
    assert.equal(loadedVisitor.downloadCount, expected.reduce((sum, row) => sum + row.download_count, 0));
  }
});

test("shared downloads and favorites are deduplicated without losing photo order or crossing projects", async () => {
  const viewer = visitor();
  const media = [mediaRow(100), mediaRow(101), mediaRow(102), { ...mediaRow(103), project_id: otherProjectId }];
  const h = harness({
    visitors: [viewer], media,
    downloads: [download(viewer, [id(101), id(100), id(101), id(103)])],
    favorites: [100, 102].map(value => ({ id: id(300 + value), project_id: projectId, viewer_email: viewer.viewer_email, media_id: id(value), created_at: timestamp })),
  });
  const { status, body } = await h.get();

  assert.equal(status, 200);
  const mediaQueries = h.queries.filter(query => query.table === "media");
  assert.deepEqual(Array.from(mediaQueries[0].ids), [id(101), id(100), id(103), id(102)]);
  const loaded = body.visitors[0];
  assert.deepEqual(loaded.downloads[0].media.map(row => row.id), [id(101), id(100), id(101), id(103)]);
  assert.equal(loaded.downloads[0].media[3].thumbnailUrl, null);
  assert.equal(loaded.favorites[1].media.filename, "photo-102.jpg");
});

test("a later media query failure does not return partially loaded visitors", async () => {
  const viewer = visitor();
  const media = Array.from({ length: 205 }, (_, index) => mediaRow(1000 + index));
  const h = harness({ visitors: [viewer], downloads: [download(viewer, media.map(row => row.id))], media, mediaErrorAt: 2 });
  const { status, body } = await h.get();

  assert.equal(status, 500);
  assert.equal(body.visitors, undefined);
  assert.equal(h.queries.filter(query => query.table === "media").length, 2);
});

test("empty or non-UUID media IDs skip the lookup and keep available visitor history", async () => {
  const viewer = visitor();
  for (const mediaIds of [[], ["legacy-photo", "", null, 42]]) {
    const h = harness({ visitors: [viewer], downloads: [download(viewer, mediaIds)] });
    const { status, body } = await h.get();
    assert.equal(status, 200);
    assert.equal(body.totalVisitors, 1);
    assert.equal(h.queries.some(query => query.table === "media"), false);
    assert.deepEqual(body.visitors[0].downloads[0].mediaIds, mediaIds.length ? ["legacy-photo"] : []);
  }
});

test("source query errors remain failures rather than empty visitor data", async () => {
  for (const table of ["event_gallery_visitors", "event_gallery_downloads", "event_gallery_favorites", "orders"]) {
    const h = harness({ sourceError: { table, error: { code: "XX000", message: "Source query failed" } } });
    const { status, body } = await h.get();
    assert.equal(status, 500);
    assert.equal(body.visitors, undefined);
    assert.equal(h.queries.some(query => query.table === "media"), false);
  }
});

test("authentication and project ownership are checked before loading visitor activity", async () => {
  for (const [options, expectedStatus] of [[{ signedOut: true }, 401], [{ foreignOwner: true }, 404]]) {
    const h = harness(options);
    const { status } = await h.get();
    assert.equal(status, expectedStatus);
    assert.equal(h.queries.some(query => query.table.startsWith("event_gallery_") || query.table === "media" || query.table === "orders"), false);
  }
});
