-- Only the website service can attest authenticated order creation or issue
-- a return handle. Handles never contain gallery credentials.
begin;
create table public.parent_order_session_access (
  order_id uuid primary key references public.orders(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  order_group_id uuid,
  school_id uuid,
  project_id uuid,
  student_id uuid,
  lane_ids uuid[] not null check (cardinality(lane_ids) between 1 and 32),
  created_at timestamptz not null default now()
);
create table public.parent_checkout_returns (
  id uuid primary key default gen_random_uuid(),
  anchor_order_id uuid not null references public.orders(id) on delete cascade,
  order_group_id uuid,
  order_ids uuid[] not null check (cardinality(order_ids) between 1 and 6),
  order_scopes jsonb not null check (jsonb_typeof(order_scopes) = 'array'),
  legacy_school boolean not null,
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  return_lane_id uuid not null references public.parent_gallery_sessions(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  attempt_key text not null check (length(attempt_key) between 1 and 255),
  stripe_session_id text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique(anchor_order_id, attempt_key),
  check (expires_at > created_at)
);
create index parent_checkout_returns_orders_idx on public.parent_checkout_returns using gin(order_ids);
create index parent_checkout_returns_expiry_idx on public.parent_checkout_returns(expires_at);
alter table public.parent_order_session_access enable row level security;
alter table public.parent_order_session_access force row level security;
alter table public.parent_checkout_returns enable row level security;
alter table public.parent_checkout_returns force row level security;
revoke all on public.parent_order_session_access, public.parent_checkout_returns from public, anon, authenticated, service_role;
grant select on public.parent_order_session_access, public.parent_checkout_returns to service_role;

-- Called only after an existing create handler validates its credentials,
-- media, and idempotency claim. Receipt email is deliberately not viewer auth.
create function public.record_parent_order_session_access(p_token_hash text, p_lane_ids uuid[], p_order_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  o public.orders%rowtype;
  existing public.parent_order_session_access%rowtype;
  eligible uuid[];
  owner_id uuid;
  group_id uuid;
  actual_ids uuid[];
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_lane_ids is null or p_order_ids is null or cardinality(p_lane_ids) not between 1 and 32 or cardinality(p_order_ids) not between 1 and 6
    or array_position(p_lane_ids, null) is not null or array_position(p_order_ids, null) is not null
    or (select count(distinct v) from unnest(p_order_ids) v) <> cardinality(p_order_ids)
    or (select count(distinct v) from unnest(p_lane_ids) v) <> cardinality(p_lane_ids) then
    raise exception 'PARENT_ORDER_ACCESS_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('parent-order:' || p_token_hash, 0));
  select photographer_id, order_group_id into owner_id, group_id from public.orders where id = p_order_ids[1];
  select array_agg(id order by id) into actual_ids from public.orders
    where case when group_id is null then id = p_order_ids[1] else order_group_id = group_id end;
  if owner_id is null or actual_ids is distinct from (select array_agg(v order by v) from unnest(p_order_ids) v)
    or exists(select 1 from public.orders where id = any(p_order_ids)
      and (photographer_id is distinct from owner_id or order_group_id is distinct from group_id))
    or (select count(*) from public.parent_gallery_sessions where id = any(p_lane_ids)
      and token_hash = p_token_hash and photographer_id = owner_id and revoked_at is null and expires_at > now()) <> cardinality(p_lane_ids) then
    raise exception 'PARENT_ORDER_ACCESS_SCOPE';
  end if;
  for o in select * from public.orders where id = any(p_order_ids) order by id loop
    select array_agg(l.id order by l.id) into eligible from public.parent_gallery_sessions l
      where l.id = any(p_lane_ids) and l.token_hash = p_token_hash and l.photographer_id = o.photographer_id
      and l.revoked_at is null and l.expires_at > now()
      and ((l.gallery_kind = 'school' and l.gallery_id = o.school_id and exists (
        select 1 from public.students s join public.schools sc on sc.id = s.school_id
        where s.id = o.student_id and s.school_id = o.school_id and s.pin = l.pin and sc.photographer_id = o.photographer_id))
      or (l.gallery_kind = 'event' and o.school_id is null and l.gallery_id = o.project_id and exists (
        select 1 from public.projects p where p.id = o.project_id and p.photographer_id = o.photographer_id)));
    if eligible is null then raise exception 'PARENT_ORDER_ACCESS_SCOPE'; end if;
    select * into existing from public.parent_order_session_access where order_id = o.id for update;
    if found then
      if existing.token_hash <> p_token_hash or existing.photographer_id <> o.photographer_id
        or existing.order_group_id is distinct from o.order_group_id or existing.lane_ids <> eligible
        or existing.school_id is distinct from o.school_id or existing.project_id is distinct from o.project_id
        or existing.student_id is distinct from o.student_id then
        raise exception 'PARENT_ORDER_ACCESS_CONFLICT';
      end if;
    else
      insert into public.parent_order_session_access(order_id, token_hash, photographer_id, order_group_id, school_id, project_id, student_id, lane_ids)
      values(o.id, p_token_hash, o.photographer_id, o.order_group_id, o.school_id, o.project_id, o.student_id, eligible);
    end if;
  end loop;
end;
$$;

create function public.register_parent_checkout_return(p_token_hash text, p_return_lane_id uuid,
  p_anchor_order_id uuid, p_order_ids uuid[], p_attempt_key text, p_allow_legacy_school boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  lane public.parent_gallery_sessions%rowtype;
  anchor public.orders%rowtype;
  existing public.parent_checkout_returns%rowtype;
  actual_ids uuid[];
  requested_ids uuid[];
  provenance_count integer;
  actual_scopes jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_attempt_key is null or length(p_attempt_key) not between 1 and 255
    or p_order_ids is null or cardinality(p_order_ids) not between 1 and 6 or array_position(p_order_ids, null) is not null
    or (select count(distinct v) from unnest(p_order_ids) v) <> cardinality(p_order_ids) then
    raise exception 'PARENT_RETURN_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('parent-return:' || p_anchor_order_id::text, 0));
  select * into lane from public.parent_gallery_sessions where id = p_return_lane_id
    and token_hash = p_token_hash and revoked_at is null and expires_at > now();
  if not found then raise exception 'PARENT_RETURN_ACCESS'; end if;
  select * into anchor from public.orders where id = p_anchor_order_id;
  select array_agg(v order by v) into requested_ids from unnest(p_order_ids) v;
  select array_agg(id order by id) into actual_ids from public.orders where
    case when anchor.order_group_id is null then id = anchor.id else order_group_id = anchor.order_group_id end;
  if anchor.id is null or anchor.photographer_id is distinct from lane.photographer_id
    or actual_ids is distinct from requested_ids or anchor.id <> requested_ids[1]
    or exists(select 1 from public.orders where id = any(p_order_ids)
      and (photographer_id is distinct from lane.photographer_id or order_group_id is distinct from anchor.order_group_id)) then
    raise exception 'PARENT_RETURN_SCOPE';
  end if;
  select jsonb_agg(jsonb_build_object('id', o.id, 'school_id', o.school_id, 'project_id', o.project_id,
    'student_id', o.student_id) order by o.id) into actual_scopes from public.orders o where o.id = any(p_order_ids);
  select count(*) into provenance_count from public.parent_order_session_access a join public.orders o on o.id = a.order_id
    where a.order_id = any(p_order_ids) and a.token_hash = p_token_hash
      and a.photographer_id = lane.photographer_id and a.order_group_id is not distinct from anchor.order_group_id
      and a.school_id is not distinct from o.school_id and a.project_id is not distinct from o.project_id
      and a.student_id is not distinct from o.student_id
      and exists (select 1 from public.parent_gallery_sessions proof
        where proof.id = any(a.lane_ids) and proof.token_hash = p_token_hash
          and proof.photographer_id = lane.photographer_id and proof.revoked_at is null and proof.expires_at > now()
          and ((proof.gallery_kind = 'school' and proof.gallery_id = o.school_id and exists (
            select 1 from public.students s join public.schools sc on sc.id = s.school_id
            where s.id = o.student_id and s.school_id = o.school_id and s.pin = proof.pin and sc.photographer_id = lane.photographer_id))
          or (proof.gallery_kind = 'event' and o.school_id is null and proof.gallery_id = o.project_id and exists (
            select 1 from public.projects p where p.id = o.project_id and p.photographer_id = lane.photographer_id))));
  if provenance_count <> cardinality(p_order_ids) and not (
    provenance_count = 0 and not exists (select 1 from public.parent_order_session_access where order_id = any(p_order_ids))
    and p_allow_legacy_school and lane.gallery_kind = 'school' and exists (
      select 1 from public.orders o join public.students s on s.id = o.student_id and s.school_id = o.school_id
      join public.schools sc on sc.id = s.school_id
      where o.id = any(p_order_ids) and o.school_id = lane.gallery_id and s.pin = lane.pin
        and sc.photographer_id = lane.photographer_id)) then
    raise exception 'PARENT_RETURN_PROVENANCE';
  end if;
  select * into existing from public.parent_checkout_returns
    where anchor_order_id = p_anchor_order_id and attempt_key = p_attempt_key for update;
  if found then
    if existing.token_hash <> p_token_hash or existing.photographer_id <> lane.photographer_id
      or existing.order_group_id is distinct from anchor.order_group_id or existing.order_ids <> requested_ids
      or existing.order_scopes is distinct from actual_scopes or existing.expires_at <= now() then raise exception 'PARENT_RETURN_CONFLICT'; end if;
  else
    insert into public.parent_checkout_returns(anchor_order_id, order_group_id, order_ids, order_scopes, legacy_school,
      photographer_id, return_lane_id, token_hash, attempt_key, expires_at)
      values(anchor.id, anchor.order_group_id, requested_ids, actual_scopes, provenance_count = 0, lane.photographer_id, lane.id,
        p_token_hash, p_attempt_key, least(lane.expires_at, now() + interval '24 hours')) returning * into existing;
  end if;
  return pg_catalog.jsonb_build_object('returnId', existing.id, 'laneId', existing.return_lane_id,
    'sessionId', existing.stripe_session_id, 'expiresAt', existing.expires_at);
end;
$$;

create function public.bind_parent_checkout_return(p_return_id uuid, p_token_hash text, p_session_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare existing public.parent_checkout_returns%rowtype;
begin
  if p_session_id is null or p_session_id !~ '^cs_[A-Za-z0-9_]{1,250}$' then raise exception 'PARENT_RETURN_INVALID'; end if;
  select * into existing from public.parent_checkout_returns where id = p_return_id for update;
  if not found or existing.token_hash is distinct from p_token_hash or existing.expires_at <= now()
    or (existing.stripe_session_id is not null and existing.stripe_session_id <> p_session_id) then
    raise exception 'PARENT_RETURN_CONFLICT';
  end if;
  update public.parent_checkout_returns set stripe_session_id = p_session_id where id = p_return_id;
end;
$$;
revoke all on function public.record_parent_order_session_access(text,uuid[],uuid[]),
  public.register_parent_checkout_return(text,uuid,uuid,uuid[],text,boolean),
  public.bind_parent_checkout_return(uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_parent_order_session_access(text,uuid[],uuid[]),
  public.register_parent_checkout_return(text,uuid,uuid,uuid[],text,boolean),
  public.bind_parent_checkout_return(uuid,text,text) to service_role;

do $$
declare r text; t text; f text;
begin
  foreach r in array array['anon','authenticated'] loop
    foreach t in array array['parent_order_session_access','parent_checkout_returns'] loop
      if pg_catalog.has_table_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'Unexpected parent checkout privilege';
      end if;
    end loop;
    foreach f in array array['record_parent_order_session_access(text,uuid[],uuid[])',
      'register_parent_checkout_return(text,uuid,uuid,uuid[],text,boolean)', 'bind_parent_checkout_return(uuid,text,text)'] loop
      if pg_catalog.has_function_privilege(r, 'public.' || f, 'EXECUTE') then raise exception 'Unexpected parent checkout privilege'; end if;
    end loop;
  end loop;
end;
$$;
commit;
