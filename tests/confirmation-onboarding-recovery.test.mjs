import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function load(path, overrides = {}, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(source(path), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
  }).outputText;
  new Function('require', 'exports', ...Object.keys(globals), compiled)(name => {
    if (name in overrides) return overrides[name];
    assert.ok(name.startsWith('@/lib/'), 'Unexpected dependency: ' + name);
    return load(name.slice(2) + '.ts', overrides, globals);
  }, exports, ...Object.values(globals));
  return exports;
}

const {resolveAdminSignupStatus} = load('lib/admin-signup-status.ts');
const {resolveSubscriptionAccess} = load('lib/subscription-access.ts');
const now = Date.parse('2026-10-04T21:00:00Z');
const incomplete = {subscription_status: 'trial', created_at: '2026-10-03T06:11:00Z'};
const complete = {...incomplete, subscription_plan_code: 'studio', trial_starts_at: '2026-10-01T20:00:00Z', trial_ends_at: '2026-10-31T20:00:00Z'};

test('directory does not report a placeholder signup as a provisioned Studio trial', () => {
  const entitlement = resolveSubscriptionAccess(incomplete, now);
  assert.equal(entitlement.trialActive, true);
  assert.equal(entitlement.planCode, 'studio');
  assert.deepEqual(resolveAdminSignupStatus(incomplete, now), {
    signupIncomplete: true, subscriptionPlanCode: null, trialEndsAt: null,
    trialStatus: 'incomplete', trialDaysRemaining: 0,
  });
  const rows = [incomplete, complete].map(row => resolveAdminSignupStatus(row, now));
  assert.equal(rows.filter(row => row.trialStatus === 'active').length, 1);
  assert.deepEqual(resolveSubscriptionAccess(incomplete, now), entitlement, 'Reporting leaves entitlement policy intact');
});

test('directory flags partially initialized or blank-plan trials and preserves stored expiry', () => {
  for (const patch of [{subscription_plan_code: null}, {subscription_plan_code: ' '}, {trial_starts_at: null}, {trial_ends_at: null}]) {
    const row = {...complete, ...patch};
    const result = resolveAdminSignupStatus(row, now);
    assert.equal(result.signupIncomplete, true);
    assert.equal(result.trialStatus, 'incomplete');
    assert.equal(result.trialDaysRemaining, 0);
    assert.equal(result.trialEndsAt, row.trial_ends_at);
  }
});

test('directory preserves complete, expired, owner, billing-linked and canceled classifications', () => {
  assert.equal(resolveAdminSignupStatus(complete, now).trialStatus, 'active');
  assert.equal(resolveAdminSignupStatus({...complete, trial_ends_at: '2026-09-01T00:00:00Z'}, now).trialStatus, 'expired');
  for (const row of [
    {...incomplete, is_platform_admin: true},
    {...incomplete, stripe_subscription_id: 'sub_existing'},
    {...incomplete, subscription_status: 'active'},
    {...incomplete, subscription_status: 'canceled'},
  ]) assert.equal(resolveAdminSignupStatus(row, now).signupIncomplete, false);
  assert.equal(resolveAdminSignupStatus({...incomplete, is_platform_admin: true}, now).trialStatus, 'owner');
  assert.equal(resolveAdminSignupStatus({...incomplete, stripe_subscription_id: 'sub_existing', subscription_status: 'active'}, now).trialStatus, 'converted');
});

/** Execute the actual callback page with a tiny hook scheduler and controlled transport/timers. */
function callbackHarness({session = {access_token: 'test-token', user: {email: 'person@example.invalid'}}, code = 'one-time-code'} = {}) {
  const slots = [], pendingEffects = [], requests = [], timers = new Map();
  let hook = 0, dirty = false, tree, nextTimer = 1, exchangeCalls = 0, signOutCalls = 0;
  const jsx = (type, props) => ({type, props});
  const react = {
    useState(initial) {
      const index = hook++;
      slots[index] ??= {kind: 'state', value: initial};
      return [slots[index].value, update => {
        slots[index].value = typeof update === 'function' ? update(slots[index].value) : update;
        dirty = true;
      }];
    },
    useMemo(factory) {
      const index = hook++;
      slots[index] ??= {kind: 'memo', value: factory()};
      return slots[index].value;
    },
    useRef(initial) {
      const index = hook++;
      slots[index] ??= {kind: 'ref', value: {current: initial}};
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = hook++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          slots[index] = {kind: 'effect', deps, effect, cleanup: effect()};
        });
      }
    },
  };
  const browser = {location: {href: 'https://example.invalid/auth/callback' + (code ? '?code=' + code : ''), hash: ''}};
  const fetcher = (url, options) => new Promise((resolve, reject) => {
    requests.push({url, options, resolve, reject});
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true});
  });
  const globals = {
    fetch: fetcher, window: browser,
    setTimeout: (fn, delay) => { const id = nextTimer++; timers.set(id, {fn, delay}); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const supabase = {auth: {
    exchangeCodeForSession: async () => {exchangeCalls++; return {error: null};},
    getSession: async () => ({data: {session}}),
    signOut: async () => {signOutCalls++;},
  }};
  const overrides = {
    react, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'fragment'},
    'next/link': 'link', '@/components/site-header': {SiteHeader: 'header'},
    '@/components/site-footer': {SiteFooter: 'footer'},
    '@/lib/supabase/client': {createClient: () => supabase},
  };
  const {default: Page} = load('app/auth/callback/page.tsx', overrides, globals);
  function render() {
    dirty = false; hook = 0; tree = Page();
    while (pendingEffects.length) pendingEffects.shift()();
  }
  async function flush() {
    for (let i = 0; i < 25; i++) {await Promise.resolve(); if (dirty) render();}
  }
  function descendants(node) {
    if (node == null || typeof node === 'boolean') return [];
    if (Array.isArray(node)) return node.flatMap(descendants);
    return typeof node === 'object' ? [node, ...descendants(node.props?.children)] : [node];
  }
  render();
  return {
    requests, timers, browser, flush,
    state: () => slots.find(slot => slot?.kind === 'state' && slot.value?.kind)?.value,
    text: () => descendants(tree).filter(node => typeof node === 'string' || typeof node === 'number').join(' '),
    retry: () => descendants(tree).find(node => node.type === 'button').props.onClick(),
    exchangeCalls: () => exchangeCalls, signOutCalls: () => signOutCalls,
    replayEffects() {for (const slot of slots) if (slot?.kind === 'effect') {slot.cleanup?.();slot.cleanup = slot.effect();}},
    runTimers(delay) {for (const [id, timer] of [...timers]) if (timer.delay === delay) {timers.delete(id);timer.fn();}},
    unmount() {for (const slot of slots) if (slot?.kind === 'effect') slot.cleanup?.();},
  };
}
const ready = {ok: true, signedIn: true, trialActive: true, trialDaysRemaining: 30};

test('confirmation initializes the authenticated account before success or dashboard navigation', async () => {
  const h = callbackHarness();
  await h.flush();
  assert.deepEqual(h.state(), {kind: 'loading', confirmed: true});
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/studio-os-app/status');
  assert.equal(h.requests[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(h.requests[0].options.credentials, 'include');
  assert.equal([...h.timers.values()].some(timer => timer.delay === 1800), false);
  h.requests[0].resolve(Response.json(ready));
  await h.flush();
  assert.equal(h.state().kind, 'success');
  assert.match(h.text(), /trial is ready with 30 days remaining/);
  h.runTimers(1800);
  assert.equal(h.browser.location.href, '/dashboard');
  assert.equal(h.signOutCalls(), 0);
  h.unmount();
});

test('temporary setup failure keeps confirmation/session, offers retry and never repeats the one-time code', async () => {
  const h = callbackHarness(); await h.flush();
  h.requests[0].resolve(Response.json({ok: false, signedIn: true}, {status: 503}));
  await h.flush();
  assert.equal(h.state().kind, 'setup-error');
  assert.match(h.text(), /Email confirmed/);
  assert.match(h.text(), /Try account setup again/);
  assert.doesNotMatch(h.text(), /Create a new account/);
  assert.equal(h.signOutCalls(), 0);
  h.runTimers(1800); assert.match(h.browser.location.href, /auth\/callback/);
  h.retry(); await h.flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.exchangeCalls(), 1);
  h.requests[1].resolve(Response.json(ready)); await h.flush();
  assert.equal(h.state().kind, 'success'); h.unmount();
});

test('strict effect replay shares the one-use confirmation exchange and canceled auth cannot update state', async () => {
  const h = callbackHarness(); h.replayEffects(); await h.flush();
  assert.equal(h.exchangeCalls(), 1);
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(Response.json(ready)); await h.flush();
  assert.equal(h.state().kind, 'success'); h.unmount();
  const abandoned = callbackHarness(); abandoned.unmount(); await abandoned.flush();
  assert.equal(abandoned.requests.length, 0);
  assert.deepEqual(abandoned.state(), {kind: 'loading'});
});

test('setup timeout is bounded and canceling cannot trigger stale success or redirect', async () => {
  const h = callbackHarness(); await h.flush();
  h.runTimers(15000); await h.flush();
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.state().kind, 'setup-error'); assert.match(h.text(), /took too long/);
  h.retry(); await h.flush(); h.unmount();
  h.requests[1].resolve(Response.json(ready)); await h.flush();
  assert.notEqual(h.state().kind, 'success');
  assert.equal(h.timers.size, 0);
  h.runTimers(1800); assert.match(h.browser.location.href, /auth\/callback/);
});

test('unmount after successful setup clears the scheduled dashboard redirect', async () => {
  const h = callbackHarness({code: ''}); await h.flush();
  h.requests[0].resolve(Response.json(ready)); await h.flush();
  assert.equal(h.state().kind, 'success'); h.unmount();
  assert.equal(h.timers.size, 0);
  h.runTimers(1800); assert.match(h.browser.location.href, /auth\/callback/);
});

test('unconfirmed callback has no setup request; malformed or unauthenticated setup never claims success', async () => {
  const absent = callbackHarness({session: null}); await absent.flush();
  assert.equal(absent.state().kind, 'error'); assert.equal(absent.requests.length, 0); absent.unmount();
  for (const [body, status] of [[{}, 200], [{ok: true, signedIn: false}, 200], [{ok: false}, 401],
    [{...ready, trialDaysRemaining: -1}, 200], [{...ready, trialDaysRemaining: 0}, 200],
    [{...ready, trialDaysRemaining: 1.5}, 200], [{...ready, trialDaysRemaining: null}, 200],
    [{...ready, trialDaysRemaining: '30'}, 200]]) {
    const h = callbackHarness(); await h.flush(); h.requests[0].resolve(Response.json(body, {status}));
    await h.flush(); assert.equal(h.state().kind, 'setup-error');
    assert.equal(h.signOutCalls(), 0); assert.doesNotMatch(h.text(), /Create a new account/); h.unmount();
  }
});
