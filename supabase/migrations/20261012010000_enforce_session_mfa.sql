-- Reviewed against the live policy/function catalog on 2026-10-12 UTC.
-- Apply this transaction individually; local and remote migration histories differ.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- No caller-supplied user id: this helper only examines the authenticated caller.
-- The definer can read factor metadata without exposing auth.mfa_factors itself.
create or replace function public.dashboard_session_mfa_allowed(p_allow_admin_setup boolean default false)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  if exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified') then
    return coalesce(auth.jwt()->>'aal'='aal2',false);
  end if;
  -- An owner without an enrolled factor may read their own profile to enroll.
  -- All other owner data and mutations require enrollment, including legacy admins.
  return p_allow_admin_setup or not (
    exists(select 1 from public.photographers p where p.user_id=auth.uid() and p.is_platform_admin)
    or exists(select 1 from public.subscriptions s where s.user_id=auth.uid() and s.is_admin)
  );
end $$;
revoke all on function public.dashboard_session_mfa_allowed(boolean) from public,anon,authenticated;
grant execute on function public.dashboard_session_mfa_allowed(boolean) to authenticated,service_role;

-- RESTRICTIVE is ANDed with existing tenant policies. It never grants access
-- to another studio, and service-role gallery/order endpoints still bypass RLS.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
  loop
    if t.relname='photographers' then
      execute 'create policy "session_mfa_select" on public.photographers as restrictive for select to authenticated using ((select public.dashboard_session_mfa_allowed(true)))';
      execute 'create policy "session_mfa_insert" on public.photographers as restrictive for insert to authenticated with check ((select public.dashboard_session_mfa_allowed(false)))';
      execute 'create policy "session_mfa_update" on public.photographers as restrictive for update to authenticated using ((select public.dashboard_session_mfa_allowed(false))) with check ((select public.dashboard_session_mfa_allowed(false)))';
      execute 'create policy "session_mfa_delete" on public.photographers as restrictive for delete to authenticated using ((select public.dashboard_session_mfa_allowed(false)))';
    else
      execute format('create policy "session_mfa_required" on public.%I as restrictive for all to authenticated using ((select public.dashboard_session_mfa_allowed(false))) with check ((select public.dashboard_session_mfa_allowed(false)))',t.relname);
    end if;
  end loop;
end $$;

-- Intentionally public backdrops/logos remain readable. Tenant/ownership
-- policies must still authorize every write and every private-media read.
create policy "session_mfa_select" on storage.objects as restrictive for select to authenticated
  using (bucket_id in ('backdrops','studio-logos') or (select public.dashboard_session_mfa_allowed(false)));
create policy "session_mfa_insert" on storage.objects as restrictive for insert to authenticated
  with check ((select public.dashboard_session_mfa_allowed(false)));
create policy "session_mfa_update" on storage.objects as restrictive for update to authenticated
  using ((select public.dashboard_session_mfa_allowed(false))) with check ((select public.dashboard_session_mfa_allowed(false)));
create policy "session_mfa_delete" on storage.objects as restrictive for delete to authenticated
  using ((select public.dashboard_session_mfa_allowed(false)));

-- SECURITY DEFINER RPCs bypass RLS, so check MFA at their entry point too.
-- Preserve the live implementation, signature, defaults, volatility and ACLs.
-- The shared sales helper covers all seven exposed SQL sales RPC wrappers.
do $$
declare signature text; routine_oid oid; body text; definition text; guarded_body text;
  guard text := E'\n  if current_setting(''role'',true)=''authenticated'' and not public.dashboard_session_mfa_allowed(false) then\n    raise exception ''Complete two-step verification before accessing studio data.'' using errcode=''42501'';\n  end if;';
begin
  foreach signature in array array[
    'public.claim_desktop_app_access(text,text,text,text)',
    'public.deactivate_photography_key(uuid)',
    'public.deduct_studio_credits(integer,text,text,text,text,text)',
    'public.finalize_background_credit_job(text,text)',
    'public.get_studio_credit_balance(uuid)',
    'public.refund_studio_credits(integer,text,text,text,text)',
    'public.register_studio_cutout_entitlement(text,text,text,uuid)',
    'public.release_desktop_app_access(text)',
    'public._sales_current_photographer_id()'
  ] loop
    routine_oid := to_regprocedure(signature);
    if routine_oid is null then raise exception 'Reviewed MFA routine is missing: %',signature; end if;
    select p.prosrc,pg_get_functiondef(p.oid) into body,definition
      from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid=routine_oid and p.prosecdef and l.lanname='plpgsql';
    if body is null or body !~* E'(^|\n)[ \t]*begin[ \t]*(\n|$)' then
      raise exception 'Reviewed MFA routine structure changed: %',signature;
    end if;
    guarded_body := regexp_replace(body,E'(^|\n)([ \t]*begin[ \t]*)(\n|$)',E'\\1\\2' || guard || E'\\3','i');
    if guarded_body=body then raise exception 'MFA guard was not added: %',signature; end if;
    execute replace(definition,body,guarded_body);
  end loop;
end $$;

-- Pure SQL identity/entitlement helpers cannot leak useful access while MFA
-- is pending. Existing tenant and entitlement predicates remain in place.
create or replace function public._is_admin_user()
returns boolean language sql stable security definer set search_path='' as $$
  select public.dashboard_session_mfa_allowed(false) and coalesce(
    (select s.is_admin from public.subscriptions s where s.user_id=auth.uid() limit 1),false);
$$;
create or replace function public.current_photographer_id()
returns uuid language sql stable security definer set search_path='' as $$
  select p.id from public.photographers p
  where p.user_id=auth.uid() and public.dashboard_session_mfa_allowed(false) limit 1;
$$;
create or replace function public.crm_owns_photographer(p_photographer_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.dashboard_session_mfa_allowed(false) and exists(
    select 1 from public.photographers p where p.id=p_photographer_id and p.user_id=auth.uid());
$$;
create or replace function public.get_studio_cutout_entitlement(p_original_sha256 text,p_cutout_sha256 text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.dashboard_session_mfa_allowed(false)
    and public._has_cutout_entitlement(auth.uid(),p_original_sha256,p_cutout_sha256);
$$;

revoke all on function public._is_admin_user(),public.current_photographer_id(),public.deactivate_photography_key(uuid)
  from public,anon;
grant execute on function public._is_admin_user(),public.current_photographer_id(),public.deactivate_photography_key(uuid)
  to authenticated,service_role;
-- Trigger functions are not callable RPC endpoints; triggers keep executing.
revoke all on function public.handle_new_user(),public.lock_orders_photographer_id() from public,anon,authenticated;

-- Fail closed if an unreviewed elevated client RPC has appeared since audit.
do $$
begin
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and has_function_privilege('authenticated',p.oid,'execute')
      and not (p.oid=any(array[
        'public.dashboard_session_mfa_allowed(boolean)'::regprocedure,
        'public._is_admin_user()'::regprocedure,'public.current_photographer_id()'::regprocedure,
        'public.crm_owns_photographer(uuid)'::regprocedure,'public.get_studio_cutout_entitlement(text,text)'::regprocedure,
        'public.claim_desktop_app_access(text,text,text,text)'::regprocedure,'public.deactivate_photography_key(uuid)'::regprocedure,
        'public.deduct_studio_credits(integer,text,text,text,text,text)'::regprocedure,
        'public.finalize_background_credit_job(text,text)'::regprocedure,'public.get_studio_credit_balance(uuid)'::regprocedure,
        'public.refund_studio_credits(integer,text,text,text,text)'::regprocedure,
        'public.register_studio_cutout_entitlement(text,text,text,uuid)'::regprocedure,'public.release_desktop_app_access(text)'::regprocedure,
        'public.convert_sales_quote(uuid,bigint,text)'::regprocedure,'public.create_sales_document(text,text,jsonb,boolean)'::regprocedure,
        'public.delete_sales_document(uuid,bigint)'::regprocedure,'public.ensure_sales_settings()'::regprocedure,
        'public.transition_sales_document(uuid,bigint,text,timestamptz)'::regprocedure,
        'public.update_sales_document(uuid,bigint,jsonb)'::regprocedure,'public.upsert_sales_settings(bigint,jsonb)'::regprocedure
      ]))) then raise exception 'An unreviewed authenticated SECURITY DEFINER RPC needs an MFA audit'; end if;
end $$;
commit;
