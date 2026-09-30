-- Keep Stripe credit purchases and their receipts in the same transaction.
-- Deploy with the updated desktop RPC client before customers resume AI work.
begin;

alter table public.studio_credits
  add column if not exists credit_debt integer not null default 0
  check (credit_debt >= 0);

alter table public.studio_credits
  add column if not exists credit_lots_initialized boolean not null default false;

create table if not exists public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  transaction_id uuid unique references public.credit_transactions(id),
  issued_credits integer not null check (issued_credits > 0),
  remaining_credits integer not null check (remaining_credits >= 0),
  consumed_credits integer not null default 0 check (consumed_credits >= 0),
  refunded_credits integer not null default 0 check (refunded_credits >= 0),
  expired_credits integer not null default 0 check (expired_credits >= 0),
  pending_refund_debt integer not null default 0 check(pending_refund_debt>=0),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists credit_lots_studio_expiry_idx on public.credit_lots(studio_id,expires_at,created_at);
create index if not exists credit_lots_due_idx on public.credit_lots(expires_at,studio_id) where remaining_credits>0 and expires_at is not null;
alter table public.credit_lots enable row level security;
revoke all on public.credit_lots from public, anon, authenticated;
grant all on public.credit_lots to service_role;

-- Annual subscriptions still have a monthly credit reset anniversary. Adding
-- whole months to the original anchor avoids drifting after February's end.
create or replace function public._next_credit_billing_date(p_photographer_id uuid)
returns timestamptz language plpgsql security definer set search_path = public set timezone = 'UTC' as $$
declare profile jsonb; anchor timestamptz; period_end timestamptz; next_date timestamptz; months integer := 1;
begin
  select to_jsonb(p) into profile from public.photographers p where p.id = p_photographer_id;
  if coalesce((profile->>'is_platform_admin')::boolean, false) then return null; end if;
  anchor := coalesce((profile->>'subscription_current_period_start')::timestamptz,
    (profile->>'trial_starts_at')::timestamptz, (profile->>'created_at')::timestamptz, now());
  period_end := (profile->>'subscription_current_period_end')::timestamptz;
  if period_end > now() and period_end <= anchor + interval '1 month' then return period_end; end if;
  months := greatest(1, (extract(year from age(now(), anchor)) * 12 + extract(month from age(now(), anchor)))::integer);
  next_date := anchor + make_interval(months => months);
  while next_date <= now() loop
    months := months + 1;
    next_date := anchor + make_interval(months => months);
  end loop;
  return next_date;
end $$;
revoke all on function public._next_credit_billing_date(uuid) from public, anon, authenticated;

-- Existing credits are preserved at rollout and get their next future monthly
-- deadline. Attribute remaining balance to newest purchases (FIFO spending).
create or replace function public._prepare_credit_account(p_studio_id uuid, p_photographer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare account public.studio_credits; receipt public.credit_transactions;
  available integer; issued integer; refunded integer; remaining integer; deadline timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text, 3001));
  insert into public.studio_credits(studio_id,photographer_id,balance,total_purchased,total_used)
    select p_studio_id,p_photographer_id,0,0,0
    where not exists(select 1 from public.studio_credits sc where sc.studio_id=p_studio_id);
  select * into strict account from public.studio_credits sc where sc.studio_id=p_studio_id for update;
  if account.credit_lots_initialized then return; end if;
  available := greatest(account.balance, 0);
  deadline := public._next_credit_billing_date(p_photographer_id);
  for receipt in select * from public.credit_transactions ct where ct.studio_id=p_studio_id
      and ct.source='purchase' and coalesce(ct.credits_delta,ct.amount)>0
      order by ct.created_at desc,ct.id desc loop
    issued := coalesce(receipt.credits_delta,receipt.amount);
    select least(issued,coalesce(sum(-coalesce(ct.credits_delta,ct.amount)),0))::integer into refunded
      from public.credit_transactions ct where ct.studio_id=p_studio_id and ct.source='refund'
      and ct.stripe_payment_intent_id=receipt.stripe_payment_intent_id and coalesce(ct.credits_delta,ct.amount)<0;
    remaining := least(available, issued-refunded);
    insert into public.credit_lots(studio_id,transaction_id,issued_credits,remaining_credits,
      consumed_credits,refunded_credits,expires_at,created_at)
      values(p_studio_id,receipt.id,issued,remaining,issued-refunded-remaining,refunded,deadline,coalesce(receipt.created_at,now()));
    available := available-remaining;
  end loop;
  if available > 0 then
    insert into public.credit_lots(studio_id,issued_credits,remaining_credits,expires_at)
      values(p_studio_id,available,available,deadline);
  end if;
  update public.studio_credits sc set credit_lots_initialized=true,photographer_id=p_photographer_id where sc.id=account.id;
end $$;
revoke all on function public._prepare_credit_account(uuid,uuid) from public, anon, authenticated;

create or replace function public._expire_credit_lots(p_studio_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare account public.studio_credits; expired integer; next_balance integer;
begin
  select * into strict account from public.studio_credits sc where sc.studio_id=p_studio_id for update;
  select coalesce(sum(cl.remaining_credits),0)::integer into expired from public.credit_lots cl
    where cl.studio_id=p_studio_id and cl.expires_at<=now() and cl.remaining_credits>0;
  if expired=0 then return; end if;
  update public.credit_lots cl set expired_credits=cl.expired_credits+cl.remaining_credits,remaining_credits=0
    where cl.studio_id=p_studio_id and cl.expires_at<=now() and cl.remaining_credits>0;
  next_balance := greatest(0,account.balance-expired);
  insert into public.credit_transactions(studio_id,photographer_id,type,amount,credits_delta,
    credit_transaction_type,balance_after,description,source)
    values(p_studio_id,account.photographer_id,'usage',-expired,-expired,'usage',next_balance,
      'Unused credits expired at monthly billing date','expiry');
  update public.studio_credits sc set balance=next_balance,updated_at=now() where sc.id=account.id;
end $$;
revoke all on function public._expire_credit_lots(uuid) from public, anon, authenticated;

create or replace function public.expire_due_credit_accounts(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=public as $$
declare account record; processed integer:=0;
begin
  for account in select distinct cl.studio_id from public.credit_lots cl
      join public.studio_credits sc on sc.studio_id=cl.studio_id
      where cl.remaining_credits>0 and cl.expires_at<=now()
      order by cl.studio_id limit greatest(1,least(coalesce(p_limit,100),1000)) loop
    perform public._expire_credit_lots(account.studio_id);
    processed:=processed+1;
  end loop;
  return processed;
end $$;
revoke all on function public.expire_due_credit_accounts(integer) from public,anon,authenticated;
grant execute on function public.expire_due_credit_accounts(integer) to service_role;

create table if not exists public.credit_usage_allocations (
  transaction_id uuid not null references public.credit_transactions(id),
  lot_id uuid not null references public.credit_lots(id),
  credits integer not null check(credits>0),
  refunded_credits integer not null default 0 check(refunded_credits>=0),
  primary key(transaction_id,lot_id)
);
alter table public.credit_usage_allocations enable row level security;
revoke all on public.credit_usage_allocations from public,anon,authenticated;
grant all on public.credit_usage_allocations to service_role;

create table if not exists public.credit_debt_payments (
  id uuid primary key default gen_random_uuid(),
  original_lot_id uuid not null references public.credit_lots(id),
  payment_lot_id uuid not null references public.credit_lots(id),
  credits integer not null check(credits>0),
  cancelled_credits integer not null default 0 check(cancelled_credits>=0),
  created_at timestamptz not null default now()
);
alter table public.credit_debt_payments enable row level security;
revoke all on public.credit_debt_payments from public,anon,authenticated;
grant all on public.credit_debt_payments to service_role;

create or replace function public._consume_credit_lots(p_studio_id uuid,p_amount integer,p_usage_transaction_id uuid default null,p_debt_payment boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare lot public.credit_lots; outstanding integer:=p_amount; taken integer;
begin
  for lot in select * from public.credit_lots cl where cl.studio_id=p_studio_id and cl.remaining_credits>0
      and (cl.expires_at is null or cl.expires_at>now()) order by cl.expires_at nulls last,cl.created_at,cl.id for update loop
    taken := least(outstanding,lot.remaining_credits);
    update public.credit_lots cl set remaining_credits=cl.remaining_credits-taken,consumed_credits=cl.consumed_credits+taken where cl.id=lot.id;
    if p_usage_transaction_id is not null then
      insert into public.credit_usage_allocations(transaction_id,lot_id,credits) values(p_usage_transaction_id,lot.id,taken);
    end if;
    if p_debt_payment then perform public._record_credit_debt_payment(p_studio_id,taken,lot.id); end if;
    outstanding:=outstanding-taken;
    exit when outstanding=0;
  end loop;
  if outstanding>0 then raise exception 'Insufficient unexpired credits'; end if;
end $$;
revoke all on function public._consume_credit_lots(uuid,integer,uuid,boolean) from public, anon, authenticated;

create or replace function public._record_credit_debt_payment(p_studio_id uuid,p_amount integer,p_payment_lot_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare lot public.credit_lots; outstanding integer:=p_amount; paid integer;
begin
  for lot in select * from public.credit_lots cl where cl.studio_id=p_studio_id and cl.pending_refund_debt>0
      order by cl.created_at,cl.id for update loop
    paid:=least(outstanding,lot.pending_refund_debt);
    update public.credit_lots cl set pending_refund_debt=cl.pending_refund_debt-paid where cl.id=lot.id;
    insert into public.credit_debt_payments(original_lot_id,payment_lot_id,credits) values(lot.id,p_payment_lot_id,paid);
    outstanding:=outstanding-paid; exit when outstanding=0;
  end loop;
end $$;
revoke all on function public._record_credit_debt_payment(uuid,integer,uuid) from public,anon,authenticated;

-- Failed work can settle after a cash refund and even after another purchase
-- repaid that refund's debt. Restore the repayment's original credit deadline.
create or replace function public._restore_consumed_credit_lot(p_lot_id uuid,p_amount integer)
returns table(restored integer,cancelled_debt integer)
language plpgsql security definer set search_path=public as $$
declare lot public.credit_lots; payment public.credit_debt_payments; child record;
  ordinary integer; pending integer; outstanding integer; taken integer; recovered integer:=0; debt integer:=0;
begin
  select * into strict lot from public.credit_lots cl where cl.id=p_lot_id for update;
  ordinary:=least(p_amount,lot.consumed_credits);
  outstanding:=p_amount-ordinary;
  pending:=least(outstanding,lot.pending_refund_debt);
  outstanding:=outstanding-pending; debt:=pending;
  update public.credit_lots cl set consumed_credits=cl.consumed_credits-ordinary,pending_refund_debt=cl.pending_refund_debt-pending,
    remaining_credits=cl.remaining_credits+case when cl.expires_at is null or cl.expires_at>now() then ordinary else 0 end,
    expired_credits=cl.expired_credits+case when cl.expires_at<=now() then ordinary else 0 end where cl.id=lot.id;
  if lot.expires_at is null or lot.expires_at>now() then recovered:=ordinary; end if;
  if outstanding>0 then
    for payment in select * from public.credit_debt_payments cdp where cdp.original_lot_id=lot.id
        and cdp.credits>cdp.cancelled_credits order by cdp.created_at,cdp.id for update loop
      taken:=least(outstanding,payment.credits-payment.cancelled_credits);
      update public.credit_debt_payments cdp set cancelled_credits=cdp.cancelled_credits+taken where cdp.id=payment.id;
      select * into child from public._restore_consumed_credit_lot(payment.payment_lot_id,taken);
      recovered:=recovered+child.restored; debt:=debt+child.cancelled_debt;
      outstanding:=outstanding-taken; exit when outstanding=0;
    end loop;
  end if;
  return query select recovered,debt;
end $$;
revoke all on function public._restore_consumed_credit_lot(uuid,integer) from public,anon,authenticated;

create or replace function public.get_studio_credit_balance(p_studio_id uuid default null)
returns table(balance integer,expires_at timestamptz,credit_debt integer)
language plpgsql security definer set search_path = public as $$
declare studio uuid:=coalesce(p_studio_id,auth.uid()); photographer uuid;
begin
  if studio is null or (auth.uid() is not null and studio<>auth.uid()) then raise exception 'Unauthorized credit account'; end if;
  if auth.uid() is null and current_setting('role',true)<>'service_role' then raise exception 'Authentication required'; end if;
  select p.id into photographer from public.photographers p where p.user_id=studio;
  if photographer is null then raise exception 'Photographer account required'; end if;
  perform public._prepare_credit_account(studio,photographer);
  perform public._expire_credit_lots(studio);
  return query select sc.balance,(select min(cl.expires_at) from public.credit_lots cl
    where cl.studio_id=studio and cl.remaining_credits>0),sc.credit_debt from public.studio_credits sc where sc.studio_id=studio;
end $$;
revoke all on function public.get_studio_credit_balance(uuid) from public, anon;
grant execute on function public.get_studio_credit_balance(uuid) to authenticated,service_role;

-- Direct legacy writes are disabled below. No balance trigger is needed:
-- authenticated SECURITY DEFINER RPCs already consume lots explicitly.
drop trigger if exists track_legacy_credit_spend on public.studio_credits;
drop function if exists public._track_legacy_credit_spend();

create index if not exists credit_transactions_purchase_intent_idx
  on public.credit_transactions (stripe_payment_intent_id)
  where source = 'purchase';

create or replace function public.apply_credit_adjustment(
  p_studio_id uuid, p_photographer_id uuid, p_delta integer,
  p_type text, p_source text, p_description text,
  p_package_id uuid default null, p_source_reference_id text default null,
  p_checkout_session_id text default null, p_payment_intent_id text default null
) returns table(applied boolean, balance integer, credits_delta integer)
language plpgsql security definer set search_path = public as $$
declare
  account public.studio_credits;
  next_balance integer;
  debt_payment integer;
  receipt_id uuid;
  granted_lot_id uuid;
begin
  if p_studio_id is null or p_photographer_id is null or p_delta is null
     or p_delta = 0 or nullif(p_type, '') is null or nullif(p_source, '') is null then
    raise exception 'Invalid credit adjustment';
  end if;
  if not exists(select 1 from public.photographers p
      where p.id = p_photographer_id and p.user_id = p_studio_id) then
    raise exception 'Credit account does not belong to photographer';
  end if;
  if p_source = 'purchase' and (p_delta <= 0 or nullif(p_source_reference_id, '') is null) then
    raise exception 'A purchase needs positive credits and a payment reference';
  end if;
  perform public._prepare_credit_account(p_studio_id,p_photographer_id);
  perform public._expire_credit_lots(p_studio_id);
  select * into strict account from public.studio_credits sc where sc.studio_id = p_studio_id for update;
  if nullif(p_source_reference_id, '') is not null and exists(
      select 1 from public.credit_transactions ct where ct.studio_id = p_studio_id
      and ct.source = p_source and ct.source_reference_id = p_source_reference_id) then
    return query select false, account.balance, 0;
    return;
  end if;
  debt_payment := case when p_delta > 0 then least(account.credit_debt, p_delta) else 0 end;
  next_balance := account.balance + p_delta - debt_payment;
  if next_balance < 0 then raise exception 'Insufficient credits'; end if;
  insert into public.credit_transactions(studio_id, photographer_id, type, amount,
    credits_delta, credit_transaction_type, balance_after, description, package_id,
    source, source_reference_id, stripe_checkout_session_id, stripe_payment_intent_id)
    values(p_studio_id, p_photographer_id, p_type, p_delta, p_delta, p_type,
      next_balance, p_description, p_package_id, p_source, p_source_reference_id,
      p_checkout_session_id, p_payment_intent_id) returning id into receipt_id;
  if p_delta > 0 then
    insert into public.credit_lots(studio_id,transaction_id,issued_credits,remaining_credits,consumed_credits,expires_at)
      values(p_studio_id,receipt_id,p_delta,p_delta-debt_payment,debt_payment,public._next_credit_billing_date(p_photographer_id)) returning id into granted_lot_id;
    if debt_payment>0 then perform public._record_credit_debt_payment(p_studio_id,debt_payment,granted_lot_id); end if;
  else
    perform public._consume_credit_lots(p_studio_id,-p_delta,receipt_id);
  end if;
  update public.studio_credits sc set photographer_id = p_photographer_id,
    balance = next_balance, credit_debt = account.credit_debt - debt_payment,
    total_purchased = account.total_purchased + case when p_source = 'purchase' then p_delta else 0 end,
    total_used = account.total_used + case when p_type = 'usage' and p_delta < 0 then -p_delta else 0 end,
    updated_at = now() where sc.id = account.id;
  return query select true, next_balance, p_delta;
end $$;
revoke all on function public.apply_credit_adjustment(uuid,uuid,integer,text,text,text,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.apply_credit_adjustment(uuid,uuid,integer,text,text,text,uuid,text,text,text)
  to service_role;

-- Stripe sends cumulative refunded cents. Derive credits from the original
-- receipt, rather than today's price catalog, and reverse each portion once.
create or replace function public.reverse_credit_purchase(
  p_payment_intent_id text, p_charge_amount_cents integer,
  p_refunded_amount_cents integer, p_description text
) returns table(applied boolean, balance integer, credits_delta integer, studio_id uuid, photographer_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  purchase public.credit_transactions;
  account public.studio_credits;
  target_credits integer;
  already_reversed integer;
  reversal integer;
  next_balance integer;
  lot public.credit_lots;
  balance_reversal integer;
  consumed_reversal integer;
  debt_payment integer;
begin
  if nullif(p_payment_intent_id, '') is null or p_charge_amount_cents is null
      or p_charge_amount_cents <= 0 or p_refunded_amount_cents is null
      or p_refunded_amount_cents < 0 or p_refunded_amount_cents > p_charge_amount_cents then
    raise exception 'Invalid credit refund';
  end if;
  select * into purchase from public.credit_transactions ct
    where ct.stripe_payment_intent_id = p_payment_intent_id and ct.source = 'purchase'
    order by ct.created_at, ct.id limit 1;
  if not found then raise exception 'Credit purchase not yet recorded'; end if;
  if purchase.photographer_id is null then
    select p.id into purchase.photographer_id from public.photographers p where p.user_id=purchase.studio_id;
  end if;
  perform public._prepare_credit_account(purchase.studio_id,purchase.photographer_id);
  perform public._expire_credit_lots(purchase.studio_id);
  select * into strict account from public.studio_credits sc where sc.studio_id = purchase.studio_id for update;
  target_credits := floor(coalesce(purchase.credits_delta, purchase.amount)::numeric
    * p_refunded_amount_cents / p_charge_amount_cents)::integer;
  select coalesce(sum(-coalesce(ct.credits_delta, ct.amount)), 0)::integer into already_reversed
    from public.credit_transactions ct where ct.studio_id = purchase.studio_id
    and ct.source = 'refund' and ct.stripe_payment_intent_id = p_payment_intent_id
    and coalesce(ct.credits_delta, ct.amount) < 0;
  reversal := greatest(0, target_credits - already_reversed);
  if reversal = 0 then
    return query select false, account.balance, 0, purchase.studio_id, purchase.photographer_id;
    return;
  end if;
  select * into strict lot from public.credit_lots cl where cl.transaction_id=purchase.id for update;
  -- Return unspent credits first. Already expired unused credits are reversed
  -- without debt; only a refunded consumed portion is owed by the photographer.
  balance_reversal := least(reversal,lot.remaining_credits);
  consumed_reversal := least(greatest(0,reversal-balance_reversal-lot.expired_credits),lot.consumed_credits);
  next_balance := greatest(0, account.balance - balance_reversal);
  update public.credit_lots cl set remaining_credits=cl.remaining_credits-balance_reversal,
    expired_credits=cl.expired_credits-least(cl.expired_credits,reversal-balance_reversal),
    consumed_credits=cl.consumed_credits-consumed_reversal,
    refunded_credits=cl.refunded_credits+reversal where cl.id=lot.id;
  debt_payment:=least(next_balance,consumed_reversal);
  update public.credit_lots cl set pending_refund_debt=cl.pending_refund_debt+consumed_reversal where cl.id=lot.id;
  if debt_payment>0 then perform public._consume_credit_lots(purchase.studio_id,debt_payment,null,true); end if;
  next_balance:=next_balance-debt_payment;
  insert into public.credit_transactions(studio_id, photographer_id, type, amount,
    credits_delta, credit_transaction_type, balance_after, description, source,
    source_reference_id, stripe_payment_intent_id)
    values(purchase.studio_id, purchase.photographer_id, 'refund', -reversal,
      -reversal, 'refund', next_balance, p_description, 'refund',
      p_payment_intent_id || ':refunded:' || p_refunded_amount_cents::text, p_payment_intent_id);
  update public.studio_credits sc set balance = next_balance,
    credit_debt = account.credit_debt + consumed_reversal-debt_payment,
    updated_at = now() where sc.id = account.id;
  return query select true, next_balance, -reversal, purchase.studio_id, purchase.photographer_id;
end $$;
revoke all on function public.reverse_credit_purchase(text,integer,integer,text) from public, anon, authenticated;
grant execute on function public.reverse_credit_purchase(text,integer,integer,text) to service_role;

-- The updated desktop uses these authenticated operations. A client cannot
-- choose another photographer, mint receipts, or refund more than it reserved.
create or replace function public.deduct_studio_credits(
  p_amount integer,p_operation text,p_method text default null,p_photo_path text default null,
  p_description text default null,p_billing_reference text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare studio uuid:=auth.uid(); photographer uuid; owner boolean; cost integer; unit_cost integer;
  account public.studio_credits; previous public.credit_transactions; receipt_id uuid;
begin
  if studio is null or nullif(p_billing_reference,'') is null or p_amount is null or p_amount<0 then
    raise exception 'Authenticated credit reservation and reference required'; end if;
  select p.id,p.is_platform_admin into photographer,owner from public.photographers p where p.user_id=studio;
  if photographer is null then raise exception 'Photographer account required'; end if;
  unit_cost:=case p_operation when 'bg_removal_local' then 1 when 'bg_removal_cloud' then 4 when 'skin_retouch' then 4 when 'auto_enhance' then 0 else null end;
  if unit_cost is null or (unit_cost>0 and (p_amount%unit_cost<>0 or (p_amount<=0 and not(owner and p_operation='bg_removal_local')))) then raise exception 'Invalid AI credit cost'; end if;
  cost:=case when (owner and p_operation='bg_removal_local') or p_operation='auto_enhance' then 0 else p_amount end;
  perform public._prepare_credit_account(studio,photographer);
  perform public._expire_credit_lots(studio);
  select * into strict account from public.studio_credits sc where sc.studio_id=studio for update;
  select * into previous from public.credit_transactions ct where ct.studio_id=studio
    and ct.source='usage' and ct.source_reference_id=p_billing_reference limit 1;
  if found then
    if previous.amount<>-cost or previous.ai_operation is distinct from p_operation or previous.processing_method is distinct from p_method then
      raise exception 'Credit reservation contents changed'; end if;
    return true;
  end if;
  if account.balance<cost or account.credit_debt>0 then return false; end if;
  insert into public.credit_transactions(studio_id,photographer_id,type,amount,credits_delta,credit_transaction_type,
    balance_after,description,source,source_reference_id,ai_operation,processing_method,photo_path)
    values(studio,photographer,'usage',-cost,-cost,'usage',account.balance-cost,p_description,'usage',
      p_billing_reference,p_operation,p_method,coalesce(p_billing_reference,p_photo_path)) returning id into receipt_id;
  if cost>0 then perform public._consume_credit_lots(studio,cost,receipt_id); end if;
  update public.studio_credits sc set balance=account.balance-cost,total_used=account.total_used+cost,updated_at=now() where sc.id=account.id;
  return true;
end $$;
revoke all on function public.deduct_studio_credits(integer,text,text,text,text,text) from public,anon;
grant execute on function public.deduct_studio_credits(integer,text,text,text,text,text) to authenticated;

-- p_amount is the cumulative failed-credit total for this reservation. Replays
-- of a completed refund succeed without issuing a second credit.
create or replace function public._refund_credit_reservation(
  p_studio_id uuid,p_amount integer,p_billing_reference text,p_description text default null,
  p_operation text default null,p_method text default null,p_source text default 'usage'
) returns boolean language plpgsql security definer set search_path = public as $$
declare studio uuid:=p_studio_id; photographer uuid; receipt public.credit_transactions;
  account public.studio_credits; allocation record; outstanding integer; prior integer;
  requested integer; restore integer; returned integer:=0; debt_payment integer; available integer;
  cancelled_debt integer:=0; restored_lot record;
begin
  if studio is null or p_amount is null or p_amount<0 or nullif(p_billing_reference,'') is null then raise exception 'Invalid processing refund'; end if;
  select p.id into photographer from public.photographers p where p.user_id=studio;
  perform public._prepare_credit_account(studio,photographer);
  perform public._expire_credit_lots(studio);
  select * into strict account from public.studio_credits sc where sc.studio_id=studio for update;
  select * into receipt from public.credit_transactions ct where ct.studio_id=studio and ct.type='usage'
    and ct.source=p_source and ct.source_reference_id=p_billing_reference limit 1;
  if not found or p_amount>-receipt.amount then return false; end if;
  if exists(select 1 from public.credit_transactions ct where ct.studio_id=studio
      and ct.photo_path=p_billing_reference and ct.processing_method='photoshop_final') then return false; end if;
  select coalesce(sum(cua.refunded_credits),0)::integer into prior from public.credit_usage_allocations cua where cua.transaction_id=receipt.id;
  outstanding:=greatest(0,p_amount-prior);
  if outstanding=0 then return true; end if;
  requested:=outstanding;
  for allocation in select cua.*,cl.consumed_credits,cl.expires_at,cl.pending_refund_debt from public.credit_usage_allocations cua
      join public.credit_lots cl on cl.id=cua.lot_id where cua.transaction_id=receipt.id
      and cua.credits>cua.refunded_credits order by cl.expires_at nulls last,cl.created_at,cl.id for update of cua,cl loop
    available:=least(outstanding,allocation.credits-allocation.refunded_credits);
    select * into restored_lot from public._restore_consumed_credit_lot(allocation.lot_id,available);
    returned:=returned+restored_lot.restored;
    cancelled_debt:=cancelled_debt+restored_lot.cancelled_debt;
    update public.credit_usage_allocations cua set refunded_credits=cua.refunded_credits+available
      where cua.transaction_id=allocation.transaction_id and cua.lot_id=allocation.lot_id;
    outstanding:=outstanding-available;
    exit when outstanding=0;
  end loop;
  if outstanding>0 then raise exception 'Credit refund has no verified reservation'; end if;
  debt_payment:=least(greatest(0,account.credit_debt-cancelled_debt),returned);
  if debt_payment>0 then
    perform public._consume_credit_lots(studio,debt_payment,null,true);
  end if;
  insert into public.credit_transactions(studio_id,photographer_id,type,amount,credits_delta,credit_transaction_type,
    balance_after,description,source,source_reference_id,ai_operation,processing_method,photo_path)
    values(studio,photographer,'refund',returned,returned,'refund',account.balance+returned-debt_payment,
      p_description,case when p_source='usage' then 'processing_refund' else p_source||'_refund' end,p_billing_reference||':refunded:'||p_amount::text,coalesce(p_operation,receipt.ai_operation),
      coalesce(p_method,case when receipt.processing_method='photoshop_reservation' then 'photoshop_refund' else 'processing_refund' end),p_billing_reference);
  update public.studio_credits sc set balance=account.balance+returned-debt_payment,credit_debt=greatest(0,account.credit_debt-debt_payment-cancelled_debt),
    total_used=greatest(0,account.total_used-requested),updated_at=now() where sc.id=account.id;
  return true;
end $$;
revoke all on function public._refund_credit_reservation(uuid,integer,text,text,text,text,text) from public,anon,authenticated;

create or replace function public.refund_studio_credits(
  p_amount integer,p_billing_reference text,p_description text default null,
  p_operation text default null,p_method text default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return public._refund_credit_reservation(auth.uid(),p_amount,p_billing_reference,p_description,p_operation,p_method,'usage');
end $$;
revoke all on function public.refund_studio_credits(integer,text,text,text,text) from public,anon;
grant execute on function public.refund_studio_credits(integer,text,text,text,text) to authenticated;

create or replace function public.finalize_background_credit_job(p_billing_reference text,p_description text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare studio uuid:=auth.uid(); account public.studio_credits; receipt public.credit_transactions;
begin
  if studio is null or nullif(p_billing_reference,'') is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(studio::text,3001));
  select * into account from public.studio_credits sc where sc.studio_id=studio for update;
  select * into receipt from public.credit_transactions ct where ct.studio_id=studio and ct.type='usage'
    and ct.photo_path=p_billing_reference and ct.processing_method='photoshop_reservation' limit 1;
  if not found then return false; end if;
  if exists(select 1 from public.credit_transactions ct where ct.studio_id=studio
      and ct.photo_path=p_billing_reference and ct.processing_method='photoshop_final') then return true; end if;
  insert into public.credit_transactions(studio_id,photographer_id,type,amount,credits_delta,credit_transaction_type,
    balance_after,description,source,ai_operation,processing_method,photo_path)
    values(studio,account.photographer_id,'usage',0,0,'usage',account.balance,p_description,
      'usage','bg_removal_local','photoshop_final',p_billing_reference);
  return true;
end $$;
revoke all on function public.finalize_background_credit_job(text,text) from public,anon;
grant execute on function public.finalize_background_credit_job(text,text) to authenticated;

-- The old ALL policies OR-ed with the later restrictions, allowing free-credit
-- minting. Remove every write policy, including future unknown legacy names.
-- Roll this migration out with the updated desktop credit RPC client.
do $$ declare policy record; begin
  for policy in select policyname,tablename from pg_policies
    where schemaname='public' and tablename in ('studio_credits','credit_transactions') and cmd<>'SELECT' loop
    execute format('drop policy %I on public.%I',policy.policyname,policy.tablename);
  end loop;
end $$;
alter table public.studio_credits enable row level security;
alter table public.credit_transactions enable row level security;
revoke insert,update,delete on public.studio_credits,public.credit_transactions from anon,authenticated;
grant select on public.studio_credits,public.credit_transactions to authenticated;
drop policy if exists "Users can read own credits" on public.studio_credits;
create policy "Users can read own credits" on public.studio_credits for select to authenticated using(studio_id=auth.uid());
drop policy if exists "Users can read own transactions" on public.credit_transactions;
create policy "Users can read own transactions" on public.credit_transactions for select to authenticated using(studio_id=auth.uid());

-- Set the first future deadline during rollout, even for accounts whose next
-- visit is months away. Do not expire any existing balance during bootstrap.
do $$ declare account record; begin
  for account in select sc.studio_id,p.id as photographer_id from public.studio_credits sc
      join public.photographers p on p.user_id=sc.studio_id loop
    perform public._prepare_credit_account(account.studio_id,account.photographer_id);
  end loop;
end $$;

commit;
