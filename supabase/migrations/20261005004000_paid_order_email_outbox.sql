-- Future paid transitions stage notification work in the payment transaction.
-- Existing paid orders are deliberately not backfilled: their emails may have
-- already been delivered without a ledger. All contact/content snapshots stay
-- private to the service role.
create table public.paid_order_emails (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  photographer_id uuid not null,
  kind text not null check (kind in ('receipt','photographer','digital')),
  recipient_email text,
  snapshot jsonb not null,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending','sending','sent','needs_review','cancelled')),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  resend_email_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (order_id,kind)
);
alter table public.paid_order_emails enable row level security;
revoke all on public.paid_order_emails from public, anon, authenticated;
grant all on public.paid_order_emails to service_role;
create index paid_order_emails_pending_idx on public.paid_order_emails(next_attempt_at,created_at,id) where status in ('pending','sending');

-- One paced dispatcher avoids multiplying the provider's account-wide request
-- rate when many webhooks and cron runs arrive together. Expired workers recover.
create table public.paid_order_email_worker (
  singleton boolean primary key default true check (singleton),
  lease_token uuid,
  lease_until timestamptz
);
insert into public.paid_order_email_worker(singleton) values(true);
alter table public.paid_order_email_worker enable row level security;
revoke all on public.paid_order_email_worker from public, anon, authenticated;
grant all on public.paid_order_email_worker to service_role;

create or replace function public.stage_paid_order_email_outbox()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  studio jsonb;
  items jsonb;
  context jsonb;
  frozen jsonb;
  buyer text;
  owner_email text;
  has_digital boolean;
begin
  if new.photographer_id is null or new.paid_at is null
    or lower(coalesce(new.payment_status,'')) not in ('paid','succeeded','no_payment_required')
    or coalesce(new.refund_amount_cents,0) <> 0 or lower(coalesce(new.refund_status,'')) not in ('','none','not_refunded','not_requested')
    or lower(coalesce(new.status,'')) in ('cancelled','canceled','cancel_pending','refund_pending','refunded') then return new; end if;
  if tg_op = 'UPDATE' and old.paid_at is not null
    and lower(coalesce(old.payment_status,'')) in ('paid','succeeded','no_payment_required','partially_refunded') then return new; end if;

  select jsonb_build_object('id',p.id,'user_id',p.user_id,'business_name',p.business_name,'billing_email',p.billing_email,
    'studio_email',p.studio_email,'studio_phone',p.studio_phone,'studio_address',p.studio_address,'logo_url',p.logo_url)
    into studio from public.photographers p where p.id=new.photographer_id;
  select coalesce(jsonb_agg(jsonb_build_object('product_name',i.product_name,'quantity',i.quantity,
    'unit_price_cents',i.unit_price_cents,'line_total_cents',i.line_total_cents,'sku',i.sku) order by i.id),'[]'::jsonb)
    into items from public.order_items i where i.order_id=new.id;
  select jsonb_build_object(
    'project_title',(select p.title from public.projects p where p.id=new.project_id and p.photographer_id=new.photographer_id),
    'project_pin',(select p.access_pin from public.projects p where p.id=new.project_id and p.photographer_id=new.photographer_id),
    'school_name',(select s.school_name from public.schools s where s.id=new.school_id and s.photographer_id=new.photographer_id),
    'student_name',(select concat_ws(' ',s.first_name,s.last_name) from public.students s join public.schools school on school.id=s.school_id where s.id=new.student_id and school.id=new.school_id and school.photographer_id=new.photographer_id),
    'student_pin',(select s.pin from public.students s join public.schools school on school.id=s.school_id where s.id=new.student_id and school.id=new.school_id and school.photographer_id=new.photographer_id)
  ) into context;
  buyer=lower(coalesce(nullif(btrim(new.customer_email),''),nullif(btrim(new.parent_email),'')));
  owner_email=lower(coalesce(nullif(btrim(studio->>'billing_email'),''),nullif(btrim(studio->>'studio_email'),'')));
  frozen=jsonb_build_object('order',to_jsonb(new),'items',items,'photographer',coalesce(studio,'{}'::jsonb),'context',context);
  insert into public.paid_order_emails(order_id,photographer_id,kind,recipient_email,snapshot)
    values(new.id,new.photographer_id,'receipt',buyer,frozen),(new.id,new.photographer_id,'photographer',owner_email,frozen)
    on conflict(order_id,kind) do nothing;
  has_digital=(lower(coalesce(new.package_name,'')) like '%digital%' and lower(coalesce(new.package_name,'')) not like '%retouch%') or exists(
    select 1 from jsonb_array_elements(items) item where lower(coalesce(item->>'product_name','')) not like '%retouch%'
      and lower(coalesce(item->>'product_name','')) ~ '(digital|download|file|jpg|jpeg|png|usb)');
  if has_digital then
    insert into public.paid_order_emails(order_id,photographer_id,kind,recipient_email,snapshot)
      values(new.id,new.photographer_id,'digital',buyer,frozen) on conflict(order_id,kind) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.stage_paid_order_email_outbox() from public, anon, authenticated;
create trigger paid_order_email_outbox after insert or update of paid_at,payment_status on public.orders
  for each row execute function public.stage_paid_order_email_outbox();

-- Replaying an already-paid finalizer recovers only tracked future work. It
-- must never create receipts for historical paid orders without delivery proof.
create or replace function public.ensure_paid_order_emails(p_order_id uuid)
returns table(id uuid) language sql security definer set search_path = public, pg_temp as $$
  select e.id from public.paid_order_emails e join public.orders o on o.id=e.order_id and o.photographer_id=e.photographer_id
    where e.order_id=p_order_id and e.status in ('pending','sending');
$$;

create or replace function public.claim_paid_order_emails(p_ids uuid[] default null,p_limit integer default 200)
returns setof public.paid_order_emails language plpgsql security definer set search_path = public, pg_temp as $$
declare token uuid; claimed integer;
begin
  update public.paid_order_email_worker set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes'
    where singleton and (lease_until is null or lease_until < now()) returning lease_token into token;
  if token is null then return; end if;
  update public.paid_order_emails e set status='cancelled',lease_token=null,lease_until=null,last_error='Order is no longer eligible for a paid notification.'
    where e.status in ('pending','sending') and (e.lease_until is null or e.lease_until < now()) and not exists(
      select 1 from public.orders o where o.id=e.order_id and o.photographer_id=e.photographer_id and o.paid_at is not null
        and lower(coalesce(o.payment_status,'')) in ('paid','succeeded','no_payment_required')
        and coalesce(o.refund_amount_cents,0)=0 and lower(coalesce(o.refund_status,'')) in ('','none','not_refunded','not_requested')
        and lower(coalesce(o.status,'')) not in ('cancelled','canceled','cancel_pending','refund_pending','refunded'));
  update public.paid_order_emails set status='needs_review',lease_token=null,lease_until=null,last_error='Delivery needs provider reconciliation before retry.'
    where status in ('pending','sending') and (lease_until is null or lease_until < now())
      -- The staging age also covers the migration/code rollout overlap, when
      -- an older finalizer may have already used the same provider key.
      and (created_at < now()-interval '23 hours' or first_attempt_at < now()-interval '23 hours' or attempts >= 20);
  return query with candidates as (
    select e.id from public.paid_order_emails e where e.status in ('pending','sending') and e.next_attempt_at <= now()
      and (e.lease_until is null or e.lease_until < now()) and (p_ids is null or e.id=any(p_ids))
      order by e.created_at,e.id limit greatest(1,least(coalesce(p_limit,200),200)) for update skip locked
  ) update public.paid_order_emails e set status='sending',lease_token=token,lease_until=now()+interval '3 minutes',attempts=e.attempts+1
    from candidates c where e.id=c.id returning e.*;
  get diagnostics claimed = row_count;
  if claimed=0 then update public.paid_order_email_worker set lease_token=null,lease_until=null where singleton and lease_token=token; end if;
end $$;

-- Persist the exact provider request before sending. A lost provider response
-- or database acknowledgement always retries those bytes with the same key.
create or replace function public.prepare_paid_order_email(p_id uuid,p_lease_token uuid,p_payload jsonb)
returns setof public.paid_order_emails language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query update public.paid_order_emails e set payload=coalesce(e.payload,p_payload),first_attempt_at=coalesce(e.first_attempt_at,now())
    where e.id=p_id and e.lease_token=p_lease_token and e.status='sending' and e.lease_until > now()
      and jsonb_typeof(p_payload)='object' and jsonb_typeof(p_payload->'to')='string'
      and lower(p_payload->>'to')=e.recipient_email
      and p_payload->>'idempotencyKey'=case e.kind when 'receipt' then 'order-receipt-'||e.order_id::text
        when 'photographer' then 'order-notify-'||e.order_id::text else 'digital-delivery-'||e.order_id::text||'-'||e.recipient_email end
      and exists(select 1 from public.orders o where o.id=e.order_id and o.photographer_id=e.photographer_id and o.paid_at is not null
        and lower(coalesce(o.payment_status,'')) in ('paid','succeeded','no_payment_required')
        and coalesce(o.refund_amount_cents,0)=0 and lower(coalesce(o.refund_status,'')) in ('','none','not_refunded','not_requested')
        and lower(coalesce(o.status,'')) not in ('cancelled','canceled','cancel_pending','refund_pending','refunded'))
    returning e.*;
end $$;

create or replace function public.release_paid_order_email_worker(p_lease_token uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.paid_order_email_worker set lease_token=null,lease_until=null where singleton and lease_token=p_lease_token;
$$;
revoke all on function public.ensure_paid_order_emails(uuid),public.claim_paid_order_emails(uuid[],integer),public.prepare_paid_order_email(uuid,uuid,jsonb),public.release_paid_order_email_worker(uuid) from public,anon,authenticated;
grant execute on function public.ensure_paid_order_emails(uuid),public.claim_paid_order_emails(uuid[],integer),public.prepare_paid_order_email(uuid,uuid,jsonb),public.release_paid_order_email_worker(uuid) to service_role;
