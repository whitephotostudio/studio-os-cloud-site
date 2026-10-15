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
  new Function("exports", "require", ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(exports, id => id.startsWith("@/lib/") ? load(id.slice(6)) : nativeRequire(id));
  return exports;
}
const { collagePreset } = load("collage-template"), { collageContentHash } = load("collage-server");
const { commerceHash, commerceCatalogue, parseCommerceRequest, validateCommercePublication, commercePublicationResponse } = load("collage-commerce");
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", profileA = "33333333-3333-4333-8333-333333333333", profileB = "44444444-4444-4444-8444-444444444444", school = "55555555-5555-4555-8555-555555555555", schoolB = "66666666-6666-4666-8666-666666666666", event = "77777777-7777-4777-8777-777777777777", productId = "88888888-8888-4888-8888-888888888888";
const design = collagePreset("triptych");
const emptyState = () => ({ owner: { id: owner, billing_currency: "cad", default_package_profile_id: null }, profiles: [], schools: [{ id: school, photographer_id: owner, school_name: "School", package_profile_id: null, gallery_settings: null }], projects: [], packages: [] });
function input(state, change = {}) {
  return { requestId: crypto.randomUUID(), catalogRevision: commerceHash(state), design, galleries: [{ kind: "school", id: school }], product: { mode: "create", profileId: null, name: "Three favourite moments", priceCents: 2500, copyCount: 1 }, ...change };
}
test("fresh unassigned galleries can publish their first priced product without changing profiles", () => {
  const state = emptyState(), catalogue = commerceCatalogue(state), request = parseCommerceRequest(input(state));
  assert.equal(catalogue.photographerId, owner); assert.equal(catalogue.currency, "cad"); assert.deepEqual(catalogue.profiles, [{ id: null, name: "Unassigned catalogue" }]);
  assert.equal(catalogue.galleries[0].profileId, null); assert.equal(validateCommercePublication(state, request).items.length, 1);
  assert.equal(state.schools[0].package_profile_id, null);
});
test("publication validates integer cents, copies, gallery identity, current revision and physical package compatibility", () => {
  const state = emptyState(), source = input(state);
  for (const product of [{ ...source.product, priceCents: 25.01 }, { ...source.product, priceCents: "2500" }, { ...source.product, priceCents: 0 }, { ...source.product, copyCount: 21 }, { ...source.product, itemIndex: 0 }]) assert.throws(() => parseCommerceRequest({ ...source, product }));
  assert.throws(() => parseCommerceRequest({ ...source, galleries: [source.galleries[0], source.galleries[0]] }), /more than once/);
  const valid = parseCommerceRequest(source); assert.throws(() => validateCommercePublication({ ...state, owner: { ...state.owner, billing_currency: "usd" } }, valid), /catalogue changed/i);
  assert.throws(() => validateCommercePublication(state, { ...valid, galleries: [{ kind: "school", id: other }] }), /does not belong/);
});
test("mixed package append and collage replacement preserve ordinary prints, composites and product metadata", () => {
  const state = emptyState(); state.profiles = [{ id: profileA, name: "Main", photographer_id: owner }]; state.schools[0].package_profile_id = profileA;
  const ordinary = { name: "5×7", qty: 2, finish: "Lustre", labSku: "keep" }, composite = { name: "Class photo", qty: 1, composite: true, extra: { preserve: true } };
  state.packages = [{ id: productId, photographer_id: owner, local_id: "desktop-id", profile_id: profileA, name: "Mixed family package", category: "package", price_cents: 5000, active: true, items: [ordinary, composite], shipping_metadata: { keep: true } }];
  const raw = input(state, { product: { mode: "update", id: productId, profileId: profileA, priceCents: 7500, copyCount: 2, itemIndex: null } });
  const result = validateCommercePublication(state, parseCommerceRequest(raw));
  assert.deepEqual(result.items.slice(0, 2), [ordinary, composite]); assert.equal(result.items[2].qty, 2); assert.equal(state.packages[0].price_cents, 5000);
  assert.throws(() => validateCommercePublication(state, parseCommerceRequest({ ...raw, product: { ...raw.product, itemIndex: 0 } })), /Replace only a collage/);
  state.packages[0].active = false;
  assert.throws(() => validateCommercePublication(state, parseCommerceRequest({ ...raw, catalogRevision: commerceHash(state) })), /active physical/);
});

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table photographers(id uuid primary key,user_id uuid,billing_currency text,default_package_profile_id uuid);
    create table package_profiles(id uuid primary key,photographer_id uuid references photographers(id),name text);
    create table schools(id uuid primary key,photographer_id uuid references photographers(id),school_name text,package_profile_id uuid,gallery_settings jsonb);
    create table projects(id uuid primary key,photographer_id uuid references photographers(id),title text,workflow_type text,package_profile_id uuid,gallery_settings jsonb);
    create table packages(id uuid primary key default gen_random_uuid(),photographer_id uuid references photographers(id),local_id text,profile_id text,profile_name text,name text,description text,price_cents integer,items jsonb,active boolean,category text,is_retouch_addon boolean default false,sort_order integer,extra_metadata jsonb);
    create table checkout_attempts(key text primary key,payload_hash text,response jsonb,created_at timestamptz default now());
    create table orders(id uuid primary key); create table order_items(id uuid default gen_random_uuid(),order_id uuid,product_name text,quantity integer,price numeric,unit_price_cents integer,line_total_cents integer,sku text);`);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261014180000_private_collage_templates.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../supabase/migrations/20261014190000_collage_commerce.sql", import.meta.url), "utf8"));
  await db.query("insert into photographers values($1,$1,'cad',$3),($2,$2,'usd',null)", [owner, other, profileA]);
  await db.query("insert into package_profiles values($1,$3,'Main'),($2,$3,'Other sheet')", [profileA, profileB, owner]);
  await db.query("insert into schools values($1,$3,'School A',$4,null),($2,$3,'School B',$5,null)", [school, schoolB, owner, profileA, profileB]);
  await db.query("insert into projects values($1,$2,'Event','event',$3,null)", [event, owner, profileA]);
  await db.query("insert into packages(id,photographer_id,profile_id,profile_name,name,price_cents,items,active,category) values($1,$2,$3,'Other sheet','Existing print',1000,'[{\"name\":\"5x7\",\"qty\":1}]',true,'print')", [crypto.randomUUID(), owner, profileB]);
  return db;
}
async function state(db, photographer = owner) { return (await db.query("select collage_commerce_state($1) value", [photographer])).rows[0].value; }
async function publish(db, request, expected, options = {}) {
  return (await db.query("select publish_collage_commerce($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value", [options.owner ?? owner, request.requestId, options.hash ?? commerceHash(request), expected, request.templateId ?? null, design, null, collageContentHash(design, null), request.galleries, request.product, options.currency ?? "cad"])).rows[0].value;
}
test("database atomically publishes exact price, immutable version and grants, with durable idempotent replay and current currency", async () => {
  const db = await database();
  try {
    const before = await state(db), request = parseCommerceRequest(input(before, { galleries: [{ kind: "school", id: school }, { kind: "project", id: event }], product: { mode: "create", profileId: profileA, name: "Collage print", priceCents: 2999, copyCount: 2 } }));
    const first = await publish(db, request, before), replay = await publish(db, request, before);
    assert.equal(first.product.price_cents, 2999); assert.equal(first.product.items.length, 1); assert.equal(first.product.items[0].qty, 2); assert.equal(first.product.items[0].collage.templateVersionId, first.version.id);
    assert.equal(first.product.profile_id, profileA); assert.equal(first.product.active, true); assert.equal(first.version.published, true);
    assert.equal(replay.replayed, true); assert.equal(replay.version.id, first.version.id); assert.equal(replay.product.id, first.product.id);
    assert.equal((await db.query("select count(*)::int n from collage_template_versions")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from collage_template_galleries")).rows[0].n, 2);
    assert.equal((await db.query("select package_profile_id from schools where id=$1", [school])).rows[0].package_profile_id, profileA);
    await assert.rejects(() => publish(db, request, before, { hash: "f".repeat(64) }), /contents changed/);
    const parsed = commercePublicationResponse(first, "cad", request.requestId); assert.equal(parsed.product.priceCents, 2999); assert.equal(parsed.product.localId, `collage_${request.requestId}`);
    const current = await state(db), currencyRequest = parseCommerceRequest(input(current, { product: { ...request.product, name: "Next print" } }));
    await assert.rejects(() => publish(db, currencyRequest, current, { currency: "usd" }), /currency changed/);
    await db.exec("set role authenticated");
    await assert.rejects(() => publish(db, currencyRequest, current), /permission denied/);
    await assert.rejects(() => db.query("select * from collage_commerce_attempts"), /permission denied/);
  } finally { await db.close(); }
});
test("database rejects stale revisions, foreign scopes and wrong price sheets with no partial template, product or grant writes", async () => {
  const db = await database();
  try {
    const before = await state(db), base = input(before, { product: { mode: "create", profileId: profileA, name: "Collage", priceCents: 2500, copyCount: 1 } });
    for (const change of [{ galleries: [{ kind: "school", id: other }] }, { galleries: [{ kind: "school", id: schoolB }] }, { product: { ...base.product, copyCount: 21 } }, { product: { ...base.product, profileId: other } }]) {
      const raw = { ...base, requestId: crypto.randomUUID(), ...change };
      await assert.rejects(() => publish(db, raw, before));
      assert.equal((await db.query("select count(*)::int n from collage_template_versions")).rows[0].n, 0); assert.equal((await db.query("select count(*)::int n from collage_commerce_attempts")).rows[0].n, 0);
      assert.equal((await db.query("select count(*)::int n from packages")).rows[0].n, 1);
    }
    await db.query("update packages set description='Another editor changed metadata'");
    await assert.rejects(() => publish(db, parseCommerceRequest(base), before), /Catalogue changed/);
    assert.equal((await db.query("select count(*)::int n from collage_template_versions")).rows[0].n, 0);
  } finally { await db.close(); }
});
test("database preserves mixed product metadata, replaces only its selected collage and leaves prior order recipes unchanged", async () => {
  const db = await database();
  try {
    const ordinary = { name: "5x7", qty: 2, finish: "Lustre", labSku: "original" }, composite = { name: "Class", qty: 1, composite: true, meta: { retain: true } };
    await db.query("insert into packages(id,photographer_id,local_id,profile_id,profile_name,name,description,price_cents,items,active,category,is_retouch_addon,sort_order,extra_metadata) values($1,$2,'local-mixed',$3,'Main','Family package','Keep description',5000,$4,true,'package',false,7,'{\"retain\":true}')", [productId, owner, profileA, [ordinary, composite]]);
    let before = await state(db), request = parseCommerceRequest(input(before, { product: { mode: "update", id: productId, profileId: profileA, priceCents: 7999, copyCount: 2 } }));
    const first = await publish(db, request, before), oldVersion = first.version.id;
    assert.deepEqual(first.product.items.slice(0, 2), [ordinary, composite]); assert.equal(first.product.name, "Family package"); assert.equal(first.product.description, "Keep description"); assert.equal(first.product.local_id, "local-mixed"); assert.equal(first.product.sort_order, 7); assert.deepEqual(first.product.extra_metadata, { retain: true });
    await db.query("insert into order_items(order_id,quantity,collage_snapshot) values($1,1,$2)", [crypto.randomUUID(), { version: 1, templateVersionId: oldVersion }]);
    before = await state(db); request = parseCommerceRequest(input(before, { templateId: first.version.template_id, product: { mode: "update", id: productId, profileId: profileA, priceCents: 8999, copyCount: 3, itemIndex: 2 } }));
    const second = await publish(db, request, before);
    assert.notEqual(second.version.id, oldVersion); assert.equal(second.version.version_number, 2); assert.equal(second.product.items.length, 3); assert.equal(second.product.items[2].qty, 3);
    assert.deepEqual(second.product.items.slice(0, 2), [ordinary, composite]); assert.equal((await db.query("select collage_snapshot from order_items")).rows[0].collage_snapshot.templateVersionId, oldVersion);
    before = await state(db); request = parseCommerceRequest(input(before, { product: { mode: "update", id: productId, profileId: profileA, priceCents: 1, copyCount: 1, itemIndex: 0 } }));
    await assert.rejects(() => publish(db, request, before), /Only an existing collage/); assert.equal((await db.query("select price_cents from packages where id=$1", [productId])).rows[0].price_cents, 8999);
  } finally { await db.close(); }
});
test("database supports the empty unassigned catalogue and owned legacy text profiles without creating or reassigning sheets", async () => {
  const db = await database();
  try {
    const freshSchool = crypto.randomUUID(); await db.query("insert into schools values($1,$2,'Fresh',null,null)", [freshSchool, other]);
    let before = await state(db, other), request = parseCommerceRequest(input(before, { galleries: [{ kind: "school", id: freshSchool }], product: { mode: "create", profileId: null, name: "Fresh collage", priceCents: 1500, copyCount: 1 } }));
    const first = await publish(db, request, before, { owner: other, currency: "usd" }); assert.equal(first.product.profile_id, null);
    await db.query("insert into packages(photographer_id,profile_id,profile_name,name,price_cents,items,active,category) values($1,'legacy-sheet','Legacy sheet','Print',1000,'[{\"name\":\"5x7\",\"qty\":1}]',true,'print')", [other]);
    await db.query("update schools set gallery_settings='{\"extras\":{\"priceSheetProfileId\":\"legacy-sheet\"}}' where id=$1", [freshSchool]);
    before = await state(db, other); request = parseCommerceRequest(input(before, { galleries: [{ kind: "school", id: freshSchool }], product: { mode: "create", profileId: "legacy-sheet", name: "Legacy collage", priceCents: 2500, copyCount: 1 } }));
    const second = await publish(db, request, before, { owner: other, currency: "usd" }); assert.equal(second.product.profile_id, "legacy-sheet");
    assert.equal((await db.query("select count(*)::int n from package_profiles where photographer_id=$1", [other])).rows[0].n, 0);
    assert.equal((await db.query("select package_profile_id from schools where id=$1", [freshSchool])).rows[0].package_profile_id, null);
  } finally { await db.close(); }
});
test("post-write gallery applicability sees a newly populated selected sheet and a price-driven inherited fallback", async () => {
  const db = await database();
  try {
    // Sheet A is explicitly selected but empty; only sheet B currently has a
    // product. The newly inserted first A product must be visible to the check.
    let before = await state(db), request = parseCommerceRequest(input(before, { product: { mode: "create", profileId: profileA, name: "First sheet A collage", priceCents: 2500, copyCount: 1 } }));
    const first = await publish(db, request, before); assert.equal(first.product.profile_id, profileA);
    // With no explicit/default sheet, gallery context falls back to the first
    // priced package. Updating A below B must use the post-update price order.
    await db.query("update photographers set default_package_profile_id=null where id=$1", [owner]);
    await db.query("update schools set package_profile_id=null where id=$1", [school]);
    before = await state(db); request = parseCommerceRequest(input(before, { templateId: first.version.template_id, product: { mode: "update", id: first.product.id, profileId: profileA, priceCents: 500, copyCount: 1, itemIndex: 0 } }));
    const second = await publish(db, request, before); assert.equal(second.product.price_cents, 500);
    assert.equal((await db.query("select package_profile_id from schools where id=$1", [school])).rows[0].package_profile_id, null);
    assert.equal((await db.query("select default_package_profile_id from photographers where id=$1", [owner])).rows[0].default_package_profile_id, null);
  } finally { await db.close(); }
});
