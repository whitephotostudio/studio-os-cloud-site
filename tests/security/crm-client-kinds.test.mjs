import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { CRM_CLIENT_KINDS, parseCrmValues } = await import("../../lib/crm.ts");

const migration = source(
  "supabase/migrations/20260824220000_extend_crm_client_kinds.sql",
);
const api = source("app/api/dashboard/crm/route.ts");

const existingKinds = [
  "school",
  "corporate",
  "wedding",
  "event",
  "sports",
  "family",
  "person",
  "nonprofit",
  "other",
];
const addedKinds = ["college", "university", "daycare", "montessori"];

test("CRM client kind migration safely expands the existing check constraint", () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.match(
    migration,
    /add constraint crm_clients_kind_check_v2[\s\S]*not valid;/i,
  );
  assert.match(
    migration,
    /validate constraint crm_clients_kind_check_v2;[\s\S]*drop constraint crm_clients_kind_check;[\s\S]*rename constraint crm_clients_kind_check_v2 to crm_clients_kind_check;/i,
  );

  for (const kind of [...existingKinds, ...addedKinds]) {
    assert.match(migration, new RegExp(`'${kind}'`));
  }
});

test("CRM runtime accepts new and existing client kinds from one shared allow-list", () => {
  assert.deepEqual(CRM_CLIENT_KINDS, [...existingKinds.slice(0, 1), ...addedKinds, ...existingKinds.slice(1)]);

  for (const kind of CRM_CLIENT_KINDS) {
    const parsed = parseCrmValues("client", {
      kind,
      displayName: `Example ${kind}`,
    });
    assert.equal(parsed.ok, true, `${kind} should be accepted`);
    assert.equal(parsed.data.kind, kind);
  }

  for (const invalid of ["collage", "universaty", "daycar", "montosory", "unknown"]) {
    assert.equal(
      parseCrmValues("client", { kind: invalid, displayName: "Invalid" }).ok,
      false,
      `${invalid} should be rejected`,
    );
  }
});

test("CRM GET kind filter uses the same API/runtime allow-list", () => {
  assert.match(api, /CRM_CLIENT_KINDS,/);
  assert.match(api, /kind: z\.enum\(CRM_CLIENT_KINDS\)\.nullable\(\)\.optional\(\)/);
});
