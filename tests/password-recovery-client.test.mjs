import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as sdk from '@supabase/supabase-js';
import * as ssr from '@supabase/ssr';
const {createBrowserClient} = ssr;

const projectUrl = 'https://recovery-fixture.invalid';
const fixtureKey = 'fixture-public-key';
const storageKey = 'sb-recovery-fixture-auth-token';
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.invalid',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-10T00:00:00Z',
};

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({sub: user.id, exp: expiresAt, aal: 'aal1', amr: []})).toString('base64url');
  return {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
    refresh_token: 'fixture-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user,
  };
}

function recoveryUrl() {
  const value = session();
  return 'https://www.studiooscloud.com/reset-password#' + new URLSearchParams({
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    expires_in: String(value.expires_in),
    expires_at: String(value.expires_at),
    token_type: value.token_type,
    type: 'recovery',
  });
}

function loadTypeScript(path, dependencies) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  new Function('require', 'exports', 'process', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports, {env: {NEXT_PUBLIC_SUPABASE_URL: projectUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: fixtureKey}});
  return exports;
}

function recoveryFactory() {
  return loadTypeScript('lib/supabase/password-recovery-client.ts', {
    '@supabase/supabase-js': sdk,
    '@supabase/ssr': ssr,
  }).createPasswordRecoveryClient;
}

async function browserFixture(t, {url = recoveryUrl(), rejectUser = false, rejectCode = false, cookies = {}} = {}) {
  const originals = new Map();
  const replace = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
  };
  const requests = [];
  const cookieValues = new Map(Object.entries({'unrelated-dashboard-cookie': 'preserve', ...cookies}));
  const cookieWrites = [];
  const localValues = new Map([['unrelated-local-value', 'preserve']]);
  const localWrites = [];
  const document = {visibilityState: 'hidden'};
  Object.defineProperty(document, 'cookie', {
    get: () => [...cookieValues].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('; '),
    set: value => {
      cookieWrites.push(value);
      const pair = value.split(';')[0];
      const split = pair.indexOf('=');
      const key = pair.slice(0, split);
      const content = decodeURIComponent(pair.slice(split + 1));
      if (!content) cookieValues.delete(key);
      else cookieValues.set(key, content);
    },
  });
  const window = {
    document,
    location: new URL(url),
    addEventListener() {},
    removeEventListener() {},
  };
  window.history = {
    state: null,
    replaceState(_state, _title, href) {window.location = new URL(href, window.location.href);},
  };
  replace('window', window);
  replace('document', document);
  replace('navigator', {});
  replace('BroadcastChannel', undefined);
  replace('localStorage', {
    getItem: key => localValues.get(key) ?? null,
    setItem(key, value) {localWrites.push([key, value]); localValues.set(key, value);},
    removeItem(key) {localWrites.push([key, null]); localValues.delete(key);},
  });
  replace('fetch', async (input, options = {}) => {
    const requestUrl = new URL(typeof input === 'string' ? input : input.url);
    assert.equal(requestUrl.origin, projectUrl, 'No fixture may contact a real service');
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({url: requestUrl, method, body});
    if (requestUrl.pathname === '/auth/v1/user' && method === 'GET') {
      return Response.json(rejectUser ? {message: 'Fixture session expired'} : user, {status: rejectUser ? 401 : 200});
    }
    if (requestUrl.pathname === '/auth/v1/token' && requestUrl.searchParams.get('grant_type') === 'pkce' && method === 'POST') {
      if (rejectCode) return Response.json({message: 'Code has expired or was already used', code: 'otp_expired'}, {status: 400});
      return Response.json(session());
    }
    if (requestUrl.pathname === '/auth/v1/recover' && method === 'POST') {
      // This transport is wholly synthetic; no email is sent.
      return Response.json({});
    }
    assert.fail(`Unexpected request: ${method} ${requestUrl.pathname}`);
  });
  const clients = [];
  t.after(async () => {
    for (const client of clients) {
      client.auth.stopAutoRefresh();
      await client.removeAllChannels?.();
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const track = client => {clients.push(client); return client;};
  return {requests, window, cookieValues, cookieWrites, localValues, localWrites, track};
}

async function initializeAndObserve(client) {
  const events = [];
  const {data: {subscription}} = client.auth.onAuthStateChange((event, current) => {
    events.push({event, userId: current?.user?.id ?? null});
  });
  const result = await client.auth.initialize();
  await new Promise(resolve => setTimeout(resolve, 10));
  return {events, result, unsubscribe: () => subscription.unsubscribe()};
}

test('installed SSR SDK rejects implicit recovery despite requesting implicit flow', async t => {
  const h = await browserFixture(t);
  const client = h.track(createBrowserClient(projectUrl, fixtureKey, {
    isSingleton: false,
    auth: {flowType: 'implicit', skipAutoInitialize: true},
  }));
  const observed = await initializeAndObserve(client);
  assert.match(observed.result.error?.message ?? '', /Not a valid PKCE flow url/);
  assert.equal(observed.events.some(({event}) => event === 'PASSWORD_RECOVERY'), false);
  assert.equal(h.requests.length, 0, 'Failure occurs before the valid token can be verified');
  observed.unsubscribe();
});

test('fresh phone browser verifies implicit recovery after subscription without persistent auth writes', async t => {
  const h = await browserFixture(t);
  const client = h.track(recoveryFactory()());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.requests.length, 0, 'Verification must wait for explicit initialization');
  const observed = await initializeAndObserve(client);
  assert.equal(observed.result.error, null);
  assert.deepEqual(observed.events.filter(({event}) => event === 'PASSWORD_RECOVERY'), [{event: 'PASSWORD_RECOVERY', userId: user.id}]);
  assert.equal((await client.auth.getSession()).data.session?.user.id, user.id);
  assert.equal(h.requests.filter(request => request.url.pathname === '/auth/v1/user').length, 1);
  assert.equal(h.window.location.hash, '', 'Verified bearer tokens are removed from the address bar');
  assert.deepEqual(h.cookieWrites, []);
  assert.deepEqual(h.localWrites, []);
  assert.equal(h.cookieValues.get('unrelated-dashboard-cookie'), 'preserve');
  assert.equal(h.localValues.get('unrelated-local-value'), 'preserve');
  // Reopening the scrubbed URL cannot inherit the ephemeral recovery session.
  const reopened = h.track(recoveryFactory()());
  const second = await initializeAndObserve(reopened);
  assert.equal(second.events.some(({event}) => event === 'PASSWORD_RECOVERY'), false);
  assert.equal((await reopened.auth.getSession()).data.session, null);
  observed.unsubscribe();
  second.unsubscribe();
});

test('expired or already-used provider link errors never create recovery proof', async t => {
  const h = await browserFixture(t, {
    url: 'https://www.studiooscloud.com/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
  });
  const client = h.track(recoveryFactory()());
  const observed = await initializeAndObserve(client);
  assert.match(observed.result.error?.message ?? '', /invalid|expired/i);
  assert.equal(observed.events.some(({event}) => event === 'PASSWORD_RECOVERY'), false);
  assert.equal((await client.auth.getSession()).data.session, null);
  assert.equal(h.requests.length, 0);
  observed.unsubscribe();
});

test('rejected recovery bearer is denied without accepting an existing browser session', async t => {
  const h = await browserFixture(t, {
    rejectUser: true,
    cookies: {[storageKey]: JSON.stringify(session())},
  });
  const client = h.track(recoveryFactory()());
  const observed = await initializeAndObserve(client);
  assert.ok(observed.result.error);
  assert.equal(observed.events.some(({event}) => event === 'PASSWORD_RECOVERY'), false);
  assert.equal((await client.auth.getSession()).data.session, null);
  assert.deepEqual(h.cookieWrites, []);
  observed.unsubscribe();
});

test('opening reset without a recovery link cannot inherit a dashboard cookie', async t => {
  const h = await browserFixture(t, {
    url: 'https://www.studiooscloud.com/reset-password',
    cookies: {[storageKey]: JSON.stringify(session())},
  });
  const client = h.track(recoveryFactory()());
  const observed = await initializeAndObserve(client);
  assert.equal(observed.result.error, null);
  assert.equal(observed.events.some(({event}) => event === 'PASSWORD_RECOVERY'), false);
  assert.equal((await client.auth.getSession()).data.session, null);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.cookieWrites, []);
  observed.unsubscribe();
});

test('forgot-password requests remain cross-device implicit even with an unrelated code query', async t => {
  const h = await browserFixture(t, {url: 'https://www.studiooscloud.com/forgot-password?code=unrelated'});
  const client = h.track(recoveryFactory()(false));
  const {error} = await client.auth.resetPasswordForEmail('owner@example.invalid', {
    redirectTo: 'https://www.studiooscloud.com/reset-password',
  });
  assert.equal(error, null);
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.url.pathname, '/auth/v1/recover');
  assert.equal(request.url.searchParams.get('redirect_to'), 'https://www.studiooscloud.com/reset-password');
  assert.equal(request.body.code_challenge, null);
  assert.equal(request.body.code_challenge_method, null);
  assert.deepEqual(h.cookieWrites, []);
  assert.deepEqual(h.localWrites, []);
});

test('legacy same-browser PKCE link still exchanges the original cookie verifier exactly once', async t => {
  const encoded = 'base64-' + Buffer.from(JSON.stringify('fixture-verifier/PASSWORD_RECOVERY')).toString('base64url');
  const split = Math.floor(encoded.length / 2);
  const h = await browserFixture(t, {
    url: 'https://www.studiooscloud.com/reset-password?code=fixture-recovery-code',
    cookies: {
      [`${storageKey}-code-verifier.0`]: encoded.slice(0, split),
      [`${storageKey}-code-verifier.1`]: encoded.slice(split),
    },
  });
  const client = h.track(recoveryFactory()());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.requests.length, 0, 'Automatic initialization must not consume the recovery marker');
  const result = await client.auth.exchangeCodeForSession('fixture-recovery-code');
  assert.equal(result.error, null);
  assert.equal(result.data.redirectType, 'PASSWORD_RECOVERY');
  const exchanges = h.requests.filter(request => request.url.searchParams.get('grant_type') === 'pkce');
  assert.equal(exchanges.length, 1);
  assert.deepEqual(exchanges[0].body, {auth_code: 'fixture-recovery-code', code_verifier: 'fixture-verifier'});
  assert.equal((await client.auth.getSession()).data.session?.user.id, user.id);
  assert.equal([...h.cookieValues.keys()].some(key => key.startsWith(`${storageKey}-code-verifier`)), false);
});

test('legacy PKCE code on another browser is denied when the original verifier is absent', async t => {
  const h = await browserFixture(t, {url: 'https://www.studiooscloud.com/reset-password?code=fixture-recovery-code'});
  const client = h.track(recoveryFactory()());
  const result = await client.auth.exchangeCodeForSession('fixture-recovery-code');
  assert.ok(result.error);
  assert.equal(result.data.session, null);
  assert.equal(h.requests.length, 0);
});

test('an ordinary PKCE sign-in code does not gain a password-recovery marker', async t => {
  const h = await browserFixture(t, {
    url: 'https://www.studiooscloud.com/reset-password?code=ordinary-sign-in-code',
    cookies: {[`${storageKey}-code-verifier`]: JSON.stringify('fixture-verifier')},
  });
  const client = h.track(recoveryFactory()());
  const result = await client.auth.exchangeCodeForSession('ordinary-sign-in-code');
  assert.equal(result.error, null);
  assert.equal(result.data.session?.user.id, user.id);
  assert.equal(result.data.redirectType, null,
    'A valid ordinary session alone cannot authorize a password-reset page');
});

test('an expired or reused legacy code cannot create recovery authorization', async t => {
  const h = await browserFixture(t, {
    url: 'https://www.studiooscloud.com/reset-password?code=used-recovery-code',
    rejectCode: true,
    cookies: {[`${storageKey}-code-verifier`]: JSON.stringify('fixture-verifier/PASSWORD_RECOVERY')},
  });
  const client = h.track(recoveryFactory()());
  const result = await client.auth.exchangeCodeForSession('used-recovery-code');
  assert.match(result.error?.message ?? '', /expired|used/);
  assert.equal(result.data.session, null);
  assert.equal(h.cookieValues.has(`${storageKey}-code-verifier`), false);
});
