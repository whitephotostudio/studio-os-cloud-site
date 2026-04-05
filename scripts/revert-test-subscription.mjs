#!/usr/bin/env node
/**
 * revert-test-subscription.mjs
 *
 * Reverts the test Starter subscription for harout@whitephoto.ca
 * back to no active subscription — undoes test-starter-subscription.mjs.
 *
 * Usage:  cd studio-os-cloud-site && node scripts/revert-test-subscription.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '..', '.env.local');
const envText = readFileSync(envPath, 'utf-8');
const env = Object.fromEntries(
  envText.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TEST_EMAIL = 'harout@whitephoto.ca';

async function main() {
  console.log(`\n🔍 Looking up auth user: ${TEST_EMAIL} …`);
  const { data: userList } = await supabase.auth.admin.listUsers();
  const authUser = userList.users.find(u => u.email === TEST_EMAIL);
  if (!authUser) { console.log('No auth user found — nothing to revert.'); return; }

  // Revert subscription row to inactive
  console.log('📝 Setting subscription status to inactive …');
  const { error: subErr } = await supabase
    .from('subscriptions')
    .update({ status: 'inactive', plan: null, updated_at: new Date().toISOString() })
    .eq('user_id', authUser.id);
  if (subErr) console.error('   ⚠️  subscriptions update:', subErr.message);
  else console.log('   ✅ Subscription set to inactive');

  // Clear photographer plan code
  const { data: photographer } = await supabase
    .from('photographers')
    .select('id')
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (photographer) {
    console.log('📝 Clearing photographer subscription fields …');
    const { error: updErr } = await supabase
      .from('photographers')
      .update({
        subscription_plan_code: null,
        subscription_current_period_start: null,
        subscription_current_period_end: null,
        order_usage_rate_cents: 25,
        extra_desktop_keys: 0,
      })
      .eq('id', photographer.id);
    if (updErr) console.error('   ⚠️  photographer update:', updErr.message);
    else console.log('   ✅ Photographer billing fields cleared');
  }

  console.log('\n✅ Test subscription reverted successfully.\n');
}

main().catch(e => { console.error('Unhandled error:', e); process.exit(1); });
