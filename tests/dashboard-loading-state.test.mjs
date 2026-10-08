import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(
  readFileSync(new URL('../app/dashboard/page.tsx', import.meta.url), 'utf8') + '\nexport { DashboardPageContent };',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const profile = { id: 'photographer', business_name: 'Existing studio', is_platform_admin: true, subscription_status: 'active' };
const school = { id: 'school', school_name: 'Existing school', local_school_id: 'local-school', created_at: '2026-10-01' };
const event = { id: 'event', title: 'Existing event', workflow_type: 'event', created_at: '2026-10-02' };
const order = { id: 'order', customer_name: 'Customer', customer_email: 'customer@example.test', total_cents: 1200,
  status: 'paid', payment_status: 'paid', school_id: 'school', created_at: '2026-10-03' };
const populated = () => ({ schools: [school], projects: [event], events: [event], orders: [order],
  students: [{ school_id: 'school', photo_url: 'photo.jpg' }] });
const empty = () => ({ schools: [], projects: [], events: [], orders: [], students: [] });

// Execute the production page's loader and render function with controllable
// async boundaries. Child components with their own hooks stay isolated; the
// summary components are rendered normally when their values are inspected.
function fixture(initialPlan) {
  let plan = initialPlan, cursor = 0, effects = [], latestLoad;
  const states = [];
  const requests = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useMemo(fn) { return fn(); },
    useCallback(fn) {
      return (...args) => { latestLoad = fn(...args); return latestLoad; };
    },
    useEffect(fn) { effects.push(fn); },
    Suspense: ({ children }) => children,
  };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user', email: 'studio@example.test' } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'fixture' } } }),
    },
    from(table) {
      const run = async () => {
        requests.push(table);
        if (table === 'photographers') return { data: profile, error: null };
        const result = await plan[table];
        return result instanceof Error ? { data: null, error: result } : { data: result ?? [], error: null };
      };
      const query = {
        select() { return query; }, eq() { return query; }, in() { return query; },
        order() { return query; }, limit() { return query; }, abortSignal() { return query; },
        maybeSingle: run, then: (resolve, reject) => run().then(resolve, reject),
      };
      return query;
    },
  };
  const fetchFixture = async url => {
    requests.push(url);
    if (url === '/api/dashboard/events') {
      const result = await plan.events;
      return result instanceof Error ? Response.json({ ok: false, message: result.message }, { status: 500 })
        : Response.json({ ok: true, projects: result ?? [] });
    }
    if (url === '/api/studio-os-app/status') return Response.json({ ok: true });
    if (url === '/api/dashboard/download-activity') return Response.json({ ok: true, activities: [] });
    throw new Error('Unexpected fetch: ' + url);
  };
  const modules = {
    react, 'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': ({ children }) => children,
    'next/navigation': { useSearchParams: () => ({ get: () => null }) },
    '@/lib/supabase/client': { createClient: () => client },
    '@/components/studio-assistant/studio-assistant': { StudioAssistant: () => null },
    '@/components/spotlight-search': { SpotlightLauncher: () => null },
    '@/lib/use-is-mobile': { useIsMobile: () => false },
    '@/lib/photo-url': { proxiedPhotoUrl: value => value },
    '@/lib/subscription-access': { resolveSubscriptionAccess: () => ({ accessEnabled: true }), isFreeTrialActive: () => false },
    '@/lib/order-display': { resolveOrderTotalCents: row => row.total_cents ?? Math.round((row.total_amount ?? 0) * 100) },
    '@/lib/studio-welcome-state': { hasSeenStudioWelcome: () => true, markStudioWelcomeSeen() {} },
    '@/lib/auth-request': { withAuthRequestTimeout: promise => promise,
      authRequestErrorMessage: (error, fallback) => error?.message || fallback },
    'lucide-react': new Proxy({}, { get: () => () => null }),
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', 'window', 'console', 'requestAnimationFrame', 'cancelAnimationFrame', compiled)(
    name => { assert.ok(name in modules, 'Unexpected dependency: ' + name); return modules[name]; },
    exports, fetchFixture, { location: {} }, { error() {} }, callback => { callback(); return 1; }, () => {},
  );
  const render = () => { cursor = 0; effects = []; return exports.DashboardPageContent(); };
  return {
    render, requests,
    setPlan(next) { plan = next; },
    mount() { render(); effects.forEach(effect => effect()); return latestLoad; },
    action(label) {
      const found = nodes(render(), node => node.type === 'button' &&
        (node.props['aria-label'] === label || text(node) === label))[0];
      assert.ok(found, 'Missing dashboard action: ' + label);
      found.props.onClick();
      return latestLoad;
    },
  };
}
function nodes(tree, predicate, found = []) {
  if (Array.isArray(tree)) tree.forEach(child => nodes(child, predicate, found));
  else if (tree && typeof tree === 'object' && tree.props) {
    if (predicate(tree)) found.push(tree);
    nodes(tree.props.children, predicate, found);
  }
  return found;
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree && typeof tree === 'object' && tree.props) return text(tree.props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
function banner(tree) { return nodes(tree, node => node.type === 'h2' && text(node) === 'Start with your first gallery').length > 0; }
function summaries(tree) {
  return Object.fromEntries(nodes(tree, node => typeof node.type === 'function' &&
    ['OverviewLinkCard', 'QuickStat'].includes(node.type.name)).map(node => {
    // Call the actual stat component too, so assertions cover visible text.
    assert.ok(text(node.type(node.props)).includes(String(node.props.value)));
    return [node.props.label, node.props.value];
  }));
}
function assertUnknown(tree) {
  const stats = summaries(tree);
  for (const label of ['SCHOOLS', 'EVENT PROJECTS', 'ORDERS', 'TOTAL ORDERS', 'PENDING ORDERS', 'REVENUE TRACKED', 'SCHOOL PROJECTS LINKED', 'PHOTO COVERAGE']) {
    assert.match(String(stats[label]), /^[—–-]$/, label + ' must distinguish unknown data from zero');
  }
  assert.ok(!text(tree).includes('0 of 0 subjects'), 'photo coverage must not imply confirmed empty data');
  assert.equal(banner(tree), false);
}

test('an available profile cannot show onboarding or zero totals while galleries and students are pending', async () => {
  const galleries = deferred(), students = deferred();
  const f = fixture({ ...populated(), schools: galleries.promise, students: students.promise });
  assertUnknown(f.render());
  const loading = f.mount();
  await flush();
  assert.ok(f.requests.includes('schools'), 'profile resolved and gallery requests started');
  assertUnknown(f.render());
  galleries.resolve([school]);
  await flush();
  assert.ok(f.requests.includes('students'));
  assertUnknown(f.render());
  students.resolve(populated().students);
  await loading;
  const stats = summaries(f.render());
  assert.equal(stats.SCHOOLS, 1); assert.equal(stats['EVENT PROJECTS'], 1); assert.equal(stats.ORDERS, 1);
  assert.equal(stats['PHOTO COVERAGE'], '100%'); assert.equal(banner(f.render()), false);
});

test('a failed initial load and pending Retry keep unknown statistics and never display first-gallery onboarding', async () => {
  const f = fixture({ ...empty(), schools: new Error('Gallery load failed') });
  await f.mount();
  assert.match(text(f.render()), /Gallery load failed/); assertUnknown(f.render());
  const galleries = deferred();
  f.setPlan({ ...populated(), schools: galleries.promise });
  const retry = f.action('Retry dashboard');
  await flush();
  assert.ok(!text(f.render()).includes('Gallery load failed'));
  assertUnknown(f.render());
  galleries.resolve([school]);
  await retry;
  assert.equal(summaries(f.render()).SCHOOLS, 1); assert.equal(banner(f.render()), false);
});

test('only a successful confirmed empty account displays onboarding and real zero totals', async () => {
  const galleries = deferred();
  const f = fixture({ ...empty(), schools: galleries.promise });
  const loading = f.mount();
  await flush(); assertUnknown(f.render());
  galleries.resolve([]); await loading;
  assert.equal(banner(f.render()), true);
  const stats = summaries(f.render());
  for (const label of ['SCHOOLS', 'EVENT PROJECTS', 'ORDERS', 'TOTAL ORDERS', 'PENDING ORDERS']) assert.equal(stats[label], 0, label);
  assert.equal(stats['PHOTO COVERAGE'], '0%');
  assert.match(text(f.render()), /0 of 0 subjects/);
});

test('a pending or failed refresh preserves the previous complete snapshot instead of publishing partial results', async () => {
  const f = fixture(populated()); await f.mount();
  const previous = summaries(f.render());
  const students = deferred();
  // Include a different school to force the dependent student request, while
  // other refreshed counts would incorrectly become zero if committed early.
  f.setPlan({ schools: [{ ...school, id: 'replacement' }], projects: [], events: [], orders: [], students: students.promise });
  const refreshing = f.action('Refresh dashboard');
  await flush();
  assert.deepEqual(summaries(f.render()), previous);
  assert.equal(banner(f.render()), false);
  students.resolve(new Error('Student load failed')); await refreshing;
  assert.match(text(f.render()), /Student load failed/);
  assert.deepEqual(summaries(f.render()), previous);
  assert.equal(banner(f.render()), false);
});

test('confirmed empty onboarding remains stable during a pending and successful empty refresh', async () => {
  const f = fixture(empty()); await f.mount();
  const previous = summaries(f.render());
  assert.equal(banner(f.render()), true);
  const galleries = deferred();
  f.setPlan({ ...empty(), schools: galleries.promise });
  const refreshing = f.action('Refresh dashboard'); await flush();
  assert.equal(banner(f.render()), true);
  assert.deepEqual(summaries(f.render()), previous);
  galleries.resolve([]); await refreshing;
  assert.equal(banner(f.render()), true);
  assert.deepEqual(summaries(f.render()), previous);
});

test('a successful refresh updates the full snapshot after dependent data is available', async () => {
  const f = fixture(populated()); await f.mount();
  const previous = summaries(f.render()), students = deferred();
  f.setPlan({ ...populated(), schools: [school, { ...school, id: 'second', local_school_id: 'second', school_name: 'Second school' }],
    orders: [order, { ...order, id: 'second-order', total_cents: 500 }], students: students.promise });
  const refreshing = f.action('Refresh dashboard'); await flush();
  assert.deepEqual(summaries(f.render()), previous);
  students.resolve([{ school_id: 'school', photo_url: 'photo.jpg' }, { school_id: 'second', photo_url: null }]);
  await refreshing;
  const stats = summaries(f.render());
  assert.equal(stats.SCHOOLS, 2); assert.equal(stats.ORDERS, 2);
  assert.equal(stats['TOTAL ORDERS'], 2); assert.equal(stats['PHOTO COVERAGE'], '50%');
  assert.equal(stats['REVENUE TRACKED'], '$17.00'); assert.equal(banner(f.render()), false);
});
