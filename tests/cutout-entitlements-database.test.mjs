import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
const names=['20260930010000_atomic_credit_accounting.sql','20260930012000_protect_photographer_billing.sql','20260930013000_cloud_credit_jobs.sql','20260930120000_paid_cutout_entitlements.sql'];
const a='a'.repeat(64), b='b'.repeat(64), c='c'.repeat(64), d='d'.repeat(64);
async function fixture(run) {
  const db=new PGlite();
  try {
    await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table photographers(id uuid primary key,user_id uuid not null unique,is_platform_admin boolean not null default false,
        created_at timestamptz default now(),trial_starts_at timestamptz,subscription_current_period_start timestamptz,subscription_current_period_end timestamptz);
      create table credit_packages(id uuid primary key);
      create table studio_credits(id uuid primary key default gen_random_uuid(),studio_id uuid not null unique,photographer_id uuid,
        balance integer not null default 0 check(balance>=0),total_purchased integer not null default 0,total_used integer not null default 0,updated_at timestamptz default now());
      create table credit_transactions(id uuid primary key default gen_random_uuid(),studio_id uuid not null,photographer_id uuid,
        type text not null check(type in ('purchase','usage','refund','monthly_included')),amount integer not null,balance_after integer not null,
        description text,package_id uuid references credit_packages(id),created_at timestamptz default now(),credits_delta integer,
        credit_transaction_type text,source text,source_reference_id text,stripe_checkout_session_id text,stripe_payment_intent_id text,
        ai_operation text,processing_method text,photo_path text);`);
    for(const name of names) await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
    const studio=randomUUID(), photographer=randomUUID(), other=randomUUID();
    await db.query('insert into photographers(id,user_id) values($1,$2)',[photographer,studio]);
    await db.exec('grant select on photographers to service_role');
    const client=(query, values=[], user=studio)=>db.transaction(async tx=>{
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('test.uid',$1,true)",[user]);
      return tx.query(query,values);
    });
    const add=(n=20)=>db.query("select * from apply_credit_adjustment($1,$2,$3,'purchase','purchase','Fixture',null,$4,null,$4)",[studio,photographer,n,'pi_'+randomUUID()]);
    const spend=(n,ref)=>client("select deduct_studio_credits($1,'bg_removal_local','photoshop_reservation',null,'Fixture',$2) as ok",[n,ref]);
    const grant=(original,output,ref)=>client('select register_studio_cutout_entitlement($1,$2,$3) as ok',[original,output,ref]);
    const entitled=(original,output,user)=>client('select get_studio_cutout_entitlement($1,$2) as ok',[original,output],user);
    await run({db,studio,photographer,other,client,add,spend,grant,entitled});
  } finally {await db.close();}
}

test('one paid local photo cannot authorize another original; revisions stay with the paid source',()=>fixture(async f=>{
  await f.add();await f.spend(1,'local');
  assert.equal((await f.grant(a,b,'local')).rows[0].ok,true);
  assert.equal((await f.grant(a,b,'local')).rows[0].ok,true);
  assert.equal((await f.grant(c,d,'local')).rows[0].ok,false);
  assert.equal((await f.entitled(a,b)).rows[0].ok,true);
  assert.equal((await f.entitled(c,b)).rows[0].ok,false);
  assert.equal((await f.entitled(null,b)).rows[0].ok,true);
  assert.equal((await f.entitled(a,b,f.other)).rows[0].ok,false);
  assert.equal((await f.grant(a,d,'local')).rows[0].ok,false);
  await assert.rejects(f.client('select register_verified_cutout_revision($1,$2,$3,$4)',[f.studio,a,b,d]));
  assert.equal((await f.db.query('select register_verified_cutout_revision($1,$2,$3,$4) as ok',[f.studio,a,b,d])).rows[0].ok,true);
  assert.equal((await f.entitled(a,d)).rows[0].ok,true);
  assert.equal((await f.entitled(c,d)).rows[0].ok,false);
  assert.equal((await f.db.query('select register_verified_cutout_revision($1,$2,$3,$4) as ok',[f.other,a,b,c])).rows[0].ok,false);
}));
test('only unused local batch slots can be refunded, with cumulative retry safety',()=>fixture(async f=>{
  await f.add();await f.spend(3,'batch');await f.grant(a,b,'batch');
  assert.equal((await f.client("select refund_studio_credits(2,'batch') as ok")).rows[0].ok,true);
  assert.equal((await f.client("select refund_studio_credits(2,'batch') as ok")).rows[0].ok,true);
  assert.equal((await f.client("select refund_studio_credits(3,'batch') as ok")).rows[0].ok,false);
  assert.equal((await f.entitled(a,b)).rows[0].ok,true);
  assert.equal((await f.grant(c,d,'batch')).rows[0].ok,false);
  assert.equal((await f.db.query('select balance from studio_credits')).rows[0].balance,19);
}));
test('a refunded or pre-security local receipt and filename metadata cannot grant cutouts',()=>fixture(async f=>{
  await f.add();await f.spend(1,'refunded');
  await f.client("select refund_studio_credits(1,'refunded')");
  assert.equal((await f.grant(a,b,'refunded')).rows[0].ok,false);
  await f.spend(1,'old');await f.db.exec("update credit_transactions set created_at=now()-interval '1 day' where source_reference_id='old'");
  assert.equal((await f.grant(a,b,'old')).rows[0].ok,false);
  assert.equal((await f.grant(a,b,'invented-file')).rows[0].ok,false);
  assert.equal((await f.entitled(null,b)).rows[0].ok,false);
}));
test('paid cutouts survive unused monthly expiry, and debt blocks use until repayment',()=>fixture(async f=>{
  await f.add();await f.spend(1,'local');await f.grant(a,b,'local');
  await f.db.exec("update credit_lots set expires_at=now()-interval '1 second'");
  await f.client('select * from get_studio_credit_balance()');
  assert.equal((await f.entitled(a,b)).rows[0].ok,true);
  await f.db.exec('update studio_credits set credit_debt=1');
  assert.equal((await f.entitled(a,b)).rows[0].ok,false);
  await f.add(2);
  assert.equal((await f.entitled(a,b)).rows[0].ok,true);
}));
test('owner exception requires a server owner receipt, not client owner flags',()=>fixture(async f=>{
  await f.db.query('update photographers set is_platform_admin=true where id=$1',[f.photographer]);
  await f.spend(0,'owner');
  assert.equal((await f.grant(a,b,'owner')).rows[0].ok,true);
  assert.equal((await f.grant(c,d,'owner')).rows[0].ok,true);
  await assert.rejects(f.client('select * from credit_cutout_claims'));
  await assert.rejects(f.client('select bind_cloud_cutout_original($1,$2,$3)',[randomUUID(),randomUUID(),a]));
  await assert.rejects(f.client('select _grant_cutout_entitlement($1,$2,$3,$4)',[f.studio,randomUUID(),a,b]));
  await assert.rejects(f.client('update photographers set is_platform_admin=true where user_id=$1',[f.studio]));
}));
test('cloud output proof requires an immutable owned original and saved output before success',()=>fixture(async f=>{
  await f.add();const job=randomUUID(),token=randomUUID();
  await f.db.query('select * from reserve_cloud_credit_job($1,$2,$3,$4,$5,$6)',[job,f.studio,f.photographer,c,`credits/${f.studio}/${job}.png`,token]);
  assert.equal((await f.db.query('select finish_cloud_credit_job($1,$2,true) as ok',[job,token])).rows[0].ok,false);
  assert.equal((await f.db.query('select bind_cloud_cutout_original($1,$2,$3) as ok',[job,token,a])).rows[0].ok,true);
  assert.equal((await f.db.query('select bind_cloud_cutout_original($1,$2,$3) as ok',[job,token,c])).rows[0].ok,false);
  assert.equal((await f.db.query('select set_cloud_cutout_output($1,$2,$3) as ok',[job,token,b])).rows[0].ok,true);
  assert.equal((await f.db.query('select set_cloud_cutout_output($1,$2,$3) as ok',[job,token,d])).rows[0].ok,false);
  assert.equal((await f.db.query('select finish_cloud_credit_job($1,$2,true) as ok',[job,token])).rows[0].ok,true);
  assert.equal((await f.entitled(a,b)).rows[0].ok,true);
  assert.equal((await f.db.query('select finish_cloud_credit_job($1,$2,false) as ok',[job,token])).rows[0].ok,false);
  assert.equal((await f.client('select register_studio_cutout_entitlement($1,$2,$3,$4) as ok',[c,b,null,job])).rows[0].ok,false);
}));
test('cloud replay binds proven legacy server output, while failed jobs never gain proof',()=>fixture(async f=>{
  await f.add();const job=randomUUID(),token=randomUUID();
  await f.db.query('select * from reserve_cloud_credit_job($1,$2,$3,$4,$5,$6)',[job,f.studio,f.photographer,c,`credits/${f.studio}/${job}.png`,token]);
  await f.db.exec("update credit_transactions set created_at=now()-interval '1 day' where source='cloud_processing'");
  await f.db.query('select bind_cloud_cutout_original($1,$2,$3)',[job,token,a]);await f.db.query('select set_cloud_cutout_output($1,$2,$3)',[job,token,b]);
  assert.equal((await f.db.query('select finish_cloud_credit_job($1,$2,true) as ok',[job,token])).rows[0].ok,true);
  assert.equal((await f.entitled(a,b)).rows[0].ok,true);
  const failed=randomUUID(),failedToken=randomUUID();
  await f.db.query('select * from reserve_cloud_credit_job($1,$2,$3,$4,$5,$6)',[failed,f.studio,f.photographer,c,`credits/${f.studio}/${failed}.png`,failedToken]);
  await f.db.query('select finish_cloud_credit_job($1,$2,false)',[failed,failedToken]);
  assert.equal((await f.db.query('select bind_cloud_cutout_original($1,$2,$3) as ok',[failed,failedToken,a])).rows[0].ok,false);
}));
test('service-only storage binding requires paid exact bytes and photographer scope',()=>fixture(async f=>{
  await f.add();await f.spend(1,'local');await f.grant(a,b,'local');const key='nobg-photos/school/student/image.png';
  assert.equal((await f.db.query('select link_credit_cutout_object($1,$2,$3,$4) as ok',[f.studio,key,a,b])).rows[0].ok,true);
  assert.equal((await f.db.query('select link_credit_cutout_object($1,$2,$3,$4) as ok',[f.studio,key,a,c])).rows[0].ok,false);
  assert.equal((await f.db.query('select * from authorized_credit_cutout_keys($1,$2)',[f.photographer,[key]])).rows.length,1);
  assert.equal((await f.db.query('select * from authorized_credit_cutout_keys($1,$2)',[f.other,[key]])).rows.length,0);
  await assert.rejects(f.client('select link_credit_cutout_object($1,$2,$3,$4)',[f.studio,key,a,b]));
}));
