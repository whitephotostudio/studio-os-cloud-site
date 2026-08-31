-- Durable, reusable CRM campus profiles and private location photos.
--
-- This migration is intentionally additive. Existing school/project schedule
-- values remain immutable per-job snapshots; the permanent CRM profile is a
-- separate source that can be reused when a future booking job is created.

begin;

alter table public.crm_locations
  add column arrival_instructions text,
  add column parking_instructions text,
  add column setup_instructions text,
  add column internal_notes text,
  add column latitude double precision,
  add column longitude double precision,
  add column place_id text,
  add column archived_at timestamptz,
  add constraint crm_locations_arrival_instructions_length_check
    check (arrival_instructions is null or char_length(arrival_instructions) <= 10000),
  add constraint crm_locations_parking_instructions_length_check
    check (parking_instructions is null or char_length(parking_instructions) <= 10000),
  add constraint crm_locations_setup_instructions_length_check
    check (setup_instructions is null or char_length(setup_instructions) <= 20000),
  add constraint crm_locations_internal_notes_length_check
    check (internal_notes is null or char_length(internal_notes) <= 20000),
  add constraint crm_locations_place_id_length_check
    check (place_id is null or char_length(btrim(place_id)) between 1 and 500),
  add constraint crm_locations_coordinates_pair_check
    check ((latitude is null) = (longitude is null)),
  add constraint crm_locations_latitude_check
    check (latitude is null or latitude between -90 and 90),
  add constraint crm_locations_longitude_check
    check (longitude is null or longitude between -180 and 180);

create index crm_locations_tenant_active_idx
  on public.crm_locations (photographer_id, client_id, updated_at desc)
  where archived_at is null;

-- Archived campuses are retained for history, but no active contact or future
-- booking may be assigned to one. The API performs the same check for a clear
-- error; these triggers are the final database-level defense for every caller.
create or replace function public.crm_require_active_location_reference()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.location_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.crm_locations as location
    where location.id = new.location_id
      and location.client_id = new.client_id
      and location.photographer_id = new.photographer_id
      and location.archived_at is null
  ) then
    raise exception 'An active CRM location is required'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_require_active_location_reference()
  from public, anon, authenticated;

create trigger crm_contacts_require_active_location
before insert or update of location_id, client_id, photographer_id
on public.crm_contacts
for each row execute function public.crm_require_active_location_reference();

create trigger crm_booking_jobs_require_active_location
before insert or update of location_id, client_id, photographer_id
on public.crm_booking_jobs
for each row execute function public.crm_require_active_location_reference();

-- Reuse client-facing directions that the studio already reviewed and sent in
-- a saved booking campaign. This is intentionally blank-only: a location
-- profile entered by staff is authoritative and is never overwritten by an
-- older event. A legacy full address is kept as one line when the structured
-- location did not yet have an address.
with reusable_booking_campaign as (
  select distinct on (job.location_id)
    job.location_id,
    job.client_id,
    job.photographer_id,
    nullif(btrim(delivery.payload ->> 'directions'), '') as directions,
    nullif(btrim(delivery.payload ->> 'address'), '') as address
  from public.crm_booking_jobs as job
  join public.project_email_deliveries as delivery
    on delivery.photographer_id = job.photographer_id
   and delivery.email_type = 'booking_campaign_template'
   and delivery.status = 'template'
   and delivery.dedupe_key = 'booking-campaign-template:' || job.booking_event_id::text
  where job.location_id is not null
    and (
      nullif(btrim(delivery.payload ->> 'directions'), '') is not null
      or nullif(btrim(delivery.payload ->> 'address'), '') is not null
    )
  order by job.location_id, delivery.sent_at desc, delivery.id desc
)
update public.crm_locations as location
set
  arrival_instructions = case
    when nullif(btrim(location.arrival_instructions), '') is null
      then left(campaign.directions, 10000)
    else location.arrival_instructions
  end,
  address_line1 = case
    when nullif(btrim(location.address_line1), '') is null
      then left(campaign.address, 500)
    else location.address_line1
  end
from reusable_booking_campaign as campaign
where location.id = campaign.location_id
  and location.client_id = campaign.client_id
  and location.photographer_id = campaign.photographer_id;

create table public.crm_location_photos (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  client_id uuid not null,
  location_id uuid not null,
  object_key text not null,
  filename text not null,
  content_type text not null default 'image/jpeg'
    check (content_type = 'image/jpeg'),
  byte_size integer not null check (byte_size between 1 and 1310720),
  width integer check (width is null or width between 1 and 2000),
  height integer check (height is null or height between 1 and 2000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  audience text not null default 'client'
    check (audience in ('client', 'staff')),
  category text not null default 'other'
    check (category in (
      'exterior', 'entrance', 'parking', 'loading', 'room', 'setup', 'other'
    )),
  caption text check (caption is null or char_length(caption) <= 1000),
  alt_text text check (alt_text is null or char_length(alt_text) <= 500),
  sort_order smallint not null default 0 check (sort_order between 0 and 999),
  request_key text not null
    check (char_length(btrim(request_key)) between 8 and 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_location_photos_location_client_tenant_fkey
    foreign key (location_id, client_id, photographer_id)
    references public.crm_locations(id, client_id, photographer_id) on delete cascade,
  constraint crm_location_photos_id_location_tenant_key
    unique (id, location_id, photographer_id),
  constraint crm_location_photos_object_key_key unique (object_key),
  constraint crm_location_photos_request_key_key unique (photographer_id, request_key),
  constraint crm_location_photos_filename_check
    check (char_length(btrim(filename)) between 1 and 255),
  constraint crm_location_photos_private_object_key_check
    check (
      object_key like (
        'crm-locations/' || photographer_id::text || '/' || location_id::text || '/%.jpg'
      )
      and object_key not like '%..%'
      and object_key !~ '[?#[:cntrl:]]'
      and char_length(object_key) <= 500
    )
);

create index crm_location_photos_location_order_idx
  on public.crm_location_photos (
    photographer_id,
    location_id,
    audience,
    sort_order,
    created_at,
    id
  );

create trigger crm_location_photos_touch_updated_at
before update on public.crm_location_photos
for each row execute function public.crm_touch_updated_at();

-- Serialize inserts on the parent campus. This makes the 12-photo quota exact
-- even when two serverless requests upload at the same time.
create or replace function public.crm_enforce_location_photo_limit()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  current_count integer;
begin
  perform 1
  from public.crm_locations as location
  where location.id = new.location_id
    and location.client_id = new.client_id
    and location.photographer_id = new.photographer_id
    and location.archived_at is null
  for update;
  if not found then
    raise exception 'Active CRM location not found for photo'
      using errcode = '23503';
  end if;

  select count(*)::integer into current_count
  from public.crm_location_photos as photo
  where photo.photographer_id = new.photographer_id
    and photo.location_id = new.location_id;

  if current_count >= 12 then
    raise exception 'A CRM location can have at most 12 photos'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_enforce_location_photo_limit()
  from public, anon, authenticated;

create trigger crm_location_photos_limit
before insert on public.crm_location_photos
for each row execute function public.crm_enforce_location_photo_limit();

-- Contact/location removal is centralized so foreign-key errors never become
-- the UI contract. Unreferenced rows are deleted; rows used by durable history
-- are retired, keeping exact booking and communication relationships intact.
create or replace function public.crm_remove_location_or_contact(
  p_photographer_id uuid,
  p_actor_user_id uuid,
  p_resource text,
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  selected_client_id uuid;
  selected_is_primary boolean;
  has_history boolean;
  disposition text;
  result_message text;
  photo_object_keys jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1
    from public.photographers as photographer
    where photographer.id = p_photographer_id
      and photographer.user_id = p_actor_user_id
  ) then
    raise exception 'CRM removal owner mismatch' using errcode = '42501';
  end if;
  if p_resource not in ('location', 'contact') then
    raise exception 'CRM removal resource is invalid' using errcode = '22023';
  end if;

  if p_resource = 'location' then
    select location.client_id, location.is_primary
      into selected_client_id, selected_is_primary
    from public.crm_locations as location
    where location.id = p_id
      and location.photographer_id = p_photographer_id
      and location.archived_at is null;
    if not found then
      raise exception 'Active CRM location not found' using errcode = 'P0002';
    end if;

    perform 1
    from public.crm_clients as client
    where client.id = selected_client_id
      and client.photographer_id = p_photographer_id
    for update;

    -- Primary switches lock client then child; use the same order here to
    -- avoid a remove/promote deadlock under concurrent requests.
    select location.client_id, location.is_primary
      into selected_client_id, selected_is_primary
    from public.crm_locations as location
    where location.id = p_id
      and location.photographer_id = p_photographer_id
      and location.archived_at is null
    for update;
    if not found then
      raise exception 'Active CRM location changed during removal'
        using errcode = '40001';
    end if;

    select exists (
      select 1
      from public.crm_booking_jobs as job
      where job.location_id = p_id
        and job.client_id = selected_client_id
        and job.photographer_id = p_photographer_id
      union all
      select 1
      from public.crm_contacts as historical_contact
      where historical_contact.location_id = p_id
        and historical_contact.client_id = selected_client_id
        and historical_contact.photographer_id = p_photographer_id
        and historical_contact.archived_at is not null
      union all
      select 1
      from public.crm_location_photos as photo
      where photo.location_id = p_id
        and photo.client_id = selected_client_id
        and photo.photographer_id = p_photographer_id
    ) into has_history;

    -- A contact survives a campus removal. Clear the optional assignment so an
    -- active contact never points at a campus hidden from the active dashboard.
    update public.crm_contacts as contact
    set location_id = null
    where contact.location_id = p_id
      and contact.client_id = selected_client_id
      and contact.photographer_id = p_photographer_id
      and contact.archived_at is null;

    if has_history then
      update public.crm_locations as location
      set archived_at = timezone('utc', now()), is_primary = false
      where location.id = p_id
        and location.photographer_id = p_photographer_id;
      disposition := 'archived';
      result_message := 'Location archived because booking, contact, or photo history uses it.';
    else
      select coalesce(jsonb_agg(photo.object_key order by photo.created_at, photo.id), '[]'::jsonb)
        into photo_object_keys
      from public.crm_location_photos as photo
      where photo.location_id = p_id
        and photo.photographer_id = p_photographer_id;

      delete from public.crm_locations as location
      where location.id = p_id
        and location.photographer_id = p_photographer_id;
      disposition := 'deleted';
      result_message := 'Unused location deleted.';
    end if;

    if selected_is_primary then
      update public.crm_locations as replacement
      set is_primary = true
      where replacement.id = (
        select candidate.id
        from public.crm_locations as candidate
        where candidate.client_id = selected_client_id
          and candidate.photographer_id = p_photographer_id
          and candidate.archived_at is null
          and not candidate.is_primary
        order by candidate.created_at, candidate.id
        limit 1
      );
    end if;
  else
    select contact.client_id, contact.is_primary
      into selected_client_id, selected_is_primary
    from public.crm_contacts as contact
    where contact.id = p_id
      and contact.photographer_id = p_photographer_id
      and contact.archived_at is null;
    if not found then
      raise exception 'Active CRM contact not found' using errcode = 'P0002';
    end if;

    perform 1
    from public.crm_clients as client
    where client.id = selected_client_id
      and client.photographer_id = p_photographer_id
    for update;

    select contact.client_id, contact.is_primary
      into selected_client_id, selected_is_primary
    from public.crm_contacts as contact
    where contact.id = p_id
      and contact.photographer_id = p_photographer_id
      and contact.archived_at is null
    for update;
    if not found then
      raise exception 'Active CRM contact changed during removal'
        using errcode = '40001';
    end if;

    select exists (
      select 1 from public.crm_tasks as task
      where task.contact_id = p_id and task.photographer_id = p_photographer_id
      union all
      select 1 from public.crm_email_outbox as outbox
      where outbox.contact_id = p_id and outbox.photographer_id = p_photographer_id
      union all
      select 1 from public.crm_activities as activity
      where activity.contact_id = p_id and activity.photographer_id = p_photographer_id
    ) into has_history;

    if has_history then
      update public.crm_contacts as contact
      set archived_at = timezone('utc', now()), is_primary = false
      where contact.id = p_id
        and contact.photographer_id = p_photographer_id;
      disposition := 'archived';
      result_message := 'Contact archived because CRM history uses it.';
    else
      delete from public.crm_contacts as contact
      where contact.id = p_id
        and contact.photographer_id = p_photographer_id;
      disposition := 'deleted';
      result_message := 'Unused contact deleted.';
    end if;

    if selected_is_primary then
      update public.crm_contacts as replacement
      set is_primary = true
      where replacement.id = (
        select candidate.id
        from public.crm_contacts as candidate
        where candidate.client_id = selected_client_id
          and candidate.photographer_id = p_photographer_id
          and candidate.archived_at is null
          and not candidate.is_primary
        order by candidate.created_at, candidate.id
        limit 1
      );
    end if;
  end if;

  return jsonb_build_object(
    'id', p_id,
    'clientId', selected_client_id,
    'disposition', disposition,
    'message', result_message,
    'photoObjectKeys', photo_object_keys
  );
end;
$$;

revoke all on function public.crm_remove_location_or_contact(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.crm_remove_location_or_contact(uuid, uuid, text, uuid)
  to service_role;

-- Retired campuses must not be promoted to primary.
create or replace function public.crm_set_primary_location(
  p_photographer_id uuid,
  p_client_id uuid,
  p_location_id uuid,
  p_actor_user_id uuid
)
returns public.crm_locations
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target public.crm_locations%rowtype;
begin
  if not exists (
    select 1
    from public.photographers as photographer
    where photographer.id = p_photographer_id
      and photographer.user_id = p_actor_user_id
  ) then
    raise exception 'CRM primary location owner mismatch' using errcode = '42501';
  end if;

  perform 1
  from public.crm_clients as client
  where client.id = p_client_id
    and client.photographer_id = p_photographer_id
    and client.archived_at is null
  for update;
  if not found then
    raise exception 'Active CRM client not found for primary location'
      using errcode = '22023';
  end if;

  select location.* into target
  from public.crm_locations as location
  where location.id = p_location_id
    and location.client_id = p_client_id
    and location.photographer_id = p_photographer_id
    and location.archived_at is null
  for update;
  if not found then
    raise exception 'Active CRM location does not belong to this client'
      using errcode = '22023';
  end if;

  update public.crm_locations as location
  set is_primary = false
  where location.client_id = p_client_id
    and location.photographer_id = p_photographer_id
    and location.id <> p_location_id
    and location.is_primary;

  update public.crm_locations as location
  set is_primary = true
  where location.id = p_location_id
    and location.client_id = p_client_id
    and location.photographer_id = p_photographer_id
    and location.archived_at is null
  returning location.* into target;

  if not found then
    raise exception 'CRM primary location changed during update'
      using errcode = '40001';
  end if;
  return target;
end;
$$;

revoke all on function public.crm_set_primary_location(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.crm_set_primary_location(uuid, uuid, uuid, uuid)
  to service_role;

alter table public.crm_location_photos enable row level security;
alter table public.crm_location_photos force row level security;
revoke all on table public.crm_location_photos from public, anon, authenticated;
create policy crm_location_photos_tenant_select
  on public.crm_location_photos
  for select
  to authenticated
  using (public.crm_owns_photographer(photographer_id));
grant select on table public.crm_location_photos to authenticated;
grant all on table public.crm_location_photos to service_role;

comment on column public.crm_locations.arrival_instructions is
  'Client-shareable arrival directions reusable across annual booking jobs.';
comment on column public.crm_locations.parking_instructions is
  'Client-shareable parking directions reusable across annual booking jobs.';
comment on column public.crm_locations.setup_instructions is
  'Staff-only setup notes; never include in public booking payloads.';
comment on column public.crm_locations.internal_notes is
  'Staff-only internal campus notes; never include in public booking payloads.';
comment on table public.crm_location_photos is
  'Private R2-backed reusable campus photos. Object keys are server-generated; audience controls client reuse.';

commit;
