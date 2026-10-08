import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function routes({user = {id: 'photographer-user'}, mfaSatisfied = true} = {}) {
  const calls = [];
  const dependencies = {
    'next/server': {NextResponse: {json: (data, init) => Response.json(data, init), redirect: url => new Response(null, {status: 307, headers: {location: String(url)}})}},
    '@/lib/dashboard-auth': {
      resolveDashboardAuth: async () => ({user, mfaSatisfied}),
      createDashboardServiceClient: () => {calls.push('service'); return {};},
    },
    '@/lib/payments': {getOrCreatePhotographerByUser: async () => {calls.push('profile'); return {id: 'profile', is_platform_admin: true};}},
    '@/lib/studio-os-app': {
      getProtectedStudioAppDownloadHref: platform => '/api/studio-os-app/download?platform=' + platform,
      buildStudioAppDashboardState: async () => {calls.push('keys'); return {entitlement: {canDownload: true}, release: {macDownloadUrl: 'private-artifact'}};},
      createStudioAppSignedDownloadUrl: async () => {calls.push('signed-download'); return 'https://example.invalid/signed-artifact';},
      updateStudioAppReleaseConfig: async () => {calls.push('update-release');},
    },
  };
  function load(file) {
    const exports = {};
    const compiled = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
    new Function('require', 'exports', compiled)(name => {assert.ok(name in dependencies, name); return dependencies[name];}, exports);
    return exports;
  }
  return {calls, download: load('app/api/studio-os-app/download/route.ts'), admin: load('app/api/studio-os-app/admin/route.ts')};
}

const request = platform => {const url = 'https://example.invalid/api/studio-os-app/download?platform=' + platform; return {url, nextUrl: new URL(url), headers: new Headers()};};
test('protected downloads preserve their destination through sign-in and MFA before reading keys', async () => {
  for (const auth of [{user: null}, {mfaSatisfied: false}]) for (const platform of ['mac', 'windows']) {
    const h = routes(auth); const response = await h.download.GET(request(platform));
    assert.equal(response.status, 307);
    const destination = new URL(response.headers.get('location'));
    assert.equal(destination.pathname, '/sign-in');
    assert.equal(destination.searchParams.get('next'), '/api/studio-os-app/download?platform=' + platform);
    assert.deepEqual(h.calls, []);
  }
});

test('new users without enrolled MFA and verified users keep their intended download access', async () => {
  for (const mfaSatisfied of [true, undefined]) {
    const h = routes({mfaSatisfied}); const response = await h.download.GET(request('mac'));
    assert.equal(response.headers.get('location'), 'https://example.invalid/signed-artifact');
    assert.deepEqual(h.calls, ['service', 'profile', 'keys', 'signed-download']);
  }
});

test('owner rollout requests cannot mutate release settings or reveal keys before MFA', async () => {
  const h = routes({mfaSatisfied: false});
  const response = await h.admin.POST({headers: new Headers(), json: async () => ({action: 'update_release', releaseState: 'public'})});
  assert.equal(response.status, 403); assert.equal((await response.json()).mfaRequired, true);
  assert.deepEqual(h.calls, []);
});
