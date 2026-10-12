-- Opaque browser credentials. All PIN/email data stays in a server-only table.
begin;

create table public.parent_gallery_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  scope_hash text not null check (scope_hash ~ '^[a-f0-9]{64}$'),
  gallery_kind text not null check (gallery_kind in ('school', 'event')),
  gallery_id uuid not null,
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  pin text not null check (length(pin) between 1 and 64),
  viewer_email text not null check (length(viewer_email) between 3 and 320),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create unique index parent_gallery_sessions_scope_idx on public.parent_gallery_sessions(token_hash, scope_hash)
  where revoked_at is null;
create index parent_gallery_sessions_expiry_idx on public.parent_gallery_sessions(expires_at);
alter table public.parent_gallery_sessions enable row level security;
alter table public.parent_gallery_sessions force row level security;
revoke all on public.parent_gallery_sessions from public, anon, authenticated, service_role;
grant select on public.parent_gallery_sessions to service_role;

-- Serialize one browser's grants so concurrent sibling logins cannot exceed
-- the cap or create duplicate lanes. Expired lanes are retained, not evicted.
create function public.register_parent_gallery_session(
  p_token_hash text, p_scope_hash text, p_kind text, p_gallery_id uuid,
  p_photographer_id uuid, p_pin text, p_email text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  lane public.parent_gallery_sessions%rowtype;
  expiry timestamptz := pg_catalog.now() + interval '24 hours';
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_scope_hash is null or p_scope_hash !~ '^[a-f0-9]{64}$'
    or p_kind is null or p_kind not in ('school', 'event')
    or p_gallery_id is null or p_photographer_id is null
    or p_pin is null or length(p_pin) not between 1 and 64 or p_pin <> pg_catalog.btrim(p_pin)
    or p_email is null or length(p_email) not between 3 and 320
    or p_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'PARENT_SESSION_INVALID' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_token_hash, 711031));
  select s.* into lane from public.parent_gallery_sessions as s
    where s.token_hash = p_token_hash and s.scope_hash = p_scope_hash and s.revoked_at is null;
  if found then
    if lane.gallery_kind <> p_kind or lane.gallery_id <> p_gallery_id
      or lane.photographer_id <> p_photographer_id or lane.pin <> p_pin or lane.viewer_email <> p_email then
      raise exception 'PARENT_SESSION_INVALID' using errcode = '22023';
    end if;
    update public.parent_gallery_sessions as s set expires_at = expiry where s.id = lane.id
      returning s.* into lane;
  else
    if (select count(*) from public.parent_gallery_sessions as s
      where s.token_hash = p_token_hash and s.revoked_at is null) >= 32 then
      raise exception 'PARENT_SESSION_CAPACITY' using errcode = 'P0001';
    end if;
    insert into public.parent_gallery_sessions(token_hash, scope_hash, gallery_kind, gallery_id,
      photographer_id, pin, viewer_email, expires_at)
      values(p_token_hash, p_scope_hash, p_kind, p_gallery_id, p_photographer_id, p_pin, p_email, expiry)
      returning * into lane;
  end if;
  return pg_catalog.jsonb_build_object('laneId', lane.id, 'kind', lane.gallery_kind,
    'galleryId', lane.gallery_id, 'photographerId', lane.photographer_id,
    'viewerEmail', lane.viewer_email, 'expiresAt', lane.expires_at);
end;
$$;
revoke all on function public.register_parent_gallery_session(text,text,text,uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.register_parent_gallery_session(text,text,text,uuid,uuid,text,text) to service_role;

-- Unexpected inherited roles must not silently turn this private store into
-- a client-readable table or a client-callable session issuer.
do $$
declare client_role text; privilege text;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    if pg_catalog.has_function_privilege(client_role,
      'public.register_parent_gallery_session(text,text,text,uuid,uuid,text,text)', 'EXECUTE') then
      raise exception 'Unexpected parent session privilege';
    end if;
    foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES'] loop
      if pg_catalog.has_table_privilege(client_role, 'public.parent_gallery_sessions', privilege) then
        raise exception 'Unexpected parent session privilege';
      end if;
    end loop;
  end loop;
end;
$$;

commit;
