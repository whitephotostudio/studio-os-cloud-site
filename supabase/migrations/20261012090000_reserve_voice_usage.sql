-- Atomically authorize and reserve platform-funded TTS without retaining text/audio.
begin;

create table public.voice_usage_reservations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  period_start timestamptz not null,
  character_count integer not null check (character_count between 1 and 400),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  released_at timestamptz
);
create index voice_usage_reservations_photographer_idx
  on public.voice_usage_reservations(photographer_id, created_at);
alter table public.voice_usage_reservations enable row level security;
revoke all on public.voice_usage_reservations from public, anon, authenticated, service_role;
grant select on public.voice_usage_reservations to service_role;

create function public.reserve_voice_usage(p_photographer_id uuid, p_character_count integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_photographer public.photographers%rowtype;
  v_now timestamptz;
  v_period timestamptz;
  v_used integer;
  v_limit integer;
  v_reservation_id uuid;
begin
  if p_photographer_id is null or p_character_count is null or p_character_count not between 1 and 400 then
    raise exception 'Invalid voice reservation.' using errcode = '22023';
  end if;
  -- Both routines lock photographer first. Read entitlement and the UTC month
  -- only after acquiring that lock, including requests queued across midnight.
  select * into v_photographer from public.photographers
    where id = p_photographer_id for update;
  if not found then
    raise exception 'Voice account unavailable.' using errcode = 'P0002';
  end if;
  if v_photographer.is_platform_admin then
    return pg_catalog.jsonb_build_object('status', 'admin', 'photographer_id', p_photographer_id,
      'character_count', p_character_count, 'reservation_id', null);
  end if;
  if not v_photographer.voice_premium_enabled then
    return pg_catalog.jsonb_build_object('status', 'disabled', 'photographer_id', p_photographer_id,
      'character_count', p_character_count, 'reservation_id', null);
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_period := v_photographer.voice_usage_period_start;
  v_used := v_photographer.voice_chars_used_this_month;
  v_limit := v_photographer.voice_monthly_char_limit;
  if v_period is null or not pg_catalog.isfinite(v_period) or v_used is null or v_used < 0 or v_limit is null or v_limit < 0 then
    raise exception 'Voice accounting unavailable.' using errcode = '22023';
  end if;
  if pg_catalog.date_trunc('month', v_period at time zone 'UTC') <>
      pg_catalog.date_trunc('month', v_now at time zone 'UTC') then
    v_period := v_now;
    v_used := 0;
  end if;
  if v_limit = 0 or v_used > v_limit - p_character_count then
    return pg_catalog.jsonb_build_object('status', 'limit', 'photographer_id', p_photographer_id,
      'character_count', p_character_count, 'reservation_id', null,
      'used_this_month', v_used, 'monthly_limit', v_limit);
  end if;

  insert into public.voice_usage_reservations(photographer_id, period_start, character_count)
    values(p_photographer_id, v_period, p_character_count) returning id into v_reservation_id;
  update public.photographers set voice_chars_used_this_month = v_used + p_character_count,
    voice_usage_period_start = v_period where id = p_photographer_id;
  return pg_catalog.jsonb_build_object('status', 'reserved', 'photographer_id', p_photographer_id,
    'character_count', p_character_count, 'reservation_id', v_reservation_id,
    'period_start', v_period, 'used_this_month', v_used + p_character_count, 'monthly_limit', v_limit);
end
$function$;

create function public.release_voice_usage(p_photographer_id uuid, p_reservation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
declare
  v_photographer public.photographers%rowtype;
  v_reservation public.voice_usage_reservations%rowtype;
begin
  -- Same lock order as reservation. No inline cleanup or stale absolute write.
  select * into v_photographer from public.photographers
    where id = p_photographer_id for update;
  if not found then return false; end if;
  select * into v_reservation from public.voice_usage_reservations
    where id = p_reservation_id and photographer_id = p_photographer_id for update;
  if not found or v_reservation.released_at is not null then return false; end if;

  -- An administrator's reset changes the exact period stamp, even within a
  -- month. A late failure must never debit that replacement period's budget.
  if v_photographer.voice_usage_period_start = v_reservation.period_start and
      pg_catalog.date_trunc('month', v_reservation.period_start at time zone 'UTC') =
      pg_catalog.date_trunc('month', pg_catalog.clock_timestamp() at time zone 'UTC') then
    update public.photographers set voice_chars_used_this_month =
      greatest(0, voice_chars_used_this_month - v_reservation.character_count)
      where id = p_photographer_id;
  end if;
  update public.voice_usage_reservations set released_at = pg_catalog.clock_timestamp()
    where id = v_reservation.id;
  return true;
end
$function$;

revoke all on function public.reserve_voice_usage(uuid, integer), public.release_voice_usage(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_voice_usage(uuid, integer), public.release_voice_usage(uuid, uuid)
  to service_role;

-- Unexpected inherited/global defaults must abort this entire migration,
-- rather than silently expose a SECURITY DEFINER budget-changing entry point.
do $privileges$
begin
  if exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid in ('public.reserve_voice_usage(uuid,integer)'::regprocedure, 'public.release_voice_usage(uuid,uuid)'::regprocedure)
      and a.grantee not in (p.proowner, 'service_role'::regrole)
  ) or exists (
    select 1 from (values ('anon'), ('authenticated')) client(role_name)
    where pg_catalog.has_function_privilege(client.role_name, 'public.reserve_voice_usage(uuid,integer)', 'EXECUTE')
      or pg_catalog.has_function_privilege(client.role_name, 'public.release_voice_usage(uuid,uuid)', 'EXECUTE')
      or pg_catalog.has_table_privilege(client.role_name, 'public.voice_usage_reservations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
  ) then
    raise exception 'Unexpected voice accounting privilege; review defaults and role inheritance.';
  end if;
end
$privileges$;
notify pgrst, 'reload schema';
commit;
