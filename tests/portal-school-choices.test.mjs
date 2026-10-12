import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ssrPath = 'app/parents/page.tsx';
const apiPath = 'app/api/portal/choices/route.ts';
const LoginForm = () => null;
const SchoolDirectLoginForm = () => null;

function selectFields(selection) {
  const fields = [];
  let depth = 0, start = 0;
  for (let i = 0; i < selection.length; i++) {
    if (selection[i] === '(') depth++;
    if (selection[i] === ')') depth--;
    if (selection[i] === ',' && depth === 0) { fields.push(selection.slice(start, i)); start = i + 1; }
  }
  fields.push(selection.slice(start));
  return fields;
}

function fixture({ schoolsError = false } = {}) {
  const requests = [];
  const school = (id, school_name, extra = {}) => ({ id, school_name, status: 'active', portal_status: 'active',
    expiration_date: '2026-10-31T00:00:00Z', email_required: true, registration_class_required: false,
    photographer_id: 'studio', access_pin: 'private-school-pin', ...extra });
  const schools = [
    school('main', 'triOS Main'), school('brampton', 'triOS Brampton'), school('london', 'triOS London'),
    school('empty', 'Empty School'), school('prerelease', 'Upcoming School', { portal_status: 'pre_release' }),
    school('inactive', 'Inactive School', { status: 'inactive' }), school('blank', '   '),
    school('duplicate', 'triOS Main'),
  ];
  const roster = (id, count) => Array.from({ length: count }, (_, i) => ({ id: `${id}-${i}`, school_id: id,
    pin: `private-${id}-${i}`, parent_email: 'private@example.test', photo_url: 'private-photo.jpg' }));
  // Exactly the API's first 1,000 global rows contain main and Brampton, plus
  // unrelated studios. Every London student lies beyond that first page.
  const students = [...roster('main', 58), ...roster('brampton', 53), ...roster('other-studio', 889),
    ...roster('london', 55), ...roster('inactive', 1), ...roster('blank', 1), ...roster('duplicate', 1)];
  const projects = [
    { id: 'event', title: 'Active Event', client_name: null, workflow_type: 'event', status: 'active', portal_status: 'active', event_date: '2026-10-08', email_required: true, photographer_id: 'studio' },
    { id: 'inactive-event', title: 'Inactive Event', workflow_type: 'event', status: 'inactive', event_date: '2026-10-09', photographer_id: 'studio' },
    { id: 'other-event', title: 'Other Studio Event', workflow_type: 'event', status: 'active', event_date: '2026-10-10', photographer_id: 'other' },
  ];
  const fetcher = async (input, options) => {
    const url = new URL(input), table = url.pathname.split('/').pop();
    const selection = url.searchParams.get('select') ?? '';
    requests.push({ table, url, selection });
    if (schoolsError && table === 'schools') return Response.json({ code: 'XX000', message: 'fixture database unavailable' }, { status: 500 });
    if (table === 'schools' && selection.includes('students') && !selection.includes('students:students!students_school_id_fkey(count)')) {
      return Response.json({ code: 'PGRST201', message: 'Ambiguous roster/yearbook relationship' }, { status: 300 });
    }
    let rows = { schools, students, projects }[table];
    assert.ok(rows, `Unexpected fixture table: ${table}`);
    for (const [field, value] of url.searchParams) {
      if (value.startsWith('eq.')) rows = rows.filter(row => String(row[field]) === value.slice(3));
      if (value === 'not.is.null') rows = rows.filter(row => row[field] != null);
    }
    const order = url.searchParams.get('order');
    if (order) {
      const [field, direction] = order.split('.');
      rows = [...rows].sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (direction === 'desc' ? -1 : 1));
    }
    rows = rows.slice(0, Math.min(1000, Number(url.searchParams.get('limit') ?? 1000)));
    const fields = selectFields(selection);
    const projected = rows.map(row => Object.fromEntries(fields.map(field => field.startsWith('students:')
      ? ['students', [{ count: students.filter(student => student.school_id === row.id).length }]]
      : [field, row[field] ?? null])));
    const accept = new Headers(options.headers).get('accept') ?? '';
    return Response.json(accept.includes('vnd.pgrst.object') ? projected[0] ?? null : projected);
  };
  const client = createClient('https://fixture.supabase.co', 'fixture-public-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher },
  });
  function load(path, exposeChoices = false) {
    const compiled = ts.transpileModule(source(path) + (exposeChoices ? '\nexport { getPortalChoices };' : ''), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    const dependencies = {
      '@/lib/dashboard-auth': { createDashboardServiceClient: () => client },
      'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
      './LoginForm': { default: LoginForm }, './SchoolDirectLoginForm': { default: SchoolDirectLoginForm },
      'react/jsx-runtime': require('react/jsx-runtime'),
    };
    new Function('require', 'exports', 'console', compiled)(name => {
      assert.ok(name in dependencies, `Unexpected module: ${name}`);
      return dependencies[name];
    }, exports, { error() {} });
    return exports;
  }
  return { client, requests, ssr: load(ssrPath, true), api: load(apiPath) };
}

function assertSafeChoices(choices) {
  for (const row of choices) {
    for (const key of ['students', 'count', 'pin', 'access_pin', 'parent_email', 'photo_url', 'photographer_id']) {
      assert.equal(key in row, false, `${key} must not appear in public school choices`);
    }
  }
}

for (const mode of ['SSR', 'API']) {
  test(`${mode} lists London and both other campuses beyond the global 1,000-student limit without exposing counts`, async () => {
    const f = fixture();
    const legacy = await f.client.from('students').select('school_id').not('school_id', 'is', null);
    assert.equal(legacy.data.length, 1000);
    assert.equal(legacy.data.some(row => row.school_id === 'london'), false);
    f.requests.length = 0;
    const response = mode === 'API' ? await f.api.GET() : null;
    if (response) assert.equal(response.status, 200);
    const result = response ? await response.json() : await f.ssr.getPortalChoices();
    assert.deepEqual(result.schools.filter(row => ['main', 'brampton', 'london'].includes(row.id)).map(row => row.id).sort(), ['brampton', 'london', 'main']);
    assertSafeChoices(result.schools);
    assert.equal(f.requests.some(request => request.table === 'students'), false);
    assert.equal(f.requests.find(request => request.table === 'schools').selection.includes('students:students!students_school_id_fkey(count)'), true);
    assert.equal(result.schools.some(row => ['empty', 'inactive', 'blank'].includes(row.id)), false);
    assert.equal(result.schools.filter(row => row.school_name.toLowerCase() === 'trios main').length, 1);
    assert.equal(result.schools.some(row => row.id === 'prerelease'), mode === 'SSR');
    assert.equal(result.eventProjects.some(row => row.id === 'inactive-event'), false);
    if (response) assert.equal(response.headers.get('cache-control'), 'public, s-maxage=120, stale-while-revalidate=600');
  });
}

test('SSR preserves direct-school selection, duplicate-name preference, inactive exclusion, and event studio scope', async () => {
  const f = fixture();
  const empty = await f.ssr.default({ searchParams: Promise.resolve({ school: 'empty' }) });
  assert.equal(empty.type, SchoolDirectLoginForm);
  assert.equal(empty.props.school.id, 'empty');
  assertSafeChoices([empty.props.school]);
  const duplicate = await f.ssr.default({ searchParams: Promise.resolve({ school: 'duplicate' }) });
  assert.equal(duplicate.type, SchoolDirectLoginForm);
  assert.equal(duplicate.props.school.id, 'duplicate');
  const inactive = await f.ssr.default({ searchParams: Promise.resolve({ school: 'inactive' }) });
  assert.equal(inactive.type, LoginForm);
  assert.equal(inactive.props.initialSchools.some(row => row.id === 'inactive'), false);
  const event = await f.ssr.getPortalChoices('event');
  assert.deepEqual(event.eventProjects.map(row => row.id), ['event']);
});

test('a school-query failure still fails the API and yields empty SSR choices', async () => {
  const f = fixture({ schoolsError: true });
  assert.deepEqual(await f.ssr.getPortalChoices(), { schools: [], eventProjects: [] });
  const response = await f.api.GET();
  assert.equal(response.status, 500);
  assert.equal((await response.json()).ok, false);
});
