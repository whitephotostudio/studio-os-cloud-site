import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";

function endpoint(auth) {
  const code = ts.transpileModule(
    fs.readFileSync(
      new URL("../app/api/order-automation/quality/route.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  class ProductionAuthError extends Error {
    constructor() {
      super("unauthorized");
      this.status = 401;
    }
  }
  const deps = {
    "next/server": {
      NextResponse: { json: (body, options) => Response.json(body, options) },
    },
    "@/lib/r2": { hasR2Config: () => true },
    "@/lib/resend": { resendConfigured: () => true },
    "@/lib/order-automation-auth": {
      ProductionAuthError,
      productionAuth: async () => {
        if (!auth) throw new ProductionAuthError();
        return { id: "owner" };
      },
    },
  };
  const exports = {};
  new Function("require", "exports", code)((name) => {
    assert.ok(name in deps, `Unexpected cloud inspection dependency: ${name}`);
    return deps[name];
  }, exports);
  return exports;
}

test("former paid inspection refuses old clients without reading portraits or calling providers", async () => {
  const route = endpoint(true);
  const request = {
    json: () => {
      throw Error("Must not consume a portrait");
    },
  };
  const response = await route.POST(request);
  assert.equal(response.status, 410);
  assert.equal((await response.json()).passed, false);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("local-only readiness retains existing lab services and no cloud AI", async () => {
  const response = await endpoint(true).GET({});
  assert.deepEqual(await response.json(), {
    ok: true,
    aiConfigured: false,
    localAiRequired: true,
    emailConfigured: true,
    storageConfigured: true,
    model: "local-qwen2.5-vl-7b-4bit",
  });
});

test("inspection and readiness still require studio authentication", async () => {
  const route = endpoint(false);
  for (const method of [route.GET, route.POST])
    assert.equal((await method({})).status, 401);
});
