import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", code)(name => {
    if (name in dependencies) return dependencies[name];
    if (name === "zod" || name.startsWith("node:")) return require(name);
    if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`, dependencies);
    throw Error(`Unexpected module ${name}`);
  }, exports);
  return exports;
}
const settings = load("lib/event-gallery-settings.ts");
const helper = load("lib/school-visitor-email-template.ts");
const draft = { subject: "Reminder", headline: "Photos are ready", message: "Hello,\n\n  Keep this exact message.\n" };
const initialVersion = "11111111-1111-4111-8111-111111111111";

function fixture({ version = initialVersion, gallerySettings = { extras: { pickupEnabled: false }, unknownFutureSetting: { keep: true } }, user = { id: "owner" }, mfaSatisfied = true, owner = "photographer", agreement = { ok: true }, race, failure } = {}) {
  const state = {
    school: { id: "school", photographer_id: owner, gallery_settings: version === null ? structuredClone(gallerySettings) : { ...structuredClone(gallerySettings), visitorEmailSettingsRevision: version } },
    writes: [], filters: [], reads: [], audits: [], raced: false,
  };
  const db = { from(table) {
    const predicates = [];
    let update;
    const query = {
      select(columns) { if (table === "schools") assert.equal(columns?.split(",").includes("updated_at"), false, "Live schools schema has no updated_at column"); return query; },
      eq(key, value) { assert.notEqual(key, "updated_at"); predicates.push({ method: "eq", key, value }); return query; },
      is(key, value) { assert.notEqual(key, "updated_at"); predicates.push({ method: "is", key, value }); return query; },
      update(value) { assert.equal("updated_at" in value, false); update = structuredClone(value); return query; },
      async maybeSingle() {
        state.reads.push(table);
        if (failure === table) return { data: null, error: { message: "database unavailable" } };
        const row = table === "photographers" ? { id: "photographer", user_id: "owner" } : state.school;
        const matches = predicates.every(({ method, key, value }) => {
          if (method === "eq" && value === null) return false;
          if (key === "gallery_settings" && value !== null) return JSON.stringify(row[key]) === value;
          return (key === "gallery_settings->>visitorEmailSettingsRevision" ? row.gallery_settings?.visitorEmailSettingsRevision ?? null : row[key]) === value;
        });
        if (update) {
          state.filters.push(predicates);
          if (!matches) return { data: null, error: null };
          state.school = { ...state.school, ...update };
          state.writes.push(update);
          return { data: structuredClone(state.school), error: null };
        }
        const data = matches ? structuredClone(row) : null;
        if (table === "schools" && data && !state.raced && race) {
          state.raced = true;
          state.school = race(structuredClone(state.school));
        }
        return { data, error: null };
      },
    };
    return query;
  } };
  const next = { NextResponse: { json: (body, init) => Response.json(body, init) } };
  const route = load("app/api/dashboard/schools/[schoolId]/visitors/template/route.ts", {
    "next/server": next,
    "@/lib/dashboard-auth": { resolveDashboardAuth: async () => ({ user, mfaSatisfied }), createDashboardServiceClient: () => db },
    "@/lib/require-agreement": { guardAgreement: async () => agreement },
    "@/lib/audit": { recordAudit: async value => state.audits.push(value) },
  });
  const context = { params: Promise.resolve({ schoolId: "school" }) };
  const request = body => ({ json: async () => body });
  const save = (body = { template: draft, expectedVersion: version }) => route.PUT(request(body), context);
  const read = () => route.GET({}, context);
  return { state, save, read };
}

test("template merge and normalization preserve all text and unrelated settings", () => {
  const previous = { extras: { pickupEnabled: false }, futureSetting: ["keep"] };
  const merged = helper.mergeSchoolVisitorEmailTemplate(previous, draft);
  assert.deepEqual(merged, { ...previous, visitorEmailTemplate: draft });
  assert.deepEqual(previous, { extras: { pickupEnabled: false }, futureSetting: ["keep"] });
  assert.deepEqual(helper.readSchoolVisitorEmailTemplate(merged), draft);
  assert.deepEqual(settings.normalizeEventGallerySettings(merged).visitorEmailTemplate, draft);
  assert.equal(settings.sanitizeEventGallerySettingsForClient(merged).visitorEmailTemplate, undefined);
  assert.equal(helper.readSchoolVisitorEmailTemplate(null), null);
  assert.equal(helper.readSchoolVisitorEmailTemplate({ visitorEmailTemplate: { message: "broken" } }), null);
});

test("save then reload returns the exact school template and advances its version", async () => {
  const f = fixture();
  const before = await f.read();
  assert.equal(before.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await before.json(), { ok: true, template: null, version: initialVersion });
  const response = await f.save();
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.deepEqual(saved.template, draft);
  assert.notEqual(saved.version, initialVersion);
  assert.deepEqual(await (await f.read()).json(), saved);
  assert.deepEqual(f.state.school.gallery_settings.extras, { pickupEnabled: false });
  assert.deepEqual(f.state.school.gallery_settings.unknownFutureSetting, { keep: true });
  assert.equal(f.state.audits.length, 1);
  assert.equal(JSON.stringify(f.state.audits).includes(draft.message), false);
});

test("unfinished and empty messages persist without falling back to a different template", async () => {
  const f = fixture({ version: null, gallerySettings: null });
  const empty = { subject: "", headline: "", message: "" };
  const response = await f.save({ template: empty, expectedVersion: null });
  assert.equal(response.status, 200);
  assert.deepEqual((await (await f.read()).json()).template, empty);
  assert.ok(f.state.filters[0].some(row => row.method === "is" && row.key === "gallery_settings->>visitorEmailSettingsRevision" && row.value === null));
  assert.equal(f.state.filters[0].some(row => row.key === "gallery_settings"), false);
});

test("stale versions and settings races are rejected without overwriting either draft or preferences", async () => {
  const stale = fixture();
  assert.equal((await stale.save({ template: draft, expectedVersion: "older-version" })).status, 409);
  assert.equal(stale.state.writes.length, 0);
  {
    const f = fixture({ race: row => ({ ...row, gallery_settings: { visitorEmailSettingsRevision: "22222222-2222-4222-8222-222222222222", extras: { pickupEnabled: true }, visitorEmailTemplate: { ...draft, message: "Newer draft" } } }) });
    const response = await f.save();
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "template_conflict");
    assert.equal(body.template.message, "Newer draft");
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.state.school.gallery_settings.extras.pickupEnabled, true);
  }
});

test("long templates use only scalar concurrency predicates, keeping request URLs bounded", async () => {
  const f = fixture({ gallerySettings: { visitorEmailTemplate: { ...draft, message: "x".repeat(10_000) }, future: "y".repeat(10_000) } });
  assert.equal((await f.save()).status, 200);
  assert.equal(f.state.filters[0].some(row => row.key === "gallery_settings"), false);
  assert.ok(f.state.filters[0].every(row => String(row.value ?? "").length < 200));
});

test("same template save is idempotent and does not churn the school version", async () => {
  const f = fixture({ gallerySettings: { visitorEmailTemplate: draft } });
  const response = await f.save();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, initialVersion);
  assert.equal(f.state.writes.length, 0);
});

test("owner, MFA and current agreement checks fail before template mutation", async () => {
  for (const [options, status] of [[{ user: null }, 401], [{ mfaSatisfied: false }, 403], [{ owner: "foreign" }, 404], [{ agreement: { ok: false, status: 403, body: { error: "Agreement required", code: "agreement_required" } } }, 403]]) {
    const f = fixture(options);
    assert.equal((await f.save()).status, status);
    assert.equal(f.state.writes.length, 0);
    if (options.user === null || options.mfaSatisfied === false) assert.equal(f.state.reads.length, 0);
  }
  const other = fixture({ owner: "foreign" });
  assert.equal((await other.read()).status, 404);
});

test("invalid bodies and unavailable database never claim a template was saved", async () => {
  for (const body of [{ template: draft }, { template: { ...draft, message: "x".repeat(10001) }, expectedVersion: initialVersion }, { template: { ...draft, subject: 12 }, expectedVersion: initialVersion }]) {
    const f = fixture();
    assert.equal((await f.save(body)).status, 400);
    assert.equal(f.state.writes.length, 0);
  }
  const failed = fixture({ failure: "schools" });
  assert.equal((await failed.save()).status, 503);
  assert.equal((await failed.read()).status, 503);
  assert.equal(failed.state.writes.length, 0);
});
