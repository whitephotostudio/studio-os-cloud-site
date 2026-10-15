import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', output)(name => name.startsWith('@/') ? load(`${name.slice(2)}.ts`) : require(name), exports);
  return exports;
}
const { matchesSchoolVisitorFilters: matches, DEFAULT_SCHOOL_VISITOR_FILTERS: defaults, compareSchoolVisitorClasses: compare } = load('lib/school-visitor-filters.ts');
const { SchoolVisitorReportControls: Controls } = load('components/school-visitor-report-controls.tsx');
const visitor = (id, classNames, overrides = {}) => ({ id, email: `${id}@example.com`, classNames, registrationClasses: classNames,
  studentNames: [id], orderCount: 0, hasPaidOrder: false, hasDigitalPurchase: false, favoriteCount: 0,
  downloadCount: 0, preRelease: true, orders: [], ...overrides });
const range = { ...defaults, classMode: 'range', classFrom: 'Grade 7 A', classTo: 'Grade 12', orders: 'no_orders' };
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))];
}
const select = (tree, label) => nodes(tree, node => node.type === 'select' && node.props['aria-label'] === label)[0];

test('Grade 7 A through Grade 12 includes every ending-grade section and sorts grades numerically', () => {
  const contacts = [visitor('six', ['Grade 6 B']), visitor('seven-a', ['Grade 7 A']), visitor('seven-b', ['7B']),
    visitor('eight', ['Grade 8 A']), visitor('ten', ['10A']), visitor('twelve-a', ['Grade 12 A']),
    visitor('twelve-z', ['12Z']), visitor('thirteen', ['Grade 13 A']), visitor('unknown', [])];
  assert.deepEqual(contacts.filter(contact => matches(contact, range)).map(contact => contact.id),
    ['seven-a', 'seven-b', 'eight', 'ten', 'twelve-a', 'twelve-z']);
  assert.deepEqual(['Grade 12 A', '7B', 'Grade 10 A', 'Grade 7 A', 'Grade 8 A'].sort(compare),
    ['Grade 7 A', '7B', 'Grade 8 A', 'Grade 10 A', 'Grade 12 A']);
});

test('specific section boundaries are inclusive, and a whole-grade end works within the same grade', () => {
  const sectionRange = { ...range, classFrom: 'Grade 7 B', classTo: 'Grade 8 A' };
  assert.equal(matches(visitor('before', ['Grade 7 A']), sectionRange), false);
  assert.equal(matches(visitor('first', ['7B']), sectionRange), true);
  assert.equal(matches(visitor('last', ['Grade 8 A']), sectionRange), true);
  assert.equal(matches(visitor('after', ['Grade 8 B']), sectionRange), false);
  assert.equal(matches(visitor('last-grade', ['Grade 12 B']), { ...range, classFrom: 'Grade 12 A' }), true);
  assert.equal(matches(visitor('earlier-section', ['Grade 12 A']), { ...range, classFrom: 'Grade 12 B' }), false);
});

test('range filters combine with no orders, search and activity while counting a sibling contact once', () => {
  const contacts = [visitor('siblings', ['Grade 7 A', 'Grade 12 B']),
    visitor('pending', ['Grade 9 A'], { orderCount: 1 }),
    visitor('cancelled', ['Grade 10 A'], { orderCount: 1 }),
    visitor('buyer', ['Grade 12 A'], { orderCount: 1, hasPaidOrder: true }),
    visitor('visited', ['Grade 8 A'], { preRelease: false })];
  const noOrders = { ...range, activity: 'registered' };
  assert.deepEqual(contacts.filter(contact => matches(contact, noOrders)).map(contact => contact.id), ['siblings']);
  assert.equal(matches(contacts[0], { ...noOrders, search: 'Grade 12' }), true);
  assert.equal(matches(contacts[0], { ...noOrders, search: 'not-matching' }), false);
  const base = contacts.filter(contact => matches(contact, { ...noOrders, orders: 'all' }));
  assert.equal(base.length, 4);
  assert.equal(base.filter(contact => !contact.orderCount).length, 1);
  assert.equal(base.filter(contact => contact.hasPaidOrder).length, 1);
});

test('incomplete and reversed ranges show no contacts; single-class mode retains exact matching', () => {
  const contact = visitor('seven', ['Grade 7 A']);
  for (const bounds of [{ classFrom: '' }, { classTo: '' }, { classFrom: 'Grade 12 A', classTo: 'Grade 7 A' }]) {
    assert.equal(matches(contact, { ...range, ...bounds }), false);
  }
  assert.equal(matches(contact, { ...range, classMode: 'single', className: 'Grade 7 A' }), true);
  assert.equal(matches(contact, { ...range, classMode: 'single', className: 'Grade 7' }), false);
  assert.equal(matches(contact, { ...defaults, className: 'Grade 7 A' }), true);
});

test('range controls expose Grade 12 as all sections, preserve purchase filters, and clear the entire range', () => {
  let filters = { ...defaults, className: 'Grade 7 A', orders: 'no_orders' };
  const render = () => Controls({ filters, onChange: value => { filters = value; },
    classNames: ['Grade 12 B', 'Grade 8 A', 'Grade 7 A', 'Grade 12 A'], counts: { all: 4, ordered: 1, no_orders: 3, paid: 1, digitals: 0 } });
  select(render(), 'Class selection mode').props.onChange({ target: { value: 'range' } });
  assert.equal(filters.classFrom, 'Grade 7 A');
  assert.equal(filters.orders, 'no_orders');
  const through = select(render(), 'Filter through class or grade');
  assert.equal(nodes(through, node => node.type === 'option' && node.props.value === 'Grade 12')[0].props.children, 'Grade 12 (all sections)');
  through.props.onChange({ target: { value: 'Grade 12' } });
  assert.equal(filters.classTo, 'Grade 12');
  assert.equal(matches(visitor('end', ['Grade 12 B']), filters), true);
  nodes(render(), node => node.type === 'button' && node.props.children === 'Clear filters')[0].props.onClick();
  assert.deepEqual(filters, defaults);
  assert.ok(select(render(), 'Filter by class'));
});
