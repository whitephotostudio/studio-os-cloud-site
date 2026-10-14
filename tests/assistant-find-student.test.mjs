import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', output)(name => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, exports);
  return exports;
}

const { executeAssistantAction } = load('lib/studio-assistant/server/executor.ts', {
  '@/lib/student-search': load('lib/student-search.ts'),
  '@/lib/studio-assistant/types': load('lib/studio-assistant/types.ts'),
  '@/lib/ensure-package-profile': {},
  './insights': {},
  './gallery-insights': {},
});

function splitFilters(value) {
  const parts = [];
  let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\') { i += 1; continue; }
    if (value[i] === '"') quoted = !quoted;
    if (quoted) continue;
    if (value[i] === '(') depth += 1;
    if (value[i] === ')') depth -= 1;
    if (value[i] === ',' && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

const regexLiteral = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function likeMatches(value, pattern) {
  let regex = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '\\') regex += regexLiteral(pattern[++i]);
    else if (char === '%') regex += '.*';
    else if (char === '_') regex += '.';
    else regex += regexLiteral(char);
  }
  return new RegExp(`^${regex}$`, 'i').test(value ?? '');
}

function evaluateFilter(expression, row) {
  const compound = /^(and|or)\((.*)\)$/s.exec(expression);
  if (compound) {
    const results = splitFilters(compound[2]).map(part => evaluateFilter(part, row));
    return compound[1] === 'and' ? results.every(Boolean) : results.some(Boolean);
  }
  const clause = /^([a-z_]+)\.ilike\.(.*)$/s.exec(expression);
  assert.ok(clause, `Unsupported filter ${expression}`);
  const pattern = clause[2].startsWith('"') ? JSON.parse(clause[2]) : clause[2];
  return likeMatches(row[clause[1]], pattern);
}

function fixture({ failPage = null, thrownPage = null, students = null } = {}) {
  const schools = Array.from({ length: 520 }, (_, index) => ({
    id: `school-${index}`, photographer_id: 'owner', school_name: `School ${index}`,
  }));
  schools[0].school_name = 'Maple Grove';
  schools[519].school_name = 'ARS 2026';
  schools.push({ id: 'other-school', photographer_id: 'other-owner', school_name: 'Private school' });
  const rows = students ?? [
    ...Array.from({ length: 240 }, (_, index) => ({
      id: `student-${String(index).padStart(3, '0')}`, school_id: 'school-0',
      first_name: 'Haroutian', last_name: `Sarkissian ${index}`, class_name: 'Grade 2 A', photo_url: null,
    })),
    { id: 'student-997', school_id: 'school-0', first_name: 'Harout', last_name: 'Someone Else', class_name: 'Grade 7 A', photo_url: null },
    { id: 'student-998', school_id: 'school-0', first_name: 'Sarkis', last_name: 'Harout', class_name: 'Grade 8 B', photo_url: 'old.jpg' },
    { id: 'student-999', school_id: 'school-519', first_name: 'Harout', last_name: 'Sarkis', class_name: 'Grade 9 B', photo_url: 'current.jpg' },
    { id: 'private-student', school_id: 'other-school', first_name: 'Harout', last_name: 'Sarkis', class_name: 'Grade 9 B', photo_url: 'private.jpg' },
  ];
  const calls = [];
  const service = { from(table) {
    const state = { table, selection: '', filters: [], expression: null, from: 0, to: Infinity, orders: [] };
    const query = {
      select(selection) { state.selection = selection; return query; },
      eq(key, value) { state.filters.push({ key, value }); return query; },
      in(key, values) { state.filters.push({ key, values }); return query; },
      or(expression) { state.expression = expression; return query; },
      order(key, options) { state.orders.push({ key, ascending: options?.ascending ?? true }); return query; },
      range(from, to) { state.from = from; state.to = to; return query; },
      limit(count) { state.to = count - 1; return query; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          calls.push(state);
          if (table === 'students' && state.from === thrownPage) throw new Error('Student service unavailable');
          if (table === 'students' && state.from === failPage) return { data: null, error: { message: 'Student query unavailable' } };
          if (table === 'students' && state.selection.includes('schools(')) {
            return { data: null, error: { code: 'PGRST201', message: 'Ambiguous school relationship' } };
          }
          assert.ok(['schools', 'students'].includes(table));
          let result = table === 'schools' ? schools : rows.map(row => ({
            ...row, school: schools.find(school => school.id === row.school_id) ?? null,
          }));
          result = result.filter(row => state.filters.every(({ key, value, values }) => {
            const actual = key === 'school.photographer_id' ? row.school?.photographer_id : row[key];
            return values ? values.includes(actual) : actual === value;
          }));
          if (state.expression) result = result.filter(row => splitFilters(state.expression).some(part => evaluateFilter(part, row)));
          for (const { key, ascending } of state.orders.toReversed()) {
            result.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (ascending ? 1 : -1));
          }
          return { data: structuredClone(result.slice(state.from, state.to + 1)), error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  } };
  const search = query => executeAssistantAction(
    { service, photographerId: 'owner', userId: 'owner-user' },
    { intent: 'find_student', params: { query }, confirmed: false },
  );
  return { search, calls, service };
}

test('assistant finds both name orders, ranks full names first, and retains each school/class record beyond former limits', async () => {
  for (const query of ['Harout Sarkis', 'Sarkis Harout', '  SARKIS   harout  ']) {
    const f = fixture();
    const result = await f.search(query);
    assert.equal(result.ok, true);
    assert.equal(result.data.results.length, 242);
    assert.deepEqual(result.data.results.slice(0, 2), [
      { id: 'student-998', school_id: 'school-0', school_name: 'Maple Grove', first_name: 'Sarkis', last_name: 'Harout', class_name: 'Grade 8 B', photo_url: 'old.jpg' },
      { id: 'student-999', school_id: 'school-519', school_name: 'ARS 2026', first_name: 'Harout', last_name: 'Sarkis', class_name: 'Grade 9 B', photo_url: 'current.jpg' },
    ]);
    assert.ok(result.data.results.every(row => !['private-student', 'student-997'].includes(row.id)));
    assert.deepEqual(f.calls.map(call => [call.from, call.to]), [[0, 199], [200, 399]]);
    for (const call of f.calls) {
      assert.equal(call.table, 'students');
      assert.match(call.selection, /school:schools!students_school_id_fkey!inner\(/);
      assert.deepEqual(call.filters, [{ key: 'school.photographer_id', value: 'owner' }]);
      assert.deepEqual(call.orders, [{ key: 'id', ascending: true }]);
    }
  }
});

test('partial names still work while every full-name token must match', async () => {
  const f = fixture();
  const partial = await f.search('harout');
  assert.equal(partial.ok, true);
  assert.equal(partial.data.results.length, 243);
  assert.ok(partial.data.results.some(row => row.id === 'student-997'));
  const missing = await f.search('Harout Unmatched');
  assert.equal(missing.ok, true);
  assert.deepEqual(missing.data.results, []);
  assert.equal(missing.message, 'No students match “Harout Unmatched”.');
});

test('assistant treats quoted filter punctuation and LIKE wildcards as literal name text', async () => {
  const f = fixture({ students: [
    { id: 'literal', school_id: 'school-0', first_name: 'Harout', last_name: 'Sarkis, (A)_100%', class_name: 'Grade 9 B' },
    { id: 'decoy', school_id: 'school-0', first_name: 'Harout', last_name: 'Sarkis, (A)X100anything', class_name: 'Grade 9 B' },
  ] });
  const result = await f.search('Sarkis, (A)_100% Harout');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.results.map(row => row.id), ['literal']);
});

test('a later-page database error or rejected query fails the assistant action without returning partial students', async () => {
  for (const options of [{ failPage: 200 }, { thrownPage: 200 }]) {
    const f = fixture(options);
    const result = await f.search('Harout Sarkis');
    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
    assert.match(result.message, /unavailable/);
    assert.equal('data' in result, false);
    assert.equal(f.calls.length, 2);
  }
});

test('blank queries and unresolved photographers fail before a database read', async () => {
  const f = fixture();
  const blank = await f.search('   ');
  assert.equal(blank.ok, false);
  assert.equal(blank.status, 422);
  const missingOwner = await executeAssistantAction(
    { service: f.service, photographerId: '', userId: 'owner-user' },
    { intent: 'find_student', params: { query: 'Harout Sarkis' }, confirmed: false },
  );
  assert.equal(missingOwner.ok, false);
  assert.equal(missingOwner.status, 403);
  assert.equal(f.calls.length, 0);
});
