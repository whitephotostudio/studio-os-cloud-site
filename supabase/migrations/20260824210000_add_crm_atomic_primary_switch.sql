-- Atomic primary contact/location switching for multi-campus CRM clients.
--
-- The foundation migration deliberately gives authenticated sessions read-only
-- CRM access. These RPCs remain service-only and repeat ownership, tenant, and
-- active-client checks so API call-site mistakes fail closed.

begin;

create or replace function public.crm_set_primary_contact(
  p_photographer_id uuid,
  p_client_id uuid,
  p_contact_id uuid,
  p_actor_user_id uuid
)
returns public.crm_contacts
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target public.crm_contacts%rowtype;
begin
  if not exists (
    select 1
    from public.photographers as photographer
    where photographer.id = p_photographer_id
      and photographer.user_id = p_actor_user_id
  ) then
    raise exception 'CRM primary contact owner mismatch' using errcode = '42501';
  end if;

  -- All primary switches for this client serialize on the permanent client
  -- row. Concurrent requests therefore finish with exactly one deterministic
  -- winner instead of interleaving sibling demotion/promotion statements.
  perform 1
  from public.crm_clients as client
  where client.id = p_client_id
    and client.photographer_id = p_photographer_id
    and client.archived_at is null
  for update;
  if not found then
    raise exception 'Active CRM client not found for primary contact'
      using errcode = '22023';
  end if;

  select contact.* into target
  from public.crm_contacts as contact
  where contact.id = p_contact_id
    and contact.client_id = p_client_id
    and contact.photographer_id = p_photographer_id
    and contact.archived_at is null
  for update;
  if not found then
    raise exception 'Active CRM contact does not belong to this client'
      using errcode = '22023';
  end if;

  -- Clear archived primaries too. If an old contact is restored later, it
  -- cannot unexpectedly collide with or replace the current primary.
  update public.crm_contacts as contact
  set is_primary = false
  where contact.client_id = p_client_id
    and contact.photographer_id = p_photographer_id
    and contact.id <> p_contact_id
    and contact.is_primary;

  update public.crm_contacts as contact
  set is_primary = true
  where contact.id = p_contact_id
    and contact.client_id = p_client_id
    and contact.photographer_id = p_photographer_id
    and contact.archived_at is null
  returning contact.* into target;

  if not found then
    raise exception 'CRM primary contact changed during update'
      using errcode = '40001';
  end if;
  return target;
end;
$$;

revoke all on function public.crm_set_primary_contact(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.crm_set_primary_contact(uuid, uuid, uuid, uuid)
  to service_role;

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
  for update;
  if not found then
    raise exception 'CRM location does not belong to this client'
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

comment on function public.crm_set_primary_contact(uuid, uuid, uuid, uuid) is
  'Service-only, tenant-validated atomic primary-contact switch serialized per CRM client.';
comment on function public.crm_set_primary_location(uuid, uuid, uuid, uuid) is
  'Service-only, tenant-validated atomic primary-location switch serialized per CRM client.';

commit;
