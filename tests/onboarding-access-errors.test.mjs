import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function route({ user = { id: 'confirmed-user' }, authError, profileError, dashboardError } = {}) {
  const audit = [];
  const exports = {};
  const source = readFileSync(new URL('../app/api/studio-os-app/status/route.ts', import.meta.url), 'utf8');
  const dependencies = {
    'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
    '@/lib/dashboard-auth': {
      resolveDashboardAuth: async () => { if (authError) throw authError; return { user }; },
      createDashboardServiceClient: () => ({}),
    },
    '@/lib/payments': {
      getOrCreatePhotographerByUser: async () => { if (profileError) throw profileError; return { id: 'photographer' }; },
      resolveFreeTrialEndsAt: () => null,
      isFreeTrialActive: () => false,
      getFreeTrialDaysRemaining: () => 0,
    },
    '@/lib/studio-os-app': {
      buildStudioAppDashboardState: async () => { if (dashboardError) throw dashboardError; return { keys: [] }; },
    },
    '@/lib/audit': { recordAudit: async (entry) => { audit.push(entry); } },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', compiled)((name) => { assert.ok(name in dependencies, name); return dependencies[name]; }, exports);
  return { GET: exports.GET, audit };
}

test('failed trial initialization preserves authenticated identity and records an account-scoped support error', async () => {
  const { GET, audit } = route({ profileError: Error('private database failure details') });
  const response = await GET({ headers: new Headers() });
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.equal(payload.signedIn, true);
  assert.match(payload.message, /try again/);
  assert.doesNotMatch(payload.message, /private database/);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actorUserId, 'confirmed-user');
  assert.equal(audit[0].action, 'onboarding.access_check');
  assert.equal(audit[0].result, 'error');
});

test('failed key setup records the photographer and does not claim the account is signed out', async () => {
  const { GET, audit } = route({ dashboardError: Error('key provisioning failed') });
  const response = await GET({ headers: new Headers() });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).signedIn, true);
  assert.equal(audit[0].targetPhotographerId, 'photographer');
});

test('authentication outages remain retryable without fabricating an authenticated user or a session rejection', async () => {
  const { GET, audit } = route({ authError: Error('authentication unavailable') });
  const response = await GET({ headers: new Headers() });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).signedIn, undefined);
  assert.deepEqual(audit, []);
});

test('a genuinely absent session returns the explicit 401 signed-out response', async () => {
  const { GET, audit } = route({ user: null });
  const response = await GET({ headers: new Headers() });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).signedIn, false);
  assert.deepEqual(audit, []);
});
