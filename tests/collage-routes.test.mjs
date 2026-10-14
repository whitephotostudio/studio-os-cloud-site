import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { NextRequest } from "next/server.js";
const nativeRequire = createRequire(import.meta.url);
function moduleAt(path, mocks = {}, cache = new Map()) {
  if (cache.has(path)) return cache.get(path);
  const exports = {}; cache.set(path, exports);
  new Function("exports", "require", ts.transpileModule(readFileSync(new URL(`../${path}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(exports, id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    return id.startsWith("@/") ? moduleAt(id.slice(2), mocks, cache) : nativeRequire(id);
  });
  return exports;
}
const core = moduleAt("lib/collage-server");
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", versionId = "33333333-3333-4333-8333-333333333333", orderId = "44444444-4444-4444-8444-444444444444", itemId = "55555555-5555-4555-8555-555555555555";
const design = { version: 1, name: "Test", widthInches: 4, heightInches: 4, background: "#ffffff", ink: "#000000", overlay: null,
  slots: [{ id: "main", label: "Main", x: 0, y: 0, width: 1, height: 1 }], caption: { x: .5, y: .82, size: .028 } };
const version = { id: versionId, templateId: other, photographerId: owner, versionNumber: 1, design, artworkKey: null, contentHash: core.collageContentHash(design, null), published: true };
const selection = () => ({ version: 1, templateVersionId: versionId, caption: { studentName: "", schoolName: "", year: "" }, placements: [{ slotId: "main", mediaId: "allowed-photo", zoom: 1, x: .5, y: .5 }] });
class SessionError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
function previewHarness({ denyLane = false, denyMedia = false, kind = "school" } = {}) {
  const observed = { renders: 0, downloads: [], scopes: [], studentFilters: [] };
  const service = { from(table) {
    assert.equal(table, "students");
    const chain = { select() { return chain; }, eq(key, value) { observed.studentFilters.push([key, value]); return chain; }, async maybeSingle() { return { data: { id: itemId }, error: null }; } }; return chain;
  } };
  const authorize = async (...args) => {
    observed.scopes.push(args.slice(1, -1));
    if (denyMedia) throw Error("Other student's photo");
    for (const ref of args.at(-1)[0].digitalSelections) ref.url = "schools/owned/original.jpg";
  };
  const route = moduleAt("app/api/portal/collages/preview/route", {
    "@/lib/dashboard-auth": { createDashboardServiceClient: () => service },
    "@/lib/parent-gallery-session": {
      ParentGallerySessionError: SessionError,
      async resolveParentGallerySession(_request, lane) {
        if (denyLane || lane !== itemId) throw new SessionError("Reopen the gallery");
        return { laneId: itemId, kind, photographerId: owner, galleryId: orderId, pin: "private-pin", email: "parent@example.test" };
      },
      assertParentSessionScope(_request, _scope, body) { if (body && (body.pin || body.email || body.schoolId || body.projectId)) throw new SessionError("Conflicting gallery", 400); },
    },
    "@/lib/collage-server": { ...core, async resolveCollageVersions(_service, photographer, scope, ids) { assert.equal(photographer, owner); assert.deepEqual(ids, [versionId]); observed.scopes.push(scope); return new Map([[versionId, version]]); } },
    "@/lib/school-order-media": { resolveSchoolOrderMediaReferences: authorize },
    "@/lib/event-order-media": { resolveEventOrderMediaReferences: authorize },
    "@/lib/event-gallery-access": { async validateEventGalleryAccess() { return { ok: true, collectionIds: ["allowed-collection"] }; } },
    "@/lib/rate-limit": { async rateLimit() { return { allowed: true }; } },
    "@/lib/r2": { async r2Download(key) { observed.downloads.push(key); return Buffer.from("original"); } },
    "@/lib/collage-production": { async renderCollageProduction({ snapshot, loadMedia, previewMaxDimension }) {
      observed.renders++; observed.snapshot = snapshot; assert.equal(previewMaxDimension, 1200);
      assert.equal(snapshot.placements[0].mediaKey, "schools/owned/original.jpg");
      await loadMedia(snapshot.placements[0].mediaKey);
      await assert.rejects(() => loadMedia("schools/other/secret.jpg"), /outside this gallery/);
      return { bytes: Buffer.from("screen-only-png"), width: 1200, height: 1200, trim: { width: 1200, height: 1200 }, bleedPixels: 0, warnings: [{ slotId: "main", ppi: 150 }] };
    } },
  });
  const request = (value = selection(), extra = {}) => new NextRequest("https://example.test/api/portal/collages/preview", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ parentLaneId: itemId, selection: value, ...extra }) });
  return { route, observed, request };
}
test("parent preview authenticates the exact school lane and resolves original bytes independently of supplied URLs and design", async () => {
  const h = previewHarness();
  const submitted = { ...selection(), design: { overlay: "https://evil.test/image" }, price: 1, placements: [{ ...selection().placements[0], url: "https://evil.test/source", mediaKey: "schools/other/secret.jpg" }] };
  const response = await h.route.POST(h.request(submitted)); assert.equal(response.status, 200);
  const payload = await response.json(); assert.equal(payload.ok, true); assert.deepEqual(payload.warnings, [{ slotId: "main", ppi: 150 }]);
  assert.deepEqual(h.observed.downloads, ["schools/owned/original.jpg"]);
  assert.deepEqual(h.observed.studentFilters, [["school_id", orderId], ["pin", "private-pin"]]);
  assert.equal(h.observed.snapshot.design, design);
});
test("parent preview fails closed for a missing cookie lane, unauthorized sibling photo, conflicting gallery and remote media identity", async () => {
  for (const options of [{ denyLane: true }, { denyMedia: true }]) {
    const h = previewHarness(options); const response = await h.route.POST(h.request());
    assert.equal(response.status, options.denyLane ? 401 : 403); assert.equal(h.observed.renders, 0); assert.deepEqual(h.observed.downloads, []);
  }
  const h = previewHarness();
  assert.equal((await h.route.POST(h.request(selection(), { schoolId: other }))).status, 400);
  const bad = selection(); bad.placements[0].mediaId = "https://evil.test/photo.jpg";
  assert.equal((await h.route.POST(h.request(bad))).status, 403); assert.equal(h.observed.renders, 0);
});
test("event preview scopes source authorization to the authenticated project's accessible collection IDs", async () => {
  const h = previewHarness({ kind: "event" }); assert.equal((await h.route.POST(h.request())).status, 200);
  assert.deepEqual(h.observed.scopes[0], { projectId: orderId });
  assert.deepEqual(h.observed.scopes[1], [orderId, ["allowed-collection"]]); assert.deepEqual(h.observed.studentFilters, []);
});

function productionHarness({ status = "paid", crossOwner = false, changed = false, wrongSnapshotOwner = false, unsigned = false, quantity = 1 } = {}) {
  let renders = 0, checks = 0;
  const recipe = { photographerId: wrongSnapshotOwner ? other : owner, frozen: true, contentHash: "b".repeat(64) };
  const service = { from(table) { assert.equal(table, "order_items"); const chain = { select() { return chain; }, eq() { return chain; }, async maybeSingle() { return { data: { quantity, collage_snapshot: recipe }, error: null }; } }; return chain; } };
  const route = moduleAt("app/api/dashboard/collages/production/route", {
    "@/lib/collage-server": { ...core, async collageDashboardAccess() { if (unsigned) throw new core.CollageAccessError("Sign in", 401); return { service, photographerId: owner, user: { id: other } }; } },
    "@/lib/order-automation-auth": { async currentProductionOrders(user, ids) {
      assert.equal(user, other); assert.deepEqual(ids, [orderId]); checks++;
      if (status !== "paid") throw Error(`Order ${status}; hold production`);
      return { studio: { id: crossOwner ? other : owner }, orders: [{ id: orderId, revision: changed && checks > 1 ? 2 : 1 }] };
    }, productionFinancialRevision: JSON.stringify },
    "@/lib/collage-production": { parseCollageOrderSnapshot: value => value, collageRecipeHash: () => "c".repeat(64), async renderCollageOrderSnapshot(value, database) { assert.equal(value, recipe); assert.equal(database, service); renders++; return { bytes: Buffer.from("finished PNG"), sha256: "a".repeat(64), width: 3000, height: 2400, warnings: [] }; } },
    "@/lib/rate-limit": { async rateLimit() { return { allowed: true }; } },
  });
  return { route, renders: () => renders, request: new NextRequest(`https://example.test/api/dashboard/collages/production?orderId=${orderId}&itemId=${itemId}`) };
}
test("production route downloads the frozen paid owned print and checks financial state again after rendering", async () => {
  const h = productionHarness(); const response = await h.route.GET(h.request);
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/png"); assert.equal(response.headers.get("x-collage-sha256"), "a".repeat(64)); assert.equal(h.renders(), 1);
  assert.equal(response.headers.get("x-collage-template-hash"), "b".repeat(64)); assert.equal(response.headers.get("x-collage-recipe-hash"), "c".repeat(64));
  assert.equal(response.headers.get("x-collage-width"), "3000"); assert.equal(response.headers.get("x-collage-height"), "2400");
  assert.equal(response.headers.get("x-collage-order-id"), orderId); assert.equal(response.headers.get("x-collage-item-id"), itemId);
  assert.equal(response.headers.get("x-collage-quantity"), "1");
  const race = productionHarness({ changed: true }); const held = await race.route.GET(race.request);
  assert.equal(held.status, 409); assert.match((await held.json()).message, /Payment changed/);
});
test("production route refuses unauthenticated, other-studio, unpaid and refunded items before reading originals", async () => {
  for (const options of [{ unsigned: true }, { crossOwner: true }, { status: "unpaid" }, { status: "refunded" }, { wrongSnapshotOwner: true }, { quantity: 2 }, { quantity: null }]) {
    const h = productionHarness(options), response = await h.route.GET(h.request);
    assert.ok(response.status >= 400); assert.equal(h.renders(), 0, JSON.stringify(options));
  }
});

function saveHarness({ foreignTemplate = false, foreignGallery = false, unsigned = false } = {}) {
  const observed = { uploads: 0, saves: 0 };
  const service = { from(table) {
    const chain = { select() { return chain; }, eq() { return chain; }, async maybeSingle() { assert.equal(table, "collage_templates"); return { data: { photographer_id: foreignTemplate ? other : owner }, error: null }; }, async in() { assert.equal(table, "schools"); return { data: foreignGallery ? [] : [{ id: orderId }], error: null }; } }; return chain;
  }, async rpc(_name, args) {
    observed.saves++; assert.equal(args.p_photographer_id, owner); assert.equal(args.p_design.overlay, null);
    return { data: [{ id: versionId, template_id: itemId, photographer_id: owner, version_number: 1, design: args.p_design, artwork_key: null, content_hash: args.p_content_hash, published: args.p_published }], error: null };
  } };
  const route = moduleAt("app/api/dashboard/collages/route", {
    "@/lib/collage-server": { ...core, async collageDashboardAccess() { if (unsigned) throw new core.CollageAccessError("Sign in", 401); return { service, photographerId: owner, user: { id: other } }; } },
    "@/lib/rate-limit": { async rateLimit() { return { allowed: true }; } },
    "@/lib/order-automation-storage": { async writeProduction() { observed.uploads++; }, async readProduction() { throw Error("Unexpected read"); }, digest: () => "unused" },
  });
  return { route, observed, request: new NextRequest("https://example.test/api/dashboard/collages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ templateId: itemId, design, schoolIds: [orderId], publish: true }) }) };
}
test("owner template save refuses unauthenticated, foreign-template and foreign-gallery requests before storage writes", async () => {
  for (const options of [{ unsigned: true }, { foreignTemplate: true }, { foreignGallery: true }]) {
    const h = saveHarness(options), response = await h.route.POST(h.request);
    assert.equal(response.status, options.unsigned ? 401 : 403); assert.equal(h.observed.uploads, 0); assert.equal(h.observed.saves, 0);
  }
  const valid = saveHarness(), response = await valid.route.POST(valid.request);
  assert.equal(response.status, 200); assert.equal(valid.observed.saves, 1); assert.equal((await response.json()).version.id, versionId);
});

function orderRecipeHarness({ foreignOrder = false, foreignRecipe = false, missingColumn = false, databaseFailure = false, unsigned = false } = {}) {
  let itemReads = 0;
  const recipe = { photographerId: foreignRecipe ? other : owner, frozen: true };
  const service = { from(table) {
    const chain = { select() { return chain; }, eq(key, value) {
      if (table === "orders" && key === "photographer_id") assert.equal(value, owner);
      return chain;
    }, async maybeSingle() { assert.equal(table, "orders"); return { data: foreignOrder ? null : { id: orderId }, error: null }; },
    then(resolve) {
      assert.equal(table, "order_items"); itemReads++;
      return Promise.resolve({ data: missingColumn || databaseFailure ? null : [{ id: itemId, collage_snapshot: recipe }, { id: other, collage_snapshot: null }],
        error: missingColumn ? { code: "42703", message: "column order_items.collage_snapshot does not exist" } : databaseFailure ? { code: "08006", message: "connection unavailable" } : null }).then(resolve);
    } }; return chain;
  } };
  const route = moduleAt("app/api/dashboard/collages/order/route", {
    "@/lib/collage-server": { ...core, async collageDashboardAccess() { if (unsigned) throw new core.CollageAccessError("Sign in", 401); return { service, photographerId: owner }; } },
    "@/lib/collage-production": { parseCollageOrderSnapshot: value => value },
  });
  return { route, itemReads: () => itemReads, recipe, request: new NextRequest(`https://example.test/api/dashboard/collages/order?orderId=${orderId}`) };
}
test("owner recipe review returns frozen print selections without requiring payment or rendering originals", async () => {
  const h = orderRecipeHarness(), response = await h.route.GET(h.request);
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.preview, true); assert.deepEqual(body.prints, [{ id: itemId, selection: h.recipe }]); assert.equal(h.itemReads(), 1);
});
test("owner recipe review denies foreign orders and recipes, tolerates only absent collage schema and surfaces other failures", async () => {
  for (const [options, status, reads] of [[{ unsigned: true }, 401, 0], [{ foreignOrder: true }, 404, 0], [{ foreignRecipe: true }, 409, 1], [{ databaseFailure: true }, 503, 1]]) {
    const h = orderRecipeHarness(options); assert.equal((await h.route.GET(h.request)).status, status); assert.equal(h.itemReads(), reads);
  }
  const h = orderRecipeHarness({ missingColumn: true }), response = await h.route.GET(h.request);
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).prints, []);
});

test("parent catalogue returns partial permitted metadata without artwork reads; artwork loads require one strictly authorized version", async () => {
  let artworkReads = 0;
  const artVersion = { ...version, artworkKey: `order-automation/${owner}/collages/artwork/${"a".repeat(64)}.png` };
  const route = moduleAt("app/api/portal/collages/route", {
    "@/lib/dashboard-auth": { createDashboardServiceClient: () => ({}) },
    "@/lib/parent-gallery-session": { ParentGallerySessionError: SessionError, async resolveParentGallerySession() { return { laneId: itemId, kind: "school", photographerId: owner, galleryId: orderId }; }, assertParentSessionScope() {} },
    "@/lib/collage-server": { ...core,
      async resolveCollageCatalogueVersions(_service, _owner, _scope, ids) { return { versions: new Map(ids.includes(versionId) ? [[versionId, artVersion]] : []), unavailableVersionIds: ids.filter(id => id !== versionId) }; },
      async resolveCollageVersions(_service, _owner, _scope, ids) { if (ids.some(id => id !== versionId)) throw new core.CollageAccessError("Unavailable", 403); return new Map([[versionId, artVersion]]); },
      async collageVersionForPreview(version) { artworkReads++; return { ...version, design: { ...version.design, overlay: "data:image/png;base64,YXJ0" } }; },
    },
  });
  const request = (ids, artwork = false) => new NextRequest(`https://example.test/api/portal/collages?parentLaneId=${itemId}&versionIds=${ids.join(",")}${artwork ? "&artwork=1" : ""}`);
  const response = await route.GET(request([versionId, other])); assert.equal(response.status, 200);
  const payload = await response.json(); assert.deepEqual(payload.unavailableVersionIds, [other]); assert.equal(payload.versions.length, 1);
  assert.equal(payload.versions[0].design.overlay, null); assert.equal(payload.versions[0].hasArtwork, true); assert.equal(artworkReads, 0);
  assert.equal((await route.GET(request([versionId, other], true))).status, 400); assert.equal(artworkReads, 0);
  assert.equal((await route.GET(request([other], true))).status, 403); assert.equal(artworkReads, 0);
  const artResponse = await route.GET(request([versionId], true)); assert.equal(artResponse.status, 200); assert.equal(artworkReads, 1);
  assert.match((await artResponse.json()).versions[0].design.overlay, /^data:image\/png/);
});
test("gallery withdrawal authenticates the owner and binds its service-only RPC without altering paid recipes", async () => {
  for (const denied of [false, true]) {
    let calls = 0;
    const route = moduleAt("app/api/dashboard/collages/[versionId]/withdraw/route", {
      "@/lib/collage-server": { ...core, async collageDashboardAccess(_request, mutate) { assert.equal(mutate, true); return { photographerId: owner, user: { id: other }, service: { async rpc(name, args) {
        calls++; assert.equal(name, "withdraw_collage_gallery_access"); assert.deepEqual(args, { p_version_id: versionId, p_photographer_id: owner });
        return denied ? { data: null, error: { code: "42501" } } : { data: 2, error: null };
      } } }; } },
      "@/lib/rate-limit": { async rateLimit() { return { allowed: true }; } },
    });
    const response = await route.POST(new NextRequest(`https://example.test/api/dashboard/collages/${versionId}/withdraw`, { method: "POST" }), { params: Promise.resolve({ versionId }) });
    assert.equal(response.status, denied ? 404 : 200); assert.equal(calls, 1);
    if (!denied) assert.equal((await response.json()).revokedCount, 2);
  }
});
