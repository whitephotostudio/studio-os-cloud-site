begin;

-- Validate the expanded allow-list before replacing the original constraint.
-- The table lock taken by ALTER TABLE is held until commit, so writes cannot
-- pass between dropping the old constraint and renaming the new one.
alter table public.crm_clients
  add constraint crm_clients_kind_check_v2
  check (kind in (
    'school', 'college', 'university', 'daycare', 'montessori',
    'corporate', 'wedding', 'event', 'sports', 'family',
    'person', 'nonprofit', 'other'
  )) not valid;

alter table public.crm_clients
  validate constraint crm_clients_kind_check_v2;

alter table public.crm_clients
  drop constraint crm_clients_kind_check;

alter table public.crm_clients
  rename constraint crm_clients_kind_check_v2 to crm_clients_kind_check;

commit;
