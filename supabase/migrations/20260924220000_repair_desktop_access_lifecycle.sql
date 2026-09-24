-- One transactional key lifecycle for website activation and the shipped desktop RPC.
-- This migration changes functions only; it does not reset any customer trial/device.
create or replace function public.sync_photography_keys(p_photographer_id uuid)
returns setof public.photography_keys
language plpgsql security definer set search_path = '' as $$
declare
  p public.photographers%rowtype;
  v_key public.photography_keys%rowtype;
  v_allowed integer := 0;
  v_included integer := 0;
  v_index integer := 0;
  v_slot integer;
  v_code text;
  v_status text;
begin
  -- Every key writer takes the account lock before locking individual keys.
  select * into strict p from public.photographers where id = p_photographer_id for update;
  if p.is_platform_admin then
    v_allowed := 4; v_included := 2;
  elsif lower(btrim(p.subscription_status)) = 'trial' and p.trial_ends_at > now() then
    v_allowed := 2; v_included := 2;
  elsif lower(btrim(p.subscription_status)) in ('active', 'trialing') then
    v_included := case lower(btrim(p.subscription_plan_code)) when 'core' then 1 when 'studio' then 2 else 0 end;
    v_allowed := v_included + case when v_included = 2 then greatest(0, coalesce(p.extra_desktop_keys, 0)) else 0 end;
  end if;

  -- Keep stable slots, codes and custom labels, including gaps left by revocation.
  for v_key in select * from public.photography_keys where photographer_id = p.id and status <> 'revoked' order by slot_index, id for update loop
    v_index := v_index + 1;
    v_status := case when v_index <= v_allowed then 'active' else 'suspended' end;
    if v_key.status <> v_status or v_key.is_extra_key <> (v_index > v_included) then
      update public.photography_keys set status = v_status, is_extra_key = v_index > v_included, updated_at = now() where id = v_key.id;
    end if;
  end loop;
  while v_index < v_allowed loop
    select coalesce(max(slot_index), 0) + 1 into v_slot from public.photography_keys where photographer_id = p.id;
    v_code := upper(replace(gen_random_uuid()::text, '-', ''));
    insert into public.photography_keys (photographer_id, slot_index, label, key_code, is_extra_key)
    values (p.id, v_slot, 'Photography Key ' || v_slot, 'SOK-' || v_code, v_index + 1 > v_included);
    v_index := v_index + 1;
  end loop;

  update public.photography_key_activations a set status = 'deactivated', deactivated_at = now(), updated_at = now()
  from public.photography_keys k where a.photography_key_id = k.id and k.photographer_id = p.id
    and k.status <> 'active' and a.status = 'active';
  return query select * from public.photography_keys where photographer_id = p.id and status <> 'revoked' order by slot_index, id;
end;
$$;

create or replace function public.activate_photography_key(
  p_key_id uuid, p_device_id text, p_device_name text default null,
  p_platform text default null, p_app_version text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_photographer_id uuid;
  v_key public.photography_keys%rowtype;
  v_active public.photography_key_activations%rowtype;
  v_device text := nullif(btrim(p_device_id), '');
begin
  if v_device is null then raise exception 'Device ID is required to activate this Photography Key.'; end if;
  select photographer_id into strict v_photographer_id from public.photography_keys where id = p_key_id;
  perform public.sync_photography_keys(v_photographer_id);
  select * into strict v_key from public.photography_keys where id = p_key_id for update;
  if v_key.status <> 'active' then raise exception 'This Photography Key is not currently active.'; end if;
  select * into v_active from public.photography_key_activations where photography_key_id = p_key_id and status = 'active' for update;
  if found and v_active.device_id <> v_device then
    raise exception 'This Photography Key is already activated on another device.';
  end if;
  insert into public.photography_key_activations (photography_key_id, device_id, device_name, platform, app_version)
  values (p_key_id, v_device, nullif(btrim(p_device_name), ''), nullif(btrim(p_platform), ''), nullif(btrim(p_app_version), ''))
  on conflict (photography_key_id, device_id) do update set
    status = 'active', deactivated_at = null,
    activated_at = case when photography_key_activations.status = 'active' then photography_key_activations.activated_at else now() end,
    device_name = coalesce(excluded.device_name, photography_key_activations.device_name),
    platform = coalesce(excluded.platform, photography_key_activations.platform),
    app_version = coalesce(excluded.app_version, photography_key_activations.app_version),
    last_validated_at = now(), updated_at = now();
  update public.photography_keys set last_activated_at = now(), last_validated_at = now(), updated_at = now() where id = p_key_id;
end;
$$;

create or replace function public.claim_desktop_app_access(
  p_device_id text, p_device_name text default null, p_platform text default null, p_app_version text default null
) returns table(allowed boolean, reason text, plan text, seat_limit integer, active_device_count integer, is_admin boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  p public.photographers%rowtype;
  v_device text := nullif(btrim(p_device_id), '');
  v_key_id uuid;
  v_limit integer;
  v_count integer;
  v_plan text;
  v_admin boolean;
  v_scope text;
begin
  if v_uid is null then
    return query select false, 'Please sign in again.'::text, null::text, 0, 0, false; return;
  end if;
  if v_device is null then
    return query select false, 'This device could not be registered. Please try again.'::text, null::text, 0, 0, false; return;
  end if;
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
    return query select false, 'Please confirm your email before signing in.'::text, null::text, 0, 0, false; return;
  end if;

  -- Direct desktop sign-in must work even before the first website visit.
  perform public.initialize_photographer_trial(v_uid);
  select * into strict p from public.photographers where user_id = v_uid for update;
  v_admin := p.is_platform_admin or exists (select 1 from public.subscriptions s where s.user_id = v_uid and s.is_admin);
  v_plan := case when v_admin or (p.subscription_status = 'trial' and p.trial_ends_at > now()) then 'studio' else p.subscription_plan_code end;
  -- Photographer billing/trial state is canonical; a stale legacy subscription
  -- cannot block a valid trial or revive a canceled account.
  perform public.sync_photography_keys(p.id);
  select count(*)::integer into v_limit from public.photography_keys where photographer_id = p.id and status = 'active';
  select count(*)::integer into v_count from public.photography_key_activations a join public.photography_keys k on k.id = a.photography_key_id
    where k.photographer_id = p.id and k.status = 'active' and a.status = 'active';
  if v_limit = 0 and not v_admin then
    return query select false, 'No active desktop access. Check your trial or subscription in Membership at studiooscloud.com.'::text, v_plan, 0, 0, false; return;
  end if;

  select k.id into v_key_id from public.photography_keys k
    left join public.photography_key_activations a on a.photography_key_id = k.id and a.status = 'active'
    where k.photographer_id = p.id and k.status = 'active' and (a.id is null or a.device_id = v_device)
    order by (a.device_id = v_device) desc nulls last, k.slot_index limit 1;
  if v_key_id is null and not v_admin then
    return query select false, format('All %s Photography Keys are in use. Sign out on another device or deactivate it in Membership.', v_limit), v_plan, v_limit, v_count, false; return;
  end if;
  if v_key_id is not null then
    perform public.activate_photography_key(v_key_id, v_device, p_device_name, p_platform, p_app_version);
  end if;

  v_scope := case when p.studio_id is null then 'user:' || v_uid::text else 'studio:' || p.studio_id::text end;
  insert into public.desktop_app_device_registrations(scope_key, user_id, studio_id, device_id, device_name, platform, app_version)
  values (v_scope, v_uid, p.studio_id, v_device, coalesce(nullif(btrim(p_device_name), ''), 'Unnamed device'), nullif(btrim(p_platform), ''), nullif(btrim(p_app_version), ''))
  on conflict (scope_key, device_id) do update set user_id = excluded.user_id, studio_id = excluded.studio_id,
    device_name = excluded.device_name, platform = excluded.platform, app_version = excluded.app_version,
    released_at = null, last_seen_at = now(), updated_at = now();
  select count(*)::integer into v_count from public.photography_key_activations a join public.photography_keys k on k.id = a.photography_key_id
    where k.photographer_id = p.id and k.status = 'active' and a.status = 'active';
  -- Preserve the existing owner bypass; ordinary accounts use the actual key allowance.
  return query select true, null::text, v_plan, case when v_admin then null::integer else v_limit end,
    case when v_admin then null::integer else v_count end, v_admin;
end;
$$;

create or replace function public.release_desktop_app_access(p_device_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_device text := nullif(btrim(p_device_id), '');
  v_photographer_id uuid;
  v_changed boolean := false;
begin
  if v_uid is null or v_device is null then return false; end if;
  select id into v_photographer_id from public.photographers where user_id = v_uid for update;
  update public.photography_key_activations a set status = 'deactivated', deactivated_at = now(), updated_at = now()
    from public.photography_keys k where k.id = a.photography_key_id and k.photographer_id = v_photographer_id
      and a.device_id = v_device and a.status = 'active';
  v_changed := found;
  update public.desktop_app_device_registrations set released_at = now(), updated_at = now()
    where user_id = v_uid and device_id = v_device and released_at is null;
  return v_changed or found;
end;
$$;

revoke all on function public.sync_photography_keys(uuid) from public, anon, authenticated;
revoke all on function public.activate_photography_key(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.sync_photography_keys(uuid), public.activate_photography_key(uuid,text,text,text,text) to service_role;
revoke all on function public.claim_desktop_app_access(text,text,text,text), public.release_desktop_app_access(text) from public, anon;
grant execute on function public.claim_desktop_app_access(text,text,text,text), public.release_desktop_app_access(text) to authenticated, service_role;
