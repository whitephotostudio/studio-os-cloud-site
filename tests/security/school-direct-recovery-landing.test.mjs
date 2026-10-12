import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { harness, id } from '../helpers/event-gallery-harness.mjs';

const schoolId = id(70), studentId = id(71), otherSchool = id(72), recoveredPin = 'synthetic-recovered-pin';
const school = { id: schoolId, school_name: 'Synthetic school', status: 'active', portal_status: 'active',
  expiration_date: null, email_required: true, registration_class_required: false, students: [{ count: 1 }] };
const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
function load(file, dependencies, globals = {}) {
  const compiled = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  new Function('require', 'exports', ...Object.keys(globals), compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports, ...Object.values(globals));
  return exports;
}

function componentFixture({ search = '', schoolOverrides = {}, fetcher } = {}) {
  const slots = [], effects = [], requests = [], navigations = [], stored = [];
  let cursor = 0, dirty = false, tree;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; dirty = true; }];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { value: { current: initial } }; return slots[index].value; },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        slots[index] = { deps, effect }; effects.push(effect);
      }
    },
  };
  const browser = { location: { search } };
  const dependencies = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/navigation': { useRouter: () => ({ push: value => navigations.push(value) }) },
    'lucide-react': { Check: 'check', Mail: 'mail', School: 'school', X: 'x' },
    './SchoolRegistrationClasses': { default: 'registration-classes' },
  };
  const Form = load('app/parents/SchoolDirectLoginForm.tsx', dependencies, {
    window: browser,
    sessionStorage: { setItem: (...args) => stored.push(args) },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return fetcher ? fetcher(url, init) : Response.json({ ok: true, schoolId, pin: JSON.parse(init.body).pin });
    },
  }).default;
  const props = { school: { ...school, ...schoolOverrides } };
  function render() { cursor = 0; dirty = false; tree = Form(props); }
  function nodes(node) {
    if (node == null || typeof node === 'boolean') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [node];
  }
  async function flush() {
    for (let i = 0; i < 8; i++) {
      while (effects.length) effects.shift()();
      await Promise.resolve();
      if (dirty) render();
    }
  }
  render();
  return {
    requests, navigations, stored, browser, Form,
    props, flush,
    fields: () => nodes(tree).filter(node => node.type === 'input'),
    banners: () => nodes(tree).filter(node => node.props?.role === 'status' || node.props?.role === 'alert'),
    text: () => nodes(tree).filter(node => typeof node === 'string').join(' '),
    async change(field, value) {
      const input = nodes(tree).find(node => node.type === 'input' && (field === 'email' ? node.props.type === 'email' : node.props.placeholder === 'Enter school PIN'));
      assert.ok(input, field); input.props.onChange({ target: { value } }); await flush();
    },
    async submit() { await nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await flush(); },
    async replayEffects() { for (const slot of slots) slot.effect?.(); await flush(); },
    async click(label) { nodes(tree).find(node => node.type === 'button' && node.props.children === label).props.onClick(); await flush(); },
  };
}

test('known-school claim redirect selects the direct form and captures the PIN/banner after hydration', async () => {
  const h = harness();
  h.tables.schools.push(school);
  h.tables.students.push({ id: studentId, school_id: schoolId, pin: recoveredPin });
  const dependencies = {
    'next/server': { NextResponse: { redirect: value => Response.redirect(value) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => h.service },
    '@/lib/pin-recovery': { claimRecoveryToken: async () => ({ ok: true, studentId }), pinRecoveryOrigin: () => 'https://fixture.test' },
  };
  const claimRequest = new Request('https://fixture.test/api/portal/recovery/claim?token=synthetic-token');
  claimRequest.nextUrl = new URL(claimRequest.url);
  const claimed = await load('app/api/portal/recovery/claim/route.ts', dependencies).GET(claimRequest);
  const landing = new URL(claimed.headers.get('location'));
  const f = componentFixture({ search: landing.search });
  const selected = await load('app/parents/page.tsx', {
    '@/lib/dashboard-auth': dependencies['@/lib/dashboard-auth'],
    './LoginForm': { __esModule: true, default: 'generic-login' },
    './SchoolDirectLoginForm': { __esModule: true, default: f.Form },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
  }).default({ searchParams: Promise.resolve(Object.fromEntries(landing.searchParams)) });
  assert.equal(selected.type, f.Form);
  assert.equal(selected.props.school.id, schoolId);
  assert.deepEqual(f.fields().map(node => node.props.value), ['', ''], 'first render matches server HTML');
  await f.flush();
  assert.deepEqual(f.fields().map(node => node.props.value), ['', recoveredPin]);
  assert.equal(f.banners()[0].props.role, 'status');
  assert.match(f.text(), /pre-filled the PIN.*Enter your email/);
  assert.deepEqual(f.requests, []); assert.deepEqual(f.navigations, []); assert.deepEqual(f.stored, []);
  await f.submit();
  assert.match(f.text(), /Please enter your email/);
  assert.deepEqual(f.requests, []);
  await f.change('email', ' PARENT@example.test ');
  await f.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/portal/school-access');
  assert.deepEqual(JSON.parse(f.requests[0].init.body), { schoolId, email: 'parent@example.test', pin: recoveredPin, prefetch: true });
  assert.match(f.navigations[0], new RegExp(`/parents/${recoveredPin}\\?mode=school&school=${schoolId}&email=parent%40example.test`));
});

test('ordinary QR entry and malformed/mismatched recovery queries keep PIN/email blank', async () => {
  for (const search of [
    `?school=${schoolId}`, `?school=${schoolId}&pin=${recoveredPin}`,
    `?school=${schoolId}&recovery=ok`, `?school=${otherSchool}&recovery=ok&pin=${recoveredPin}`,
    `?school=${schoolId}&recovery=unknown&pin=${recoveredPin}`,
    `?school=${schoolId}&recovery=ok&pin=${recoveredPin}&pin=other`,
    `?school=${schoolId}&school=${otherSchool}&recovery=ok&pin=${recoveredPin}`,
    `?school=${schoolId}&recovery=ok&recovery=invalid&pin=${recoveredPin}`,
  ]) {
    const f = componentFixture({ search }); await f.flush();
    assert.deepEqual(f.fields().map(node => node.props.value), ['', '']);
    assert.deepEqual(f.banners(), []); assert.deepEqual(f.requests, []); assert.deepEqual(f.navigations, []);
  }
});

test('recovery status banners align with the generic form and never consume accompanying PIN/email', async () => {
  for (const [status, message] of [['expired', /recovery link expired/], ['used', /already been used/], ['invalid', /isn’t valid/]]) {
    const f = componentFixture({ search: `?school=${schoolId}&recovery=${status}&pin=${recoveredPin}&email=untrusted%40example.test` });
    await f.flush();
    assert.deepEqual(f.fields().map(node => node.props.value), ['', '']);
    assert.equal(f.banners()[0].props.role, 'alert'); assert.match(f.text(), message);
    assert.deepEqual(f.requests, []); assert.deepEqual(f.navigations, []);
  }
});

test('query capture is once per school and does not overwrite a parent edit during effect replay', async () => {
  const f = componentFixture({ search: `?school=${schoolId}&recovery=ok&pin=${recoveredPin}&email=untrusted%40example.test` });
  await f.flush(); await f.change('pin', 'parent-corrected-pin');
  f.browser.location.search = `?school=${schoolId}&recovery=ok&pin=changed-query`;
  await f.replayEffects();
  assert.deepEqual(f.fields().map(node => node.props.value), ['', 'parent-corrected-pin']);
  assert.deepEqual(f.requests, []); assert.deepEqual(f.navigations, []);
});

test('forged recovery query cannot bypass the actual school PIN validator', async () => {
  const h = harness(); h.tables.schools.push(school);
  h.tables.students.push({ id: studentId, school_id: schoolId, pin: recoveredPin });
  const f = componentFixture({ search: `?school=${schoolId}&recovery=ok&pin=incorrect`, fetcher: (url, init) => {
    assert.equal(url, '/api/portal/school-access');
    return h.load('app/api/portal/school-access/route.ts').POST(new Request(new URL(url, 'https://fixture.test'), init));
  } });
  await f.flush(); assert.deepEqual(f.requests, []);
  await f.change('email', 'parent@example.test'); await f.submit();
  assert.equal(f.requests.length, 1); assert.match(f.text(), /No gallery was found/);
  assert.deepEqual(f.navigations, []); assert.deepEqual(f.stored, []); assert.deepEqual(h.writes, []);
});

test('recovery prefill preserves live class registration choice and pre-release gates', async () => {
  const search = `?school=${schoolId}&recovery=ok&pin=${recoveredPin}`;
  const active = componentFixture({ search, schoolOverrides: { registration_class_required: true } });
  await active.flush(); assert.equal(active.fields().length, 2);
  await active.click('Register for photo updates'); assert.equal(active.fields().length, 1);
  await active.replayEffects(); assert.equal(active.fields().length, 1, 'recovery capture cannot collapse a registration choice');
  await active.click('View photos with PIN'); assert.equal(active.fields()[1].props.value, recoveredPin);
  const prerelease = componentFixture({ search, schoolOverrides: { status: 'pre_release', portal_status: 'pre_release' } });
  await prerelease.flush(); assert.equal(prerelease.fields().length, 1);
  assert.match(prerelease.text(), /gallery isn't available yet/);
  assert.deepEqual(active.requests, []); assert.deepEqual(prerelease.requests, []);
});
