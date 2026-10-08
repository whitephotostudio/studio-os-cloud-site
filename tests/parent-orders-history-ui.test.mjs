import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { formatOrderMoney } from '../lib/order-money.ts';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../components/parents/orders-history-panel.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const draft = { id: 'draft', shortId: 'DRAFT', status: 'payment_pending', paidAt: null, createdAt: '2026-10-08T12:00:00Z',
  totalCents: 1050, subtotalCents: 1000, currency: 'cad', cartSnapshot: [{ key: 'photo' }], items: [],
  schoolId: 'school', projectId: null, studentId: 'student', orderGroupId: null, studentName: 'Child', canDiscardCheckout: true };
const paid = { ...draft, id: 'paid', shortId: 'PAID', status: 'paid', paidAt: '2026-10-08T12:00:00Z' };
function fixture(rows, extraStates = []) {
  const states = [rows, false, null, null, null, false, null, null];
  extraStates.forEach(([index, value]) => { states[index] = value; });
  let cursor = 0;
  const dependencies = { react: {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in states)) states[index] = { current: initial }; return states[index]; },
    useMemo(fn) { return fn(); }, useEffect() {},
  }, 'react/jsx-runtime': require('react/jsx-runtime'), '@/lib/order-money': { formatOrderMoney } };
  const exports = {};
  new Function('require', 'exports', compiled)(name => { if (!dependencies[name]) throw Error(name); return dependencies[name]; }, exports);
  const props = { pin: '1234', email: 'parent@example.test', schoolId: 'school',
    tone: { text: '#eee', mutedText: '#aaa', accent: '#a00', border: '#444', surface: '#111' }, onReorder() {} };
  const render = () => { cursor = 0; return exports.default(props); };
  return { states, render, markup: () => renderToStaticMarkup(render()) };
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
function button(tree, label) { return nodes(tree, node => node.type === 'button' && text(node) === label)[0]; }

test('rendered history distinguishes unfinished carts and offers deletion only with a strict server grant', () => {
  const f = fixture([draft, paid, { ...draft, id: 'pending', status: 'pending' }, { ...draft, id: 'fallback', canDiscardCheckout: false }]);
  const html = f.markup();
  assert.equal((html.match(/Delete unfinished checkout/g) || []).length, 1);
  assert.match(html, /Unfinished checkout/); assert.match(html, />Pending</); assert.match(html, /Processed/);
  assert.match(html, /Continue with these items/); assert.match(html, /Reorder these items/);
  assert.equal(button(f.render(), 'Delete unfinished checkout').props.disabled, false);
});
test('delete opens a bounded keyboard-accessible confirmation and preserves completed orders', async () => {
  const f = fixture([draft, paid]);
  button(f.render(), 'Delete unfinished checkout').props.onClick();
  const modal = nodes(f.render(), node => node.props.role === 'dialog')[0];
  assert.ok(modal); assert.equal(modal.props['aria-modal'], 'true'); assert.equal(modal.props.tabIndex, -1);
  assert.equal(modal.props.style.overflowY, 'auto'); assert.equal(modal.props.style.maxHeight, 'calc(100dvh - 32px)');
  assert.match(text(modal), /removed from your Orders list/); assert.match(text(modal), /completed orders and purchased photos stay available/);
  let request;
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => { request = { url, body: JSON.parse(options.body) }; return Response.json({ ok: true, cancelledOrderIds: ['draft'] }); };
    await button(f.render(), 'Delete & stop reminders').props.onClick();
  } finally { globalThis.fetch = previousFetch; }
  assert.equal(request.url, '/api/portal/orders/dismiss');
  assert.deepEqual(request.body, { orderId: 'draft', pin: '1234', email: 'parent@example.test', schoolId: 'school', confirmed: true });
  assert.deepEqual(f.states[0].map(row => row.id), ['paid']); assert.equal(f.states[4], null);
  assert.match(f.markup(), /Its reminders have stopped/); assert.match(f.markup(), /Processed/);
});
test('deleting the last draft shows success and an empty list', async () => {
  const f = fixture([draft]); button(f.render(), 'Delete unfinished checkout').props.onClick();
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ ok: true, cancelledOrderIds: ['draft'] });
    await button(f.render(), 'Delete & stop reminders').props.onClick();
  } finally { globalThis.fetch = previousFetch; }
  assert.deepEqual(f.states[0], []); assert.match(f.markup(), /No orders yet/);
  assert.match(f.markup(), /role="status"/); assert.match(f.markup(), /Unfinished checkout deleted/);
});
test('busy confirmation prevents repeat actions, failures keep the checkout reviewable, and cancel is reversible', async () => {
  const busy = fixture([draft], [[4, draft], [5, true]]);
  const tree = busy.render(); assert.equal(button(tree, 'Deleting…').props.disabled, true);
  assert.equal(button(tree, 'Keep checkout').props.disabled, true); assert.equal(button(tree, 'Delete unfinished checkout').props.disabled, true);
  const f = fixture([draft]); button(f.render(), 'Delete unfinished checkout').props.onClick();
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ ok: false, message: 'Payment processing; refresh its status.' }, { status: 409 });
    await button(f.render(), 'Delete & stop reminders').props.onClick();
  } finally { globalThis.fetch = previousFetch; }
  assert.equal(f.states[0].length, 1); assert.equal(f.states[5], false);
  assert.match(f.markup(), /role="alert"/); assert.match(f.markup(), /Payment processing/);
  button(f.render(), 'Keep checkout').props.onClick(); assert.equal(f.states[4], null); assert.equal(f.states[0].length, 1);
});
