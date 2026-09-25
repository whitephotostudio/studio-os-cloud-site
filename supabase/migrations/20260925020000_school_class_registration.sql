begin;

-- Opt-in preserves the existing email-only registration and automatic release.
alter table public.schools
  add column if not exists registration_class_required boolean not null default false;

-- Record only contacts that have successfully supplied a student's school PIN.
-- Preregistration alone must never grant access to a student's private PIN.
alter table public.pre_release_registrations
  add column if not exists class_names text[] not null default '{}';

create table if not exists public.school_student_email_contacts (
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) <= 320),
  last_verified_at timestamptz not null default now(),
  primary key (student_id, email)
);
create index if not exists school_student_email_contacts_school_idx
  on public.school_student_email_contacts (school_id, student_id);
alter table public.school_student_email_contacts enable row level security;
revoke all on public.school_student_email_contacts from anon, authenticated;
grant select, insert, update, delete on public.school_student_email_contacts to service_role;

comment on table public.school_student_email_contacts is
  'Server-only email/student associations established after successful school-scoped PIN access. Does not change the authoritative roster contact or PIN recovery identity.';

-- Concurrent sibling registrations accumulate classes without deleting earlier choices.
create or replace function public.register_school_email_classes(p_school_id uuid, p_email text, p_classes text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_school_id::text || ':' || p_email, 0));
  insert into public.pre_release_registrations(school_id, email, class_names)
  values (p_school_id, p_email, p_classes)
  on conflict (school_id, email) do update
    set class_names = array(select distinct unnest(pre_release_registrations.class_names || excluded.class_names));
end;
$$;
revoke all on function public.register_school_email_classes(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.register_school_email_classes(uuid, text, text[]) to service_role;

commit;
