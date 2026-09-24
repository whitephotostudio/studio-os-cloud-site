-- Cross-account support is available only through owner-authorized server routes.
create table public.owner_support_notes (
  id uuid primary key,
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  author_user_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.owner_support_notes enable row level security;
revoke all on public.owner_support_notes from public, anon, authenticated;
grant select, insert on public.owner_support_notes to service_role;
create index owner_support_notes_account_time on public.owner_support_notes(photographer_id, created_at desc, id);
create index if not exists schools_owner_overview_idx on public.schools(photographer_id, created_at);
create index if not exists photos_owner_overview_idx on public.photos(student_id, created_at);
create index if not exists refund_email_owner_overview_idx on public.order_refund_emails(photographer_id, created_at desc);
create index if not exists project_email_owner_overview_idx on public.project_email_deliveries(photographer_id, created_at desc);
create index if not exists stripe_events_owner_overview_idx on public.stripe_events(event_type, processed_at desc);
create index if not exists audit_actor_user_owner_overview_idx on public.audit_log(actor_user_id, occurred_at desc);

-- Keep release history even when the same device is registered again later.
create function public.owner_record_device_release() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.released_at is not null and new.released_at is distinct from old.released_at then
    insert into public.audit_log(id,occurred_at,actor_user_id,target_photographer_id,action,entity_type,entity_id,result)
    select gen_random_uuid(),new.released_at,new.user_id,p.id,'device.release','desktop_registration',new.id::text,'ok'
      from public.photographers p where p.user_id=new.user_id;
  end if;
  return new;
end $$;
revoke all on function public.owner_record_device_release() from public,anon,authenticated;
create trigger owner_device_release_history after update of released_at on public.desktop_app_device_registrations
  for each row execute function public.owner_record_device_release();

create function public.owner_overview_snapshot(p_actor uuid, p_page integer default 0, p_search text default '', p_attention boolean default false)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '8s' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.photographers where user_id = p_actor and is_platform_admin) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  if p_page < 0 or p_page > 10000 or length(p_search) > 120 then raise exception 'Invalid page or search'; end if;
  with base as materialized (
    select p.id, p.user_id, p.business_name, coalesce(nullif(u.raw_user_meta_data->>'full_name',''),p.business_name,'Photographer') as name,
      coalesce(u.email,p.billing_email,p.studio_email) as email, p.is_platform_admin as is_owner,
      p.subscription_status, p.subscription_plan_code, p.stripe_subscription_id is not null as has_subscription,
      p.trial_starts_at, p.trial_ends_at, p.created_at at time zone 'UTC' as created_at,
      u.email_confirmed_at, u.last_sign_in_at, u.id is null as auth_missing,
      (not p.is_platform_admin and u.email_confirmed_at is not null and p.stripe_subscription_id is null
        and coalesce(p.subscription_status,'trial') = 'trial'
        and (p.subscription_plan_code is null or p.trial_starts_at is null or p.trial_ends_at is null)) as signup_incomplete,
      coalesce(p.subscription_status in ('past_due','unpaid','incomplete','incomplete_expired'),false) as billing_problem,
      (select count(*) from public.order_refund_emails e where e.photographer_id = p.id and
        (e.status = 'needs_review' or (e.status <> 'sent' and e.created_at < now()-interval '30 minutes'))) +
      (select count(*) from public.crm_email_outbox e where e.photographer_id = p.id and e.status in ('failed','retry')) +
      (select count(*) from public.project_email_deliveries e where e.photographer_id = p.id and e.status = 'failed') as email_problems,
      (select count(*) from public.orders o where o.photographer_id=p.id and not coalesce(o.is_test,false)
        and (o.payment_status in ('failed','payment_failed') or o.refund_status in ('failed','needs_review')
          or (o.status = 'refund_pending' and o.updated_at < now()-interval '30 minutes'))) as payment_problems,
      (select count(*) from public.audit_log a where (a.target_photographer_id=p.id or a.actor_photographer_id=p.id or a.actor_user_id=p.user_id)
        and a.occurred_at >= now()-interval '7 days' and a.result='error') as recent_errors
    from public.photographers p left join auth.users u on u.id=p.user_id
  ), flagged as materialized (
    select *, (auth_missing or signup_incomplete or billing_problem or email_problems>0 or payment_problems>0 or recent_errors>0) as needs_attention from base
  ), filtered as materialized (
    select * from flagged where (not p_attention or needs_attention)
      and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',id::text,name,business_name,email)))>0)
  ), page as (
    select * from filtered order by needs_attention desc, created_at desc, id limit 25 offset p_page*25
  ), enriched as (
    select p.*, keys.available_keys, devices.active_devices, devices.last_device_seen, activation.first_activation_at,
      galleries.gallery_count, galleries.first_gallery_at, photos.photo_records, photos.first_photo_at, photos.last_photo_at,
      roster.last_roster_sync_at, orders.order_count
    from page p
    cross join lateral (select count(*) filter(where k.status='active') as available_keys from public.photography_keys k where k.photographer_id=p.id) keys
    cross join lateral (
      select count(distinct d.device_id) as active_devices,max(d.last_seen) as last_device_seen from (
        select a.device_id,a.last_validated_at as last_seen from public.photography_key_activations a
          join public.photography_keys k on k.id=a.photography_key_id where k.photographer_id=p.id and k.status='active' and a.status='active'
        union all select d.device_id,d.last_seen_at from public.desktop_app_device_registrations d where d.user_id=p.user_id and d.released_at is null
      ) d
    ) devices
    cross join lateral (select min(first_at) as first_activation_at from (
      select a.activated_at as first_at from public.photography_key_activations a
        join public.photography_keys k on k.id=a.photography_key_id where k.photographer_id=p.id
      union all select d.first_seen_at from public.desktop_app_device_registrations d where d.user_id=p.user_id
    ) activated) activation
    cross join lateral (select count(*) as gallery_count,min(g.created_at) as first_gallery_at from (
      select s.created_at at time zone 'UTC' as created_at from public.schools s where s.photographer_id=p.id
      union all select pr.created_at from public.projects pr where pr.photographer_id=p.id and pr.linked_school_id is null
    ) g) galleries
    cross join lateral (select coalesce(sum(n),0) as photo_records,min(first_at) as first_photo_at,max(last_at) as last_photo_at from (
      select count(*) n,min(m.created_at) first_at,max(m.created_at) last_at from public.media m
        join public.projects pr on pr.id=m.project_id where pr.photographer_id=p.id
      union all select count(*),min(ph.created_at) at time zone 'UTC',max(ph.created_at) at time zone 'UTC' from public.photos ph
        join public.students st on st.id=ph.student_id join public.schools s on s.id=st.school_id where s.photographer_id=p.id
    ) counts) photos
    cross join lateral (select max(r.created_at) as last_roster_sync_at from public.school_roster_snapshots r
      join public.schools s on s.id=r.school_id where s.photographer_id=p.id) roster
    cross join lateral (select count(*) as order_count from public.orders o where o.photographer_id=p.id and not coalesce(o.is_test,false)) orders
  ), invoices as (
    -- Dedupe the invoice, not the webhook delivery. Platform invoices only.
    select distinct on (e.payload#>>'{data,object,id}') e.payload#>'{data,object}' as invoice
    from public.stripe_events e where e.event_type='invoice.paid' and e.livemode and e.stripe_account is null
      and e.processed_at >= now()-interval '30 days'
      and coalesce(e.payload#>>'{data,object,subscription}',e.payload#>>'{data,object,parent,subscription_details,subscription}') is not null
      and e.payload#>>'{data,object,id}' is not null
    order by e.payload#>>'{data,object,id}',e.processed_at desc
  ), revenue as (
    select upper(invoice->>'currency') as currency,sum((invoice->>'amount_paid')::bigint) as amount_cents,count(*) as invoices
    from invoices where (invoice->>'amount_paid') ~ '^[0-9]+$' and invoice->>'currency' is not null group by invoice->>'currency'
  )
  select jsonb_build_object('checked_at',now(),'page',p_page,'page_size',25,'total',(select count(*) from filtered),
    'summary',(select jsonb_build_object('accounts',count(*),'needs_attention',count(*) filter(where needs_attention),
      'active_trials',count(*) filter(where not is_owner and not has_subscription and subscription_status='trial' and trial_ends_at>now()),
      'active_subscriptions',count(*) filter(where not is_owner and has_subscription and subscription_status in ('active','trialing'))) from flagged),
    'accounts',coalesce((select jsonb_agg(to_jsonb(e)-'user_id' order by e.needs_attention desc,e.created_at desc,e.id) from enriched e),'[]'::jsonb),
    'subscription_receipts',coalesce((select jsonb_agg(to_jsonb(r)) from revenue r),'[]'::jsonb),
    'unlinked_confirmed_accounts',(select count(*) from auth.users u where u.email_confirmed_at is not null and not exists(select 1 from public.photographers p where p.user_id=u.id)),
    'unlinked_accounts',coalesce((select jsonb_agg(to_jsonb(m)) from (
      select u.email,coalesce(u.raw_user_meta_data->>'full_name','Unnamed account') as name,u.email_confirmed_at
      from auth.users u where u.email_confirmed_at is not null and not exists(select 1 from public.photographers p where p.user_id=u.id)
      order by u.email_confirmed_at desc,u.id limit 25
    ) m),'[]'::jsonb)) into result;
  return result;
end $$;

create function public.owner_account_history(p_actor uuid, p_photographer uuid, p_page integer default 0)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '8s' as $$
declare result jsonb; account_user uuid;
begin
  if not exists(select 1 from public.photographers where user_id=p_actor and is_platform_admin) then
    raise exception 'Owner access required' using errcode='42501';
  end if;
  select user_id into account_user from public.photographers where id=p_photographer;
  if not found then raise exception 'Account not found' using errcode='P0002'; end if;
  if p_page<0 or p_page>10000 then raise exception 'Invalid page'; end if;
  with events as (
    select 'audit:'||a.id as id,a.occurred_at as at,'audit'::text as kind,a.action as title,a.result as state,
      null::text as recipient,null::text as author,
      case when a.action in ('admin.extend_trial','admin.revoke_trial','trial.onboarding_recovery_20260924')
        then 'Trial ends: '||coalesce(a.after->>'trial_ends_at','See account details') else null end as detail
    from public.audit_log a where (a.target_photographer_id=p_photographer or a.actor_photographer_id=p_photographer or a.actor_user_id=account_user)
      and a.action <> 'trial.recovery_email_20260924'
    union all
    select 'note:'||n.id,n.created_at,'note','Owner support note','saved',null,
      coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Owner'),n.body
    from public.owner_support_notes n left join auth.users u on u.id=n.author_user_id where n.photographer_id=p_photographer
    union all
    select 'refund-email:'||e.id,coalesce(e.sent_at,e.created_at),'email','Refund confirmation · '||e.audience,e.status,e.payload->>'to',null,
      case when e.status='sent' then 'Accepted by email provider; delivery not recorded.' when e.status='needs_review' then 'Check the provider before retrying.' else 'Notification is waiting to send.' end
    from public.order_refund_emails e where e.photographer_id=p_photographer
    union all
    select 'project-email:'||e.id,coalesce(e.sent_at,e.created_at),'email',e.email_type,e.status,e.recipient_email,null,
      case when e.status='sent' then 'Accepted by email provider; delivery not recorded.' else 'Check notification status.' end
    from public.project_email_deliveries e where e.photographer_id=p_photographer
    union all
    select 'crm-email:'||e.id,coalesce(e.sent_at,e.created_at),'email',e.subject,coalesce(delivery.event_type,e.status),e.to_email,null,
      case when delivery.event_type is not null then 'Provider event received: '||delivery.occurred_at::text
        when e.status='sent' then 'Accepted by email provider; delivery not recorded.' else 'CRM email status.' end
    from public.crm_email_outbox e left join lateral (
      select ev.event_type,ev.occurred_at from public.crm_email_events ev where ev.outbox_id=e.id and ev.photographer_id=p_photographer
        and ev.event_type in ('delivered','bounced','complained','opened','clicked') order by ev.occurred_at desc,ev.id limit 1
    ) delivery on true where e.photographer_id=p_photographer
    union all
    select 'trial-email:'||a.id,a.occurred_at,'email','Trial refreshed confirmation',coalesce(a.metadata->>'state',a.result),a.metadata#>>'{payload,to}',null,
      'Historical trial notification; delivery not recorded in this timeline.'
    from public.audit_log a where a.target_photographer_id=p_photographer and a.action='trial.recovery_email_20260924'
    union all
    select 'payment-issue:'||o.id,o.updated_at,'payment','Order '||left(o.id::text,8),
      concat_ws(' / ',o.payment_status,o.refund_status,o.status),null,null,'Review this order and its payment in Stripe before retrying.'
    from public.orders o where o.photographer_id=p_photographer and not coalesce(o.is_test,false)
      and (o.payment_status in ('failed','payment_failed') or o.refund_status in ('failed','needs_review')
        or (o.status='refund_pending' and o.updated_at<now()-interval '30 minutes'))
    union all
    select 'device-release:'||d.id,d.released_at,'device','Desktop device released','released',null,null,d.device_name
    from public.desktop_app_device_registrations d where d.user_id=account_user and d.released_at is not null
      and not exists(select 1 from public.audit_log a where a.action='device.release' and a.entity_id=d.id::text and a.occurred_at=d.released_at)
  ), entries as (select * from events order by at desc,id limit 26 offset p_page*25),
  devices as (
    select distinct on (device_id) device_id,device_name,platform,app_version,last_seen_at from (
      select d.device_id,d.device_name,d.platform,d.app_version,d.last_seen_at from public.desktop_app_device_registrations d where d.user_id=account_user and d.released_at is null
      union all select a.device_id,a.device_name,a.platform,a.app_version,a.last_validated_at from public.photography_key_activations a
        join public.photography_keys k on k.id=a.photography_key_id where k.photographer_id=p_photographer and k.status='active' and a.status='active'
    ) d order by device_id,last_seen_at desc nulls last
  ), recent_devices as (select device_name,platform,app_version,last_seen_at from devices order by last_seen_at desc nulls last limit 20),
  sales as (
    select upper(coalesce(o.currency,'UNKNOWN')) as currency,
      count(*) filter(where o.paid_at is not null) as paid_orders,
      coalesce(sum(coalesce(o.total_cents,round(o.total_amount*100)::bigint)) filter(where o.paid_at is not null),0) as paid_cents,
      coalesce(sum(o.refund_amount_cents) filter(where o.refund_status in ('refunded','partially_refunded')),0) as refunded_cents,
      count(*) filter(where o.status in ('refund_pending','cancel_pending')) as pending_adjustments
    from public.orders o where o.photographer_id=p_photographer and not coalesce(o.is_test,false) group by upper(coalesce(o.currency,'UNKNOWN'))
  )
  select jsonb_build_object('checked_at',now(),'page',p_page,'has_more',(select count(*)>25 from entries),
    'entries',coalesce((select jsonb_agg(to_jsonb(e) order by at desc,id) from (select * from entries order by at desc,id limit 25) e),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(to_jsonb(d)) from recent_devices d),'[]'::jsonb),
    'sales',coalesce((select jsonb_agg(to_jsonb(s)) from sales s),'[]'::jsonb)) into result;
  return result;
end $$;

create function public.owner_add_support_note(p_actor uuid,p_photographer uuid,p_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare existing public.owner_support_notes; owner_id uuid;
begin
  select id into owner_id from public.photographers where user_id=p_actor and is_platform_admin for share;
  if not found then raise exception 'Owner access required' using errcode='42501'; end if;
  if length(btrim(p_body)) not between 1 and 2000 or p_body is null then raise exception 'Invalid note'; end if;
  insert into public.owner_support_notes(id,photographer_id,author_user_id,body) values(p_id,p_photographer,p_actor,btrim(p_body)) on conflict(id) do nothing;
  select * into existing from public.owner_support_notes where id=p_id;
  if existing.photographer_id<>p_photographer or existing.author_user_id<>p_actor or existing.body<>btrim(p_body) then
    raise exception 'Note request changed' using errcode='23505';
  end if;
  return p_id;
end $$;

revoke all on function public.owner_overview_snapshot(uuid,integer,text,boolean) from public,anon,authenticated;
revoke all on function public.owner_account_history(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.owner_add_support_note(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.owner_overview_snapshot(uuid,integer,text,boolean) to service_role;
grant execute on function public.owner_account_history(uuid,uuid,integer) to service_role;
grant execute on function public.owner_add_support_note(uuid,uuid,uuid,text) to service_role;
