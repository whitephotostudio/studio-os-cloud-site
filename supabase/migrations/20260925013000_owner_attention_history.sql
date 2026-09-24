-- Show current issues separately from paginated historical activity.
create or replace function public.owner_account_history(p_actor uuid, p_photographer uuid, p_page integer default 0)
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
    'attention_entries',coalesce((select jsonb_agg(to_jsonb(e) order by at desc,id) from (
      select * from events where kind='payment' or (state='error' and at>=now()-interval '7 days')
        or (kind='email' and (state in ('failed','retry','needs_review','send_uncertain') or (state in ('pending','sending') and at<now()-interval '30 minutes')))
      order by at desc,id limit 25
    ) e),'[]'::jsonb),
    'entries',coalesce((select jsonb_agg(to_jsonb(e) order by at desc,id) from (select * from entries order by at desc,id limit 25) e),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(to_jsonb(d)) from recent_devices d),'[]'::jsonb),
    'sales',coalesce((select jsonb_agg(to_jsonb(s)) from sales s),'[]'::jsonb)) into result;
  return result;
end $$;
