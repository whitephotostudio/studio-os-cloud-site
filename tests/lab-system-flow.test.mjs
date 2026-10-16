import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLabDatabase, LAB_FIXTURE, fixtureToken } from '../scripts/lab-system-fixture.mjs';

async function asRole(db, role, user, action) {
  return db.transaction(async tx => {
    assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)", [user || '', role, JSON.stringify({ sub: user, role, aal: 'aal1' })]);
    return action(tx);
  });
}

function document(labId, products) {
  return { name: 'Verified local fixture sheet', labId, currency: 'CAD', pricing: { markupPercent: 100, rounding: 'none' },
    items: products.map(id => ({ catalogProductId: id, retailCents: 1200, enabled: true })),
    packages: [{ id: randomUUID(), name: 'Portrait package', description: 'Mixed print quantities', retailCents: 2400, items: products.map((id, i) => ({ catalogProductId: id, quantity: i + 1 })) }],
    shipping: { mode: 'custom', feeCents: 725, title: 'Local pilot delivery' }, terms: 'Synthetic fixture terms', assignments: [] };
}

function assertNoWholesale(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert.doesNotMatch(key, /^(costCents|cost_cents|costSource|cost_source)$/i, 'Customer-facing product metadata must not expose wholesale costs');
    assertNoWholesale(nested);
  }
}

test('real lab migration saves, rejects stale/foreign writes, gates GTA and publishes an immutable local profile atomically', async () => {
  const db = await createLabDatabase();
  try {
    const verifiedLab = randomUUID(), productA = randomUUID(), productB = randomUUID(), sheetId = randomUUID();
    await db.query(`insert into studio_labs(id,slug,name,location,country_code,city,region,currency,status,intake_enabled,catalog_verified,description) values ($1,'fixture-verified','Synthetic local lab','Local fixture','CA','Fixture city','Fixture region','CAD','active',true,true,'Not a real fulfillment provider')`, [verifiedLab]);
    for (const [id, size, cost, width, height] of [[productA, '5x7', 200, 5, 7], [productB, '8x10', 400, 8, 10]]) {
      await db.query(`insert into studio_lab_catalog(id,lab_id,category,name,size,finish,cost_cents,currency,sku,verified,active,popular,width_inches,height_inches,cost_source) values ($1,$2,'prints','Synthetic print',$3,'Lustre',$4,'CAD',$5,true,true,true,$6,$7,'lab_confirmed')`, [id, verifiedLab, size, cost, `LOCAL-${size}`, width, height]);
    }
    const initial = document(verifiedLab, [productA, productB]);
    const save = (user, version, doc = initial, action = version ? 'save' : 'create', id = sheetId) => asRole(db, 'service_role', null, tx => tx.query('select save_lab_price_sheet($1,$2,$3,$4::jsonb,$5) as result', [user, id, version, JSON.stringify(doc), action]));
    const read = id => db.query('select * from lab_price_sheets where id=$1', [id]);
    await save(LAB_FIXTURE.owner, 0);
    const first = (await read(sheetId)).rows[0];
    assert.equal(first.version, 1);
    assert.equal(first.photographer_id, LAB_FIXTURE.photographer);
    assert.equal(first.status, 'draft');
    assert.deepEqual(first.document, initial);
    const edited = { ...initial, terms: 'Saved terms survive database reload', shipping: { mode: 'custom', feeCents: 975, title: 'Courier' } };
    await save(LAB_FIXTURE.owner, 1, edited);
    assert.equal((await read(sheetId)).rows[0].version, 2);
    assert.equal((await read(sheetId)).rows[0].document.shipping.feeCents, 975);
    await assert.rejects(() => save(LAB_FIXTURE.owner, 1, { ...initial, name: 'Stale tab' }), /LAB_VERSION_CONFLICT/);
    await assert.rejects(() => save(LAB_FIXTURE.otherOwner, 2, edited), /LAB_(OWNER|NOT_FOUND)/);
    assert.equal((await read(sheetId)).rows[0].document.terms, edited.terms);

    const owned = await asRole(db, 'authenticated', LAB_FIXTURE.owner, tx => tx.query('select id from lab_price_sheets'));
    assert.equal(owned.rows.some(row => row.id === sheetId), true);
    const foreign = await asRole(db, 'authenticated', LAB_FIXTURE.otherOwner, tx => tx.query('select id from lab_price_sheets where id=$1', [sheetId]));
    assert.equal(foreign.rows.length, 0, 'RLS hides another studio sheet');
    await assert.rejects(() => asRole(db, 'authenticated', LAB_FIXTURE.owner, tx => tx.query('update lab_price_sheets set name=$1 where id=$2', ['Direct browser write', sheetId])));
    await assert.rejects(() => asRole(db, 'authenticated', LAB_FIXTURE.owner, tx => tx.query('select save_lab_price_sheet($1,$2,2,$3::jsonb,$4)', [LAB_FIXTURE.owner, sheetId, JSON.stringify(edited), 'save'])));
    await assert.rejects(() => asRole(db, 'authenticated', LAB_FIXTURE.owner, tx => tx.query("insert into lab_memberships(lab_id,user_id,role) values ($1,$2,'owner')", [verifiedLab, LAB_FIXTURE.owner])), undefined, 'A studio cannot grant itself lab privileges');
    await assert.rejects(() => asRole(db, 'authenticated', LAB_FIXTURE.owner, tx => tx.query("update studio_labs set intake_enabled=true where id=$1", [verifiedLab])), undefined, 'A studio cannot enable lab intake');
    await assert.rejects(() => asRole(db, 'authenticated', LAB_FIXTURE.owner, tx => tx.query("update studio_lab_catalog set verified=true where id=$1", [productA])), undefined, 'A studio cannot verify catalog products');
    const staff = randomUUID();
    await db.query('insert into auth.users(id) values ($1)', [staff]);
    await db.query("insert into lab_memberships(lab_id,user_id,role) values ($1,$2,'viewer')", [verifiedLab, staff]);
    const staffLabs = await asRole(db, 'authenticated', staff, tx => tx.query('select id from studio_labs'));
    assert.deepEqual(staffLabs.rows.map(row => row.id), [verifiedLab]);
    const staffProducts = await asRole(db, 'authenticated', staff, tx => tx.query('select lab_id from studio_lab_catalog'));
    assert.equal(staffProducts.rows.length, 2);
    assert.equal(staffProducts.rows.every(row => row.lab_id === verifiedLab), true, 'Staff catalog RLS is correlated to its own lab');
    assert.equal((await asRole(db, 'authenticated', staff, tx => tx.query('select id from lab_price_sheets'))).rows.length, 0, 'Lab staff cannot read photographer draft sheets');

    const gta = (await db.query("select id from studio_labs where slug='gta-imaging'")).rows[0];
    assert.ok(gta, 'Migration must seed GTA explicitly in setup');
    const gtaId = randomUUID(), gtaDoc = document(gta.id, []);
    gtaDoc.packages = [];
    await save(LAB_FIXTURE.owner, 0, gtaDoc, 'create', gtaId);
    const publish = (id, version, assignments, user = LAB_FIXTURE.owner) => asRole(db, 'service_role', null, tx => tx.query('select publish_lab_price_sheet($1,$2,$3,$4::jsonb) as result', [user, id, version, JSON.stringify(assignments)]));
    await assert.rejects(() => publish(gtaId, 1, [{ kind: 'project', id: LAB_FIXTURE.project }]), /LAB_NOT_READY/);
    assert.equal((await db.query('select count(*)::int as n from package_profiles')).rows[0].n, 0, 'Rejected GTA publication creates no checkout profile');
    await assert.rejects(() => publish(sheetId, 2, [{ kind: 'project', id: LAB_FIXTURE.otherProject }]), /LAB_(GALLERY_SCOPE|OWNER)/);
    assert.equal((await db.query('select count(*)::int as n from package_profiles')).rows[0].n, 0, 'Foreign assignment rolls publication back');

    await publish(sheetId, 2, [{ kind: 'project', id: LAB_FIXTURE.project }, { kind: 'school', id: LAB_FIXTURE.school }]);
    const published = (await read(sheetId)).rows[0];
    assert.equal(published.status, 'published');
    assert.ok(published.published_profile_id);
    const profileBefore = (await db.query('select * from package_profiles where id=$1', [published.published_profile_id])).rows;
    const packagesBefore = (await db.query('select * from packages where profile_id=$1 order by id', [published.published_profile_id])).rows;
    assert.ok(packagesBefore.length >= 2, 'Enabled singles and mixed package become existing-checkout products');
    assertNoWholesale(profileBefore);
    assertNoWholesale(packagesBefore);
    assert.equal((await db.query('select package_profile_id from projects where id=$1', [LAB_FIXTURE.project])).rows[0].package_profile_id, published.published_profile_id);
    assert.equal((await db.query('select package_profile_id from schools where id=$1', [LAB_FIXTURE.school])).rows[0].package_profile_id, published.published_profile_id);
    assert.equal((await db.query('select package_profile_id from projects where id=$1', [LAB_FIXTURE.otherProject])).rows[0].package_profile_id, null);
    await save(LAB_FIXTURE.owner, published.version, { ...edited, terms: 'New draft edit' });
    assert.deepEqual((await db.query('select * from package_profiles where id=$1', [published.published_profile_id])).rows, profileBefore);
    assert.deepEqual((await db.query('select * from packages where profile_id=$1 order by id', [published.published_profile_id])).rows, packagesBefore, 'Draft edits cannot rewrite an assigned immutable checkout snapshot');
  } finally { await db.close(); }
});

const httpOrigin = process.env.LAB_SYSTEM_HTTP_ORIGIN;
test('actual Next HTTP persists mixed drafts, rejects stale tabs and foreign owners, and holds GTA publication', { skip: !httpOrigin }, async () => {
  const origin = new URL(httpOrigin);
  assert.match(origin.origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
  const call = async (body, owner = LAB_FIXTURE.owner) => {
    const response = await fetch(new URL('/api/dashboard/labs', origin), { method: body ? 'POST' : 'GET', headers: { Origin: origin.origin, ...(owner ? { Authorization: `Bearer ${fixtureToken(owner)}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call(undefined, null)).status, 401);
  const workspace = await call();
  assert.equal(workspace.status, 200, JSON.stringify(workspace.body));
  const gta = workspace.body.workspace.labs.find(lab => lab.slug === 'gta-imaging');
  const synthetic = workspace.body.workspace.labs.find(lab => lab.slug === 'fixture-lab');
  assert.ok(gta);
  assert.ok(synthetic, 'HTTP acceptance uses an explicit synthetic catalog, never unprovided GTA prices');
  const created = await call({ action: 'create', labId: synthetic.id, name: 'HTTP pilot sheet', starter: 'popular' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const original = created.body.sheet;
  assert.ok(original.items.length >= 2);
  const edited = structuredClone(original);
  edited.name = 'Saved HTTP pilot sheet';
  edited.items[0].retailCents = 1599;
  edited.packages = [{ id: randomUUID(), name: 'HTTP mixed package', description: 'One 8x10 and two other prints', retailCents: 2999, items: edited.items.slice(0, 2).map((item, index) => ({ catalogProductId: item.catalogProductId, quantity: index + 1 })) }];
  edited.shipping = { mode: 'custom', feeCents: 825, title: 'Custom pilot shipping' };
  edited.terms = 'HTTP fixture persisted terms';
  edited.assignments = [{ kind: 'project', id: LAB_FIXTURE.project }];
  const saved = await call({ action: 'save', sheet: edited, expectedVersion: original.version });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const reloaded = (await call()).body.workspace.priceSheets.find(sheet => sheet.id === original.id);
  assert.equal(reloaded.name, edited.name);
  assert.equal(reloaded.items[0].retailCents, 1599);
  assert.deepEqual(reloaded.packages, edited.packages);
  assert.deepEqual(reloaded.shipping, edited.shipping);
  assert.deepEqual(reloaded.assignments, edited.assignments);
  assert.equal(reloaded.terms, edited.terms);
  assert.equal((await call({ action: 'save', sheet: edited, expectedVersion: original.version })).status, 409);
  assert.equal((await call({ action: 'duplicate', id: original.id, name: 'Foreign duplicate' }, LAB_FIXTURE.otherOwner)).status, 404);
  const foreignGallery = { ...reloaded, assignments: [{ kind: 'project', id: LAB_FIXTURE.otherProject }] };
  assert.equal((await call({ action: 'save', sheet: foreignGallery, expectedVersion: reloaded.version })).status, 403);
  const gtaDraft = await call({ action: 'create', labId: gta.id, name: 'Empty GTA pilot draft', starter: 'blank' });
  assert.equal(gtaDraft.status, 200);
  const blocked = await call({ action: 'publish', id: gtaDraft.body.sheet.id, expectedVersion: gtaDraft.body.sheet.version, assignments: edited.assignments });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'LAB_NOT_READY');
  const copy = await call({ action: 'duplicate', id: original.id, name: 'Pilot duplicate' });
  assert.equal(copy.status, 200);
  assert.deepEqual(copy.body.sheet.assignments, []);
  assert.equal(copy.body.sheet.status, 'draft');
  assert.equal((await call({ action: 'delete', id: copy.body.sheet.id, expectedVersion: copy.body.sheet.version })).status, 200);
  const final = (await call()).body.workspace.priceSheets.find(sheet => sheet.id === original.id);
  assert.equal(final.status, 'draft');
  assert.equal(final.publishedProfileId, null);
});
