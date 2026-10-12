import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as links from "../lib/abandoned-cart-reminder-links.ts";

const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const source = compile("app/api/portal/orders/stop-reminders/route.ts");
const input = { orderId: "11111111-1111-4111-8111-111111111111", photographerId: "22222222-2222-4222-8222-222222222222", recipientEmail: "parent@example.com" };

function harness({ email = input.recipientEmail, exists = true, status = "payment_pending", rpcError = null, stopped = true } = {}) {
  const calls = [];
  const db = {
    from(table) {
      calls.push(["from", table]);
      const builder = {
        select() { return builder; }, eq(field, value) { calls.push(["eq", field, value]); return builder; },
        async maybeSingle() { return { data: exists ? { id: input.orderId, photographer_id: input.photographerId, customer_email: email, status } : null, error: null }; },
      };
      return builder;
    },
    async rpc(name, args) { calls.push(["rpc", name, args]); return { data: stopped, error: rpcError }; },
  };
  const deps = {
    "next/server": require("next/server"),
    "@/lib/dashboard-auth": { createDashboardServiceClient: () => db },
    "@/lib/abandoned-cart-reminder-links": links,
    "@/lib/rate-limit": { getClientIp: () => "fixture", rateLimit: async () => ({ allowed: true }) },
  };
  const api = {};
  new Function("require", "exports", source)(name => { assert.ok(deps[name], name); return deps[name]; }, api);
  return { api, calls };
}

function request(token, body, origin = "https://www.studiooscloud.com") {
  const url = `https://www.studiooscloud.com/api/portal/orders/stop-reminders?token=${encodeURIComponent(token)}`;
  const req = new Request(url, body ? { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) } : {});
  req.nextUrl = new URL(url);
  return req;
}

test("scanners and malformed links cannot stop reminders; confirmed POST verifies exact owner/email", async () => {
  const previous = process.env.CART_REMINDER_TOKEN_SECRET;
  process.env.CART_REMINDER_TOKEN_SECRET = "signed-stop-route-fixture-secret-long-enough";
  try {
    const token = new URL(links.createAbandonedCartStopUrl(input)).searchParams.get("token");
    const { api, calls } = harness();
    const get = await api.GET(request(token));
    assert.match(await get.text(), /Stop checkout reminders/);
    assert.equal(get.headers.get("referrer-policy"), "no-referrer");
    assert.deepEqual(calls, [], "GET must not read or write customer records");
    assert.equal((await api.POST(request(token, { token, confirmed: false }))).status, 400);
    assert.equal((await api.POST(request(token, { token, confirmed: true }, "https://attacker.example"))).status, 403);
    assert.deepEqual(calls, []);
    const response = await api.POST(request(token, { token, confirmed: true }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.ok(calls.some(call => call[0] === "eq" && call[1] === "photographer_id" && call[2] === input.photographerId));
    assert.deepEqual(calls.find(call => call[0] === "rpc"), ["rpc", "stop_abandoned_cart_reminders", { p_order_id: input.orderId, p_recipient_email: input.recipientEmail }]);
  } finally {
    if (previous === undefined) delete process.env.CART_REMINDER_TOKEN_SECRET;
    else process.env.CART_REMINDER_TOKEN_SECRET = previous;
  }
});

test("recipient changes, missing records and unavailable storage cannot produce false confirmation", async () => {
  const previous = process.env.CART_REMINDER_TOKEN_SECRET;
  process.env.CART_REMINDER_TOKEN_SECRET = "signed-stop-route-fixture-secret-long-enough";
  try {
    const token = new URL(links.createAbandonedCartStopUrl(input)).searchParams.get("token");
    for (const options of [{ email: "changed@example.com" }, { exists: false }]) {
      const { api, calls } = harness(options);
      assert.equal((await api.POST(request(token, { token, confirmed: true }))).status, 400);
      assert.equal(calls.some(call => call[0] === "rpc"), false);
    }
    const unavailable = harness({ rpcError: { message: "private database detail" } });
    const response = await unavailable.api.POST(request(token, { token, confirmed: true }));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private database/);
    const changed = harness({ stopped: false });
    assert.equal((await changed.api.POST(request(token, { token, confirmed: true }))).status, 409);
    const paid = harness({ stopped: false, status: "paid" });
    assert.equal((await paid.api.POST(request(token, { token, confirmed: true }))).status, 409);
  } finally {
    if (previous === undefined) delete process.env.CART_REMINDER_TOKEN_SECRET;
    else process.env.CART_REMINDER_TOKEN_SECRET = previous;
  }
});

test("both reminder templates contain a safe stop link while ordinary gallery emails do not", () => {
  const api = {};
  const deps = {
    "@/lib/event-gallery-settings": { defaultEventGalleryShareSettings: { emailSubject: "Gallery ready", emailHeadline: "Your gallery", emailButtonLabel: "Open gallery", emailMessage: "Your photos are ready." } },
    "@/lib/private-media-references": { signedPrivateMediaReference: () => null },
  };
  new Function("require", "exports", compile("lib/event-gallery-email.ts"))(name => deps[name], api);
  const stopRemindersUrl = "https://www.studiooscloud.com/api/portal/orders/stop-reminders?token=fixture";
  const input = { project: { id: "gallery", title: "Event" }, school: { id: "school", school_name: "School" }, origin: "https://www.studiooscloud.com", orderTotalLabel: "CAD 55.75", stopRemindersUrl };
  for (const email of [api.buildAbandonedCartEmail(input), api.buildSchoolAbandonedCartEmail(input)]) {
    assert.match(email.html, /Stop reminders/);
    assert.match(email.text, /Stop reminders: https:\/\/www\.studiooscloud\.com/);
    assert.match(email.text, /Completed orders stay available/);
    assert.match(email.html, /Continue checkout/);
  }
  assert.doesNotMatch(api.buildGalleryShareEmail(input).html, /Stop reminders/);
  assert.doesNotMatch(api.buildAbandonedCartEmail({ ...input, stopRemindersUrl: "javascript:alert(1)" }).html, /javascript:|Stop reminders/);
});
