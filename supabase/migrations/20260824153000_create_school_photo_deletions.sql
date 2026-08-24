-- Durable, owner-scoped tombstones for school photos removed from a gallery.
--
-- The first rollout intentionally preserves the R2 bytes. Older installed
-- desktop builds do not understand tombstones yet and may upload the same
-- object again; the tombstone keeps that object hidden until every client can
-- participate in permanent deletion safely.

begin;

-- A legacy R2 namespace is one unambiguous school identifier. Prevent an
-- account from making its local id look like a namespaced path (or colliding
-- with another account) and thereby authorizing a different school's bytes.
do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.schools'::regclass
      and conname = 'schools_local_school_id_safe_storage_segment'
  ) then
    alter table public.schools
      add constraint schools_local_school_id_safe_storage_segment
      check (
        local_school_id is null
        or (
          local_school_id = btrim(local_school_id)
          and local_school_id <> ''
          and strpos(local_school_id, '/') = 0
          and strpos(local_school_id, chr(92)) = 0
          and strpos(local_school_id, '?') = 0
          and strpos(local_school_id, '#') = 0
          and local_school_id !~ '[[:cntrl:]]'
          and local_school_id not in ('.', '..')
          and lower(local_school_id) not in (
            'schools',
            'photos',
            'projects',
            'nobg-photos',
            'thumbs',
            'backdrops',
            'probes'
          )
        )
      );
  end if;
end
$migration$;

create unique index if not exists schools_local_school_id_unique_nonblank_idx
  on public.schools (lower(local_school_id))
  where local_school_id is not null and local_school_id <> '';

-- `id` and `local_school_id` have both been used as top-level R2 roots. A
-- normal unique index covers local/local collisions but cannot prevent one
-- school's local id from equaling another school's database UUID. Claim every
-- root in one registry so either kind of cross-school collision fails
-- atomically, including concurrent inserts and updates.
create table if not exists public.school_storage_root_claims (
  root text primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  root_kind text not null check (root_kind in ('database', 'local')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (school_id, root_kind),
  constraint school_storage_root_claims_normalized
    check (root = lower(btrim(root)) and root <> '')
);

alter table public.school_storage_root_claims enable row level security;
revoke all on table public.school_storage_root_claims from anon;
revoke all on table public.school_storage_root_claims from authenticated;

insert into public.school_storage_root_claims (root, school_id, root_kind)
select lower(id::text), id, 'database'
from public.schools
union all
select lower(local_school_id), id, 'local'
from public.schools
where local_school_id is not null
  and local_school_id <> ''
  and lower(local_school_id) <> lower(id::text);

create or replace function public.sync_school_storage_root_claims()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    delete from public.school_storage_root_claims where school_id = old.id;
  else
    delete from public.school_storage_root_claims where school_id = new.id;
  end if;

  insert into public.school_storage_root_claims (root, school_id, root_kind)
  values (lower(new.id::text), new.id, 'database');

  if new.local_school_id is not null
    and new.local_school_id <> ''
    and lower(new.local_school_id) <> lower(new.id::text)
  then
    insert into public.school_storage_root_claims (root, school_id, root_kind)
    values (lower(new.local_school_id), new.id, 'local');
  end if;

  return new;
end;
$$;

drop trigger if exists sync_school_storage_root_claims on public.schools;
create trigger sync_school_storage_root_claims
after insert or update of id, local_school_id on public.schools
for each row
execute function public.sync_school_storage_root_claims();

revoke execute on function public.sync_school_storage_root_claims()
  from public, anon, authenticated;

create table if not exists public.school_photo_deletions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  storage_key text not null,
  storage_family text not null,
  deleted_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint school_photo_deletions_storage_key_not_blank
    check (length(btrim(storage_key)) > 0 and length(storage_key) <= 1024),
  constraint school_photo_deletions_storage_family_not_blank
    check (length(btrim(storage_family)) > 0 and length(storage_family) <= 1024),
  unique (school_id, storage_key)
);

create index if not exists school_photo_deletions_school_family_idx
  on public.school_photo_deletions (school_id, storage_family);

create index if not exists school_photo_deletions_photographer_created_idx
  on public.school_photo_deletions (photographer_id, created_at desc);

create index if not exists school_photo_deletions_student_family_idx
  on public.school_photo_deletions (student_id, storage_family)
  where student_id is not null;

alter table public.school_photo_deletions enable row level security;

drop policy if exists "Photographer reads own school photo deletions"
  on public.school_photo_deletions;
create policy "Photographer reads own school photo deletions"
  on public.school_photo_deletions
  for select
  to authenticated
  using (
    photographer_id in (
      select id
      from public.photographers
      where user_id = auth.uid()
    )
  );

-- All writes go through an authenticated dashboard route using the service
-- role. Desktop and web clients can read their own tombstones but cannot forge,
-- change, or erase them directly.
revoke all on table public.school_photo_deletions from anon;
revoke all on table public.school_photo_deletions from authenticated;
grant select on table public.school_photo_deletions to authenticated;

comment on table public.school_photo_deletions is
  'Durable soft-deletion markers for school gallery photos; R2 bytes are preserved during staged desktop rollout.';
comment on column public.school_photo_deletions.storage_key is
  'Exact canonical original R2 object key selected for removal.';
comment on column public.school_photo_deletions.storage_family is
  'Canonical variant-family key used to hide original, preview, thumbnail, cutout, and nobg representations.';

-- Keep legacy desktop builds from restoring a removed photo as the student's
-- representative. Those builds can update `students` directly through RLS and
-- do not call the newer desktop-sync API. The trigger is deliberately gentle:
-- it preserves a safe OLD representative or writes NULL instead of raising.
create or replace function public.school_photo_percent_decode(input_value text)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, public
as $$
declare
  result text := '';
  raw_run text;
  decoded_run text;
  encoded_bytes bytea;
  cursor_pos integer := 1;
  input_length integer := char_length(input_value);
  hex_pair text;
begin
  -- Decode only complete, valid UTF-8 percent-byte runs. A malformed run is
  -- retained verbatim, so historical bad data cannot make the trigger throw
  -- or accidentally alias a different object key.
  while cursor_pos <= input_length loop
    if substr(input_value, cursor_pos, 1) = '%'
      and cursor_pos + 2 <= input_length
      and substr(input_value, cursor_pos + 1, 2) ~ '^[0-9A-Fa-f]{2}$'
    then
      raw_run := '';
      encoded_bytes := ''::bytea;

      while cursor_pos + 2 <= input_length
        and substr(input_value, cursor_pos, 1) = '%'
        and substr(input_value, cursor_pos + 1, 2) ~ '^[0-9A-Fa-f]{2}$'
      loop
        hex_pair := substr(input_value, cursor_pos + 1, 2);
        raw_run := raw_run || '%' || hex_pair;
        encoded_bytes := encoded_bytes || decode(hex_pair, 'hex');
        cursor_pos := cursor_pos + 3;
      end loop;

      begin
        decoded_run := convert_from(encoded_bytes, 'UTF8');
        result := result || decoded_run;
      exception
        when character_not_in_repertoire then
          result := result || raw_run;
      end;
    else
      result := result || substr(input_value, cursor_pos, 1);
      cursor_pos := cursor_pos + 1;
    end if;
  end loop;

  return result;
end;
$$;

create or replace function public.school_photo_storage_family(input_value text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  candidate text := btrim(coalesce(input_value, ''));
  encoded_reference boolean;
  marker_pos integer;
  slash_pos integer;
  storage_marker text;
  folder text;
  filename text;
begin
  if candidate = '' then return null; end if;
  encoded_reference := candidate ~* '^https?://'
    or strpos(candidate, '/api/r2/img/') > 0
    or strpos(candidate, '/storage/v1/') > 0;
  if encoded_reference then
    candidate := split_part(split_part(candidate, '?', 1), '#', 1);
  end if;

  marker_pos := strpos(candidate, '/api/r2/img/');
  if marker_pos > 0 then
    candidate := substr(candidate, marker_pos + length('/api/r2/img/'));
  else
    storage_marker := case
      when strpos(candidate, '/storage/v1/object/public/thumbs/') > 0
        then '/storage/v1/object/public/thumbs/'
      when strpos(candidate, '/storage/v1/render/image/public/thumbs/') > 0
        then '/storage/v1/render/image/public/thumbs/'
      when strpos(candidate, '/storage/v1/object/sign/thumbs/') > 0
        then '/storage/v1/object/sign/thumbs/'
      else null
    end;
    marker_pos := case
      when storage_marker is null then 0
      else strpos(candidate, storage_marker)
    end;
    if marker_pos > 0 then
      candidate := substr(
        candidate,
        marker_pos + length(storage_marker)
      );
    elsif candidate ~* '^https?://' then
      candidate := regexp_replace(candidate, '^https?://[^/]+/', '');
      -- S3-style R2 URLs include the bucket as their first path segment.
      if input_value ~* '\.r2\.cloudflarestorage\.com/' then
        slash_pos := strpos(candidate, '/');
        if slash_pos > 0 then candidate := substr(candidate, slash_pos + 1); end if;
      end if;
    end if;
  end if;

  candidate := regexp_replace(candidate, '^/+', '');
  if encoded_reference then
    candidate := public.school_photo_percent_decode(candidate);
  end if;
  loop
    if candidate like 'nobg-photos/%' then
      candidate := substr(candidate, length('nobg-photos/') + 1);
    elsif candidate like 'thumbs/%' then
      candidate := substr(candidate, length('thumbs/') + 1);
    else
      exit;
    end if;
  end loop;

  -- Canonicalize database-id, local-id, schools/<id>, and photos/<id>
  -- aliases to the same school-relative class/student/photo family.
  if candidate like 'schools/%/%' or candidate like 'photos/%/%' then
    slash_pos := strpos(candidate, '/');
    candidate := substr(candidate, slash_pos + 1);
    slash_pos := strpos(candidate, '/');
    candidate := substr(candidate, slash_pos + 1);
  else
    slash_pos := strpos(candidate, '/');
    if slash_pos > 0 then candidate := substr(candidate, slash_pos + 1); end if;
  end if;

  slash_pos := length(candidate) - strpos(reverse(candidate), '/') + 1;
  if slash_pos > 0 and slash_pos <= length(candidate) then
    folder := substr(candidate, 1, slash_pos - 1);
    filename := substr(candidate, slash_pos + 1);
  else
    folder := '';
    filename := candidate;
  end if;

  filename := regexp_replace(
    filename,
    '\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?)$',
    '',
    'i'
  );
  filename := regexp_replace(filename, '_(preview|thumbnail|cutout|nobg)$', '', 'i');
  filename := regexp_replace(
    filename,
    '\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?)$',
    '',
    'i'
  );
  if filename = '' then return null; end if;
  return case when folder = '' then filename else folder || '/' || filename end;
end;
$$;

create or replace function public.prevent_tombstoned_student_photo_resurrection()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  incoming_family text;
  old_family text;
begin
  incoming_family := public.school_photo_storage_family(new.photo_url);
  if incoming_family is null or not exists (
    select 1
    from public.school_photo_deletions d
    where d.storage_family = incoming_family
      and (d.school_id = new.school_id or d.student_id = new.id)
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    old_family := public.school_photo_storage_family(old.photo_url);
    if old.photo_url is not null
      and old_family is not null
      and not exists (
        select 1
        from public.school_photo_deletions d
        where d.storage_family = old_family
          and (
            d.school_id = old.school_id
            or d.school_id = new.school_id
            or d.student_id = new.id
          )
      )
    then
      new.photo_url := old.photo_url;
      return new;
    end if;
  end if;

  new.photo_url := null;
  return new;
end;
$$;

drop trigger if exists prevent_tombstoned_student_photo_resurrection
  on public.students;
create trigger prevent_tombstoned_student_photo_resurrection
before insert or update of photo_url, school_id on public.students
for each row
execute function public.prevent_tombstoned_student_photo_resurrection();

revoke execute on function public.school_photo_percent_decode(text)
  from public, anon, authenticated;
revoke execute on function public.school_photo_storage_family(text)
  from public, anon, authenticated;

revoke execute on function public.prevent_tombstoned_student_photo_resurrection()
  from public, anon, authenticated;

commit;
