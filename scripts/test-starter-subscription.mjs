#!/usr/bin/env node
/**
 * test-starter-subscription.mjs
 *
 * Safely registers harout@whitephoto.ca as a Tier 1 (Starter) subscriber
 * in both the `subscriptions` and `photographers` tables.
 *
 * What it does:
 *   1. Looks up the auth user by email
 *   2. Looks up (or creates) the photographer row
 *   3. Upserts the subscriptions row with status='active', plan='starter'
 *   4. Sets subscription_plan_code='starter' on the photographers row
 *
 * Safe: no Stripe calls, no deletions, only upserts. Fully reversible.
 *
 * Usage:  cd studio-os-cloud-site && node scripts/test-starter-subscription.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

// ── Load .env.local ──────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '..', '.env.local');
const envText = readFileSync(envPath, 'utf-8');
const env = Object.fromEntries(
  envText.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SERVICE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TEST_EMAIL = 'harout@whitephoto.ca';

// ── Billing period: now → 30 days from now ───────────────────────────────────
const now = new Date();
const periodEnd = new Date(now);
periodEnd.setDate(periodEnd.getDate() + 30);

async function main() {
  console.log(`\n🔍 Looking up auth user: ${TEST_EMAIL} …`);

  // 1) Find auth user by email (service role can list users)
  const { data: userList, error: userErr } = await supabase.auth.admin.listUsers();
  if (userErr) { console.error('❌ listUsers error:', userErr.message); process.exit(1); }

  const authUser = userList.users.find(u => u.email === TEST_EMAIL);
  if (!authUser) {
    console.error(`❌ No auth user found with email ${TEST_EMAIL}.`);
    console.error('   Make sure you have signed up / logged in with this email first.');
    process.exit(1);
  }
  console.log(`   ✅ Found auth user: ${authUser.id}`);

  // 2) Find photographer row
  console.log(`\n🔍 Looking up photographer for user ${authUser.id} …`);
  const { data: photographer, error: photoErr } = await supabase
    .from('photographers')
    .select('id, business_name, studio_email, subscription_plan_code')
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (photoErr) { console.error('❌ photographers lookup error:', photoErr.message); process.exit(1); }
  if (!photographer) {
    console.error('❌ No photographer row found for this user_id.');
    console.error('   The user needs to complete onboarding first.');
    process.exit(1);
  }
  console.log(`   ✅ Photographer: "${photographer.business_name}" (${photographer.id})`);
  console.log(`   Current plan: ${photographer.subscription_plan_code ?? '(none)'}`);

  // 3) Upsert the subscriptions row
  console.log(`\n📝 Upserting subscriptions row …`);
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .upsert({
      user_id: authUser.id,
      status: 'active',
      plan: 'starter',
      is_admin: false,
      photographer_id: photographer.id,
      billing_email: TEST_EMAIL,
      billing_currency: 'cad',
      billing_interval: 'month',
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      extra_desktop_keys: 0,
      updated_at: now.toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single();

  if (subErr) { console.error('❌ subscriptions upsert error:', subErr.message); process.exit(1); }
  console.log('   ✅ Subscription row:', JSON.stringify(sub, null, 2));

  // 4) Update the photographers row with starter plan fields
  console.log(`\n📝 Updating photographer billing columns …`);
  const { error: updErr } = await supabase
    .from('photographers')
    .update({
      subscription_plan_code: 'starter',
      subscription_billing_interval: 'month',
      subscription_current_period_start: now.toISOString(),
      subscription_current_period_end: periodEnd.toISOString(),
      billing_email: TEST_EMAIL,
      billing_currency: 'cad',
      order_usage_rate_cents: 55,   // Starter = $0.55 per order
      extra_desktop_keys: 0,        // Starter = no app access / no keys
    })
    .eq('id', photographer.id);

  if (updErr) { console.error('❌ photographer update error:', updErr.message); process.exit(1); }
  console.log('   ✅ Photographer updated to Starter plan');

  // 5) Summary
  console.log('\n' + '═'.repeat(60));
  console.log('✅  TEST STARTER SUBSCRIPTION ACTIVATED');
  console.log('═'.repeat(60));
  console.log(`  Email:    ${TEST_EMAIL}`);
  console.log(`  Plan:     Starter ($49/month)`);
  console.log(`  Status:   active`);
  console.log(`  Period:   ${now.toLocaleDateString()} → ${periodEnd.toLocaleDateString()}`);
  console.log(`  Usage:    $0.55 per paid order`);
  console.log(`  Desktop:  No app access (web gallery only)`);
  console.log(`  Credits:  35 included (monthly)`);
  console.log('═'.repeat(60));
  console.log('\n💡 To revert later, run:');
  console.log(`   node scripts/revert-test-subscription.mjs\n`);
}

main().catch(e => { console.error('Unhandled error:', e); process.exit(1); });
