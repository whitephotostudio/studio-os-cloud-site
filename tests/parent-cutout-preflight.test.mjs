import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import sharp from 'sharp';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const schoolId = '10000000-0000-4000-8000-000000000001';
const photographerId = '20000000-0000-4000-8000-000000000001';
const projectId = '40000000-0000-4000-8000-000000000001';
const backdropId = '50000000-0000-4000-8000-000000000001';
const folder = pin => `${schoolId}/Class/Student${pin}`;
const original = (name = 'pose.JPG', pin = '12345') => `${folder(pin)}/${name}`;
const fullCutout = key => `nobg-photos/${key}.png`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const png = await sharp(Buffer.from([120, 80, 40, 255, 120, 80, 40, 0]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
const opaque = await sharp({ create: { width: 2, height: 1, channels: 4, background: { r: 120, g: 80, b: 40, alpha: 1 } } }).png().toBuffer();
const empty = await sharp({ create: { width: 2, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
const print = { id: '30000000-0000-4000-8000-000000000001', name: '5x7 Print', category: 'print', price_cents: 1000, photographer_id: photographerId, active: true };
const digital = { ...print, id: '30000000-0000-4000-8000-000000000002', name: 'Digital image', category: 'digital' };
const allDigital = { ...digital, id: '30000000-0000-4000-8000-000000000003', name: 'All Digital Package' };
const retouch = { ...print, id: '30000000-0000-4000-8000-000000000004', name: 'Retouching - 1 Image', category: 'specialty' };
const mixedPrint = { ...print, id: '30000000-0000-4000-8000-000000000005', name: 'Complete Gallery', items: ['5x7 Print', 'Digital file'] };
const createPath = 'app/api/portal/orders/create/route.ts';
const combinedPath = 'app/api/portal/orders/create-combined/route.ts';
const common = { parent: { name: 'Test parent', email: 'parent@example.test' }, delivery: { method: 'pickup' } };
const entry = (pkg = print, refs = [original()], extra = {}) => ({ packageId: pkg.id, quantity: 1, backdrop: { id: backdropId }, slots: refs.map(assignedImageUrl => ({ label: pkg.name, assignedImageUrl })), ...extra });
const schoolBody = entries => ({ ...common, mode: 'school', pin: '12345', schoolId, entries });
const group = (entries, pin = '12345') => ({ schoolId, pin, email: 'parent@example.test', entries });

function loader(stubs) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const js = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    vm.runInNewContext(js, {
      exports, URL, URLSearchParams, Response, Request, Buffer, console, crypto: globalThis.crypto,
      // Synthetic credentials exercise the real pure signer/gallery resolver;
      // no runtime/production environment is read and network stays forbidden.
      process: { env: { R2_ACCOUNT_ID: 'fixture', R2_ACCESS_KEY_ID: 'fixture', R2_SECRET_ACCESS_KEY: 'fixture' } },
      fetch() { throw new Error('Network is forbidden in isolated checkout tests'); },
      require(name) {
        if (name in stubs) return stubs[name];
        if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
        if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts');
        return require(name);
      },
    }, { filename: file });
    return exports;
  }
  return load;
}

function setup({ originals = [original()], paidKeys = originals.map(fullCutout), bytes = png, storedBytes = bytes, tombstones = [], media = [], collectionPin = '12345', projectOwner = photographerId, repeatMediaPages = false, localSchoolId = null, mediaPageCap = 1000, mediaCountUnavailable = false, billingCurrency = null } = {}) {
  const writes = [], paidReads = [], proofQueries = [], folderReads = [], mediaPages = [];
  const bindings = paidKeys.map(object_key => ({ object_key, original_sha256: 'a'.repeat(64), cutout_sha256: hash(bytes) }));
  const sb = {
    async rpc(name, args) {
      if (name === 'authorized_credit_cutout_keys') { proofQueries.push(args); return { data: args.p_photographer_id === photographerId ? bindings.filter(row => args.p_keys.includes(row.object_key)) : [], error: null }; }
      if (name === 'create_checkout_order_once') { writes.push({ table: 'orders', value: args.p_orders }, { table: 'order_items', value: args.p_items }); return { data: args.p_response, error: null }; }
      throw new Error(`Unexpected mutation/RPC ${name}`);
    },
    from(table) {
      const filters = []; let single = false, inserted, updated, range, limit;
      const q = {
        select() { return q; },
        eq(key, value) { filters.push(row => row[key] === value); return q; },
        in(key, values) { filters.push(row => values.includes(row[key])); return q; },
        gte(key, value) { filters.push(row => row[key] >= value); return q; },
        order() { return q; },
        range(from, to) { range = [from, to]; if (table === 'media') mediaPages.push(range); return q; },
        limit(value) { limit = value; return q; },
        maybeSingle() { single = true; return q; }, single() { single = true; return q; },
        insert(value) { inserted = value; writes.push({ table, value }); return q; },
        update(value) { updated = value; writes.push({ table, value }); return q; },
        delete() { writes.push({ table, delete: true }); return q; },
        then(resolve, reject) {
          let rows = table === 'packages' ? [print, digital, allDigital, retouch, mixedPrint]
            : table === 'backdrop_catalog' ? [{ id: backdropId, name: 'Blue', image_url: 'backdrops/blue.jpg', tier: 'premium', price_cents: 250, photographer_id: photographerId, active: true }]
            : table === 'schools' ? [{ id: schoolId, local_school_id: localSchoolId, photographer_id: photographerId }]
            : table === 'students' ? ['12345', '67890'].map(pin => ({ id: `student-${pin}`, pin, school_id: schoolId, class_id: null, class_name: 'Class', folder_name: `Student${pin}`, photo_url: original('pose.JPG', pin) }))
            : table === 'photographers' ? [{ id: photographerId, subscription_status: 'active', billing_currency: billingCurrency }]
            : table === 'projects' ? [{ id: projectId, photographer_id: projectOwner, workflow_type: 'event', status: 'active', access_mode: 'pin', access_pin: 'project-pin' }]
            : table === 'collections' ? [{ id: 'collection-a', project_id: projectId, kind: 'album', slug: collectionPin, access_mode: 'pin', access_pin: collectionPin }, { id: 'collection-b', project_id: projectId, kind: 'album', slug: 'other-pin', access_mode: 'pin', access_pin: 'other-pin' }]
            : table === 'media' ? media
            : table === 'school_photo_deletions' ? tombstones : [];
          rows = rows.filter(row => filters.every(f => f(row)));
          const count = table === 'media' && !mediaCountUnavailable ? rows.length : null;
          if (range) rows = rows.slice(repeatMediaPages && table === 'media' ? 0 : range[0], repeatMediaPages && table === 'media' ? range[1] - range[0] + 1 : range[1] + 1);
          if (range && table === 'media') rows = rows.slice(0, mediaPageCap);
          if (limit) rows = rows.slice(0, limit);
          if (inserted) rows = [{ id: `new-order-${writes.length}` }]; else if (updated) rows = [];
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, count, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const load = loader({
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => sb },
    '@/lib/event-gallery-access': { validateEventGalleryAccess: async () => ({ ok: true, projectId, collectionIds: ['collection-a'], service: sb, project: { photographer_id: photographerId } }) },
    '@/lib/event-gallery-settings': { normalizeEventGallerySettings: () => ({ extras: { shippingEnabled: false, pickupEnabled: true } }) },
    '@/lib/rate-limit': { rateLimit: async () => ({ allowed: true }), getClientIp: () => 'fixture' },
    '@/lib/subscription-gate': { hasActiveSubscription: () => true },
    '@/lib/r2': {
      listR2FolderImages: async prefix => { folderReads.push(prefix); return originals.filter(key => key.startsWith(`${prefix}/`)).map(key => ({ key, name: key.split('/').at(-1), url: key })); },
      r2Download: async (key, options) => { paidReads.push({ key, options }); if (!paidKeys.includes(key)) throw new Error('Missing fixture output'); return storedBytes; },
    },
  });
  return { writes, paidReads, proofQueries, folderReads, mediaPages, async post(route, body) {
    const response = await load(route).POST(new Request('https://gallery.example.test/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  }, preflight: (context, entries) => load('lib/parent-cutout-preflight.ts').assertParentBackdropCutouts(sb, context, entries) };
}

test('single and combined creation freeze the trusted studio sales currency and ignore a forged client currency', async () => {
  for (const billingCurrency of ['usd', 'cad', 'eur', 'gbp', 'aud', 'aed', 'sar', 'amd']) {
    for (const route of [createPath, combinedPath]) {
      const h = setup({ billingCurrency });
      const body = route === createPath ? schoolBody([entry()]) : { ...common, groups: [group([entry()])] };
      const result = await h.post(route, { ...body, currency: billingCurrency === 'usd' ? 'cad' : 'usd' });
      assert.equal(result.status, 200, `${route} ${billingCurrency}: ${JSON.stringify(result.body)}`);
      const rows = h.writes.find(w => w.table === 'orders').value;
      assert.ok(rows.length > 0);
      assert.ok(rows.every(row => row.currency === billingCurrency));
      assert.equal(rows[0].subtotal_cents, 1250, 'the currency change does not convert or change saved package prices');
    }
  }
});

test('unset studio currency keeps CAD while unsupported decimal conventions block creation before writes', async () => {
  for (const route of [createPath, combinedPath]) {
    const body = route === createPath ? schoolBody([entry()]) : { ...common, groups: [group([entry()])] };
    const legacy = setup();
    assert.equal((await legacy.post(route, body)).status, 200);
    assert.equal(legacy.writes.find(w => w.table === 'orders').value[0].currency, 'cad');
    for (const billingCurrency of ['jpy', 'bhd', 'unsupported']) {
      const h = setup({ billingCurrency });
      const result = await h.post(route, body);
      assert.equal(result.status, 409);
      assert.match(result.body.message, /sales currency is not supported/);
      assert.equal(h.writes.length, 0);
    }
  }
});

test('missing or inactive proof rejects the chosen backdrop before order writes', async () => {
  const h = setup({ paidKeys: [] });
  assert.equal((await h.post(createPath, schoolBody([entry()]))).status, 409);
  assert.equal(h.writes.length, 0); assert.equal(h.paidReads.length, 0);
});

test('actual stored bytes must match the paid binding, not merely an existing filename', async () => {
  const h = setup({ storedBytes: opaque });
  assert.equal((await h.post(createPath, schoolBody([entry()]))).status, 409);
  assert.equal(h.writes.length, 0); assert.equal(h.paidReads.length, 1);
  assert.equal(h.paidReads[0].options.maxBytes, 25 * 1024 * 1024);
});

for (const [name, bytes] of [['opaque', opaque], ['empty', empty], ['invalid', Buffer.from('not PNG')]]) test(`${name} paid output is unusable and cannot create a background order`, async () => {
  const h = setup({ bytes });
  assert.equal((await h.post(createPath, schoolBody([entry()]))).status, 409);
  assert.equal(h.writes.length, 0);
});

test('all physical poses require paid bytes; valid multi-pose pricing is unchanged', async () => {
  const second = original('pose2.JPG');
  const denied = setup({ originals: [original(), second], paidKeys: [fullCutout(original())] });
  assert.equal((await denied.post(createPath, schoolBody([entry(print, [original(), second])]))).status, 409);
  assert.equal(denied.writes.length, 0);
  const accepted = setup({ originals: [original(), second] });
  assert.equal((await accepted.post(createPath, schoolBody([entry(print, [original(), second])]))).status, 200);
  assert.equal(accepted.paidReads.length, 2);
  assert.equal(accepted.writes.find(w => w.table === 'orders').value[0].subtotal_cents, 1250);
});

for (const ref of [original('pose.JPG', '67890'), 'https://untrusted.example/pose.JPG']) test(`a forged reference cannot select another gallery photo: ${ref}`, async () => {
  const h = setup({ originals: [original(), original('pose.JPG', '67890')] });
  assert.equal((await h.post(createPath, schoolBody([entry(print, [ref])]))).status, 409);
  assert.equal(h.writes.length, 0); assert.equal(h.paidReads.length, 0);
});

test('tombstoned originals are ineligible even while old paid files remain', async () => {
  const h = setup({ tombstones: [{ id: 'deleted', school_id: schoolId, storage_key: original(), storage_family: 'Class/Student12345/pose' }] });
  assert.equal((await h.post(createPath, schoolBody([entry()]))).status, 409);
  assert.equal(h.writes.length, 0);
});

test('original-background and stripped retouch lines remain available without cutout proof', async () => {
  const h = setup({ paidKeys: [] });
  assert.equal((await h.post(createPath, schoolBody([entry(print, [original()], { backdrop: null })]))).status, 200);
  assert.equal(h.proofQueries.length, 0); assert.equal(h.paidReads.length, 0); assert.ok(h.folderReads.every(prefix => prefix.includes("Student12345")), "Original choices are checked against current student folders");
  const retouchOnly = setup({ paidKeys: [] });
  const result = await retouchOnly.post(createPath, schoolBody([
    entry(print, [original()], { backdrop: null }),
    entry(retouch, [original()], { retouchSelections: [{ imageUrl: original(), notes: 'Skin only' }] }),
  ]));
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(retouchOnly.proofQueries.length, 0);
});

test('normal digital backgrounds require paid selected photos, including media-id URL agreement', async () => {
  const denied = setup({ paidKeys: [] });
  assert.equal((await denied.post(createPath, schoolBody([entry(digital)]))).status, 409);
  const mismatched = setup({ originals: [original(), original('pose2.JPG')] });
  const result = await mismatched.post(createPath, schoolBody([entry(digital, [], { digitalSelections: [{ mediaId: original(), url: original('pose2.JPG') }] })]));
  assert.equal(result.status, 409); assert.equal(mismatched.writes.length, 0);
  const allowed = setup();
  assert.equal((await allowed.post(createPath, schoolBody([entry(digital)]))).status, 200);
  assert.equal(allowed.writes.find(w => w.table === 'orders').value[0].subtotal_cents, 1250);
});

test('an owned digital media ID cannot persist a foreign thumbnail fallback', async () => {
  const foreign = original('pose.JPG', '67890');
  for (const url of [null, original()]) {
    const h = setup({ originals: [original(), foreign] });
    const result = await h.post(createPath, schoolBody([entry(digital, [], {
      digitalSelections: [{ mediaId: original(), url, thumbnailUrl: foreign }],
    })]));
    assert.equal(result.status, 409); assert.equal(h.writes.length, 0);
    assert.equal(h.paidReads.length, 0); assert.equal(h.proofQueries.length, 0);
  }
  const missing = setup();
  assert.equal((await missing.post(createPath, schoolBody([entry(digital, [], { digitalSelections: [{ mediaId: original() }] })]))).status, 409);
  assert.equal(missing.writes.length, 0);
  const allowed = setup();
  assert.equal((await allowed.post(createPath, schoolBody([entry(digital, [], { digitalSelections: [{ mediaId: original(), thumbnailUrl: original() }] })]))).status, 200);
});

test('all-digitals checks every original, including poses omitted by the client', async () => {
  const denied = setup({ originals: [original(), original('hidden.JPG')], paidKeys: [fullCutout(original())] });
  assert.equal((await denied.post(createPath, schoolBody([entry(allDigital, [])]))).status, 409);
  assert.equal(denied.writes.length, 0);
  const allowed = setup({ originals: Array.from({ length: 101 }, (_, i) => original(`pose${i}.JPG`)) });
  assert.equal((await allowed.post(createPath, schoolBody([entry(allDigital, [])]))).status, 200);
  assert.equal(allowed.paidReads.length, 101);
});

test('same-stem JPG and PNG cannot share an ambiguous cutout; full-filename proof is precise', async () => {
  const jpg = original('same.JPG'), imagePng = original('same.PNG');
  const shared = `nobg-photos/${folder('12345')}/same.png`;
  const denied = setup({ originals: [jpg, imagePng], paidKeys: [shared] });
  assert.equal((await denied.post(createPath, schoolBody([entry(print, [imagePng])]))).status, 409);
  assert.ok(denied.proofQueries.every(q => !q.p_keys.includes(shared)));
  const wrongExact = setup({ originals: [jpg, imagePng], paidKeys: [fullCutout(jpg)] });
  assert.equal((await wrongExact.post(createPath, schoolBody([entry(print, [imagePng])]))).status, 409);
  const allowed = setup({ originals: [jpg, imagePng], paidKeys: [fullCutout(imagePng)] });
  assert.equal((await allowed.post(createPath, schoolBody([entry(print, [imagePng])]))).status, 200);
  assert.equal(allowed.paidReads[0].key, fullCutout(imagePng));
});

test('all-digitals mirrors visible gallery families without requiring a hidden local-id alias', async () => {
  const hidden = 'local-school/Class/Student12345/pose.JPG';
  const h = setup({ originals: [original(), hidden], localSchoolId: 'local-school', paidKeys: [fullCutout(original())] });
  assert.equal((await h.post(createPath, schoolBody([entry(allDigital, [])]))).status, 200);
  assert.deepEqual(h.paidReads.map(row => row.key), [fullCutout(original())]);
  const selectedHidden = setup({ originals: [original(), hidden], localSchoolId: 'local-school', paidKeys: [fullCutout(original())] });
  assert.equal((await selectedHidden.post(createPath, schoolBody([entry(print, [hidden])]))).status, 409);
  assert.equal(selectedHidden.writes.length, 0);
});

test('combined checkout preflights every sibling before the first order write', async () => {
  const keys = [original(), original('pose.JPG', '67890')];
  const body = { ...common, groups: [group([entry()]), group([entry(print, [keys[1]])], '67890')] };
  const denied = setup({ originals: keys, paidKeys: [fullCutout(keys[0])] });
  assert.equal((await denied.post(combinedPath, body)).status, 409); assert.equal(denied.writes.length, 0);
  const allowed = setup({ originals: keys });
  const result = await allowed.post(combinedPath, body);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(allowed.writes.find(w => w.table === 'orders').value.length, 2);
});

test('combined physical gallery-named package with a digital item checks its chosen pose only', async () => {
  const h = setup({ originals: [original(), original('hidden.JPG')], paidKeys: [fullCutout(original())] });
  const result = await h.post(combinedPath, { ...common, groups: [group([entry(mixedPrint)])] });
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(h.paidReads.length, 1);
});

test('combined normal and all-digital backgrounds require every applicable paid pose', async () => {
  for (const pkg of [digital, allDigital]) {
    const h = setup({ originals: [original(), original('hidden.JPG')], paidKeys: pkg === digital ? [] : [fullCutout(original())] });
    const result = await h.post(combinedPath, { ...common, groups: [group([entry(pkg, pkg === allDigital ? [] : [original()])])] });
    assert.equal(result.status, 409); assert.equal(h.writes.length, 0);
  }
  const h = setup({ paidKeys: [] });
  const result = await h.post(combinedPath, { ...common, groups: [group([
    entry(print, [original()], { backdrop: null }),
    entry(retouch, [original()], { retouchSelections: [{ imageUrl: original(), notes: 'Skin only' }] }),
  ])] });
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(h.proofQueries.length, 0);
});

const eventPhoto = (id, collection_id = 'collection-a') => ({ id, project_id: projectId, collection_id, storage_path: `projects/${projectId}/${collection_id}/${id}.JPG` });
const eventBody = entries => ({ ...common, mode: 'event', projectId, email: common.parent.email, pin: '12345', entries });

test('event collection PIN cannot select another collection, even with owned paid proof', async () => {
  const a = eventPhoto('photo-a'), b = eventPhoto('photo-b', 'collection-b');
  const h = setup({ media: [a, b], paidKeys: [fullCutout(a.storage_path), fullCutout(b.storage_path)] });
  assert.equal((await h.post(createPath, eventBody([entry(digital, [], { digitalSelections: [{ mediaId: b.id, url: b.storage_path }] })]))).status, 400);
  assert.equal(h.writes.length, 0); assert.equal(h.paidReads.length, 0);
  const allowed = setup({ media: [a, b], paidKeys: [fullCutout(a.storage_path)] });
  assert.equal((await allowed.post(createPath, eventBody([entry(print, [a.storage_path])]))).status, 200);
});

test('event raw sources with null derivative columns accept the server-generated display/download references', async () => {
  const row = { ...eventPhoto('photo-a'), storage_path: `projects/${projectId}/collection-a/photo-a.jpg`, preview_url: null, thumbnail_url: null };
  const stem = row.storage_path.slice(0, -4);
  const proxy = key => `/api/r2/img/${key}`;
  for (const ref of [proxy(`${stem}_preview.jpg`), proxy(`${stem}_thumbnail.jpg`), proxy(`${stem}.jpg`)]) {
    const h = setup({ media: [row], paidKeys: [fullCutout(row.storage_path)] });
    const result = await h.post(createPath, eventBody([entry(print, [ref])]));
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(h.paidReads[0].key, fullCutout(row.storage_path));
  }
  const h = setup({ media: [row], paidKeys: [fullCutout(row.storage_path)] });
  const result = await h.post(createPath, eventBody([entry(digital, [], { digitalSelections: [{ mediaId: row.id,
    url: proxy(`${stem}_preview.jpg`), thumbnailUrl: proxy(`${stem}_thumbnail.jpg`) }] })]));
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(h.paidReads[0].key, fullCutout(row.storage_path));
  const denied = setup({ media: [row], paidKeys: [fullCutout(row.storage_path)] });
  assert.equal((await denied.post(createPath, eventBody([entry(print, [proxy(`projects/${projectId}/collection-b/photo-a_preview.jpg`)])]))).status, 409);
  assert.equal(denied.writes.length, 0);
});

test('event preflight rechecks current project owner and PIN rather than trusting stale route access', async () => {
  const a = eventPhoto('photo-a');
  for (const opts of [{ projectOwner: 'different-owner' }, { collectionPin: 'changed-pin' }]) {
    const h = setup({ ...opts, media: [a], paidKeys: [fullCutout(a.storage_path)] });
    assert.equal((await h.post(createPath, eventBody([entry(print, [a.storage_path])]))).status, 409);
    assert.equal(h.writes.length, 0);
  }
});

test('event all-gallery preflight paginates beyond a full page and rejects missing final pose', async () => {
  const media = Array.from({ length: 1001 }, (_, i) => eventPhoto(`photo-${String(i).padStart(4, '0')}`));
  const h = setup({ media, paidKeys: media.slice(0, 1000).map(row => fullCutout(row.storage_path)) });
  assert.equal((await h.post(createPath, eventBody([entry(allDigital, [])]))).status, 409);
  assert.deepEqual(h.mediaPages, [[0, 999], [1000, 1999]]);
  assert.equal(h.writes.length, 0); assert.equal(h.paidReads.length, 1000);
});

test('an ignored pagination offset cannot silently approve an incomplete event gallery', async () => {
  const media = Array.from({ length: 1001 }, (_, i) => eventPhoto(`photo-${i}`));
  const h = setup({ media, repeatMediaPages: true, paidKeys: [] });
  assert.equal((await h.post(createPath, eventBody([entry(allDigital, [])]))).status, 409);
  assert.equal(h.writes.length, 0); assert.equal(h.proofQueries.length, 0);
});

test('a lower database response cap still checks the complete gallery, and unknown count fails closed', async () => {
  const media = Array.from({ length: 3 }, (_, i) => eventPhoto(`photo-${i}`));
  const h = setup({ media, mediaPageCap: 2, paidKeys: media.slice(0, 2).map(row => fullCutout(row.storage_path)) });
  assert.equal((await h.post(createPath, eventBody([entry(allDigital, [])]))).status, 409);
  assert.deepEqual(h.mediaPages, [[0, 999], [2, 1001]]); assert.equal(h.writes.length, 0);
  const unknown = setup({ media, mediaCountUnavailable: true });
  assert.equal((await unknown.post(createPath, eventBody([entry(allDigital, [])]))).status, 409);
  assert.equal(unknown.paidReads.length, 0); assert.equal(unknown.writes.length, 0);
});
