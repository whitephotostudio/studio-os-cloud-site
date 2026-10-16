import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../../lib/labs/pilot.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(env = {}) {
  const exports = {};
  vm.runInNewContext(source, { exports, process: { env }, URL, Set, require: name => {
    assert.equal(name, 'server-only');
    return {};
  } });
  return exports;
}

test('pilot requires its explicit flag and exact isolated Supabase project', () => {
  const pilot = 'https://lgwmxqjwgkzktikhkebp.supabase.co';
  for (const NEXT_PUBLIC_SUPABASE_URL of [pilot, `${pilot}/`]) {
    assert.equal(fixture({ STUDIO_OS_LAB_PILOT: '1', NEXT_PUBLIC_SUPABASE_URL }).isLabPilot(), true);
    for (const STUDIO_OS_LAB_PILOT of [undefined, '', 'true', '0', ' 1']) {
      assert.equal(fixture({ STUDIO_OS_LAB_PILOT, NEXT_PUBLIC_SUPABASE_URL }).isLabPilot(), false);
    }
  }
  for (const NEXT_PUBLIC_SUPABASE_URL of [undefined, '', 'malformed',
    'https://bwqhzczxoevouiondjak.supabase.co', 'https://another-project.supabase.co',
    'http://lgwmxqjwgkzktikhkebp.supabase.co', `${pilot}/auth/v1`, `${pilot}?other=1`,
    `${pilot}#fragment`, 'https://lgwmxqjwgkzktikhkebp.supabase.co.evil.example',
    'https://attacker@lgwmxqjwgkzktikhkebp.supabase.co']) {
    assert.equal(fixture({ STUDIO_OS_LAB_PILOT: '1', NEXT_PUBLIC_SUPABASE_URL }).isLabPilot(), false, NEXT_PUBLIC_SUPABASE_URL);
  }
});

test('only pilot pages, existing MFA and agreement endpoints, and lab APIs pass the route gate', () => {
  const { isLabPilotPath } = fixture();
  for (const path of ['/labs-pilot', '/labs-pilot/sample-file', '/lab', '/sign-in', '/dashboard/labs',
    '/dashboard/labs/', '/dashboard/labs/catalog', '/dashboard/labs/orders', '/api/dashboard/labs',
    '/api/dashboard/lab-catalog', '/api/dashboard/lab-orders', '/api/dashboard/lab-order-assets',
    '/api/lab/orders', '/api/lab/orders/123/files/456', '/api/dashboard/mfa',
    '/api/dashboard/agreement/status', '/api/dashboard/agreement/accept', '/api/csp-report', '/manifest.webmanifest',
    '/terms', '/privacy', '/data-responsibility-agreement']) {
    assert.equal(isLabPilotPath(path), true, path);
  }
  for (const path of ['/', '/dashboard', '/dashboard/settings', '/dashboard/packages', '/lab/other',
    '/dashboard/labs-admin', '/api/lab/orders-other', '/api/dashboard/labs/other',
    '/api/dashboard/mfa-other', '/api/dashboard/agreement/other', '/api/stripe/checkout',
    '/api/portal/session', '/api/admin/users', '/labs-pilot/other', '/sign-in-extra',
    '/dashboard/labs/../../admin', '/dashboard/labs/./orders', '/dashboard/labs//orders',
    '/dashboard/labs/%2e%2e/admin', '/dashboard/labs/%252e%252e/admin',
    '/dashboard/labs\\..\\admin', '/dashboard/labs?other=1', '/dashboard/labs#other',
    '//dashboard/labs', 'dashboard/labs']) {
    assert.equal(isLabPilotPath(path), false, path);
  }
});

test('private in-house test copies have one exact pilot API while customer pricing and school routes remain closed', () => {
  const { isLabPilotPath } = fixture();
  assert.equal(isLabPilotPath('/api/dashboard/in-house-price-sheets'), true);
  assert.equal(isLabPilotPath('/api/dashboard/in-house-price-sheets/'), true);
  for (const path of ['/api/dashboard/in-house-price-sheets/other', '/api/dashboard/in-house-price-sheets-other',
    '/api/dashboard/in-house-price-sheets%2fother', '/api/dashboard/in-house-price-sheets/../schools',
    '/api/dashboard/schools', '/api/dashboard/packages', '/api/dashboard/package-profiles',
    '/api/dashboard/orders', '/api/stripe/checkout', '/dashboard/schools', '/dashboard/packages']) {
    assert.equal(isLabPilotPath(path), false, path);
  }
});

test('in-house order rehearsal permits only its exact APIs, fixed sample and UUID parent gallery path', () => {
  const { isLabPilotPath } = fixture();
  const gallery = '/labs-pilot/in-house/11111111-1111-4111-8111-111111111111';
  for (const path of ['/api/dashboard/in-house-test-orders', '/api/dashboard/in-house-test-files',
    '/api/labs-pilot/in-house', '/labs-pilot/in-house/sample-photo', gallery, gallery + '/']) {
    assert.equal(isLabPilotPath(path), true, path);
  }
  for (const path of ['/api/dashboard/in-house-test-orders-other', '/api/dashboard/in-house-test-orders/other',
    '/api/dashboard/in-house-test-files/other', '/api/labs-pilot/in-house/other',
    '/labs-pilot/in-house/guess', '/labs-pilot/in-house/sample-photo/other', gallery + '/other',
    '/labs-pilot/in-house/%2e%2e/admin', gallery + '?access=secret',
    '/api/dashboard/schools', '/api/dashboard/packages', '/api/stripe/checkout']) {
    assert.equal(isLabPilotPath(path), false, path);
  }
});
