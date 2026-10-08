import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const transpile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const quiet = { error() {}, warn() {} };
const requestId = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const flush = () => new Promise(resolve => setImmediate(resolve));

function createHarness({ kind, loseInsertResponse = false, foreign = false, noUser = false, agreement = true } = {}) {
  const table = kind === 'gallery' ? 'projects' : kind === 'album' ? 'collections' : 'schools';
  const rows = foreign ? [{ id: requestId, photographer_id: 'other', project_id: 'other-project', kind: 'album', title: 'Other studio private project' }] : [];
  let lost = false;
  const tables = { photographers: [{ id: 'studio', user_id: 'user' }], projects: [{ id: 'project', photographer_id: 'studio' }], [table]: rows }, writes = [];
  const service = { from(name) {
    let value, single = false;
    const filters = [];
    const q = {
      select() { return q; }, eq(key, wanted) { filters.push([key, wanted]); return q; },
      order() { return q; }, limit() { return q; },
      abortSignal() { return q; }, maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      insert(input) { value = input; return q; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (value) {
            if (tables[name].some(row => row.id === value.id)) return { data: null, error: { code: '23505', message: 'duplicate id' } };
            const row = { ...value }; tables[name].push(row); writes.push(row);
            if (loseInsertResponse && !lost) { lost = true; return { data: null, error: { code: '57014', message: 'Response lost after commit' } }; }
            return { data: row, error: null };
          }
          const matching = (tables[name] ?? []).filter(row => filters.every(([key, wanted]) => row[key] === wanted));
          return { data: single ? matching[0] ?? null : matching, error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  } };
  const stubs = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: noUser ? null : { id: 'user' } }), createDashboardServiceClient: () => service },
    '@/lib/require-agreement': { guardAgreement: async () => agreement ? { ok: true } : { ok: false, status: 403, body: { ok: false, message: 'Accept agreement' } } },
    '@/lib/ensure-package-profile': { ensurePackageProfile: async () => null },
    '@/lib/api-validation': { parseJson: async (request, schema) => {
      const result = schema.safeParse(await request.json());
      return result.success ? { ok: true, data: result.data } : { ok: false, response: Response.json({ ok: false, message: 'Invalid request' }, { status: 400 }) };
    } },
    '@/lib/storage-images': {},
    '@/lib/audit': { recordAudit: async () => {} },
    '@/lib/r2': {},
  };
  const context = { exports: {}, Response, AbortSignal, Date, Math, console: quiet, require: name => stubs[name] ?? require(name) };
  const file = kind === 'gallery' ? 'app/api/dashboard/events/route.ts' : kind === 'album' ? 'app/api/dashboard/events/[id]/albums/route.ts' : 'app/api/dashboard/schools/route.ts';
  vm.runInNewContext(transpile(source(file)), context);
  const body = kind === 'gallery' ? { title: 'First gallery', eventDate: '2026-10-07' } : kind === 'album' ? { title: 'First album' } : { school_name: 'First school', shoot_date: '2026-10-07' };
  return { rows, writes, async post(overrides = {}) {
    const response = await context.exports.POST(new Request('https://fixture.test/api', { method: 'POST', body: JSON.stringify({ ...body, clientRequestId: requestId, ...overrides }), headers: { 'Content-Type': 'application/json' } }), { params: Promise.resolve({ id: 'project' }) });
    return { status: response.status, body: await response.json() };
  } };
}

for (const kind of ['gallery', 'school', 'album']) {
  test(`${kind} first create and replay return one owner-bound resource`, async () => {
    const app = createHarness({ kind });
    const first = await app.post(), replay = await app.post();
    assert.equal(first.status, 200); assert.equal(replay.status, 200);
    assert.equal(first.body[kind === 'gallery' ? 'project' : kind].id, requestId);
    assert.equal(app.writes.length, 1);
    if (kind === 'album') { assert.equal(app.rows[0].project_id, 'project'); assert.equal(app.rows[0].kind, 'album'); }
    else { assert.equal(app.rows[0].photographer_id, 'studio'); assert.equal(app.rows[0].status, kind === 'gallery' ? 'active' : 'pre_release'); }
  });
  test(`${kind} retries a lost commit response without silently creating a second job`, async () => {
    const app = createHarness({ kind, loseInsertResponse: true });
    assert.equal((await app.post()).status, 500);
    const retry = await app.post();
    assert.equal(retry.status, 200);
    assert.equal(retry.body[kind === 'gallery' ? 'project' : kind].id, requestId);
    assert.equal(app.writes.length, 1);
  });
  test(`${kind} idempotency never returns, changes or claims a resource owned by another studio`, async () => {
    const app = createHarness({ kind, foreign: true });
    const result = await app.post();
    assert.equal(result.status, 409);
    assert.equal(result.body.project, undefined); assert.equal(result.body.school, undefined); assert.equal(result.body.album, undefined);
    assert.equal(app.writes.length, 0);
    assert.equal(app.rows[0].photographer_id, 'other');
  });
  test(`${kind} still rejects anonymous, unaccepted-agreement and invalid request IDs`, async () => {
    for (const [options, status] of [[{ noUser: true }, 401], [{ agreement: false }, 403]]) {
      const app = createHarness({ kind, ...options });
      assert.equal((await app.post()).status, status); assert.equal(app.writes.length, 0);
    }
    const app = createHarness({ kind });
    assert.equal((await app.post({ clientRequestId: 'other,id.eq.any' })).status, 400);
    assert.equal(app.writes.length, 0);
  });
}

function declaration(file, name) {
  const parsed = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(parsed);
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) found = 'const ' + node.getText(parsed) + ';';
    ts.forEachChild(node, visit);
  }
  visit(parsed); assert.ok(found, name); return found;
}

function formHarness(kind, { hangSession = false, lostResponse = false, formReady = true } = {}) {
  const timers = new Map(), posts = [], navigation = [], state = { busy: false, error: '' };
  let timerId = 0, requestCount = 0, generatedIds = 0;
  const context = {
    exports: {}, Error, Promise, AbortSignal, Date, Headers, window: { location: {} }, console: quiet,
    crypto: { randomUUID: () => ++generatedIds === 1 ? requestId : otherId },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    formReady, title: 'First gallery', clientName: '', eventDate: '2026-10-07', galleryStatus: 'active', accessMode: 'public', accessPin: '',
    newSchoolName: 'First school', newSchoolShootDate: '2026-10-07', createRequestId: { current: null },
    newAlbumTitle: 'First album', projectId: 'project', collections: [], newAlbumRequestId: { current: null },
    setSaving(value) { state.busy = value; }, setCreating(value) { state.busy = value; },
    setError(value) { state.error = value; }, setCreateError(value) { state.error = value; },
    setCreatingAlbum(value) { state.busy = value; }, setNewAlbumError(value) { state.error = value; },
    setNewSchoolName(value) { context.newSchoolName = value; }, createInputRef: { current: null },
    setCollections(value) { context.collections = typeof value === 'function' ? value(context.collections) : value; }, sortCollections: rows => rows,
    setAlbumsCount() {}, setNewAlbumTitle() {}, setNewAlbumOpen() {}, clean: value => (value ?? '').trim(),
    router: { push: path => navigation.push(path) }, invalidateDashboardListCache() {}, setShowCreateModal() {}, setNewSchoolShootDate() {},
    supabase: { auth: { getSession: async () => hangSession ? new Promise(() => {}) : { data: { session: { access_token: 'session' } } } } },
    fetch: async (url, options) => {
      posts.push({ url, options });
      if (lostResponse && ++requestCount === 1) throw new TypeError('Network connection lost');
      return Response.json({ ok: true, [kind === 'gallery' ? 'project' : kind]: { id: JSON.parse(options.body).clientRequestId } });
    },
  };
  vm.runInNewContext(transpile(source('lib/auth-request.ts')), context);
  context.withAuthRequestTimeout = context.exports.withAuthRequestTimeout;
  const file = kind === 'gallery' ? 'app/dashboard/projects/new/page.tsx' : kind === 'album' ? 'app/dashboard/projects/[id]/page.tsx' : 'app/dashboard/schools/page.tsx';
  const name = kind === 'gallery' ? 'handleSubmit' : kind === 'album' ? 'createAlbum' : 'handleCreateSchool';
  if (kind === 'album') vm.runInNewContext(transpile(declaration(file, 'requestDashboard')), context);
  vm.runInNewContext(transpile(declaration(file, name) + '\nexports.submit = ' + name + ';'), context);
  if (kind !== 'gallery') vm.runInNewContext(transpile(declaration(file, kind === 'album' ? 'openNewAlbum' : 'openCreateModal') + '\nexports.openNew = ' + (kind === 'album' ? 'openNewAlbum' : 'openCreateModal') + ';'), context);
  return { state, posts, navigation, async submit() { await context.exports.submit({ preventDefault() {} }); }, expire() { for (const fn of [...timers.values()]) fn(); }, openNew() { context.exports.openNew(); context.newSchoolName = 'Second school'; } };
}

for (const kind of ['gallery', 'school', 'album']) {
  test(`${kind} form recovers from an auth hang without clearing the form or pretending creation succeeded`, async () => {
    const app = formHarness(kind, { hangSession: true });
    const pending = app.submit(); await flush();
    assert.equal(app.state.busy, true);
    app.expire(); await pending;
    assert.equal(app.state.busy, false);
    assert.match(app.state.error, /sign-in took too long/);
    assert.equal(app.posts.length, 0); assert.equal(app.navigation.length, 0);
  });
  test(`${kind} form retries an unknown outcome using the same creation ID and a bounded request`, async () => {
    const app = formHarness(kind, { lostResponse: true });
    await app.submit();
    assert.equal(app.state.busy, false); assert.equal(app.navigation.length, 0);
    assert.match(app.state.error, /confirm whether/);
    await app.submit();
    assert.equal(app.posts.length, 2);
    for (const post of app.posts) { assert.equal(JSON.parse(post.options.body).clientRequestId, requestId); assert.ok(post.options.signal); }
    assert.equal(app.navigation.length, kind === 'album' ? 0 : 1);
  });
}

for (const kind of ['school', 'album']) test(`${kind} cancel then new-create intent gets a fresh request ID`, async () => {
  const app = formHarness(kind, { lostResponse: true });
  await app.submit();
  app.openNew();
  await app.submit();
  assert.equal(JSON.parse(app.posts[0].options.body).clientRequestId, requestId);
  assert.equal(JSON.parse(app.posts[1].options.body).clientRequestId, otherId);
});

test('new gallery native submit cannot leak a private PIN before hydration', async () => {
  const app = formHarness('gallery', { formReady: false });
  await app.submit();
  assert.equal(app.posts.length, 0);
  assert.match(source('app/dashboard/projects/new/page.tsx'), /<form method="post"/);
});

test('dashboard auth and missing overview responses become retryable errors instead of a permanent loading screen', async () => {
  for (const hang of ['auth', 'events']) {
    const timers = new Map(), controllers = [], state = { loading: false, error: '' }, location = { href: '' };
    let timerId = 0;
    const context = {
      exports: {}, Error, Promise, Map, Set, URL, console: quiet,
      setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
      AbortSignal: { timeout() { const controller = new AbortController(); controllers.push(controller); return controller.signal; } },
      window: { location }, searchParams: { get: () => null }, useCallback: fn => fn,
      setLoading(value) { state.loading = value; }, setRefreshing() {}, setError(value) { state.error = value; },
      setUserEmail() {}, setPhotographer() {}, setSchools() {}, setProjects() {}, setEventProjects() {}, setStudents() {}, setOrders() {}, setDownloadActivity() {}, setStudioWelcome() {}, setShowStudioWelcome() {},
      resolveSubscriptionAccess: () => ({ accessEnabled: true }), dedupeSchools: rows => rows,
      clean: value => (value ?? '').trim(), normalizeLookupName: value => (value ?? '').toLowerCase(),
      supabase: { auth: {
        getUser: async () => hang === 'auth' ? new Promise(() => {}) : { data: { user: { id: 'user' } }, error: null },
        getSession: async () => ({ data: { session: { access_token: 'session' } } }),
      }, from(table) {
        let single = false;
        const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, abortSignal() { return q; }, maybeSingle() { single = true; return q; },
          then(resolve, reject) { return Promise.resolve({ data: single && table === 'photographers' ? { id: 'studio', subscription_status: 'active' } : [], error: null }).then(resolve, reject); } };
        return q;
      } },
      fetch: async (url, options) => url === '/api/dashboard/events'
        ? new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError'))))
        : Response.json({ ok: true, activities: [], entitlement: { appAccessEnabled: false } }),
    };
    vm.runInNewContext(transpile(source('lib/auth-request.ts')), context);
    context.withAuthRequestTimeout = context.exports.withAuthRequestTimeout;
    context.authRequestErrorMessage = context.exports.authRequestErrorMessage;
    vm.runInNewContext(transpile(declaration('app/dashboard/page.tsx', 'load') + '\nexports.load = load;'), context);
    const pending = context.exports.load(); await flush();
    if (hang === 'auth') for (const fn of [...timers.values()]) fn();
    else controllers.forEach(controller => controller.abort());
    await pending;
    assert.equal(state.loading, false);
    assert.match(state.error, /took too long/);
    assert.equal(location.href, '');
  }
});
