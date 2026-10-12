import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load() {
  const logs = [];
  const exports = {};
  const output = ts.transpileModule(readFileSync(new URL('../../app/api/csp-report/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { exports, require: () => ({ NextResponse: Response }), URL, TextDecoder, console: { warn: (...args) => logs.push(args) } });
  return { POST: exports.POST, logs };
}

test('legacy and modern CSP diagnostics omit private paths, credentials and samples', async () => {
  for (const modern of [false, true]) {
    const { POST, logs } = load();
    const body = modern ? { documentURL: 'https://studio.example/parents/secret-pin?email=parent@example.com', blockedURL: 'https://cdn.example/student-name.jpg?mediaToken=secret-token', sourceFile: 'https://studio.example/private-file?token=secret', effectiveDirective: 'script-src-elem', sample: 'private typed content' } : { 'document-uri': 'https://studio.example/parents/secret-pin?email=parent@example.com', 'blocked-uri': 'https://cdn.example/student-name.jpg?mediaToken=secret-token', 'source-file': 'https://studio.example/private-file?token=secret', 'effective-directive': 'script-src-elem', 'script-sample': 'private typed content' };
    const report = modern ? [{ type: 'csp-violation', body }] : { 'csp-report': body };
    const response = await POST(new Request('https://studio.example/api/csp-report', { method: 'POST', body: JSON.stringify(report) }));
    assert.equal(response.status, 204);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][1].documentOrigin, 'https://studio.example');
    assert.equal(logs[0][1].blockedOrigin, 'https://cdn.example');
    assert.equal(logs[0][1].directive, 'script-src-elem');
    assert.doesNotMatch(JSON.stringify(logs), /secret|student-name|private-file|parent@|typed content/);
  }
});

test('CSP reports bound log volume and discard malformed or oversized data privately', async () => {
  const { POST, logs } = load();
  const send = body => POST(new Request('https://studio.example/api/csp-report', { method: 'POST', body }));
  assert.equal((await send('secret malformed body')).status, 204);
  assert.equal((await send('x'.repeat(40_000))).status, 204);
  assert.equal(logs.length, 0);
  await send(JSON.stringify(Array.from({ length: 100 }, () => ({ body: { blockedURL: 'inline', effectiveDirective: 'script-src' } }))));
  assert.equal(logs.length, 10);
});
