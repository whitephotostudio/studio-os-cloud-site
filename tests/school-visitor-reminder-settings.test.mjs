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
    if (name === "zod") return require(name);
    if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`, dependencies);
    throw Error(`Unexpected module ${name}`);
  }, exports);
  return exports;
}
const settingsModule = load("lib/event-gallery-settings.ts");
const initialVersion = "2026-10-15T15:00:00.000Z";
const template = { subject: "Reminder", headline: "Order deadline", message: "My exact saved message\n" };
const defaults = { enabled: false, timeZone: "America/Toronto", sendHour: 9, classMode: "all", classFrom: "", classTo: "", photosOnly: true };

function fixture({ version = initialVersion, dueDate = "2026-10-19T00:00:00+00:00", gallerySettings = { visitorEmailTemplate: template, extras: { pickupEnabled: false }, future: { keep: true } }, user = { id: "owner" }, mfaSatisfied = true, owner = "photographer", agreement = { ok: true }, race, failure, status = null, statusFails = false, photoClasses = ["Grade 12 B", "7A"], eligibilityFails = false } = {}) {
  const state = {
    school: { id: "school", photographer_id: owner, gallery_settings: structuredClone(gallerySettings), order_due_date: dueDate, updated_at: version },
    otherSchool: { id: "other-school", photographer_id: owner, gallery_settings: { visitorEmailTemplate: template }, order_due_date: dueDate, updated_at: version },
    writes: [], filters: [], reads: [], audits: [], statusReads: [], photoReads: [], raced: false,
  };
  const db = { from(table) {
    const predicates = [];
    let update;
    const query = {
      select() { return query; },
      eq(key, value) { predicates.push({ method: "eq", key, value }); return query; },
      is(key, value) { predicates.push({ method: "is", key, value }); return query; },
      update(value) { update = structuredClone(value); return query; },
      async maybeSingle() {
        state.reads.push(table);
        if (failure === table) return { data: null, error: { message: "database unavailable" } };
        const row = table === "photographers" ? { id: "photographer", user_id: "owner" } : state.school;
        const matches = predicates.every(({ method, key, value }) => {
          if (method === "eq" && value === null) return false;
          if (key === "gallery_settings" && value !== null) return JSON.stringify(row[key]) === value;
          return row[key] === value;
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
  const route = load("app/api/dashboard/schools/[schoolId]/visitors/reminder/route.ts", {
    "next/server": next,
    "@/lib/dashboard-auth": { resolveDashboardAuth: async () => ({ user, mfaSatisfied }), createDashboardServiceClient: () => db },
    "@/lib/require-agreement": { guardAgreement: async () => agreement },
    "@/lib/audit": { recordAudit: async value => state.audits.push(value) },
    "@/lib/school-deadline-reminders": { loadSchoolDeadlineReminderStatus: async (_service, photographerId, schoolId, deadline) => {
      state.statusReads.push({ photographerId, schoolId, deadline });
      if (statusFails) throw Error("Status unavailable");
      return status;
    } },
    "@/lib/school-deadline-reminder-photo-classes": { loadSchoolDeadlineReminderPhotoClasses: async (_service, schoolId) => {
      state.photoReads.push(schoolId);
      if (eligibilityFails) throw Error("Photo availability unavailable");
      return new Set(photoClasses);
    } },
  });
  const context = { params: Promise.resolve({ schoolId: "school" }) };
  const request = body => ({ json: async () => body });
  const save = (body = { enabled: true, expectedVersion: version }) => route.PUT(request(body), context);
  const read = () => route.GET({}, context);
  return { state, save, read };
}

test("normalization defaults reminders off, preserves the school scope, and strips owner settings publicly", () => {
  assert.deepEqual(settingsModule.normalizeSchoolVisitorDeadlineReminder(undefined), defaults);
  const reminder = { ...defaults, enabled: true, classMode: "range", classFrom: "7A", classTo: "Grade 12" };
  assert.deepEqual(settingsModule.normalizeEventGallerySettings({ visitorDeadlineReminder: reminder }).visitorDeadlineReminder, reminder);
  assert.equal(settingsModule.sanitizeEventGallerySettingsForClient({ visitorDeadlineReminder: reminder }).visitorDeadlineReminder, undefined);
  assert.equal(settingsModule.normalizeSchoolVisitorDeadlineReminder({ enabled: "true", timeZone: "Invalid/Zone", sendHour: 23 }).enabled, false);
  assert.equal(settingsModule.normalizeSchoolVisitorDeadlineReminder({ timeZone: "Invalid/Zone" }).timeZone, "America/Toronto");
});

test("GET shows the original deadline and day-before calendar date without enabling any school", async () => {
  const f = fixture();
  const response = await f.read();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.templateReady, true);
  assert.deepEqual(body.settings, defaults);
  assert.equal(body.dueDate, "2026-10-19T00:00:00+00:00");
  assert.equal(body.plannedReminderDate, "2026-10-18");
  assert.equal(body.status, null);
  assert.deepEqual(body.photoClasses, ["7A", "Grade 12 B"]);
  assert.equal(f.state.writes.length, 0);
  assert.deepEqual(f.state.statusReads, [{ photographerId: "photographer", schoolId: "school", deadline: "2026-10-19" }]);
  assert.deepEqual(f.state.photoReads, ["school"]);
});

test("enable, reload and disable preserve the saved message and every other school setting", async () => {
  const f = fixture();
  const response = await f.save({ enabled: true, expectedVersion: initialVersion, timeZone: "America/Toronto", classMode: "range", classFrom: "7A", classTo: "Grade 12" });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.settings.enabled, true);
  assert.equal(saved.settings.classFrom, "7A");
  assert.equal(saved.settings.classTo, "Grade 12");
  assert.notEqual(saved.version, initialVersion);
  assert.deepEqual((await (await f.read()).json()).settings, saved.settings);
  assert.deepEqual(f.state.school.gallery_settings.visitorEmailTemplate, template);
  assert.deepEqual(f.state.school.gallery_settings.extras, { pickupEnabled: false });
  assert.deepEqual(f.state.school.gallery_settings.future, { keep: true });
  assert.equal(f.state.otherSchool.gallery_settings.visitorDeadlineReminder, undefined);
  const off = await f.save({ enabled: false, expectedVersion: saved.version });
  assert.equal(off.status, 200);
  assert.equal((await off.json()).settings.enabled, false);
  assert.equal(f.state.audits.length, 2);
});

test("enabling requires a saved complete template, real deadline, valid zone and ordered class range", async () => {
  for (const options of [{ dueDate: null }, { dueDate: "2026-02-30" }, { gallerySettings: {} }, { gallerySettings: { visitorEmailTemplate: { ...template, message: "  " } } }]) {
    const f = fixture(options);
    assert.equal((await f.save()).status, 400);
    assert.equal(f.state.writes.length, 0);
  }
  for (const fields of [{ timeZone: "Invalid/Zone" }, { timeZone: "+05:00" }, { photosOnly: false }, { classMode: "range", classFrom: "", classTo: "Grade 12" }, { classMode: "range", classFrom: "Grade 12", classTo: "7A" }]) {
    const f = fixture();
    assert.equal((await f.save({ enabled: true, expectedVersion: initialVersion, ...fields })).status, 400);
    assert.equal(f.state.writes.length, 0);
  }
});

test("an opted-in reminder transparently waits when a later autosaved draft becomes incomplete", async () => {
  const f = fixture({ gallerySettings: { visitorEmailTemplate: { ...template, message: "  " }, visitorDeadlineReminder: { ...defaults, enabled: true } } });
  const response = await f.read();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.settings.enabled, true);
  assert.equal(body.templateReady, false);
  assert.match(body.statusMessage, /waiting for a saved email subject, headline and message/);
  assert.equal(f.state.writes.length, 0);
});

test("a past deadline can stay opted in but reports missed instead of pretending email was sent", async () => {
  const f = fixture({ dueDate: "2020-01-01" });
  const response = await f.save();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.settings.enabled, true);
  assert.equal(body.plannedReminderDate, "2019-12-31");
  assert.equal(body.status.accepted, 0);
  assert.equal(body.status.lastAttemptAt, null);
  assert.match(body.status.message, /has passed/);
});

test("current delivery status is returned with accepted, failed, pending and excluded counts", async () => {
  const status = { deadline: "2026-10-19", accepted: 31, failed: 1, pending: 4, excluded: 2, lastAttemptAt: "2026-10-18T13:00:00Z", completedAt: null, message: "Waiting for provider retry" };
  const f = fixture({ status });
  assert.deepEqual((await (await f.read()).json()).status, status);
  assert.equal(f.state.writes.length, 0);
});

test("a previous deadline's delivery counts never stand in for the current reminder", async () => {
  const oldStatus = { deadline: "2020-01-01", accepted: 40, failed: 0, pending: 0, excluded: 2, lastAttemptAt: "2019-12-31T14:00:00Z", completedAt: "2019-12-31T14:00:05Z", message: "Completed" };
  const scheduled = fixture({ dueDate: "2099-10-19", status: oldStatus, gallerySettings: { visitorEmailTemplate: template, visitorDeadlineReminder: { ...defaults, enabled: true } } });
  const next = await (await scheduled.read()).json();
  assert.equal(next.plannedReminderDate, "2099-10-18");
  assert.equal(next.status, null);
  const missed = fixture({ dueDate: "2020-01-03", status: oldStatus, gallerySettings: { visitorEmailTemplate: template, visitorDeadlineReminder: { ...defaults, enabled: true } } });
  const current = await (await missed.read()).json();
  assert.equal(current.status.deadline, "2020-01-03");
  assert.equal(current.status.accepted, 0);
  assert.equal(current.status.completedAt, null);
  assert.match(current.status.message, /has passed/);
});

test("stale versions, concurrent draft edits and deadline changes cannot silently enable a reminder", async () => {
  const stale = fixture();
  assert.equal((await stale.save({ enabled: true, expectedVersion: "older" })).status, 409);
  assert.equal(stale.state.writes.length, 0);
  for (const race of [row => ({ ...row, updated_at: "2026-10-15T15:01:00Z", gallery_settings: { ...row.gallery_settings, visitorEmailTemplate: { ...template, message: "Newer message" } } }), row => ({ ...row, updated_at: "2026-10-15T15:01:00Z" }), row => ({ ...row, order_due_date: null })]) {
    const f = fixture({ race });
    assert.equal((await f.save()).status, 409);
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.state.audits.length, 0);
  }
});

test("disabling remains possible with missing template, deadline or invalid range", async () => {
  const f = fixture({ dueDate: null, gallerySettings: { visitorDeadlineReminder: { ...defaults, enabled: true, classMode: "range" } } });
  const response = await f.save({ enabled: false, expectedVersion: initialVersion });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).settings.enabled, false);
});

test("owner, MFA and current agreement checks precede reminder mutation and status access", async () => {
  for (const [options, status] of [[{ user: null }, 401], [{ mfaSatisfied: false }, 403], [{ owner: "foreign" }, 404], [{ agreement: { ok: false, status: 403, body: { error: "Agreement required", code: "agreement_required" } } }, 403]]) {
    const f = fixture(options);
    assert.equal((await f.save()).status, status);
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.state.statusReads.length, 0);
    assert.equal(f.state.photoReads.length, 0);
  }
});

test("unavailable delivery status never reports false success and cannot undo a confirmed disable", async () => {
  const f = fixture({ statusFails: true, gallerySettings: { visitorEmailTemplate: template, visitorDeadlineReminder: { ...defaults, enabled: true } } });
  assert.equal((await f.read()).status, 503);
  const response = await f.save({ enabled: false, expectedVersion: initialVersion });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.settings.enabled, false);
  assert.equal(body.status, null);
  assert.match(body.statusMessage, /Delivery status is temporarily unavailable/);
});

test("unknown photo availability is distinct from no eligible classes and never undoes a confirmed disable", async () => {
  const empty = fixture({ photoClasses: [] });
  assert.deepEqual((await (await empty.read()).json()).photoClasses, []);
  const f = fixture({ eligibilityFails: true, gallerySettings: { visitorEmailTemplate: template, visitorDeadlineReminder: { ...defaults, enabled: true } } });
  const unavailable = await (await f.read()).json();
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.photoClasses, null);
  assert.match(unavailable.eligibilityMessage, /could not be confirmed/);
  const response = await f.save({ enabled: false, expectedVersion: initialVersion });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.settings.enabled, false);
  assert.equal(body.photoClasses, null);
  assert.match(body.eligibilityMessage, /could not be confirmed/);
});
