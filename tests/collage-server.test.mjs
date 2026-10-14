import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const nativeRequire = createRequire(import.meta.url), cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const exports = {}; cache.set(name, exports);
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  new Function("exports", "require", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(exports,
    id => id.startsWith("@/lib/") ? load(id.slice(6)) : nativeRequire(id));
  return exports;
}
const { collagePreset } = load("collage-template");
const { collageContentHash, collageArtworkKey, storedCollageVersion, validateCollageVersionAccess, resolveCollageVersions, resolveCollageCatalogueVersions, readCollageJson } = load("collage-server");
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", templateId = "33333333-3333-4333-8333-333333333333", versionId = "44444444-4444-4444-8444-444444444444";
const design = collagePreset("triptych");
const row = () => ({ id: versionId, template_id: templateId, photographer_id: owner, version_number: 1, design, artwork_key: null, content_hash: collageContentHash(design, null), published: true });
test("checkout RPC replacement preserves every existing column and replay rule", () => {
  const original = readFileSync(new URL("../supabase/migrations/20260924160000_order_payment_safety.sql", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20261014180000_private_collage_templates.sql", import.meta.url), "utf8");
  const functionBody = source => source.slice(source.indexOf("create or replace function public.create_checkout_order_once("), source.indexOf("-- Serialize session creation") > 0 ? source.indexOf("-- Serialize session creation") : source.lastIndexOf("commit;")).trim();
  const changed = functionBody(migration).replace("line_total_cents, sku, collage_snapshot)", "line_total_cents, sku)").replace("i->>'sku', nullif(i->'collage_snapshot', 'null'::jsonb)", "i->>'sku'");
  assert.equal(changed, functionBody(original));
});

test("only published immutable versions owned by the studio and assigned to the gallery resolve", () => {
  const saved = row();
  assert.equal(validateCollageVersionAccess([saved], owner, [versionId, versionId], [versionId]).size, 1);
  assert.throws(() => validateCollageVersionAccess([saved], other, [versionId], [versionId]), /not available/);
  assert.throws(() => validateCollageVersionAccess([saved], owner, [versionId], []), /not available/);
  assert.throws(() => validateCollageVersionAccess([{ ...saved, published: false }], owner, [versionId], [versionId]), /not available/);
  assert.throws(() => validateCollageVersionAccess([saved], owner, ["https://example.com/template"], [versionId]), /Invalid/);
});
test("saved content hash detects design edits and private artwork cannot cross studios", () => {
  assert.equal(storedCollageVersion(row()).contentHash, row().content_hash);
  assert.throws(() => storedCollageVersion({ ...row(), design: { ...design, name: "Changed" } }), /changed/);
  const key = collageArtworkKey(other, "a".repeat(64));
  assert.throws(() => storedCollageVersion({ ...row(), artwork_key: key, content_hash: collageContentHash(design, key) }), /another studio/);
  assert.throws(() => collageArtworkKey("../other", "a".repeat(64)));
});
test("shared package profiles reveal only each gallery's permitted versions and revoked grants never authorize selections", async () => {
  const unavailable = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", missing = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const school = "55555555-5555-4555-8555-555555555555", otherSchool = "66666666-6666-4666-8666-666666666666";
  const rows = [row(), { ...row(), id: unavailable }, { ...row(), id: foreign, photographer_id: other }];
  const grants = [{ version_id: versionId, photographer_id: owner, school_id: school, revoked_at: null }, { version_id: unavailable, photographer_id: owner, school_id: otherSchool, revoked_at: null }];
  const service = { from(table) {
    const filters = [], ids = [];
    const chain = { select() { return chain; }, eq(key, value) { filters.push([key, value]); return chain; }, in(key, values) { ids.push([key, values]); return chain; }, is(key, value) { filters.push([key, value]); return chain; },
      async maybeSingle() { assert.equal(table, "schools"); return { data: { id: school }, error: null }; },
      then(resolve) { return Promise.resolve({ data: (table === "collage_template_versions" ? rows : grants).filter(row => filters.every(([key, value]) => row[key] === value) && ids.every(([key, values]) => values.includes(row[key]))), error: null }).then(resolve); } }; return chain;
  } };
  const requested = [versionId, unavailable, foreign, missing];
  const result = await resolveCollageCatalogueVersions(service, owner, { schoolId: school }, requested);
  assert.deepEqual([...result.versions.keys()], [versionId]); assert.deepEqual(result.unavailableVersionIds, requested.slice(1));
  await assert.rejects(() => resolveCollageVersions(service, owner, { schoolId: school }, requested), /not available/);
  grants[0].revoked_at = new Date().toISOString();
  const withdrawn = await resolveCollageCatalogueVersions(service, owner, { schoolId: school }, [versionId]);
  assert.equal(withdrawn.versions.size, 0); assert.deepEqual(withdrawn.unavailableVersionIds, [versionId]);
  await assert.rejects(() => resolveCollageVersions(service, owner, { schoolId: school }, [versionId]), /not available/);
});
test("JSON request limits apply to chunked bodies without trusting Content-Length", async () => {
  const request = value => new Request("https://test.example/api", { method: "POST", body: new ReadableStream({ start(controller) {
    for (const part of value) controller.enqueue(new TextEncoder().encode(part)); controller.close();
  } }), duplex: "half" });
  assert.deepEqual(await readCollageJson(request(['{"v":', '1}']), 7), { v: 1 });
  await assert.rejects(() => readCollageJson(request(['{"v":"', "x".repeat(100), '"}']), 20), error => error.status === 413);
  await assert.rejects(() => readCollageJson(request(["{broken"]), 20), /Invalid.*JSON/);
  await assert.rejects(() => readCollageJson(request(["[]"]), 20), /Invalid.*JSON/);
});

test("database appends versions atomically, rejects cross-owner galleries, prevents edits and retains checkout snapshots", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      create table photographers(id uuid primary key,user_id uuid); grant select on photographers to authenticated;
      create table schools(id uuid primary key,photographer_id uuid); create table projects(id uuid primary key,photographer_id uuid);
      create table checkout_attempts(key text primary key,payload_hash text,response jsonb,created_at timestamptz default now());
      create table orders(id uuid primary key,photographer_id uuid,parent_name text,parent_email text,parent_phone text,customer_name text,customer_email text,package_id uuid,package_name text,package_price numeric,special_notes text,notes text,status text,payment_status text,seen_by_photographer boolean,subtotal_cents integer,tax_cents integer,total_cents integer,total_amount numeric,currency text,cart_snapshot jsonb,school_id uuid,class_id uuid,student_id uuid,project_id uuid,order_group_id uuid);
      create table order_items(id uuid default gen_random_uuid(),order_id uuid,product_name text,quantity integer,price numeric,unit_price_cents integer,line_total_cents integer,sku text);`);
    await db.exec(readFileSync(new URL("../supabase/migrations/20261014180000_private_collage_templates.sql", import.meta.url), "utf8"));
    const school = "55555555-5555-4555-8555-555555555555", foreignSchool = "66666666-6666-4666-8666-666666666666";
    await db.query("insert into photographers values($1,$2),($2,$1)", [owner, other]);
    await db.query("insert into schools values($1,$2),($3,$4)", [school, owner, foreignSchool, other]);
    const save = (photographer = owner, schools = [school]) => db.query("select * from public.save_collage_template_version($1,$2,$3,$4,null,$5,true,$6,'{}'::uuid[])", [templateId, photographer, design.name, JSON.stringify(design), row().content_hash, schools]);
    const first = (await save()).rows[0], second = (await save()).rows[0];
    assert.equal(first.version_number, 1); assert.equal(second.version_number, 2); assert.notEqual(first.id, second.id);
    await assert.rejects(() => save(other, [foreignSchool]), /owner changed/);
    await assert.rejects(() => save(owner, [foreignSchool]), /another studio/);
    assert.equal((await db.query("select count(*)::int n from collage_template_versions")).rows[0].n, 2);
    await assert.rejects(() => db.query("update collage_template_versions set design='{}' where id=$1", [first.id]), /immutable/);
    await assert.rejects(() => db.query("delete from collage_template_versions where id=$1", [first.id]), /immutable/);
    await assert.rejects(() => db.query("delete from collage_template_galleries where version_id=$1", [first.id]), /immutable/);
    await assert.rejects(() => db.query("select withdraw_collage_gallery_access($1,$2)", [first.id, other]), /another studio/);
    assert.equal((await db.query("select withdraw_collage_gallery_access($1,$2) n", [first.id, owner])).rows[0].n, 1);
    assert.equal((await db.query("select withdraw_collage_gallery_access($1,$2) n", [first.id, owner])).rows[0].n, 0);
    assert.ok((await db.query("select revoked_at from collage_template_galleries where version_id=$1", [first.id])).rows[0].revoked_at);
    await assert.rejects(() => db.query("update collage_template_galleries set revoked_at = null where version_id=$1", [first.id]), /immutable/);
    await assert.rejects(() => db.query("update collage_template_galleries set school_id=$1 where version_id=$2", [foreignSchool, second.id]), /immutable/);
    assert.deepEqual((await db.query("select design from collage_template_versions where id=$1", [first.id])).rows[0].design, design);
    const orderId = "77777777-7777-4777-8777-777777777777", snapshot = { version: 1, templateVersionId: first.id, test: "frozen recipe" };
    await db.query("select create_checkout_order_once('key','hash',$1,$2,'{}')", [JSON.stringify([{ id: orderId, photographer_id: owner }]), JSON.stringify([{ order_id: orderId, quantity: 1, collage_snapshot: snapshot }])]);
    assert.deepEqual((await db.query("select collage_snapshot from order_items")).rows[0].collage_snapshot, snapshot);
    for (const quantity of [2, 0, null]) await assert.rejects(() => db.query("insert into order_items(order_id,quantity,collage_snapshot) values($1,$2,$3)", [orderId, quantity, snapshot]), /collage_one_recipe_per_copy/);
    await assert.rejects(() => db.query("update order_items set quantity = 2"), /collage_one_recipe_per_copy/);
    await assert.rejects(() => db.query("update order_items set collage_snapshot = '{}'"), /immutable/);
    await db.exec("set role authenticated");
    await assert.rejects(() => save(), /permission denied/);
    await assert.rejects(() => db.query("select withdraw_collage_gallery_access($1,$2)", [second.id, owner]), /permission denied/);
    await assert.rejects(() => db.query("insert into collage_templates(photographer_id,name) values($1,'forged')", [owner]), /permission denied/);
    assert.equal((await db.query("select count(*)::int n from collage_template_versions")).rows[0].n, 0);
  } finally { await db.close(); }
});
