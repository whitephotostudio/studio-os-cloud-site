import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function policy({ platform = "ios", native = true } = {}) {
  const exports = {};
  vm.runInNewContext(compile(read("lib/native-companion.ts")), {
    exports, URL,
    require: name => {
      assert.equal(name, "@capacitor/core");
      return { Capacitor: { getPlatform: () => platform, isNativePlatform: () => native } };
    },
  });
  return exports;
}

test("companion purchase restrictions apply only to the native iOS app", () => {
  assert.equal(policy().isNativeCompanion(), true);
  for (const options of [{ platform: "web", native: false }, { platform: "ios", native: false }, { platform: "android", native: true }]) {
    const api = policy(options);
    assert.equal(api.isNativeCompanion(), false);
    for (const action of ["subscribe", "update_plan", "update_extra_keys", "buy_credits", "portal"]) assert.equal(api.nativeBillingActionBlocked(action), false);
  }
  const api = policy();
  for (const action of ["subscribe", "update_plan", "update_extra_keys", "buy_credits", "portal"]) assert.equal(api.nativeBillingActionBlocked(action), true);
  for (const action of ["connect", "merchant_connect", "checkout", "pay_order", "send_invoice", null, {}, 1]) assert.equal(api.nativeBillingActionBlocked(action), false);
});

test("web navigation guard agrees with shared native fixtures for Studio OS destinations", () => {
  const cases = JSON.parse(read("mobile/ios/Tests/native-companion-routes.json"));
  const api = policy();
  let checked = 0;
  for (const row of cases) {
    const host = new URL(row.destination).hostname;
    if (host !== "studiooscloud.com" && !host.endsWith(".studiooscloud.com")) continue;
    assert.equal(api.isPlatformPurchaseRoute(row.destination), row.blocked, row.destination);
    checked += 1;
  }
  assert.ok(checked >= 35, "shared fixture must cover both prohibited purchase and allowed workflow routes");
});

test("encoded paths, path descendants and billing query spellings cannot expose platform purchases", () => {
  const api = policy();
  for (const href of [
    "/pricing/details", "/credits/checkout", "/dashboard/membership/history",
    "/%2570ricing", "/%252570ricing", "/m/%2e%2e/pricing", "/m%2f..%2fcredits",
    "https://app.studiooscloud.com/PRICING/", "/m?BILLING=SUBSCRIPTION_SUCCESS",
    "/m?billing=ignored&billing=credits_success", "/m?billing=PORTAL",
  ]) assert.equal(api.isPlatformPurchaseRoute(href), true, href);
  for (const href of [
    "/dashboard/settings?stripe=returned", "/m/orders?billing=merchant_connect_success",
    "/api/stripe/connect", "/api/stripe/checkout", "/m/invoices/invoice-a",
    "https://connect.stripe.com/setup/s/merchant", "https://invoice.stripe.com/i/customer",
    "https://www.studiooscloud.com.evil.example/pricing",
  ]) assert.equal(api.isPlatformPurchaseRoute(href), false, href);
});

function guardHarness({ platform = "ios", native = true, href = "https://www.studiooscloud.com/m" } = {}) {
  const api = policy({ platform, native }), exports = {}, effects = [], replaced = [], classes = new Set(), listeners = new Map();
  const anchors = ["/pricing", "/m/capture", "/api/stripe/connect"].map(url => ({ href: new URL(url, href).href, dataset: {} }));
  let mutation, disconnected = false;
  class MutationObserver {
    constructor(callback) { mutation = callback; }
    observe(_target, options) { assert.equal(options.childList, true); assert.equal(options.subtree, true); }
    disconnect() { disconnected = true; }
  }
  class Element {
    constructor(anchor = null) { this.anchor = anchor; }
    closest(selector) { assert.equal(selector, "a[href]"); return this.anchor; }
  }
  const document = {
    body: {},
    documentElement: { classList: { add: value => classes.add(value) } },
    querySelectorAll(selector) { assert.equal(selector, "a[href]"); return anchors; },
    addEventListener(type, listener, capture) { assert.equal(capture, true); listeners.set(type, listener); },
    removeEventListener(type, listener, capture) { assert.equal(capture, true); if (listeners.get(type) === listener) listeners.delete(type); },
  };
  vm.runInNewContext(compile(read("components/native-companion-guard.tsx")), {
    exports, Element, MutationObserver, document, window: { location: { href } },
    require: name => {
      if (name === "react") return { useEffect: callback => effects.push(callback) };
      if (name === "next/navigation") return { usePathname: () => new URL(href).pathname, useRouter: () => ({ replace: url => replaced.push(url) }) };
      if (name === "@/lib/native-companion") return api;
      throw new Error(`Unexpected guard import ${name}`);
    },
  });
  exports.NativeCompanionGuard();
  const cleanups = effects.map(callback => callback());
  return { classes, replaced, listeners, anchors, get disconnected() { return disconnected; },
    insertLink(url) { const anchor = { href: new URL(url, href).href, dataset: {} }; anchors.push(anchor); mutation?.(); return anchor; },
    cleanup: () => cleanups.forEach(callback => callback?.()), click(url, nested = true) {
    const event = { target: nested ? new Element({ href: new URL(url, href).href }) : {}, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    listeners.get("click")?.(event); return event;
  } };
}

test("native guard redirects prohibited pages, intercepts nested purchase-link clicks and cleans up", () => {
  const guard = guardHarness({ href: "https://www.studiooscloud.com/dashboard/membership" });
  assert.equal(guard.classes.has("studio-os-native"), true);
  assert.deepEqual(guard.replaced, ["/m"]);
  assert.equal(guard.anchors[0].dataset.nativePurchase, "platform");
  assert.equal(guard.anchors[1].dataset.nativePurchase, undefined);
  assert.equal(guard.anchors[2].dataset.nativePurchase, undefined);
  assert.equal(guard.insertLink("/credits").dataset.nativePurchase, "platform");
  assert.equal(guard.insertLink("/m/orders/order-a").dataset.nativePurchase, undefined);
  const blocked = guard.click("/pricing");
  assert.equal(blocked.prevented, true); assert.equal(blocked.stopped, true);
  for (const url of ["/m/capture", "/api/stripe/connect", "/m/orders/order-a", "/m/invoices/invoice-a"]) {
    assert.equal(guard.click(url).prevented, false, url);
  }
  assert.equal(guard.click("/pricing", false).prevented, false);
  guard.cleanup(); assert.equal(guard.listeners.size, 0); assert.equal(guard.disconnected, true);
});

test("web guard leaves navigation, marketing styles and click handlers untouched", () => {
  const guard = guardHarness({ platform: "web", native: false, href: "https://www.studiooscloud.com/pricing" });
  assert.equal(guard.classes.size, 0); assert.equal(guard.replaced.length, 0); assert.equal(guard.listeners.size, 0);
  assert.equal(guard.click("/credits").prevented, false);
});

function handler(file, name, globals) {
  const source = read(file), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      found = `const ${name} = ${node.initializer.arguments[0].getText(ast)};`;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found, `actual ${name} handler exists`);
  const exports = {};
  vm.runInNewContext(compile(`${found}\nexports.run = ${name};`), { exports, URL, console, ...globals });
  return exports.run;
}

function actionHarness(native) {
  const calls = { auth: 0, fetch: [], busy: [], errors: [], clients: 0 };
  const supabase = { auth: { getSession: async () => { calls.auth += 1; return { data: { session: { access_token: "synthetic-session" } } }; } } };
  const globals = {
    nativeBillingActionBlocked: policy({ platform: native ? "ios" : "web", native }).nativeBillingActionBlocked,
    setError: value => calls.errors.push(value), setNotice: () => {},
    setBillingBusyAction: value => calls.busy.push(value), setBusy: value => calls.busy.push(value), setCancelLoading: value => calls.busy.push(value), setConnecting: value => calls.busy.push(value),
    getAuthorizedHeaders: async () => { calls.auth += 1; return { Authorization: "Bearer synthetic-session" }; },
    createClient: () => { calls.clients += 1; return supabase; }, supabase,
    submitting: { current: false }, signInUrl: "/sign-in", loadStatus: async () => {},
    window: { location: { href: "https://www.studiooscloud.com/m" } }, alert: message => calls.errors.push(message),
    fetch: async (url, options) => {
      calls.fetch.push({ url, payload: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true, url: url === "/api/stripe/connect" ? "https://connect.stripe.com/setup/s/synthetic" : "https://checkout.stripe.com/c/pay/synthetic" }) };
    },
    accessToken: null, businessName: "Synthetic Studio", studioName: "Synthetic Studio", brandColor: "#cc0000", logoUrl: "", billingEmail: "", studioEmail: "", businessCountry: "CA", billingCurrency: "cad", salesCurrencyConfigured: true,
  };
  return { calls, globals };
}

test("settings purchase handler rejects native actions before authentication, network or billing state changes", async () => {
  const h = actionHarness(true);
  const run = handler("app/dashboard/settings/page.tsx", "runBillingAction", h.globals);
  for (const action of ["subscribe", "update_plan", "update_extra_keys", "buy_credits", "portal"]) await run("test", { action }, "unused");
  assert.equal(h.calls.auth, 0); assert.equal(h.calls.fetch.length, 0); assert.equal(h.calls.busy.length, 0);
  assert.equal(h.calls.errors.length, 5);
});

test("credit and membership portal handlers return before requesting a native purchase", async () => {
  const h = actionHarness(true);
  await handler("app/credits/page.tsx", "buyCredits", h.globals)({ code: "synthetic" });
  await handler("app/dashboard/membership/page.tsx", "handleCancelMembership", h.globals)();
  assert.equal(h.calls.fetch.length, 0); assert.equal(h.calls.auth, 0); assert.equal(h.calls.clients, 0); assert.equal(h.calls.busy.length, 0);
  assert.equal(h.globals.submitting.current, false);
});

test("ordinary web purchase handlers retain their existing authenticated request behavior", async () => {
  for (const [file, name, args, expectedAction] of [
    ["app/dashboard/settings/page.tsx", "runBillingAction", ["plan", { action: "subscribe" }, "unused"], "subscribe"],
    ["app/credits/page.tsx", "buyCredits", [{ code: "synthetic" }], "buy_credits"],
    ["app/dashboard/membership/page.tsx", "handleCancelMembership", [], "portal"],
  ]) {
    const h = actionHarness(false);
    await handler(file, name, h.globals)(...args);
    assert.equal(h.calls.fetch.length, 1, name);
    assert.equal(h.calls.fetch[0].url, "/api/stripe/billing", name);
    assert.equal(h.calls.fetch[0].payload.action, expectedAction, name);
    assert.equal(h.calls.auth, 1, name);
  }
});

test("native merchant Connect still creates its merchant onboarding request", async () => {
  const h = actionHarness(true);
  await handler("app/dashboard/settings/page.tsx", "connectStripe", h.globals)();
  assert.equal(h.calls.auth, 1); assert.equal(h.calls.fetch.length, 1);
  assert.equal(h.calls.fetch[0].url, "/api/stripe/connect");
  assert.equal(h.globals.window.location.href, "https://connect.stripe.com/setup/s/synthetic");
});

test("settings hides every platform purchase button while merchant Connect controls remain visible", () => {
  const file = "app/dashboard/settings/page.tsx", source = read(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let platformControls = 0, merchantControls = 0;
  function marked(node) {
    for (let current = node; current; current = current.parent) {
      const opening = ts.isJsxElement(current) ? current.openingElement : ts.isJsxSelfClosingElement(current) ? current : null;
      if (opening?.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && ["data-native-purchase", "data-native-hide"].includes(attribute.name.getText(ast)))) return true;
    }
    return false;
  }
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "button") {
      const onClick = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "onClick");
      const expression = onClick?.initializer?.getText(ast) ?? "";
      if (/\b(handlePlanSave|handleOpenPortal|handleBuyCredits)\b/.test(expression)) {
        platformControls += 1;
        assert.equal(marked(node.parent), true, expression);
      }
      if (/\bconnectStripe\b/.test(expression)) {
        merchantControls += 1;
        assert.equal(marked(node.parent), false, "merchant onboarding must remain available");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(platformControls >= 4); assert.ok(merchantControls >= 2);
  const css = read("app/globals.css");
  assert.match(css, /\.studio-os-native\s+\[data-native-purchase\][^{]*\{\s*display:\s*none\s*!important\s*;/);
  assert.match(css, /\.native-companion-only\s*\{\s*display:\s*none\s*;/);
  assert.match(css, /\.studio-os-native\s+\.native-companion-only\s*\{\s*display:\s*block\s*;/);
});

test("real desktop entitlement upsell messages are contained by the hidden desktop-app-access panel", () => {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(compile(read(file)), { exports, Date, process: { env: {} }, require: name => {
      if (name === "@/lib/dashboard-auth") return { createDashboardServiceClient: () => { throw new Error("No database needed for entitlement checks"); } };
      assert.ok(["@/lib/subscription-access", "@/lib/studio-pricing", "@/lib/trial-config"].includes(name), name);
      return load(`${name.slice(2)}.ts`);
    } });
    return exports;
  }
  const app = load("lib/studio-os-app.ts");
  for (const plan of ["starter", "core"]) {
    const entitlement = app.resolveStudioAppEntitlement({ subscription_plan_code: plan, subscription_status: "active", is_platform_admin: false, extra_desktop_keys: 0 }, { release_state: "public", mac_download_url: "https://downloads.invalid/app.dmg", windows_download_url: null });
    assert.match(entitlement.message, /Upgrade to/, `real ${plan} backend message includes the upsell`);
  }
  const file = "app/dashboard/settings/page.tsx", source = read(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let checked = 0;
  function visit(node) {
    if (ts.isJsxExpression(node) && node.expression?.getText(ast) === "studioApp.entitlement.message") {
      let hidden = false;
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (!ts.isJsxElement(parent)) continue;
        hidden ||= parent.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "data-native-purchase" && attribute.initializer?.text === "desktop-app-access");
      }
      assert.equal(hidden, true, "the reachable entitlement message must be hidden with the whole desktop app panel");
      checked += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(checked, 1);
});

function trackerHarness(native) {
  const effects = [], exports = {}, listeners = new Map(), storage = new Map();
  const calls = { storageReads: 0, storageWrites: 0, beacons: [], fetches: [], gtag: [], va: [], uuids: 0 };
  class Element {
    constructor(target = null) { this.target = target; }
    closest(selector) { assert.equal(selector, "[data-marketing-event]"); return this.target ?? this; }
  }
  class HTMLAnchorElement extends Element {
    href = "https://www.studiooscloud.com/sign-up";
    dataset = { marketingEvent: "synthetic_cta", marketingLabel: "Synthetic CTA", marketingPlacement: "test" };
  }
  const window = {
    location: { pathname: "/pricing" },
    localStorage: {
      getItem(key) { calls.storageReads += 1; return storage.get(key) ?? null; },
      setItem(key, value) { calls.storageWrites += 1; storage.set(key, value); },
    },
    gtag: (...args) => calls.gtag.push(args), va: (...args) => calls.va.push(args),
  };
  const document = { referrer: "https://referrer.invalid/", addEventListener(type, callback, options) {
    assert.equal(options.capture, true); listeners.set(type, callback);
  }, removeEventListener(type, callback, options) {
    assert.equal(options.capture, true); if (listeners.get(type) === callback) listeners.delete(type);
  } };
  vm.runInNewContext(compile(read("components/marketing/MarketingEventTracker.tsx")), {
    exports, window, document, Element, HTMLAnchorElement, Blob,
    crypto: { randomUUID: () => { calls.uuids += 1; return "synthetic-visitor-id"; } },
    navigator: { sendBeacon: (url, blob) => { calls.beacons.push({ url, blob }); return true; } },
    fetch: (...args) => { calls.fetches.push(args); return Promise.resolve({ ok: true }); },
    require: name => {
      if (name === "react") return { useEffect: callback => effects.push(callback) };
      if (name === "next/navigation") return { usePathname: () => window.location.pathname };
      if (name === "@/lib/native-companion") return policy({ platform: native ? "ios" : "web", native });
      throw new Error(`Unexpected tracker dependency ${name}`);
    },
  });
  exports.MarketingEventTracker();
  const cleanups = effects.map(callback => callback());
  return { calls, listeners, storage, window,
    click: () => listeners.get("click")?.({ target: new Element(new HTMLAnchorElement()) }),
    cleanup: () => cleanups.forEach(callback => callback?.()),
  };
}

test("native marketing tracker creates no anonymous visitor ID, events or tracking listeners", () => {
  const h = trackerHarness(true);
  h.click(); h.cleanup();
  assert.equal(h.calls.storageReads, 0); assert.equal(h.calls.storageWrites, 0); assert.equal(h.calls.uuids, 0);
  assert.equal(h.storage.size, 0); assert.equal(h.listeners.size, 0);
  assert.equal(h.calls.beacons.length, 0); assert.equal(h.calls.fetches.length, 0);
  assert.equal(h.calls.gtag.length, 0); assert.equal(h.calls.va.length, 0); assert.equal(h.window.dataLayer, undefined);
});

test("web marketing tracker still records a page view and CTA conversion with a reused anonymous ID", async () => {
  const h = trackerHarness(false);
  assert.equal(h.listeners.size, 1); h.click();
  assert.equal(h.calls.storageWrites, 1); assert.equal(h.calls.uuids, 1);
  const payloads = await Promise.all(h.calls.beacons.map(async ({ url, blob }) => ({ url, body: JSON.parse(await blob.text()) })));
  assert.deepEqual(payloads.map(row => row.url), ["/api/marketing/activity", "/api/marketing/conversions"]);
  assert.equal(payloads[0].body.type, "page_view"); assert.equal(payloads[1].body.event, "synthetic_cta");
  assert.ok(payloads.every(row => row.body.anonymousId === "synthetic-visitor-id"));
  assert.equal(h.calls.gtag.length, 1); assert.equal(h.calls.va.length, 1); assert.equal(h.window.dataLayer.length, 1);
  h.cleanup(); assert.equal(h.listeners.size, 0);
});
