import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path) {
  const exports = {};
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', output)(name => name.startsWith('@/') ? load(`${name.slice(2)}.ts`) : require(name), exports);
  return exports;
}
const { buildSchoolDeadlineReminderAudience: audience } = load('lib/school-deadline-reminder-audience.ts');
const { buildSchoolVisitorAudience: manualAudience } = load('lib/school-visitor-audience.ts');
const empty = () => ({ visitors: [], registrations: [], orders: [], students: [], contacts: [], downloads: [], favorites: [] });
function fixture() {
  return { ...empty(),
    visitors: [{ id: 'visitor', viewer_email: 'student@school.example', created_at: '2026-10-01' }],
    registrations: [{ id: 'registered', email: 'registered@example.com', class_names: ['Grade 8 A'] }],
    students: [{ id: 'seven-a', first_name: 'Child', last_name: 'Seven', class_name: 'Grade 7 A', parent_email: ' ROSTER@example.com ' },
      { id: 'twelve-b', first_name: 'Child', last_name: 'Twelve', class_name: 'Grade 12 B', parent_email: 'roster@example.com' },
      { id: 'six', first_name: 'Child', last_name: 'Six', class_name: 'Grade 6 A', parent_email: 'younger@example.com' }],
    contacts: [{ student_id: 'seven-a', email: 'contact@example.com' }, { student_id: 'twelve-b', email: ' CONTACT@example.com ' }],
  };
}

test('automatic reminders include known roster parents and school contacts who never visited or registered', () => {
  const data = fixture();
  const recipients = audience(data);
  assert.deepEqual(recipients.map(row => row.email), ['contact@example.com', 'registered@example.com', 'roster@example.com', 'student@school.example', 'younger@example.com']);
  const roster = recipients.find(row => row.email === 'roster@example.com');
  assert.deepEqual(roster.studentNames, ['Child Seven', 'Child Twelve']);
  assert.deepEqual(roster.classNames, ['Grade 7 A', 'Grade 12 B']);
  assert.deepEqual(roster.sources, ['roster_parent']);
  assert.deepEqual(roster.registrationClasses, []);
  assert.deepEqual(recipients.find(row => row.email === 'student@school.example').sources, ['gallery_visitor'], 'Captured email alone must not claim a verified parent identity');
  assert.deepEqual(manualAudience(data).map(row => row.email).sort(), ['registered@example.com', 'student@school.example'], 'Existing manual report behavior stays unchanged');
});

test('any matching parent/customer order suppresses reminders, including pending or cancelled orders', () => {
  for (const status of ['paid', 'payment_pending', 'cancelled', 'refunded']) {
    const data = fixture();
    data.orders = [{ id: 'existing-order', parent_email: ' ROSTER@example.com ', customer_email: 'CONTACT@example.com', status }];
    const recipients = audience(data);
    assert.equal(recipients.some(row => row.email === 'roster@example.com'), false, status);
    assert.equal(recipients.some(row => row.email === 'contact@example.com'), false, status);
    assert.equal(recipients.some(row => row.email === 'registered@example.com'), true, status);
  }
});

test('optional Grade 7 A through Grade 12 range includes roster-only parents and every ending-grade section', () => {
  const recipients = audience(fixture(), { classMode: 'range', classFrom: 'Grade 7 A', classTo: 'Grade 12' });
  assert.deepEqual(recipients.map(row => row.email), ['contact@example.com', 'registered@example.com', 'roster@example.com']);
  assert.equal(recipients.filter(row => row.email === 'roster@example.com').length, 1, 'Siblings share one reminder');
  assert.deepEqual(audience(fixture(), { className: 'Grade 12 B' }).map(row => row.email), ['contact@example.com', 'roster@example.com']);
  assert.deepEqual(audience(fixture(), { classMode: 'range', classFrom: 'Grade 12', classTo: 'Grade 7 A' }), []);
});

test('source metadata merges exact saved addresses without guessing parents from names or student domains', () => {
  const data = fixture();
  data.visitors.push({ id: 'roster-visit', viewer_email: 'ROSTER@example.com' });
  data.registrations.push({ id: 'roster-register', email: 'roster@example.com', class_names: ['Grade 7 A'] });
  data.contacts.push({ student_id: 'seven-a', email: 'roster@example.com' });
  const roster = audience(data).find(row => row.email === 'roster@example.com');
  assert.deepEqual(roster.sources, ['gallery_visitor', 'registration', 'roster_parent', 'school_contact']);
  assert.equal(audience(data).some(row => row.email === 'child.seven@school.example'), false);
});

test('invalid known addresses remain visible for individual send failures; unlinked contacts cannot widen the audience', () => {
  const data = fixture();
  data.contacts.push({ student_id: 'other-school-student', email: 'unlinked@example.com' });
  data.contacts.push({ student_id: 'seven-a', email: 'not an email' });
  data.students.push({ id: 'bad-parent', class_name: 'Grade 9 A', parent_email: 'invalid@' });
  data.visitors.push({ id: 'bad-visitor', viewer_email: 'bad' });
  assert.equal(audience(data).length, 8);
  assert.equal(audience(data).some(row => row.email === 'not an email'), true);
  assert.equal(audience(data).some(row => row.email === 'invalid@'), true);
  assert.equal(audience(data).some(row => row.email === 'bad'), true);
  assert.equal(audience(data).some(row => row.email === 'unlinked@example.com'), false);
});

test('activity selections preserve real capture provenance and cannot turn roster seeds into registrations or visits', () => {
  assert.deepEqual(audience(fixture(), { activity: 'registered' }).map(row => row.email), ['registered@example.com']);
  assert.deepEqual(audience(fixture(), { activity: 'visited' }).map(row => row.email), ['student@school.example']);
  assert.deepEqual(audience(fixture(), { search: 'Child Twelve' }).map(row => row.email), ['contact@example.com', 'roster@example.com']);
  const data = fixture();
  data.orders.push({ id: 'buyer', parent_email: 'roster@example.com', status: 'paid' });
  assert.equal(audience(data, { orders: 'all' }).some(row => row.email === 'roster@example.com'), false, 'Automatic reminder audience always excludes orders');
});

test('photo readiness must intersect the same selected class; an outside-range sibling cannot qualify an unshot class', () => {
  const data = fixture();
  assert.deepEqual(audience(data, {}, new Set(['Grade 7 A'])).map(row => row.email), ['contact@example.com', 'roster@example.com']);
  assert.deepEqual(audience(data, {}, new Set()), []);
  assert.deepEqual(audience(data, { classMode: 'range', classFrom: 'Grade 12 A', classTo: 'Grade 12' }, new Set(['Grade 7 A'])), []);
  assert.deepEqual(audience(data, { classMode: 'range', classFrom: 'Grade 7 A', classTo: 'Grade 12' }, new Set(['Grade 12 B'])).map(row => row.email), ['contact@example.com', 'roster@example.com']);
});
