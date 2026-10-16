import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { openStandardSandboxDatabase } from './helpers/standard-sandbox-db.mjs';

const migration = '20261016010000_stripe_standard_regional_markets.sql';
const platform = 'acct_sandbox';
const markets = { CA: 'cad', US: 'usd', AU: 'aud', GB: 'gbp' };
const currencies = Object.values(markets);
const canonical = params => '{' + Object.keys(params).sort().map(k => JSON.stringify(k) + ':' + JSON.stringify(params[k])).join(',') + '}';
const hash = params => createHash('sha256').update(canonical(params)).digest('hex');
const source = file => readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8');
const emptyRequirements = () => ({ disabled_reason: null, currently_due: [], eventually_due: [], past_due: [], pending_verification: [], errors: [] });

async function fixture(t, { install = true, enabled = true, regional = true } = {}) {
  const { db } = await openStandardSandboxDatabase();
  t.after(() => db.close());
  await db.exec("alter table photographers add column created_at timestamptz default now(), add column billing_currency text default 'cad'");
  for (const file of ['20261008200000_explicit_stripe_business_country.sql', '20261013021000_stripe_standard_creation_intents.sql', '20261015020000_stripe_standard_new_signups.sql']) await db.exec(source(file));
  if (enabled) await db.exec('update stripe_standard_signup_release_controls set enabled=true');
  const apply = () => db.exec(source(migration));
  const setRegional = value => db.query('update stripe_standard_signup_release_controls set allowed_countries=$1,allowed_currencies=$2', [value ? Object.keys(markets) : ['CA', 'US'], value ? currencies : ['cad', 'usd']]);
  if (install) { await apply(); if (regional) await setRegional(true); }
  const profile = async (country = 'CA', { old = false, currency = markets[country] } = {}) => {
    const photographer = randomUUID(), owner = randomUUID();
    await db.query("insert into photographers(id,user_id,business_country,billing_currency,created_at) values($1,$2,$3,$4,now()-$5::interval)", [photographer, owner, country, currency, old ? '1 day' : '0 seconds']);
    const params = { type: 'standard', country, email: 'invented@example.test', 'metadata[photographer_id]': photographer, 'metadata[user_id]': owner, 'capabilities[card_payments][requested]': 'true', 'capabilities[transfers][requested]': 'true' };
    const reserve = async (body = params) => (await db.query('select reserve_photographer_standard_signup($1,$2,$3,false,$4,$5,$6) value', [photographer, owner, country, platform, body, hash(body)])).rows[0].value;
    const account = (s, { ready = true, id = 'acct_' + country + photographer.replaceAll('-', '') } = {}) => ({ id, type: 'standard', country, livemode: false, metadata: { photographer_id: photographer, user_id: owner, standard_signup_id: s.id }, controller: { fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe', stripe_dashboard: { type: 'full' } }, capabilities: { card_payments: ready ? 'active' : 'pending', transfers: ready ? 'active' : 'pending' }, requirements: emptyRequirements(), future_requirements: emptyRequirements(), charges_enabled: ready, payouts_enabled: ready, details_submitted: ready });
    const activate = async (s, a = account(s)) => (await db.query('select activate_photographer_standard_signup($1,$2,$3,$4,false,now()) value', [s.id, owner, a, platform])).rows[0].value;
    const configure = async (selected = country, sales = null, explicit = false, reserveConnect = false) => (await db.query('select configure_photographer_payment_profile($1,$2,$3,$4,$5) value', [photographer, selected, sales, explicit, reserveConnect])).rows[0].value;
    const route = async (currency = markets[country]) => (await db.query('select get_photographer_checkout_routing($1,$2,null,null) value', [photographer, currency])).rows[0].value;
    const order = async ({ currency = markets[country], fee = 55, group = null } = {}) => { const id = randomUUID(); await db.query("insert into orders(id,photographer_id,order_group_id,total_cents,currency,platform_fee_collection_method,platform_fee_amount_cents,platform_fee_currency,platform_fee_rate_cents) values($1,$2,$3,3000,$4,'connect_application_fee',$5,$4,$5)", [id, photographer, group, currency, fee]); return id; };
    const paymentReserve = async (s, ids, currency = markets[country], group = null) => (await db.query('select reserve_order_payment_account($1,$2,$3,$4,1,$5,$6,$7,$8,$9) value', [photographer, ids, ids[0], account(s).id, 3000 * ids.length, currency, 'checkout-' + ids[0], 'a'.repeat(64), group])).rows[0].value;
    return { photographer, owner, params, reserve, account, activate, configure, route, order, paymentReserve };
  };
  return { db, apply, setRegional, profile };
}

test('regional schema installation preserves the current CA/US release control and needs a separate exact opt-in', async t => {
  const f = await fixture(t, { install: false });
  const before = (await f.db.query('select to_jsonb(c) value from stripe_standard_signup_release_controls c')).rows[0].value;
  await f.apply();
  assert.deepEqual((await f.db.query('select to_jsonb(c) value from stripe_standard_signup_release_controls c')).rows[0].value, before);
  for (const country of ['AU', 'GB']) { const p = await f.profile(country); await assert.rejects(p.reserve(), /unsupported_business_country/); await assert.rejects(p.configure(), /not enabled/); }
  await assert.rejects(f.db.exec("update stripe_standard_signup_release_controls set allowed_countries=array['CA','US','AU','GB']"), /regional_scope_check/);
  await assert.rejects(f.db.exec("update stripe_standard_signup_release_controls set allowed_countries=array['CA','US','AU','GB','NZ'],allowed_currencies=array['cad','usd','aud','gbp']"), /check constraint/);
  await f.setRegional(true);
  assert.deepEqual((await f.db.query('select allowed_countries from stripe_standard_signup_release_controls')).rows[0].allowed_countries, Object.keys(markets));
});

test('the new schema proves regional capability while retaining every service-only/history guard', async t => {
  const f = await fixture(t), s = (await f.db.query('select stripe_standard_signup_schema_status() value')).rows[0].value;
  assert.deepEqual(s, { version: '20261016010000', regional_markets_present: true, service_only_tables: true, signup_schema_present: true, history_required_guard_present: true, legacy_creation_barrier_present: true, service_only_rpcs: true });
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec('set role ' + role);
    await assert.rejects(f.db.exec('select stripe_standard_signup_schema_status()'), /permission denied/);
    await assert.rejects(f.db.exec('select * from stripe_standard_signup_release_controls'), /permission denied/);
    await f.db.exec('reset role');
  }
  await f.db.exec('alter table photographer_stripe_accounts drop constraint photographer_stripe_accounts_country_check');
  assert.equal((await f.db.query('select stripe_standard_signup_schema_status() value')).rows[0].value.regional_markets_present, false);
});

test('all four markets default sales locally and reserve the original country, owner, body, hashes and enabled currencies', async t => {
  const f = await fixture(t);
  for (const [country, currency] of Object.entries(markets)) {
    const p = await f.profile(country), settings = await p.configure();
    assert.equal(settings.salesCurrency, currency);
    assert.equal(settings.businessCountry, country);
    const s = await p.reserve(), retry = await p.reserve({ ...p.params, email: 'changed@example.test' });
    assert.deepEqual(s, retry);
    assert.equal(s.country, country);
    assert.deepEqual(s.allowed_currencies, currencies);
    assert.equal(s.request_hash, hash(p.params));
    assert.equal(s.provider_request_hash, hash({ ...p.params, 'metadata[standard_signup_id]': s.id }));
    assert.equal(s.idempotency_key, 'studio-os-standard-signup-' + s.id);
    await assert.rejects(f.db.query("update photographer_stripe_standard_signups set allowed_currencies=array['cad','usd'] where id=$1", [s.id]), /immutable/);
  }
});

test('AU/UK activation still requires current owned Stripe readiness and locks country against later switching', async t => {
  const f = await fixture(t);
  for (const country of ['AU', 'GB']) {
    const p = await f.profile(country), s = await p.reserve();
    await assert.rejects(p.activate(s, p.account(s, { ready: false })), /verification/);
    await assert.rejects(p.activate(s, { ...p.account(s), country: 'US' }), /Fresh owned/);
    const activated = await p.activate(s);
    assert.equal(activated.accountId, p.account(s).id);
    assert.equal((await p.route()).signupIntentId, s.id);
    await assert.rejects(p.configure('CA'), /locked/);
    await assert.rejects(f.db.query("update photographer_stripe_accounts set country='CA' where stripe_account_id=$1", [activated.accountId]), /cannot be changed/);
  }
});

test('preexisting signup identities, currency rights, frozen fees and original payment bindings survive the additive migration', async t => {
  const f = await fixture(t, { install: false }), p = await f.profile('CA'), s = await p.reserve();
  await p.activate(s);
  const id = await p.order({ currency: 'usd', fee: 45 }), binding = await p.paymentReserve(s, [id], 'usd');
  await f.db.query("select bind_order_payment_references($1,'cs_test_saved','pi_test_saved',null,null)", [binding.attemptId]);
  await f.db.query("update orders set stripe_checkout_session_id='cs_test_saved',stripe_payment_intent_id='pi_test_saved' where id=$1", [id]);
  const before = (await f.db.query('select to_jsonb(s) value from photographer_stripe_standard_signups s where id=$1', [s.id])).rows[0].value;
  const paymentBefore = (await f.db.query('select to_jsonb(b) value from order_payment_accounts b where id=$1', [binding.attemptId])).rows[0].value;
  await f.apply(); await f.setRegional(true);
  assert.deepEqual((await f.db.query('select to_jsonb(s) value from photographer_stripe_standard_signups s where id=$1', [s.id])).rows[0].value, before);
  assert.deepEqual((await f.db.query('select to_jsonb(b) value from order_payment_accounts b where id=$1', [binding.attemptId])).rows[0].value, paymentBefore);
  await assert.rejects(p.configure('CA', 'aud', true), /saved Standard connection/);
  await assert.rejects(p.route('aud'), /sales currency/);
  assert.equal((await p.route('usd')).accountId, p.account(s).id);
  assert.equal((await f.db.query("select resolve_order_payment_account($1,$2,null,'cs_test_saved','pi_test_saved',$3,false) value", [p.photographer, id, p.account(s).id])).rows[0].value, p.account(s).id);
});

test('regional grouped paid orders retain 55/45 minor-unit fee snapshots without conversion', async t => {
  const f = await fixture(t);
  for (const country of ['AU', 'GB']) {
    const p = await f.profile(country), s = await p.reserve(); await p.activate(s);
    for (const fee of [55, 45]) {
      const group = randomUUID(), ids = [await p.order({ fee, group }), await p.order({ fee, group })], b = await p.paymentReserve(s, ids, markets[country], group);
      const stored = (await f.db.query('select currency,fee_snapshot,amount_cents from order_payment_accounts where id=$1', [b.attemptId])).rows[0];
      assert.equal(stored.currency, markets[country]); assert.equal(stored.amount_cents, 6000);
      assert.equal(stored.fee_snapshot.length, 2);
      assert.equal(stored.fee_snapshot.reduce((sum, row) => sum + row.platform_fee_amount_cents, 0), fee * 2);
      assert.ok(stored.fee_snapshot.every(row => row.platform_fee_rate_cents === fee && row.platform_fee_currency === markets[country]));
    }
  }
});

test('narrowing enrollment or disabling creation preserves established AU/UK routing and servicing', async t => {
  const f = await fixture(t);
  const existing = [];
  for (const country of ['AU', 'GB']) { const p = await f.profile(country), s = await p.reserve(); await p.activate(s); existing.push({ p, s }); }
  await f.setRegional(false); await f.db.exec('update stripe_standard_signup_release_controls set enabled=false');
  for (const { p, s } of existing) {
    assert.equal((await p.route()).accountId, p.account(s).id);
    assert.equal((await p.reserve()).id, s.id);
    assert.equal((await p.configure()).salesCurrency, markets[p.params.country]);
    const fresh = await f.profile(p.params.country); await assert.rejects(fresh.reserve(), /unsupported_business_country/);
  }
});

test('AU/UK cannot fall back to legacy Express creation even while new Standard creation is disabled', async t => {
  const f = await fixture(t, { enabled: false });
  for (const country of ['AU', 'GB']) { const p = await f.profile(country); await assert.rejects(p.configure(country, null, false, true), /Express account cannot be created/); }
  const legacy = await f.profile('CA', { old: true });
  await f.db.query("update photographers set stripe_account_id='acct_express',stripe_connected_account_id='acct_express',stripe_connect_country='CA' where id=$1", [legacy.photographer]);
  assert.equal((await legacy.configure('CA', 'eur', true, true)).salesCurrency, 'eur');
});

test('AU/UK country expansion does not authorize migration of an old unlinked profile or weaken deauthorization', async t => {
  const f = await fixture(t), old = await f.profile('AU', { old: true });
  await assert.rejects(old.reserve(), /preexisting_profile/);
  const p = await f.profile('GB'), s = await p.reserve(); await p.activate(s);
  const id = await p.order(), b = await p.paymentReserve(s, [id]);
  await f.db.query("select bind_order_payment_references($1,'cs_test_gb','pi_test_gb',null,null)", [b.attemptId]);
  await f.db.query("update orders set stripe_checkout_session_id='cs_test_gb',stripe_payment_intent_id='pi_test_gb' where id=$1", [id]);
  await f.db.query('select deauthorize_photographer_stripe_account($1,false)', [p.account(s).id]);
  await assert.rejects(p.route(), /routing|connection/);
  await assert.rejects(p.reserve(), /blocked/);
  assert.equal((await f.db.query("select resolve_order_payment_account($1,$2,null,'cs_test_gb','pi_test_gb',$3,false) value", [p.photographer, id, p.account(s).id])).rows[0].value, p.account(s).id);
});


test('narrowing a country prevents unknown-result provider-create retries while retaining its original intent', async t => {
  const f = await fixture(t), p = await f.profile('AU'), s = await p.reserve();
  await f.setRegional(false);
  await assert.rejects(p.reserve(), /unsupported_business_country/);
  assert.deepEqual((await f.db.query('select to_jsonb(s) value from photographer_stripe_standard_signups s where id=$1', [s.id])).rows[0].value, s);
  await f.setRegional(true);
  assert.deepEqual(await p.reserve(), s);
});
