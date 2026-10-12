import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { parentPortalRequest, parentSessionPin } from "../lib/parent-gallery-session-client.ts";

const source = readFileSync(new URL("../components/parents/parent-gallery-client.tsx", import.meta.url), "utf8");
const page = ts.createSourceFile("parent-gallery.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findFunction(name) {
  const matches = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(page);
  assert.equal(matches.length, 1, `Expected one production ${name} function`);
  return matches[0];
}

function declaration(fn, name) {
  const declarations = fn.body.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations]);
  const matches = declarations.filter((entry) => ts.isIdentifier(entry.name) && entry.name.text === name);
  assert.equal(matches.length, 1, `Missing production checkout declaration ${name}`);
  return `const ${matches[0].getText(page)};`;
}

const gallery = findFunction("ParentGalleryPage");
const checkout = findFunction("placeOrderAttempt");
const bodies = [];
function visitCheckout(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch"
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "/api/stripe/checkout") {
    assert.ok(ts.isObjectLiteralExpression(node.arguments[1]));
    const body = node.arguments[1].properties.find((property) => ts.isPropertyAssignment(property)
      && property.name.getText(page) === "body");
    assert.ok(body, "Checkout must serialize its actual production request body");
    bodies.push(body.initializer.getText(page));
  }
  ts.forEachChild(node, visitCheckout);
}
visitCheckout(checkout);
assert.equal(bodies.length, 1, "Expected one actual Stripe checkout request");

// Execute the page's URL reads, project resolution and actual JSON serializer.
// A copied payload formula would miss this school-only omitted-email regression.
const executable = ts.transpileModule([
  ...["pin", "projectId", "eventEmail", "schoolViewerEmail", "mode", "isSchoolMode"]
    .map((name) => declaration(gallery, name)),
  declaration(checkout, "resolvedProjectId"),
  `return ${bodies[0]};`,
].join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const serialize = new Function("params", "searchParams", "createdOrderId", "student", "project", "parentEmail", "checkoutReturnLane", "sessionAccess", "parentSessionPin", executable);
const schoolId = "55555555-5555-4555-8555-555555555555";
const orderId = "11111111-1111-4111-8111-111111111111";

function payload(url, { buyer = "billing@example.test", student = { school_id: schoolId },
  project = null, createdOrderId = orderId, checkoutReturnLane = null, sessionAccess = null } = {}) {
  const location = new URL(url, "https://gallery.example.test");
  return JSON.parse(serialize({ pin: location.pathname.split("/").at(-1) }, location.searchParams,
    createdOrderId, student, project, buyer, checkoutReturnLane, sessionAccess, parentSessionPin));
}

test("school checkout retains its viewer email separately from editable billing email", () => {
  const body = payload(`/parents/SYN-PIN?mode=school&school=${schoolId}&email=viewer%40example.test`, {
    buyer: "  different-buyer@example.test  ",
  });
  assert.deepEqual(body, {
    orderId, pin: "SYN-PIN", schoolId, projectId: null, mode: "school",
    email: "viewer@example.test", customerEmail: "different-buyer@example.test",
  });
});

test("encoded plus-address viewer identity survives URL reads and JSON serialization", () => {
  const viewer = "Family+school.2026@example.test";
  const query = new URLSearchParams({ mode: "school", school: schoolId, email: viewer });
  assert.ok(query.toString().includes("%2B"), "A literal plus must not turn into a URL space");
  const body = payload(`/parents/SYN%2BPIN?${query}`);
  assert.equal(body.pin, "SYN+PIN");
  assert.equal(body.email, viewer);
  assert.equal(body.customerEmail, "billing@example.test");
});

test("school mode default and billing edits cannot drop or replace viewer context", () => {
  const url = `/parents/SYN-PIN?school=${schoolId}&email=viewer%2Bfamily%40example.test`;
  const before = payload(url, { buyer: "first@example.test" });
  const after = payload(url, { buyer: "second@example.test" });
  assert.equal(before.mode, "school");
  assert.equal(after.mode, "school");
  assert.equal(before.email, "viewer+family@example.test");
  assert.equal(after.email, before.email);
  assert.notEqual(before.customerEmail, after.customerEmail);
});

test("event checkout preserves event access context and separate billing email", () => {
  const body = payload("/parents/EVENT-PIN?mode=event&project=event-query&email=event%2Bguest%40example.test", {
    student: null, buyer: "  event-buyer@example.test  ", project: { id: "loaded-event" },
  });
  assert.deepEqual(body, {
    orderId, pin: "EVENT-PIN", schoolId: null, projectId: "loaded-event", mode: "event",
    email: "event+guest@example.test", customerEmail: "event-buyer@example.test",
  });
  assert.equal(payload("/parents/EVENT-PIN?mode=event&project=event-query&email=guest%40example.test", {
    student: null,
  }).projectId, "event-query", "Existing event project fallback remains intact");
});

test("combined primary order identity does not replace the current gallery's access context", () => {
  const primaryFromOtherLane = "44444444-4444-4444-8444-444444444444";
  const body = payload(`/parents/CURRENT-PIN?mode=school&school=${schoolId}&email=current-viewer%40example.test`, {
    createdOrderId: primaryFromOtherLane,
  });
  assert.equal(body.orderId, primaryFromOtherLane);
  assert.equal(body.schoolId, schoolId);
  assert.equal(body.pin, "CURRENT-PIN");
  assert.equal(body.email, "current-viewer@example.test");
});

test("client does not invent viewer access context from billing email when URL email is missing", () => {
  const body = payload(`/parents/SYN-PIN?mode=school&school=${schoolId}`);
  assert.equal(body.email, "");
  assert.equal(body.customerEmail, "billing@example.test");
});

const recoverySource = readFileSync(new URL("../lib/parent-checkout-recovery.ts", import.meta.url), "utf8");
const recoveryExports = {};
new Function("exports", ts.transpileModule(recoverySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(recoveryExports);
const { hasSchoolCheckoutGalleryContext, schoolCheckoutRecoveryUrl } = recoveryExports;
const sessionId = "cs_test_return_context_opaque";
const viewer = "Family+school.2026@example.test";
const complete = { pin: "SYN+PIN", schoolId, email: viewer };
const missing = { ...complete, email: "" };

function returnUrl(context = complete, session = sessionId) {
  return `/parents/${encodeURIComponent(context.pin)}?${new URLSearchParams({
    mode: "school", school: context.schoolId, email: context.email,
    checkout: "success", session_id: session,
  })}`;
}

test("verified same-session recovery repairs missing or mismatched school scope without a redirect loop", () => {
  const target = returnUrl();
  assert.equal(schoolCheckoutRecoveryUrl(target, missing, sessionId), target);
  for (const context of [
    { ...complete, pin: "OTHER-PIN" },
    { ...complete, schoolId: "44444444-4444-4444-8444-444444444444" },
    { ...complete, email: "other@example.test" },
  ]) assert.equal(schoolCheckoutRecoveryUrl(target, context, sessionId), target);
  assert.equal(schoolCheckoutRecoveryUrl(target, complete, sessionId), null);
  assert.equal(schoolCheckoutRecoveryUrl(target, { ...complete, email: viewer.toUpperCase() }, sessionId), null);
  const restored = new URL(target, "https://gallery.example.test");
  assert.equal(decodeURIComponent(restored.pathname.split("/").at(-1)), complete.pin);
  assert.equal(restored.searchParams.get("email"), viewer);
  assert.equal(restored.searchParams.get("session_id"), sessionId);
});

test("recovery rejects external, malformed, duplicate or wrong-session access links", () => {
  const target = returnUrl();
  const invalid = [
    undefined, null, {}, "https://evil.example.test" + target,
    "//evil.example.test" + target, "/\\evil.example.test" + target,
    target + "#fragment", target + "\n", target.replace("/parents/", "/parents/nested/"),
    target.replace("SYN%2BPIN", "SYN%2FPIN"), target.replace("SYN%2BPIN", "SYN%5CPIN"),
    target.replace("SYN%2BPIN", "SYN%0APIN"), target.replace("SYN%2BPIN", "%E0%A4%A"),
    returnUrl(complete, "cs_test_other"), target.replace("mode=school", "mode=event"),
    target.replace("checkout=success", "checkout=cancel"),
    returnUrl({ ...complete, schoolId: "not-a-school" }), returnUrl({ ...complete, email: "invalid" }),
    target + "&email=second%40example.test", target + "&school=" + schoolId,
    target + "&session_id=" + sessionId, target + "&mode=school", target + "&checkout=success",
  ];
  for (const value of invalid) assert.equal(schoolCheckoutRecoveryUrl(value, missing, sessionId), null, String(value));
});

const confirmationExecutable = ts.transpileModule(`let recoveryTimeout = null;\n${findFunction("confirmCheckout").getText(page)}\nreturn confirmCheckout;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const makeConfirmation = new Function("checkoutStatus", "sessionId", "placed", "isSchoolMode", "pin", "schoolId",
  "schoolViewerEmail", "schoolCheckoutContextMissing", "router", "fetch", "setConfirmingPayment", "setOrderError",
  "setOrderId", "setParentEmail", "setPlaced", "setDrawerOpen", "active", "schoolCheckoutRecoveryUrl", "window",
  "AbortController", "sessionAccess", confirmationExecutable);

function confirmationHarness({ context = missing, mode = "school", galleryUrl = returnUrl(), responseOk = true,
  message, fetchImpl, active = true, sessionAccess = null } = {}) {
  const events = [];
  const timers = new Map();
  let nextTimer = 0;
  const state = { confirming: false, error: "", placed: false };
  const window = {
    setTimeout(callback, ms) { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const response = { ok: responseOk, json: async () => ({
    ok: responseOk, message, orderId, customerEmail: "billing@example.test", galleryUrl,
  }) };
  const fetch = async (url, options) => {
    assert.equal(url, "/api/stripe/checkout/confirm");
    assert.deepEqual(JSON.parse(options.body), { sessionId, ...(sessionAccess?.checkoutReturnId ? { returnId: sessionAccess.checkoutReturnId } : {}) });
    assert.ok(options.signal instanceof AbortSignal);
    events.push(["fetch", url]);
    return fetchImpl ? fetchImpl(options) : response;
  };
  const confirm = makeConfirmation("success", sessionId, false, mode === "school", context.pin,
    context.schoolId, context.email, mode === "school" && !hasSchoolCheckoutGalleryContext(context),
    { replace(url) { events.push(["replace", url]); } }, fetch,
    (value) => { state.confirming = value; events.push(["confirming", value]); },
    (value) => { state.error = value; events.push(["error", value]); },
    (value) => events.push(["orderId", value]), (value) => events.push(["parentEmail", value]),
    (value) => { state.placed = value; events.push(["placed", value]); },
    (value) => events.push(["drawer", value]), active, schoolCheckoutRecoveryUrl, window, AbortController, sessionAccess);
  return { confirm, events, timers, state };
}

function actualGalleryContextBody(context, functionName = "load") {
  const matches = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch"
        && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "/api/portal/gallery-context") {
      const body = node.arguments[1].properties.find((property) => ts.isPropertyAssignment(property)
        && property.name.getText(page) === "body");
      const serialized = body.initializer.arguments[0];
      const email = serialized.properties.find((property) => ts.isPropertyAssignment(property)
        && property.name.getText(page) === "email");
      if (email && ts.isIdentifier(email.initializer) && email.initializer.text === "schoolViewerEmail") {
        matches.push(body.initializer.getText(page));
      }
    }
    ts.forEachChild(node, visit);
  }
  // The focus refresh deliberately makes a second request with the same
  // viewer scope. Assert each real flow independently instead of requiring
  // the entire page to contain just one gallery-context request.
  visit(findFunction(functionName));
  assert.equal(matches.length, 1);
  return JSON.parse(new Function("pin", "schoolId", "schoolViewerEmail", `return ${matches[0]};`)(
    context.pin, context.schoolId, context.email));
}

test("production confirmation restores gallery URL before receipt and reloads the exact viewer context", async () => {
  const first = confirmationHarness();
  await first.confirm();
  const navigation = first.events.find(([name]) => name === "replace")?.[1];
  assert.equal(navigation, returnUrl());
  assert.equal(first.state.placed, false, "The incomplete page must not skip recovery by marking the purchase placed");
  assert.equal(first.state.confirming, true, "Loading continues while router replacement is pending");
  assert.deepEqual([...first.timers.values()].map((timer) => timer.ms), [15_000]);
  const returned = new URL(navigation, "https://gallery.example.test");
  const restored = { pin: decodeURIComponent(returned.pathname.split("/").at(-1)),
    schoolId: returned.searchParams.get("school"), email: returned.searchParams.get("email") };
  assert.deepEqual(actualGalleryContextBody(restored), { pin: "SYN+PIN", schoolId, email: viewer });
  const next = confirmationHarness({ context: restored });
  await next.confirm();
  assert.equal(next.events.some(([name]) => name === "replace"), false);
  assert.equal(next.state.placed, true);
  assert.equal(next.state.confirming, false);
  assert.equal(next.timers.size, 0);
  assert.ok(next.events.some(([name, value]) => name === "parentEmail" && value === "billing@example.test"));
});

test("background-controls refresh retains the exact school viewer context restored by checkout", () => {
  assert.deepEqual(actualGalleryContextBody(complete, "refreshOnlineBackdropControls"), {
    pin: complete.pin, schoolId: complete.schoolId, email: complete.email,
  });
});

test("complete school and existing event returns confirm normally without school navigation", async () => {
  for (const options of [{ context: complete }, { mode: "event", context: missing }]) {
    const harness = confirmationHarness(options);
    await harness.confirm();
    assert.equal(harness.events.some(([name]) => name === "replace"), false);
    assert.equal(harness.state.placed, true);
    assert.equal(harness.state.confirming, false);
    assert.equal(harness.state.error, "");
    assert.equal(harness.timers.size, 0);
  }
});

test("missing school scope fails visibly when recovery is absent, invalid or payment confirmation fails", async () => {
  for (const options of [
    { galleryUrl: null }, { galleryUrl: "https://evil.example.test" + returnUrl() },
    { galleryUrl: returnUrl(complete, "cs_test_wrong") },
    { responseOk: false, message: "Payment is still processing." },
  ]) {
    const harness = confirmationHarness(options);
    await harness.confirm();
    assert.equal(harness.events.some(([name]) => name === "replace"), false);
    assert.equal(harness.state.placed, false);
    assert.equal(harness.state.confirming, false);
    assert.match(harness.state.error, options.responseOk === false ? /Payment is still processing/ : /return link could not be verified/);
    assert.equal(harness.timers.size, 0);
  }
});

test("stalled URL replacement leaves loading with a meaningful recovery failure", async () => {
  const harness = confirmationHarness();
  await harness.confirm();
  const timeout = [...harness.timers.values()].find((timer) => timer.ms === 15_000);
  assert.ok(timeout);
  timeout.callback();
  assert.equal(harness.state.confirming, false);
  assert.equal(harness.state.placed, false);
  assert.match(harness.state.error, /payment was confirmed.*gallery access could not be restored/);
});

test("stalled confirmation is aborted and reports a finite failure rather than an endless loading page", async () => {
  const harness = confirmationHarness({ fetchImpl: ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }) });
  const pending = harness.confirm();
  const timeout = [...harness.timers.values()].find((timer) => timer.ms === 60_000);
  assert.ok(timeout);
  timeout.callback();
  await pending;
  assert.equal(harness.state.confirming, false);
  assert.equal(harness.state.placed, false);
  assert.match(harness.state.error, /confirmation took too long/);
  assert.equal(harness.timers.size, 0);
});

test("a superseded confirmation cannot navigate or place a purchase after its page scope has changed", async () => {
  const harness = confirmationHarness({ active: false });
  await harness.confirm();
  assert.equal(harness.events.some(([name]) => name === "replace" || name === "placed" || name === "orderId"), false);
  assert.equal(harness.timers.size, 0);
});

test("production loading guard suppresses missing-context errors only while successful checkout recovery is pending", () => {
  const loadingGuard = new Function("loading", "confirmingPayment", "checkoutStatus", "schoolCheckoutContextMissing",
    `${declaration(gallery, "galleryLoading")}\nreturn galleryLoading;`);
  assert.equal(loadingGuard(false, true, "success", true), true);
  assert.equal(loadingGuard(false, false, "success", true), false, "Failure exits the recovery spinner");
  assert.equal(loadingGuard(false, true, "cancel", true), false);
  assert.equal(loadingGuard(false, true, "success", false), false, "Complete school/event context keeps existing render ordering");
  assert.equal(loadingGuard(true, false, null, false), true);
});


const opaqueLane = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const opaqueReturn = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
test("actual school checkout serialization plus session transport removes viewer credentials while preserving edited receipt email", () => {
  const access = { laneId: opaqueLane, kind: "school", galleryId: schoolId, viewerEmail: "viewer@example.test" };
  const body = payload(`/parents/view/${opaqueLane}`, { sessionAccess: access, buyer: "edited-buyer@example.test" });
  const transported = parentPortalRequest("/api/stripe/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, opaqueLane);
  const sent = JSON.parse(transported.init.body);
  assert.equal(sent.parentLaneId, opaqueLane); assert.equal(sent.schoolId, schoolId);
  assert.equal(sent.customerEmail, "edited-buyer@example.test");
  assert.equal(Object.hasOwn(sent, "pin"), false); assert.equal(Object.hasOwn(sent, "email"), false);
  assert.equal(new Headers(transported.init.headers).get("x-studio-parent-session"), "1");
});
test("actual opaque checkout confirmation stays on its private lane and never reconstructs a credential URL", async () => {
  const access = { laneId: opaqueLane, kind: "school", galleryId: schoolId, viewerEmail: viewer,
    checkoutReturnId: opaqueReturn, checkoutSessionId: sessionId, checkoutStatus: "success" };
  const harness = confirmationHarness({ context: { pin: parentSessionPin(opaqueLane), schoolId, email: viewer }, sessionAccess: access });
  await harness.confirm();
  assert.equal(harness.state.placed, true); assert.equal(harness.state.confirming, false);
  assert.equal(harness.events.some(([name]) => name === "replace"), false);
  assert.equal(harness.timers.size, 0);
  const request = parentPortalRequest("/api/stripe/checkout/confirm", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, returnId: access.checkoutReturnId }) }, opaqueLane);
  assert.deepEqual(JSON.parse(request.init.body), { sessionId, returnId: opaqueReturn, parentLaneId: opaqueLane });
});
