begin;

-- Dedicated yearbook choices are independent of favorites and desktop best shots.
create table public.school_yearbook_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  enabled boolean not null default false,
  deadline date,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
create table public.school_yearbook_selections (
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  media_key text not null check (length(media_key) between 1 and 1024),
  filename text not null,
  source text not null check (source in ('parent', 'photographer')),
  viewer_email text,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (school_id, student_id)
);
alter table public.school_yearbook_settings enable row level security;
alter table public.school_yearbook_selections enable row level security;
revoke all on public.school_yearbook_settings, public.school_yearbook_selections from anon, authenticated;
grant select on public.school_yearbook_settings, public.school_yearbook_selections to authenticated;
grant all on public.school_yearbook_settings, public.school_yearbook_selections to service_role;
create policy yearbook_settings_owner_read on public.school_yearbook_settings for select to authenticated using (
  exists (select 1 from public.schools s join public.photographers p on p.id = s.photographer_id where s.id = school_id and p.user_id = auth.uid())
);
create policy yearbook_selection_owner_read on public.school_yearbook_selections for select to authenticated using (
  exists (select 1 from public.schools s join public.photographers p on p.id = s.photographer_id where s.id = school_id and p.user_id = auth.uid())
);

create function public.save_school_yearbook_settings(p_school_id uuid, p_photographer_id uuid, p_enabled boolean, p_deadline date, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_current public.school_yearbook_settings; v_school public.schools; v_saved public.school_yearbook_settings;
begin
  select * into v_school from public.schools where id = p_school_id for update;
  if not found or v_school.photographer_id is distinct from p_photographer_id then raise exception 'School owner changed' using errcode = '42501'; end if;
  select * into v_current from public.school_yearbook_settings where school_id = p_school_id;
  if coalesce(v_current.revision, 0) is distinct from p_expected_revision then raise exception 'Settings changed' using errcode = '40001'; end if;
  insert into public.school_yearbook_settings(school_id,enabled,deadline,revision)
    values (p_school_id,p_enabled,p_deadline,coalesce(v_current.revision,0)+1)
    on conflict(school_id) do update set enabled=excluded.enabled, deadline=excluded.deadline, revision=excluded.revision, updated_at=clock_timestamp()
    returning * into v_saved;
  return to_jsonb(v_saved);
end $$;

create function public.save_school_yearbook_selection(
  p_school_id uuid, p_student_id uuid, p_photographer_id uuid, p_media_key text, p_filename text, p_storage_family text,
  p_source text, p_viewer_email text, p_pin text, p_expected_revision integer, p_student_snapshot jsonb, p_school_snapshot jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school public.schools; v_student public.students; v_settings public.school_yearbook_settings; v_current public.school_yearbook_selections; v_saved public.school_yearbook_selections; v_status text; v_owner public.photographers;
begin
  -- Serializes settings changes and first-save races; student scope is rechecked
  -- after network validation and before persistence.
  select * into v_school from public.schools where id = p_school_id for update;
  if not found or v_school.photographer_id is distinct from p_photographer_id then raise exception 'School owner changed' using errcode = '42501'; end if;
  if jsonb_build_object('local_school_id',v_school.local_school_id,'photographer_id',v_school.photographer_id) is distinct from p_school_snapshot then raise exception 'School changed' using errcode='40001'; end if;
  select * into v_student from public.students where id = p_student_id and school_id = p_school_id for share;
  if not found then raise exception 'Student no longer belongs to school' using errcode = '42501'; end if;
  if jsonb_build_object('school_id',v_student.school_id,'photo_url',v_student.photo_url,'class_name',v_student.class_name,'folder_name',v_student.folder_name) is distinct from p_student_snapshot then raise exception 'Student gallery changed' using errcode='40001'; end if;
  if p_source not in ('parent','photographer') or p_source is null then raise exception 'Invalid selection source' using errcode='42501'; end if;
  if p_source = 'parent' then
    select * into v_owner from public.photographers where id=p_photographer_id for share;
    if not found or not (coalesce(v_owner.is_platform_admin,false) or lower(coalesce(v_owner.subscription_status,'')) in ('active','trialing') or (lower(coalesce(v_owner.subscription_status,''))='trial' and coalesce(v_owner.trial_ends_at,coalesce(v_owner.trial_starts_at,v_owner.created_at)+interval '30 days') > now())) then raise exception 'Studio subscription inactive' using errcode='42501'; end if;
    v_status := replace(lower(trim(coalesce(v_school.portal_status,v_school.status,''))),'-','_');
    if v_status not in ('active','public','live','open','published','released') or (v_school.expiration_date is not null and v_school.expiration_date::date < (now() at time zone 'America/Toronto')::date) then raise exception 'Gallery closed' using errcode='42501'; end if;
    if p_pin is null or v_student.pin is distinct from p_pin or p_viewer_email is null or length(p_viewer_email) > 320 then raise exception 'Student access changed' using errcode='42501'; end if;
    select * into v_settings from public.school_yearbook_settings where school_id = p_school_id;
    if not found or not v_settings.enabled or (v_settings.deadline is not null and v_settings.deadline < (now() at time zone 'America/Toronto')::date) then raise exception 'Selection window closed' using errcode='42501'; end if;
  end if;
  if p_media_key is null or length(p_media_key) > 1024 or p_media_key !~* '\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?)$' or p_media_key ~ '(^|/)(\.|\.\.)(/|$)' or p_media_key ~ '^(nobg-photos|thumbs)/' or p_media_key ~* '_(preview|thumbnail|cutout|nobg)\.[^.]+$' or p_storage_family is null then raise exception 'Invalid original portrait' using errcode='42501'; end if;
  if exists (select 1 from public.school_photo_deletions where school_id=p_school_id and storage_family=p_storage_family) then raise exception 'Portrait removed' using errcode='42501'; end if;
  select * into v_current from public.school_yearbook_selections where school_id=p_school_id and student_id=p_student_id;
  if coalesce(v_current.revision,0) is distinct from p_expected_revision then raise exception 'Selection changed' using errcode='40001'; end if;
  insert into public.school_yearbook_selections(school_id,student_id,media_key,filename,source,viewer_email,revision)
    values(p_school_id,p_student_id,p_media_key,p_filename,p_source,case when p_source='parent' then lower(trim(p_viewer_email)) else null end,coalesce(v_current.revision,0)+1)
    on conflict(school_id,student_id) do update set media_key=excluded.media_key,filename=excluded.filename,source=excluded.source,viewer_email=excluded.viewer_email,revision=excluded.revision,updated_at=clock_timestamp()
    returning * into v_saved;
  return to_jsonb(v_saved) - 'viewer_email';
end $$;
revoke all on function public.save_school_yearbook_settings(uuid,uuid,boolean,date,integer) from public, anon, authenticated;
grant execute on function public.save_school_yearbook_settings(uuid,uuid,boolean,date,integer) to service_role;
revoke all on function public.save_school_yearbook_selection(uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_school_yearbook_selection(uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb,jsonb) to service_role;

-- Read-only deployment contract. Body checks verify the installed atomic
-- boundary; current object existence and exact R2 folders are also checked by
-- the server endpoint, since SQL cannot inspect the object store.
create function public.school_yearbook_schema_status() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'version',1,
    'settingsRls',(select relrowsecurity from pg_class where oid='public.school_yearbook_settings'::regclass),
    'selectionsRls',(select relrowsecurity from pg_class where oid='public.school_yearbook_selections'::regclass),
    'clientWritesRevoked',not (has_table_privilege('anon','public.school_yearbook_settings','INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.school_yearbook_settings','INSERT,UPDATE,DELETE') or has_table_privilege('anon','public.school_yearbook_selections','INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.school_yearbook_selections','INSERT,UPDATE,DELETE')),
    'settingsSaveServiceOnly',not has_function_privilege('anon','public.save_school_yearbook_settings(uuid,uuid,boolean,date,integer)','EXECUTE') and not has_function_privilege('authenticated','public.save_school_yearbook_settings(uuid,uuid,boolean,date,integer)','EXECUTE') and has_function_privilege('service_role','public.save_school_yearbook_settings(uuid,uuid,boolean,date,integer)','EXECUTE'),
    'selectionSaveServiceOnly',not has_function_privilege('anon','public.save_school_yearbook_selection(uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.save_school_yearbook_selection(uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb,jsonb)','EXECUTE') and has_function_privilege('service_role','public.save_school_yearbook_selection(uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb,jsonb)','EXECUTE'),
    'atomicRevision',(select prosecdef and position('for update' in prosrc)>0 and position('p_expected_revision' in prosrc)>0 from pg_proc where oid='public.save_school_yearbook_selection(uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb,jsonb)'::regprocedure),
    'currentPhotoScope',(select position('p_student_snapshot' in prosrc)>0 and position('school_photo_deletions' in prosrc)>0 and position('Student access changed' in prosrc)>0 from pg_proc where oid='public.save_school_yearbook_selection(uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb,jsonb)'::regprocedure)
  );
$$;
revoke all on function public.school_yearbook_schema_status() from public,anon,authenticated;
grant execute on function public.school_yearbook_schema_status() to service_role;

commit;
