import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../supabase/functions/notify-abandoned-cart/index.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = {};
let registeredHandler;
const runtimeCalls = [];
new Function("exports", "Deno", "fetch", compiled)(api, { serve: handler => { registeredHandler = handler; } }, async (url, options) => {
  runtimeCalls.push([url, options]);
  return Response.json({ ok: true, sent: 0, skipped: 0, failed: 0 });
});
const orderId = "11111111-1111-4111-8111-111111111111";
function request(body, auth = "Bearer fixture-caller-jwt") {
  return new Request("https://fixture.supabase.co/functions/v1/notify-abandoned-cart", {
    method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}

test("Deno handler ignores server connection info rather than treating it as a fetch dependency", async () => {
  const response = await registeredHandler(request({ orderIds: [orderId] }), { remoteAddr: { hostname: "fixture" } });
  assert.equal(response.status, 200);
  assert.equal(runtimeCalls.length, 1);
});

test("desktop bridge preserves caller auth and forwards only IDs to the shared policy", async () => {
  const calls = [];
  const response = await api.handleAbandonedCartBridge(request({ orderIds: [orderId], force: true, cooldownDays: 0, endpoint: "https://attacker.example" }), async (url, options) => {
    calls.push([url, options]);
    return Response.json({ ok: true, sent: 0, skipped: 1, failed: 0 }, { status: 200 });
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0][0], "https://www.studiooscloud.com/api/dashboard/orders/abandoned-cart-reminders");
  assert.equal(calls[0][1].headers.Authorization, "Bearer fixture-caller-jwt");
  assert.deepEqual(JSON.parse(calls[0][1].body), { orderIds: [orderId] });
  assert.equal(calls[0][1].redirect, "error");
  assert.doesNotMatch(source, /RESEND_API_KEY|SUPABASE_SERVICE_ROLE_KEY|api\.resend\.com/);
});

test("bridge blocks malformed requests without contacting email/backend and propagates authorization errors", async () => {
  const never = async () => assert.fail("Unexpected backend call");
  assert.equal((await api.handleAbandonedCartBridge(new Request("https://fixture.example", { method: "OPTIONS" }), never)).status, 200);
  assert.equal((await api.handleAbandonedCartBridge(new Request("https://fixture.example"), never)).status, 405);
  assert.equal((await api.handleAbandonedCartBridge(request({ orderIds: [orderId] }, ""), never)).status, 401);
  assert.equal((await api.handleAbandonedCartBridge(request({ orderIds: [] }), never)).status, 400);
  assert.equal((await api.handleAbandonedCartBridge(request({ orderIds: ["wrong"] }), never)).status, 400);
  assert.equal((await api.handleAbandonedCartBridge(request({ orderIds: [orderId] }), async () => Response.json({ error: "Order ownership denied." }, { status: 403 }))).status, 403);
  assert.equal((await api.handleAbandonedCartBridge(request({ orderIds: [orderId] }), async () => { throw Error("network failure"); })).status, 503);
});
