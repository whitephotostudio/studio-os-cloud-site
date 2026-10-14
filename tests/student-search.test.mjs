import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { PGlite } from '@electric-sql/pglite';

const exports = {};
vm.runInNewContext(ts.transpileModule(
  readFileSync(new URL('../lib/student-search.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, { exports });
const { studentSearchTokens, studentSearchFilter, studentMatchesSearch,
  studentSearchRank, shortOrderIdBounds, fetchStudentSearchPages } = exports;

test('search words normalize case and whitespace while retaining name punctuation', () => {
  assert.deepEqual(Array.from(studentSearchTokens('  HAROUT\tSarkis\u00a0O’Neil  ')), ['harout', 'sarkis', 'o’neil']);
  assert.deepEqual(Array.from(studentSearchTokens(' \n\t ')), []);
  assert.equal(studentSearchFilter('   '), null);
  assert.equal(studentSearchFilter('Harout', []), null);
  assert.throws(() => studentSearchFilter('Harout', ['first_name,role']), /Invalid student search field/);
});

test('local names match either order, partial words, and middle names', () => {
  for (const [first, last] of [['Harout', 'Sarkis'], ['Sarkis', 'Harout']]) {
    for (const query of ['Harout Sarkis', 'Sarkis Harout', ' HAROUT   SARKIS ', 'har sar', 'sark har', 'Harout', 'Sarkis']) {
      assert.equal(studentMatchesSearch(first, last, query), true, `${first} ${last}: ${query}`);
    }
    assert.equal(studentMatchesSearch(first, last, 'Harout Jones'), false);
  }
  assert.equal(studentMatchesSearch('Harout Harry', 'Sarkis', 'sark hary'), false);
  assert.equal(studentMatchesSearch('Harout Harry', 'Sarkis', 'sark harry har'), true);
  assert.equal(studentMatchesSearch('Harout Sarkis', null, 'Sarkis Harout'), true);
  assert.equal(studentMatchesSearch(null, null, 'harout'), false);
  assert.equal(studentMatchesSearch(null, null, ''), true);
});

test('exact names and words rank ahead of surname prefixes and substrings', () => {
  assert.equal(studentSearchRank('Harout', 'Sarkis', 'Sarkis Harout'), 0);
  assert.equal(studentSearchRank('Sarkis', 'Harout', 'Harout Sarkis'), 0);
  assert.equal(studentSearchRank('Harout Harry', 'Sarkis', 'Sarkis Harout'), 1);
  assert.equal(studentSearchRank('Vartan', 'Sarkis', 'sarkis'), 1);
  assert.equal(studentSearchRank('Geneva', 'Sarkissian', 'sarkis'), 2);
  assert.equal(studentSearchRank('Geneva', 'DerSarkissian', 'sarkis'), 3);
  assert.equal(studentSearchRank('Maya', 'Jones', 'Grade 9'), 4);
  assert.equal(studentSearchRank('Maya', 'Jones', ''), 4);
});

// Interpret the PostgREST and/or grammar at the query boundary and execute its
// ILIKE patterns in PostgreSQL. This catches incorrectly grouped names and
// either missing layer of quoting without using the local matching helper.
function filterSql(filter) {
  let cursor = 0;
  const values = [];
  function expression() {
    const logic = /^(and|or)\(/.exec(filter.slice(cursor));
    if (logic) {
      cursor += logic[0].length;
      const children = [expression()];
      while (filter[cursor] === ',') {
        cursor += 1;
        children.push(expression());
      }
      assert.equal(filter[cursor++], ')');
      return `(${children.join(logic[1] === 'and' ? ' AND ' : ' OR ')})`;
    }
    const field = /^([a-zA-Z_][a-zA-Z0-9_]*)\.ilike\./.exec(filter.slice(cursor));
    assert.ok(field, `Invalid condition at ${filter.slice(cursor)}`);
    cursor += field[0].length;
    const quoted = /^"(?:\\.|[^"\\])*"/.exec(filter.slice(cursor));
    assert.ok(quoted, 'Expected a PostgREST quoted pattern');
    cursor += quoted[0].length;
    values.push(JSON.parse(quoted[0]));
    return `"${field[1]}" ILIKE $${values.length}`;
  }
  const sql = expression();
  assert.equal(cursor, filter.length, 'Entire filter must parse');
  return { sql, values };
}

test('database filter finds split full names in both orders and preserves distinct grade records', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE students (id text, first_name text, last_name text, class_name text, role text)');
    const records = [
      ['grade-8', 'Sarkis', 'Harout', 'Grade 8 B', 'Student'],
      ['grade-9', 'Harout', 'Sarkis', 'Grade 9 B', 'Student'],
      ['middle', 'Harout Harry', 'Sarkis', 'Grade 10', 'Student'],
      ['surname-prefix', 'Geneva', 'Sarkissian', 'Grade 2', 'Student'],
      ['other', 'Harout', 'Jones', 'Grade 3', 'Student'],
      ['punctuation', 'Anne_50%\\"(X),Neil', null, 'Grade 4', 'Student'],
      ['wildcard-neighbor', 'AnneX50Anything(X),Neil', null, 'Grade 5', 'Student'],
    ];
    for (const row of records) await db.query('INSERT INTO students VALUES ($1,$2,$3,$4,$5)', row);
    for (const term of ['Harout Sarkis', 'Sarkis Harout', 'har sar', '  SARKIS\tHAROUT ']) {
      const { sql, values } = filterSql(studentSearchFilter(term));
      const result = await db.query(`SELECT id FROM students WHERE ${sql} ORDER BY id`, values);
      assert.deepEqual(result.rows.map(row => row.id), ['grade-8', 'grade-9', 'middle'], term);
    }
    const gradeQuery = filterSql(studentSearchFilter('Harout Grade 9'));
    assert.deepEqual((await db.query(`SELECT id FROM students WHERE ${gradeQuery.sql}`, gradeQuery.values)).rows,
      [{ id: 'grade-9' }]);
    const namesOnly = filterSql(studentSearchFilter('Grade 9', ['first_name', 'last_name']));
    assert.equal((await db.query(`SELECT id FROM students WHERE ${namesOnly.sql}`, namesOnly.values)).rows.length, 0);
    const punctuation = filterSql(studentSearchFilter('Anne_50%\\"(X),Neil', ['first_name', 'last_name']));
    assert.deepEqual((await db.query(`SELECT id FROM students WHERE ${punctuation.sql}`, punctuation.values)).rows,
      [{ id: 'punctuation' }]);
  } finally {
    await db.close();
  }
});

test('real Supabase builder carries one nested expression with literal quoted values', async () => {
  let request;
  const client = createClient('https://fixture.supabase.co', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => { request = new URL(input); return Response.json([]); } },
  });
  const filter = studentSearchFilter('Sarkis Harout');
  await client.from('students').select('id').or(filter).order('id').range(0, 199);
  assert.equal(request.searchParams.get('or'), `(${filter})`);
  assert.equal(request.searchParams.get('or').startsWith('(and(or('), true);
  assert.equal(request.searchParams.get('offset'), '0');
  assert.equal(request.searchParams.get('limit'), '200');
});

test('all 209 filtered students remain searchable beyond the former eight-result cap', async () => {
  const matches = Array.from({ length: 209 }, (_, index) => ({ id: `student-${index}`, class_name: index === 208 ? 'Grade 9 B' : 'Grade 8 B' }));
  const calls = [];
  const rows = await fetchStudentSearchPages(async (from, to) => {
    calls.push([from, to]);
    return { data: matches.slice(from, to + 1), error: null };
  });
  assert.deepEqual(calls, [[0, 199], [200, 399]]);
  assert.deepEqual(Array.from(rows), matches);
  assert.equal(rows.find(row => row.id === 'student-208').class_name, 'Grade 9 B');
});

test('bounded autocomplete reads 201 rows without fetching another complete page', async () => {
  const matches = Array.from({ length: 900 }, (_, id) => ({ id }));
  const calls = [];
  const rows = await fetchStudentSearchPages(async (from, to) => {
    calls.push([from, to]);
    return { data: matches.slice(from, to + 1), error: null };
  }, undefined, 201);
  assert.deepEqual(calls, [[0, 199], [200, 200]]);
  assert.deepEqual(Array.from(rows), matches.slice(0, 201));
});

test('finite limits avoid unnecessary queries and never return excess rows', async () => {
  const calls = [];
  const fetchPage = async (from, to) => {
    calls.push([from, to]);
    // A defensive limit also holds if a fixture or server ignores the range.
    return { data: Array.from({ length: 200 }, (_, id) => ({ id })), error: null };
  };
  assert.equal((await fetchStudentSearchPages(fetchPage, undefined, 50)).length, 50);
  assert.deepEqual(calls, [[0, 49]]);
  calls.length = 0;
  assert.equal((await fetchStudentSearchPages(fetchPage, undefined, 200)).length, 200);
  assert.deepEqual(calls, [[0, 199]]);
  calls.length = 0;
  assert.deepEqual(Array.from(await fetchStudentSearchPages(fetchPage, undefined, 0)), []);
  assert.equal(calls.length, 0);
});

test('invalid row limits fail before requesting a page', async () => {
  let calls = 0;
  for (const limit of [-1, NaN, 1.5, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(fetchStudentSearchPages(async () => {
      calls++;
      return { data: [], error: null };
    }, undefined, limit), /nonnegative safe integer or Infinity/);
  }
  assert.equal(calls, 0);
});

test('a full final page requires an empty follow-up page before completion', async () => {
  const calls = [];
  const rows = await fetchStudentSearchPages(async (from, to) => {
    calls.push([from, to]);
    return { data: from === 0 ? Array.from({ length: 200 }, (_, id) => ({ id })) : [], error: null };
  });
  assert.equal(rows.length, 200);
  assert.deepEqual(calls, [[0, 199], [200, 399]]);
  assert.deepEqual(Array.from(await fetchStudentSearchPages(async () => ({ data: null, error: null }))), []);
});

test('pagination reports database failures instead of returning incomplete or empty matches', async () => {
  await assert.rejects(fetchStudentSearchPages(async () => ({ data: null, error: { message: 'Search unavailable' } })), /Search unavailable/);
  await assert.rejects(fetchStudentSearchPages(async from => ({ data: from === 0 ? Array.from({ length: 200 }, (_, id) => ({ id })) : null,
    error: from === 0 ? null : { message: 'Second page failed' } })), /Second page failed/);
});

test('cancellation before or during a page discards every stale result', async () => {
  let calls = 0;
  assert.deepEqual(Array.from(await fetchStudentSearchPages(async () => { calls++; return { data: [], error: null }; }, () => true)), []);
  assert.equal(calls, 0);
  let cancelled = false;
  const result = await fetchStudentSearchPages(async from => {
    calls++;
    if (from === 0) return { data: Array.from({ length: 200 }, (_, id) => ({ id })), error: null };
    cancelled = true;
    return { data: [{ id: 'latest-grade-9' }], error: null };
  }, () => cancelled);
  assert.equal(calls, 2);
  assert.deepEqual(Array.from(result), []);
});

test('short order IDs become canonical inclusive UUID bounds', () => {
  assert.deepEqual({ ...shortOrderIdBounds('  DEADbeef  ') }, {
    lower: 'deadbeef-0000-0000-0000-000000000000',
    upper: 'deadbeef-ffff-ffff-ffff-ffffffffffff',
  });
  assert.deepEqual({ ...shortOrderIdBounds('3E92') }, {
    lower: '3e920000-0000-0000-0000-000000000000',
    upper: '3e92ffff-ffff-ffff-ffff-ffffffffffff',
  });
  assert.deepEqual({ ...shortOrderIdBounds('deadbeef-cafe-1234') }, {
    lower: 'deadbeef-cafe-1234-0000-000000000000',
    upper: 'deadbeef-cafe-1234-ffff-ffffffffffff',
  });
  const full = 'deadbeef-cafe-1234-abcd-0123456789ab';
  assert.deepEqual({ ...shortOrderIdBounds(full) }, { lower: full, upper: full });
  assert.deepEqual({ ...shortOrderIdBounds(full.replaceAll('-', '')) }, { lower: full, upper: full });
  for (const invalid of ['', 'abc', '----', 'xyz1', 'abcd ef12', 'abcd%', 'a'.repeat(33)]) {
    assert.equal(shortOrderIdBounds(invalid), null, invalid);
  }
});

test('order prefix bounds match UUID values in PostgreSQL without a text operator', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE orders (id uuid);
      INSERT INTO orders VALUES ('deadbeef-0000-0000-0000-000000000000'),
        ('deadbeef-cafe-1234-abcd-0123456789ab'),
        ('deadbeef-ffff-ffff-ffff-ffffffffffff'),
        ('deadbeee-ffff-ffff-ffff-ffffffffffff'),
        ('deadbef0-0000-0000-0000-000000000000');`);
    const { lower, upper } = shortOrderIdBounds('DEADBEEF');
    const result = await db.query('SELECT id FROM orders WHERE id >= $1::uuid AND id <= $2::uuid ORDER BY id', [lower, upper]);
    assert.deepEqual(result.rows.map(row => row.id), [
      'deadbeef-0000-0000-0000-000000000000',
      'deadbeef-cafe-1234-abcd-0123456789ab',
      'deadbeef-ffff-ffff-ffff-ffffffffffff',
    ]);
  } finally {
    await db.close();
  }
});
