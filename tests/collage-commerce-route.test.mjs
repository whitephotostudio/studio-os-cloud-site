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
  new Function("exports", "require", ts.transpileModule(readFileSync(new URL(`../${path}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(exports, id => Object.hasOwn(mocks, id) ? mocks[id] : id.startsWith("@/") ? moduleAt(id.slice(2), mocks, cache) : nativeRequire(id));
  return exports;
}
const sharedCache = new Map();
const core = moduleAt("lib/collage-server", {}, sharedCache), commerce = moduleAt("lib/collage-commerce", {}, sharedCache), { collagePreset } = moduleAt("lib/collage-template", {}, sharedCache);
const owner = "11111111-1111-4111-8111-111111111111", school = "22222222-2222-4222-8222-222222222222", versionId = "33333333-3333-4333-8333-333333333333", productId = "44444444-4444-4444-8444-444444444444", requestId = "55555555-5555-4555-8555-555555555555";
const state = () => ({ owner: { id: owner, billing_currency: "cad", default_package_profile_id: null }, profiles: [], schools: [{ id: school, photographer_id: owner, school_name: "School", package_profile_id: null, gallery_settings: null }], projects: [], packages: [] });
const body = snapshot => ({ requestId, catalogRevision: commerce.commerceHash(snapshot), design: collagePreset("triptych"), galleries: [{ kind: "school", id: school }], product: { mode: "create", profileId: null, name: "Collage print", priceCents: 2500, copyCount: 2 } });
function receipt(input) {
  return { version: { id: versionId, template_id: productId, photographer_id: owner, version_number: 1, design: input.design, artwork_key: null, content_hash: core.collageContentHash(input.design, null), published: true },
    product: { id: productId, local_id: `collage_${requestId}`, photographer_id: owner, profile_id: null, name: input.product.name, price_cents: input.product.priceCents, active: true, category: "print", items: [{ qty: input.product.copyCount, collage: { templateVersionId: versionId } }] }, currency: "cad", requestId, replayed: false };
}
function harness({ unsigned = false, limited = false, existing = false, concurrent = false, rpcConflict = false } = {}) {
  const snapshot = state(), originalBody = body(snapshot), parsed = commerce.parseCommerceRequest(originalBody), counters = { loads: 0, uploads: 0, writes: 0, attempts: 0 };
  let attempt = existing ? { payload_hash: commerce.commerceHash(parsed), response: receipt(parsed) } : null;
  const service = { from(table) { assert.equal(table, "collage_commerce_attempts"); const chain = { select() { return chain; }, eq(key, value) { if (key === "photographer_id") assert.equal(value, owner); if (key === "request_id") assert.equal(value, requestId); return chain; }, async maybeSingle() { counters.attempts++; return { data: attempt, error: null }; } }; return chain; },
    async rpc(name, args) {
      counters.writes++; assert.equal(name, "publish_collage_commerce"); assert.equal(args.p_photographer_id, owner); assert.equal(args.p_currency, "cad"); assert.deepEqual(args.p_expected_state, snapshot); assert.equal(args.p_product.priceCents, 2500);
      attempt = { payload_hash: commerce.commerceHash(parsed), response: receipt(parsed) };
      return rpcConflict ? { data: null, error: { code: "40001" } } : { data: attempt.response, error: null };
    } };
  const route = moduleAt("app/api/dashboard/collages/commerce/route", {
    "@/lib/collage-server": { ...core, async collageDashboardAccess(_request, mutate = false) { if (unsigned) throw new core.CollageAccessError("Sign in", 401); counters.mutates = mutate; return { service, photographerId: owner, user: { id: owner } }; } },
    "@/lib/rate-limit": { async rateLimit() { return { allowed: !limited }; } },
    "@/lib/collage-commerce": { ...commerce, async loadCommerceState() {
      counters.loads++;
      if (concurrent) { attempt = { payload_hash: commerce.commerceHash(parsed), response: receipt(parsed) }; snapshot.owner.billing_currency = "usd"; }
      return snapshot;
    }, async prepareCommerceArtwork(design) { counters.uploads++; return { design, artworkKey: null, contentHash: core.collageContentHash(design, null) }; } },
  });
  return { route, snapshot, counters, originalBody, setAttempt: value => { attempt = value; }, request: value => new NextRequest("https://example.test/api/dashboard/collages/commerce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value ?? originalBody) }) };
}
test("commerce endpoint returns owner catalogue and atomically publishes exact price, scoped version and local identity", async () => {
  const h = harness(), get = await h.route.GET(new NextRequest("https://example.test/api/dashboard/collages/commerce")); assert.equal(get.status, 200);
  const catalogue = await get.json(); assert.equal(catalogue.photographerId, owner); assert.equal(catalogue.currency, "cad"); assert.equal(catalogue.galleries[0].id, school); assert.equal(catalogue.catalogRevision, h.originalBody.catalogRevision);
  const result = await h.route.POST(h.request()); assert.equal(result.status, 200); const published = await result.json();
  assert.equal(published.product.priceCents, 2500); assert.equal(published.product.localId, `collage_${requestId}`); assert.equal(published.version.id, versionId); assert.equal(h.counters.writes, 1); assert.equal(h.counters.mutates, true);
});
test("lost-response retries replay before stale catalogue validation and reject a reused key with different semantics", async () => {
  const h = harness(); assert.equal((await h.route.POST(h.request())).status, 200); h.snapshot.owner.billing_currency = "usd";
  const replay = await h.route.POST(h.request()); assert.equal(replay.status, 200); const payload = await replay.json();
  assert.equal(payload.replayed, true); assert.equal(payload.currency, "cad"); assert.equal(h.counters.loads, 1); assert.equal(h.counters.uploads, 1); assert.equal(h.counters.writes, 1);
  const changed = structuredClone(h.originalBody); changed.product.priceCents = 2600;
  assert.equal((await h.route.POST(h.request(changed))).status, 409); assert.equal(h.counters.writes, 1);
});
test("an identical publication that commits during catalogue loading or transaction contention still returns its durable receipt", async () => {
  for (const options of [{ concurrent: true }, { rpcConflict: true }]) {
    const h = harness(options), response = await h.route.POST(h.request()); assert.equal(response.status, 200); assert.equal((await response.json()).replayed, true);
    assert.equal(h.counters.writes, options.concurrent ? 0 : 1);
  }
});
test("unauthorized, rate-limited, malformed, stale and foreign gallery requests never upload artwork or write catalogue state", async () => {
  for (const [options, expected] of [[{ unsigned: true }, 401], [{ limited: true }, 429]]) {
    const h = harness(options); assert.equal((await h.route.POST(h.request())).status, expected); assert.equal(h.counters.uploads, 0); assert.equal(h.counters.writes, 0);
  }
  for (const [edit, expected] of [[value => { value.product.priceCents = 25.5; }, 400], [value => { value.catalogRevision = "f".repeat(64); }, 409], [value => { value.galleries[0].id = owner; }, 403], [value => { value.design.overlay = "https://other.example/art.png"; }, 400]]) {
    const h = harness(), changed = structuredClone(h.originalBody); edit(changed);
    assert.equal((await h.route.POST(h.request(changed))).status, expected); assert.equal(h.counters.uploads, 0); assert.equal(h.counters.writes, 0);
  }
});
