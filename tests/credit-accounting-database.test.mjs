import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260930010000_atomic_credit_accounting.sql", import.meta.url), "utf8");
const gatewayMigration = readFileSync(new URL("../supabase/migrations/20260930013000_cloud_credit_jobs.sql", import.meta.url), "utf8");
async function fixture(run) {
  const db = new PGlite();
  try {
    await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role;
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
    await db.exec(migration);
    await db.exec(gatewayMigration);
    const studio = crypto.randomUUID(), photographer = crypto.randomUUID();
    await db.query("insert into photographers(id,user_id) values($1,$2)", [photographer,studio]);
    const adjust = (delta, source, reference, extra = {}) => db.query(
      "select * from apply_credit_adjustment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [studio,photographer,delta,source,source,"Test adjustment",extra.packageId??null,reference,null,extra.intent??reference]);
    const refund = (intent, cents) => db.query("select * from reverse_credit_purchase($1,1000,$2,'Test refund')", [intent,cents]);
    await run({db,studio,photographer,adjust,refund});
  } finally { await db.close(); }
}

test("credit purchases are atomic, replayable and serialize different purchases", () => fixture(async ({db,adjust}) => {
  const duplicate = await Promise.all(Array.from({length:12}, () => adjust(250,"purchase","pi_same")));
  assert.equal(duplicate.filter(r=>r.rows[0].applied).length,1);
  await Promise.all([adjust(1000,"purchase","pi_second"),adjust(250,"purchase","pi_third")]);
  assert.deepEqual((await db.query("select balance,total_purchased from studio_credits")).rows[0],{balance:1500,total_purchased:1500});
  assert.equal((await db.query("select count(*)::integer as n from credit_transactions")).rows[0].n,3);
  await assert.rejects(()=>adjust(250,"purchase","pi_bad",{packageId:crypto.randomUUID()}));
  assert.equal((await db.query("select balance from studio_credits")).rows[0].balance,1500);
  assert.equal((await db.query("select count(*)::integer as n from credit_lots")).rows[0].n,3);
}));

test("credit refunds are proportional, cumulative and do not forgive refunded spent credits", () => fixture(async ({db,adjust,refund}) => {
  await adjust(250,"purchase","pi_refund");
  await adjust(-200,"usage","use");
  assert.equal((await refund("pi_refund",200)).rows[0].credits_delta,-50);
  assert.deepEqual((await db.query("select balance,credit_debt from studio_credits")).rows[0],{balance:0,credit_debt:0});
  assert.equal((await refund("pi_refund",200)).rows[0].applied,false);
  assert.equal((await refund("pi_refund",100)).rows[0].applied,false);
  assert.equal((await refund("pi_refund",1000)).rows[0].credits_delta,-200);
  assert.deepEqual((await db.query("select balance,credit_debt from studio_credits")).rows[0],{balance:0,credit_debt:200});
  await adjust(250,"purchase","pi_repayment");
  assert.deepEqual((await db.query("select balance,credit_debt from studio_credits")).rows[0],{balance:50,credit_debt:0});
  await assert.rejects(()=>adjust(-51,"usage","too_many"));
  await assert.rejects(()=>refund("pi_missing",100));
}));

test("legacy credit balances survive rollout and expire once at their next monthly date", () => fixture(async ({db,studio,photographer}) => {
  await db.query("insert into studio_credits(studio_id,photographer_id,balance,total_purchased,total_used) values($1,$2,75,100,25)", [studio,photographer]);
  await db.exec(migration);
  assert.equal((await db.query("select credit_lots_initialized from studio_credits")).rows[0].credit_lots_initialized,true);
  await db.exec("set role service_role");
  const before = (await db.query("select * from get_studio_credit_balance($1)", [studio])).rows[0];
  assert.equal(before.balance,75);
  assert.ok(before.expires_at>Date.now());
  await db.exec("reset role");
  await db.exec("update credit_lots set expires_at=now()-interval '1 second'");
  await db.exec("set role service_role");
  assert.equal((await db.query("select * from get_studio_credit_balance($1)",[studio])).rows[0].balance,0);
  assert.equal((await db.query("select * from get_studio_credit_balance($1)",[studio])).rows[0].balance,0);
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::integer as n from credit_transactions where source='expiry'")).rows[0].n,1);
}));

test("refunds of expired unused credits do not create debt; refunds of consumed portions do", () => fixture(async ({db,adjust,refund,studio}) => {
  await adjust(250,"purchase","pi_expired");
  await adjust(-50,"usage","used");
  await db.exec("update credit_lots set expires_at=now()-interval '1 second'");
  await db.exec("set role service_role");
  await db.query("select * from get_studio_credit_balance($1)",[studio]);
  await db.exec("reset role");
  await refund("pi_expired",800);
  assert.equal((await db.query("select credit_debt from studio_credits")).rows[0].credit_debt,0);
  await refund("pi_expired",1000);
  assert.equal((await db.query("select credit_debt from studio_credits")).rows[0].credit_debt,50);
}));

test("monthly deadlines preserve month-end anniversaries for annual subscribers", () => fixture(async ({db,photographer}) => {
  await db.query("update photographers set subscription_current_period_start=date_trunc('year',now())+interval '30 days 12 hours',subscription_current_period_end=date_trunc('year',now())+interval '1 year 30 days 12 hours' where id=$1",[photographer]);
  const date = (await db.query("select _next_credit_billing_date($1) as deadline",[photographer])).rows[0].deadline;
  assert.ok(date.getTime()>Date.now());
  assert.ok(date.getTime()<Date.now()+32*24*60*60*1000);
  assert.equal(date.getUTCHours(),12);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  assert.equal(date.getUTCDate(),lastDay);
}));

test("public clients cannot grant credits, reverse purchases or read other credit accounts", () => fixture(async ({db,adjust,studio}) => {
  await adjust(250,"purchase","pi_privilege");
  await db.exec("set role authenticated");
  await assert.rejects(()=>adjust(250,"purchase","pi_attack"));
  await assert.rejects(()=>db.query("select * from reverse_credit_purchase('pi_privilege',1000,1000,'Attack')"));
  await assert.rejects(()=>db.query("select * from credit_lots"));
  await db.query("select set_config('test.uid',$1,false)",[crypto.randomUUID()]);
  await assert.rejects(()=>db.query("select * from get_studio_credit_balance($1)",[studio]));
}));

test("authenticated processing debits and failed-operation refunds are atomic and replay safe", () => fixture(async ({db,adjust,studio}) => {
  await adjust(250,"purchase","pi_processing");
  await db.query("select set_config('test.uid',$1,false)",[studio]);
  await db.exec("set role authenticated");
  const deduct=(amount,ref,method='cloud_rmbg_batch')=>db.query("select deduct_studio_credits($1,'bg_removal_cloud',$2,null,'Process',$3) as ok",[amount,method,ref]);
  const processingRefund=(amount,ref)=>db.query("select refund_studio_credits($1,$2,'Failed',null,null) as ok",[amount,ref]);
  const debits=await Promise.all(Array.from({length:8},()=>deduct(40,"job")));
  assert.ok(debits.every(r=>r.rows[0].ok));
  assert.equal((await db.query("select * from get_studio_credit_balance()")).rows[0].balance,210);
  await assert.rejects(()=>deduct(44,"job"));
  await assert.rejects(()=>deduct(1,"wrong-rate"));
  assert.equal((await deduct(240,"insufficient")).rows[0].ok,false);
  assert.equal((await processingRefund(8,"job")).rows[0].ok,true);
  assert.equal((await processingRefund(8,"job")).rows[0].ok,true);
  assert.equal((await db.query("select * from get_studio_credit_balance()")).rows[0].balance,218);
  assert.equal((await processingRefund(44,"job")).rows[0].ok,false);
  assert.equal((await processingRefund(4,"forged")).rows[0].ok,false);
  await assert.rejects(()=>db.query("update studio_credits set balance=100000"));
  await assert.rejects(()=>db.query("insert into credit_transactions(studio_id,type,amount,balance_after,processing_method,photo_path) values($1,'usage',0,218,'photoshop_reservation','fake')",[studio]));
  await db.exec("reset role");
  assert.deepEqual((await db.query("select balance,total_used from studio_credits")).rows[0],{balance:218,total_used:32});
  assert.equal((await db.query("select sum(remaining_credits)::integer as balance from credit_lots")).rows[0].balance,218);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select deduct_studio_credits(218,'bg_removal_local','photoshop_reservation',null,'Spend all','spend-all') as ok")).rows[0].ok,true);
  assert.equal((await db.query("select * from get_studio_credit_balance()")).rows[0].balance,0);
  await db.exec("reset role");
  assert.equal((await db.query("select sum(remaining_credits)::integer as balance from credit_lots")).rows[0].balance,0);
}));

test("Photoshop reservations cannot receive another refund after finalization", () => fixture(async ({db,adjust,studio}) => {
  await adjust(250,"purchase","pi_photoshop");
  await db.query("select set_config('test.uid',$1,false)",[studio]);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select deduct_studio_credits(10,'bg_removal_local','photoshop_reservation',null,'Local','local-job') as ok")).rows[0].ok,true);
  assert.equal((await db.query("select refund_studio_credits(2,'local-job','Failed','bg_removal_local','photoshop_refund') as ok")).rows[0].ok,true);
  assert.equal((await db.query("select finalize_background_credit_job('local-job','Done') as ok")).rows[0].ok,true);
  assert.equal((await db.query("select finalize_background_credit_job('local-job','Done') as ok")).rows[0].ok,true);
  assert.equal((await db.query("select refund_studio_credits(3,'local-job','Again',null,null) as ok")).rows[0].ok,false);
  assert.equal((await db.query("select * from get_studio_credit_balance()")).rows[0].balance,242);
}));

test("processing refunds after deadline never extend purchased credits into another month", () => fixture(async ({db,adjust,studio}) => {
  await adjust(250,"purchase","pi_processing_expiry");
  await db.query("select set_config('test.uid',$1,false)",[studio]);
  await db.exec("set role authenticated");
  await db.query("select deduct_studio_credits(40,'bg_removal_cloud','cloud_rmbg_batch',null,'Cloud','expiring-job')");
  await db.exec("reset role; update credit_lots set expires_at=now()-interval '1 second'; set role authenticated");
  assert.equal((await db.query("select refund_studio_credits(40,'expiring-job','Failed',null,null) as ok")).rows[0].ok,true);
  assert.equal((await db.query("select * from get_studio_credit_balance()")).rows[0].balance,0);
}));

test("platform cloud jobs charge once and clients cannot refund a successful server operation", () => fixture(async ({db,adjust,studio,photographer}) => {
  await adjust(250,"purchase","pi_gateway");
  const id=crypto.randomUUID(),token=crypto.randomUUID(),hash="a".repeat(64),key=`credits/${studio}/${id}.png`;
  const reserve=(input=hash)=>db.query("select * from reserve_cloud_credit_job($1,$2,$3,$4,$5,$6)",[id,studio,photographer,input,key,token]);
  assert.equal((await reserve()).rows[0].claimed,true);
  assert.equal((await reserve()).rows[0].claimed,false);
  await assert.rejects(()=>reserve("b".repeat(64)));
  assert.deepEqual((await db.query("select balance,total_used from studio_credits")).rows[0],{balance:246,total_used:4});
  assert.equal((await db.query("select finish_cloud_credit_job($1,$2,true,null) as ok",[id,token])).rows[0].ok,true);
  assert.equal((await reserve()).rows[0].state,"succeeded");
  assert.equal((await db.query("select finish_cloud_credit_job($1,$2,false,'Lie') as ok",[id,token])).rows[0].ok,false);
  await db.query("select set_config('test.uid',$1,false)",[studio]);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select refund_studio_credits(4,$1,'Lie',null,null) as ok",[`cloud:${id}`])).rows[0].ok,false);
  await assert.rejects(()=>reserve());
  await assert.rejects(()=>db.query("select finish_cloud_credit_job($1,$2,false,'Lie')",[id,token]));
  await assert.rejects(()=>db.query("select * from credit_cloud_jobs"));
  await db.exec("reset role");
  assert.equal((await db.query("select sum(remaining_credits)::integer as balance from credit_lots")).rows[0].balance,246);
}));

test("expired cloud leases never redispatch a provider call and failure refunds exactly once", () => fixture(async ({db,adjust,studio,photographer}) => {
  await adjust(250,"purchase","pi_cloud_failure");
  const id=crypto.randomUUID(),token=crypto.randomUUID();
  const reserve=()=>db.query("select * from reserve_cloud_credit_job($1,$2,$3,$4,$5,$6)",[id,studio,photographer,"f".repeat(64),`credits/${studio}/${id}.png`,token]);
  await reserve();
  await db.exec("update credit_cloud_jobs set lease_expires_at=now()-interval '1 second'");
  const expired=(await reserve()).rows[0];
  assert.equal(expired.claimed,false);assert.equal(expired.lease_expired,true);
  assert.equal((await db.query("select finish_cloud_credit_job($1,$2,false,'Provider interrupted') as ok",[id,token])).rows[0].ok,true);
  assert.equal((await db.query("select finish_cloud_credit_job($1,$2,false,'Retry') as ok",[id,token])).rows[0].ok,true);
  assert.equal((await reserve()).rows[0].state,"failed");
  assert.deepEqual((await db.query("select balance,total_used from studio_credits")).rows[0],{balance:250,total_used:0});
  assert.equal((await db.query("select count(*)::integer as n from credit_transactions where source='cloud_processing_refund'")).rows[0].n,1);
}));

test("insufficient cloud credits leave no charged job, debit or allocation", () => fixture(async ({db,adjust,studio,photographer}) => {
  await adjust(250,"purchase","pi_low");await adjust(-248,"usage","mostly-used");
  await assert.rejects(()=>db.query("select * from reserve_cloud_credit_job($1,$2,$3,$4,$5,$6)",[crypto.randomUUID(),studio,photographer,"c".repeat(64),"credits/output.png",crypto.randomUUID()]));
  assert.equal((await db.query("select count(*)::integer as n from credit_cloud_jobs")).rows[0].n,0);
  assert.equal((await db.query("select balance from studio_credits")).rows[0].balance,2);
}));

test("a failed reserved operation cancels outstanding debt from its already cash-refunded purchase", () => fixture(async ({db,adjust,refund,studio,photographer}) => {
  await adjust(250,"purchase","pi_cash_before_failure");
  const id=crypto.randomUUID(),token=crypto.randomUUID();
  await db.query("select * from reserve_cloud_credit_job($1,$2,$3,$4,$5,$6)",[id,studio,photographer,"d".repeat(64),"credits/failure.png",token]);
  await refund("pi_cash_before_failure",1000);
  assert.equal((await db.query("select credit_debt from studio_credits")).rows[0].credit_debt,4);
  await db.query("select finish_cloud_credit_job($1,$2,false,'Failure')",[id,token]);
  assert.deepEqual((await db.query("select balance,credit_debt from studio_credits")).rows[0],{balance:0,credit_debt:0});
}));

test("a later failed reservation restores credits used to repay its refunded purchase debt", () => fixture(async ({db,adjust,refund,studio,photographer}) => {
  await adjust(250,"purchase","pi_original_debt");
  const id=crypto.randomUUID(),token=crypto.randomUUID();
  await db.query("select * from reserve_cloud_credit_job($1,$2,$3,$4,$5,$6)",[id,studio,photographer,"e".repeat(64),"credits/debt-repaid.png",token]);
  await refund("pi_original_debt",1000);
  await adjust(250,"purchase","pi_debt_repaid");
  assert.deepEqual((await db.query("select balance,credit_debt from studio_credits")).rows[0],{balance:246,credit_debt:0});
  await db.query("select finish_cloud_credit_job($1,$2,false,'Failure')",[id,token]);
  assert.deepEqual((await db.query("select balance,credit_debt from studio_credits")).rows[0],{balance:250,credit_debt:0});
  assert.equal((await db.query("select sum(remaining_credits)::integer as balance from credit_lots")).rows[0].balance,250);
}));

test("failure cancels a cash-refunded repayment's debt without minting replacement credits", () => fixture(async ({db,adjust,refund,studio,photographer}) => {
  await adjust(250,"purchase","pi_debt_chain_original");
  const id=crypto.randomUUID(),token=crypto.randomUUID();
  await db.query("select * from reserve_cloud_credit_job($1,$2,$3,$4,$5,$6)",[id,studio,photographer,"7".repeat(64),"credits/debt-chain.png",token]);
  await refund("pi_debt_chain_original",1000);
  await adjust(250,"purchase","pi_debt_chain_new");
  await refund("pi_debt_chain_new",1000);
  assert.deepEqual((await db.query("select balance,credit_debt from studio_credits")).rows[0],{balance:0,credit_debt:4});
  await db.query("select finish_cloud_credit_job($1,$2,false,'Failure')",[id,token]);
  assert.deepEqual((await db.query("select balance,credit_debt from studio_credits")).rows[0],{balance:0,credit_debt:0});
}));

test("scheduled monthly expiry is bounded, service-only and never repeats an expired debit", () => fixture(async ({db,adjust}) => {
  await adjust(250,"purchase","pi_scheduled_expiry");
  await db.exec("update credit_lots set expires_at=now()-interval '1 second'; set role authenticated");
  await assert.rejects(()=>db.query("select expire_due_credit_accounts(100)"));
  await db.exec("reset role; set role service_role");
  assert.equal((await db.query("select expire_due_credit_accounts(1) as n")).rows[0].n,1);
  assert.equal((await db.query("select expire_due_credit_accounts(1) as n")).rows[0].n,0);
  await db.exec("reset role");
  assert.equal((await db.query("select balance from studio_credits")).rows[0].balance,0);
}));

test("owner local zero-cost receipts work while cloud keeps its four-credit cost", () => fixture(async ({db,adjust,studio,photographer}) => {
  await db.query("update photographers set is_platform_admin=true where id=$1",[photographer]);
  await adjust(250,"purchase","pi_owner");
  await db.query("select set_config('test.uid',$1,false)",[studio]);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select deduct_studio_credits(0,'bg_removal_local','photoshop_reservation',null,'Owner','owner-local') as ok")).rows[0].ok,true);
  assert.equal((await db.query("select deduct_studio_credits(4,'bg_removal_cloud','cloud_rmbg_batch',null,'Cloud','owner-cloud') as ok")).rows[0].ok,true);
  const balance=(await db.query("select * from get_studio_credit_balance()")).rows[0];
  assert.equal(balance.balance,246);assert.equal(balance.expires_at,null);
}));
