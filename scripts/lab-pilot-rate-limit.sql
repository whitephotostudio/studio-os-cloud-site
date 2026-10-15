-- Isolated lab pilot ONLY: apply after verifying the connected project is
-- lgwmxqjwgkzktikhkebp. This is intentionally outside supabase/migrations.
-- No customer/auth/storage/payment tables or provider configuration are changed.
-- Runner MUST verify the actual project, then prepend:
-- SET studio_os.lab_pilot_project_ref='lgwmxqjwgkzktikhkebp';
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$ begin
  if current_setting('studio_os.lab_pilot_project_ref',true) is distinct from 'lgwmxqjwgkzktikhkebp' then
    raise exception 'LAB_PILOT_EXPLICIT_ISOLATED_PROJECT_REQUIRED';
  end if;
  if to_regclass('public.studio_labs') is null then
    raise exception 'LAB_PILOT_LAB_SCHEMA_REQUIRED';
  end if;
end $$;

create schema if not exists lab_pilot;
revoke all on schema lab_pilot from public, anon, authenticated;

create table if not exists lab_pilot.rate_limit_counters (
  key_prefix text not null,
  namespace text not null,
  key_hash bytea not null,
  window_seconds integer not null check (window_seconds between 1 and 31536000),
  window_started_at timestamptz not null,
  reset_at timestamptz not null,
  request_count bigint not null check (request_count > 0),
  primary key (key_prefix, namespace, key_hash, window_seconds),
  check (length(key_prefix) between 1 and 64 and key_prefix !~ '[^a-zA-Z0-9_-]'),
  check (length(namespace) between 1 and 200),
  check (octet_length(key_hash) = 32)
);
alter table lab_pilot.rate_limit_counters enable row level security;
revoke all on lab_pilot.rate_limit_counters from public, anon, authenticated, service_role;

create or replace function public.consume_lab_pilot_rate_limit(
  p_prefix text, p_namespace text, p_key text, p_limit integer, p_window_seconds integer
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_reset timestamptz;
  v_count bigint;
begin
  if p_prefix is null or length(p_prefix) not between 1 and 64 or p_prefix ~ '[^a-zA-Z0-9_-]'
    or p_namespace is null or length(p_namespace) not between 1 and 200
    or p_key is null or length(p_key) not between 1 and 1024
    or p_limit is null or p_limit not between 1 and 1000000
    or p_window_seconds is null or p_window_seconds not between 1 and 31536000 then
    raise exception 'Invalid pilot counter arguments' using errcode = '22023';
  end if;
  v_window := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_reset := v_window + make_interval(secs => p_window_seconds);
  insert into lab_pilot.rate_limit_counters as counters
    (key_prefix, namespace, key_hash, window_seconds, window_started_at, reset_at, request_count)
  values (p_prefix, p_namespace, sha256(convert_to(p_key, 'UTF8')), p_window_seconds, v_window, v_reset, 1)
  on conflict (key_prefix, namespace, key_hash, window_seconds) do update
    set window_started_at = greatest(counters.window_started_at, excluded.window_started_at),
      reset_at = greatest(counters.reset_at, excluded.reset_at),
      request_count = case when counters.window_started_at >= excluded.window_started_at
        then counters.request_count + 1 else 1 end
  returning request_count, reset_at into v_count, v_reset;
  return jsonb_build_object('allowed', v_count <= p_limit,
    'remaining', greatest(0, p_limit::bigint - v_count),
    'resetAt', (extract(epoch from v_reset) * 1000)::bigint);
end;
$$;
revoke all on function public.consume_lab_pilot_rate_limit(text,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_lab_pilot_rate_limit(text,text,text,integer,integer) to service_role;

-- Optional maintenance, run only on this isolated pilot if rows accumulate:
-- delete from lab_pilot.rate_limit_counters where reset_at < now() - interval '1 day';
notify pgrst, 'reload schema';
commit;
