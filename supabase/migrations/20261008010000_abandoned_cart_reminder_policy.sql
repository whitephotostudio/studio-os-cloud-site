-- Reminder controls are separate from order/payment/fulfillment state.
alter table public.orders add column if not exists cart_reminder_sent_at timestamptz;
alter table public.orders add column if not exists parent_dismissed_at timestamptz;

create table public.cart_reminder_scopes (
  scope_key text primary key,
  photographer_id uuid not null,
  project_id uuid,
  school_id uuid,
  student_id uuid,
  recipient_email text not null,
  stop_through timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((project_id is not null and school_id is null) or
         (project_id is null and school_id is not null and student_id is not null))
);
create table public.cart_reminder_claims (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null references public.cart_reminder_scopes(scope_key),
  episode_key text not null,
  order_id uuid not null,
  stage integer not null check (stage in (1,2)),
  dedupe_key text not null unique,
  recipient_email text not null,
  status text not null check (status in ('claimed','sent','skipped','uncertain')),
  lease_token uuid,
  lease_until timestamptz,
  claimed_at timestamptz not null default now(),
  provider_attempted_at timestamptz,
  sent_at timestamptz,
  resend_email_id text,
  last_error text,
  unique(scope_key,episode_key,stage)
);
create index cart_reminder_recipient_idx on public.cart_reminder_scopes(photographer_id,recipient_email);
create index cart_reminder_claim_scope_idx on public.cart_reminder_claims(scope_key,claimed_at desc);
create index orders_cart_reminder_scope_idx on public.orders(photographer_id,school_id,student_id,project_id,created_at desc);
alter table public.cart_reminder_scopes enable row level security;
alter table public.cart_reminder_claims enable row level security;
revoke all on public.cart_reminder_scopes,public.cart_reminder_claims from public,anon,authenticated;
grant all on public.cart_reminder_scopes,public.cart_reminder_claims to service_role;

create function public.cart_reminder_recipient(o public.orders) returns text
language sql immutable set search_path=public as $$
  select case when lower(coalesce(nullif(btrim(o.customer_email),''),nullif(btrim(o.parent_email),'')))
    ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then lower(coalesce(nullif(btrim(o.customer_email),''),nullif(btrim(o.parent_email),''))) else null end;
$$;
create function public.cart_reminder_scope_key(o public.orders) returns text
language sql immutable set search_path=public as $$
  select case when o.photographer_id is null or public.cart_reminder_recipient(o) is null or
    (o.project_id is null) = (o.school_id is null) or (o.school_id is not null and o.student_id is null)
    then null else md5(jsonb_build_array(o.photographer_id,
      case when o.project_id is not null then 'project' else 'school' end,
      coalesce(o.project_id,o.school_id),case when o.school_id is not null then o.student_id else null end,
      public.cart_reminder_recipient(o))::text) end;
$$;
create function public.cart_reminder_is_unpaid(o public.orders) returns boolean
language sql immutable set search_path=public as $$
  select lower(coalesce(btrim(o.status),''))='payment_pending' and
    lower(coalesce(btrim(o.payment_status),'')) in ('','pending','unpaid','failed') and
    o.paid_at is null and coalesce(btrim(o.stripe_payment_intent_id),'')='' and
    lower(coalesce(to_jsonb(o)->>'refund_status','')) in ('','none') and
    coalesce((to_jsonb(o)->>'refund_amount_cents')::bigint,0)=0 and
    o.created_at is not null and public.cart_reminder_scope_key(o) is not null and
    coalesce(to_jsonb(o)->>'is_test','false') <> 'true';
$$;
create function public.cart_reminder_is_verified_purchase(o public.orders) returns boolean
language sql immutable set search_path=public as $$
  select o.paid_at is not null and o.created_at is not null and
    lower(coalesce(btrim(o.payment_status),'')) in ('paid','succeeded','no_payment_required','partially_refunded','refunded') and
    (coalesce(btrim(o.stripe_payment_intent_id),'')<>'' or coalesce(btrim(o.stripe_checkout_session_id),'')<>'') and
    coalesce(to_jsonb(o)->>'is_test','false') <> 'true';
$$;

create function public.cart_reminder_can_stop(o public.orders) returns boolean
language sql immutable set search_path=public as $$
  select lower(coalesce(btrim(o.status),'')) in ('payment_pending','cancel_pending','cancelled','canceled') and
    lower(coalesce(btrim(o.payment_status),'')) in ('','pending','unpaid','failed','cancelled','canceled','requires_payment_method','requires_confirmation','requires_action') and
    o.paid_at is null and lower(coalesce(to_jsonb(o)->>'refund_status','')) in ('','none','not_refunded','not_requested') and
    coalesce((to_jsonb(o)->>'refund_amount_cents')::bigint,0)=0 and o.created_at is not null and
    public.cart_reminder_scope_key(o) is not null and coalesce(to_jsonb(o)->>'is_test','false')<>'true';
$$;

-- Re-evaluated after the recipient lock and again immediately before sending.
-- The purchased checkout creation time is the boundary, not delayed paid_at.
create function public.cart_reminder_context(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare o public.orders; k text; paid public.orders; stop_at timestamptz; boundary timestamptz; episode text;
begin
  select * into o from public.orders where id=p_order_id;
  if not found or not public.cart_reminder_is_unpaid(o) then return null; end if;
  k:=public.cart_reminder_scope_key(o);
  select * into paid from public.orders p where p.photographer_id=o.photographer_id and public.cart_reminder_scope_key(p)=k and
    public.cart_reminder_is_verified_purchase(p) order by p.created_at desc,p.id desc limit 1;
  select s.stop_through into stop_at from public.cart_reminder_scopes s where s.scope_key=k;
  boundary:=greatest(paid.created_at,stop_at);
  if boundary is not null and o.created_at<=boundary then return null; end if;
  if exists(select 1 from public.orders newer where newer.photographer_id=o.photographer_id and public.cart_reminder_scope_key(newer)=k and
      public.cart_reminder_is_unpaid(newer) and (newer.created_at>o.created_at or
      (newer.created_at=o.created_at and newer.id>o.id))) then return null; end if;
  episode:=case when stop_at is not null and (paid.created_at is null or stop_at>paid.created_at)
    then 'stop:'||stop_at::text when paid.id is not null then 'paid:'||paid.id::text else 'initial' end;
  return jsonb_build_object('scope_key',k,'episode_key',md5(episode),'boundary',boundary,
    'photographer_id',o.photographer_id,'recipient_email',public.cart_reminder_recipient(o));
end $$;

create function public.cart_reminder_due_stage(p_order_id uuid,p_exclude_claim_id uuid default null) returns integer
language plpgsql security definer set search_path=public as $$
declare o public.orders; ctx jsonb; k text; ep text; boundary timestamptz;
  legacy_count integer; new_count integer; last_sent timestamptz; latest_contact timestamptz;
begin
  ctx:=public.cart_reminder_context(p_order_id);
  if ctx is null then return null; end if;
  select * into o from public.orders where id=p_order_id;
  k:=ctx->>'scope_key'; ep:=ctx->>'episode_key'; boundary:=(ctx->>'boundary')::timestamptz;
  if exists(select 1 from public.cart_reminder_claims c where c.scope_key=k and c.episode_key=ep and
    c.id is distinct from p_exclude_claim_id and c.status in ('claimed','uncertain')) then return null; end if;
  -- Existing web and desktop sends remain counted on upgrade. They do not
  -- get a fresh allowance merely because the delivery ledger changed.
  with history as (
    select d.sent_at from public.project_email_deliveries d join public.orders old on old.id=d.order_id
      where old.photographer_id=o.photographer_id and d.email_type='abandoned_cart' and d.status='sent' and public.cart_reminder_scope_key(old)=k and
        lower(btrim(d.recipient_email))=public.cart_reminder_recipient(o) and
        (boundary is null or old.created_at>boundary)
    union all
    select old.cart_reminder_sent_at from public.orders old where old.photographer_id=o.photographer_id and public.cart_reminder_scope_key(old)=k and
      old.cart_reminder_sent_at is not null and (boundary is null or old.created_at>boundary)
  ) select count(*)::integer,max(sent_at) into legacy_count,last_sent from history;
  select count(*)::integer,greatest(last_sent,max(c.sent_at)) into new_count,last_sent
    from public.cart_reminder_claims c where c.scope_key=k and c.episode_key=ep and c.status='sent';
  if legacy_count+new_count>=2 then return null; end if;
  -- One studio/recipient cooldown also protects families with several children.
  with contact as (
    select coalesce(c.sent_at,c.claimed_at) as at from public.cart_reminder_claims c
      join public.cart_reminder_scopes s on s.scope_key=c.scope_key
      where s.photographer_id=o.photographer_id and s.recipient_email=public.cart_reminder_recipient(o) and
        c.status in ('claimed','sent','uncertain') and c.id is distinct from p_exclude_claim_id
    union all
    select d.sent_at from public.project_email_deliveries d join public.orders old on old.id=d.order_id
      where old.photographer_id=o.photographer_id and lower(btrim(d.recipient_email))=public.cart_reminder_recipient(o)
        and d.email_type='abandoned_cart' and d.status='sent'
    union all
    select old.cart_reminder_sent_at from public.orders old where old.photographer_id=o.photographer_id and
      public.cart_reminder_recipient(old)=public.cart_reminder_recipient(o) and old.cart_reminder_sent_at is not null
  ) select max(at) into latest_contact from contact;
  if latest_contact>now()-interval '24 hours' then return null; end if;
  if legacy_count+new_count=0 and o.created_at<=now()-interval '24 hours' then return 1; end if;
  if legacy_count+new_count=1 and o.created_at<=now()-interval '72 hours' and
    last_sent<=now()-interval '48 hours' then return 2; end if;
  return null;
end $$;

create function public.claim_abandoned_cart_reminders(p_order_ids uuid[] default null,
  p_photographer_id uuid default null,p_limit integer default 100)
returns table(claim_id uuid,lease_token uuid,order_id uuid,stage integer,dedupe_key text,recipient_email text,
  photographer_id uuid,school_id uuid,project_id uuid,student_id uuid,created_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare o public.orders; ctx jsonb; k text; ep text; due integer; row public.cart_reminder_claims; n integer:=0;
begin
  if coalesce(p_limit,0)<=0 then return; end if;
  for o in select x.* from (
    select distinct on(public.cart_reminder_scope_key(d)) d.* from public.orders d
    where public.cart_reminder_is_unpaid(d) and (p_photographer_id is null or d.photographer_id=p_photographer_id)
    order by public.cart_reminder_scope_key(d),d.created_at desc,d.id desc
  ) x where (p_order_ids is null or x.id=any(p_order_ids)) and x.created_at<=now()-interval '24 hours'
    order by x.created_at,x.id loop
    k:=public.cart_reminder_scope_key(o);
    -- Try-lock avoids deadlocks between batches traversing different families.
    if not pg_try_advisory_xact_lock(hashtextextended('cart-recipient:'||o.photographer_id::text||':'||public.cart_reminder_recipient(o),0)) then continue; end if;
    if not pg_try_advisory_xact_lock(hashtextextended('cart-scope:'||k,0)) then continue; end if;
    insert into public.cart_reminder_scopes(scope_key,photographer_id,project_id,school_id,student_id,recipient_email)
      values(k,o.photographer_id,o.project_id,o.school_id,o.student_id,public.cart_reminder_recipient(o)) on conflict do nothing;
    -- An expired lease might already have reached the provider. Preserve the
    -- cap and require reconciliation instead of automatically sending again.
    update public.cart_reminder_claims c set status=case when c.provider_attempted_at is null then 'skipped' else 'uncertain' end,
      lease_token=null,lease_until=null,last_error=case when c.provider_attempted_at is null then 'Unused delivery lease expired.'
      else 'Delivery outcome needs provider reconciliation.' end where c.scope_key=k and c.status='claimed' and c.lease_until<now();
    ctx:=public.cart_reminder_context(o.id);
    if ctx is null then continue; end if;
    ep:=ctx->>'episode_key'; due:=public.cart_reminder_due_stage(o.id);
    if due is null then continue; end if;
    insert into public.cart_reminder_claims(scope_key,episode_key,order_id,stage,dedupe_key,recipient_email,status,lease_token,lease_until)
      values(k,ep,o.id,due,'abandoned-cart-v2:'||k||':'||ep||':'||due,public.cart_reminder_recipient(o),'claimed',gen_random_uuid(),now()+interval '10 minutes')
      on conflict on constraint cart_reminder_claims_scope_key_episode_key_stage_key do update set order_id=excluded.order_id,
        recipient_email=excluded.recipient_email,status='claimed',lease_token=excluded.lease_token,
        lease_until=excluded.lease_until,claimed_at=now(),provider_attempted_at=null,last_error=null
      where cart_reminder_claims.status='skipped' returning * into row;
    if not found then continue; end if;
    return query select row.id,row.lease_token,o.id,row.stage,row.dedupe_key,row.recipient_email,
      o.photographer_id,o.school_id,o.project_id,o.student_id,o.created_at;
    n:=n+1; if n>=least(p_limit,100) then return; end if;
  end loop;
end $$;

create function public.authorize_abandoned_cart_reminder_send(p_claim_id uuid,p_lease_token uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare c public.cart_reminder_claims; s public.cart_reminder_scopes; ctx jsonb;
begin
  select * into c from public.cart_reminder_claims where id=p_claim_id;
  if not found then return false; end if;
  select * into s from public.cart_reminder_scopes where scope_key=c.scope_key;
  perform pg_advisory_xact_lock(hashtextextended('cart-recipient:'||s.photographer_id::text||':'||s.recipient_email,0));
  perform pg_advisory_xact_lock(hashtextextended('cart-scope:'||s.scope_key,0));
  select * into c from public.cart_reminder_claims where id=p_claim_id for update;
  if c.status<>'claimed' or c.lease_token is distinct from p_lease_token or c.lease_until<=now() then return false; end if;
  if c.provider_attempted_at is not null then return false; end if;
  ctx:=public.cart_reminder_context(c.order_id);
  if ctx is null or ctx->>'scope_key'<>c.scope_key or ctx->>'episode_key'<>c.episode_key or
    public.cart_reminder_due_stage(c.order_id,c.id) is distinct from c.stage then
    update public.cart_reminder_claims set status='skipped',lease_token=null,lease_until=null,last_error='Cart is no longer eligible.' where id=c.id;
    return false;
  end if;
  update public.cart_reminder_claims set provider_attempted_at=now() where id=c.id;
  return true;
end $$;

create function public.complete_abandoned_cart_reminder(p_claim_id uuid,p_lease_token uuid,p_status text,
  p_resend_email_id text default null,p_error text default null) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  if p_status not in ('sent','skipped','uncertain') or
    (p_status='sent' and coalesce(btrim(p_resend_email_id),'')='') then return false; end if;
  update public.cart_reminder_claims set status=p_status,
    sent_at=case when p_status='sent' then now() else null end,
    resend_email_id=case when p_status='sent' then btrim(p_resend_email_id) else null end,
    last_error=left(p_error,250),lease_token=null,lease_until=null
    where id=p_claim_id and status='claimed' and lease_token=p_lease_token;
  return found;
end $$;

create function public.stop_abandoned_cart_reminders(p_order_id uuid,p_recipient_email text) returns boolean
language plpgsql security definer set search_path=public as $$
declare o public.orders; k text;
begin
  select * into o from public.orders where id=p_order_id;
  if not found or not public.cart_reminder_can_stop(o) or public.cart_reminder_recipient(o) is distinct from lower(btrim(p_recipient_email)) then return false; end if;
  k:=public.cart_reminder_scope_key(o);
  if k is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('cart-recipient:'||o.photographer_id::text||':'||public.cart_reminder_recipient(o),0));
  perform pg_advisory_xact_lock(hashtextextended('cart-scope:'||k,0));
  select * into o from public.orders where id=p_order_id;
  if not found or not public.cart_reminder_can_stop(o) or public.cart_reminder_scope_key(o)<>k or
    public.cart_reminder_recipient(o) is distinct from lower(btrim(p_recipient_email)) then return false; end if;
  insert into public.cart_reminder_scopes(scope_key,photographer_id,project_id,school_id,student_id,recipient_email,stop_through)
    values(k,o.photographer_id,o.project_id,o.school_id,o.student_id,public.cart_reminder_recipient(o),o.created_at)
    on conflict(scope_key) do update set stop_through=greatest(cart_reminder_scopes.stop_through,excluded.stop_through),updated_at=now();
  return true;
end $$;

revoke all on function public.cart_reminder_recipient(public.orders),public.cart_reminder_scope_key(public.orders),
  public.cart_reminder_is_unpaid(public.orders),public.cart_reminder_is_verified_purchase(public.orders),
  public.cart_reminder_can_stop(public.orders),
  public.cart_reminder_context(uuid),public.cart_reminder_due_stage(uuid,uuid),
  public.claim_abandoned_cart_reminders(uuid[],uuid,integer),public.authorize_abandoned_cart_reminder_send(uuid,uuid),
  public.complete_abandoned_cart_reminder(uuid,uuid,text,text,text),public.stop_abandoned_cart_reminders(uuid,text)
  from public,anon,authenticated;
grant execute on function public.cart_reminder_recipient(public.orders),public.cart_reminder_scope_key(public.orders),
  public.cart_reminder_is_unpaid(public.orders),public.cart_reminder_is_verified_purchase(public.orders),
  public.cart_reminder_can_stop(public.orders),
  public.cart_reminder_context(uuid),public.cart_reminder_due_stage(uuid,uuid),
  public.claim_abandoned_cart_reminders(uuid[],uuid,integer),public.authorize_abandoned_cart_reminder_send(uuid,uuid),
  public.complete_abandoned_cart_reminder(uuid,uuid,text,text,text),public.stop_abandoned_cart_reminders(uuid,text)
  to service_role;
