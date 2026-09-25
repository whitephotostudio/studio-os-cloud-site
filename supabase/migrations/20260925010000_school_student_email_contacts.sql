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
