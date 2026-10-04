import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const routeSource = readFileSync(
  new URL("../app/api/dashboard/events/desktop-media/route.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const projectId = "10000000-0000-0000-0000-000000000001";
const otherProjectId = "10000000-0000-0000-0000-000000000002";
const albumId = "20000000-0000-0000-0000-00000000000a";
const secondAlbumId = "20000000-0000-0000-0000-00000000000b";
const rowId = (index) => `30000000-0000-0000-0000-${String(index).padStart(12, "0")}`;

function mediaRow(index, collectionId = albumId, ownerProjectId = projectId) {
  return {
    id: rowId(index),
    project_id: ownerProjectId,
    collection_id: collectionId,
    storage_path: `projects/${ownerProjectId}/albums/${collectionId}/photo-${index}.jpg`,
    preview_url: `preview-${index}.jpg`,
    thumbnail_url: `thumbnail-${index}.jpg`,
  };
}

function fakeService({
  media = [],
  collections = [{ id: albumId, project_id: projectId, title: "Album A" }],
  rowCap = 1000,
  projectOwner = "owner-a",
  transformPage,
} = {}) {
  const tables = {
    photographers: [{ id: "owner-a", user_id: "user-a" }],
    projects: [{ id: projectId, photographer_id: projectOwner, workflow_type: "event" }],
    collections,
    media,
  };
  const reads = [];
  const pageCounts = new Map();
  const service = {
    reads,
    from(table) {
      const filters = [];
      let columns = "";
      let orderColumn;
      let limit = Infinity;
      let after;
      const query = {
        select(value) { columns = value; return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        order(column, options) {
          assert.deepEqual(options, { ascending: true });
          orderColumn = column;
          return query;
        },
        limit(value) { limit = value; return query; },
        gt(column, value) {
          assert.equal(column, "id");
          after = value;
          return query;
        },
        async maybeSingle() {
          const { data, error } = await execute();
          return { data: data?.[0] ?? null, error };
        },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        const pageNumber = (pageCounts.get(table) ?? 0) + 1;
        pageCounts.set(table, pageNumber);
        const read = { table, columns, filters, orderColumn, limit, after, pageNumber };
        reads.push(read);
        let rows = tables[table]
          .filter((row) => filters.every(([column, value]) => row[column] === value))
          .filter((row) => !after || row.id > after);
        if (orderColumn) {
          rows = [...rows].sort((left, right) =>
            left[orderColumn] < right[orderColumn] ? -1 : left[orderColumn] > right[orderColumn] ? 1 : 0,
          );
        }
        rows = rows.slice(0, Math.min(limit, rowCap));
        // Supabase returns only selected columns; missing cursor IDs must fail.
        rows = rows.map((row) => Object.fromEntries(columns.split(",").map((column) => [column, row[column]])));
        return transformPage?.(read, rows) ?? { data: rows, error: null };
      }
      return query;
    },
  };
  return service;
}

function loadGet(service, { user = { id: "user-a" }, schoolResolution, removedMatcher } = {}) {
  const modules = {
    "next/server": {
      NextResponse: { json: (body, options) => ({ status: options?.status ?? 200, body }) },
    },
    "@/lib/dashboard-auth": {
      resolveDashboardAuth: async () => ({ user }),
      createDashboardServiceClient: () => service,
    },
    "@/lib/api-validation": {},
    "@/lib/event-gallery-settings": {},
    "@/lib/r2": {},
    "@/lib/storage-images": {},
    "@/lib/require-agreement": {},
    "@/lib/school-photo-deletions": {
      loadSchoolPhotoTombstones: async () => ["removed-family"],
      tombstoneFamilySet: (rows) => new Set(rows),
    },
    "@/lib/school-project-photo-mapping": {
      resolveOwnedProjectLinkedSchool: async () => schoolResolution ?? { status: "unlinked" },
      projectMediaReferenceMatchesSchoolPhotoFamily: removedMatcher ?? (() => false),
    },
  };
  const exports = {};
  new Function("require", "exports", compiled)((name) => modules[name] ?? require(name), exports);
  return (collectionIds = "") => exports.GET({
    nextUrl: new URL(`https://studio-os.test/api/dashboard/events/desktop-media?cloudProjectId=${projectId}&collectionIds=${encodeURIComponent(collectionIds)}`),
  });
}

function assertScopedPages(service) {
  for (const read of service.reads.filter((read) => ["media", "collections"].includes(read.table))) {
    assert.deepEqual(read.filters, [["project_id", projectId]], "every service-role inventory page must remain project scoped");
    assert.equal(read.orderColumn, "id");
    assert.equal(read.limit, 500);
  }
}

test("GET returns every media row beyond the database default cap in deterministic order", async () => {
  const rows = Array.from({ length: 1257 }, (_, index) => mediaRow(index + 1));
  const service = fakeService({ media: [...rows].reverse().concat(mediaRow(9999, albumId, otherProjectId)) });
  const response = await loadGet(service)();

  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, rows.length);
  assert.deepEqual(response.body.items, rows.map(({ collection_id, storage_path }) => ({ collection_id, storage_path })));
  assert.deepEqual(response.body.diagnostic, {
    scoped_count: 1257,
    scoped_collection_ids: [],
    project_total_count: 1257,
    collections_with_media: [{ collection_id: albumId, count: 1257 }],
  });
  assert.equal(service.reads.filter((read) => read.table === "media").length, 4, "one full inventory plus terminal empty page, without a second diagnostic scan");
  assertScopedPages(service);
});

test("short server pages still complete scoped items and full-project diagnostics", async () => {
  const media = Array.from({ length: 1103 }, (_, index) => mediaRow(index + 1, index % 2 ? secondAlbumId : albumId));
  media.push({ ...mediaRow(1104), collection_id: null });
  const service = fakeService({ media, rowCap: 73 });
  const response = await loadGet(service)(` ${albumId.toUpperCase()},${albumId.toUpperCase()} `);

  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 552);
  assert.ok(response.body.items.every((item) => item.collection_id === albumId));
  assert.deepEqual(response.body.diagnostic, {
    scoped_count: 552,
    scoped_collection_ids: [albumId.toUpperCase()],
    project_total_count: 1104,
    collections_with_media: [
      { collection_id: albumId, count: 552 },
      { collection_id: secondAlbumId, count: 551 },
    ],
  });
  assert.ok(service.reads.filter((read) => read.table === "media").length > 10);
  assertScopedPages(service);
});

test("unknown scoped albums do not hide the complete project diagnostic", async () => {
  const service = fakeService({ media: Array.from({ length: 1003 }, (_, index) => mediaRow(index + 1)) });
  const response = await loadGet(service)(secondAlbumId);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.items, []);
  assert.equal(response.body.diagnostic.scoped_count, 0);
  assert.equal(response.body.diagnostic.project_total_count, 1003);
});

test("later collection pages still supply tombstone titles for both inventory counts", async () => {
  const collections = Array.from({ length: 1003 }, (_, index) => ({
    id: `40000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
    project_id: projectId,
    title: index === 1002 ? "School class removed" : `Album ${index}`,
  }));
  const lastAlbum = collections.at(-1).id;
  const media = [mediaRow(1, lastAlbum), mediaRow(2, lastAlbum), mediaRow(3, collections[0].id)];
  media[1].thumbnail_url = "removed-family.jpg";
  const service = fakeService({ media, collections, rowCap: 67 });
  const response = await loadGet(service, {
    schoolResolution: { status: "resolved", school: { id: "owned-school" } },
    removedMatcher: ({ reference, families, collectionTitle }) =>
      reference === "removed-family.jpg" && families.has("removed-family") && collectionTitle === "School class removed",
  })(lastAlbum);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.items, [{ collection_id: lastAlbum, storage_path: media[0].storage_path }]);
  assert.equal(response.body.diagnostic.scoped_count, 1);
  assert.equal(response.body.diagnostic.project_total_count, 2);
  assert.deepEqual(response.body.diagnostic.collections_with_media, [
    { collection_id: collections[0].id, count: 1 },
    { collection_id: lastAlbum, count: 1 },
  ]);
  assertScopedPages(service);
});

test("later-page database errors fail instead of returning a partial successful inventory", async () => {
  for (const failingTable of ["collections", "media"]) {
    const service = fakeService({
      media: Array.from({ length: 20 }, (_, index) => mediaRow(index + 1)),
      collections: Array.from({ length: 20 }, (_, index) => ({ id: rowId(index + 1), title: "Album", project_id: projectId })),
      rowCap: 7,
      transformPage: (read) => read.table === failingTable && read.pageNumber === 2
        ? { data: null, error: new Error("Read interrupted") } : undefined,
    });
    const response = await loadGet(service)();
    assert.equal(response.status, 500);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.message, "Read interrupted");
    assert.equal(response.body.items, undefined);
    assert.equal(response.body.diagnostic, undefined);
  }
});

test("malformed or nonadvancing pages fail closed without an infinite read loop", async () => {
  for (const badPage of [
    () => ({ data: null, error: null }),
    (rows) => ({ data: rows.map((row) => {
      const withoutId = { ...row };
      delete withoutId.id;
      return withoutId;
    }), error: null }),
    (rows) => ({ data: [rows[0], rows[0]], error: null }),
    (rows) => ({ data: [...rows].reverse(), error: null }),
  ]) {
    const service = fakeService({
      media: [mediaRow(1), mediaRow(2), mediaRow(3)],
      transformPage: (read, rows) => read.table === "media" ? badPage(rows) : undefined,
    });
    const response = await loadGet(service)();
    assert.equal(response.status, 500);
    assert.equal(response.body.ok, false);
    assert.equal(service.reads.filter((read) => read.table === "media").length, 1);
  }
  const service = fakeService({
    media: [mediaRow(1), mediaRow(2), mediaRow(3)],
    rowCap: 2,
    transformPage: (read) => read.table === "media" && read.pageNumber === 2
      ? { data: [mediaRow(1), mediaRow(2)], error: null } : undefined,
  });
  const response = await loadGet(service)();
  assert.equal(response.status, 500);
  assert.equal(service.reads.filter((read) => read.table === "media").length, 2);
});

test("authentication and owner/link verification stop before inventory queries", async () => {
  for (const scenario of [
    { serviceOptions: {}, routeOptions: { user: null }, status: 401 },
    { serviceOptions: { projectOwner: "owner-b" }, routeOptions: {}, status: 404 },
    { serviceOptions: {}, routeOptions: { schoolResolution: { status: "invalid" } }, status: 409 },
  ]) {
    const service = fakeService({ media: [mediaRow(1)], ...scenario.serviceOptions });
    const response = await loadGet(service, scenario.routeOptions)();
    assert.equal(response.status, scenario.status);
    assert.equal(response.body.ok, false);
    assert.equal(service.reads.some((read) => ["media", "collections"].includes(read.table)), false);
  }
});

test("an empty owned project retains the existing response contract", async () => {
  const service = fakeService({ collections: [] });
  const response = await loadGet(service)();
  assert.deepEqual(response, {
    status: 200,
    body: {
      ok: true,
      items: [],
      diagnostic: { scoped_count: 0, scoped_collection_ids: [], project_total_count: 0, collections_with_media: [] },
    },
  });
});
