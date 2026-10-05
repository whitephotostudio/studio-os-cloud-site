import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props) => typeof type === "function" ? type(props) : ({ type, props });
const runtime = { jsx, jsxs: jsx, Fragment: "fragment" };
const plain = value => JSON.parse(JSON.stringify(value));
function execute(source, globals = {}) {
  const context = { exports: {}, crypto: { randomUUID }, require: name => {
    assert.equal(name, "react/jsx-runtime");
    return runtime;
  }, ...globals };
  vm.runInNewContext(compile(source), context);
  return context;
}
const settings = execute(read("lib/event-gallery-settings.ts")).exports;
const presentation = execute(read("lib/event-gallery-presentation.ts")).exports;
const dates = execute(read("lib/calendar-dates.ts")).exports;
const page = ts.createSourceFile("page.tsx", read("app/dashboard/projects/[id]/settings/page.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(page));
  ts.forEachChild(node, collect);
}
collect(page);
function findOne(predicate) {
  const matches = [];
  function visit(node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); }
  visit(page);
  assert.equal(matches.length, 1);
  return matches[0].getText(page);
}
function nodes(node, type) {
  if (!node || typeof node !== "object") return [];
  return [...(node.type === type ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child, type))];
}
function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  return [node.props?.children].flat(Infinity).map(textOf).join(" ");
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

function harness({ projects = {}, cache = new Map(), getProject, getPreview, getSession, previewResponses = {}, saveStatus = 200 } = {}) {
  const requests = [], previewRequests = [], alerts = [];
  const previewTimers = new Map();
  let nextPreviewTimer = 0;
  const context = {
    exports: {}, ...settings, ...dates, loadRequestRef: { current: 0 },
    projectId: "event-a", storageKey: "studioos_project_settings_event-a", persistedGallerySettings: settings.normalizeEventGallerySettings(null),
    resolvePackageProfileId: ({ selectedProfileId }) => selectedProfileId || "",
    createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "fixture" } } }) } }),
    AbortController,
    window: {
      localStorage: { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) }, location: {},
      setTimeout(callback, delay) { const id = ++nextPreviewTimer; previewTimers.set(id, { callback, delay }); return id; },
      clearTimeout(id) { previewTimers.delete(id); },
    },
    setTimeout: () => 1, alert: message => alerts.push(message),
    supabase: { auth: { getSession: async () => getSession ? getSession() : ({ data: { session: { access_token: "fixture" } } }) }, from(table) {
      let id;
      return {
        select() { return this; }, eq(_, value) { id = value; return this; },
        order() { return Promise.resolve({ data: [] }); },
        async maybeSingle() {
          if (table === "photographers") return { data: { business_name: "Fixture Studio", logo_url: "/studio.svg" } };
          assert.equal(table, "projects");
          return { data: await (getProject ? getProject(id) : projects[id] ?? null) };
        },
      };
    } },
    async fetch(url, options) {
      if (options.method === "GET") {
        previewRequests.push({ url, options });
        const id = decodeURIComponent(url.split("/").at(-1).split("?")[0]);
        const result = await (getPreview ? getPreview(id) : previewResponses[id] ?? { ok: true, media: [] });
        return { status: result.status ?? 200, ok: (result.status ?? 200) === 200, json: async () => result };
      }
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      return { status: saveStatus, ok: saveStatus === 200, json: async () => saveStatus === 200
        ? { ok: true, project: { ...context.project, ...body, updated_at: "2026-10-04T23:00:00Z" } }
        : { ok: false, message: "Project changed elsewhere. Reload settings before saving again." } };
    },
  };
  for (const name of ["Loading", "Project", "ProjectName", "PortalStatus", "ShootDate", "OrderDueDate", "ExpirationDate", "PackageProfileId", "EmailRequired", "CheckoutContactRequired", "InternalNotes", "ProjectAccessMode", "ProjectPin", "ProtectDesktop", "ProtectMobile", "ProtectWatermark", "GalleryLanguage", "Extras", "Branding", "LinkedContacts", "Share", "PackageProfiles", "PersistedGallerySettings", "StudioBrand", "PreviewImageUrl", "Saving", "SaveNotice"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = value => { context[key] = typeof value === "function" ? value(context[key]) : value; };
  }
  const source = ["loadProjectPreviewImage", "loadAll", "saveAll", "setExtra", "setBrandingField"].map(name => functions.get(name)).join("\n");
  vm.runInNewContext(compile(`${source}\nexports.handlers = { loadAll, saveAll, setExtra, setBrandingField };`), context);
  return { context, requests, previewRequests, alerts, cache, ...context.exports.handlers,
    selectProject(id) { context.projectId = id; context.storageKey = `studioos_project_settings_${id}`; },
    expirePreviewDeadline() {
      for (const [id, timer] of previewTimers) {
        assert.equal(timer.delay, 8000);
        previewTimers.delete(id);
        timer.callback();
      }
    },
    get pendingPreviewTimers() { return previewTimers.size; },
  };
}
const fixtureSettings = () => settings.normalizeEventGallerySettings({
  galleryLanguage: "French", extras: { hideAlbumPhotoCount: false, allowCropping: true, allowClientToPayLater: true, emailCaptureMode: "required" },
  branding: { introHeadline: "Saved welcome", introLayout: "split", introCtaLabel: "Enter Gallery" },
  schedule: { startTime: "09:00", endTime: "12:00", location: "Fixture location", address: "Fixture address", notes: "Private schedule note" },
  desktopClientEmail: "owner-client@example.test",
  desktopClientContact: { name: "Fixture client", email: "owner-client@example.test", phone: "555-0100", address: "Fixture client address" },
});

test("opening an unconfigured project resets previous project settings to normalized defaults", async () => {
  const ui = harness({ projects: {
    "event-a": { id: "event-a", title: "A", gallery_settings: fixtureSettings() },
    "event-b": { id: "event-b", title: "B", gallery_settings: null },
  } });
  await ui.loadAll();
  assert.equal(ui.context.branding.introHeadline, "Saved welcome");
  ui.selectProject("event-b"); await ui.loadAll();
  const defaults = settings.normalizeEventGallerySettings(null);
  assert.equal(ui.context.project.id, "event-b");
  assert.deepEqual(plain(ui.context.branding), plain(defaults.branding));
  assert.deepEqual(plain(ui.context.extras), plain(defaults.extras));
  assert.equal(ui.context.galleryLanguage, defaults.galleryLanguage);
  assert.equal(ui.context.persistedGallerySettings.desktopClientEmail, "");
  assert.equal(ui.context.persistedGallerySettings.desktopClientContact, undefined);
});

test("DB settings win over a local fallback; an empty project can restore its own legacy fallback", async () => {
  const cache = new Map([
    ["studioos_project_settings_event-a", JSON.stringify({ branding: { introHeadline: "Old browser data" } })],
    ["studioos_project_settings_event-b", JSON.stringify({ hideAlbumPhotoCount: false, galleryLanguage: "English (CA)" })],
  ]);
  const ui = harness({ cache, projects: {
    "event-a": { id: "event-a", title: "A", gallery_settings: fixtureSettings() },
    "event-b": { id: "event-b", title: "B", gallery_settings: {} },
  } });
  await ui.loadAll(); assert.equal(ui.context.branding.introHeadline, "Saved welcome");
  ui.selectProject("event-b"); await ui.loadAll();
  assert.equal(ui.context.branding.introHeadline, "");
  assert.equal(ui.context.galleryLanguage, "English (CA)");
  assert.equal(ui.context.extras.hideAlbumPhotoCount, false);
});

test("a superseded project load cannot overwrite the newly selected project", async () => {
  const pendingA = deferred(), pendingB = deferred();
  const ui = harness({ getProject: id => id === "event-a" ? pendingA.promise : pendingB.promise });
  const first = ui.loadAll(); ui.selectProject("event-b"); const second = ui.loadAll();
  pendingB.resolve({ id: "event-b", title: "B", gallery_settings: { branding: { introHeadline: "B welcome" } } });
  await second;
  pendingA.resolve({ id: "event-a", title: "A", gallery_settings: fixtureSettings() });
  await first;
  assert.equal(ui.context.project.id, "event-b");
  assert.equal(ui.context.branding.introHeadline, "B welcome");
  assert.equal(ui.context.loading, false);
});

test("saving edited gallery choices preserves private contact and schedule data", async () => {
  const existing = fixtureSettings();
  const ui = harness({ projects: { "event-a": { id: "event-a", title: "A", gallery_settings: existing, updated_at: "2026-10-04T22:00:00Z" } } });
  await ui.loadAll();
  ui.setBrandingField("introHeadline", "Updated welcome");
  ui.setExtra("hideAlbumPhotoCount", true);
  await ui.saveAll();
  const submitted = ui.requests[0].body.gallery_settings;
  assert.equal(submitted.branding.introHeadline, "Updated welcome");
  assert.equal(submitted.extras.hideAlbumPhotoCount, true);
  assert.deepEqual(submitted.schedule, plain(existing.schedule));
  assert.deepEqual(submitted.desktopClientContact, plain(existing.desktopClientContact));
  assert.equal(submitted.desktopClientEmail, existing.desktopClientEmail);
  assert.equal(submitted.extras.allowCropping, true);
  assert.equal(submitted.extras.allowClientToPayLater, true);
  assert.equal(submitted.extras.emailCaptureMode, "required");
  assert.equal(ui.requests[0].body.expected_updated_at, "2026-10-04T22:00:00Z");
  assert.equal(ui.context.project.updated_at, "2026-10-04T23:00:00Z");
  assert.deepEqual(plain(ui.context.persistedGallerySettings), submitted);
  assert.deepEqual(JSON.parse(ui.cache.get(ui.context.storageKey)), submitted);
  assert.match(ui.context.saveNotice, /Saved.*Reload the client gallery/);
});

test("event date loads consistently and edited or cleared dates update both date fields", async () => {
  const ui = harness({ projects: { "event-a": { id: "event-a", title: "A", gallery_settings: {}, event_date: "2026-10-04", shoot_date: "2026-10-01" } } });
  await ui.loadAll(); assert.equal(ui.context.shootDate, "2026-10-04");
  for (const date of ["2026-10-12", ""]) {
    ui.context.shootDate = date; await ui.saveAll();
    const submitted = ui.requests.at(-1).body;
    assert.equal(submitted.event_date, date || null);
    assert.equal(submitted.shoot_date, date || null);
  }
});

test("a loaded project with no timestamp still sends an explicit save-version guard", async () => {
  const ui = harness({ projects: { "event-a": { id: "event-a", title: "A", gallery_settings: fixtureSettings(), updated_at: null } } });
  await ui.loadAll(); await ui.saveAll();
  assert.ok(Object.hasOwn(ui.requests[0].body, "expected_updated_at"));
  assert.equal(ui.requests[0].body.expected_updated_at, null);
});

test("a stale save conflict reports failure and preserves edits without updating browser cache", async () => {
  const ui = harness({ saveStatus: 409, projects: { "event-a": { id: "event-a", title: "A", gallery_settings: fixtureSettings(), updated_at: "old-version" } } });
  await ui.loadAll(); ui.setBrandingField("introHeadline", "Unsaved edit"); await ui.saveAll();
  assert.equal(ui.context.project.updated_at, "old-version");
  assert.equal(ui.context.branding.introHeadline, "Unsaved edit");
  assert.equal(ui.context.saveNotice, null);
  assert.equal(ui.cache.size, 0);
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0], /409.*Reload settings/);
  assert.equal(ui.context.saving, false);
});

function preview(branding, coverImageUrl = "/cover.jpg") {
  const context = execute(`${functions.get("galleryFontFamily")}\n${functions.get("BrandPreview")}\nexports.render = BrandPreview;`, {
    ...presentation, ...settings, EventGalleryCover: props => ({ type: "EventGalleryCover", props }),
  });
  return context.exports.render({ branding, projectName: "Fixture gallery", project: { cover_photo_url: "/cover.jpg", client_name: "Fixture Client" }, studioBrand: { businessName: "Fixture Studio", logoUrl: "/studio.svg" }, coverImageUrl });
}

test("owner preview passes saved presentation choices to the shared client welcome renderer", () => {
  const branding = { ...settings.defaultEventGalleryBranding, introLayout: "split", themePreset: "editorial", tone: "graphite", backgroundMode: "light", accentColor: "champagne", fontPreset: "spectral", introHeadline: "Custom welcome", introCtaLabel: "Enter Gallery" };
  const cover = nodes(preview(branding), "EventGalleryCover")[0];
  assert.equal(cover.props.preview, true);
  assert.equal(cover.props.layout, "split");
  assert.equal(cover.props.themePreset, "editorial");
  assert.deepEqual(plain(cover.props.tone), plain(presentation.galleryPresentationTone(branding)));
  assert.equal(cover.props.accentColor, presentation.galleryPresentationAccent(branding).solid);
  assert.match(cover.props.fontFamily, /Cambria/);
  assert.equal(cover.props.buttonLabel, "View albums");
  assert.equal(cover.props.title, "Custom welcome");
  assert.equal(cover.props.clientName, "Fixture Client");
  assert.equal(cover.props.imageUrl, "/cover.jpg");
  assert.equal(cover.props.brandName, "Fixture Studio");
  assert.equal(cover.props.brandLogoUrl, "/studio.svg");
  assert.equal(nodes(preview({ ...branding, introCtaLabel: "See our albums", useCoverAsIntro: false }), "EventGalleryCover")[0].props.buttonLabel, "See our albums");
  assert.equal(nodes(preview({ ...branding, useCoverAsIntro: false }), "EventGalleryCover")[0].props.imageUrl, null);
  const disabled = preview({ ...branding, introEnabled: false });
  assert.equal(nodes(disabled, "EventGalleryCover").length, 0);
  assert.match(textOf(disabled), /welcome screen is off/);
});

test("a project without a cover previews the first owner-authorized photo without writing a cover", async () => {
  const ui = harness({
    projects: { "event-a": { id: "event-a", title: "A", cover_photo_url: null } },
    previewResponses: { "event-a": { ok: true, media: [{ preview_url: "https://signed.example.test/first-preview.jpg", thumbnail_url: "https://signed.example.test/first-thumb.jpg" }] } },
  });
  await ui.loadAll();
  assert.equal(ui.previewRequests.length, 1);
  assert.equal(ui.previewRequests[0].url, "/api/dashboard/events/event-a?mediaLimit=1");
  assert.equal(ui.previewRequests[0].options.cache, "no-store");
  assert.equal(ui.previewRequests[0].options.headers.Authorization, "Bearer fixture");
  assert.equal(ui.context.previewImageUrl, "https://signed.example.test/first-preview.jpg");
  assert.equal(nodes(preview(ui.context.branding, ui.context.previewImageUrl), "EventGalleryCover")[0].props.imageUrl, ui.context.previewImageUrl);
  assert.equal(ui.context.project.cover_photo_url, null);
  assert.equal(ui.requests.length, 0);

  const thumbnail = harness({ projects: { "event-a": { id: "event-a" } }, previewResponses: { "event-a": { ok: true, media: [{ preview_url: "", thumbnail_url: "/signed-thumb.jpg" }] } } });
  await thumbnail.loadAll();
  assert.equal(thumbnail.context.previewImageUrl, "/signed-thumb.jpg");
});

test("stored cover keys use the owner resolver while an existing HTTPS cover takes precedence without another media read", async () => {
  const ui = harness({
    projects: {
      "event-a": { id: "event-a", cover_photo_url: "event-a/cover.jpg" },
      "event-b": { id: "event-b", cover_photo_url: "https://signed.example.test/saved-cover.jpg" },
    },
    previewResponses: { "event-a": { ok: true, project: { cover_photo_url: "https://signed.example.test/resolved-cover.jpg" }, media: [{ preview_url: "/first.jpg" }] } },
  });
  await ui.loadAll();
  assert.equal(ui.context.previewImageUrl, "https://signed.example.test/resolved-cover.jpg");
  ui.selectProject("event-b"); await ui.loadAll();
  assert.equal(ui.context.previewImageUrl, "https://signed.example.test/saved-cover.jpg");
  assert.equal(ui.previewRequests.length, 1);
});

test("late photo responses cannot replace another project's preview and denied previews fail closed", async () => {
  const oldPhoto = deferred(), started = deferred();
  const ui = harness({
    projects: { "event-a": { id: "event-a" }, "event-b": { id: "event-b" }, "event-c": { id: "event-c" } },
    getPreview(id) {
      if (id === "event-a") { started.resolve(); return oldPhoto.promise; }
      if (id === "event-c") return { status: 403, ok: false, media: [{ preview_url: "/denied.jpg" }] };
      return { ok: true, media: [{ preview_url: "/current.jpg" }] };
    },
  });
  const pending = ui.loadAll(); await started.promise;
  ui.selectProject("event-b"); await ui.loadAll();
  oldPhoto.resolve({ ok: true, media: [{ preview_url: "/old.jpg" }] }); await pending;
  assert.equal(ui.context.project.id, "event-b");
  assert.equal(ui.context.previewImageUrl, "/current.jpg");
  ui.selectProject("event-c"); await ui.loadAll();
  assert.equal(ui.context.previewImageUrl, null);
  assert.equal(ui.context.loading, false);
  assert.equal(ui.requests.length, 0);
});

test("welcome preview hides the stock message and keeps a custom message exactly as the client renderer does", () => {
  const branding = { ...settings.defaultEventGalleryBranding, introMessage: `  ${settings.defaultEventGalleryBranding.introMessage}  ` };
  const defaultCover = nodes(preview(branding), "EventGalleryCover")[0];
  assert.equal(defaultCover.props.message, "");
  assert.deepEqual(plain(defaultCover.props.metadata), []);
  assert.equal(nodes(preview({ ...branding, introMessage: "  Welcome to your event  " }), "EventGalleryCover")[0].props.message, "Welcome to your event");
});

test("a stalled optional owner preview aborts at its deadline and cannot keep settings loading or restore a late image", async () => {
  const started = deferred(), photo = deferred();
  const ui = harness({
    projects: { "event-a": { id: "event-a", title: "Saved project", gallery_settings: fixtureSettings() } },
    getPreview() { started.resolve(); return photo.promise; },
  });
  const pending = ui.loadAll();
  await started.promise;
  ui.expirePreviewDeadline();
  const finished = await Promise.race([pending.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 50))]);
  assert.equal(finished, true, "Optional preview lookup must not block settings after its bounded deadline");
  assert.equal(ui.context.loading, false);
  assert.equal(ui.context.branding.introHeadline, "Saved welcome");
  assert.equal(ui.context.previewImageUrl, null);
  assert.equal(ui.previewRequests[0].options.signal.aborted, true);
  assert.equal(ui.pendingPreviewTimers, 0);
  photo.resolve({ ok: true, media: [{ preview_url: "/late.jpg" }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.context.previewImageUrl, null);
  assert.equal(ui.requests.length, 0);
});

test("a preview deadline bounds stalled auth and never starts a late media request", async () => {
  const authStarted = deferred(), auth = deferred();
  const ui = harness({
    projects: { "event-a": { id: "event-a" } },
    getSession() { authStarted.resolve(); return auth.promise; },
  });
  const pending = ui.loadAll();
  await authStarted.promise;
  ui.expirePreviewDeadline();
  const finished = await Promise.race([pending.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 50))]);
  assert.equal(finished, true, "Optional auth lookup must fit the same preview deadline");
  assert.equal(ui.context.loading, false);
  assert.equal(ui.context.previewImageUrl, null);
  auth.resolve({ data: { session: { access_token: "fixture" } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.previewRequests.length, 0);
  assert.equal(ui.requests.length, 0);
});

test("unavailable toggles remain disabled and never change persisted preferences", () => {
  const saved = { allowCropping: true, allowClientToPayLater: true, liveGalleryMode: true, instantPhotoDelivery: true, orderNotificationHooks: true };
  const context = execute(["cx", "Toggle", "ToggleRow", "setExtra"].map(name => functions.get(name)).join("\n"), { extras: { ...saved } });
  context.setExtras = next => { context.extras = typeof next === "function" ? next(context.extras) : next; };
  for (const title of ["Allow Cropping", "Allow Client to Pay Later", "Live Event Mode", "Instant Upload Feed", "Order Notification Hooks"]) {
    const expression = findOne(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(page) === "ToggleRow"
      && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(page) === "title" && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === title));
    vm.runInNewContext(`(function () { ${compile(`exports.tree = (${expression});`)} })();`, context);
    const button = nodes(context.exports.tree, "button")[0];
    assert.equal(button.props.disabled, true);
    assert.equal(button.props["aria-checked"], true);
    assert.equal(button.props["aria-label"], title);
    button.props.onClick();
  }
  assert.deepEqual(context.extras, saved);
});

test("unavailable capture and guest options display saved values without permitting edits", () => {
  const extras = { emailCaptureMode: "required", guestIdentificationMode: "qr" };
  for (const key of Object.keys(extras)) {
    const expression = findOne(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(page) === "select"
      && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(page) === "value"
        && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.getText(page) === `extras.${key}`));
    const select = execute(`exports.tree = (${expression});`, { extras, ChevronDown: "icon" }).exports.tree;
    assert.equal(select.props.disabled, true);
    assert.equal(select.props.value, extras[key]);
    assert.equal(select.props.onChange, undefined);
  }
});

test("legacy welcome button labels display the current default while custom text remains editable", () => {
  const expression = findOne(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(page) === "input"
    && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(page) === "value"
      && ts.isJsxExpression(attribute.initializer) && attribute.initializer.getText(page).includes("branding.introCtaLabel")));
  for (const label of ["Enter Gallery", "", "Browse my albums"]) {
    const branding = { introCtaLabel: label };
    const input = execute(`exports.tree = (${expression});`, { branding, setBrandingField: (key, value) => { branding[key] = value; } }).exports.tree;
    assert.equal(input.props.value, label === "Enter Gallery" ? "" : label);
    assert.equal(input.props.placeholder, "View albums");
    assert.equal(branding.introCtaLabel, label);
    input.props.onChange({ target: { value: "Choose an album" } });
    assert.equal(branding.introCtaLabel, "Choose an album");
  }
});
