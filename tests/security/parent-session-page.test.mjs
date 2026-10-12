import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const lane = '10000000-0000-4000-8000-000000000001';
const returnId = '10000000-0000-4000-8000-000000000002';
function fixture({ unavailable = false, nodeEnv = 'production' } = {}) {
  const requests = [], accesses = [], returns = [], redirects = [];
  const headers = new Headers({ host: 'localhost:3000', cookie: 'synthetic-cookie=synthetic', 'x-forwarded-proto': 'http' });
  const scope = { laneId: lane, kind: 'school', galleryId: returnId, pin: 'secret-actual-student-pin',
    email: 'viewer@example.test', photographerId: '10000000-0000-4000-8000-000000000003' };
  function load(file) {
    const exports = {};
    const source = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const modules = {
      'react': React, 'react/jsx-runtime': require('react/jsx-runtime'),
      'next/headers': { headers: async () => headers },
      'next/link': { default: ({ href, children }) => React.createElement('a', { href }, children) },
      'next/navigation': { redirect: url => { redirects.push(url); throw new Error('SYNTHETIC_NEXT_REDIRECT'); } },
      '@/components/parents/parent-gallery-client': { default: ({ sessionAccess }) => {
        accesses.push(sessionAccess); return React.createElement('div', { 'data-access': JSON.stringify(sessionAccess) }, 'Gallery');
      } },
      '@/lib/parent-gallery-session': { resolveParentGallerySession: async request => {
        requests.push(request); if (unavailable) throw new Error('Unavailable'); return scope;
      } },
      '@/lib/parent-checkout-return': { resolveParentCheckoutReturn: async (request, handle, laneId) => {
        returns.push({ request, handle, laneId }); if (unavailable) throw new Error('Unavailable');
        return { returnId: handle, laneId: lane, status: 'success', sessionId: 'cs_synthetic_paid_proof' };
      } },
      '@/lib/parent-gallery-entry': { createParentGalleryEntryPath: () => '/api/portal/session/entry?token=ec1.synthetic-private-entry' },
    };
    new Function('require', 'exports', 'process', source)(name => modules[name] ?? assert.fail(`Unexpected dependency ${name}`),
      exports, { env: { NODE_ENV: nodeEnv } });
    return exports;
  }
  return { load, scope, requests, accesses, returns, redirects };
}

test('server view serializes the opaque lane and safe context without sending the real PIN to the client', async () => {
  const f = fixture();
  const page = f.load('app/parents/view/[laneId]/page.tsx');
  assert.equal(page.dynamic, 'force-dynamic');
  const html = renderToStaticMarkup(await page.default({ params: Promise.resolve({ laneId: lane }), searchParams: Promise.resolve({}) }));
  assert.equal(f.requests[0].url, `https://www.studiooscloud.com/parents/view/${lane}`);
  assert.equal(f.requests[0].headers.get('cookie'), 'synthetic-cookie=synthetic');
  assert.ok(!html.includes(f.scope.pin));
  assert.equal(Object.hasOwn(f.accesses[0], 'pin'), false);
  assert.equal(f.accesses[0].laneId, lane);
  assert.equal(f.accesses[0].viewerEmail, f.scope.email);
  assert.equal(f.accesses[0].shareUrl, '/api/portal/session/entry?token=ec1.synthetic-private-entry');
});

test('payment context stays in server props and an ambiguous return preserves the basket fallback', async () => {
  const f = fixture(), page = f.load('app/parents/view/[laneId]/page.tsx');
  renderToStaticMarkup(await page.default({ params: Promise.resolve({ laneId: lane }),
    searchParams: Promise.resolve({ checkout: 'success', return: returnId }) }));
  assert.equal(f.returns[0].laneId, lane);
  assert.equal(f.accesses[0].checkoutSessionId, 'cs_synthetic_paid_proof');
  assert.equal(f.accesses[0].checkoutReturnId, returnId);
  assert.ok(!f.requests[0].url.includes('session_id'));
  const count = f.accesses.length;
  const html = renderToStaticMarkup(await page.default({ params: Promise.resolve({ laneId: lane }),
    searchParams: Promise.resolve({ checkout: 'success', return: [returnId, returnId] }) }));
  assert.match(html, /saved basket has been kept/);
  assert.equal(f.accesses.length, count);
  assert.equal(f.returns.length, 1);
});

test('unavailable or expired server access shows a QR reopening and payment-status fallback without rendering a gallery', async () => {
  const f = fixture({ unavailable: true }), page = f.load('app/parents/view/[laneId]/page.tsx');
  const html = renderToStaticMarkup(await page.default({ params: Promise.resolve({ laneId: lane }), searchParams: Promise.resolve({}) }));
  assert.match(html, /saved basket has been kept/);
  assert.match(html, /check your order before starting another purchase/);
  assert.equal(f.accesses.length, 0); assert.equal(f.returns.length, 0);
  assert.ok(!html.includes(f.scope.pin));
});

test('both development server pages retain the HTTP scheme used for the development-only cookie', async () => {
  const f = fixture({ nodeEnv: 'development' });
  await f.load('app/parents/view/[laneId]/page.tsx').default({ params: Promise.resolve({ laneId: lane }), searchParams: Promise.resolve({}) });
  assert.equal(new URL(f.requests[0].url).origin, 'http://localhost:3000');
  await assert.rejects(f.load('app/parents/checkout-return/[returnId]/page.tsx').default({
    params: Promise.resolve({ returnId }), searchParams: Promise.resolve({ result: 'success', session_id: 'cs_synthetic_paid_proof' }),
  }), /SYNTHETIC_NEXT_REDIRECT/);
  assert.equal(new URL(f.returns[0].request.url).origin, 'http://localhost:3000');
  assert.equal(f.redirects[0], `/parents/view/${lane}?checkout=success&return=${returnId}`);
  assert.ok(!f.redirects[0].includes('session_id') && !f.redirects[0].includes(f.scope.pin) && !f.redirects[0].includes(f.scope.email));
});
