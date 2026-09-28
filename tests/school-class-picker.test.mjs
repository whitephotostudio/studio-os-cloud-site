import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const page = read('app/dashboard/projects/schools/[schoolId]/page.tsx');
const tree = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let result;
  function visit(node) { if (predicate(node)) result = node.getText(tree); ts.forEachChild(node, visit); }
  visit(tree);
  assert.ok(result);
  return result;
}
const loadPreview = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadSharePreviewStudents');
const pickerJsx = find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'SchoolEmailClassPicker');
const statusJsx = find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'div' && node.openingElement.attributes.properties.some(attr => attr.name?.getText(tree) === 'role' && attr.initializer?.text === 'status'));
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props, key) => ({ type, props, key });
const runtime = { jsx, jsxs: jsx, Fragment: 'fragment' };
const pickerModule = { exports: {}, require: () => runtime };
vm.runInNewContext(compile(read('components/school-email-class-picker.tsx')), pickerModule);
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))];
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  return [node?.props?.children].flat(Infinity).map(text).join('');
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const options = ['Grade 2 B', 'Grade 7 A', 'Grade 12 A'];
const response = (classOptions = options) => Response.json({ ok: true, previewStudents: [], classAudience: { classOptions, totalEmails: 0, fingerprint: 'current', uniqueAddresses: 0, summary: { withoutPhotos: 0 } } });

// Execute the real page loader and JSX so the regression covers the connection
// between request state and the class picker, not a duplicate implementation.
function harness() {
  const requests = [];
  const context = {
    exports: {}, require: () => runtime, URLSearchParams,
    SchoolEmailClassPicker: pickerModule.exports.SchoolEmailClassPicker,
    clean: value => (value ?? '').trim(), schoolEmailPreviewKey: student => student.studentId,
    schoolId: 'school', sharePreviewRequestRef: { current: 0 }, shareRecipientMode: 'classes',
    shareClassNames: [], shareClassOptions: [], shareClassAudience: null,
    shareOnlyWithPhotos: true, shareIncludeClassRegistrations: true, sharePreviewLoading: false,
    sharePreviewError: '', sharePreviewStudents: [], sharePreviewStudentId: '', shareSelectedStudentId: '',
    fetch(url) { const pending = deferred(); requests.push({ url, ...pending }); return pending.promise; },
  };
  for (const name of ['sharePreviewLoading', 'shareClassAudience', 'sharePreviewError', 'sharePreviewStudents', 'sharePreviewStudentId', 'shareSelectedStudentId', 'shareSendSummary', 'shareDeliveryReport', 'shareTestRecipient', 'shareClassOptions', 'shareClassNames']) {
    context['set' + name[0].toUpperCase() + name.slice(1)] = value => { context[name] = typeof value === 'function' ? value(context[name]) : value; };
  }
  vm.runInNewContext(compile(`${loadPreview}\nexports.load = loadSharePreviewStudents;\nexports.picker = () => (${pickerJsx});\nexports.status = () => (${statusJsx});`), context);
  return {
    context, requests, load: context.exports.load,
    render() { const element = context.exports.picker(); return element.type(element.props); },
    status() { return text(context.exports.status()); },
    choose(name, checked) {
      const row = nodes(this.render(), n => n.type === 'label').find(n => text(n) === name);
      nodes(row, n => n.type === 'input')[0].props.onChange({ target: { checked } });
    },
    selected() { return nodes(this.render(), n => n.type === 'label').filter(n => nodes(n, child => child.type === 'input')[0].props.checked).map(text); },
  };
}
async function initialize(app) { const pending = app.load(); app.requests.at(-1).resolve(response()); await pending; }

test('classes and selected checkboxes stay visible while checking an empty audience', async () => {
  const app = harness(); await initialize(app);
  const height = nodes(app.render(), n => n.props.role === 'group')[0].props.style.height;
  app.choose('Grade 2 B', true);
  const pending = app.load();
  assert.deepEqual(app.selected(), ['Grade 2 B']);
  assert.equal(nodes(app.render(), n => n.type === 'input').length, 3);
  assert.equal(nodes(app.render(), n => n.props.role === 'group')[0].props.style.height, height);
  assert.match(text(app.render()), /1 class selected/);
  assert.match(app.status(), /Checking recipients/);
  app.requests.at(-1).resolve(response()); await pending;
  assert.deepEqual(app.selected(), ['Grade 2 B']);
  assert.match(app.status(), /Your classes are selected\. No eligible email addresses/);
});

test('clicking several classes adds selections without modifier keys; stale responses do not clear them', async () => {
  const app = harness(); await initialize(app);
  app.choose('Grade 7 A', true); const older = app.load(); const first = app.requests.at(-1);
  app.choose('Grade 12 A', true); const latest = app.load();
  assert.deepEqual(app.selected(), ['Grade 7 A', 'Grade 12 A']);
  assert.deepEqual(new URL(app.requests.at(-1).url, 'https://example.test').searchParams.getAll('className'), ['Grade 7 A', 'Grade 12 A']);
  app.requests.at(-1).resolve(response()); await latest;
  first.resolve(response(['obsolete'])); await older;
  assert.deepEqual(app.selected(), ['Grade 7 A', 'Grade 12 A']);
  app.choose('Grade 7 A', false);
  assert.deepEqual(app.selected(), ['Grade 12 A']);
});

test('failed previews preserve class choices and can retry without restoring a stale audience', async () => {
  const app = harness(); await initialize(app); app.choose('Grade 7 A', true);
  const pending = app.load();
  app.requests.at(-1).resolve(Response.json({ ok: false, message: 'Temporarily unavailable' }, { status: 503 })); await pending;
  assert.deepEqual(app.selected(), ['Grade 7 A']);
  assert.equal(app.context.shareClassAudience, null);
  assert.match(app.status(), /still selected.*Refresh recipients/);
  const retry = app.load(); app.requests.at(-1).resolve(response()); await retry;
  assert.deepEqual(app.selected(), ['Grade 7 A']);
  assert.equal(app.context.sharePreviewError, '');
  nodes(app.render(), n => n.type === 'button')[0].props.onClick();
  assert.deepEqual(app.selected(), []);
});
