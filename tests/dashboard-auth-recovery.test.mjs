import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError, isAuthRetryableFetchError} from '@supabase/supabase-js';

function authResolver({bearerResult, cookieResult = {data: {user: null}, error: new AuthSessionMissingError()}, assurance = {data: {currentLevel: 'aal1'}, error: null}} = {}) {
  let cookieReads = 0;
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL('../lib/dashboard-auth.ts', import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const dependencies = {
    'next/headers': {cookies: async () => {cookieReads++; return {getAll: () => [], set() {}};}},
    '@supabase/ssr': {createServerClient: () => ({auth: {getUser: async () => cookieResult, mfa: {getAuthenticatorAssuranceLevel: async () => assurance}}})},
    '@supabase/supabase-js': {isAuthRetryableFetchError, createClient: () => ({auth: {getUser: async () => bearerResult}})},
  };
  new Function('require', 'exports', 'process', compiled)(name => {assert.ok(name in dependencies, name); return dependencies[name];}, exports,
    {env: {NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-key'}});
  return {resolve: token => exports.resolveDashboardAuth({headers: new Headers(token ? {authorization: 'Bearer ' + token} : {})}), cookieReads: () => cookieReads};
}

test('temporary bearer authentication failures remain retryable instead of returning a missing session', async () => {
  for (const error of [new AuthRetryableFetchError('network failure', 0), new AuthApiError('provider unavailable', 503),
    new AuthApiError('rate limit', 429), new AuthUnknownError('network failure', Error('offline'))]) {
    const h = authResolver({bearerResult: {data: {user: null}, error}});
    await assert.rejects(() => h.resolve('fixture-token'), /temporarily unavailable|try again/i);
    assert.equal(h.cookieReads(), 0);
  }
});

test('temporary cookie authentication failure does not claim that the photographer is signed out', async () => {
  const h = authResolver({cookieResult: {data: {user: null}, error: new AuthRetryableFetchError('offline', 0)}});
  await assert.rejects(() => h.resolve(), /temporarily unavailable|try again/i);
});

test('genuinely missing and rejected sessions stay denied while a valid cookie can recover an old bearer', async () => {
  assert.equal((await authResolver().resolve()).user, null);
  const user = {id: 'cookie-user', email: 'person@example.invalid'};
  const h = authResolver({bearerResult: {data: {user: null}, error: new AuthApiError('invalid token', 401)}, cookieResult: {data: {user}, error: null}});
  assert.deepEqual(await h.resolve('old-token'), {user, mfaSatisfied: true});
});

test('MFA assurance outages preserve a retryable failure and never claim verification succeeded', async () => {
  const h = authResolver({cookieResult: {data: {user: {id: 'user', factors: [{status: 'verified'}]}}, error: null},
    assurance: {data: null, error: new AuthRetryableFetchError('offline', 0)}});
  await assert.rejects(() => h.resolve(), /temporarily unavailable|try again/i);
});
