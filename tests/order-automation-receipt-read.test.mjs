import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

function load(path, modules) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`);
    return modules[name];
  }, exports);
  return exports;
}
const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";
const cloudOrder = "33333333-3333-4333-8333-333333333333";
const batchId = "a".repeat(64);
const zipSha256 = "b".repeat(64);
class ProductionAuthError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
function record(state = "prepared") {
  return { etag: "verified-etag", value: {
    owner, fingerprint: "c".repeat(64), zipSha256,
    zipKey: `order-automation/${owner}/zips/${batchId}-${zipSha256}.zip`,
    token: "d".repeat(64), expiresAt: Date.now() + 60000,
    orders: [{ localId: "local-order", cloudId: cloudOrder, snapshot: "e".repeat(64) }],
    financialRevision: "f".repeat(64), state,
    ...(state !== "prepared" ? { firstAttempt: Date.now() } : {}),
    ...(state === "sent" ? { receiptId: "provider-receipt", sentAt: "2026-10-04T20:00:00.000Z" } : {}),
    text: "Frozen lab delivery", labEmail: "lab@example.com", labName: "Lab",
    replyTo: "owner@example.com", date: "2026-10-04",
  } };
}
function harness({ stored = null, authError, storageError } = {}) {
  const reads = [];
  const forbidden = () => { throw new Error("Receipt GET must never write, upload or email"); };
  const route = load("app/api/order-automation/batch/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "node:crypto": crypto, zod: { z },
    "@/lib/order-automation-auth": {
      ProductionAuthError,
      productionAuth: async () => { if (authError) throw authError; return { id: owner }; },
      currentProductionOrders: forbidden, productionFinancialRevision: forbidden,
    },
    "@/lib/order-automation-storage": {
      productionKey: (id, suffix) => `order-automation/${id}/${suffix}`,
      readProductionJson: async (key) => { reads.push(key); if (storageError) throw storageError; return stored; },
      readProduction: forbidden, writeProduction: forbidden, writeProductionJson: forbidden, digest: forbidden,
    },
    "@/lib/order-automation-quality": { labEmailText: forbidden },
    "@/lib/order-automation-zip": { verifyNoritsuZip: forbidden },
    "@/lib/resend": { resendConfigured: forbidden, sendResendEmail: forbidden },
  });
  return { reads, get: (id = batchId) => route.GET({ nextUrl: new URL(`https://studio-os.test/api/order-automation/batch?batch=${id}`) }) };
}

test("only verified missing storage produces the explicit not-found contract", async () => {
  const h = harness();
  const response = await h.get();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, reason: "delivery_record_not_found", batchId, message: "No delivery record yet." });
  assert.deepEqual(h.reads, [`order-automation/${owner}/batches/${batchId}.json`]);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("auth, MFA and quota failures retain their status and never look absent", async () => {
  for (const status of [401, 403, 429]) {
    const h = harness({ authError: new ProductionAuthError("Access unavailable", status) });
    const response = await h.get();
    assert.equal(response.status, status);
    assert.equal((await response.json()).reason, undefined);
    assert.deepEqual(h.reads, []);
  }
});

test("invalid batch references fail before storage reads", async () => {
  const h = harness();
  assert.equal((await h.get("not-a-batch")).status, 400);
  assert.deepEqual(h.reads, []);
});

test("storage/auth outages fail closed and cannot authorize a resend", async () => {
  for (const error of [new Error("Timeout"), new SyntaxError("Corrupt JSON"),
    Object.assign(new Error("Access denied"), { $metadata: { httpStatusCode: 403 } })]) {
    const response = await harness({ storageError: error }).get();
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.reason, "delivery_receipt_unavailable");
    assert.equal(body.batchId, undefined);
  }
});

test("verified prepared/sending/sent receipts preserve their exact state", async () => {
  for (const state of ["prepared", "sending", "sent"]) {
    const response = await harness({ stored: record(state) }).get();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.batchId, batchId);
    assert.equal(body.state, state);
    assert.equal(body.receiptId, state === "sent" ? "provider-receipt" : undefined);
  }
});

test("malformed, cross-owner and contradictory stored receipts remain unavailable", async () => {
  const mutations = [
    (r) => { r.value = {}; },
    (r) => { r.value = null; },
    (r) => { r.etag = ""; },
    (r) => { r.value.owner = otherOwner; },
    (r) => { r.value.zipKey = `order-automation/${otherOwner}/zips/other.zip`; },
    (r) => { r.value.state = "unknown"; },
    (r) => { r.value.state = "sent"; },
    (r) => { r.value.state = "sending"; },
    (r) => { r.value.firstAttempt = Date.now(); },
    (r) => { r.value.receiptId = "unconfirmed"; },
    (r) => { r.value.orders.push({ ...r.value.orders[0] }); },
  ];
  for (const mutate of mutations) {
    const stored = record(); mutate(stored);
    const response = await harness({ stored }).get();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, "delivery_receipt_unavailable");
  }
});

test("JSON storage absence requires NoSuchKey plus404, never a generic or auth404", async () => {
  let thrown;
  const storage = load("lib/order-automation-storage.ts", {
    "@aws-sdk/client-s3": { GetObjectCommand: class {}, PutObjectCommand: class {} },
    "@/lib/r2": { R2_BUCKET: "fixture", getR2Client: () => ({ send: async () => { throw thrown; } }) },
    "node:crypto": crypto,
  });
  const key = `order-automation/${owner}/batches/${batchId}.json`;
  thrown = Object.assign(new Error("Missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
  assert.equal(await storage.readProductionJson(key), null);
  for (const [name, status] of [["AccessDenied", 404], ["NotFound", 404], ["NoSuchKey", 503], ["AccessDenied", 403], ["TimeoutError", 504]]) {
    thrown = Object.assign(new Error("Unavailable"), { name, $metadata: { httpStatusCode: status } });
    await assert.rejects(storage.readProductionJson(key), (error) => error === thrown);
  }
});
