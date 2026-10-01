import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import crypto from "node:crypto";
import { z } from "zod";
function load(file, deps) {
  const code = ts.transpileModule(
    fs.readFileSync(new URL("../" + file, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    if (!(name in deps)) throw Error("Missing test dependency " + name);
    return deps[name];
  }, exports);
  return exports;
}
const owner = "11111111-1111-4111-8111-111111111111",
  cloud = "22222222-2222-4222-8222-222222222222";
const digest = (b) => crypto.createHash("sha256").update(b).digest("hex");
class ProductionAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
function harness({ ambiguous = false, missingKey = false } = {}) {
  const files = new Map(),
    writes = [],
    emails = [],
    zip = Buffer.from("fixture archive"),
    key = `order-automation/${owner}/staging/upload`,
    body = {
      batchId: digest("batch"),
      zipSha256: digest(zip),
      key,
      labEmail: "lab@example.com",
      labName: "Lab",
      turnaroundDays: 2,
      orders: [
        {
          localId: "local-order",
          cloudId: cloud,
          snapshot: digest("snapshot"),
        },
      ],
    };
  let paid = true,
    mutation = 0,
    revision = 0,
    authenticated = true;
  const financial = (orders) => digest(JSON.stringify(orders));
  const storage = {
    digest,
    productionKey: (uid, suffix) => `order-automation/${uid}/${suffix}`,
    readProduction: async (path) => {
      const f = files.get(path);
      if (!f) throw Error("Missing object");
      return { bytes: f.bytes, etag: f.etag };
    },
    readProductionJson: async (path) => {
      const f = files.get(path);
      return f ? { value: JSON.parse(f.bytes.toString()), etag: f.etag } : null;
    },
    writeProduction: async (path, bytes, type, condition = {}) => {
      const f = files.get(path);
      if (condition.create && f) throw Error("CAS create conflict");
      if (condition.etag && f?.etag !== condition.etag)
        throw Error("CAS update conflict");
      files.set(path, { bytes: Buffer.from(bytes), etag: String(++revision) });
      writes.push(path);
    },
    writeProductionJson: async (path, value, condition) =>
      storage.writeProduction(
        path,
        Buffer.from(JSON.stringify(value)),
        "application/json",
        condition,
      ),
  };
  const auth = {
    ProductionAuthError,
    productionAuth: async () => {
      if (!authenticated) throw new ProductionAuthError("Sign in", 401);
      return { id: owner, email: "owner@example.com" };
    },
    productionFinancialRevision: financial,
    currentProductionOrders: async (uid, ids) => {
      assert.equal(uid, owner);
      assert.deepEqual(ids, [cloud]);
      if (!paid) throw Error("Unpaid or refunded");
      return {
        orders: [{ id: cloud, paid: true, revision: mutation }],
        studio: { business_name: "Studio", studio_email: "studio@example.com" },
      };
    },
  };
  const next = {
    "next/server": {
      NextResponse: {
        json: (body, opt) => Response.json(body, opt),
        redirect: (url, opt) =>
          new Response(null, {
            ...opt,
            headers: { ...opt?.headers, Location: url },
          }),
      },
    },
  };
  const deps = {
    ...next,
    "node:crypto": crypto,
    zod: { z },
    "@/lib/order-automation-auth": auth,
    "@/lib/order-automation-storage": storage,
    "@/lib/order-automation-quality": {
      labEmailText: () => "Frozen friendly message",
    },
    "@/lib/order-automation-zip": {
      verifyNoritsuZip: async () => ({ pieces: 8, orders: 1 }),
    },
    "@/lib/resend": {
      resendConfigured: () => !missingKey,
      sendResendEmail: async (payload) => {
        emails.push(payload);
        if (ambiguous && emails.length === 1)
          throw Error("Lost provider response");
        return { id: "email-receipt" };
      },
    },
  };
  files.set(key, { bytes: zip, etag: "upload" });
  files.set(`${key}.json`, {
    bytes: Buffer.from(
      JSON.stringify({
        kind: "batch",
        sha256: digest(zip),
        bytes: zip.length,
        expiresAt: Date.now() + 600000,
        orderIds: [cloud],
      }),
    ),
    etag: "ticket",
  });
  const route = load("app/api/order-automation/batch/route.ts", deps);
  const download = load("app/api/order-automation/download/route.ts", {
    ...next,
    "node:crypto": crypto,
    "@/lib/order-automation-auth": auth,
    "@/lib/order-automation-storage": storage,
    "@/lib/r2-signed-urls": {
      r2PresignedGetUrl: (key, ttl, options) => {
        assert.equal(ttl, 60);
        assert.equal(options.allowOrderAutomation, true);
        return "https://r2.example.test/private";
      },
    },
  });
  return {
    body,
    files,
    writes,
    emails,
    route,
    download,
    record: () =>
      JSON.parse(
        files
          .get(`order-automation/${owner}/batches/${body.batchId}.json`)
          .bytes.toString(),
      ),
    setPaid: (v) => {
      paid = v;
    },
    changeOrder: () => {
      mutation++;
    },
    signOut: () => {
      authenticated = false;
    },
    request: (patch = {}) => ({ json: async () => ({ ...body, ...patch }) }),
  };
}
test("exact batch sends once and retries reuse frozen email receipt", async () => {
  const h = harness();
  const first = await h.route.POST(h.request());
  assert.equal(first.status, 200);
  assert.equal((await first.json()).receiptId, "email-receipt");
  assert.equal((await h.route.POST(h.request())).status, 200);
  assert.equal(h.emails.length, 1);
  assert.equal(
    (await h.route.POST(h.request({ labEmail: "someone-else@example.com" })))
      .status,
    400,
  );
  assert.equal(h.emails.length, 1);
  assert.ok(h.writes.some((key) => key.includes("/reservations/")));
});
test("ambiguous email retries use the same idempotency key within its bounded window", async () => {
  const h = harness({ ambiguous: true });
  assert.equal((await h.route.POST(h.request())).status, 400);
  const record = h.record();
  record.firstAttempt = Date.now() - 90000;
  const path = `order-automation/${owner}/batches/${h.body.batchId}.json`;
  h.files.set(path, {
    bytes: Buffer.from(JSON.stringify(record)),
    etag: "retry",
  });
  assert.equal((await h.route.POST(h.request())).status, 200);
  assert.equal(h.emails.length, 2);
  assert.equal(h.emails[0].idempotencyKey, h.emails[1].idempotencyKey);
  assert.equal(h.emails[0].text, h.emails[1].text);
});
test("refund, wrong ZIP, missing mail provider and foreign upload never send email", async () => {
  for (const scenario of ["refund", "hash", "provider", "owner"]) {
    const h = harness({ missingKey: scenario === "provider" });
    if (scenario === "refund") h.setPaid(false);
    const patch =
      scenario === "hash"
        ? { zipSha256: digest("changed") }
        : scenario === "owner"
          ? { key: "order-automation/another/staging/upload" }
          : {};
    assert.equal((await h.route.POST(h.request(patch))).status, 400);
    assert.equal(h.emails.length, 0);
  }
  const h = harness();
  h.signOut();
  assert.equal((await h.route.POST(h.request())).status, 401);
  assert.equal(h.writes.length, 0);
});
test("another batch cannot resend an already reserved paid order", async () => {
  const h = harness();
  assert.equal((await h.route.POST(h.request())).status, 200);
  assert.equal(
    (await h.route.POST(h.request({ batchId: digest("another-batch") })))
      .status,
    400,
  );
  assert.equal(h.emails.length, 1);
});
test("private download rejects wrong tokens, expiry and changed paid orders", async () => {
  const h = harness();
  await h.route.POST(h.request());
  const record = h.record();
  const request = (token) => ({
    nextUrl: new URL(
      `https://studio.test/download?owner=${owner}&batch=${h.body.batchId}&token=${token}`,
    ),
  });
  assert.equal((await h.download.GET(request(record.token))).status, 302);
  assert.equal((await h.download.GET(request("0".repeat(64)))).status, 404);
  h.changeOrder();
  assert.equal((await h.download.GET(request(record.token))).status, 404);
  h.setPaid(false);
  assert.equal((await h.download.GET(request(record.token))).status, 404);
});
