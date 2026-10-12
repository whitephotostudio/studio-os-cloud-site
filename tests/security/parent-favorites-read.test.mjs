import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { before, after, beforeEach } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { harness, projectId, a, b, id } from '../helpers/event-gallery-harness.mjs';
import { localPinBudgetRedis } from '../helpers/pin-budget-redis.mjs';

const schoolId = id(50), studentId = id(51), email = 'viewer@example.test', pin = 'project-pin';
const credentials = kind => ({ [kind === 'school' ? 'schoolId' : 'projectId']: kind === 'school' ? schoolId : projectId, email, pin });
const route = kind => `app/api/portal/${kind}-favorites/route.ts`;
const viewerKey = gallery => createHash('sha256').update(`${gallery}::${email}::${pin}`).digest('hex');
const require = createRequire(import.meta.url);
let redis, fixtureNumber = 0;
before(async () => { redis = await localPinBudgetRedis(); });
after(async () => { await redis?.close(); });
beforeEach(async () => {
  const within = Date.now() % 60000;
  if (within > 50000) await new Promise(resolve => setTimeout(resolve, 60005 - within));
});

function fixture({ outage = false, deniedToggle = false, favoriteError = null } = {}) {
  const limits = [], counters = [], actionCounters = new Map(), folderReads = [], ip = `synthetic-favorites-${++fixtureNumber}`;
  let h;
  h = harness({ overrides: {
    '@/lib/rate-limit': {
      getClientIp: () => ip,
      rateLimit: async (key, config) => {
        limits.push(config);
        const bucket = `${key}:${config.namespace}`, count = (actionCounters.get(bucket) || 0) + 1;
        actionCounters.set(bucket, count);
        return { allowed: !deniedToggle && count <= config.limit, resetAt: Date.now() + config.windowSeconds * 1000 };
      },
    },
    '@/lib/storage-folder': {
      buildSchoolCandidateFolders: input => {
        assert.equal(input.activeSchool.id, schoolId);
        assert.equal(input.selectedSchoolId, schoolId);
        assert.deepEqual(Array.from(input.studentCandidates, row => row.id), [studentId]);
        return ['synthetic-student-folder'];
      },
      loadFolderMediaRows: async (folders, input) => {
        assert.deepEqual(folders, ['synthetic-student-folder']);
        assert.equal(input.schoolId, schoolId);
        assert.equal(input.service, h.service);
        folderReads.push(input.schoolId);
        return [{ id: a }];
      },
    },
  } });
  h.tables.schools.push({ id: schoolId, school_name: 'Synthetic school', status: 'active', expiration_date: null });
  h.tables.students.push({ id: studentId, school_id: schoolId, pin, folder_name: 'synthetic-student-folder' });
  h.tables.school_gallery_favorites = [
    { school_id: schoolId, media_id: a, viewer_key: viewerKey(schoolId) },
    { school_id: schoolId, media_id: b, viewer_key: viewerKey(schoolId) },
    { school_id: schoolId, media_id: id(99), viewer_key: 'different-viewer' },
  ];
  h.tables.event_gallery_favorites = [
    { project_id: projectId, media_id: a, viewer_key: viewerKey(projectId) },
    { project_id: projectId, media_id: b, viewer_key: viewerKey(projectId) },
    { project_id: projectId, media_id: id(99), viewer_key: 'different-viewer' },
  ];
  const from = h.service.from;
  h.service.from = table => {
    const query = from(table);
    query.delete = () => { h.writes.push({ table, operation: 'delete' }); return query; };
    if (favoriteError && table.endsWith('_gallery_favorites')) {
      query.then = (resolve, reject) => Promise.resolve({ data: null, error: favoriteError }).then(resolve, reject);
    }
    return query;
  };
  const budget = {};
  class SharedRedis {
    constructor(config) { assert.equal(config.retry.retries, 0); assert.ok(config.signal() instanceof AbortSignal); }
    async eval(script, keys, args) {
      counters.push({ keys, args });
      if (outage) throw Error('Synthetic shared-counter outage');
      return redis.eval(script, keys, args);
    }
  }
  const compiledBudget = ts.transpileModule(readFileSync(new URL('../../lib/portal-pin-rate-limit.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'process', compiledBudget)(name => {
    if (name === '@upstash/redis') return { Redis: SharedRedis };
    if (name === '@/lib/rate-limit') return { getClientIp: () => ip };
    return require(name);
  }, budget, { env: { NODE_ENV: 'production', EVENT_DOWNLOAD_TOKEN_SECRET: 'synthetic-favorites-secret',
    UPSTASH_REDIS_REST_URL: 'https://synthetic.invalid', UPSTASH_REDIS_REST_TOKEN: 'synthetic' } });
  function request(kind, method = 'POST', body = { operation: 'read', ...credentials(kind) }, query = '') {
    const url = new URL(`https://fixture.test/api/portal/${kind}-favorites${query}`);
    if (method === 'GET' && !query) for (const [key, value] of Object.entries(credentials(kind))) url.searchParams.set(key, value);
    const value = new Request(url, { method, headers: { 'content-type': 'application/json' },
      ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    value.nextUrl = new URL(value.url);
    return value;
  }
  const proof = async kind => (await budget.grantPortalPinBudget(new Response(), request(kind), {
    kind, galleryId: kind === 'school' ? schoolId : projectId, pin, email,
  })).headers.get('set-cookie').split(';')[0];
  async function invoke(kind, method = 'POST', body, query, { guarded = false, cookie = '' } = {}) {
    const req = request(kind, method, body, query);
    if (cookie) req.headers.set('cookie', cookie);
    const blocked = guarded ? await budget.portalPinAttemptLimit(req) : null;
    const response = blocked ? Response.json({ ok: false, message: blocked.message }, { status: blocked.status })
      : await h.load(route(kind))[method](req);
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
  }
  return { ...h, limits, counters, folderReads, request, proof, invoke };
}

for (const kind of ['school', 'event']) {
  test(`${kind}: read POST and repeated legacy GET use the same scoped read without mutations`, async () => {
    const h = fixture();
    const legacy = await h.invoke(kind, 'GET');
    assert.equal(legacy.status, 200);
    assert.deepEqual(legacy.body.mediaIds, kind === 'school' ? [a] : [a, b]);
    for (let index = 0; index < 3; index++) {
      assert.deepEqual(await h.invoke(kind, 'GET'), legacy);
      // A read cannot become a toggle even if toggle-shaped fields accompany it.
      assert.deepEqual(await h.invoke(kind, 'POST', { operation: 'read', ...credentials(kind), mediaId: a, favorited: false }), legacy);
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.limits, [], 'read requests never use the favorite-toggle budget');
    const favoriteQueries = h.queries.filter(row => row.table === `${kind}_gallery_favorites`);
    assert.equal(favoriteQueries.every(row => row.filters.some(([key, value]) => key === 'viewer_key' && value === viewerKey(kind === 'school' ? schoolId : projectId))), true);
  });

  test(`${kind}: wrong credentials and closed galleries retain GET authorization and errors`, async () => {
    for (const scenario of ['wrong-pin', 'wrong-gallery', 'closed']) {
      const h = fixture(), body = { operation: 'read', ...credentials(kind) };
      if (scenario === 'wrong-pin') body.pin = 'incorrect';
      if (scenario === 'wrong-gallery') body[kind === 'school' ? 'schoolId' : 'projectId'] = id(98);
      if (scenario === 'closed') (kind === 'school' ? h.tables.schools : h.tables.projects)[0].status = kind === 'school' ? 'pre_release' : 'inactive';
      const query = `?${new URLSearchParams(credentials(kind)).toString()}`;
      const params = new URLSearchParams(query.slice(1));
      for (const [key, value] of Object.entries(body)) if (key !== 'operation') params.set(key, value);
      const legacy = await h.invoke(kind, 'GET', undefined, `?${params}`);
      const post = await h.invoke(kind, 'POST', body);
      assert.deepEqual(post, legacy, scenario);
      assert.equal(post.status >= 400, true, scenario);
      assert.deepEqual(h.writes, []);
    }
  });

  test(`${kind}: unavailable favorites and database failures preserve the legacy read result`, async () => {
    for (const code of ['42P01', 'SYNTHETIC_DATABASE_FAILURE']) {
      const h = fixture({ favoriteError: { code } });
      const legacy = await h.invoke(kind, 'GET');
      assert.deepEqual(await h.invoke(kind, 'POST'), legacy);
      assert.equal(legacy.status, code === '42P01' ? 200 : 500);
      if (code === '42P01') assert.equal(legacy.body.unavailable, true);
      assert.deepEqual(h.writes, []);
    }
  });

  test(`${kind}: existing toggle upsert/delete and mutation budget remain intact`, async () => {
    const h = fixture();
    const create = await h.invoke(kind, 'POST', { ...credentials(kind), mediaId: a, favorited: true });
    assert.deepEqual(create.body, { ok: true, mediaId: a, favorited: true });
    const remove = await h.invoke(kind, 'POST', { ...credentials(kind), mediaId: a, favorited: false });
    assert.deepEqual(remove.body, { ok: true, mediaId: a, favorited: false });
    assert.equal(h.writes.length, 2);
    assert.equal(h.writes[0].value.viewer_key, viewerKey(kind === 'school' ? schoolId : projectId));
    assert.equal(h.writes[1].operation, 'delete');
    assert.deepEqual(h.limits.map(row => [row.namespace, row.limit, row.windowSeconds]), [[`${kind}-favorites`, 60, 60], [`${kind}-favorites`, 60, 60]]);
    const limited = fixture({ deniedToggle: true });
    assert.equal((await limited.invoke(kind, 'POST', { ...credentials(kind), mediaId: a })).status, 429);
    assert.equal((await limited.invoke(kind, 'POST')).status, 200, 'read matches the existing unrestricted GET action budget');
    assert.deepEqual(limited.writes, []);
  });

  test(`${kind}: malformed reads and ambiguous URL credentials fail before database access`, async () => {
    const h = fixture();
    for (const body of ['{', 'null', '[]', '"primitive"', { operation: 'unknown', ...credentials(kind) },
      { operation: 'read', ...credentials(kind), pin: ['first', 'second'] },
      { operation: 'read', ...credentials(kind), email: {} }, { operation: 'read', pin, email }]) {
      assert.equal((await h.invoke(kind, 'POST', body, '', { guarded: true })).status, 400);
    }
    for (const field of ['schoolId', 'projectId', 'eventId', 'pin', 'email']) {
      const query = `?${field}=first&${field}=second`;
      assert.equal((await h.invoke(kind, 'GET', undefined, query)).status, 400);
      assert.equal((await h.invoke(kind, 'GET', undefined, query, { guarded: true, cookie: await h.proof(kind) })).status, 400);
      assert.equal((await h.invoke(kind, 'POST', undefined, query, { guarded: true, cookie: await h.proof(kind) })).status, 400);
    }
    assert.deepEqual(h.queries, []);
    assert.deepEqual(h.writes, []);
  });

  test(`${kind}: read POST keeps the shared PIN budget and exact proof exemption`, async () => {
    const h = fixture(), cookie = await h.proof(kind);
    for (let index = 0; index < 150; index++) {
      assert.equal((await h.invoke(kind, 'POST', undefined, '', { guarded: true, cookie })).status, 200);
    }
    assert.deepEqual(h.limits, []);
    assert.deepEqual(h.counters, [], 'exact proof never consumes the shared failed-PIN budget');
    for (let index = 0; index < 11; index++) {
      const result = await h.invoke(kind, 'POST', { operation: 'read', ...credentials(kind), pin: 'incorrect' }, '', { guarded: true, cookie });
      assert.equal(result.status, index < 10 ? 404 : 429);
    }
    assert.deepEqual(h.limits, [], 'read actions do not acquire the mutation budget');
    assert.equal(h.counters.length, 11, 'each unknown scope uses one real atomic Redis script');
    assert.equal(await redis.command('GET', h.counters[0].keys[0]), '10');
    assert.equal(await redis.command('GET', h.counters[0].keys[1]), '10');
    const unavailable = fixture({ outage: true });
    assert.equal((await unavailable.invoke(kind, 'POST', undefined, '', { guarded: true })).status, 503);
    assert.deepEqual(unavailable.queries, []);
    assert.equal((await unavailable.invoke(kind, 'POST', undefined, '', { guarded: true, cookie: await unavailable.proof(kind) })).status, 200);
    assert.deepEqual(h.writes, []);
  });
}

test('event read POST keeps the approved-email constraint', async () => {
  const h = fixture();
  h.tables.projects[0].email_required = true;
  h.tables.pre_release_emails.push({ id: id(90), project_id: projectId, email: 'approved@example.test' });
  const legacy = await h.invoke('event', 'GET');
  assert.equal(legacy.status, 403);
  assert.deepEqual(await h.invoke('event', 'POST'), legacy);
  assert.deepEqual(h.writes, []);
});

test('actual client favorites fetches send read credentials only in JSON and retain no-store', async () => {
  const source = readFileSync(new URL('../../components/parents/parent-gallery-client.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const [kind, name] of [['event', 'favoritesResponse'], ['school', 'schoolFavoritesResponse']]) {
    let declaration;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) declaration = node;
      ts.forEachChild(node, visit);
    }
    visit(file);
    assert.ok(declaration, name);
    const h = fixture(), requests = [], exports = {};
    const compiled = ts.transpileModule(`exports.run = async () => { ${declaration.parent.parent.getText(file)} return ${name}; };`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, { exports, projectId, favoriteSchoolId: schoolId, eventEmail: email, schoolViewerEmail: email, pin,
      fetch: async (url, init) => {
        requests.push({ url, init });
        const request = new Request(new URL(url, 'https://fixture.test'), init);
        return h.load(route(kind)).POST(request);
      },
    });
    const response = await exports.run();
    assert.equal(response.status, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `/api/portal/${kind}-favorites`);
    assert.equal(requests[0].init.method, 'POST');
    assert.equal(requests[0].init.cache, 'no-store');
    assert.equal(requests[0].init.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(requests[0].init.body), { operation: 'read', ...credentials(kind) });
    assert.deepEqual(h.writes, []);
  }
});
