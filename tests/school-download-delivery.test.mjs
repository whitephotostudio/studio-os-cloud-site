import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { harness, projectId as schoolId, id } from './helpers/event-gallery-harness.mjs';

const studioId = id(800), studentId = id(801), classId = id(802);
const keys = Array.from({ length: 8 }, (_, index) => `schools/${schoolId}/Grade A/Student A/photo-${index + 1}.jpg`);
const foreign = `schools/${schoolId}/Grade B/Student B/foreign.jpg`;
const original = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#386598' } }).jpeg().toBuffer();
const route = 'app/api/portal/school-downloads/route.ts';

function fixture({ portalStatus = 'active', status = 'active', extras = {} } = {}) {
  const h = harness({
    folderFiles: [...keys, foreign].map(key => ({ key, name: key.split('/').pop(), url: `https://fixture.test/${key}` })),
    fetchImage: async () => new Response(original, { headers: { 'content-type': 'image/jpeg' } }),
  });
  const school = {
    id: schoolId, school_name: 'School', photographer_id: studioId, local_school_id: null,
    status, portal_status: portalStatus, expiration_date: null,
    gallery_settings: { extras: {
      freeDigitalRuleEnabled: true, showDownloadAllButton: true, freeDigitalAudience: 'gallery',
      freeDigitalDownloadLimit: 'unlimited', freeDigitalResolution: 'original', watermarkDownloads: false,
      allowClientFavoriteDownloads: true, favoriteDownloadsRequireAllDigitalsPurchase: true, ...extras,
    } },
  };
  h.tables.schools.push(school);
  h.tables.photographers.push({ id: studioId, subscription_status: 'active', watermark_enabled: true });
  h.tables.students.push({ id: studentId, school_id: schoolId, pin: '12345', photo_url: keys[0], class_id: classId, class_name: 'Grade A', folder_name: 'Student A' });

  // Supabase returns only SELECTed columns. The shared harness normally keeps
  // whole fixture rows, which conceals missing fields in signed access grants.
  const from = h.service.from.bind(h.service);
  h.service.from = table => {
    const query = from(table);
    if (table !== 'schools') return query;
    let columns;
    const project = row => row && columns ? Object.fromEntries(columns.map(column => [column, row[column] ?? null])) : row;
    const proxy = new Proxy(query, {
      get(target, property) {
        if (property === 'select') return selection => {
          columns = selection.split(',').map(column => column.trim());
          target.select(selection);
          return proxy;
        };
        if (property === 'then') return (resolve, reject) => target.then(result => resolve({
          ...result, data: Array.isArray(result.data) ? result.data.map(project) : project(result.data),
        }), reject);
        const value = Reflect.get(target, property);
        if (typeof value !== 'function') return value;
        return (...args) => {
          const result = value.apply(target, args);
          return result === target ? proxy : result;
        };
      },
    });
    return proxy;
  };
  const body = overrides => ({ schoolId, email: 'parent@example.test', pin: '12345', mediaIds: keys, ...overrides });
  return { ...h, school, body };
}

test('school Download All signs and delivers all eight requested originals with a non-null portal status', async () => {
  const h = fixture();
  const prepared = await h.post(route, h.body({ mediaIds: [...keys, keys[0], foreign] }));
  assert.equal(prepared.status, 200);
  assert.deepEqual(prepared.body.allowedMediaIds, keys);
  assert.equal(prepared.body.deliveries.length, 8);
  assert.equal(h.writes.at(-1).value.download_count, 8);
  for (const delivery of prepared.body.deliveries) {
    assert.match(delivery.url, /^\/api\/portal\/school-download-file\?token=/);
    const downloaded = await h.get(delivery.url);
    assert.equal(downloaded.status, 200, delivery.mediaId);
    assert.deepEqual(downloaded.body, original);
    assert.match(downloaded.headers.get('content-disposition'), /attachment/);
  }
  assert.equal(h.fetched.length, 8);
});

test('school preparation preserves an explicit one-photo request rather than expanding its gallery scope', async () => {
  const h = fixture();
  const prepared = await h.post(route, h.body({ mediaIds: [keys[0]] }));
  assert.equal(prepared.status, 200);
  assert.deepEqual(prepared.body.allowedMediaIds, [keys[0]]);
  assert.equal(prepared.body.deliveries.length, 1);
  assert.equal(h.writes.at(-1).value.download_count, 1);
});

test('closed, inactive and pre-release school galleries reject preparation before consuming download quota', async () => {
  for (const portalStatus of ['closed', 'inactive', 'pre_release']) {
    const h = fixture({ portalStatus });
    const prepared = await h.post(route, h.body());
    assert.equal(prepared.status, 409, portalStatus);
    assert.equal(h.writes.length, 0, portalStatus);
    assert.equal(h.fetched.length, 0, portalStatus);
  }
  const legacy = fixture({ portalStatus: null, status: 'pre_release' });
  assert.equal((await legacy.post(route, legacy.body())).status, 409);
  assert.equal(legacy.writes.length, 0);
});

test('a portal-status change revokes prepared school delivery and paid favorites remain locked', async () => {
  const h = fixture();
  const prepared = await h.post(route, h.body());
  assert.equal(prepared.status, 200);
  h.school.portal_status = 'closed';
  assert.equal((await h.get(prepared.body.deliveries[0].url)).status, 403);
  assert.equal(h.fetched.length, 0);

  const paid = fixture({ extras: { freeDigitalRuleEnabled: false } });
  const favorites = await paid.post(route, paid.body({ downloadType: 'favorites' }));
  assert.equal(favorites.status, 403);
  assert.equal(paid.writes.length, 0);
  assert.equal(paid.fetched.length, 0);
});
