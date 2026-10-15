import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path) {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => name.startsWith('@/') ? load(`${name.slice(2)}.ts`) : require(name), exports);
  return exports;
}
const { buildSchoolVisitorAudience: build } = load('lib/school-visitor-audience.ts');
const { matchesSchoolVisitorFilters: matches, DEFAULT_SCHOOL_VISITOR_FILTERS: defaults } = load('lib/school-visitor-filters.ts');
const empty = () => ({ visitors: [], registrations: [], orders: [], students: [], contacts: [], downloads: [], favorites: [] });
const visitor = (id, email) => ({ id, viewer_email: email, created_at: '2026-10-01', last_opened_at: '2026-10-15' });
const student = (id, parentEmail) => ({ id, first_name: 'Child', last_name: id, class_name: 'Grade 12 A', parent_email: parentEmail });
const paid = (id, studentId, parentEmail) => ({ id, parent_email: parentEmail, customer_email: parentEmail,
  student: { id: studentId, first_name: 'Child', last_name: studentId, class_name: 'Grade 12 A' },
  status: 'paid', payment_status: 'succeeded', paid_at: '2026-10-07', total_cents: 2000, package_name: 'Digital - All Photos' });

test('six linked-student alternate-address patterns expose paid orders rather than no-order reminder contacts', () => {
  const data = empty();
  for (let i = 1; i <= 6; i++) {
    data.visitors.push(visitor(`v${i}`, `student-${i}@school.example`));
    data.students.push(student(`s${i}`, `parent-${i}@example.test`));
    data.contacts.push({ student_id: `s${i}`, email: `STUDENT-${i}@school.example` });
    data.orders.push(paid(`o${i}`, `s${i}`, `parent-${i}@example.test`));
  }
  const rows = build(data).filter(row => row.id.startsWith('v'));
  assert.equal(rows.length, 6);
  assert.equal(rows.filter(row => matches(row, { ...defaults, orders: 'no_orders' })).length, 0);
  assert.equal(rows.filter(row => matches(row, { ...defaults, orders: 'paid' })).length, 6);
  assert.equal(rows.filter(row => matches(row, { ...defaults, orders: 'digitals' })).length, 6);
  rows.forEach((row, i) => { assert.equal(row.orderCount, 1); assert.deepEqual(row.orders.map(order => order.id), [`o${i + 1}`]); });
});

test('roster parent linkage and joined-student array representation match without a saved contact row', () => {
  const data = empty();
  data.visitors = [visitor('v', 'parent@example.test')];
  data.students = [student('s', ' PARENT@example.test ')];
  const order = paid('o', 's', 'other-parent@example.test'); order.student = [order.student];
  data.orders = [order];
  const row = build(data).find(row => row.id === 'v');
  assert.equal(row.orderCount, 1);
  assert.equal(row.hasPaidOrder, true);
});

test('pending and cancelled orders under another exact student contact exclude no-orders without becoming paid buyers', () => {
  for (const [status, payment_status] of [['payment_pending', 'pending'], ['cancelled', 'cancelled']]) {
    const data = empty();
    data.visitors = [visitor('v', 'student@school.example')];
    data.students = [student('s', 'parent@example.test')];
    data.contacts = [{ student_id: 's', email: 'student@school.example' }];
    data.orders = [{ ...paid('o', 's', 'parent@example.test'), status, payment_status, paid_at: null }];
    const row = build(data).find(row => row.id === 'v');
    assert.equal(row.orderCount, 1);
    assert.equal(matches(row, { ...defaults, orders: 'no_orders' }), false);
    assert.equal(matches(row, { ...defaults, orders: 'unpaid' }), true);
    assert.equal(row.hasPaidOrder, false);
    assert.equal(row.hasDigitalPurchase, false);
  }
});

test('direct email orders still match without student identities and overlapping evidence counts an order once', () => {
  const data = empty(); data.visitors = [visitor('v', 'parent@example.test')];
  data.orders = [{ ...paid('direct', 'other', 'other@example.test'), customer_email: ' PARENT@example.test ', student: null }];
  assert.equal(build(data).find(row => row.id === 'v').orderCount, 1);
  data.students = [student('s', 'parent@example.test')];
  data.contacts = [{ student_id: 's', email: 'parent@example.test' }];
  data.orders = [paid('both', 's', 'parent@example.test')];
  assert.equal(build(data).find(row => row.id === 'v').orderCount, 1);
});

test('foreign or stale contact IDs, blank IDs, names and transitive parent links cannot pull in unrelated orders', () => {
  const data = empty(); data.visitors = [visitor('v', 'student@school.example')];
  data.students = [student('s', 'shared-parent@example.test'), student('sibling', 'shared-parent@example.test'), student('', 'unrelated@example.test')];
  data.contacts = [{ student_id: 's', email: 'student@school.example' }, { student_id: 'foreign', email: 'student@school.example' }, { student_id: '', email: 'student@school.example' }];
  data.orders = [paid('foreign-order', 'foreign', 'different@example.test'), paid('sibling-order', 'sibling', 'shared-parent@example.test'),
    { ...paid('blank-order', '', 'unrelated@example.test'), student: { id: '', first_name: 'Child', last_name: 's' } },
    { ...paid('name-order', 'different-id', 'other@example.test'), student: { id: 'different-id', first_name: 'Child', last_name: 's' } }];
  const row = build(data).find(row => row.id === 'v');
  assert.equal(row.orderCount, 0);
  assert.equal(matches(row, { ...defaults, orders: 'no_orders' }), true);
  assert.deepEqual(row.studentNames, ['Child s']);
});
