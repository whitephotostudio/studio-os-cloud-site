import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Execute the real page and its hooks. Auth is mocked only at the network
// boundary; no email is sent and no real account password is changed.
function pageHarness({initialEvent = 'PASSWORD_RECOVERY', initializeError = null,
  getUserId = () => 'recovery-user', mfaRequired = false, verifyError = null,
  path = 'app/reset-password/page.tsx', legacyCode = '', legacyResult,
  deferExchange = false} = {}) {
  const slots = [], pendingEffects = [], timers = new Map(), calls = [];
  const listeners = new Set();
  let hook = 0, dirty = false, mounted = true, tree, nextTimer = 1;
  let assurance = mfaRequired ? 'aal1' : 'aal2';
  let resolveExchange;
  const exchangeResult = legacyResult ?? {data: {session: {user: {id: 'recovery-user'}}, redirectType: 'PASSWORD_RECOVERY'}, error: null};
  const jsx = (type, props) => ({type, props});
  const react = {
    useState(initial) {
      const index = hook++;
      if (!slots[index]) slots[index] = {value: typeof initial === 'function' ? initial() : initial};
      return [slots[index].value, update => {
        assert.ok(mounted, 'no state update after page unmount');
        slots[index].value = typeof update === 'function' ? update(slots[index].value) : update;
        dirty = true;
      }];
    },
    useRef(initial) {const index = hook++; slots[index] ??= {value: {current: initial}}; return slots[index].value;},
    useCallback(callback, deps) {
      const index = hook++;
      if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) slots[index] = {value: callback, deps};
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = hook++;
      if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) {
        pendingEffects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = {deps, effect, cleanup: effect()};
        });
      }
    },
  };
  const browser = {
    location: {href: `https://example.invalid/${path.split('/')[1]}${legacyCode ? '?code=' + legacyCode : ''}`, origin: 'https://example.invalid'},
    history: {replaceState(_state, _unused, href) {calls.push(['replaceUrl', href]); browser.location.href = String(href);}},
    setTimeout(fn, delay) {const id = nextTimer++; timers.set(id, {fn, delay}); return id;},
    clearTimeout(id) {timers.delete(id);},
  };
  function emit(event, userId = 'recovery-user') {
    for (const listener of listeners) listener(event, userId ? {user: {id: userId}} : null);
  }
  const auth = {
    onAuthStateChange(callback) {
      calls.push(['subscribe']); listeners.add(callback);
      return {data: {subscription: {unsubscribe() {calls.push(['unsubscribe']); listeners.delete(callback);}}}};
    },
    async initialize() {
      calls.push(['initialize']);
      // A callback before initialize resolves catches the event-order bug.
      if (initialEvent) emit(initialEvent);
      return {error: initializeError};
    },
    async exchangeCodeForSession(code) {
      calls.push(['exchange', code]); emit('SIGNED_IN');
      if (deferExchange) return new Promise(resolve => {resolveExchange = resolve;});
      return exchangeResult;
    },
    async resetPasswordForEmail(email, options) {calls.push(['sendReset', email, options]); return {error: null};},
    async getUser() {calls.push(['getUser']); return {data: {user: {id: getUserId()}}, error: null};},
    async updateUser(input) {calls.push(['updateUser', input]); return {data: {}, error: null};},
    mfa: {
      async getAuthenticatorAssuranceLevel() {
        calls.push(['assurance']); return {data: {currentLevel: assurance, nextLevel: mfaRequired ? 'aal2' : assurance}, error: null};
      },
      async listFactors() {calls.push(['factors']); return {data: {totp: [{id: 'verified-factor', status: 'verified'}]}, error: null};},
      async challenge(input) {calls.push(['challenge', input]); return {data: {id: 'challenge'}, error: null};},
      async verify(input) {
        calls.push(['verify', input]); if (!verifyError) assurance = 'aal2';
        return {data: {}, error: verifyError};
      },
    },
  };
  const overrides = {
    react, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'fragment'},
    'next/link': {__esModule: true, default: 'link'},
    '@/components/site-header': {SiteHeader: 'header'}, '@/components/site-footer': {SiteFooter: 'footer'},
    '@/lib/supabase/password-recovery-client': {createPasswordRecoveryClient(allowLegacy) {calls.push(['client', allowLegacy]); return {auth};}},
  };
  function load(file) {
    const exports = {};
    const compiled = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
    }).outputText;
    new Function('require', 'exports', 'window', compiled)(name => {
      if (name in overrides) return overrides[name];
      assert.ok(name.startsWith('@/lib/'), name); return load(name.slice(2) + '.ts');
    }, exports, browser);
    return exports;
  }
  const {default: Page} = load(path);
  function render() {dirty = false; hook = 0; tree = Page(); while (pendingEffects.length) pendingEffects.shift()();}
  function nodes(node) {
    if (node == null || typeof node === 'boolean') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [node];
  }
  async function flush() {for (let i = 0; i < 35; i++) {await Promise.resolve(); if (dirty) render();}}
  render();
  return {
    calls, emit, flush, timers,
    text: () => nodes(tree).filter(node => typeof node === 'string' || typeof node === 'number').join(' '),
    links: () => nodes(tree).filter(node => node.type === 'link'),
    fields: () => nodes(tree).filter(node => node.type === 'input'),
    async change(id, value) {nodes(tree).find(node => node.type === 'input' && node.props.id === id).props.onChange({target: {value}}); await flush();},
    async submit() {
      const form = nodes(tree).find(node => node.type === 'form'); assert.ok(form, 'a usable form is displayed');
      const submitted = form.props.onSubmit({preventDefault() {}}); if (dirty) render(); await submitted; await flush();
    },
    runTimers(delay) {for (const [id, timer] of [...timers]) if (timer.delay === delay) {timers.delete(id); timer.fn();}},
    unmount() {for (const slot of slots) slot.cleanup?.(); mounted = false;},
    replayEffects() {for (const slot of slots) if (slot.effect) {slot.cleanup?.(); slot.cleanup = slot.effect();}},
    resolveExchange() {assert.ok(resolveExchange, 'an exchange is pending'); resolveExchange(exchangeResult);},
  };
}

test('recovery subscribes before initialization and retains its client through password entry', async () => {
  const h = pageHarness(); await h.flush();
  assert.deepEqual(h.calls.slice(0, 3).map(call => call[0]), ['client', 'subscribe', 'initialize']);
  assert.match(h.text(), /Set a new password/);
  await h.change('new-password', 'ValidPass1!'); await h.change('confirm-password', 'ValidPass1!');
  assert.equal(h.calls.filter(call => call[0] === 'client').length, 1);
  assert.equal(h.timers.size, 0);
});

test('ordinary sign-in and initial session events never authorize a password reset', async () => {
  for (const initialEvent of ['SIGNED_IN', 'INITIAL_SESSION']) {
    const h = pageHarness({initialEvent}); await h.flush(); h.runTimers(10000); await h.flush();
    assert.match(h.text(), /Request a new reset link/);
    assert.equal(h.fields().length, 0);
    assert.equal(h.calls.filter(call => call[0] === 'getUser' || call[0] === 'updateUser').length, 0);
  }
});

test('a rejected recovery URL immediately gives a new-link action', async () => {
  const h = pageHarness({initialEvent: null, initializeError: Error('Expired link')}); await h.flush();
  assert.match(h.text(), /could not be verified/);
  assert.equal(h.links()[0].props.href, '/forgot-password');
  assert.equal(h.timers.size, 0);
});

test('server-verified user mismatch cannot reach the password form', async () => {
  const h = pageHarness({getUserId: () => 'another-user'}); await h.flush();
  assert.match(h.text(), /Request a new reset link/);
  assert.equal(h.fields().length, 0);
  assert.equal(h.calls.filter(call => call[0] === 'updateUser').length, 0);
});

test('MFA recovery requires a verified authenticator before showing new password fields', async () => {
  const h = pageHarness({mfaRequired: true}); await h.flush();
  assert.match(h.text(), /Two-step verification protects this account/);
  assert.equal(h.fields().some(field => field.props.id === 'new-password'), false);
  await h.change('reset-mfa-code', '123456'); await h.submit();
  assert.match(h.text(), /Set a new password/);
  assert.deepEqual(h.calls.find(call => call[0] === 'verify')[1], {factorId: 'verified-factor', challengeId: 'challenge', code: '123456'});
  assert.equal(h.calls.filter(call => call[0] === 'updateUser').length, 0);
});

test('a rejected authenticator code cannot bypass MFA recovery', async () => {
  const h = pageHarness({mfaRequired: true, verifyError: Error('Wrong code')}); await h.flush();
  await h.change('reset-mfa-code', '123456'); await h.submit();
  assert.match(h.text(), /verification code was not accepted/);
  assert.equal(h.fields().some(field => field.props.id === 'new-password'), false);
  assert.equal(h.calls.filter(call => call[0] === 'updateUser').length, 0);
});

test('password submission rechecks recovery identity and refuses a changed account', async () => {
  let userId = 'recovery-user';
  const h = pageHarness({getUserId: () => userId}); await h.flush();
  await h.change('new-password', 'ValidPass1!'); await h.change('confirm-password', 'ValidPass1!');
  userId = 'another-user'; await h.submit();
  assert.match(h.text(), /Request a new reset link/);
  assert.equal(h.calls.filter(call => call[0] === 'updateUser').length, 0);
});

test('successful recovery updates only the verified account and returns to sign-in', async () => {
  const h = pageHarness(); await h.flush();
  await h.change('new-password', 'ValidPass1!'); await h.change('confirm-password', 'ValidPass1!'); await h.submit();
  assert.deepEqual(h.calls.filter(call => call[0] === 'updateUser'), [['updateUser', {password: 'ValidPass1!'}]]);
  assert.match(h.text(), /Password updated/);
  assert.equal(h.links()[0].props.href, '/sign-in');
  assert.equal(h.fields().length, 0);
});

test('recovery sign-out invalidates the form and clears sensitive inputs', async () => {
  const h = pageHarness(); await h.flush(); await h.change('new-password', 'ValidPass1!');
  h.emit('SIGNED_OUT', null); await h.flush();
  assert.match(h.text(), /session is no longer valid/); assert.equal(h.fields().length, 0);
  assert.equal(h.calls.filter(call => call[0] === 'updateUser').length, 0);
});

test('page teardown removes recovery listeners and the link timeout', async () => {
  const h = pageHarness({initialEvent: null}); await h.flush(); assert.equal(h.timers.size, 1);
  h.unmount(); h.emit('PASSWORD_RECOVERY'); h.runTimers(10000); await h.flush();
  assert.equal(h.timers.size, 0); assert.ok(h.calls.some(call => call[0] === 'unsubscribe'));
});

test('new reset requests use the device-independent client and a reset-page redirect', async () => {
  const h = pageHarness({path: 'app/forgot-password/page.tsx'}); await h.flush();
  const emailField = h.fields().find(field => field.props.type === 'email');
  assert.ok(emailField?.props.id);
  await h.change(emailField.props.id, '  person@example.invalid  '); await h.submit();
  assert.deepEqual(h.calls.find(call => call[0] === 'client'), ['client', false]);
  assert.deepEqual(h.calls.find(call => call[0] === 'sendReset'), ['sendReset', 'person@example.invalid', {redirectTo: 'https://example.invalid/reset-password'}]);
  assert.match(h.text(), /Check your email/);
});

test('legacy PKCE codes require an explicit recovery marker before opening the form', async () => {
  const h = pageHarness({legacyCode: 'one-use-code', initialEvent: null}); await h.flush();
  assert.deepEqual(h.calls.find(call => call[0] === 'exchange'), ['exchange', 'one-use-code']);
  assert.match(h.text(), /Set a new password/);
  assert.equal(new URL(h.calls.find(call => call[0] === 'replaceUrl')[1]).searchParams.has('code'), false);
});

test('ordinary PKCE codes and failed exchanges never authorize password recovery', async () => {
  for (const legacyResult of [
    {data: {session: {user: {id: 'recovery-user'}}, redirectType: null}, error: null},
    {data: {session: null, redirectType: 'PASSWORD_RECOVERY'}, error: Error('Missing local verifier')},
  ]) {
    const h = pageHarness({legacyCode: 'unproven-code', initialEvent: null, legacyResult}); await h.flush();
    assert.match(h.text(), /Request a new reset link/); assert.equal(h.fields().length, 0);
    assert.equal(h.calls.filter(call => call[0] === 'getUser' || call[0] === 'updateUser').length, 0);
  }
});

test('React effect replay exchanges a legacy one-use code only once', async () => {
  const h = pageHarness({legacyCode: 'one-use-code', initialEvent: null, deferExchange: true});
  h.replayEffects();
  assert.equal(h.calls.filter(call => call[0] === 'exchange').length, 1);
  h.resolveExchange(); await h.flush();
  assert.match(h.text(), /Set a new password/);
});

test('a completed legacy exchange cannot change the URL after page teardown', async () => {
  const h = pageHarness({legacyCode: 'one-use-code', initialEvent: null, deferExchange: true});
  h.unmount(); h.resolveExchange(); await h.flush();
  assert.equal(h.calls.filter(call => call[0] === 'replaceUrl').length, 0);
});
