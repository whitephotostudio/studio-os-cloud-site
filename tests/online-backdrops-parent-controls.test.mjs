import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const load = (file, require = () => { throw Error("Unexpected import"); }) => {
  const exports = {};
  new Function("exports", "require", compile(read(file)))(exports, require);
  return exports;
};
const policy = load("lib/online-backdrop-policy.ts");
const access = load("lib/parent-backdrop-access.ts");
const proofWatermark = load("lib/proof-watermark.ts");
const schoolId = "10000000-0000-4000-8000-000000000001";
const photographerId = "20000000-0000-4000-8000-000000000001";
const portraits = Array.from({ length: 8 }, (_, index) => ({
  id: `pose-${index}`, storage_path: `${schoolId}/Class/Child/pose-${index}.jpg`,
  preview_url: `/authorized-preview-${index}.jpg`, filename: `pose-${index}.jpg`,
}));
const composite = { id: "class-composite", preview_url: "/authorized-class.jpg" };
const cutouts = { "pose-0": "/authorized-paid-cutout.png" };
const catalog = [{ id: "background", photographer_id: photographerId, active: true, name: "Blue", image_url: "/blue.jpg" }];
const paidDownloadAccess = { enabled: true, hasPaidDigitalOrder: true, canDownload: true };

function galleryFixture({ studioDefault, schoolOverride, catalogActive = true } = {}) {
  const reads = [], signedCatalogs = [];
  const student = { id: "child", school_id: schoolId, pin: "12345", first_name: "Synthetic", class_name: "Class", photo_url: "/original.jpg" };
  const school = { id: schoolId, school_name: "Synthetic school", photographer_id: photographerId,
    online_backdrops_override: schoolOverride, gallery_settings: {} };
  const photographer = { id: photographerId, online_backdrops_enabled: studioDefault, billing_currency: "cad", watermark_opacity: 0.35 };
  const service = {
    from(table) {
      const filters = []; let single = false;
      const query = {
        select(columns) { reads.push({ table, columns }); return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        order() { return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          const data = (table === "schools" ? [school] : table === "students" ? [student] :
            table === "photographers" ? [photographer] : table === "backdrop_catalog" ?
              catalog.map((row) => ({ ...row, active: catalogActive })) : [])
            .filter((row) => filters.every((matches) => matches(row)));
          return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve, reject);
        },
        insert() { assert.fail("Gallery reads cannot write photos or orders"); },
        update() { assert.fail("Gallery reads cannot update photos or orders"); },
      };
      return query;
    },
  };
  const stubs = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/dashboard-auth": { createDashboardServiceClient: () => service },
    "@/lib/online-backdrop-policy": policy,
    "@/lib/proof-watermark": proofWatermark,
    "@/lib/order-currency": { resolvePhotographerOrderCurrency: () => "cad" },
    "@/lib/rate-limit": { rateLimit: async () => ({ allowed: true }), getClientIp: () => "fixture" },
    "@/lib/portal-pin-rate-limit": { grantPortalPinBudget: response => response },
    "@/lib/event-gallery-settings": { sanitizeEventGallerySettingsForClient: () => ({ extras: {} }) },
    "@/lib/school-gallery-downloads": { buildSchoolGalleryDownloadAccess: async () => paidDownloadAccess },
    "@/lib/package-profile-selection": { filterPackagesForProfile: (packages) => ({ packages }) },
    "@/lib/subscription-gate": { hasActiveSubscription: () => true },
    "@/lib/checkout-tax": { applyCheckoutTaxFallbackToSettings: (settings) => settings },
    "@/lib/storage-images": { SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS: 3600 },
    "@/lib/private-media-references": { signedPrivateMediaReference: (value) => value },
    "@/lib/calendar-dates": { hasCalendarBoundaryPassed: () => false },
    "@/lib/r2-access-security": { isUuid: (value) => value === schoolId },
    "@/lib/backdrop-media-references": { signBackdropRows: (rows) => { signedCatalogs.push(rows); return rows; } },
    "@/lib/school-order-media": { loadScopedSchoolCompositeMedia: async () => [composite] },
    "@/lib/storage-folder": { buildSchoolCandidateFolders: () => [], loadFolderMediaRows: async () => portraits, loadNoBgUrlMapForMediaRows: async () => cutouts },
    "@/lib/school-photo-deletions": { loadSchoolPhotoTombstones: async () => [], tombstoneFamilySet: () => new Set(),
      clearTombstonedSchoolPhotoReferences: (rows) => rows, clearOutOfScopeSchoolPhotoReferences: (rows) => rows },
    "@/lib/school-portal-media": { schoolPreviewPresentation: (input) => ({ students: input.students,
      media: input.media, composites: input.composites, nobgUrls: input.nobgUrls }), buildSchoolFavoriteDownloadAccess: async () => paidDownloadAccess },
  };
  const route = load("app/api/portal/gallery-context/route.ts", (name) => {
    assert.ok(name in stubs, `Unexpected import: ${name}`); return stubs[name];
  });
  return { reads, signedCatalogs, async get() {
    const response = await route.POST(new Request("https://fixture.test/api/portal/gallery-context", {
      method: "POST", body: JSON.stringify({ pin: "12345", schoolId, email: "parent@example.test" }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    return response.json();
  } };
}

test("real parent context applies school overrides and preserves eight photos, cutouts and paid download access", async () => {
  const originalState = JSON.stringify({ portraits, composite, cutouts, catalog, paidDownloadAccess });
  for (const [studioDefault, schoolOverride, enabled] of [[undefined, undefined, true], [false, null, false], [true, false, false], [false, true, true]]) {
    const fixture = galleryFixture({ studioDefault, schoolOverride });
    const context = await fixture.get();
    assert.equal(context.onlineBackdropsEnabled, enabled);
    assert.equal(context.watermarkOpacity, proofWatermark.normalizeProofWatermarkOpacity(0.35), "Merged watermark setting is independent from catalogue visibility");
    assert.equal(context.backdrops.length, enabled ? 1 : 0);
    assert.equal(fixture.signedCatalogs.length, enabled ? 1 : 0);
    assert.deepEqual(context.media.map((row) => row.id), portraits.map((row) => row.id));
    assert.deepEqual(context.composites, [composite]);
    assert.deepEqual(context.nobgUrls, cutouts);
    assert.deepEqual(context.downloadAccess, paidDownloadAccess);
    assert.deepEqual(context.favoriteDownloadAccess, paidDownloadAccess);
    assert.equal(JSON.stringify({ portraits, composite, cutouts, catalog, paidDownloadAccess }), originalState);
  }
});

test("Hide on every catalogue row hides parent options without changing the studio default or original photos", async () => {
  const context = await galleryFixture({ studioDefault: true, catalogActive: false }).get();
  assert.equal(context.onlineBackdropsEnabled, true);
  assert.equal(context.backdrops.length, 0);
  assert.equal(access.canOfferParentBackdrops({ onlineBackdropsEnabled: context.onlineBackdropsEnabled,
    schoolMode: true, composite: false, catalogCount: context.backdrops.length, cutoutUrl: cutouts["pose-0"] }), false);
  assert.equal(context.media.length, 8);
  assert.deepEqual(context.downloadAccess, paidDownloadAccess);
});

const page = read("app/parents/[pin]/page.tsx");
const ast = ts.createSourceFile("parents.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function effectContaining(fragment) {
  let callback;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
        node.arguments[0]?.getText(ast).includes(fragment)) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(callback);
  return callback.getText(ast);
}

test("returning to the open parent gallery refreshes only backdrop controls and ignores mismatched authorization", async () => {
  for (const authorized of [true, false]) {
    const listeners = new Map(), states = [], requests = [], timers = new Map();
    const values = { isSchoolMode: true, loading: false, schoolId, photographerId,
      student: { id: "child" }, pin: "12345", schoolViewerEmail: "parent@example.test", AbortController,
      document: { visibilityState: "visible", addEventListener: (event, handler) => listeners.set(event, handler),
        removeEventListener: (event) => listeners.delete(event) },
      window: { addEventListener: (event, handler) => listeners.set(event, handler), removeEventListener: (event) => listeners.delete(event),
        setTimeout: (handler, delay) => { timers.set(1, { handler, delay }); return 1; }, clearTimeout: (id) => timers.delete(id) },
      setOnlineBackdropsEnabled: (value) => states.push(["enabled", value]), setBackdrops: (value) => states.push(["catalog", value]),
      fetch: async (url, request) => { requests.push({ url, request }); return { ok: true, json: async () => ({ ok: true,
        photographerId: authorized ? photographerId : "other-studio", activeSchool: { id: schoolId }, primaryStudent: { id: "child" },
        onlineBackdropsEnabled: false, backdrops: catalog }) }; },
    };
    const effect = new Function(...Object.keys(values), compile(`return ${effectContaining("async function refreshOnlineBackdropControls")};`))(...Object.values(values));
    const cleanup = effect();
    listeners.get("focus")(); listeners.get("visibilitychange")();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 1, "focus and visibility events share one refresh");
    assert.equal(requests[0].request.cache, "no-store");
    assert.deepEqual(states, authorized ? [["enabled", false], ["catalog", []]] : []);
    assert.equal(timers.size, 0, "successful or unauthorized responses release the timeout");
    cleanup(); assert.equal(listeners.size, 0);
  }
});

function refreshHarness(fetchResponse) {
  const listeners = new Map(), timers = new Map(), states = [], requests = [];
  let nextTimer = 0;
  const values = { isSchoolMode: true, loading: false, schoolId, photographerId,
    student: { id: "child" }, pin: "12345", schoolViewerEmail: "parent@example.test", AbortController,
    document: { visibilityState: "visible", addEventListener: (event, handler) => listeners.set(event, handler),
      removeEventListener: (event) => listeners.delete(event) },
    window: { addEventListener: (event, handler) => listeners.set(event, handler), removeEventListener: (event) => listeners.delete(event),
      setTimeout: (handler, delay) => { const id = ++nextTimer; timers.set(id, { handler, delay }); return id; },
      clearTimeout: (id) => timers.delete(id) },
    setOnlineBackdropsEnabled: (value) => states.push(["enabled", value]), setBackdrops: (value) => states.push(["catalog", value]),
    fetch: (url, request) => { requests.push({ url, request }); return fetchResponse(requests.length, request); },
  };
  const effect = new Function(...Object.keys(values), compile(`return ${effectContaining("async function refreshOnlineBackdropControls")};`))(...Object.values(values));
  const cleanup = effect();
  return { listeners, timers, states, requests, cleanup };
}
const refreshResponse = (enabled) => ({ ok: true, json: async () => ({ ok: true, photographerId,
  activeSchool: { id: schoolId }, primaryStudent: { id: "child" }, onlineBackdropsEnabled: enabled, backdrops: catalog }) });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a stalled focus request times out, aborts and allows the next focus without applying a late response", async () => {
  let finishStalledRequest;
  const harness = refreshHarness((attempt) => attempt === 1
    ? new Promise((resolve) => { finishStalledRequest = resolve; })
    : Promise.resolve(refreshResponse(false)));
  harness.listeners.get("focus")();
  harness.listeners.get("visibilitychange")();
  assert.equal(harness.requests.length, 1);
  const [timeoutId, timeout] = [...harness.timers][0];
  assert.equal(timeout.delay, 15_000, "refresh remains bounded without polling");
  harness.timers.delete(timeoutId);
  timeout.handler();
  await settle();
  assert.equal(harness.requests[0].request.signal.aborted, true);
  assert.deepEqual(harness.states, [], "timeout cannot discard gallery controls, photos or orders");

  harness.listeners.get("focus")();
  await settle();
  assert.equal(harness.requests.length, 2, "timeout releases the refresh lock");
  assert.notEqual(harness.requests[0].request.signal, harness.requests[1].request.signal);
  assert.equal(harness.requests[1].request.signal.aborted, false, "retry uses a fresh controller");
  assert.deepEqual(harness.states, [["enabled", false], ["catalog", []]]);
  assert.equal(harness.timers.size, 0);

  finishStalledRequest(refreshResponse(true));
  await settle();
  assert.deepEqual(harness.states, [["enabled", false], ["catalog", []]], "a timed-out late response cannot replace the newer policy");
  harness.cleanup();
  assert.equal(harness.listeners.size, 0);
});

test("a stalled gallery response body is also bounded and gallery teardown aborts pending refreshes", async () => {
  let finishBody;
  const harness = refreshHarness(() => Promise.resolve({ ok: true, json: () => new Promise((resolve) => { finishBody = resolve; }) }));
  harness.listeners.get("focus")();
  await settle();
  const timeout = [...harness.timers.values()][0];
  timeout.handler();
  await settle();
  assert.equal(harness.requests[0].request.signal.aborted, true);
  assert.equal(harness.timers.size, 0);
  harness.listeners.get("focus")();
  await settle();
  assert.equal(harness.requests.length, 2, "a body timeout also releases the lock");
  harness.cleanup();
  assert.equal(harness.requests[1].request.signal.aborted, true);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.listeners.size, 0);
  finishBody(await refreshResponse(true).json());
  await settle();
  assert.deepEqual(harness.states, [], "unmounted gallery cannot apply a late policy response");
});

test("policy-off or Hide All clears only the actively edited choice and closes the selector", () => {
  for (const [enabled, rows] of [[false, catalog], [true, []]]) {
    const calls = [];
    const values = { loading: false, isSchoolMode: true, onlineBackdropsEnabled: enabled, backdrops: rows,
      confirmedBackdrop: catalog[0], selectedBackdrop: catalog[0],
      window: { setTimeout: (callback) => { callback(); return 1; }, clearTimeout: () => {} },
      handleClearBackdrop: () => calls.push("clear-draft"), setBackdropPickerOpen: (value) => calls.push(["picker", value]),
      setShowPremiumModal: (value) => calls.push(["premium", value]), setPremiumTarget: (value) => calls.push(["target", value]),
    };
    const effect = new Function(...Object.keys(values), compile(`return ${effectContaining("const chosenBackdropHidden")};`))(...Object.values(values));
    effect();
    assert.deepEqual(calls, ["clear-draft", ["picker", false], ["premium", false], ["target", null]]);
    // There are no cart, image, history or delivery setters in this harness.
  }
});
