import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {AuthRetryableFetchError} from '@supabase/supabase-js';

function pageHarness(path, {auth = {}, blockedStorage = false, search = ''} = {}) {
  const slots = [], effects = [], requests = [], timers = new Map();
  let hook = 0, dirty = false, tree, nextTimer = 1;
  const jsx = (type, props) => ({type, props});
  const react = {
    useState(initial) {
      const index = hook++;
      slots[index] ??= {value: initial};
      return [slots[index].value, update => {
        slots[index].value = typeof update === 'function' ? update(slots[index].value) : update;
        dirty = true;
      }];
    },
    useRef(initial) {const index = hook++; slots[index] ??= {value: {current: initial}}; return slots[index].value;},
    useMemo(factory) {const index = hook++; slots[index] ??= {value: factory()}; return slots[index].value;},
    useEffect(effect, deps) {
      const index = hook++;
      if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) {
        effects.push(() => {slots[index]?.cleanup?.(); slots[index] = {deps, cleanup: effect()};});
      }
    },
  };
  const storage = {getItem() {if (blockedStorage) throw Error('Storage is disabled'); return null;}, setItem() {}, removeItem() {}};
  const browser = {
    location: {href: 'https://example.invalid/' + path.split('/')[1], origin: 'https://example.invalid', pathname: '/' + path.split('/')[1], search},
    localStorage: storage, sessionStorage: storage,
    requestAnimationFrame(fn) {fn(); return 1;}, cancelAnimationFrame() {},
  };
  const supabase = {auth: {
    signUp: async () => ({data: {user: {id: 'new-user', identities: [{id: 'identity'}]}, session: null}, error: null}),
    signInWithPassword: async () => ({data: {user: {id: 'existing-user'}, session: {access_token: 'test-token'}}, error: null}),
    getSession: async () => ({data: {session: {access_token: 'verified-token'}}, error: null}),
    resend: async () => ({error: null}),
    resetPasswordForEmail: async () => ({error: null}),
    mfa: {
      getAuthenticatorAssuranceLevel: async () => ({data: {currentLevel: 'aal1', nextLevel: 'aal1'}, error: null}),
      listFactors: async () => ({data: {totp: [{id: 'factor', status: 'verified'}]}, error: null}),
      challenge: async () => ({data: {id: 'challenge'}, error: null}),
      verify: async () => ({data: {}, error: null}),
      ...auth.mfa,
    },
    ...Object.fromEntries(Object.entries(auth).filter(([key]) => key !== 'mfa')),
  }};
  const globals = {
    window: browser,
    fetch: async (url, options) => {requests.push({url, options}); return Response.json({ok: true});},
    setTimeout: (fn, delay) => {const id = nextTimer++; timers.set(id, {fn, delay}); return id;},
    clearTimeout: id => timers.delete(id),
  };
  const overrides = {
    react, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'fragment'}, 'next/link': 'link',
    '@/components/site-header': {SiteHeader: 'header'}, '@/components/site-footer': {SiteFooter: 'footer'},
    '@/lib/supabase/client': {createClient: () => supabase},
  };
  function load(file) {
    const exports = {};
    const compiled = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
    }).outputText;
    new Function('require', 'exports', ...Object.keys(globals), compiled)(name => {
      if (name in overrides) return overrides[name];
      assert.ok(name.startsWith('@/lib/'), name); return load(name.slice(2) + '.ts');
    }, exports, ...Object.values(globals));
    return exports;
  }
  const {default: Page} = load(path);
  function render() {dirty = false; hook = 0; tree = Page(); while (effects.length) effects.shift()();}
  function nodes(node) {
    if (node == null || typeof node === 'boolean') return [];
    if (Array.isArray(node)) return node.flatMap(value => nodes(value));
    return typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [node];
  }
  async function flush() {for (let i = 0; i < 25; i++) {await Promise.resolve(); if (dirty) render();}}
  render();
  return {
    requests, timers, browser, flush,
    submit: async () => {const result = nodes(tree).find(node => node.type === 'form').props.onSubmit({preventDefault() {}}); if (dirty) render(); await result; await flush();},
    clickButton: async text => {const result = nodes(tree).find(node => node.type === 'button' && nodes(node.props.children).filter(value => typeof value === 'string').join(' ').includes(text)).props.onClick(); if (dirty) render(); await result; await flush();},
    change: async (selector, value) => {nodes(tree).find(node => node.type === 'input' && selector(node.props)).props.onChange({target: {value}}); await flush();},
    text: () => nodes(tree).filter(node => typeof node === 'string' || typeof node === 'number').join(' '),
    submitButton: () => nodes(tree).find(node => node.type === 'button' && node.props.type === 'submit'),
    button: text => nodes(tree).find(node => node.type === 'button' && nodes(node.props.children).filter(value => typeof value === 'string').join(' ').includes(text)),
    fields: () => nodes(tree).filter(node => node.type === 'input'),
    labels: () => nodes(tree).filter(node => node.type === 'label'),
    runTimers(delay) {for (const [id, timer] of [...timers]) if (timer.delay === delay) {timers.delete(id); timer.fn();}},
  };
}

test('signup network exceptions leave a usable retry form instead of a permanent busy button', async () => {
  const h = pageHarness('app/sign-up/page.tsx', {auth: {signUp: async () => {throw Error('Network connection lost');}}});
  await h.flush(); if (h.browser.location.pathname === '/sign-up') await h.change(props => props.autoComplete === 'new-password', 'ValidPass1!'); await h.submit();
  assert.match(h.text(), /could not reach the sign-up service.*Check your connection/);
  assert.equal(h.submitButton().props.disabled, false);
  assert.doesNotMatch(h.text(), /Account created/);
});

test('auth forms stay disabled until their client effect enables managed submission', async () => {
  for (const path of ['app/sign-up/page.tsx', 'app/sign-in/page.tsx', 'app/forgot-password/page.tsx']) {
    const h = pageHarness(path);
    assert.equal(h.submitButton().props.disabled, true, path);
    await h.flush();
    assert.equal(h.submitButton().props.disabled, false, path);
  }
});

test('Supabase returned retryable fetch errors receive connection guidance, including cross-realm errors', async () => {
  for (const error of [new AuthRetryableFetchError('Failed to fetch', 0), {name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0}]) {
    const h = pageHarness('app/sign-up/page.tsx', {auth: {signUp: async () => ({data: {user: null, session: null}, error})}});
    await h.flush(); await h.change(props => props.autoComplete === 'new-password', 'ValidPass1!'); await h.submit();
    assert.match(h.text(), /could not reach the sign-up service.*Check your connection/);
    assert.doesNotMatch(h.text(), /Failed to fetch/);
    assert.equal(h.submitButton().props.disabled, false);
  }
});

test('disabled browser storage cannot break successful signup or suppress its confirmation instructions', async () => {
  const h = pageHarness('app/sign-up/page.tsx', {blockedStorage: true});
  await h.flush(); if (h.browser.location.pathname === '/sign-up') await h.change(props => props.autoComplete === 'new-password', 'ValidPass1!'); await h.submit();
  assert.match(h.text(), /Account created/);
  assert.match(h.text(), /Check your email/);
  assert.equal(h.requests.filter(request => request.url === '/api/onboarding/welcome').length, 1);
  assert.equal(h.requests.filter(request => request.url === '/api/marketing/conversions').length, 1);
});

test('signup does not claim account creation when the auth provider returns no account', async () => {
  const h = pageHarness('app/sign-up/page.tsx', {auth: {signUp: async () => ({data: {user: null, session: null}, error: null})}});
  await h.flush(); if (h.browser.location.pathname === '/sign-up') await h.change(props => props.autoComplete === 'new-password', 'ValidPass1!'); await h.submit();
  assert.doesNotMatch(h.text(), /Account created/);
  assert.equal(h.submitButton().props.disabled, false);
  assert.equal(h.requests.length, 0);
});

test('MFA assurance outages cannot silently proceed into the dashboard', async () => {
  const h = pageHarness('app/sign-in/page.tsx', {auth: {mfa: {getAuthenticatorAssuranceLevel: async () => ({data: null, error: Error('Verification service unavailable')})}}});
  await h.flush(); if (h.browser.location.pathname === '/sign-up') await h.change(props => props.autoComplete === 'new-password', 'ValidPass1!'); await h.submit();
  assert.match(h.text(), /Verification service unavailable/);
  assert.equal(h.submitButton().props.disabled, false);
  assert.equal(h.requests.length, 0);
  assert.match(h.browser.location.href, /sign-in/);
});

test('MFA challenge network exceptions preserve the code form and re-enable verification', async () => {
  const h = pageHarness('app/sign-in/page.tsx', {auth: {mfa: {
    getAuthenticatorAssuranceLevel: async () => ({data: {currentLevel: 'aal1', nextLevel: 'aal2'}, error: null}),
    challenge: async () => {throw new TypeError('Failed to fetch');},
  }}});
  await h.flush(); if (h.browser.location.pathname === '/sign-up') await h.change(props => props.autoComplete === 'new-password', 'ValidPass1!'); await h.submit();
  assert.match(h.text(), /Two-factor authentication/);
  await h.change(props => props.autoComplete === 'one-time-code', '123456');
  await h.submit();
  assert.match(h.text(), /could not reach the verification service.*Check your connection/);
  assert.equal(h.submitButton().props.disabled, false);
  assert.equal(h.requests.length, 0);
});

test('a successful password response without a session does not claim sign-in or redirect', async () => {
  const h = pageHarness('app/sign-in/page.tsx', {auth: {signInWithPassword: async () => ({data: {user: null, session: null}, error: null})}});
  await h.flush(); if (h.browser.location.pathname === '/sign-up') await h.change(props => props.autoComplete === 'new-password', 'ValidPass1!'); await h.submit();
  assert.equal(h.requests.length, 0);
  assert.equal(h.submitButton().props.disabled, false);
  assert.match(h.text(), /sign.in|session/i);
  assert.match(h.browser.location.href, /sign-in/);
});

test('signup auth timeouts restore the form and explain how to avoid repeating an uncertain registration', async () => {
  const h = pageHarness('app/sign-up/page.tsx', {auth: {signUp: () => new Promise(() => {})}});
  await h.flush(); await h.change(props => props.autoComplete === 'new-password', 'ValidPass1!'); const submitted = h.submit(); await h.flush();
  assert.equal(h.submitButton().props.disabled, true);
  h.runTimers(15000); await submitted;
  assert.match(h.text(), /Check your inbox.*try signing in/);
  assert.equal(h.submitButton().props.disabled, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.requests.length, 0);
});

test('MFA verification timeouts restore the current code form without redirecting', async () => {
  const h = pageHarness('app/sign-in/page.tsx', {auth: {mfa: {
    getAuthenticatorAssuranceLevel: async () => ({data: {currentLevel: 'aal1', nextLevel: 'aal2'}, error: null}),
    verify: () => new Promise(() => {}),
  }}});
  await h.flush(); if (h.browser.location.pathname === '/sign-up') await h.change(props => props.autoComplete === 'new-password', 'ValidPass1!'); await h.submit();
  await h.change(props => props.autoComplete === 'one-time-code', '123456');
  const submitted = h.submit(); await h.flush(); h.runTimers(15000); await submitted;
  assert.match(h.text(), /Verification took too long/);
  assert.equal(h.submitButton().props.disabled, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.requests.length, 0);
});

test('every signup field and sign-in credential has an associated accessible label', async () => {
  for (const path of ['app/sign-up/page.tsx', 'app/sign-in/page.tsx', 'app/forgot-password/page.tsx']) {
    const h = pageHarness(path); await h.flush();
    for (const input of h.fields().filter(node => node.props.type !== 'checkbox')) {
      assert.ok(input.props.id, `${path}: ${input.props.name}`);
      assert.ok(h.labels().some(label => label.props.htmlFor === input.props.id), input.props.id);
    }
  }
});

test('signup explains the existing password policy before making a rejected registration request', async () => {
  let authCalls = 0;
  const h = pageHarness('app/sign-up/page.tsx', {auth: {signUp: async () => {authCalls++; throw Error('Must not call auth');}}});
  await h.flush(); await h.change(props => props.autoComplete === 'new-password', 'short'); await h.submit();
  assert.match(h.text(), /password needs: at least 8 characters, one uppercase letter, one number, one special character/);
  assert.equal(authCalls, 0); assert.equal(h.submitButton().props.disabled, false);
});

test('verification-email timeouts keep the recovery action usable without claiming delivery', async () => {
  const h = pageHarness('app/sign-in/page.tsx', {search: '?email=person%40example.invalid', auth: {
    signInWithPassword: async () => ({data: {}, error: Error('Email not confirmed')}),
    resend: () => new Promise(() => {}),
  }});
  await h.flush(); await h.submit();
  const clicked = h.clickButton('Resend verification email'); await h.flush();
  assert.equal(h.button('Sending...').props.disabled, true);
  h.runTimers(15000); await clicked;
  assert.match(h.text(), /Sending verification email took too long.*Check your inbox/);
  assert.equal(h.button('Resend verification email').props.disabled, false);
  assert.doesNotMatch(h.text(), /Verification email sent/);
});

test('password-reset transport failures explain retry and release the busy form', async () => {
  const h = pageHarness('app/forgot-password/page.tsx', {auth: {resetPasswordForEmail: async () => {throw new TypeError('Failed to fetch');}}});
  await h.flush(); await h.submit();
  assert.match(h.text(), /could not reach the password reset service.*Check your connection/);
  assert.equal(h.submitButton().props.disabled, false);
  assert.doesNotMatch(h.text(), /We sent a password reset link/);
});
