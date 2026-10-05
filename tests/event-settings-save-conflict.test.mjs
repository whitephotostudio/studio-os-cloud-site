import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { z } from "zod";
import ts from "typescript";

const PROJECT_ID = "project-a";
const PHOTOGRAPHER_ID = "photographer-a";
const INITIAL_VERSION = "2026-10-04T23:00:00.000Z";
const CONCURRENT_VERSION = "2026-10-04T23:00:01.000Z";
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadModule(path, modules) {
  const exports = {};
  vm.runInNewContext(compile(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")), {
    exports, URL, Response, Request,
    console: { log() {}, error() {} },
    require(name) {
      assert.ok(name in modules, `Unexpected dependency ${name}`);
      return modules[name];
    },
  });
  return exports;
}

const nextServer = { NextResponse: {
  json(body, options = {}) {
    return new Response(JSON.stringify(body), {
      status: options.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  },
} };
const validation = loadModule("lib/api-validation.ts", { "next/server": nextServer });
const settings = loadModule("lib/event-gallery-settings.ts", {});

/** Execute the route against a database double that honors scoped, atomic predicates. */
function routeHarness({ project = {}, raceAfterRead, user = { id: "owner-user" } } = {}) {
  const state = {
    project: {
      id: PROJECT_ID, photographer_id: PHOTOGRAPHER_ID,
      title: "Original gallery", portal_status: "pre_release", status: "pre_release",
      event_date: "2026-10-01", shoot_date: "2026-10-01",
      updated_at: INITIAL_VERSION,
      gallery_settings: { extras: { sendEmailCampaign: false } },
      ...clone(project),
    },
    updateQueries: [], writes: [], emails: [], deliveries: [], audits: [], reads: [],
    linkResolutions: 0, packageResolutions: 0, projectRead: false,
  };
  const photographer = { id: PHOTOGRAPHER_ID, user_id: "owner-user", business_name: "Test studio" };
  const service = {
    from(table) {
      const query = {
        filters: [], payload: undefined,
        select() { return query; },
        eq(field, value) { query.filters.push({ method: "eq", field, value }); return query; },
        is(field, value) { query.filters.push({ method: "is", field, value }); return query; },
        update(payload) {
          query.payload = clone(payload);
          state.updateQueries.push(query);
          return query;
        },
        matches(row) {
          return !!row && query.filters.every(filter => {
            // SQL column = NULL does not match; an IS NULL predicate does.
            if (filter.method === "eq" && filter.value === null) return false;
            return row[filter.field] === filter.value;
          });
        },
        execute() {
          if (query.payload) {
            assert.equal(table, "projects", "The route must not write unrelated tables");
            if (!query.matches(state.project)) return { data: null, error: null };
            state.project = { ...state.project, ...clone(query.payload) };
            state.writes.push(clone(query.payload));
            return { data: clone(state.project), error: null };
          }
          state.reads.push(table);
          if (table === "photographers") return { data: query.matches(photographer) ? clone(photographer) : null, error: null };
          if (table === "projects") {
            const snapshot = query.matches(state.project) ? clone(state.project) : null;
            if (snapshot && !state.projectRead) {
              state.projectRead = true;
              if (raceAfterRead) state.project = raceAfterRead(clone(state.project));
            }
            return { data: snapshot, error: null };
          }
          const recipient = { project_id: PROJECT_ID, email: "client@example.test", viewer_email: "client@example.test" };
          if (["pre_release_emails", "event_gallery_visitors", "event_gallery_favorites"].includes(table)) {
            return { data: query.matches(recipient) ? [recipient] : [], error: null };
          }
          throw new Error(`Unexpected table ${table}`);
        },
        async maybeSingle() { return query.execute(); },
        then(resolve, reject) { return Promise.resolve().then(() => query.execute()).then(resolve, reject); },
      };
      return query;
    },
  };
  const route = loadModule("app/api/dashboard/events/[id]/route.ts", {
    "next/server": nextServer,
    zod: { z },
    "@/lib/dashboard-auth": { resolveDashboardAuth: async () => ({ user }), createDashboardServiceClient: () => service },
    "@/lib/api-validation": validation,
    "@/lib/event-gallery-settings": settings,
    "@/lib/require-agreement": { guardAgreement: async () => ({ ok: true }) },
    "@/lib/audit": {
      diffFields(before, after, fields) {
        const changed = fields.filter(field => before[field] !== after[field]);
        return {
          before: Object.fromEntries(changed.map(field => [field, before[field]])),
          after: Object.fromEntries(changed.map(field => [field, after[field]])),
        };
      },
      recordAudit: async value => { state.audits.push(clone(value)); },
    },
    "@/lib/event-gallery-email": {
      buildGalleryShareEmail: () => ({ subject: "Gallery ready", html: "<p>Ready</p>", text: "Ready" }),
      eventFromName: () => "Test studio", eventReplyTo: () => "studio@example.test",
    },
    "@/lib/project-email-deliveries": {
      hasProjectEmailDelivery: async () => false,
      recordProjectEmailDelivery: async (_service, delivery) => { state.deliveries.push(clone(delivery)); },
    },
    "@/lib/resend": {
      resendConfigured: () => true,
      sendResendEmail: async email => { state.emails.push(clone(email)); return { id: `email-${state.emails.length}` }; },
    },
    "@/lib/ensure-package-profile": { ensurePackageProfile: async ({ packageProfileId }) => {
      state.packageResolutions++;
      return packageProfileId;
    } },
    "@/lib/storage-images": {},
    "@/lib/school-photo-deletions": {},
    "@/lib/school-project-photo-mapping": { resolveOwnedProjectLinkedSchool: async () => {
      state.linkResolutions++;
      return { status: "none", school: null };
    } },
  });
  return {
    state,
    async patch(body) {
      const response = await route.PATCH(new Request("https://studiooscloud.example/api/dashboard/events/project-a", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }), { params: Promise.resolve({ id: PROJECT_ID }) });
      return { status: response.status, body: await response.json() };
    },
  };
}

const publishPatch = (expectedUpdatedAt = INITIAL_VERSION) => ({
  expected_updated_at: expectedUpdatedAt,
  title: "Owner's new gallery", portal_status: "active",
  event_date: "2026-10-15", shoot_date: "2026-10-15",
  gallery_settings: { extras: { sendEmailCampaign: true } },
});

function assertConflictHasNoEffects(harness, result) {
  assert.equal(result.status, 409);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.message, "Project changed in cloud. Refresh and save again.");
  assert.equal(harness.state.writes.length, 0);
  assert.equal(harness.state.emails.length, 0);
  assert.equal(harness.state.deliveries.length, 0);
  assert.equal(harness.state.audits.length, 0);
  assert.equal(harness.state.reads.some(table => ["pre_release_emails", "event_gallery_visitors", "event_gallery_favorites"].includes(table)), false);
}

test("stale settings return 409 before project, profile, email, or audit changes", async () => {
  const harness = routeHarness({ project: { updated_at: CONCURRENT_VERSION, title: "Other device's gallery" } });
  const result = await harness.patch({ ...publishPatch(), package_profile_id: "new-price-sheet" });
  assertConflictHasNoEffects(harness, result);
  assert.equal(harness.state.project.title, "Other device's gallery");
  assert.equal(harness.state.updateQueries.length, 0);
  assert.equal(harness.state.packageResolutions, 0);
  assert.equal(harness.state.linkResolutions, 0);
});

test("a concurrent write after the read wins and the atomic guarded update returns 409", async () => {
  const harness = routeHarness({ raceAfterRead: row => ({ ...row, title: "Concurrent cloud edit", updated_at: CONCURRENT_VERSION }) });
  assertConflictHasNoEffects(harness, await harness.patch(publishPatch()));
  assert.equal(harness.state.project.title, "Concurrent cloud edit");
  assert.equal(harness.state.project.portal_status, "pre_release");
  assert.equal(harness.state.project.event_date, "2026-10-01");
  assert.equal(harness.state.updateQueries.length, 1);
  assert.ok(harness.state.updateQueries[0].filters.some(filter => filter.method === "eq" && filter.field === "updated_at" && filter.value === INITIAL_VERSION));
});

test("matching versions persist both date fields and exclude the version precondition from stored data", async () => {
  const harness = routeHarness();
  const result = await harness.patch({ expected_updated_at: INITIAL_VERSION, event_date: " 2026-10-15 ", shoot_date: "2026-10-15", title: "New date" });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.project.event_date, "2026-10-15");
  assert.equal(harness.state.project.event_date, "2026-10-15");
  assert.equal(harness.state.project.shoot_date, "2026-10-15");
  assert.equal("expected_updated_at" in harness.state.writes[0], false);
  assert.equal(harness.state.writes.length, 1);
  assert.notEqual(harness.state.project.updated_at, INITIAL_VERSION);
  assert.equal(harness.state.audits.length, 1);
  assert.equal(harness.state.audits[0].after.event_date, "2026-10-15");
});

test("a null stored version uses an atomic IS NULL update and can clear the event date", async () => {
  const harness = routeHarness({ project: { updated_at: null } });
  const result = await harness.patch({ expected_updated_at: null, event_date: null });
  assert.equal(result.status, 200);
  assert.equal(harness.state.project.event_date, null);
  assert.ok(harness.state.updateQueries[0].filters.some(filter => filter.method === "is" && filter.field === "updated_at" && filter.value === null));
  assert.equal(harness.state.updateQueries[0].filters.some(filter => filter.method === "eq" && filter.field === "updated_at"), false);
});

test("a concurrent edit to an initially unversioned project also returns 409 without effects", async () => {
  const harness = routeHarness({ project: { updated_at: null }, raceAfterRead: row => ({ ...row, updated_at: CONCURRENT_VERSION }) });
  assertConflictHasNoEffects(harness, await harness.patch(publishPatch(null)));
  assert.equal(harness.state.project.updated_at, CONCURRENT_VERSION);
});

test("older callers without expected_updated_at retain their existing update behavior", async () => {
  const harness = routeHarness({ raceAfterRead: row => ({ ...row, updated_at: CONCURRENT_VERSION }) });
  const result = await harness.patch({ event_date: "2026-11-03", title: "Legacy caller" });
  assert.equal(result.status, 200);
  assert.equal(harness.state.project.title, "Legacy caller");
  assert.equal(harness.state.project.event_date, "2026-11-03");
  assert.equal(harness.state.updateQueries[0].filters.some(filter => filter.field === "updated_at"), false);
  assert.equal(harness.state.writes.length, 1);
});

test("matching publish saves still trigger the real release and campaign paths after updating", async () => {
  const harness = routeHarness();
  const result = await harness.patch(publishPatch());
  assert.equal(result.status, 200);
  assert.equal(harness.state.writes.length, 1);
  assert.equal(harness.state.emails.length, 2);
  assert.deepEqual(harness.state.deliveries.map(delivery => delivery.emailType), ["gallery_release", "campaign"]);
  assert.equal(harness.state.deliveries.every(delivery => delivery.status === "sent"), true);
  assert.equal(harness.state.audits.length, 1);
});

test("a guarded project disappearing after its read is a conflict; legacy callers still get 404", async () => {
  for (const guarded of [true, false]) {
    const harness = routeHarness({ raceAfterRead: () => null });
    const result = await harness.patch({ title: "New title", ...(guarded ? { expected_updated_at: INITIAL_VERSION } : {}) });
    if (guarded) assertConflictHasNoEffects(harness, result);
    else {
      assert.equal(result.status, 404);
      assert.equal(result.body.message, "Project not found.");
      assert.equal(harness.state.writes.length, 0);
    }
  }
});

test("the guard preserves owner scoping and does not expose another photographer's project", async () => {
  const harness = routeHarness({ project: { photographer_id: "photographer-other" } });
  const result = await harness.patch(publishPatch());
  assert.equal(result.status, 404);
  assert.equal(harness.state.updateQueries.length, 0);
  assert.equal(harness.state.emails.length, 0);
  const signedOut = routeHarness({ user: null });
  assert.equal((await signedOut.patch(publishPatch())).status, 401);
  assert.equal(signedOut.state.reads.length, 0);
});

test("the real request schema accepts optional dates and rejects malformed version inputs before database access", async () => {
  const harness = routeHarness();
  const result = await harness.patch({ expected_updated_at: 123, event_date: "2026-11-03" });
  assert.equal(result.status, 400);
  assert.ok(result.body.issues.some(issue => issue.path === "expected_updated_at"));
  assert.equal(harness.state.reads.length, 0);
  assert.equal(harness.state.writes.length, 0);
});
