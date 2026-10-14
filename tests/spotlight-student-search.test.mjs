import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as studentSearch from '../lib/student-search.ts';

const source = readFileSync(new URL('../components/spotlight-search.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('spotlight-search.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hookSource = ['clean', 'isShortOrderId', 'parseYearToken', 'yearOf', 'yearLabel', 'useSpotlight'].map(name => {
  const node = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `Missing actual search function: ${name}`);
  return node.getText(file);
}).join('\n');
const compiledHook = ts.transpileModule(hookSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

// Parse the generated PostgREST filter rather than accepting every .or() call.
// Quoted values can contain commas, parentheses, escaped quotes and LIKE escapes.
function splitClauses(expression) {
  const parts = [];
  let start = 0, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < expression.length; i++) {
    const char = expression[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(expression.slice(start, i));
      start = i + 1;
    }
  }
  assert.equal(depth, 0, 'Balanced filter groups');
  assert.equal(quoted, false, 'Balanced filter quotes');
  parts.push(expression.slice(start));
  return parts;
}
const fieldValue = (row, field) => field.split('.').reduce((value, key) => value?.[key], row);
function ilike(value, pattern) {
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\' && i + 1 < pattern.length) {
      regex += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (char === '%') regex += '.*';
    else if (char === '_') regex += '.';
    else regex += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(regex + '$', 'isu').test(String(value ?? ''));
}
function matchesClause(row, clause) {
  for (const operator of ['and', 'or']) {
    if (clause.startsWith(operator + '(') && clause.endsWith(')')) {
      const children = splitClauses(clause.slice(operator.length + 1, -1));
      return operator === 'and'
        ? children.every(child => matchesClause(row, child))
        : children.some(child => matchesClause(row, child));
    }
  }
  const atom = clause.match(/^(.+?)\.(ilike|gte|lt|is)\.(.*)$/);
  assert.ok(atom, `Supported filter clause: ${clause}`);
  const [, field, operator, raw] = atom;
  const value = fieldValue(row, field);
  const expected = raw.startsWith('"') ? JSON.parse(raw) : raw;
  if (operator === 'ilike') return value != null && ilike(value, expected);
  if (operator === 'is') return expected === 'null' && value == null;
  if (operator === 'gte') return value != null && value >= expected;
  return value != null && value < expected;
}

function queryDb(tables, queries) {
  return { from(table) {
    const q = { table, selection: '', filters: [], orders: [], offset: 0, end: Infinity, limit: Infinity, single: false };
    const api = {
      select(selection) { q.selection = selection; return api; },
      eq(field, value) { q.filters.push({ kind: 'eq', field, value }); return api; },
      in(field, values) { q.filters.push({ kind: 'in', field, values: Array.from(values) }); return api; },
      ilike(field, pattern) { q.filters.push({ kind: 'ilike', field, pattern }); return api; },
      or(expression, options = {}) { q.filters.push({ kind: 'or', expression, relation: options.foreignTable ?? options.referencedTable }); return api; },
      order(field, { ascending = true } = {}) { q.orders.push({ field, ascending }); return api; },
      range(from, to) { q.offset = from; q.end = to; return api; },
      limit(value) { q.limit = value; return api; },
      maybeSingle() { q.single = true; return api; },
      then(resolve, reject) {
        return Promise.resolve().then(async () => {
          queries.push(q);
          // The second school/student FK makes an unhinted embed ambiguous.
          if (table === 'students' && /\bschools(?:!inner)?\(/.test(q.selection)) {
            return { data: null, error: { code: 'PGRST201', message: 'More than one school/student relationship' } };
          }
          const response = typeof tables[table] === 'function' ? await tables[table](q) : tables[table];
          assert.ok(response, `Expected query table: ${table}`);
          if (!Array.isArray(response)) return response;
          const rows = response.filter(row => q.filters.every(filter => {
            if (filter.kind === 'eq') return fieldValue(row, filter.field) === filter.value;
            if (filter.kind === 'in') return filter.values.includes(fieldValue(row, filter.field));
            if (filter.kind === 'ilike') return ilike(fieldValue(row, filter.field), filter.pattern);
            const related = filter.relation ? fieldValue(row, filter.relation) : row;
            return splitClauses(filter.expression).some(clause => matchesClause(related, clause));
          })).sort((a, b) => {
            for (const { field, ascending } of q.orders) {
              const comparison = String(fieldValue(a, field) ?? '').localeCompare(String(fieldValue(b, field) ?? ''));
              if (comparison) return ascending ? comparison : -comparison;
            }
            return 0;
          });
          const page = rows.slice(q.offset, Math.min(q.end + 1, q.offset + q.limit));
          return { data: q.single ? page[0] ?? null : page, error: null };
        }).then(resolve, reject);
      },
    };
    return api;
  } };
}

// Run the actual hook through both effects, rerenders and dependency cleanup.
// The fake clock exposes the debounce without making tests wait in real time.
function spotlightHarness({ students = [], schools = [], projects = [], orders = [] } = {}) {
  const queries = [], states = [], effects = [], timers = new Map(), runningTimers = [];
  let stateCursor = 0, effectCursor = 0, timerId = 0, dirty = false, result;
  let currentTerm = '', enabled = true, pendingEffects = [];
  const db = queryDb({ photographers: [{ id: 'owner', user_id: 'user' }], students, schools, projects, orders }, queries);
  db.auth = { getUser: async () => ({ data: { user: { id: 'user' } } }) };
  const context = {
    ...studentSearch,
    exports: {},
    createClient: () => db,
    useState(initial) {
      const index = stateCursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => {
        const next = typeof value === 'function' ? value(states[index]) : value;
        if (!Object.is(states[index], next)) { states[index] = next; dirty = true; }
      }];
    },
    useEffect(callback, deps) {
      const index = effectCursor++, previous = effects[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects[index] = { deps, cleanup: callback() };
        });
      }
    },
    window: {
      setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
  };
  vm.runInNewContext(compiledHook, context);
  function render() {
    dirty = false; stateCursor = 0; effectCursor = 0; pendingEffects = [];
    result = context.exports.useSpotlight(currentTerm, enabled);
    for (const run of pendingEffects) run();
  }
  function rerender() {
    for (let i = 0; dirty && i < 20; i++) render();
    assert.equal(dirty, false, 'Hook updates settled');
  }
  async function settle() {
    for (let i = 0; i < 6; i++) { await flush(); rerender(); }
  }
  async function setTerm(term) { currentTerm = term; render(); rerender(); await settle(); }
  function fireTimers() {
    for (const [id, callback] of [...timers]) {
      timers.delete(id);
      runningTimers.push(Promise.resolve(callback()));
    }
  }
  return {
    queries,
    get result() { rerender(); return result; },
    setTerm, fireTimers, settle,
    async search(term) { await setTerm(term); fireTimers(); await settle(); return result; },
    async finishTimers() { await Promise.all(runningTimers); await settle(); },
    async disable() { enabled = false; render(); rerender(); await settle(); },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
  };
}

function student(id, first, last, extra = {}) {
  return {
    id, first_name: first, last_name: last, school_id: 'school-' + id, class_id: null,
    class_name: 'Grade 9 B', role: 'student',
    schools: { school_name: 'ARS', photographer_id: 'owner', shoot_date: '2026-10-04', created_at: '2026-09-01' },
    ...extra,
  };
}
const studentHits = app => Array.from(app.result.hits).filter(hit => hit.kind === 'student');

test('full names in either order find distinct Grade 8 and Grade 9 records and their own deep links', async () => {
  const app = spotlightHarness({ students: [
    student('grade-eight', 'Sarkis', 'Harout', { class_name: 'Grade 8 B' }),
    student('grade-nine', 'Harout', 'Sarkis'),
    student('partial-only', 'Geneva', 'Sarkissian'),
  ] });
  for (const term of ['Harout Sarkis', 'Sarkis Harout', '  hArOuT   sArKiS  ']) {
    await app.search(term);
    assert.equal(app.result.error, null);
    assert.equal(app.result.loading, false);
    assert.deepEqual(studentHits(app).map(hit => hit.id).sort(), ['grade-eight', 'grade-nine']);
    for (const [id, grade] of [['grade-eight', 'Grade 8 B'], ['grade-nine', 'Grade 9 B']]) {
      const hit = studentHits(app).find(hit => hit.id === id);
      assert.ok(hit.subtitle.includes(grade));
      assert.equal(hit.href, `/dashboard/projects/schools/school-${id}?student=${id}`);
    }
  }
  const query = app.queries.find(q => q.table === 'students');
  assert.match(query.selection, /schools:schools!students_school_id_fkey!inner\(/);
  assert.ok(query.filters.some(f => f.kind === 'eq' && f.field === 'schools.photographer_id' && f.value === 'owner'));
  app.unmount();
});

test('all matching students survive the old eight-result cap and multiple database pages', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => student(`partial-${String(i).padStart(3, '0')}`, 'Harout', `Sarkisian ${String(i).padStart(3, '0')}`));
  rows.push(student('old-grade', 'Harout', 'Sarkis', { class_name: 'Grade 8 B' }));
  // Sorting first_name/last_name puts this exact reversed name after page one.
  rows.push(student('current-grade', 'Sarkis', 'Harout'));
  const app = spotlightHarness({ students: rows });
  await app.search('Harout Sarkis');
  const hits = studentHits(app);
  assert.equal(hits.length, 207);
  assert.deepEqual(hits.slice(0, 2).map(hit => hit.id).sort(), ['current-grade', 'old-grade']);
  assert.deepEqual(new Set(hits.map(hit => hit.id)), new Set(rows.map(row => row.id)));
  assert.equal(hits.find(hit => hit.id === 'current-grade').href, '/dashboard/projects/schools/school-current-grade?student=current-grade');
  const pages = app.queries.filter(q => q.table === 'students');
  assert.deepEqual(pages.map(q => [q.offset, q.end]), [[0, 199], [200, 399]]);
  assert.ok(pages.every(q => q.limit === Infinity));
  assert.ok(pages.every(q => q.orders.map(order => order.field).join(',') === 'first_name,last_name,id'));
  const linkedOrderQueries = app.queries.filter(q => q.table === 'orders' && q.filters.some(f => f.kind === 'in'));
  assert.deepEqual(linkedOrderQueries.map(q => q.filters.find(f => f.kind === 'in').values.length), [200, 7]);
  app.unmount();
});

test('student search keeps owner and school-year restrictions with shoot-date precedence and null fallback', async () => {
  const school = (photographer_id, shoot_date, created_at) => ({ school_name: 'ARS', photographer_id, shoot_date, created_at });
  const app = spotlightHarness({ students: [
    student('current-shoot', 'Harout', 'Sarkis', { schools: school('owner', '2026-10-04', '2025-09-01') }),
    student('current-created', 'Sarkis', 'Harout', { schools: school('owner', null, '2026-09-01') }),
    student('older-shoot', 'Harout', 'Sarkis', { schools: school('owner', '2025-10-04', '2026-09-01') }),
    student('other-owner', 'Harout', 'Sarkis', { schools: school('other', '2026-10-04', '2026-09-01') }),
  ] });
  await app.search('Harout Sarkis 2026');
  assert.deepEqual(studentHits(app).map(hit => hit.id).sort(), ['current-created', 'current-shoot']);
  assert.ok(studentHits(app).every(hit => hit.subtitle.endsWith('2026')));
  app.unmount();
});

test('multiword class queries and role searches still match their own student fields', async () => {
  const app = spotlightHarness({ students: [
    student('ninth-grade', 'Anna', 'Smith'),
    student('eighth-grade', 'Beth', 'Jones', { class_name: 'Grade 8 B' }),
    student('teacher', 'Pat', 'Lee', { class_name: null, role: 'teacher' }),
  ] });
  await app.search('Grade 9');
  assert.deepEqual(studentHits(app).map(hit => hit.id), ['ninth-grade']);
  await app.search('teacher');
  assert.deepEqual(studentHits(app).map(hit => hit.id), ['teacher']);
  app.unmount();
});

test('a later student-page failure reports a search error instead of publishing incomplete results', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => student(`student-${i}`, 'Harout', 'Sarkis'));
  const app = spotlightHarness({ students: q => q.offset === 0 ? rows : { data: null, error: { message: 'Roster temporarily unavailable' } } });
  await app.search('Harout Sarkis');
  assert.equal(app.result.error, 'Search could not load. Please try again.');
  assert.equal(app.result.loading, false);
  assert.equal(app.result.hits.length, 0);
  assert.equal(app.queries.filter(q => q.table === 'students').length, 2);
  app.unmount();
});

test('late linked-order results from a cancelled term cannot replace the next search', async () => {
  const lateOrders = deferred();
  const app = spotlightHarness({
    students: [student('old-student', 'Harout', 'Sarkis'), student('new-student', 'New', 'Name')],
    orders: q => q.filters.some(f => f.kind === 'in' && f.values.includes('old-student')) ? lateOrders.promise : [],
  });
  await app.setTerm('Harout Sarkis');
  app.fireTimers();
  await app.settle();
  assert.ok(app.queries.some(q => q.table === 'orders' && q.filters.some(f => f.kind === 'in' && f.values.includes('old-student'))));
  assert.equal(app.result.loading, true);
  await app.search('New Name');
  assert.deepEqual(studentHits(app).map(hit => hit.id), ['new-student']);
  lateOrders.resolve([{ id: 'old-order', student_id: 'old-student', photographer_id: 'owner', package_name: 'Print', school: { school_name: 'ARS' } }]);
  await app.finishTimers();
  assert.deepEqual(studentHits(app).map(hit => hit.id), ['new-student']);
  assert.equal(app.result.hits.some(hit => hit.id === 'old-order'), false);
  assert.equal(app.result.loading, false);
  assert.equal(app.result.error, null);
  app.unmount();
});
