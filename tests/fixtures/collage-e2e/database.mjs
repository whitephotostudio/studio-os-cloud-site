import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ident = value => { if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw Error(`Unsupported fixture identifier ${value}`); return `"${value}"`; };
export async function createFixtureDatabase(directory) {
  const db = new PGlite(directory);
  const existing = await db.query("select to_regclass('public.photographers') ready");
  if (!existing.rows[0].ready) {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to service_role;
      create table photographers(id uuid primary key,user_id uuid,business_name text,billing_email text,studio_email text,studio_phone text,studio_address text,logo_url text,brand_color text,
        billing_currency text default 'cad',default_package_profile_id uuid,is_platform_admin boolean default false,
        subscription_status text default 'active',subscription_plan_code text default 'core',subscription_billing_interval text default 'monthly',
        stripe_account_id text,stripe_connected_account_id text,stripe_connect_onboarding_complete boolean default true,stripe_connect_charges_enabled boolean default true,stripe_connect_payouts_enabled boolean default true,
        stripe_subscription_id text,stripe_platform_customer_id text,stripe_subscription_item_base_id text,stripe_subscription_item_extra_keys_id text,stripe_subscription_item_usage_id text,
        subscription_current_period_start timestamptz,subscription_current_period_end timestamptz,trial_starts_at timestamptz,trial_ends_at timestamptz,
        order_usage_rate_cents integer default 40,extra_desktop_keys integer default 0,studio_id uuid,
        shipping_fee_cents integer default 0,late_handling_fee_percent numeric default 0,sibling_discount_tiers jsonb default '{}',
        tax_enabled boolean default false,tax_percent numeric default 0,tax_label text,tax_country text,tax_rates_by_country jsonb,
        watermark_enabled boolean default false,watermark_logo_url text,online_backdrops_enabled boolean default false,created_at timestamptz default now());
      create table subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid,is_admin boolean default false);
      create table photographer_agreements(id uuid primary key default gen_random_uuid(),user_id uuid,agreement_version text);
      create table package_profiles(id uuid primary key default gen_random_uuid(),photographer_id uuid,name text,active boolean default true,created_at timestamptz default now());
      create table packages(id uuid primary key default gen_random_uuid(),photographer_id uuid,package_profile_id uuid,local_id text,profile_id text,profile_name text,name text,description text,category text,price_cents integer,items jsonb,active boolean default true,is_retouch_addon boolean default false,sort_order integer default 0,created_at timestamptz default now(),updated_at timestamptz default now());
      create table schools(id uuid primary key,photographer_id uuid,school_name text,status text default 'published',portal_status text default 'published',local_school_id text,
        package_profile_id uuid,gallery_settings jsonb default '{}',order_due_date timestamptz,expiration_date timestamptz,created_at timestamptz default now());
      create table classes(id uuid primary key,school_id uuid,class_name text);
      create table students(id uuid primary key,school_id uuid,pin text,first_name text,last_name text,class_id uuid,class_name text,folder_name text,photo_url text);
      create table projects(id uuid primary key,photographer_id uuid,title text,client_name text,access_pin text,workflow_type text,linked_school_id uuid,linked_local_school_id text,package_profile_id uuid,
        gallery_settings jsonb default '{}',status text,portal_status text,expiration_date timestamptz,order_due_date timestamptz,created_at timestamptz default now());
      create table collections(id uuid primary key,project_id uuid,kind text,title text,slug text);
      create table media(id uuid primary key,project_id uuid,collection_id uuid,storage_path text,filename text,preview_url text,thumbnail_url text,sort_order integer,created_at timestamptz default now());
      create table school_photo_deletions(id uuid primary key default gen_random_uuid(),school_id uuid,photographer_id uuid,student_id uuid,storage_path text,family_key text,created_at timestamptz default now());
      create table orders(id uuid primary key,photographer_id uuid,parent_name text,parent_email text,parent_phone text,customer_name text,customer_email text,package_id uuid,package_name text,package_price numeric,
        special_notes text,notes text,status text default 'payment_pending',payment_status text default 'pending',seen_by_photographer boolean default false,
        subtotal_cents integer,tax_cents integer,total_cents integer,total_amount numeric,currency text default 'cad',cart_snapshot jsonb,school_id uuid,class_id uuid,student_id uuid,project_id uuid,order_group_id uuid,
        refund_status text,refund_amount_cents integer default 0,paid_at timestamptz,stripe_checkout_session_id text,stripe_payment_intent_id text,stripe_charge_id text,
        counted_for_monthly_usage boolean default false,monthly_usage_billing_period text,is_test boolean default false,created_at timestamptz default now(),updated_at timestamptz default now());
      create table order_items(id uuid primary key default gen_random_uuid(),order_id uuid references orders(id),product_name text,quantity integer check(quantity>0),price numeric,unit_price_cents integer,line_total_cents integer,sku text);
      create table order_usage_fees(id uuid primary key default gen_random_uuid(),order_id uuid,photographer_id uuid,status text);
      create table stripe_events(id text primary key,event_type text,stripe_account text,livemode boolean,payload jsonb);
    `);
    for (const migration of ['20260924160000_order_payment_safety.sql','20260924163000_touch_order_payment_state.sql','20261005004000_paid_order_email_outbox.sql','20261005005000_customer_order_webhook_recovery.sql','20261007010000_order_platform_fee_collection.sql','20261012110000_parent_gallery_sessions.sql','20261012120000_parent_checkout_returns.sql','20261014180000_private_collage_templates.sql']) {
      await db.exec(await readFile(path.join(projectRoot,'supabase/migrations',migration),'utf8'));
    }
  }
  const applied = new Set();
  async function applyMigration(filename) {
    if (applied.has(filename)) return;
    await db.exec(await readFile(path.join(projectRoot,'supabase/migrations',filename),'utf8')); applied.add(filename);
  }
  async function rest(request) {
    const url = new URL(request.url), table = url.pathname.split('/').at(-1);
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const args = await request.json();
      try {
        const signature = await db.query('select proargnames,proretset from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',['public',table]);
        if (signature.rows.length !== 1) throw Error(`Unsupported fixture RPC ${table}`);
        const row = signature.rows[0], keys = row.proargnames.filter(key => Object.hasOwn(args,key));
        const values = keys.map(key => args[key] && typeof args[key] === 'object' && !Array.isArray(args[key]) ? JSON.stringify(args[key]) : args[key]);
        // JSON arrays for jsonb arguments need JSON serialization; UUID[] remains arrays.
        const types = await db.query('select pg_get_function_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',['public',table]);
        keys.forEach((key,index) => { if (new RegExp(`${key} jsonb`).test(types.rows[0].args)) values[index] = JSON.stringify(args[key]); });
        const call = `public.${ident(table)}(${keys.map((key,index)=>`${ident(key)} => $${index+1}`).join(',')})`;
        const sql = row.proretset ? `select to_jsonb(value) result from ${call} value` : `select to_jsonb(${call}) result`;
        const result = await db.query(sql,values);
        return Response.json(row.proretset ? result.rows.map(r=>r.result) : result.rows[0]?.result ?? null);
      } catch (error) { return Response.json({ code:error.code || 'FIXTURE',message:error.message },{status:400}); }
    }
    const values = [], where = [], bind = value => { values.push(value); return `$${values.length}`; };
    for (const [column,expression] of url.searchParams) {
      if (['select','order','limit','offset','on_conflict'].includes(column)) continue;
      let match;
      if(column==='or')where.push('('+expression.replace(/^\(|\)$/g,'').split(',').map(term=>{const match=term.match(/^([a-z_]+)\.(eq|ilike)\.(.*)$/s);if(!match)throw Error('Unsupported fixture OR expression');return `${ident(match[1])} ${match[2]==='ilike'?'ilike':'='} ${bind(match[3])}`;}).join(' or ')+')');
      else if ((match=expression.match(/^(eq|neq|gt|gte|lt|lte|ilike)\.(.*)$/s))) where.push(`${ident(column)} ${{eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<=',ilike:'ilike'}[match[1]]} ${bind(match[2])}`);
      else if (expression==='is.null' || expression==='not.is.null') where.push(`${ident(column)} is ${expression.startsWith('not.')?'not ':''}null`);
      else if ((match=expression.match(/^in\.\((.*)\)$/s))) { const list=match[1].split(',').filter(Boolean).map(value=>value.replace(/^"|"$/g,'')); where.push(list.length?`${ident(column)} in (${list.map(bind).join(',')})`:'false'); }
      else if ((match=expression.match(/^cs\.\{(.*)\}$/))) where.push(`${ident(column)} @> ${bind(match[1]?match[1].split(','):[])}`);
      else throw Error(`Unsupported fixture filter ${column}=${expression}`);
    }
    const filter = where.length?' where '+where.join(' and '):'';
    try {
      let result;
      if (request.method==='POST') {
        const payload=await request.json(), rows=Array.isArray(payload)?payload:[payload]; const inserted=[];
        for (const row of rows) {
          const keys=Object.keys(row), params=keys.map(key=>row[key]&&typeof row[key]==='object'?JSON.stringify(row[key]):row[key]);
          inserted.push(...(await db.query(`insert into ${ident(table)}(${keys.map(ident).join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,params)).rows);
        }
        result={rows:inserted};
      } else if (request.method==='PATCH') {
        const changes=await request.json();
        const set=Object.entries(changes).map(([column,value])=>`${ident(column)}=${bind(value&&typeof value==='object'?JSON.stringify(value):value)}`).join(',');
        result=await db.query(`update ${ident(table)} set ${set}${filter} returning *`,values);
      } else if (request.method==='DELETE') result=await db.query(`delete from ${ident(table)}${filter} returning *`,values);
      else {
        let suffix=''; const order=url.searchParams.get('order');
        if(order)suffix+=' order by '+order.split(',').map(value=>{const[column,direction]=value.split('.');return`${ident(column)} ${direction==='desc'?'desc':'asc'}`;}).join(',');
        const selected=await db.query(`select to_jsonb(value) value from (select * from ${ident(table)}${filter}${suffix}) value`,values);
        result={rows:selected.rows.map(row=>row.value)};
      }
      let rows=JSON.parse(JSON.stringify(result.rows)); const count=rows.length;
      const offset=Number(url.searchParams.get('offset')||0), limit=Number(url.searchParams.get('limit')||10000); rows=rows.slice(offset,offset+limit);
      const fields=url.searchParams.get('select')||'';
      if(table==='orders' && fields.includes(':')) for(const row of rows) {
        for(const[alias,target,id]of[['student','students',row.student_id],['school','schools',row.school_id],['class','classes',row.class_id],['project','projects',row.project_id]]) if(fields.includes(alias+':'))row[alias]=id?(await db.query(`select * from ${ident(target)} where id=$1`,[id])).rows[0]??null:null;
        if(fields.includes('items:'))row.items=(await db.query('select * from order_items where order_id=$1 order by id',[row.id])).rows;
      }
      if(table==='orders'&&fields.includes('order_items('))for(const row of rows)row.order_items=(await db.query('select to_jsonb(value) value from order_items value where order_id=$1 order by id',[row.id])).rows.map(item=>item.value);
      if(fields && !fields.includes('*') && !fields.includes(':') && !fields.includes('(')) {
        const selected=fields.split(',').map(value=>value.trim());
        rows=rows.map(row=>Object.fromEntries(selected.map(key=>[key,row[key]])));
      }
      const single=(request.headers.get('accept')||'').includes('application/vnd.pgrst.object+json');
      if(single && rows.length!==1) return Response.json({code:'PGRST116',details:`The result contains ${rows.length} rows`,message:'JSON object requested, multiple (or no) rows returned'},{status:406});
      return Response.json(single?rows[0]:rows,{headers:{'content-range':`${offset}-${offset+rows.length-1}/${count}`}});
    } catch(error) { return Response.json({code:error.code||'FIXTURE',message:error.message,details:error.detail},{status:400}); }
  }
  return { db, rest, applyMigration };
}
