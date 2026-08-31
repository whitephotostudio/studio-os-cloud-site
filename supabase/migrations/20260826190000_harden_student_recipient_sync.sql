-- Canonical, nullable walk-in recipient email and retry-safe student identity.
--
-- Older desktop releases did not send parent_email. The column remains
-- nullable, while a trigger normalizes any value that is supplied. The
-- school/external ID index is the idempotency boundary used by both Flutter
-- direct sync and the dashboard desktop-sync API.

begin;

alter table public.students
  add column if not exists parent_email text,
  add column if not exists updated_at timestamptz not null
    default timezone('utc', now());

update public.students
set parent_email = nullif(lower(btrim(parent_email)), '')
where parent_email is distinct from nullif(lower(btrim(parent_email)), '');

update public.students
set external_student_id = nullif(btrim(external_student_id), '')
where external_student_id is distinct from nullif(btrim(external_student_id), '');

update public.students
set pin = nullif(btrim(pin), '')
where pin is distinct from nullif(btrim(pin), '');

create or replace function public.normalize_student_recipient_and_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.parent_email := nullif(lower(btrim(new.parent_email)), '');
  new.external_student_id := nullif(btrim(new.external_student_id), '');
  new.pin := nullif(btrim(new.pin), '');
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_students_normalize_recipient_and_touch
  on public.students;
create trigger trg_students_normalize_recipient_and_touch
before insert or update on public.students
for each row execute function public.normalize_student_recipient_and_touch();

-- PostgreSQL unique indexes allow multiple NULL values, so legacy rows with no
-- external identity remain readable while every syncable row is idempotent.
create unique index if not exists students_school_external_student_id_unique
  on public.students (school_id, external_student_id);

-- A PIN selects one private gallery. More than one student with the same PIN
-- would make portal access ambiguous and could expose the wrong child's work.
create unique index if not exists students_school_pin_unique
  on public.students (school_id, pin)
  where pin is not null;

create index if not exists students_school_parent_email_normalized_idx
  on public.students (school_id, lower(parent_email))
  where parent_email is not null;

-- Booking creation and Stripe confirmation can race or retry. Merge only into
-- blank roster fields so a later webhook fills a missing recipient email but
-- never replaces edits already made by the photographer or an older client.
create or replace function public.merge_booking_roster_student(
  p_school_id uuid,
  p_external_student_id text,
  p_first_name text,
  p_last_name text,
  p_pin text,
  p_parent_email text,
  p_folder_name text,
  p_class_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_student_id uuid;
begin
  if p_school_id is null or nullif(btrim(p_external_student_id), '') is null then
    raise exception 'school_id and external_student_id are required';
  end if;

  insert into public.students as existing_student (
    school_id,
    external_student_id,
    first_name,
    last_name,
    pin,
    parent_email,
    folder_name,
    class_name,
    role
  ) values (
    p_school_id,
    btrim(p_external_student_id),
    coalesce(p_first_name, ''),
    coalesce(p_last_name, ''),
    nullif(btrim(p_pin), ''),
    nullif(lower(btrim(p_parent_email)), ''),
    nullif(btrim(p_folder_name), ''),
    nullif(btrim(p_class_name), ''),
    'Student'
  )
  on conflict (school_id, external_student_id) do update
  set first_name = case
        when nullif(btrim(existing_student.first_name), '') is null
          then excluded.first_name
        else existing_student.first_name
      end,
      last_name = case
        when nullif(btrim(existing_student.last_name), '') is null
          then excluded.last_name
        else existing_student.last_name
      end,
      pin = coalesce(nullif(btrim(existing_student.pin), ''), excluded.pin),
      parent_email = coalesce(
        nullif(lower(btrim(existing_student.parent_email)), ''),
        excluded.parent_email
      ),
      folder_name = coalesce(
        nullif(btrim(existing_student.folder_name), ''),
        excluded.folder_name
      ),
      class_name = coalesce(
        nullif(btrim(existing_student.class_name), ''),
        excluded.class_name
      ),
      role = coalesce(nullif(btrim(existing_student.role), ''), 'Student')
  returning id into v_student_id;

  return v_student_id;
end;
$$;

revoke all on function public.merge_booking_roster_student(
  uuid, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.merge_booking_roster_student(
  uuid, text, text, text, text, text, text, text
) to service_role;

commit;
