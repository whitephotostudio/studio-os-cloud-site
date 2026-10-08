import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const root = new URL('../', import.meta.url);
const files = execFileSync('rg', ['--files', 'app', 'lib', 'components'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(path => /\.tsx?$/.test(path));
const queries = [];
const publicChoiceQueries = new Set(['app/parents/page.tsx', 'app/api/portal/choices/route.ts']);
for (const path of files) {
  const source = readFileSync(new URL(path, root), 'utf8');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'select' && node.arguments[0]
      && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
      let expression = node.expression.expression, table;
      while (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
        if (expression.expression.name.text === 'from' && ts.isStringLiteral(expression.arguments[0])) {
          table = expression.arguments[0].text;
          break;
        }
        expression = expression.expression.expression;
      }
      const relation = table === 'schools' ? 'students' : table === 'students' ? 'schools' : null;
      const selection = node.arguments[0].text;
      if (relation && new RegExp(`\\b${relation}(?:!|\\s*\\()`).test(selection)) {
        let chain = node;
        while (ts.isPropertyAccessExpression(chain.parent) && ts.isCallExpression(chain.parent.parent)) chain = chain.parent.parent;
        queries.push({ path, table, relation, selection, chain: chain.getText(file) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
}

// Model the production schema's original FK plus its yearbook bridge at the
// HTTP boundary, using the real Supabase query builder and production queries.
// The fixtures contain another owner's school to detect dropped owner scopes.
function databaseFixture() {
  const requests = [];
  const fetcher = async (input, options) => {
    const url = new URL(input), table = url.pathname.split('/').pop();
    const relation = table === 'schools' ? 'students' : 'schools';
    const selection = url.searchParams.get('select') ?? '';
    requests.push(url);
    if (!selection.includes(`${relation}:${relation}!students_school_id_fkey`)) {
      return Response.json({ code: 'PGRST201', details: [{ relationship: 'students_school_id_fkey' }, { relationship: 'school_yearbook_selections' }],
        hint: `Use ${relation}!students_school_id_fkey`, message: 'More than one relationship was found' }, { status: 300 });
    }
    let rows = table === 'schools' ? [
      { id: 'owned-school', photographer_id: 'owner', students: [{ count: 23 }] },
      { id: 'private-school', photographer_id: 'other', students: [{ count: 97 }] },
    ] : [
      { id: 'owned-student', school_id: 'owned-school', first_name: 'Maya', last_name: 'Owned', schools: { id: 'owned-school', photographer_id: 'owner', school_name: 'Owned school' } },
      { id: 'private-student', school_id: 'private-school', first_name: 'Maya', last_name: 'Private', schools: { id: 'private-school', photographer_id: 'other', school_name: 'Private school' } },
    ];
    for (const [field, value] of url.searchParams) {
      if (!value.startsWith('eq.')) continue;
      const expected = value.slice(3);
      rows = rows.filter(row => (field === 'schools.photographer_id' ? row.schools?.photographer_id : row[field]) === expected);
    }
    const accept = new Headers(options.headers).get('accept') ?? '';
    return Response.json(accept.includes('vnd.pgrst.object') ? rows[0] ?? null : rows);
  };
  const client = createClient('https://fixture.supabase.co', 'fixture-public-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher },
  });
  return { client, requests };
}

test('school/student embed inventory covers owner workflows and both public school-choice loaders', () => {
  assert.deepEqual(queries.map(query => query.path).sort(), [
    'app/api/dashboard/admin/recovery/route.ts', 'app/api/dashboard/events/route.ts',
    'app/dashboard/admin/recovery-requests/page.tsx', 'app/dashboard/schools/page.tsx',
    'components/spotlight-search.tsx', 'lib/pin-recovery.ts',
    'app/parents/page.tsx', 'app/api/portal/choices/route.ts',
  ].sort());
});

for (const query of queries) {
  test(`${query.path}: production query resolves the roster FK and retains the JSON alias`, async () => {
    const { client, requests } = databaseFixture();
    const exports = {};
    const compiled = ts.transpileModule(`exports.run = async () => await ${query.chain};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(compiled, { exports, supabase: client, service: client, sb: client, ctx: { service: client },
      photographerRow: { id: 'owner' }, photographerId: 'owner', body: { studentId: 'owned-student' },
      input: { schoolId: 'owned-school', firstName: 'Maya', lastName: 'Owned' },
      row: { typed_first_name: 'Maya', typed_last_name: 'Owned' },
    });
    const result = await exports.run();
    assert.equal(result.error, null);
    assert.equal(result.status, 200);
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    assert.ok(rows.length);
    assert.ok(rows.every(row => query.relation in row));
    const request = requests[0];
    if (query.table === 'schools') {
      if (publicChoiceQueries.has(query.path)) {
        // The public chooser intentionally lists school names across studios.
        // Its loaders strip this internal count before returning choices.
        assert.equal(request.searchParams.get('photographer_id'), null);
        assert.deepEqual(rows.map(row => row.id), ['owned-school', 'private-school']);
      } else {
        assert.equal(request.searchParams.get('photographer_id'), 'eq.owner');
        assert.deepEqual(rows.map(row => row.id), ['owned-school']);
      }
      assert.equal(rows[0].students[0].count, 23);
    } else {
      assert.match(query.selection, /schools:schools!students_school_id_fkey!inner\(/);
      if (query.path === 'lib/pin-recovery.ts') assert.equal(request.searchParams.get('school_id'), 'eq.owned-school');
      if (query.path === 'components/spotlight-search.tsx') assert.equal(request.searchParams.get('schools.photographer_id'), 'eq.owner');
      if (query.path === 'app/api/dashboard/admin/recovery/route.ts') assert.equal(request.searchParams.get('id'), 'eq.owned-student');
    }
    // The same production query with the old embed demonstrably hits the
    // ambiguity, rather than allowing a mock to accept every selection.
    const old = query.selection.replace(`${query.relation}:${query.relation}!students_school_id_fkey`, query.relation);
    const rejected = await client.from(query.table).select(old).limit(0);
    assert.equal(rejected.status, 300);
    assert.equal(rejected.error.code, 'PGRST201');
  });
}
