import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as security from '../../supabase/functions/send-digital-delivery/security.ts';

const source = readFileSync(new URL('../../supabase/functions/send-digital-delivery/index.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ verified = true, level = 'aal1', assuranceError = null, signedIn = true, platformAdmin = false, subscriptionAdmin = false, roleError = null } = {}) {
  let handler, dataReads = 0, roleReads = 0;
  const assuranceTokens = [];
  const user = signedIn ? { id: 'fixture-user', factors: [{ status: verified ? 'verified' : 'unverified' }] } : null;
  const userClient = { auth: { getUser: async () => ({ data: { user }, error: null }), mfa: {
    getAuthenticatorAssuranceLevel: async token => { assuranceTokens.push(token); return { data: level == null ? null : { currentLevel: level }, error: assuranceError }; },
  } } };
  const admin = { from(table) {
    assert.ok(['photographers','subscriptions'].includes(table), 'No customer data is read');
    const query = { select(columns) {
      assert.equal(columns, table === 'photographers' ? 'is_platform_admin' : 'is_admin');
      return query;
    }, eq(column,value) { assert.equal(column,'user_id');assert.equal(value,'fixture-user');return query; },
    maybeSingle: async () => { roleReads++;return { data: table === 'photographers' ? {is_platform_admin:platformAdmin} : {is_admin:subscriptionAdmin},error:roleError }; } };
    return query;
  } };
  new Function('require', 'exports', 'Deno', code)(name => name === './security.ts' ? security : {
    createClient: (_url, key) => key === 'service-fixture' ? admin : userClient,
  }, {}, { env: { get: key => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'anon-fixture', SUPABASE_SERVICE_ROLE_KEY: 'service-fixture' })[key] }, serve: callback => { handler = callback; } });
  return { handler, assuranceTokens, get dataReads() { return dataReads; }, get roleReads() {return roleReads;} };
}
const request = () => new Request('https://fixture.invalid/legacy-delivery', { method: 'POST', headers: { authorization: 'Bearer synthetic-fixture-jwt', 'content-type': 'application/json' }, body: '{}' });

test('legacy delivery rejects password-only sessions for an enrolled second factor before customer reads', async () => {
  for (const options of [{}, { level: null }, { level: 'aal2', assuranceError: new Error('auth unavailable') }]) {
    const f = fixture(options), result = await f.handler(request());
    assert.equal(result.status, 403);
    assert.deepEqual(f.assuranceTokens, ['synthetic-fixture-jwt']);
    assert.equal(f.dataReads, 0);
  }
});

test('legacy delivery permits verified AAL2 and accounts without enrolled MFA to reach ordinary validation', async () => {
  for (const options of [{ level: 'aal2' }, { verified: false }]) {
    const f = fixture(options), result = await f.handler(request());
    assert.equal(result.status, 400);
    assert.match((await result.json()).error, /valid order/);
    assert.equal(f.dataReads, 0);
    assert.equal(f.assuranceTokens.length, options.verified === false ? 0 : 1);
    assert.equal(f.roleReads, options.verified === false ? 2 : 0);
  }
});

test('legacy administrative accounts must enroll MFA and trusted role lookup fails closed',async()=>{
  for(const options of [{platformAdmin:true},{subscriptionAdmin:true},{roleError:new Error('role lookup unavailable')}]) {
    const f=fixture({verified:false,...options}),result=await f.handler(request());
    assert.equal(result.status,403);
    assert.equal(f.roleReads,2);
    assert.equal(f.dataReads,0);
    assert.equal(f.assuranceTokens.length,0);
  }
});

test('legacy delivery rejects an anonymous caller before MFA or customer reads', async () => {
  const f = fixture({ signedIn: false }), result = await f.handler(request());
  assert.equal(result.status, 401);
  assert.deepEqual(f.assuranceTokens, []);
  assert.equal(f.dataReads, 0);
});
