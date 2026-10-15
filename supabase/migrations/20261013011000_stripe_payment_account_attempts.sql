-- Immutable checkout reservations. The caller verifies expiration with Stripe
-- before requesting a replacement; never repeat an unknown external request on
-- a different account. All provider calls remain outside SQL.
create function public.reserve_order_payment_account(
  p_photographer_id uuid,p_order_ids uuid[],p_anchor_order_id uuid,p_expected_account_id text,
  p_expected_route_version bigint,p_amount_cents bigint,p_currency text,p_idempotency_key text,
  p_request_hash text default null,p_previous_expired_session_id text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.photographers%rowtype; a public.order_payment_accounts%rowtype; old_binding public.order_payment_accounts%rowtype;
  ids uuid[]; group_id uuid; gross bigint; curr text; aid text; snapshot jsonb; mode boolean; locked integer; routing jsonb;
begin
  select * into strict p from public.photographers where id=p_photographer_id for update;
  if p_order_ids is null or cardinality(p_order_ids)=0 or p_anchor_order_id is null or
    not p_anchor_order_id=any(p_order_ids) or p_idempotency_key is null or length(p_idempotency_key)>255 or
    p_amount_cents is null or p_amount_cents<=0 then raise exception 'A complete payment reservation is required.' using errcode='23514'; end if;
  select array_agg(x order by x) into ids from (select distinct unnest(p_order_ids) x) v;
  if cardinality(ids)<>cardinality(p_order_ids) then raise exception 'Duplicate payment orders.' using errcode='23514'; end if;
  perform id from public.orders where id=any(ids) order by id for update;
  get diagnostics locked=row_count;
  if locked<>cardinality(ids) or exists(select 1 from public.orders where id=any(ids) and photographer_id is distinct from p.id) then
    raise exception 'The payment orders do not belong to this studio.' using errcode='23514'; end if;
  select order_group_id into group_id from public.orders where id=p_anchor_order_id;
  if exists(select 1 from public.orders where id=any(ids) and order_group_id is distinct from group_id) or
    (group_id is not null and exists(select 1 from public.orders where order_group_id=group_id and not id=any(ids))) then
    raise exception 'The complete checkout group is required.' using errcode='23514'; end if;
  select sum(coalesce(total_cents,round(total_amount*100)::bigint)),min(lower(coalesce(currency,'cad'))),
    jsonb_agg(jsonb_build_object('id',id,'platform_fee_collection_method',platform_fee_collection_method,
      'platform_fee_amount_cents',platform_fee_amount_cents,'platform_fee_currency',platform_fee_currency,
      'platform_fee_rate_cents',platform_fee_rate_cents) order by id)
    into gross,curr,snapshot from public.orders where id=any(ids);
  if gross is null or gross<>p_amount_cents or curr<>lower(p_currency) or exists(select 1 from public.orders
    where id=any(ids) and (lower(coalesce(currency,'cad'))<>curr or coalesce(total_cents,round(total_amount*100)::bigint)<0)) then
    raise exception 'The payment total or currency changed.' using errcode='23514'; end if;
  select * into a from public.order_payment_accounts where idempotency_key=p_idempotency_key for update;
  if a.id is not null then
    if a.photographer_id<>p.id or a.order_ids<>ids or a.anchor_order_id<>p_anchor_order_id or
      a.amount_cents<>gross or a.currency<>curr or a.fee_snapshot<>snapshot or a.request_hash is distinct from p_request_hash then
      raise exception 'The retry does not match the immutable request.' using errcode='23514'; end if;
    -- Stripe may discard idempotency keys after 24 hours. Never repeat an
    -- unknown creation after that window; require original provider proof.
    if a.checkout_session_id is null and a.created_at<=now()-interval '23 hours' then
      raise exception 'The unknown checkout is too old to retry safely. Verify its original Stripe session.' using errcode='23514'; end if;
    return jsonb_build_object('attemptId',a.id,'accountId',a.stripe_account_id,'idempotencyKey',a.idempotency_key,'routeVersion',a.route_version,
      'checkoutSessionId',a.checkout_session_id,'paymentIntentId',a.payment_intent_id);
  end if;
  select b.* into old_binding from public.orders o join public.order_payment_accounts b on b.id=o.stripe_payment_account_binding_id
    where o.id=p_anchor_order_id for update of b;
  if old_binding.id is not null then
    if old_binding.order_ids<>ids or exists(select 1 from public.orders where id=any(ids) and stripe_payment_account_binding_id is distinct from old_binding.id) then
      raise exception 'Payment group bindings disagree.' using errcode='23514'; end if;
    if p_previous_expired_session_id is null or old_binding.checkout_session_id is distinct from p_previous_expired_session_id then
      raise exception 'An existing or uncertain checkout must be reused.' using errcode='23514'; end if;
    if exists(select 1 from public.orders where id=any(ids) and (paid_at is not null or
      lower(coalesce(payment_status,'')) in ('paid','succeeded','partially_refunded','refunded') or
      lower(coalesce(status,'')) in ('paid','ready','completed','refunded','refund_pending','cancel_pending','cancelled','canceled'))) then
      raise exception 'This checkout already has a terminal payment.' using errcode='23514'; end if;
    update public.order_payment_accounts set state='expired' where id=old_binding.id;
  elsif exists(select 1 from public.orders where id=any(ids) and
    (stripe_checkout_session_id is not null or stripe_payment_intent_id is not null or status='checkout_starting')) then
    raise exception 'The original checkout account must be backfilled first.' using errcode='23514';
  end if;
  routing:=public.get_photographer_checkout_routing(p.id,curr,p_anchor_order_id,p_previous_expired_session_id);
  aid:=routing->>'accountId';
  if aid is null or aid is distinct from p_expected_account_id or p.stripe_connect_route_version<>p_expected_route_version then
    raise exception 'The account changed before checkout was reserved. Refresh and retry.' using errcode='23514'; end if;
  if exists(select 1 from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id=aid and
    (deauthorized_at is not null or status='blocked' or not charges_enabled or not payouts_enabled)) then
    raise exception 'The payment connection is unavailable.' using errcode='23514'; end if;
  select livemode into mode from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id=aid and status in('active','legacy');
  if p.stripe_standard_migrated_at is not null and mode is null then raise exception 'The active history is unavailable.' using errcode='23514'; end if;
  insert into public.order_payment_accounts(photographer_id,stripe_account_id,livemode,anchor_order_id,order_group_id,order_ids,
    route_version,amount_cents,currency,fee_snapshot,idempotency_key,request_hash)
    values(p.id,aid,mode,p_anchor_order_id,group_id,ids,p.stripe_connect_route_version,gross,curr,snapshot,p_idempotency_key,p_request_hash)
    returning * into a;
  update public.orders set stripe_payment_account_binding_id=a.id where id=any(ids);
  return jsonb_build_object('attemptId',a.id,'accountId',aid,'idempotencyKey',a.idempotency_key,'routeVersion',a.route_version,
    'checkoutSessionId',a.checkout_session_id,'paymentIntentId',a.payment_intent_id);
end $$;

create function public.bind_order_payment_references(p_attempt_id uuid,p_checkout_session_id text,
  p_payment_intent_id text default null,p_charge_id text default null,p_application_fee_id text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_checkout_session_id is null or p_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$' or
    (p_payment_intent_id is not null and p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$') or
    (p_charge_id is not null and p_charge_id !~ '^ch_[A-Za-z0-9_]+$') or
    (p_application_fee_id is not null and p_application_fee_id !~ '^fee_[A-Za-z0-9_]+$') then
    raise exception 'Invalid provider payment references.' using errcode='23514'; end if;
  update public.order_payment_accounts set checkout_session_id=p_checkout_session_id,
    payment_intent_id=coalesce(p_payment_intent_id,payment_intent_id),charge_id=coalesce(p_charge_id,charge_id),
    application_fee_id=coalesce(p_application_fee_id,application_fee_id),state='open' where id=p_attempt_id;
  if not found then raise exception 'The payment reservation is unavailable.' using errcode='23514'; end if;
end $$;

-- The server supplies proof only after GETing the original session/payment and
-- checking its full immutable order/owner/amount/currency scope. Metadata alone
-- and today's current-account pointer are explicitly insufficient evidence.
create function public.backfill_order_payment_account(p_photographer_id uuid,p_order_ids uuid[],p_account_id text,
  p_checkout_session_id text,p_payment_intent_id text,p_amount_cents bigint,p_currency text,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.photographers%rowtype; ids uuid[]; group_id uuid; gross bigint; curr text;
  a public.order_payment_accounts%rowtype; snapshot jsonb; mode boolean;
begin
  select * into strict p from public.photographers where id=p_photographer_id for update;
  if p_order_ids is null or cardinality(p_order_ids)=0 or p_account_id is null or
    p_evidence->>'source' is distinct from 'verified_stripe_get' or p_evidence->>'account_id' is distinct from p_account_id or
    p_evidence->>'photographer_id' is distinct from p.id::text or
    p_evidence->>'livemode' is null or p_evidence->>'livemode' not in ('true','false') or
    (p_checkout_session_id is null and p_payment_intent_id is null) then
    raise exception 'Verified original Stripe payment evidence is required.' using errcode='23514'; end if;
  select array_agg(x order by x) into ids from(select distinct unnest(p_order_ids) x) v;
  if cardinality(ids)<>cardinality(p_order_ids) then raise exception 'Duplicate payment scope.' using errcode='23514'; end if;
  perform id from public.orders where id=any(ids) order by id for update;
  if (select count(*) from public.orders where id=any(ids))<>cardinality(ids) or exists(select 1 from public.orders
    where id=any(ids) and (photographer_id is distinct from p.id or
      (p_checkout_session_id is not null and stripe_checkout_session_id is distinct from p_checkout_session_id) or
      (p_payment_intent_id is not null and stripe_payment_intent_id is not null and stripe_payment_intent_id<>p_payment_intent_id))) then
    raise exception 'Saved references do not match the verified payment.' using errcode='23514'; end if;
  select order_group_id into group_id from public.orders where id=ids[1];
  if exists(select 1 from public.orders where id=any(ids) and order_group_id is distinct from group_id) or
    (group_id is not null and exists(select 1 from public.orders where order_group_id=group_id and not id=any(ids))) then
    raise exception 'The complete verified group is required.' using errcode='23514'; end if;
  select sum(coalesce(total_cents,round(total_amount*100)::bigint)),min(lower(coalesce(currency,'cad'))),
    jsonb_agg(jsonb_build_object('id',id,'platform_fee_collection_method',platform_fee_collection_method,
      'platform_fee_amount_cents',platform_fee_amount_cents,'platform_fee_currency',platform_fee_currency,
      'platform_fee_rate_cents',platform_fee_rate_cents) order by id) into gross,curr,snapshot from public.orders where id=any(ids);
  if gross is null or gross<>p_amount_cents or curr<>lower(p_currency) or exists(select 1 from public.orders where id=any(ids) and
    lower(coalesce(currency,'cad'))<>curr) then raise exception 'Verified payment amount or currency mismatch.' using errcode='23514'; end if;
  select livemode into mode from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id=p_account_id
    and livemode=(p_evidence->>'livemode')::boolean;
  if mode is null and p.stripe_standard_migrated_at is null and p.stripe_connect_route_version=0 and
    p_account_id=coalesce(p.stripe_connected_account_id,p.stripe_account_id) and not exists(
      select 1 from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id=p_account_id) then
    -- Before the rollout registry is populated, original-account provider GET
    -- proof may bind a legacy Express session. It cannot select a new account.
    mode:=(p_evidence->>'livemode')::boolean;
  end if;
  if mode is null then raise exception 'The original account must be verified before backfill.' using errcode='23514'; end if;
  select b.* into a from public.orders o join public.order_payment_accounts b on b.id=o.stripe_payment_account_binding_id where o.id=ids[1];
  if a.id is not null then
    if a.photographer_id<>p.id or a.stripe_account_id<>p_account_id or a.order_ids<>ids or
      a.checkout_session_id is distinct from p_checkout_session_id or
      (a.payment_intent_id is not null and a.payment_intent_id is distinct from p_payment_intent_id) then
      raise exception 'An original payment account cannot be replaced.' using errcode='23514'; end if;
    return jsonb_build_object('attemptId',a.id,'accountId',a.stripe_account_id,'idempotencyKey',a.idempotency_key,'routeVersion',a.route_version);
  end if;
  if exists(select 1 from public.orders where id=any(ids) and stripe_payment_account_binding_id is not null) then
    raise exception 'Payment group bindings disagree.' using errcode='23514'; end if;
  insert into public.order_payment_accounts(photographer_id,stripe_account_id,livemode,anchor_order_id,order_group_id,order_ids,
    route_version,amount_cents,currency,fee_snapshot,idempotency_key,checkout_session_id,payment_intent_id,evidence)
    values(p.id,p_account_id,mode,ids[1],group_id,ids,p.stripe_connect_route_version,gross,curr,snapshot,
      'verified-history-'||coalesce(p_checkout_session_id,p_payment_intent_id),p_checkout_session_id,p_payment_intent_id,p_evidence) returning * into a;
  update public.orders set stripe_payment_account_binding_id=a.id where id=any(ids);
  return jsonb_build_object('attemptId',a.id,'accountId',a.stripe_account_id,'idempotencyKey',a.idempotency_key,'routeVersion',a.route_version);
end $$;

create function public.protect_stripe_migration_marker() returns trigger language plpgsql set search_path=public as $$
begin
  if current_user in ('anon','authenticated') and ((tg_op='INSERT' and (new.stripe_standard_migrated_at is not null or new.stripe_connect_route_version<>0))
    or (tg_op='UPDATE' and (new.stripe_standard_migrated_at is distinct from old.stripe_standard_migrated_at or
      new.stripe_connect_route_version is distinct from old.stripe_connect_route_version))) then
    raise exception 'Only Studio OS can change payment routing.' using errcode='42501'; end if;
  if tg_op='UPDATE' and old.stripe_standard_migrated_at is not null and new.stripe_standard_migrated_at is null then
    raise exception 'A migration marker cannot be erased.' using errcode='23514'; end if;
  return new;
end $$;
create trigger protect_stripe_migration_marker before insert or update on public.photographers
for each row execute function public.protect_stripe_migration_marker();
do $$ declare fn record; begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('reserve_order_payment_account','bind_order_payment_references','backfill_order_payment_account') loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
