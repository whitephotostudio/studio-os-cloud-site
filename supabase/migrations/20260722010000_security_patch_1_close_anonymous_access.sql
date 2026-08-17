-- Security Patch 1
--
-- Parent gallery access is validated by the server-side /api/portal routes.
-- The desktop and dashboard clients are authenticated and retain their
-- photographer-scoped RLS policies. These legacy blanket anonymous policies
-- therefore expose private rows without being required by the current app.

begin;

drop policy if exists "Anon can read collections" on public.collections;
drop policy if exists "Anon can read package profiles" on public.package_profiles;
drop policy if exists "Anon can read projects" on public.projects;
drop policy if exists "Anon can read schools" on public.schools;
drop policy if exists "Anon can read students" on public.students;
drop policy if exists parent_pin_lookup on public.students;

drop policy if exists public_can_read_own on public.pre_release_emails;
drop policy if exists public_can_register on public.pre_release_emails;
drop policy if exists parents_can_check_own on public.pre_release_registrations;
drop policy if exists photographer_can_read on public.pre_release_registrations;
drop policy if exists parents_can_register on public.pre_release_registrations;

-- These are implementation helpers used only from the authenticated
-- SECURITY DEFINER desktop-access function. They must never be public RPCs.
revoke execute on function public._link_device_to_photography_key(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public._upsert_device_registration(text, uuid, uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;

-- Fail the migration atomically if a future schema change prevents either
-- protection from taking effect.
do $$
begin
  if has_function_privilege(
    'anon',
    'public._link_device_to_photography_key(uuid,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception '_link_device_to_photography_key remains executable by anon';
  end if;

  if has_function_privilege(
    'anon',
    'public._upsert_device_registration(text,uuid,uuid,text,text,text,text,timestamptz)',
    'EXECUTE'
  ) then
    raise exception '_upsert_device_registration remains executable by anon';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'collections',
        'package_profiles',
        'projects',
        'schools',
        'students',
        'pre_release_emails',
        'pre_release_registrations'
      )
      and (roles::text ilike '%anon%' or roles::text ilike '%public%')
      and (
        coalesce(qual::text, '') = 'true'
        or coalesce(with_check::text, '') = 'true'
      )
  ) then
    raise exception 'A blanket anonymous policy remains on a protected table';
  end if;
end
$$;

commit;
