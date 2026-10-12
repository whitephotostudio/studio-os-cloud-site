import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, id } from './helpers/event-gallery-harness.mjs';

const route = 'app/api/dashboard/schools/yearbook-sync/route.ts';
const user = id(700), owner = id(701), schoolId = id(702), localSchoolId = id(703), studentId = id(704);
const portrait = `schools/${localSchoolId}/Seniors/Jane/portrait.jpg`;

function fixture(options = {}) {
  let h;
  const calls = [], dbCalls = [], authCalls = [];
  let serviceCreations = 0, activeHeads = 0, maxActiveHeads = 0;
  const service = { from(table) {
    const filters = [], orders = [];
    let fields, cap = 1000, single = false;
    const record = { table, filters: [], fields: null, limit: null }; dbCalls.push(record);
    const q = {
      select(value) { fields = value; record.fields = value; return q; },
      eq(key, value) { filters.push(row => row[key] === value); record.filters.push(['eq', key, value]); return q; },
      in(key, values) { filters.push(row => values.includes(row[key])); record.filters.push(['in', key, values]); return q; },
      gt(key, value) { filters.push(row => row[key] > value); record.filters.push(['gt', key, value]); return q; },
      order(key) { orders.push(key); return q; },
      range(from, to) { filters.push((_row, index) => index >= from && index <= to); return q; },
      limit(value) { cap = Math.min(value, 1000); record.limit = value; return q; },
      maybeSingle() { single = true; return q; },
      then(resolve, reject) {
        if (options.failTable === table) return Promise.resolve({ data: null, error: { message: 'private fixture database detail' } }).then(resolve, reject);
        let rows = (h.tables[table] ?? []).filter((row, index) => filters.every(filter => filter(row, index)));
        rows.sort((a, b) => { for (const key of orders) { if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1; } return 0; });
        rows = rows.slice(0, cap).map(row => Object.fromEntries(fields.split(',').map(field => [field, row[field]])));
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
      },
    };
    return q;
  } };
  h = harness({ overrides: {
    '@/lib/dashboard-auth': {
      resolveDashboardAuth: async request => { authCalls.push(request.headers.get('authorization')); return { user: options.signedOut ? null : { id: user }, mfaSatisfied: options.mfa ?? true }; },
      createDashboardServiceClient: () => { serviceCreations++; return service; },
    },
    '@/lib/r2': { R2_BUCKET: 'fixture-private-bucket', getR2Client: () => ({ send: async command => {
      calls.push({ ...command.input }); activeHeads++; maxActiveHeads = Math.max(maxActiveHeads, activeHeads);
      try {
        await Promise.resolve();
        if (options.headOutage) throw { $metadata: { httpStatusCode: 503 } };
        if (options.missing?.has(command.input.Key)) throw { name: 'NotFound', $metadata: { httpStatusCode: 404 } };
        return { ContentLength: options.emptyObject ? 0 : 300 };
      } finally { activeHeads--; }
    } }) },
  } });
  h.tables.photographers = [{ id: owner, user_id: user, subscription_status: 'cancelled' }];
  h.tables.schools = [{ id: schoolId, photographer_id: owner, local_school_id: localSchoolId, school_name: 'Private School', portal_status: 'closed', status: 'closed', expiration_date: '2020-01-01' }];
  h.tables.students = [{ id: studentId, school_id: schoolId, external_student_id: 'desktop-student-704', pin: 'private-pin', class_name: 'Seniors', folder_name: 'Jane', photo_url: portrait, first_name: 'Do not return', parent_email: 'private@example.test' }];
  h.tables.school_yearbook_settings = [{ school_id: schoolId, enabled: false, deadline: '2020-01-01', revision: 3 }];
  h.tables.school_yearbook_selections = [{ school_id: schoolId, student_id: studentId, media_key: portrait, filename: 'portrait.jpg', source: 'parent', revision: 5, updated_at: '2026-10-08T18:00:00.000Z', viewer_email: 'private-parent@example.test' }];
  async function get(params = {}) {
    const response = await h.load(route).GET({ nextUrl: new URL(`https://fixture.test/api?${new URLSearchParams({ schoolId, ...params })}`), headers: new Headers({ authorization: 'Bearer fixture-desktop-access-token' }) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  return { ...h, get, calls, dbCalls, authCalls, serviceCreations: () => serviceCreations, maxActiveHeads: () => maxActiveHeads };
}

test('inactive owner reads saved parent choices after disabling selection and closing gallery', async () => {
  const h = fixture(), result = await h.get();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.body.schemaVersion, 1);
  assert.deepEqual(result.body.school, { id: schoolId, local_school_id: localSchoolId });
  assert.deepEqual(result.body.settings, { enabled: false, deadline: '2020-01-01', revision: 3 });
  const choice = result.body.selections[0];
  assert.equal(choice.student_id, studentId);
  assert.equal(choice.external_student_id, 'desktop-student-704');
  assert.equal(choice.pin, 'private-pin');
  assert.equal(choice.class_name, 'Seniors');
  assert.equal(choice.folder_name, 'Jane');
  assert.ok(choice.photo_folders.includes(`schools/${localSchoolId}/Seniors/Jane`));
  assert.equal(choice.media_key, portrait);
  assert.equal(choice.revision, 5);
  assert.equal(choice.source, 'parent');
  assert.equal(choice.available, true);
  assert.equal(result.body.nextAfter, null);
  assert.deepEqual(h.authCalls, ['Bearer fixture-desktop-access-token']);
  assert.deepEqual(h.calls, [{ Bucket: 'fixture-private-bucket', Key: portrait }]);
  assert.equal(h.writes.length, 0);
  const output = JSON.stringify(result.body);
  for (const privateValue of ['Do not return', 'private@example.test', 'private-parent@example.test', 'Private School', 'https://', 'viewer_email', 'first_name', 'parent_email']) assert.equal(output.includes(privateValue), false);
});

test('keyset pagination retrieves all 1005 saved choices beyond the provider row limit', async () => {
  const h = fixture();
  h.tables.students = []; h.tables.school_yearbook_selections = [];
  for (let n = 0; n < 1005; n++) {
    const sid = id(10000 + n), folder = `Student${n}`, key = `schools/${localSchoolId}/Seniors/${folder}/portrait.jpg`;
    h.tables.students.unshift({ id: sid, school_id: schoolId, external_student_id: `desktop-${n}`, pin: `PIN${n}`, class_name: 'Seniors', folder_name: folder, photo_url: key });
    h.tables.school_yearbook_selections.unshift({ school_id: schoolId, student_id: sid, media_key: key, filename: 'portrait.jpg', source: 'photographer', revision: n + 1, updated_at: '2026-10-08T18:00:00.000Z' });
  }
  const choices = []; let after, pages = 0;
  do {
    const result = await h.get({ limit: '100', ...(after ? { after } : {}) });
    assert.equal(result.status, 200); assert.ok(result.body.selections.length <= 100);
    choices.push(...result.body.selections); after = result.body.nextAfter; pages++;
  } while (after && pages < 12);
  assert.equal(pages, 11);
  assert.equal(after, null);
  assert.equal(choices.length, 1005);
  assert.equal(new Set(choices.map(row => row.student_id)).size, 1005);
  assert.equal(choices[1004].external_student_id, 'desktop-1004');
  assert.equal(choices.every(row => row.available), true);
  assert.ok(h.maxActiveHeads() <= 6);
  assert.ok(h.dbCalls.filter(row => row.table === 'school_yearbook_selections').every(row => row.limit === 101 && row.filters.some(filter => filter[1] === 'school_id' && filter[2] === schoolId)));
  assert.ok(h.dbCalls.filter(row => row.table === 'students').every(row => row.filters.some(filter => filter[1] === 'school_id' && filter[2] === schoolId)));
  assert.equal(h.writes.length, 0);
});

test('auth and MFA fail before service or object reads', async () => {
  for (const options of [{ signedOut: true }, { mfa: false }]) {
    const h = fixture(options), result = await h.get();
    assert.equal(result.status, options.signedOut ? 401 : 403);
    assert.equal(h.serviceCreations(), 0); assert.equal(h.dbCalls.length, 0); assert.equal(h.calls.length, 0);
  }
});

test('another studio school is hidden before selection, student or storage reads', async () => {
  const h = fixture(); h.tables.schools[0].photographer_id = id(999);
  const result = await h.get(); assert.equal(result.status, 404);
  assert.deepEqual(h.dbCalls.map(row => row.table), ['photographers', 'schools']);
  assert.equal(h.calls.length, 0);
});

for (const params of [{ schoolId: 'bad' }, { after: 'bad' }, { after: '' }, { limit: '0' }, { limit: '101' }, { limit: '-1' }, { limit: '1.5' }, { limit: '10000000000000000000000' }]) test(`invalid sync parameters rejected: ${JSON.stringify(params)}`, async () => {
  const h = fixture(); assert.equal((await h.get(params)).status, 400);
  assert.equal(h.serviceCreations(), 0); assert.equal(h.calls.length, 0);
});

test('moved student cannot disclose its identity and does not stall page cursor', async () => {
  const h = fixture(); h.tables.students[0].school_id = id(999);
  h.tables.school_yearbook_selections.push({ ...h.tables.school_yearbook_selections[0], student_id: id(705) });
  const result = await h.get({ limit: '1' });
  assert.equal(result.status, 200); assert.deepEqual(result.body.selections, []);
  assert.equal(result.body.nextAfter, studentId); assert.equal(h.calls.length, 0);
});

for (const [name, key] of [
  ['foreign school', `schools/${id(999)}/Seniors/Jane/portrait.jpg`],
  ['sibling folder', `schools/${localSchoolId}/Seniors/John/portrait.jpg`],
  ['nested folder', `schools/${localSchoolId}/Seniors/Jane/nested/portrait.jpg`],
  ['derived preview', portrait.replace('.jpg', '_preview.jpg')],
]) test(`${name} choice unavailable without a storage read`, async () => {
  const h = fixture(); h.tables.school_yearbook_selections[0].media_key = key;
  const result = await h.get(); assert.equal(result.status, 200);
  assert.equal(result.body.selections[0].available, false); assert.equal(h.calls.length, 0);
});

test('fresh tombstone blocks a formerly valid selected original', async () => {
  const h = fixture(); assert.equal((await h.get()).body.selections[0].available, true);
  h.tables.school_photo_deletions.push({ school_id: schoolId, storage_family: 'Seniors/Jane/portrait', storage_key: portrait });
  const result = await h.get(); assert.equal(result.status, 200); assert.equal(result.body.selections[0].available, false);
  assert.equal(h.calls.length, 1);
});

test('missing and empty objects are unavailable; provider outages fail closed without partial results', async () => {
  for (const options of [{ missing: new Set([portrait]) }, { emptyObject: true }]) {
    const h = fixture(options), result = await h.get(); assert.equal(result.status, 200); assert.equal(result.body.selections[0].available, false);
  }
  const unavailable = fixture({ headOutage: true }), result = await unavailable.get();
  assert.equal(result.status, 503); assert.equal(result.body.ok, false); assert.equal('selections' in result.body, false);
});

test('database failure does not masquerade as empty choices or expose provider details', async () => {
  const h = fixture({ failTable: 'school_yearbook_selections' }), result = await h.get();
  assert.equal(result.status, 503); assert.equal(result.body.ok, false); assert.equal('selections' in result.body, false);
  assert.equal(JSON.stringify(result.body).includes('private fixture database detail'), false);
});

test('repeat full pull returns the revised original choice rather than a cached earlier pose', async () => {
  const h = fixture(), first = await h.get();
  const revisedKey = portrait.replace('portrait.jpg', 'second-pose.jpg');
  Object.assign(h.tables.school_yearbook_selections[0], { media_key: revisedKey, filename: 'second-pose.jpg', revision: 6, updated_at: '2026-10-08T19:00:00.000Z' });
  const second = await h.get();
  assert.equal(first.body.selections[0].revision, 5);
  assert.equal(second.body.selections[0].revision, 6);
  assert.equal(second.body.selections[0].media_key, revisedKey);
  assert.equal(second.body.selections[0].available, true);
  assert.equal(h.writes.length, 0);
});

test('school without settings or choices returns disabled defaults with no object reads', async () => {
  const h = fixture(); h.tables.school_yearbook_settings = []; h.tables.school_yearbook_selections = [];
  const result = await h.get();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.settings, { enabled: false, deadline: null, revision: 0 });
  assert.deepEqual(result.body.selections, []);
  assert.equal(result.body.nextAfter, null);
  assert.equal(h.calls.length, 0);
});
