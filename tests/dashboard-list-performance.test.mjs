import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { proxiedPhotoUrl } from '../lib/photo-url.ts';
import * as cache from '../lib/dashboard-list-cache.ts';

const require = createRequire(import.meta.url);
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const transpile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const quiet = { error() {}, warn() {} };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function functionSource(path, name) {
  const text = source(path);
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, name);
  return found;
}
function queryDb(tables, onQuery = () => {}) {
  return { from(table) {
    const q = { table, filters: [], selection: '', offset: 0, end: Infinity, single: false };
    const api = {
      select(value) { q.selection = value; return api; },
      eq(key, value) { q.filters.push(row => row[key] === value); return api; },
      in(key, values) { q.filters.push(row => values.includes(row[key])); return api; },
      or() { return api; }, order() { return api; },
      range(from, to) { q.offset = from; q.end = to; return api; },
      maybeSingle() { q.single = true; return api; },
      then(resolve, reject) {
        return Promise.resolve().then(async () => {
          onQuery(q);
          // Yearbook selections introduce a second school/student join path.
          // PostgREST rejects an unhinted embed before applying row filters.
          const relation = q.table === 'schools' ? 'students' : q.table === 'students' ? 'schools' : null;
          if (relation && new RegExp(`\\b${relation}(?:!inner)?\\(`).test(q.selection)) {
            return { data: null, count: null, error: { code: 'PGRST201', message: 'More than one school/student relationship' } };
          }
          let rows = typeof tables[table] === 'function' ? await tables[table](q) : tables[table];
          if (!rows) throw new Error('Unexpected table query: ' + table);
          rows = rows.filter(row => q.filters.every(f => f(row)));
          return { data: q.single ? rows[0] ?? null : rows.slice(q.offset, q.end + 1), count: rows.length, error: null };
        }).then(resolve, reject);
      },
    };
    return api;
  } };
}

function schoolsHarness({ roster, photoCounts, verification, projects = [], schoolCount = 1 } = {}) {
  const state = { schools: [], loading: true, error: '' };
  const queries = [];
  const tables = {
    photographers: [{ id: 'p', user_id: 'u' }],
    schools: [
      { id: 's', school_name: 'School', local_school_id: 'local-s', photographer_id: 'p', students: [{ count: schoolCount }] },
      { id: 'private-s', school_name: 'Other studio', local_school_id: 'private-local-s', photographer_id: 'other', students: [{ count: 99 }] },
    ],
    projects, students: () => roster?.promise ?? [],
  };
  const path = 'app/dashboard/schools/page.tsx';
  const context = {
    ...cache, console: quiet, window: { location: {} },
    supabase: { ...queryDb(tables, q => queries.push(q)), auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u' }, access_token: 'fixture' } } }),
      getUser: () => verification?.promise ?? Promise.resolve({ data: { user: { id: 'u' } } }),
    } },
    fetch: () => photoCounts?.promise ?? Promise.resolve(Response.json({ counts: { s: 9 }, sources: { s: 'r2' } })),
    loadVersion: { current: 0 }, cacheUserId: { current: '' },
    proxiedPhotoUrl, setUserEmail() {},
    setSchools(value) { state.schools = typeof value === 'function' ? value(state.schools) : value; },
    setLoading(value) { state.loading = value; }, setError(value) { state.error = value; },
    exports: {},
  };
  const helpers = ['clean', 'normalizeLookupName', 'normalizeRole', 'isStudentLike'].map(name => functionSource(path, name)).join('\n');
  vm.runInNewContext(transpile(helpers + '\n' + functionSource(path, 'load') + '\nexports.load = load;'), context);
  return { ...context.exports, state, queries, context };
}

test('the school list resolves the original roster relationship and preserves owner filtering and count aliases', async () => {
  cache.clearDashboardListCache();
  const app = schoolsHarness({ schoolCount: 23 });
  await app.load();
  assert.equal(app.state.error, '');
  assert.equal(app.state.loading, false);
  assert.deepEqual(Array.from(app.state.schools, school => school.id), ['s']);
  assert.equal(app.state.schools[0].peopleCount, 23);
  const q = app.queries.find(q => q.table === 'schools');
  assert.match(q.selection, /students:students!students_school_id_fkey\(count\)/);
  await flush();
});

test('the database fixture reproduces PGRST201 for unhinted embeds in both directions', async () => {
  const db = queryDb({ schools: [], students: [] });
  for (const [table, relation] of [['schools', 'students'], ['students', 'schools']]) {
    const old = await db.from(table).select(`id,${relation}(id)`);
    assert.equal(old.error.code, 'PGRST201');
    const corrected = await db.from(table).select(`id,${relation}:${relation}!students_school_id_fkey(id)`);
    assert.equal(corrected.error, null);
  }
});

test('Schools becomes usable before either the roster details or storage scan finishes', async () => {
  cache.clearDashboardListCache();
  const roster = deferred(), photoCounts = deferred();
  const app = schoolsHarness({ roster, photoCounts });
  await app.load();
  assert.equal(app.state.loading, false);
  assert.equal(app.state.schools[0].peopleCount, 1);
  assert.equal(app.state.schools[0].statsLoaded, false);
  assert.equal(app.state.schools[0].uploadedPhotoCount, null);
  photoCounts.resolve(Response.json({ counts: { s: 9000 }, sources: { s: 'r2' } }));
  await flush();
  assert.equal(app.state.schools[0].uploadedPhotoCount, 9000);
  roster.resolve([{ school_id: 's', class_name: 'A', role: 'student', photo_url: 'portrait.jpg' }]);
  await flush();
  assert.equal(app.state.schools[0].classesCount, 1);
  assert.equal(app.state.schools[0].coverUrl, '/api/r2/img/portrait.jpg');
  assert.equal(app.state.schools[0].uploadedPhotoCount, 9000);
});

test('returning to Schools shows cached cards before remote auth completes and still revalidates', async () => {
  cache.clearDashboardListCache();
  cache.readDashboardListCache('u', 'schools');
  cache.writeDashboardListCache('u', 'schools', [{ id: 'previous', school_name: 'Previous' }]);
  const verification = deferred();
  const app = schoolsHarness({ verification });
  const loading = app.load();
  await flush();
  assert.equal(app.state.loading, false);
  assert.equal(app.state.schools[0].id, 'previous');
  verification.resolve({ data: { user: { id: 'u' } } });
  await loading;
  assert.equal(app.state.schools[0].id, 's');
  await flush();
});

test('background results cannot restore deleted cards or write after unmount', async () => {
  cache.clearDashboardListCache();
  const roster = deferred(), photoCounts = deferred();
  const app = schoolsHarness({ roster, photoCounts });
  await app.load();
  ++app.context.loadVersion.current;
  app.state.schools = [];
  cache.invalidateDashboardListCache('schools');
  roster.resolve([{ school_id: 's', class_name: 'A' }]);
  photoCounts.resolve(Response.json({ counts: { s: 99 } }));
  await flush();
  assert.equal(app.state.schools.length, 0);
  assert.equal(cache.readDashboardListCache('u', 'schools'), undefined);
});

test('school roster statistics paginate beyond the database 1000-row limit', async () => {
  cache.clearDashboardListCache();
  const roster = deferred();
  const app = schoolsHarness({ roster, schoolCount: 1001 });
  await app.load();
  roster.resolve(Array.from({ length: 1001 }, (_, i) => ({ school_id: 's', class_name: i === 1000 ? 'Last class' : 'A', photo_url: 'p.jpg' })));
  await flush();
  assert.equal(app.state.schools[0].peopleCount, 1001);
  assert.equal(app.state.schools[0].imagesCount, 1001);
  assert.equal(app.state.schools[0].classesCount, 2);
  assert.equal(app.queries.filter(q => q.table === 'students').length, 2);
});

test('the list cache expires, isolates users, invalidates mutations and clears on sign-out', t => {
  cache.clearDashboardListCache();
  let now = 1;
  t.mock.method(Date, 'now', () => now);
  cache.readDashboardListCache('a', 'schools');
  cache.writeDashboardListCache('a', 'schools', ['private-a']);
  assert.deepEqual(cache.readDashboardListCache('a', 'schools'), ['private-a']);
  assert.equal(cache.readDashboardListCache('b', 'schools'), undefined);
  cache.writeDashboardListCache('a', 'schools', ['late-a']);
  assert.equal(cache.readDashboardListCache('b', 'schools'), undefined);
  cache.writeDashboardListCache('b', 'schools', ['b']);
  now += 300000;
  assert.equal(cache.readDashboardListCache('b', 'schools'), undefined);
  cache.writeDashboardListCache('b', 'schools', ['b']);
  cache.invalidateDashboardListCache('schools');
  assert.equal(cache.readDashboardListCache('b', 'schools'), undefined);
  cache.writeDashboardListCache('b', 'schools', ['b']);
  cache.clearDashboardListCache();
  cache.writeDashboardListCache('b', 'schools', ['late-signout']);
  assert.equal(cache.readDashboardListCache('b', 'schools'), undefined);
});

function eventsRoute({ authenticated = true } = {}) {
  const queries = [];
  const project = (id, title, count, extra = {}) => ({ id, title, photographer_id: 'p', workflow_type: 'event', media: [{ count }], ...extra });
  const db = queryDb({
    photographers: [{ id: 'p', user_id: 'u' }],
    projects: [project('large', 'Event', 150001), project('shell', 'School', 0), project('same-name-with-photos', 'School', 1), project('linked', 'Linked school', 20, { linked_school_id: 's' }), project('other-owner', 'Private', 99, { photographer_id: 'other' })],
    schools: [{ id: 's', school_name: 'School', photographer_id: 'p', students: [{ count: 1200 }] }],
    collections: [{ id: 'a', project_id: 'large', kind: 'album' }, { id: 'b', project_id: 'large', kind: 'gallery' }, { id: 'c', project_id: 'large', kind: 'composite' }],
  }, q => queries.push(q));
  const stubs = {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: authenticated ? { id: 'u' } : null }), createDashboardServiceClient: () => db },
    '@/lib/api-validation': {}, '@/lib/require-agreement': {}, '@/lib/ensure-package-profile': {},
    '@/lib/storage-images': { buildSignedMediaUrls: () => ({}), extractStoragePathFromSupabaseUrl: () => '', SIGNED_URL_TTL_DASHBOARD_SECONDS: 3600 },
  };
  const exports = {};
  vm.runInNewContext(transpile(source('app/api/dashboard/events/route.ts')), { exports, URL, console: quiet, require: name => name in stubs ? stubs[name] : require(name) });
  return { GET: exports.GET, queries };
}

test('Projects returns exact large counts without fetching media or student rows and preserves school filtering', async () => {
  const route = eventsRoute();
  const response = await route.GET(new Request('https://example.test/api/dashboard/events'));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.projects.map(p => p.id), ['large', 'same-name-with-photos']);
  assert.equal(result.imageCounts.large, 150001);
  assert.equal(result.albumCounts.large, 2);
  assert.equal('media' in result.projects[0], false);
  assert.equal(route.queries.some(q => q.table === 'media' || q.table === 'students'), false);
  assert.match(route.queries.find(q => q.table === 'projects').selection, /media\(count\)/);
});

test('Projects rejects unauthenticated access before any database read', async () => {
  const route = eventsRoute({ authenticated: false });
  const response = await route.GET(new Request('https://example.test/api/dashboard/events'));
  assert.equal(response.status, 401);
  assert.equal(route.queries.length, 0);
});

test('Projects displays its cached list while the authenticated API revalidates', async () => {
  cache.clearDashboardListCache();
  cache.readDashboardListCache('u', 'projects');
  cache.writeDashboardListCache('u', 'projects', { projects: [{ id: 'cached' }], imageCounts: { cached: 20 }, albumCounts: {} });
  const response = deferred(), state = {};
  const context = { ...cache, exports: {}, window: { location: {} }, isCurrent: () => true, cacheUserId: { current: '' },
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) } }, fetch: () => response.promise,
    setUserEmail() {}, setProjects: value => { state.projects = value; }, setImageCounts: value => { state.images = value; }, setAlbumCounts() {}, setError: value => { state.error = value; }, setLoading: value => { state.loading = value; },
  };
  vm.runInNewContext(transpile(functionSource('app/dashboard/projects/events/page.tsx', 'load') + '\nexports.load = load;'), context);
  const loading = context.exports.load();
  await flush();
  assert.equal(state.loading, false);
  assert.equal(state.projects[0].id, 'cached');
  response.resolve(Response.json({ ok: true, projects: [{ id: 'fresh' }], imageCounts: { fresh: 25 } }));
  await loading;
  assert.equal(state.projects[0].id, 'fresh');
  assert.equal(state.images.fresh, 25);
});


test('school covers are proxied before and after enrichment and retain the selected project cover', async () => {
  cache.clearDashboardListCache();
  const roster = deferred();
  const app = schoolsHarness({ roster, projects: [{ id: 'cover', photographer_id: 'p', workflow_type: 'school', linked_school_id: 's', cover_photo_url: 'local/Cover Photo.jpg', cover_focal_x: 0.3, cover_focal_y: 0.7 }] });
  await app.load();
  assert.equal(app.state.schools[0].coverUrl, '/api/r2/img/local/Cover%20Photo.jpg');
  roster.resolve([{ school_id: 's', class_name: 'A', photo_url: 'local/student.jpg' }]);
  await flush();
  assert.equal(app.state.schools[0].coverUrl, '/api/r2/img/local/Cover%20Photo.jpg');
  assert.equal(app.state.schools[0].coverFocalX, 0.3);
});
