import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError, isAuthRetryableFetchError} from '@supabase/supabase-js';

function authResolver({bearerResult, cookieResult = {data: {user: null}, error: new AuthSessionMissingError()}, assurance = {data: {currentLevel: 'aal1'}, error: null}, platformAdmin = false, legacyAdmin = false, roleError = null} = {}) {
  let cookieReads = 0;
  let bearerReads = 0;
  let roleReads = 0;
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL('../lib/dashboard-auth.ts', import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const dependencies = {
    'next/headers': {cookies: async () => {cookieReads++; return {getAll: () => [], set() {}};}},
    '@supabase/ssr': {createServerClient: () => ({auth: {getUser: async () => cookieResult, mfa: {getAuthenticatorAssuranceLevel: async () => assurance}}})},
    '@supabase/supabase-js': {isAuthRetryableFetchError, createClient: () => ({auth: {getUser: async () => {bearerReads++; return bearerResult;}},
      from: table => {roleReads++; const query = {select: () => query, eq: () => query, limit: () => query,
        maybeSingle: async () => ({data: table === 'photographers' ? {is_platform_admin: platformAdmin} : {is_admin: legacyAdmin}, error: roleError})}; return query;}})},
  };
  new Function('require', 'exports', 'process', compiled)(name => {assert.ok(name in dependencies, name); return dependencies[name];}, exports,
    {env: {NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-key', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service'}});
  return {auth: exports, resolve: (token, options = {}) => exports.resolveDashboardAuth({method: 'GET', url: 'https://example.invalid/api/dashboard/schools', ...options,
    headers: new Headers({...token ? {authorization: 'Bearer ' + token} : {}, ...options.headers})}), cookieReads: () => cookieReads, bearerReads: () => bearerReads, roleReads: () => roleReads};
}

test('temporary bearer authentication failures remain retryable instead of returning a missing session', async () => {
  for (const error of [new AuthRetryableFetchError('network failure', 0), new AuthApiError('provider unavailable', 503),
    new AuthApiError('rate limit', 429), new AuthUnknownError('network failure', Error('offline'))]) {
    const h = authResolver({bearerResult: {data: {user: null}, error}});
    await assert.rejects(() => h.resolve('fixture-token'), /temporarily unavailable|try again/i);
    assert.equal(h.cookieReads(), 0);
  }
});

test('temporary cookie authentication failure does not claim that the photographer is signed out', async () => {
  const h = authResolver({cookieResult: {data: {user: null}, error: new AuthRetryableFetchError('offline', 0)}});
  await assert.rejects(() => h.resolve(), /temporarily unavailable|try again/i);
});

test('genuinely missing and rejected sessions stay denied while a valid cookie can recover an old bearer', async () => {
  assert.equal((await authResolver().resolve()).user, null);
  const user = {id: 'cookie-user', email: 'person@example.invalid'};
  const h = authResolver({bearerResult: {data: {user: null}, error: new AuthApiError('invalid token', 401)}, cookieResult: {data: {user}, error: null}});
  assert.deepEqual(await h.resolve('old-token'), {user, mfaSatisfied: true});
});

test('MFA assurance outages preserve a retryable failure and never claim verification succeeded', async () => {
  const h = authResolver({cookieResult: {data: {user: {id: 'user', factors: [{status: 'verified'}]}}, error: null},
    assurance: {data: null, error: new AuthRetryableFetchError('offline', 0)}});
  await assert.rejects(() => h.resolve(), /temporarily unavailable|try again/i);
});

const jwt = aal => `header.${Buffer.from(JSON.stringify({aal})).toString('base64url')}.verified-by-auth-provider`;
const enrolled = {id: 'user', factors: [{status: 'verified'}]};

test('an enrolled account never exposes an actionable user before cookie or bearer MFA completes', async () => {
  for (const aal of ['aal1', undefined]) {
    const bearer = authResolver({bearerResult: {data: {user: enrolled}, error: null}});
    assert.deepEqual(await bearer.resolve(jwt(aal)), {user: null, mfaSatisfied: false});
    assert.equal(bearer.cookieReads(), 0, 'a lower-assurance bearer cannot fall through to a stronger cookie');
    const cookie = authResolver({cookieResult: {data: {user: enrolled}, error: null}, assurance: {data: {currentLevel: aal}, error: null}});
    assert.deepEqual(await cookie.resolve(), {user: null, mfaSatisfied: false});
  }
  for (const token of ['malformed', jwt('aal2')]) {
    const h = authResolver({bearerResult: {data: {user: enrolled}, error: null}});
    assert.equal((await h.resolve(token)).user, token === 'malformed' ? null : enrolled);
  }
  const cookie = authResolver({cookieResult: {data: {user: enrolled}, error: null}, assurance: {data: {currentLevel: 'aal2'}, error: null}});
  assert.deepEqual(await cookie.resolve(), {user: enrolled, mfaSatisfied: true});
  assert.equal(cookie.roleReads(), 0, 'enrolled users need no additional stored-role lookup');
});

test('unenrolled stored owners and legacy admins are denied ordinary privileged APIs while enrollment remains reachable', async () => {
  const user = {id: 'unenrolled-owner'};
  for (const roles of [{platformAdmin: true}, {legacyAdmin: true}]) {
    const h = authResolver({bearerResult: {data: {user}, error: null}, ...roles});
    assert.deepEqual(await h.resolve(jwt('aal1'), {url: 'https://example.invalid/api/dashboard/schools'}), {user: null, mfaSatisfied: false});
    assert.equal(h.roleReads(), 2);
    assert.deepEqual(await h.resolve(jwt('aal1'), {url: 'https://example.invalid/api/dashboard/mfa'}), {user, mfaSatisfied: true});
  }
  const unavailable = authResolver({bearerResult: {data: {user}, error: null}, roleError: Error('database unavailable')});
  await assert.rejects(()=>unavailable.resolve(jwt('aal1')),/Account security is temporarily unavailable/);
});

test('owner APIs require enrolled MFA while ordinary studios and the enrollment path stay accessible', async () => {
  const user = {id: 'new-studio', factors: [{status: 'unverified'}]};
  const h = authResolver({bearerResult: {data: {user}, error: null}});
  for (const path of ['/api/dashboard/admin/users', '/api/dashboard/admin/bookings/123/export', '/api/dashboard/admin/overview', '/api/studio-os-app/admin']) {
    assert.deepEqual(await h.resolve(jwt('aal1'), {url: 'https://example.invalid' + path}), {user: null, mfaSatisfied: false}, path);
  }
  for (const path of ['/api/dashboard/schools', '/api/dashboard/mfa', '/api/dashboard/admin/recovery']) {
    assert.deepEqual(await h.resolve(jwt('aal1'), {url: 'https://example.invalid' + path}), {user, mfaSatisfied: true}, path);
  }
});

test('cross-origin browser mutations fail before auth while same-origin and native bearer requests keep working', async () => {
  const user = {id: 'native-studio'};
  for (const headers of [{origin: 'https://attacker.invalid'}, {origin: 'null'}, {'sec-fetch-site': 'cross-site'}, {'sec-fetch-site': 'same-site'}]) {
    const h = authResolver({bearerResult: {data: {user}, error: null}});
    assert.deepEqual(await h.resolve(jwt('aal1'), {method: 'POST', headers}), {user: null});
    assert.equal(h.cookieReads(), 0); assert.equal(h.bearerReads(), 0);
  }
  for (const headers of [{}, {origin: 'https://example.invalid'}, {'sec-fetch-site': 'same-origin'}, {'authorization': 'bearer ' + jwt('aal1')}]) {
    const h = authResolver({bearerResult: {data: {user}, error: null}});
    assert.deepEqual(await h.resolve(jwt('aal1'), {method: 'POST', headers}), {user, mfaSatisfied: true});
  }
});
