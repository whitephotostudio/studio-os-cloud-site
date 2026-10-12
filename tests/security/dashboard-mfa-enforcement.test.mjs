import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';

const compile = file => ts.transpileModule(readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const responseModule = {NextResponse: {json: (body, init) => Response.json(body, init)}};
const token = aal => `fixture.${Buffer.from(JSON.stringify({aal})).toString('base64url')}.verified-by-mocked-provider`;

function fixture({aal = 'aal1', factors = [{status: 'verified'}]} = {}) {
  const calls = [];
  const user = {id: 'synthetic-owner', factors};
  const environment = {env: {NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service'}};
  function load(file, dependencies) {
    const exports = {};
    new Function('require', 'exports', 'process', compile(file))(name => {
      assert.ok(name in dependencies, name); return dependencies[name];
    }, exports, environment);
    return exports;
  }
  const auth = load('lib/dashboard-auth.ts', {
    'next/headers': {cookies: async () => {throw Error('unexpected cookie fallback');}},
    '@supabase/ssr': {},
    '@supabase/supabase-js': {
      isAuthRetryableFetchError: () => false,
      createClient: () => ({auth: {getUser: async () => ({data: {user}, error: null})}}),
    },
  });
  const dependencies = {
    'next/server': responseModule, zod: {z},
    '@/lib/dashboard-auth': {...auth, createDashboardServiceClient: () => {
      calls.push('service');
      return {from: table => ({update: () => ({eq: async () => {calls.push('update:' + table); return {error: null};}})})};
    }},
    '@/lib/payments': {getOrCreatePhotographerByUser: async () => ({id: 'synthetic-admin', is_platform_admin: true})},
    '@/lib/api-validation': {parseJson: async request => ({ok: true, data: await request.json()})},
    '@/lib/admin-signup-status': {}, '@/lib/admin-trial-change': {}, '@/lib/audit': {},
  };
  const users = load('app/api/dashboard/admin/users/route.ts', dependencies);
  const request = {method: 'POST', url: 'https://example.invalid/api/dashboard/admin/users',
    headers: new Headers({authorization: 'Bearer ' + token(aal)}),
    json: async () => ({action: 'update_voice', photographerId: '00000000-0000-4000-8000-000000000002'})};
  return {users, request, calls, load, auth};
}

test('actual owner action is denied before service access when MFA is pending or not enrolled', async () => {
  for (const options of [{aal: 'aal1'}, {factors: []}]) {
    const h = fixture(options);
    const response = await h.users.POST(h.request);
    assert.equal(response.status, 401);
    assert.deepEqual(h.calls, []);
  }
});

test('actual owner action remains available after verified MFA', async () => {
  const h = fixture({aal: 'aal2'});
  const response = await h.users.POST(h.request);
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, ['service', 'update:photographers']);
});

test('legacy photo-edit sync refuses pending MFA before creating privileged clients', async () => {
  const h = fixture();
  let serviceClients = 0;
  const dependencies = {
    'next/server': responseModule, zod: {z},
    '@supabase/supabase-js': {createClient: () => {serviceClients++; throw Error('must not create service client');}},
    '@/lib/dashboard-auth': h.auth,
    '@/lib/require-agreement': {},
  };
  for (const [file, method] of [['list', 'GET'], ['upsert', 'POST']]) {
    const route = h.load(`app/api/dashboard/photo-edits/${file}/route.ts`, dependencies);
    const response = await route[method]({...h.request, method, url: `https://example.invalid/api/dashboard/photo-edits/${file}`});
    assert.equal(response.status, 403);
  }
  assert.equal(serviceClients, 0);
});

test('MFA-management rejects a cross-origin mutation before loading cookie credentials', async () => {
  const h = fixture();
  const route = h.load('app/api/dashboard/mfa/route.ts', {
    'next/server': responseModule, zod: {z},
    'next/headers': {cookies: async () => {throw Error('must not read cookies');}},
    '@supabase/ssr': {},
    '@/lib/dashboard-auth': h.auth,
    '@/lib/api-validation': {}, '@/lib/audit': {},
  });
  const response = await route.POST({...h.request, url: 'https://example.invalid/api/dashboard/mfa', headers: new Headers({origin: 'https://attacker.invalid'})});
  assert.equal(response.status, 403);
});
