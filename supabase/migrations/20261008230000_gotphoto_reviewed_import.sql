-- One-school reviewed CSV imports. Create-only: never rewrite photographs,
-- existing students/contacts, invoices, orders or marketing permission.
begin;

create table public.gotphoto_import_requests (
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  request_key text not null check (char_length(request_key) between 8 and 200),
  school_id uuid not null,
  input_fingerprint text not null check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  receipt jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (photographer_id, request_key),
  foreign key (school_id, photographer_id) references public.schools(id, photographer_id) on delete cascade
);
alter table public.gotphoto_import_requests enable row level security;
alter table public.gotphoto_import_requests force row level security;
revoke all on public.gotphoto_import_requests from public, anon, authenticated;
grant select, insert on public.gotphoto_import_requests to service_role;

create or replace function public.import_reviewed_gotphoto_csv(
  p_actor_user_id uuid, p_photographer_id uuid, p_school_id uuid,
  p_request_key text, p_input_fingerprint text,
  p_students jsonb, p_contacts jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_previous public.gotphoto_import_requests;
  v_row jsonb;
  v_student_id uuid;
  v_client_id uuid;
  v_contact_id uuid;
  v_students jsonb := '[]'::jsonb;
  v_contacts jsonb := '[]'::jsonb;
  v_receipt jsonb;
begin
  -- Serialize imports for a tenant and keep its ownership stable to commit.
  perform id from public.photographers
    where id = p_photographer_id and user_id = p_actor_user_id for update;
  if not found then raise exception 'Photographer ownership is required'; end if;
  perform id from public.schools
    where id = p_school_id and photographer_id = p_photographer_id for update;
  if not found then raise exception 'School ownership is required'; end if;
  if p_request_key is null or char_length(p_request_key) not between 8 and 200
    or p_input_fingerprint is null or p_input_fingerprint !~ '^[a-f0-9]{64}$'
  then raise exception 'Invalid import identity'; end if;

  select * into v_previous from public.gotphoto_import_requests
    where photographer_id = p_photographer_id and request_key = p_request_key;
  if found then
    if v_previous.school_id <> p_school_id or v_previous.input_fingerprint <> p_input_fingerprint
    then raise exception 'This import request already belongs to different data'; end if;
    return v_previous.receipt;
  end if;
  if p_students is null or p_contacts is null
    or jsonb_typeof(p_students) <> 'array' or jsonb_typeof(p_contacts) <> 'array'
  then raise exception 'Invalid import rows'; end if;
  if jsonb_array_length(p_students) + jsonb_array_length(p_contacts) not between 1 and 5000
    or (jsonb_array_length(p_students) > 0 and jsonb_array_length(p_contacts) > 0)
  then raise exception 'Choose one import type with at most 5000 rows'; end if;

  for v_row in select value from jsonb_array_elements(p_students) loop
    if jsonb_typeof(v_row) <> 'object'
      or coalesce(v_row->>'sourceId', '') = '' or char_length(v_row->>'sourceId') > 128
      or v_row->>'externalId' is distinct from 'gotphoto:' || (v_row->>'sourceId')
      or char_length(btrim(coalesce(v_row->>'firstName', ''))) not between 1 and 300
      or char_length(btrim(coalesce(v_row->>'lastName', ''))) not between 1 and 300
      or char_length(btrim(coalesce(v_row->>'className', ''))) not between 1 and 300
      or (nullif(v_row->>'parentEmail', '') is not null and
        (char_length(v_row->>'parentEmail') > 254 or v_row->>'parentEmail' !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'))
    then raise exception 'Invalid student import row'; end if;
    if exists (select 1 from public.students where school_id = p_school_id
      and external_student_id = v_row->>'externalId')
    then raise exception 'Roster changed after preview. Preview again'; end if;
    insert into public.students (school_id, first_name, last_name, class_id,
      class_name, external_student_id, role, pin, parent_email, folder_name, photo_url)
    values (p_school_id, btrim(v_row->>'firstName'), btrim(v_row->>'lastName'), null,
      btrim(v_row->>'className'), v_row->>'externalId', 'Student',
      upper(substr(md5(gen_random_uuid()::text), 1, 8)),
      nullif(lower(btrim(v_row->>'parentEmail')), ''), null, null)
    returning id into v_student_id;
    v_students := v_students || jsonb_build_array(jsonb_build_object(
      'id', v_student_id, 'sourceId', v_row->>'sourceId',
      'externalId', v_row->>'externalId', 'className', v_row->>'className'));
  end loop;

  for v_row in select value from jsonb_array_elements(p_contacts) loop
    if jsonb_typeof(v_row) <> 'object'
      or char_length(btrim(coalesce(v_row->>'fullName', ''))) not between 1 and 300
      or char_length(coalesce(v_row->>'email', '')) not between 3 and 254
      or v_row->>'email' !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'
      or char_length(coalesce(v_row->>'phone', '')) > 100
    then raise exception 'Invalid customer import row'; end if;
    if exists (select 1 from public.crm_contacts where photographer_id = p_photographer_id
      and email_normalized = lower(btrim(v_row->>'email')))
    then raise exception 'Contacts changed after preview. Preview again'; end if;
    insert into public.crm_clients (photographer_id, kind, display_name, default_timezone,
      notes, tags, created_by)
    values (p_photographer_id, 'person', btrim(v_row->>'fullName'), 'UTC',
      'Imported from a reviewed GotPhoto customer CSV. Historical purchases and consent were not imported.',
      array['gotphoto-import'], p_actor_user_id) returning id into v_client_id;
    insert into public.crm_contacts (photographer_id, client_id, full_name, email, phone,
      role, is_primary, preferred_channel, marketing_consent, do_not_contact, consent_source)
    values (p_photographer_id, v_client_id, btrim(v_row->>'fullName'),
      lower(btrim(v_row->>'email')), nullif(btrim(v_row->>'phone'), ''),
      'Customer', true, 'none', 'unknown', true, null) returning id into v_contact_id;
    v_contacts := v_contacts || jsonb_build_array(v_contact_id);
  end loop;
  v_receipt := jsonb_build_object('importedStudents', jsonb_array_length(v_students),
    'importedContacts', jsonb_array_length(v_contacts), 'students', v_students,
    'contactIds', v_contacts, 'photosUploaded', 0);
  insert into public.gotphoto_import_requests (photographer_id, request_key, school_id,
    input_fingerprint, receipt, created_by)
  values (p_photographer_id, p_request_key, p_school_id, p_input_fingerprint, v_receipt, p_actor_user_id);
  return v_receipt;
end;
$$;
revoke all on function public.import_reviewed_gotphoto_csv(uuid, uuid, uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_reviewed_gotphoto_csv(uuid, uuid, uuid, text, text, jsonb, jsonb)
  to service_role;

create or replace function public.gotphoto_migration_schema_status()
returns jsonb language sql security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'version', '20261008230000',
    'import_rpc', to_regprocedure('public.import_reviewed_gotphoto_csv(uuid,uuid,uuid,text,text,jsonb,jsonb)') is not null,
    'ledger_rls', coalesce((select relrowsecurity from pg_class where oid = 'public.gotphoto_import_requests'::regclass), false),
    'ledger_forced_rls', coalesce((select relforcerowsecurity from pg_class where oid = 'public.gotphoto_import_requests'::regclass), false),
    'ledger_fields_complete', (select count(*) = 7 from information_schema.columns where table_schema = 'public'
      and table_name = 'gotphoto_import_requests' and column_name in
      ('photographer_id','request_key','school_id','input_fingerprint','receipt','created_by','created_at')),
    'service_only', not exists (
      select 1 from (values ('anon'), ('authenticated')) as roles(role_name)
      where has_table_privilege(role_name, 'public.gotphoto_import_requests', 'SELECT,INSERT,UPDATE,DELETE')
        or has_function_privilege(role_name, 'public.import_reviewed_gotphoto_csv(uuid,uuid,uuid,text,text,jsonb,jsonb)', 'EXECUTE')
        or has_function_privilege(role_name, 'public.gotphoto_migration_schema_status()', 'EXECUTE')
    )
  );
$$;
revoke all on function public.gotphoto_migration_schema_status() from public, anon, authenticated;
grant execute on function public.gotphoto_migration_schema_status() to service_role;
commit;
