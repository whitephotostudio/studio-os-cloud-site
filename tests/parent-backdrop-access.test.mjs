import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const helperSource = readFileSync(new URL("../lib/parent-backdrop-access.ts", import.meta.url), "utf8");
const gallery = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helpers = {};
new Function("exports", compile(helperSource))(helpers);
const currencyHelpers = {};
new Function("exports", compile(readFileSync(new URL("../lib/order-currency.ts", import.meta.url), "utf8")))(currencyHelpers);
const { canOfferParentBackdrops, usableParentCutouts, parentBackdropSelectionIssue, PARENT_BACKDROP_UNAVAILABLE } = helpers;
const url = (name, signature = "one") => `https://account.r2.cloudflarestorage.com/bucket/schools/school-a/student-a/${name}.jpg?sig=${signature}`;
const portraits = ["one", "two"].map((name) => ({ id: name, references: [url(name), `schools/school-a/student-a/${name}.jpg`] }));
const entry = { hasBackdrop: true, category: "print", slots: [{ assignedImageUrl: url("one") }], portraits, cutoutUrls: { one: "/paid-one.png" } };

test("background chooser requires a usable current cutout, school mode and a non-composite photo", () => {
  const eligible = { schoolMode: true, composite: false, catalogCount: 1, cutoutUrl: "/paid.png" };
  assert.equal(canOfferParentBackdrops(eligible), true);
  for (const change of [{ cutoutUrl: null }, { cutoutUrl: " " }, { schoolMode: false }, { composite: true }, { catalogCount: 0 }]) {
    assert.equal(canOfferParentBackdrops({ ...eligible, ...change }), false);
  }
});

test("only server-authorized, loadable cutouts in the current gallery become usable", async () => {
  const probes = [];
  const usable = await usableParentCutouts({ one: "/verified.png", two: "/expired.png", foreign: "/foreign.png", empty: " " }, ["one", "two", "empty"], async (candidate) => {
    probes.push(candidate);
    return candidate === "/verified.png";
  });
  assert.deepEqual(usable, { one: "/verified.png" });
  assert.deepEqual(probes.sort(), ["/expired.png", "/verified.png"]);
  assert.deepEqual(await usableParentCutouts({}, ["one"], async () => assert.fail("No filename/public-bucket discovery")), {});
  assert.deepEqual(await usableParentCutouts({ one: "/unavailable.png" }, ["one"], async () => { throw Error("offline"); }), {});
});

test("one unavailable physical pose blocks the entire backdrop item without changing saved selections", () => {
  const saved = { ...entry, slots: [{ assignedImageUrl: url("one") }, { assignedImageUrl: url("two") }] };
  const before = JSON.stringify(saved);
  assert.equal(parentBackdropSelectionIssue(saved), PARENT_BACKDROP_UNAVAILABLE);
  assert.equal(JSON.stringify(saved), before);
  assert.equal(parentBackdropSelectionIssue({ ...saved, cutoutUrls: { one: "/one.png", two: "/two.png" } }), "");
  assert.equal(parentBackdropSelectionIssue({ ...entry, slots: [] }), PARENT_BACKDROP_UNAVAILABLE);
  assert.equal(parentBackdropSelectionIssue({ ...entry, slots: [{ assignedImageUrl: null }] }), PARENT_BACKDROP_UNAVAILABLE);
});

test("persisted/reordered photos match refreshed signatures and exact storage references, never sibling basenames", () => {
  assert.equal(parentBackdropSelectionIssue({ ...entry, slots: [{ assignedImageUrl: url("one", "old") }] }), "");
  assert.equal(parentBackdropSelectionIssue({ ...entry, slots: [{ assignedImageUrl: "/api/r2/img/schools/school-a/student-a/one.jpg" }] }), "");
  assert.equal(parentBackdropSelectionIssue({ ...entry, slots: [{ assignedImageUrl: "https://example.supabase.co/storage/v1/object/public/thumbs/schools/school-a/student-a/one.jpg" }] }), "");
  assert.equal(parentBackdropSelectionIssue({ ...entry, slots: [{ assignedImageUrl: url("one").replace("student-a", "student-b") }] }), PARENT_BACKDROP_UNAVAILABLE);
  assert.equal(parentBackdropSelectionIssue({ ...entry, portraits: [...portraits, { id: "duplicate", references: [url("one")] }] }), PARENT_BACKDROP_UNAVAILABLE);
});

test("normal digital selections and all-digitals backgrounds require every included photo", () => {
  const digital = { ...entry, category: "digital", selectedImageUrl: url("one") };
  assert.equal(parentBackdropSelectionIssue(digital), "");
  assert.equal(parentBackdropSelectionIssue({ ...digital, digitalSelections: [{ url: url("one") }, { url: url("two") }] }), PARENT_BACKDROP_UNAVAILABLE);
  assert.equal(parentBackdropSelectionIssue({ ...digital, allDigitals: true }), PARENT_BACKDROP_UNAVAILABLE);
  assert.equal(parentBackdropSelectionIssue({ ...digital, allDigitals: true, cutoutUrls: { one: "/one.png", two: "/two.png" } }), "");
  assert.equal(parentBackdropSelectionIssue({ ...entry, hasBackdrop: false, cutoutUrls: {} }), "", "original-photo products stay eligible");
});

function extract(startText, endText) {
  const start = gallery.indexOf(startText);
  const end = gallery.indexOf(endText, start);
  assert.ok(start >= 0 && end > start);
  return gallery.slice(start, end);
}

test("actual picker, confirmation and premium handlers cannot select backgrounds without current readiness", () => {
  const handlers = [
    ["function handleBackdropClick", "function handleConfirmBackdrop", "handleBackdropClick"],
    ["function handleConfirmBackdrop", "function handleConfirmBlurBackground", "handleConfirmBackdrop"],
    ["function handleUnlockPremium", "function openBackdropPicker", "handleUnlockPremium"],
    ["function openBackdropPicker()", "const checkoutSubmitBusy", "openBackdropPicker"],
  ];
  for (const [start, end, name] of handlers) {
    const source = compile(extract(start, end) + `\nreturn ${name};`);
    const handler = new Function("hasBackdrops", source)(false);
    assert.doesNotThrow(() => handler({ id: "premium", tier: "premium" }), name);
    // No other state/setter was supplied: a mistaken dispatch would throw.
  }
});

test("the actual eligible picker and confirmation retain the chosen background", () => {
  const selected = { id: "background", tier: "free", supports_landscape: false };
  const calls = [];
  const click = new Function("hasBackdrops", "selectedOrientation", "setSelectedBackdrop", "setOrientationNotice",
    compile(extract("function handleBackdropClick", "function handleConfirmBackdrop") + "\nreturn handleBackdropClick;"))(
    true, "portrait", (value) => calls.push(value), () => {},
  );
  click(selected);
  assert.equal(calls[0], selected);
  const values = { hasBackdrops: true, selectedBackdrop: selected, selectedBlurBackground: false,
    selectedBlurAmount: 12, selectedOrientation: "portrait",
    setConfirmedBackdrop: (value) => calls.push(value), setConfirmedBlurBackground: () => {}, setConfirmedBlurAmount: () => {},
    setSelectedOrientation: () => {}, setConfirmedOrientation: () => {}, setBackdropPickerOpen: () => {}, setOrientationNotice: () => {} };
  const confirm = new Function(...Object.keys(values), compile(extract("function handleConfirmBackdrop", "function handleConfirmBlurBackground") + "\nreturn handleConfirmBackdrop;"))(...Object.values(values));
  confirm();
  assert.equal(calls[1], selected);
});

test("clicking a ready grid photo uses that photo's readiness, not the previous selection", () => {
  const focused = [], opened = [];
  const values = { canOfferParentBackdrops, isSchoolMode: true, backdrops: [{ id: "background" }],
    isCompositeGalleryImage: (image) => image.source === "composite", nobgUrls: { ready: "/paid.png" },
    focusImageForActions: (image) => focused.push(image.id), showBackdropPickerForReadyPhoto: () => opened.push(true) };
  const click = new Function(...Object.keys(values), compile(extract("function openBackdropPickerForImage", "function openEventPhotoGrid") + "\nreturn openBackdropPickerForImage;"))(...Object.values(values));
  click({ id: "unknown" });
  click({ id: "ready", source: "composite" });
  assert.equal(opened.length, 0);
  click({ id: "ready", source: "photo" });
  assert.deepEqual(focused, ["ready"]);
  assert.equal(opened.length, 1);
});

function checkoutFixture(options = {}) {
  const laneA = { laneKey: "school-a:student-a", schoolId: "school-a", studentId: "student-a", pin: "pin-a", email: "parent@example.com" };
  const laneB = { laneKey: "school-b:student-b", schoolId: "school-b", studentId: "student-b", pin: "pin-b", email: "parent@example.com" };
  const cart = options.items ?? [{ id: "saved", packageId: "print", packageName: "Print", category: "print", backdrop: { id: "background" }, slots: entry.slots, laneKey: laneA.laneKey }];
  const requests = [];
  const defaultContext = (lane) => ({ ok: true, photographerId: "studio", orderCurrency: "cad", activeSchool: { id: lane.schoolId }, primaryStudent: { id: lane.studentId },
    media: [{ id: "one", storage_path: "schools/school-a/student-a/one.jpg", download_url: url("one", "fresh") }],
    nobgUrls: { one: "/verified.png" }, backdrops: [{ id: "background" }], packages: [] });
  const values = {
    checkoutItems: cart, combineLanes: [laneA, laneB], currentLane: laneA, isSchoolMode: true,
    photographerId: "studio", parentEmail: "parent@example.com", PARENT_BACKDROP_UNAVAILABLE,
    orderCurrency: "cad", resolvePhotographerOrderCurrency: currencyHelpers.resolvePhotographerOrderCurrency,
    usableParentCutouts, imageUrlExists: async () => options.canLoad !== false,
    packages: [{ id: "retouch", name: "Retouching" }],
    retouchPolicyEntry: (item) => ({ pkg: { name: item.packageName } }),
    isRetouchPackage: (pkg) => /retouch/i.test(pkg.name),
    backdropIssueForItem: (item, freshPortraits, cutoutUrls) => parentBackdropSelectionIssue({ ...item, hasBackdrop: !!item.backdrop, portraits: freshPortraits, cutoutUrls }),
    fetch: async (endpoint, request) => {
      assert.equal(endpoint, "/api/portal/gallery-context", "verification never creates or charges an order");
      assert.equal(request.cache, "no-store");
      const body = JSON.parse(request.body); requests.push(body);
      const lane = body.schoolId === laneB.schoolId ? laneB : laneA;
      return { ok: options.responseOk !== false, json: async () => ({ ...defaultContext(lane), ...(options.context ?? {}), ...(body.schoolId === laneB.schoolId ? options.secondContext : {}) }) };
    },
  };
  const methodSource = compile(extract("async function verifyBackdropCheckout", "async function handlePlaceOrder") + "\nreturn verifyBackdropCheckout;");
  const verify = new Function(...Object.keys(values), methodSource)(...Object.values(values));
  return { verify, cart, requests, laneA, laneB };
}

test("saved background checkout refreshes current proof and preserves the cart when proof or image is unavailable", async () => {
  for (const options of [{ context: { nobgUrls: {} } }, { canLoad: false }, { responseOk: false }, { context: { photographerId: "other-studio" } }, { context: { primaryStudent: { id: "other-child" } } }]) {
    const fixture = checkoutFixture(options);
    const before = JSON.stringify(fixture.cart);
    assert.equal(await fixture.verify(), PARENT_BACKDROP_UNAVAILABLE);
    assert.equal(JSON.stringify(fixture.cart), before);
    assert.equal(fixture.requests.length, 1);
  }
  assert.equal(await checkoutFixture().verify(), "");
});

test("combined saved backgrounds verify each lane; readiness from one child cannot authorize another", async () => {
  const fixture = checkoutFixture();
  const items = [fixture.cart[0], { ...fixture.cart[0], id: "sibling", laneKey: fixture.laneB.laneKey }];
  const denied = checkoutFixture({ items, secondContext: { nobgUrls: {} } });
  assert.equal(await denied.verify(), PARENT_BACKDROP_UNAVAILABLE);
  assert.deepEqual(denied.requests.map((body) => body.pin), ["pin-a", "pin-b"]);
  assert.equal(items[1].backdrop.id, "background");
  const valid = checkoutFixture({ items });
  assert.equal(await valid.verify(), "");
  assert.equal(valid.requests.length, 2);
});

test("saved background checkout rejects a changed or unsupported studio currency before order creation", async () => {
  for (const orderCurrency of ["eur", "jpy"]) {
    const fixture = checkoutFixture({ context: { orderCurrency } });
    const before = JSON.stringify(fixture.cart);
    assert.equal(await fixture.verify(), PARENT_BACKDROP_UNAVAILABLE);
    assert.equal(JSON.stringify(fixture.cart), before);
  }
});

test("original and retouch-only checkout does not require unrelated background proof or make extra requests", async () => {
  const original = checkoutFixture({ items: [{ category: "print", backdrop: null }, { packageId: "retouch", packageName: "Retouching", category: "specialty", backdrop: { id: "old-irrelevant" } }] });
  assert.equal(await original.verify(), "");
  assert.equal(original.requests.length, 0);
});

test("a persisted retouching label without an authoritative service package cannot skip background verification", async () => {
  const fixture = checkoutFixture();
  const denied = checkoutFixture({ items: [{ ...fixture.cart[0], packageName: "Retouching", packageId: "unknown" }], context: { nobgUrls: {} } });
  assert.equal(await denied.verify(), PARENT_BACKDROP_UNAVAILABLE);
  assert.equal(denied.requests.length, 1);
});

test("the actual submit handler stops an unavailable saved background before order creation or payment", async () => {
  const parsed = ts.createSourceFile("gallery.tsx", gallery, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "placeOrderAttempt") declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(declaration);
  const saved = [{ backdrop: { id: "background" }, category: "print" }];
  const messages = [];
  const values = { orderingDisabled: false, isSchoolMode: true, student: { id: "child" }, checkoutItems: saved,
    checkoutBackdropIssue: PARENT_BACKDROP_UNAVAILABLE, setOrderError: (message) => messages.push(message) };
  const submit = new Function(...Object.keys(values), compile(declaration.getText(parsed) + "\nreturn placeOrderAttempt;"))(...Object.values(values));
  await submit({ preventDefault() {} });
  assert.deepEqual(messages, [PARENT_BACKDROP_UNAVAILABLE]);
  assert.equal(saved[0].backdrop.id, "background");
  // No fetch/payment globals exist; proceeding to an order would fail this test.
});

test("parent gallery no longer discovers paid access from public bucket filenames or session caches", () => {
  assert.doesNotMatch(gallery, /nobgPublicUrl|nobgPathsForImage|from\(NOBG_BUCKET\)|markNobgReady/);
  assert.doesNotMatch(gallery, /contextPayload\s*=\s*parsed/);
  assert.match(gallery, /const backdropIssue = await verifyBackdropCheckout\(\)/);
  assert.match(gallery, /checkoutBackdropIssue/);
});
