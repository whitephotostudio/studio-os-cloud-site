import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const identifier = value => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw Error('Unsafe local SQL identifier.');
  return `"${value}"`;
};

/** A local PostgreSQL database, never a PostgREST/production connection. */
export async function openStandardSandboxDatabase(directory) {
  const db = new PGlite(directory);
  const exists = (await db.query("select to_regclass('public.photographers') present")).rows[0].present;
  if (!exists) {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table photographers(id uuid primary key,user_id uuid,business_country text,stripe_connect_country text,
        stripe_account_id text,stripe_connected_account_id text,stripe_connect_onboarding_complete boolean,
        stripe_connect_charges_enabled boolean,stripe_connect_payouts_enabled boolean,is_platform_admin boolean default false,
        subscription_plan_code text,subscription_status text);
      create table orders(id uuid primary key,photographer_id uuid,order_group_id uuid,total_cents integer,total_amount numeric,
        currency text,status text default 'pending',payment_status text default 'pending',paid_at timestamptz,
        stripe_checkout_session_id text,stripe_payment_intent_id text,platform_fee_collection_method text,
        platform_fee_amount_cents integer,platform_fee_currency text,platform_fee_rate_cents integer,stripe_application_fee_id text,
        package_name text default 'Synthetic print',notes text default '',counted_for_monthly_usage boolean default false,
        monthly_usage_billing_period text,seen_by_photographer boolean default false,refund_status text,
        refund_amount_cents integer default 0,refunded_at timestamptz,updated_at timestamptz default now());
      create table stripe_events(id text primary key,event_type text,stripe_account text,livemode boolean,payload jsonb);
      create table sandbox_migrations(name text primary key,digest text not null);
      grant select,insert,update on photographers,orders to authenticated;`);
  }
  const migrations = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
  // Only additive Stripe history/recovery migrations belong in this disposable fixture.
  const files = readdirSync(migrations).filter(file => /stripe_(account_history|payment_account_attempts|merchant_event_recovery|standard.*compatibility|standard.*production)|^(20260924160000_order_payment_safety|20261005005000_customer_order_webhook_recovery)/.test(file)).sort();
  for (const file of files) {
    const source=readFileSync(`${migrations}/${file}`,'utf8');
    const digest=createHash('sha256').update(source).digest('hex');
    const existing=(await db.query('select digest from sandbox_migrations where name=$1',[file])).rows[0];
    if(existing){if(existing.digest!==digest)throw Error(`Applied local migration changed: ${file}. Reconcile the disposable fixture before continuing.`);continue;}
    await db.exec(source);
    await db.query('insert into sandbox_migrations values($1,$2)', [file,digest]);
  }
  const service = {
    async rpc(name, input) {
      try {
        const entries = Object.entries(input);
        const args = entries.map(([key], i) => `${identifier(key)} => $${i + 1}`).join(',');
        const result = await db.query(`select ${identifier(name)}(${args}) value`, entries.map(([, value]) => value));
        return { data: result.rows[0]?.value ?? null, error: null };
      } catch (error) { return { data: null, error }; }
    },
    from(table) {
      const tableName = identifier(table), conditions = [], parameters = [], sorts = [];
      let mutation = null, limit = null;
      const where = () => conditions.length ? ` where ${conditions.join(' and ')}` : '';
      const execute = async single => {
        try {
          let result;
          if (mutation?.type === 'insert' || mutation?.type === 'upsert') {
            const rows = Array.isArray(mutation.value) ? mutation.value : [mutation.value];
            const allRows = [];
            for (const row of rows) {
              const entries = Object.entries(row);
              const columns = entries.map(([key]) => identifier(key));
              const conflict = mutation.type === 'upsert' ? ` on conflict (${mutation.conflict.split(',').map(identifier)}) do ${mutation.ignoreDuplicates?'nothing':`update set ${columns.map(c => `${c}=excluded.${c}`).join(',')}`}` : '';
              const inserted = await db.query(`insert into ${tableName} (${columns}) values (${entries.map((_, i) => `$${i+1}`)})${conflict} returning *`, entries.map(([,value])=>value));
              allRows.push(...inserted.rows);
            }
            result = {rows:allRows};
          } else if (mutation?.type === 'delete') {
            if(table!=='order_payment_locks')throw Error('Only expired/released local payment locks may be deleted.');
            result=await db.query(`delete from ${tableName}${where()} returning *`,parameters);
          } else if (mutation?.type === 'update') {
            const entries = Object.entries(mutation.value), start = parameters.length;
            result = await db.query(`update ${tableName} set ${entries.map(([key],i)=>`${identifier(key)}=$${start+i+1}`).join(',')}${where()} returning *`, [...parameters,...entries.map(([,value])=>value)]);
          } else {
            result = await db.query(`select * from ${tableName}${where()}${sorts.length?` order by ${sorts.join(',')}`:''}${limit==null?'':` limit ${limit}`}`, parameters);
          }
          return {data:single?result.rows[0]??null:result.rows,error:null,count:result.rows.length};
        } catch (error) { return {data:null,error,count:null}; }
      };
      const chain = {
        select(){return chain;},
        eq(key,value){parameters.push(value);conditions.push(`${identifier(key)}=$${parameters.length}`);return chain;},
        neq(key,value){parameters.push(value);conditions.push(`${identifier(key)} is distinct from $${parameters.length}`);return chain;},
        is(key,value){if(value!==null) return chain.eq(key,value);conditions.push(`${identifier(key)} is null`);return chain;},
        in(key,values){const refs=values.map(value=>{parameters.push(value);return `$${parameters.length}`;});conditions.push(refs.length?`${identifier(key)} in (${refs})`:'false');return chain;},
        update(value){mutation={type:'update',value};return chain;},
        delete(){mutation={type:'delete'};return chain;},
        insert(value){mutation={type:'insert',value};return chain;},
        upsert(value,{onConflict,ignoreDuplicates=false}={}){if(!onConflict)throw Error('Explicit local conflict key required');mutation={type:'upsert',value,conflict:onConflict,ignoreDuplicates};return chain;},
        limit(value){if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid local limit');limit=value;return chain;},
        order(key,{ascending=true}={}){sorts.push(`${identifier(key)} ${ascending?'asc':'desc'}`);return chain;},
        maybeSingle(){return execute(true);},single(){return execute(true);},
        then(resolve,reject){return execute(false).then(resolve,reject);},
      };
      return chain;
    },
  };
  return {db,service,migrations:files};
}
