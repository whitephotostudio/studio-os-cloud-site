-- Link permanent CRM education clients/campuses to yearly school gallery jobs
-- and, when one exists, to the public appointment-booking event for that job.
--
-- A school gallery may exist before public appointment booking is configured,
-- so booking_event_id is deliberately nullable.  The source school is always
-- required and remains the stable join point for history.

begin;

-- Desktop/Flutter uses this stable local operation ID to retry school creation.
-- A regular (non-partial) unique index still permits multiple NULLs while also
-- remaining a valid PostgREST ON CONFLICT target. Historical non-NULL
-- duplicates make the migration fail closed instead of picking one silently.
create unique index if not exists schools_local_school_photographer_uidx
  on public.schools (local_school_id, photographer_id);

-- Production already enforces one appointment event per school. Track that
-- invariant explicitly so setup retries can use `school_id` as an atomic
-- PostgREST conflict target; pre-existing duplicates fail this migration.
create unique index if not exists booking_events_school_id_crm_uidx
  on public.booking_events (school_id);

-- Proves, at the database boundary, that a linked booking event belongs to the
-- same school and photographer as the CRM job.  `id` is already unique, but the
-- wider key is required for the composite tenant/source foreign key below.
create unique index if not exists booking_events_id_school_photographer_crm_uidx
  on public.booking_events (id, school_id, photographer_id);

create table public.crm_booking_jobs (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  client_id uuid not null,
  location_id uuid,
  booking_cycle_id uuid not null,
  gallery_school_id uuid not null,
  booking_event_id uuid,
  role text not null default 'primary'
    check (role in ('primary', 'retake', 'makeup', 'other')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_booking_jobs_client_tenant_fkey
    foreign key (client_id, photographer_id)
    references public.crm_clients(id, photographer_id) on delete cascade,
  constraint crm_booking_jobs_location_client_tenant_fkey
    foreign key (location_id, client_id, photographer_id)
    references public.crm_locations(id, client_id, photographer_id) on delete restrict,
  constraint crm_booking_jobs_cycle_client_tenant_fkey
    foreign key (booking_cycle_id, client_id, photographer_id)
    references public.crm_booking_cycles(id, client_id, photographer_id) on delete restrict,
  constraint crm_booking_jobs_school_tenant_fkey
    foreign key (gallery_school_id, photographer_id)
    references public.schools(id, photographer_id) on delete restrict,
  constraint crm_booking_jobs_event_school_tenant_fkey
    foreign key (booking_event_id, gallery_school_id, photographer_id)
    references public.booking_events(id, school_id, photographer_id) on delete restrict,
  constraint crm_booking_jobs_id_client_tenant_key
    unique (id, client_id, photographer_id),
  constraint crm_booking_jobs_school_key
    unique (photographer_id, gallery_school_id)
);

create unique index crm_booking_jobs_event_idx
  on public.crm_booking_jobs (photographer_id, booking_event_id)
  where booking_event_id is not null;
create index crm_booking_jobs_client_history_idx
  on public.crm_booking_jobs (photographer_id, client_id, created_at desc);
create index crm_booking_jobs_location_idx
  on public.crm_booking_jobs (photographer_id, location_id, created_at desc)
  where location_id is not null;
create index crm_booking_jobs_cycle_idx
  on public.crm_booking_jobs (photographer_id, booking_cycle_id);

create trigger crm_booking_jobs_touch_updated_at
before update on public.crm_booking_jobs
for each row execute function public.crm_touch_updated_at();

-- Foundation normally makes this impossible through
-- crm_booking_cycles_gallery_school_idx. Keep an explicit preflight here so a
-- legacy or partially migrated database can never let ON CONFLICT pick an
-- arbitrary CRM client for one gallery school during backfill.
do $$
begin
  if exists (
    select 1
    from public.crm_booking_cycles as cycle
    where cycle.gallery_school_id is not null
    group by cycle.photographer_id, cycle.gallery_school_id
    having count(*) > 1
  ) then
    raise exception 'Cannot backfill CRM booking jobs: a gallery school is linked to multiple CRM cycles'
      using errcode = '23505';
  end if;
end;
$$;

-- Preserve every existing CRM -> school link.  Campus is intentionally left
-- unassigned for legacy rows; the owner can choose the correct campus later.
insert into public.crm_booking_jobs (
  photographer_id,
  client_id,
  booking_cycle_id,
  gallery_school_id,
  booking_event_id,
  role,
  created_by,
  created_at,
  updated_at
)
select
  cycle.photographer_id,
  cycle.client_id,
  cycle.id,
  cycle.gallery_school_id,
  event.id,
  'primary',
  cycle.created_by,
  cycle.created_at,
  cycle.updated_at
from public.crm_booking_cycles as cycle
left join lateral (
  select booking_event.id
  from public.booking_events as booking_event
  where booking_event.photographer_id = cycle.photographer_id
    and booking_event.school_id = cycle.gallery_school_id
  order by booking_event.updated_at desc nulls last, booking_event.created_at desc, booking_event.id
  limit 1
) as event on true
where cycle.gallery_school_id is not null;

-- The existing request ledger gives this RPC durable, payload-fingerprinted
-- idempotency without introducing a second domain relationship table.
create or replace function public.crm_ensure_school_booking_job(
  p_photographer_id uuid,
  p_actor_user_id uuid,
  p_request_key text,
  p_payload_fingerprint text,
  p_gallery_school_id uuid,
  p_client_id uuid default null,
  p_location_id uuid default null,
  p_role text default 'primary',
  p_repair_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  school_row public.schools%rowtype;
  existing_job public.crm_booking_jobs%rowtype;
  selected_client_id uuid;
  selected_location_id uuid;
  selected_cycle_id uuid;
  selected_event_id uuid;
  selected_job_id uuid;
  selected_location_count integer;
  selected_year smallint;
  existing_cycle_year smallint;
  previous_cycle_id uuid;
  request_inserted boolean;
  existing_fingerprint text;
  bundle_result jsonb;
  created_client boolean := false;
begin
  if not exists (
    select 1
    from public.photographers as photographer
    where photographer.id = p_photographer_id
      and photographer.user_id = p_actor_user_id
  ) then
    raise exception 'CRM booking job owner mismatch' using errcode = '42501';
  end if;

  -- Serialize relationship/cycle repair within one photographer tenant. This
  -- dedicated advisory namespace avoids inverse target/source cycle locks when
  -- two jobs move clients or seasons at the same time, without blocking other
  -- photographers.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'crm_school_booking_job:' || p_photographer_id::text,
      0
    )
  );

  if char_length(btrim(coalesce(p_request_key, ''))) not between 8 and 200 then
    raise exception 'CRM booking job request key is invalid' using errcode = '22023';
  end if;
  if coalesce(p_payload_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'CRM booking job payload fingerprint is invalid' using errcode = '22023';
  end if;
  if coalesce(p_role, '') not in ('primary', 'retake', 'makeup', 'other') then
    raise exception 'CRM booking job role is invalid' using errcode = '22023';
  end if;
  if p_client_id is null and p_location_id is not null then
    raise exception 'A CRM client is required when assigning a campus' using errcode = '22023';
  end if;

  select school.* into school_row
  from public.schools as school
  where school.id = p_gallery_school_id
    and school.photographer_id = p_photographer_id
  for update;
  if school_row.id is null then
    raise exception 'School not found for CRM booking job' using errcode = '23503';
  end if;

  selected_year := coalesce(
    extract(year from school_row.shoot_date)::smallint,
    extract(year from timezone('utc', now()))::smallint
  );

  insert into public.crm_client_bundle_requests (
    photographer_id,
    request_key,
    payload_fingerprint,
    created_by
  ) values (
    p_photographer_id,
    btrim(p_request_key),
    p_payload_fingerprint,
    p_actor_user_id
  )
  on conflict (photographer_id, request_key) do nothing
  returning true into request_inserted;

  if not coalesce(request_inserted, false) then
    select request.result, request.payload_fingerprint
      into bundle_result, existing_fingerprint
    from public.crm_client_bundle_requests as request
    where request.photographer_id = p_photographer_id
      and request.request_key = btrim(p_request_key);
    if existing_fingerprint is distinct from p_payload_fingerprint then
      raise exception 'CRM booking job request key was reused with different data'
        using errcode = '22023';
    end if;
    if bundle_result is null then
      raise exception 'CRM booking job request is incomplete' using errcode = '40001';
    end if;
    -- Do not return the cached shape yet. A school job may have been created
    -- before its public booking event. Re-resolving the existing binding lets
    -- an exact retry safely attach that later event without creating a second
    -- CRM client, cycle, campus, or job.
  end if;

  select job.* into existing_job
  from public.crm_booking_jobs as job
  where job.photographer_id = p_photographer_id
    and job.gallery_school_id = p_gallery_school_id
  for update;

  if existing_job.id is not null then
    -- Lock the durable client before inspecting its campus set. Inserts into
    -- crm_locations must take a foreign-key key-share lock and therefore wait,
    -- so a one-campus auto-assignment cannot race a second-campus creation.
    perform 1
    from public.crm_clients as client
    where client.id = existing_job.client_id
      and client.photographer_id = p_photographer_id
    for update;
    if not found then
      raise exception 'Education CRM client not found' using errcode = '23503';
    end if;

    -- The linked cycle season is durable history and is also used when the
    -- legacy school has no shoot date. Lock it before comparing or reusing it
    -- so a concurrent generic cycle edit cannot make the job drift seasons.
    select cycle.season_year into existing_cycle_year
    from public.crm_booking_cycles as cycle
    where cycle.id = existing_job.booking_cycle_id
      and cycle.client_id = existing_job.client_id
      and cycle.photographer_id = p_photographer_id
    for update;

    -- A legacy school may not have a shoot date. Its linked cycle is the
    -- durable historical season; never move it to the wall-clock year merely
    -- because ensure/repair was retried later.
    if school_row.shoot_date is null then
      selected_year := existing_cycle_year;
    end if;
    if p_client_id is not null and existing_job.client_id <> p_client_id then
      raise exception 'School is already linked to another CRM client' using errcode = '23505';
    end if;
    if p_location_id is not null then
      select location.id into selected_location_id
      from public.crm_locations as location
      where location.id = p_location_id
        and location.client_id = existing_job.client_id
        and location.photographer_id = p_photographer_id;
      if selected_location_id is null then
        raise exception 'CRM campus does not belong to this client' using errcode = '23503';
      end if;
      if existing_job.location_id is null then
        update public.crm_booking_jobs
        set location_id = selected_location_id
        where id = existing_job.id
        returning * into existing_job;
      elsif existing_job.location_id <> selected_location_id then
        raise exception 'School is already linked to another CRM campus' using errcode = '23505';
      end if;
    elsif existing_job.location_id is null then
      select count(*) into selected_location_count
      from public.crm_locations as location
      where location.client_id = existing_job.client_id
        and location.photographer_id = p_photographer_id;
      if selected_location_count > 1 then
        raise exception 'CRM campus is required when this client has multiple campuses'
          using errcode = '22023';
      elsif selected_location_count = 1 then
        select location.id into selected_location_id
        from public.crm_locations as location
        where location.client_id = existing_job.client_id
          and location.photographer_id = p_photographer_id
        limit 1;
        update public.crm_booking_jobs
        set location_id = selected_location_id
        where id = existing_job.id
        returning * into existing_job;
      end if;
    end if;
    if existing_job.role <> p_role then
      raise exception 'School is already linked with another booking role' using errcode = '23505';
    end if;

    if existing_cycle_year is distinct from selected_year then
      previous_cycle_id := existing_job.booking_cycle_id;
      select cycle.id into selected_cycle_id
      from public.crm_booking_cycles as cycle
      where cycle.client_id = existing_job.client_id
        and cycle.photographer_id = p_photographer_id
        and cycle.season_year = selected_year
        and cycle.project_id is null
      order by
        case
          when cycle.cycle_key = selected_year::text then 0
          when cycle.cycle_key = 'annual' then 1
          else 2
        end,
        cycle.created_at asc,
        cycle.id
      limit 1
      for update;

      -- The legacy cycle table permits only one row to carry this gallery
      -- source. Release it transactionally before a different-year cycle can
      -- adopt it; a later failure rolls this change back with the transaction.
      if selected_cycle_id is distinct from previous_cycle_id then
        update public.crm_booking_cycles as previous_cycle
        set gallery_school_id = null
        where previous_cycle.id = previous_cycle_id
          and previous_cycle.photographer_id = p_photographer_id
          and previous_cycle.client_id = existing_job.client_id
          and previous_cycle.gallery_school_id = existing_job.gallery_school_id;
      end if;

      if selected_cycle_id is null then
        insert into public.crm_booking_cycles (
          photographer_id,
          client_id,
          gallery_school_id,
          season_year,
          cycle_key,
          label,
          status,
          booked_at,
          shoot_start_at,
          currency,
          created_by
        ) values (
          p_photographer_id,
          existing_job.client_id,
          p_gallery_school_id,
          selected_year,
          'school_' || left(replace(p_gallery_school_id::text, '-', ''), 32),
          selected_year::text || ' season',
          'booked',
          timezone('utc', now()),
          school_row.shoot_date::timestamptz,
          'CAD',
          p_actor_user_id
        )
        on conflict (client_id, season_year, cycle_key) do update
        set
          status = case
            when crm_booking_cycles.status = 'completed' then crm_booking_cycles.status
            else 'booked'
          end,
          booked_at = coalesce(crm_booking_cycles.booked_at, timezone('utc', now())),
          shoot_start_at = coalesce(
            crm_booking_cycles.shoot_start_at,
            excluded.shoot_start_at
          ),
          gallery_school_id = coalesce(
            crm_booking_cycles.gallery_school_id,
            excluded.gallery_school_id
          )
        where crm_booking_cycles.project_id is null
          and (
            crm_booking_cycles.gallery_school_id is null
            or crm_booking_cycles.gallery_school_id = excluded.gallery_school_id
          )
        returning id into selected_cycle_id;
        if selected_cycle_id is null then
          raise exception 'CRM school cycle key conflicts with another source'
            using errcode = '23505';
        end if;
      else
        update public.crm_booking_cycles as cycle
        set
          status = case when cycle.status = 'completed' then cycle.status else 'booked' end,
          booked_at = coalesce(cycle.booked_at, timezone('utc', now())),
          shoot_start_at = coalesce(cycle.shoot_start_at, school_row.shoot_date::timestamptz),
          gallery_school_id = coalesce(cycle.gallery_school_id, p_gallery_school_id)
        where cycle.id = selected_cycle_id;
      end if;

      update public.crm_booking_jobs
      set booking_cycle_id = selected_cycle_id
      where id = existing_job.id
      returning * into existing_job;

      -- Neutralize only the untouched, generated source cycle after its only
      -- job moved. Shared or manually meaningful CRM cycles remain history.
      update public.crm_booking_cycles as previous_cycle
      set
        gallery_school_id = null,
        status = 'not_contacted',
        booked_at = null,
        shoot_start_at = null
      where previous_cycle.id = previous_cycle_id
        and previous_cycle.id <> selected_cycle_id
        and previous_cycle.photographer_id = p_photographer_id
        and previous_cycle.client_id = existing_job.client_id
        and previous_cycle.gallery_school_id is null
        and previous_cycle.status = 'booked'
        and previous_cycle.cycle_key in (
          previous_cycle.season_year::text,
          'school_' || left(replace(existing_job.gallery_school_id::text, '-', ''), 32)
        )
        and coalesce(previous_cycle.label, '') = previous_cycle.season_year::text || ' season'
        and previous_cycle.agreement_id is null
        and previous_cycle.project_id is null
        and previous_cycle.target_contact_on is null
        and previous_cycle.last_contacted_at is null
        and previous_cycle.next_follow_up_at is null
        and previous_cycle.shoot_end_at is null
        and previous_cycle.student_count_estimate is null
        and previous_cycle.student_count_actual is null
        and previous_cycle.quoted_amount_cents is null
        and previous_cycle.booked_amount_cents is null
        and previous_cycle.lost_reason is null
        and nullif(btrim(coalesce(previous_cycle.notes, '')), '') is null
        and not exists (
          select 1 from public.crm_booking_jobs as other_job
          where other_job.booking_cycle_id = previous_cycle.id
        )
        and not exists (
          select 1 from public.crm_tasks as task
          where task.booking_cycle_id = previous_cycle.id
        )
        and not exists (
          select 1 from public.crm_email_outbox as outbox
          where outbox.booking_cycle_id = previous_cycle.id
        )
        and not exists (
          select 1 from public.crm_activities as activity
          where activity.booking_cycle_id = previous_cycle.id
            and not (
              activity.activity_type = 'status_change'
              and activity.summary = 'Booking cycle created as booked'
              and activity.details = jsonb_build_object('to', 'booked')
              and activity.source = 'system'
              and activity.created_by is null
            )
        )
        and not exists (
          select 1 from public.crm_automation_runs as automation_run
          where automation_run.booking_cycle_id = previous_cycle.id
        );
    end if;

    if existing_job.booking_event_id is null then
      select booking_event.id into selected_event_id
      from public.booking_events as booking_event
      where booking_event.photographer_id = p_photographer_id
        and booking_event.school_id = p_gallery_school_id
      order by booking_event.updated_at desc nulls last, booking_event.created_at desc, booking_event.id
      limit 1;
      if selected_event_id is not null then
        update public.crm_booking_jobs
        set booking_event_id = selected_event_id
        where id = existing_job.id
        returning * into existing_job;
      end if;
    end if;

    bundle_result := jsonb_build_object(
      'jobId', existing_job.id,
      'clientId', existing_job.client_id,
      'locationId', existing_job.location_id,
      'bookingCycleId', existing_job.booking_cycle_id,
      'gallerySchoolId', existing_job.gallery_school_id,
      'bookingEventId', existing_job.booking_event_id,
      'createdClient', false
    );
    update public.crm_client_bundle_requests
    set
      result = bundle_result,
      completed_at = timezone('utc', now())
    where photographer_id = p_photographer_id
      and request_key = btrim(p_request_key);
    return bundle_result;
  end if;

  if coalesce(p_repair_only, false) then
    raise exception 'CRM booking job repair target was not found' using errcode = '23503';
  end if;

  if p_client_id is null then
    insert into public.crm_clients (
      photographer_id,
      kind,
      display_name,
      default_timezone,
      created_by
    ) values (
      p_photographer_id,
      'school',
      coalesce(nullif(btrim(school_row.school_name), ''), 'Untitled school'),
      'America/Toronto',
      p_actor_user_id
    ) returning id into selected_client_id;
    created_client := true;

    insert into public.crm_locations (
      photographer_id,
      client_id,
      label,
      country_code,
      timezone,
      is_primary
    ) values (
      p_photographer_id,
      selected_client_id,
      'Main campus',
      'CA',
      'America/Toronto',
      true
    ) returning id into selected_location_id;
  else
    select client.id into selected_client_id
    from public.crm_clients as client
    where client.id = p_client_id
      and client.photographer_id = p_photographer_id
      and client.archived_at is null
      and client.kind in ('school', 'college', 'university', 'daycare', 'montessori')
    for update;
    if selected_client_id is null then
      raise exception 'Education CRM client not found' using errcode = '23503';
    end if;

    if p_location_id is not null then
      select location.id into selected_location_id
      from public.crm_locations as location
      where location.id = p_location_id
        and location.client_id = selected_client_id
        and location.photographer_id = p_photographer_id;
      if selected_location_id is null then
        raise exception 'CRM campus does not belong to this client' using errcode = '23503';
      end if;
    else
      select count(*) into selected_location_count
      from public.crm_locations as location
      where location.client_id = selected_client_id
        and location.photographer_id = p_photographer_id;
      if selected_location_count > 1 then
        raise exception 'CRM campus is required when this client has multiple campuses'
          using errcode = '22023';
      elsif selected_location_count = 1 then
        select location.id into selected_location_id
        from public.crm_locations as location
        where location.client_id = selected_client_id
          and location.photographer_id = p_photographer_id
        limit 1;
      end if;
    end if;
  end if;

  select cycle.id into selected_cycle_id
  from public.crm_booking_cycles as cycle
  where cycle.client_id = selected_client_id
    and cycle.photographer_id = p_photographer_id
    and cycle.season_year = selected_year
    and cycle.project_id is null
  order by
    case
      when cycle.cycle_key = selected_year::text then 0
      when cycle.cycle_key = 'annual' then 1
      else 2
    end,
    cycle.created_at asc,
    cycle.id
  limit 1
  for update;

  if selected_cycle_id is null then
    insert into public.crm_booking_cycles (
      photographer_id,
      client_id,
      gallery_school_id,
      season_year,
      cycle_key,
      label,
      status,
      booked_at,
      shoot_start_at,
      currency,
      created_by
    ) values (
      p_photographer_id,
      selected_client_id,
      p_gallery_school_id,
      selected_year,
      'school_' || left(replace(p_gallery_school_id::text, '-', ''), 32),
      selected_year::text || ' season',
      'booked',
      timezone('utc', now()),
      school_row.shoot_date::timestamptz,
      'CAD',
      p_actor_user_id
    )
    on conflict (client_id, season_year, cycle_key) do update
    set
      status = case
        when crm_booking_cycles.status = 'completed' then crm_booking_cycles.status
        else 'booked'
      end,
      booked_at = coalesce(crm_booking_cycles.booked_at, timezone('utc', now())),
      shoot_start_at = coalesce(
        crm_booking_cycles.shoot_start_at,
        excluded.shoot_start_at
      ),
      gallery_school_id = coalesce(
        crm_booking_cycles.gallery_school_id,
        excluded.gallery_school_id
      )
    where crm_booking_cycles.project_id is null
      and (
        crm_booking_cycles.gallery_school_id is null
        or crm_booking_cycles.gallery_school_id = excluded.gallery_school_id
      )
    returning id into selected_cycle_id;
    if selected_cycle_id is null then
      raise exception 'CRM school cycle key conflicts with another source'
        using errcode = '23505';
    end if;
  else
    update public.crm_booking_cycles as cycle
    set
      status = case when cycle.status = 'completed' then cycle.status else 'booked' end,
      booked_at = coalesce(cycle.booked_at, timezone('utc', now())),
      shoot_start_at = coalesce(cycle.shoot_start_at, school_row.shoot_date::timestamptz),
      gallery_school_id = coalesce(cycle.gallery_school_id, p_gallery_school_id)
    where cycle.id = selected_cycle_id;
  end if;

  select booking_event.id into selected_event_id
  from public.booking_events as booking_event
  where booking_event.photographer_id = p_photographer_id
    and booking_event.school_id = p_gallery_school_id
  order by booking_event.updated_at desc nulls last, booking_event.created_at desc, booking_event.id
  limit 1;

  insert into public.crm_booking_jobs (
    photographer_id,
    client_id,
    location_id,
    booking_cycle_id,
    gallery_school_id,
    booking_event_id,
    role,
    created_by
  ) values (
    p_photographer_id,
    selected_client_id,
    selected_location_id,
    selected_cycle_id,
    p_gallery_school_id,
    selected_event_id,
    p_role,
    p_actor_user_id
  )
  returning id into selected_job_id;

  bundle_result := jsonb_build_object(
    'jobId', selected_job_id,
    'clientId', selected_client_id,
    'locationId', selected_location_id,
    'bookingCycleId', selected_cycle_id,
    'gallerySchoolId', p_gallery_school_id,
    'bookingEventId', selected_event_id,
    'createdClient', created_client
  );
  update public.crm_client_bundle_requests
  set
    result = bundle_result,
    completed_at = timezone('utc', now())
  where photographer_id = p_photographer_id
    and request_key = btrim(p_request_key);
  return bundle_result;
end;
$$;

-- Owner-directed repair for a deliberately selected CRM relationship. This
-- never name-matches, unlinks, or recreates the gallery/event/payment source;
-- it only moves the permanent CRM client/campus/cycle side of an existing job.
create or replace function public.crm_reassign_school_booking_job(
  p_photographer_id uuid,
  p_actor_user_id uuid,
  p_job_id uuid,
  p_client_id uuid,
  p_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  existing_job public.crm_booking_jobs%rowtype;
  school_row public.schools%rowtype;
  selected_cycle_id uuid;
  selected_school_id uuid;
  selected_year smallint;
  previous_cycle_id uuid;
  previous_client_id uuid;
  bundle_result jsonb;
begin
  if not exists (
    select 1
    from public.photographers as photographer
    where photographer.id = p_photographer_id
      and photographer.user_id = p_actor_user_id
  ) then
    raise exception 'CRM booking job owner mismatch' using errcode = '42501';
  end if;


  -- Use the same tenant-scoped transaction mutex as ensure so cross-year and
  -- cross-client moves cannot acquire previous/target cycles in inverse order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'crm_school_booking_job:' || p_photographer_id::text,
      0
    )
  );

  if p_job_id is null or p_client_id is null or p_location_id is null then
    raise exception 'CRM job, education client, and campus are required'
      using errcode = '22023';
  end if;

  -- Read the immutable source ID first without taking a row lock, then lock in
  -- the same school -> job order as crm_ensure_school_booking_job. The second
  -- lookup revalidates ownership/source while taking the actual job lock.
  select job.gallery_school_id into selected_school_id
  from public.crm_booking_jobs as job
  where job.id = p_job_id
    and job.photographer_id = p_photographer_id;
  if selected_school_id is null then
    raise exception 'CRM booking job was not found' using errcode = '23503';
  end if;

  select school.* into school_row
  from public.schools as school
  where school.id = selected_school_id
    and school.photographer_id = p_photographer_id
  for update;
  if school_row.id is null then
    raise exception 'School not found for CRM booking job' using errcode = '23503';
  end if;

  select job.* into existing_job
  from public.crm_booking_jobs as job
  where job.id = p_job_id
    and job.photographer_id = p_photographer_id
    and job.gallery_school_id = selected_school_id
  for update;
  if existing_job.id is null then
    raise exception 'CRM booking job was not found' using errcode = '23503';
  end if;

  perform 1
  from public.crm_clients as client
  where client.id = p_client_id
    and client.photographer_id = p_photographer_id
    and client.archived_at is null
    and client.kind in ('school', 'college', 'university', 'daycare', 'montessori')
  for update;
  if not found then
    raise exception 'Education CRM client not found' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.crm_locations as location
    where location.id = p_location_id
      and location.client_id = p_client_id
      and location.photographer_id = p_photographer_id
  ) then
    raise exception 'CRM campus does not belong to this client' using errcode = '23503';
  end if;

  if school_row.shoot_date is null then
    select cycle.season_year into selected_year
    from public.crm_booking_cycles as cycle
    where cycle.id = existing_job.booking_cycle_id
      and cycle.client_id = existing_job.client_id
      and cycle.photographer_id = p_photographer_id
    for update;
  else
    selected_year := extract(year from school_row.shoot_date)::smallint;
  end if;
  previous_cycle_id := existing_job.booking_cycle_id;
  previous_client_id := existing_job.client_id;

  -- A campus-only repair must keep its existing annual-history row. Resolve a
  -- different cycle only when the client or shoot year actually changed.
  select cycle.id into selected_cycle_id
  from public.crm_booking_cycles as cycle
  where cycle.id = previous_cycle_id
    and cycle.client_id = p_client_id
    and cycle.photographer_id = p_photographer_id
    and cycle.season_year = selected_year
    and cycle.project_id is null
  for update;

  if selected_cycle_id is null then
    select cycle.id into selected_cycle_id
    from public.crm_booking_cycles as cycle
    where cycle.client_id = p_client_id
      and cycle.photographer_id = p_photographer_id
      and cycle.season_year = selected_year
      and cycle.project_id is null
    order by
      case
        when cycle.cycle_key = selected_year::text then 0
        when cycle.cycle_key = 'annual' then 1
        else 2
      end,
      cycle.created_at asc,
      cycle.id
    limit 1
    for update;
  end if;

  -- crm_booking_cycles has a unique gallery source. Release the source only
  -- when this exact job is moving to another cycle; all changes are atomic.
  if selected_cycle_id is distinct from previous_cycle_id then
    update public.crm_booking_cycles as previous_cycle
    set gallery_school_id = null
    where previous_cycle.id = previous_cycle_id
      and previous_cycle.photographer_id = p_photographer_id
      and previous_cycle.client_id = previous_client_id
      and previous_cycle.gallery_school_id = existing_job.gallery_school_id;
  end if;

  if selected_cycle_id is null then
    insert into public.crm_booking_cycles (
      photographer_id,
      client_id,
      gallery_school_id,
      season_year,
      cycle_key,
      label,
      status,
      booked_at,
      shoot_start_at,
      currency,
      created_by
    ) values (
      p_photographer_id,
      p_client_id,
      existing_job.gallery_school_id,
      selected_year,
      'school_' || left(replace(existing_job.gallery_school_id::text, '-', ''), 32),
      selected_year::text || ' season',
      'booked',
      timezone('utc', now()),
      school_row.shoot_date::timestamptz,
      'CAD',
      p_actor_user_id
    )
    on conflict (client_id, season_year, cycle_key) do update
    set
      status = case
        when crm_booking_cycles.status = 'completed' then crm_booking_cycles.status
        else 'booked'
      end,
      booked_at = coalesce(crm_booking_cycles.booked_at, timezone('utc', now())),
      shoot_start_at = coalesce(
        crm_booking_cycles.shoot_start_at,
        excluded.shoot_start_at
      ),
      gallery_school_id = coalesce(
        crm_booking_cycles.gallery_school_id,
        excluded.gallery_school_id
      )
    where crm_booking_cycles.project_id is null
      and (
        crm_booking_cycles.gallery_school_id is null
        or crm_booking_cycles.gallery_school_id = excluded.gallery_school_id
      )
    returning id into selected_cycle_id;
    if selected_cycle_id is null then
      raise exception 'CRM school cycle key conflicts with another source'
        using errcode = '23505';
    end if;
  else
    update public.crm_booking_cycles as cycle
    set
      status = case when cycle.status = 'completed' then cycle.status else 'booked' end,
      booked_at = coalesce(cycle.booked_at, timezone('utc', now())),
      shoot_start_at = coalesce(cycle.shoot_start_at, school_row.shoot_date::timestamptz),
      gallery_school_id = coalesce(cycle.gallery_school_id, existing_job.gallery_school_id)
    where cycle.id = selected_cycle_id;
  end if;

  update public.crm_booking_jobs
  set
    client_id = p_client_id,
    location_id = p_location_id,
    booking_cycle_id = selected_cycle_id
  where id = existing_job.id
    and photographer_id = p_photographer_id
  returning * into existing_job;

  -- Retire only the empty generated cycle that this job has just left. A
  -- shared cycle or any cycle with real pipeline/history data is preserved.
  update public.crm_booking_cycles as previous_cycle
  set
    gallery_school_id = null,
    status = 'not_contacted',
    booked_at = null,
    shoot_start_at = null
  where previous_cycle.id = previous_cycle_id
    and previous_cycle.id <> selected_cycle_id
    and previous_cycle.photographer_id = p_photographer_id
    and previous_cycle.client_id = previous_client_id
    and previous_cycle.gallery_school_id is null
    and previous_cycle.status = 'booked'
    and previous_cycle.cycle_key in (
      previous_cycle.season_year::text,
      'school_' || left(replace(existing_job.gallery_school_id::text, '-', ''), 32)
    )
    and coalesce(previous_cycle.label, '') = previous_cycle.season_year::text || ' season'
    and previous_cycle.agreement_id is null
    and previous_cycle.project_id is null
    and previous_cycle.target_contact_on is null
    and previous_cycle.last_contacted_at is null
    and previous_cycle.next_follow_up_at is null
    and previous_cycle.shoot_end_at is null
    and previous_cycle.student_count_estimate is null
    and previous_cycle.student_count_actual is null
    and previous_cycle.quoted_amount_cents is null
    and previous_cycle.booked_amount_cents is null
    and previous_cycle.lost_reason is null
    and nullif(btrim(coalesce(previous_cycle.notes, '')), '') is null
    and not exists (
      select 1 from public.crm_booking_jobs as other_job
      where other_job.booking_cycle_id = previous_cycle.id
    )
    and not exists (
      select 1 from public.crm_tasks as task
      where task.booking_cycle_id = previous_cycle.id
    )
    and not exists (
      select 1 from public.crm_email_outbox as outbox
      where outbox.booking_cycle_id = previous_cycle.id
    )
    and not exists (
      select 1 from public.crm_activities as activity
      where activity.booking_cycle_id = previous_cycle.id
        and not (
          activity.activity_type = 'status_change'
          and activity.summary = 'Booking cycle created as booked'
          and activity.details = jsonb_build_object('to', 'booked')
          and activity.source = 'system'
          and activity.created_by is null
        )
    )
    and not exists (
      select 1 from public.crm_automation_runs as automation_run
      where automation_run.booking_cycle_id = previous_cycle.id
    );

  bundle_result := jsonb_build_object(
    'jobId', existing_job.id,
    'clientId', existing_job.client_id,
    'locationId', existing_job.location_id,
    'bookingCycleId', existing_job.booking_cycle_id,
    'gallerySchoolId', existing_job.gallery_school_id,
    'bookingEventId', existing_job.booking_event_id,
    'createdClient', false
  );
  return bundle_result;
end;
$$;

revoke all on function public.crm_ensure_school_booking_job(
  uuid, uuid, text, text, uuid, uuid, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.crm_ensure_school_booking_job(
  uuid, uuid, text, text, uuid, uuid, uuid, text, boolean
) to service_role;
revoke all on function public.crm_reassign_school_booking_job(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.crm_reassign_school_booking_job(
  uuid, uuid, uuid, uuid, uuid
) to service_role;

alter table public.crm_booking_jobs enable row level security;
alter table public.crm_booking_jobs force row level security;
revoke all on table public.crm_booking_jobs from public, anon, authenticated;
create policy crm_booking_jobs_tenant_select
  on public.crm_booking_jobs
  for select
  to authenticated
  using (public.crm_owns_photographer(photographer_id));
grant select on table public.crm_booking_jobs to authenticated;
grant all on table public.crm_booking_jobs to service_role;

comment on table public.crm_booking_jobs is
  'Tenant-safe links from permanent CRM clients/campuses and annual cycles to school gallery jobs and optional public booking events.';

commit;
