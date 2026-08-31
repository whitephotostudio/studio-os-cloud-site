-- Studio OS CRM foundation.
--
-- The existing schools/projects rows are shoot and gallery instances. CRM
-- clients are deliberately permanent records that may be linked to many
-- annual booking cycles without changing existing gallery lifecycles.

begin;

-- The application already assumes one photographer row per auth user.
-- Fail closed instead of silently choosing between duplicate tenant records.
do $$
begin
  if exists (
    select 1
    from public.photographers
    where user_id is not null
    group by user_id
    having count(*) > 1
  ) then
    raise exception 'CRM migration requires one photographer row per auth user';
  end if;
end
$$;

create unique index if not exists photographers_user_id_crm_uidx
  on public.photographers (user_id)
  where user_id is not null;

-- Composite targets make it impossible for a child row to reference an
-- object owned by another photographer, even from service-role code.
create unique index if not exists schools_id_photographer_crm_uidx
  on public.schools (id, photographer_id);
create unique index if not exists projects_id_photographer_crm_uidx
  on public.projects (id, photographer_id);

create table public.crm_clients (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  kind text not null default 'school'
    check (kind in (
      'school', 'corporate', 'wedding', 'event', 'sports', 'family',
      'person', 'nonprofit', 'other'
    )),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 300),
  legal_name text,
  website text,
  current_student_count integer check (current_student_count is null or current_student_count >= 0),
  default_booking_month smallint
    check (default_booking_month is null or default_booking_month between 1 and 12),
  default_timezone text not null default 'America/Toronto',
  notes text,
  tags text[] not null default '{}'::text[],
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_clients_id_tenant_key unique (id, photographer_id)
);

create table public.crm_locations (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  client_id uuid not null,
  label text not null default 'Main location',
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country_code text not null default 'CA'
    check (country_code ~ '^[A-Z]{2}$'),
  timezone text,
  phone text,
  is_primary boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_locations_client_tenant_fkey
    foreign key (client_id, photographer_id)
    references public.crm_clients(id, photographer_id) on delete cascade,
  constraint crm_locations_id_client_tenant_key
    unique (id, client_id, photographer_id)
);

create table public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  client_id uuid not null,
  location_id uuid,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 300),
  job_title text,
  role text,
  email text,
  email_normalized text generated always as (nullif(lower(btrim(email)), '')) stored,
  phone text,
  preferred_channel text not null default 'email'
    check (preferred_channel in ('email', 'phone', 'none')),
  is_primary boolean not null default false,
  marketing_consent text not null default 'unknown'
    check (marketing_consent in ('unknown', 'opted_in', 'opted_out')),
  consent_recorded_at timestamptz,
  consent_source text,
  do_not_contact boolean not null default false,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_contacts_client_tenant_fkey
    foreign key (client_id, photographer_id)
    references public.crm_clients(id, photographer_id) on delete cascade,
  constraint crm_contacts_location_client_tenant_fkey
    foreign key (location_id, client_id, photographer_id)
    references public.crm_locations(id, client_id, photographer_id) on delete restrict,
  constraint crm_contacts_id_client_tenant_key
    unique (id, client_id, photographer_id),
  constraint crm_contacts_email_length_check
    check (email is null or char_length(email) <= 320),
  constraint crm_contacts_optin_evidence_check
    check (
      marketing_consent <> 'opted_in'
      or (
        consent_recorded_at is not null
        and nullif(btrim(consent_source), '') is not null
      )
    )
);

create table public.crm_agreements (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  client_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'signed', 'active', 'expired', 'terminated')),
  starts_on date,
  ends_on date,
  signed_at timestamptz,
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  currency text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  student_commitment integer
    check (student_commitment is null or student_commitment >= 0),
  renewal_notice_days integer not null default 60
    check (renewal_notice_days between 0 and 730),
  document_key text,
  terms_summary text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_agreements_client_tenant_fkey
    foreign key (client_id, photographer_id)
    references public.crm_clients(id, photographer_id) on delete cascade,
  constraint crm_agreements_id_client_tenant_key
    unique (id, client_id, photographer_id),
  constraint crm_agreements_dates_check
    check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

create table public.crm_booking_cycles (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  client_id uuid not null,
  agreement_id uuid,
  gallery_school_id uuid,
  project_id uuid,
  season_year smallint not null check (season_year between 2000 and 2200),
  cycle_key text not null default 'annual'
    check (cycle_key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  label text,
  status text not null default 'not_contacted'
    check (status in (
      'not_contacted', 'contact_due', 'contacted', 'follow_up',
      'proposal_sent', 'negotiating', 'booked', 'completed', 'lost', 'skipped'
    )),
  target_contact_on date,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  booked_at timestamptz,
  shoot_start_at timestamptz,
  shoot_end_at timestamptz,
  student_count_estimate integer
    check (student_count_estimate is null or student_count_estimate >= 0),
  student_count_actual integer
    check (student_count_actual is null or student_count_actual >= 0),
  quoted_amount_cents bigint
    check (quoted_amount_cents is null or quoted_amount_cents >= 0),
  booked_amount_cents bigint
    check (booked_amount_cents is null or booked_amount_cents >= 0),
  currency text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  lost_reason text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_booking_cycles_client_tenant_fkey
    foreign key (client_id, photographer_id)
    references public.crm_clients(id, photographer_id) on delete cascade,
  constraint crm_booking_cycles_agreement_client_tenant_fkey
    foreign key (agreement_id, client_id, photographer_id)
    references public.crm_agreements(id, client_id, photographer_id) on delete restrict,
  constraint crm_booking_cycles_school_tenant_fkey
    foreign key (gallery_school_id, photographer_id)
    references public.schools(id, photographer_id) on delete restrict,
  constraint crm_booking_cycles_project_tenant_fkey
    foreign key (project_id, photographer_id)
    references public.projects(id, photographer_id) on delete restrict,
  constraint crm_booking_cycles_id_client_tenant_key
    unique (id, client_id, photographer_id),
  constraint crm_booking_cycles_one_source_check
    check (num_nonnulls(gallery_school_id, project_id) <= 1),
  constraint crm_booking_cycles_shoot_dates_check
    check (shoot_start_at is null or shoot_end_at is null or shoot_end_at >= shoot_start_at),
  constraint crm_booking_cycles_client_season_key
    unique (client_id, season_year, cycle_key)
);

create table public.crm_email_templates (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  template_key text not null
    check (template_key ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  purpose text not null default 'custom'
    check (purpose in (
      'booking_invitation', 'follow_up', 'proposal', 'confirmation',
      'renewal', 'thank_you', 'photographer_reminder', 'custom'
    )),
  message_class text not null default 'relationship'
    check (message_class in ('transactional', 'relationship', 'marketing')),
  is_system boolean not null default false,
  subject_template text not null check (char_length(btrim(subject_template)) between 1 and 300),
  html_template text,
  text_template text,
  allowed_variables text[] not null default '{}'::text[],
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'archived')),
  ai_instruction text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_email_templates_content_check
    check (coalesce(nullif(btrim(html_template), ''), nullif(btrim(text_template), '')) is not null),
  constraint crm_email_templates_approval_check
    check (status <> 'approved' or (approved_at is not null and approved_by is not null)),
  constraint crm_email_templates_transactional_system_check
    check (message_class <> 'transactional' or is_system),
  constraint crm_email_templates_system_approved_check
    check (not is_system or status = 'approved'),
  constraint crm_email_templates_reserved_key_check
    check (
      is_system
      or template_key not in (
        'annual_booking_invitation', 'booking_follow_up', 'proposal_agreement',
        'shoot_confirmation', 'client_thank_you', 'annual_renewal'
      )
    ),
  constraint crm_email_templates_id_tenant_key unique (id, photographer_id),
  constraint crm_email_templates_version_key unique (photographer_id, template_key, version)
);

create table public.crm_automation_rules (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  client_id uuid,
  template_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  trigger_type text not null
    check (trigger_type in (
      'booking_season_open', 'follow_up_due', 'agreement_expiring',
      'shoot_anniversary', 'manual'
    )),
  action_type text not null
    check (action_type in ('create_task', 'email_photographer', 'email_client')),
  mode text not null default 'off'
    check (mode in ('off', 'remind', 'approve', 'autopilot')),
  days_offset integer not null default 0 check (days_offset between -730 and 730),
  max_runs_per_cycle integer not null default 1 check (max_runs_per_cycle = 1),
  send_local_time time not null default '09:00',
  timezone text not null default 'America/Toronto',
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  enabled boolean not null default false,
  autopilot_approved_at timestamptz,
  autopilot_approved_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_automation_rules_client_tenant_fkey
    foreign key (client_id, photographer_id)
    references public.crm_clients(id, photographer_id) on delete cascade,
  constraint crm_automation_rules_template_tenant_fkey
    foreign key (template_id, photographer_id)
    references public.crm_email_templates(id, photographer_id) on delete restrict,
  constraint crm_automation_rules_id_tenant_key unique (id, photographer_id),
  constraint crm_automation_rules_email_template_check
    check (action_type not in ('email_photographer', 'email_client') or template_id is not null),
  constraint crm_automation_rules_autopilot_check
    check (
      mode <> 'autopilot'
      or (autopilot_approved_at is not null and autopilot_approved_by is not null)
    )
);

create table public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  client_id uuid not null,
  contact_id uuid,
  booking_cycle_id uuid,
  automation_rule_id uuid,
  kind text not null default 'follow_up'
    check (kind in ('follow_up', 'call', 'email', 'agreement', 'booking', 'custom')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  notes text,
  due_at timestamptz,
  remind_at timestamptz,
  status text not null default 'open'
    check (status in ('open', 'snoozed', 'completed', 'cancelled')),
  priority smallint not null default 1 check (priority between 0 and 3),
  assigned_user_id uuid references auth.users(id) on delete set null,
  dedupe_key text,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_tasks_client_tenant_fkey
    foreign key (client_id, photographer_id)
    references public.crm_clients(id, photographer_id) on delete cascade,
  constraint crm_tasks_contact_client_tenant_fkey
    foreign key (contact_id, client_id, photographer_id)
    references public.crm_contacts(id, client_id, photographer_id) on delete restrict,
  constraint crm_tasks_cycle_client_tenant_fkey
    foreign key (booking_cycle_id, client_id, photographer_id)
    references public.crm_booking_cycles(id, client_id, photographer_id) on delete restrict,
  constraint crm_tasks_rule_tenant_fkey
    foreign key (automation_rule_id, photographer_id)
    references public.crm_automation_rules(id, photographer_id) on delete restrict,
  constraint crm_tasks_id_client_tenant_key unique (id, client_id, photographer_id)
);

create table public.crm_email_outbox (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  client_id uuid not null,
  contact_id uuid,
  booking_cycle_id uuid,
  automation_rule_id uuid,
  template_id uuid,
  recipient_type text not null default 'client'
    check (recipient_type in ('client', 'photographer')),
  to_name text,
  to_email text not null check (char_length(btrim(to_email)) between 3 and 320),
  to_email_normalized text generated always as (lower(btrim(to_email))) stored,
  message_class text not null default 'relationship'
    check (message_class in ('transactional', 'relationship', 'marketing')),
  delivery_mode text not null default 'manual'
    check (delivery_mode in ('manual', 'approval', 'autopilot')),
  status text not null default 'draft'
    check (status in (
      'draft', 'pending_approval', 'queued', 'processing', 'retry',
      'sent', 'failed', 'cancelled', 'suppressed'
    )),
  subject text not null check (char_length(btrim(subject)) between 1 and 300),
  html_body text,
  text_body text,
  content_source text not null default 'template'
    check (content_source in ('template', 'manual', 'ai')),
  content_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(content_metadata) = 'object'),
  scheduled_for timestamptz not null default timezone('utc', now()),
  next_attempt_at timestamptz not null default timezone('utc', now()),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  locked_at timestamptz,
  lease_expires_at timestamptz,
  locked_by text,
  dedupe_key text not null check (char_length(btrim(dedupe_key)) between 8 and 500),
  provider text not null default 'resend',
  provider_message_id text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_email_outbox_client_tenant_fkey
    foreign key (client_id, photographer_id)
    references public.crm_clients(id, photographer_id) on delete cascade,
  constraint crm_email_outbox_contact_client_tenant_fkey
    foreign key (contact_id, client_id, photographer_id)
    references public.crm_contacts(id, client_id, photographer_id) on delete restrict,
  constraint crm_email_outbox_cycle_client_tenant_fkey
    foreign key (booking_cycle_id, client_id, photographer_id)
    references public.crm_booking_cycles(id, client_id, photographer_id) on delete restrict,
  constraint crm_email_outbox_rule_tenant_fkey
    foreign key (automation_rule_id, photographer_id)
    references public.crm_automation_rules(id, photographer_id) on delete restrict,
  constraint crm_email_outbox_template_tenant_fkey
    foreign key (template_id, photographer_id)
    references public.crm_email_templates(id, photographer_id) on delete restrict,
  constraint crm_email_outbox_id_tenant_key unique (id, photographer_id),
  constraint crm_email_outbox_id_client_tenant_key unique (id, client_id, photographer_id),
  constraint crm_email_outbox_dedupe_key unique (photographer_id, dedupe_key),
  constraint crm_email_outbox_content_check
    check (coalesce(nullif(btrim(html_body), ''), nullif(btrim(text_body), '')) is not null),
  constraint crm_email_outbox_approval_check
    check (
      delivery_mode <> 'approval'
      or status not in ('queued', 'processing', 'retry', 'sent')
      or (approved_at is not null and approved_by is not null)
    ),
  constraint crm_email_outbox_autopilot_rule_check
    check (delivery_mode <> 'autopilot' or automation_rule_id is not null)
);

create table public.crm_email_events (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  outbox_id uuid not null,
  event_type text not null
    check (event_type in (
      'drafted', 'queued', 'approved', 'claimed', 'provider_accepted',
      'retry_scheduled', 'failed', 'delivered', 'bounced', 'complained',
      'opened', 'clicked', 'unsubscribed', 'suppressed'
    )),
  provider_event_id text,
  provider_message_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint crm_email_events_outbox_tenant_fkey
    foreign key (outbox_id, photographer_id)
    references public.crm_email_outbox(id, photographer_id) on delete cascade
);

create table public.crm_email_suppressions (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  email text not null check (char_length(btrim(email)) between 3 and 320),
  email_normalized text generated always as (lower(btrim(email))) stored,
  scope text not null default 'non_transactional'
    check (scope in ('marketing', 'non_transactional', 'all')),
  reason text not null
    check (reason in ('unsubscribe', 'hard_bounce', 'complaint', 'manual', 'invalid')),
  source text,
  provider_event_id text,
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_email_suppressions_id_tenant_key unique (id, photographer_id)
);

-- This counter is updated by an outbox trigger in the same transaction as
-- queueing. It cannot be raced by overlapping dashboard, bulk, or cron calls.
create table public.crm_email_daily_usage (
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  usage_date date not null,
  reserved_count integer not null default 0
    check (reserved_count between 0 and 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (photographer_id, usage_date)
);

create table public.crm_client_bundle_requests (
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  request_key text not null check (char_length(btrim(request_key)) between 8 and 200),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  primary key (photographer_id, request_key)
);

create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  client_id uuid not null,
  contact_id uuid,
  booking_cycle_id uuid,
  outbox_id uuid,
  activity_type text not null
    check (activity_type in (
      'note', 'call', 'email', 'status_change', 'task', 'agreement', 'system'
    )),
  summary text not null check (char_length(btrim(summary)) between 1 and 500),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  source text not null default 'user' check (source in ('user', 'automation', 'system')),
  occurred_at timestamptz not null default timezone('utc', now()),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint crm_activities_client_tenant_fkey
    foreign key (client_id, photographer_id)
    references public.crm_clients(id, photographer_id) on delete cascade,
  constraint crm_activities_contact_client_tenant_fkey
    foreign key (contact_id, client_id, photographer_id)
    references public.crm_contacts(id, client_id, photographer_id) on delete restrict,
  constraint crm_activities_cycle_client_tenant_fkey
    foreign key (booking_cycle_id, client_id, photographer_id)
    references public.crm_booking_cycles(id, client_id, photographer_id) on delete restrict,
  constraint crm_activities_outbox_tenant_fkey
    foreign key (outbox_id, photographer_id)
    references public.crm_email_outbox(id, photographer_id) on delete restrict
);

create table public.crm_automation_runs (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  automation_rule_id uuid not null,
  client_id uuid not null,
  booking_cycle_id uuid not null,
  task_id uuid,
  outbox_id uuid,
  occurrence_key text not null,
  outcome text not null check (outcome in ('reminder', 'pending_approval', 'queued')),
  created_at timestamptz not null default timezone('utc', now()),
  constraint crm_automation_runs_rule_tenant_fkey
    foreign key (automation_rule_id, photographer_id)
    references public.crm_automation_rules(id, photographer_id) on delete cascade,
  constraint crm_automation_runs_cycle_client_tenant_fkey
    foreign key (booking_cycle_id, client_id, photographer_id)
    references public.crm_booking_cycles(id, client_id, photographer_id) on delete cascade,
  constraint crm_automation_runs_task_client_tenant_fkey
    foreign key (task_id, client_id, photographer_id)
    references public.crm_tasks(id, client_id, photographer_id) on delete restrict,
  constraint crm_automation_runs_outbox_client_tenant_fkey
    foreign key (outbox_id, client_id, photographer_id)
    references public.crm_email_outbox(id, client_id, photographer_id) on delete restrict,
  constraint crm_automation_runs_one_result_check
    check (num_nonnulls(task_id, outbox_id) = 1),
  constraint crm_automation_runs_one_per_rule_cycle
    unique (photographer_id, automation_rule_id, booking_cycle_id),
  constraint crm_automation_runs_occurrence_key
    unique (photographer_id, occurrence_key)
);

-- Search, annual pipeline, follow-up, and worker indexes.
create index crm_clients_tenant_name_idx
  on public.crm_clients (photographer_id, lower(display_name));
create index crm_clients_tenant_active_idx
  on public.crm_clients (photographer_id, archived_at, updated_at desc);
create index crm_clients_tags_gin_idx on public.crm_clients using gin (tags);
create unique index crm_locations_one_primary_idx
  on public.crm_locations (client_id)
  where is_primary;
create unique index crm_contacts_client_email_idx
  on public.crm_contacts (client_id, email_normalized)
  where email_normalized is not null and archived_at is null;
create unique index crm_contacts_one_primary_idx
  on public.crm_contacts (client_id)
  where is_primary and archived_at is null;
create index crm_contacts_tenant_email_idx
  on public.crm_contacts (photographer_id, email_normalized);
create index crm_agreements_renewal_idx
  on public.crm_agreements (photographer_id, ends_on)
  where status in ('signed', 'active');
create index crm_booking_cycles_pipeline_idx
  on public.crm_booking_cycles (photographer_id, season_year, status, updated_at desc);
create index crm_booking_cycles_follow_up_idx
  on public.crm_booking_cycles (photographer_id, next_follow_up_at)
  where status not in ('booked', 'completed', 'lost', 'skipped');
create unique index crm_booking_cycles_gallery_school_idx
  on public.crm_booking_cycles (photographer_id, gallery_school_id)
  where gallery_school_id is not null;
create unique index crm_booking_cycles_project_idx
  on public.crm_booking_cycles (photographer_id, project_id)
  where project_id is not null;
create unique index crm_tasks_dedupe_idx
  on public.crm_tasks (photographer_id, dedupe_key);
create index crm_tasks_due_idx
  on public.crm_tasks (photographer_id, status, due_at)
  where status in ('open', 'snoozed');
create index crm_automation_rules_due_idx
  on public.crm_automation_rules (enabled, mode, trigger_type, photographer_id)
  where enabled and mode <> 'off';
create index crm_email_outbox_worker_idx
  on public.crm_email_outbox (next_attempt_at, scheduled_for, created_at)
  where status in ('queued', 'retry');
create index crm_email_outbox_tenant_timeline_idx
  on public.crm_email_outbox (photographer_id, client_id, created_at desc);
create unique index crm_email_outbox_provider_message_idx
  on public.crm_email_outbox (provider_message_id)
  where provider_message_id is not null;
create index crm_email_events_outbox_idx
  on public.crm_email_events (outbox_id, occurred_at desc);
create unique index crm_email_events_provider_event_idx
  on public.crm_email_events (provider_event_id)
  where provider_event_id is not null;
create unique index crm_email_suppressions_active_idx
  on public.crm_email_suppressions (photographer_id, email_normalized, scope);
create index crm_activities_client_timeline_idx
  on public.crm_activities (photographer_id, client_id, occurred_at desc);
create index crm_automation_runs_tenant_created_idx
  on public.crm_automation_runs (photographer_id, created_at desc);

-- One ownership predicate is shared by every policy. If team membership is
-- introduced later, only this function needs to gain the membership check.
create or replace function public.crm_owns_photographer(p_photographer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.photographers as photographer
    where photographer.id = p_photographer_id
      and photographer.user_id = auth.uid()
  );
$$;

revoke all on function public.crm_owns_photographer(uuid) from public, anon;
grant execute on function public.crm_owns_photographer(uuid) to authenticated;

-- One RPC creates the first relationship record atomically. API validation
-- sends only these database-shaped keys; the function repeats the allowlist
-- and owner check so even service-role call-site mistakes fail closed.
create or replace function public.crm_create_client_bundle(
  p_photographer_id uuid,
  p_created_by uuid,
  p_request_key text,
  p_payload_fingerprint text,
  p_client jsonb,
  p_location jsonb default null,
  p_contact jsonb default null,
  p_booking_cycle jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  client_id uuid;
  location_id uuid;
  contact_id uuid;
  booking_cycle_id uuid;
  unknown_key text;
  request_inserted boolean;
  bundle_result jsonb;
  existing_fingerprint text;
begin
  if not exists (
    select 1
    from public.photographers as photographer
    where photographer.id = p_photographer_id
      and photographer.user_id = p_created_by
  ) then
    raise exception 'CRM client bundle owner mismatch' using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(p_request_key, ''))) not between 8 and 200 then
    raise exception 'CRM client bundle request key is invalid' using errcode = '22023';
  end if;
  if coalesce(p_payload_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'CRM client bundle payload fingerprint is invalid' using errcode = '22023';
  end if;

  insert into public.crm_client_bundle_requests (
    photographer_id,
    request_key,
    payload_fingerprint,
    created_by
  ) values (
    p_photographer_id,
    btrim(p_request_key),
    p_payload_fingerprint,
    p_created_by
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
      raise exception 'CRM client bundle request key was reused with different data'
        using errcode = '22023';
    end if;
    if bundle_result is null then
      raise exception 'CRM client bundle request is incomplete' using errcode = '40001';
    end if;
    return bundle_result;
  end if;

  if jsonb_typeof(p_client) is distinct from 'object' then
    raise exception 'CRM client bundle requires a client object' using errcode = '22023';
  end if;
  select key into unknown_key
  from jsonb_object_keys(p_client) as keys(key)
  where key <> all (array[
    'kind', 'display_name', 'legal_name', 'website',
    'current_student_count', 'default_booking_month', 'default_timezone',
    'notes', 'tags'
  ]::text[])
  limit 1;
  if unknown_key is not null then
    raise exception 'Unsupported CRM client key: %', unknown_key using errcode = '22023';
  end if;
  if nullif(btrim(p_client ->> 'display_name'), '') is null then
    raise exception 'CRM client display_name is required' using errcode = '22023';
  end if;

  insert into public.crm_clients (
    photographer_id,
    kind,
    display_name,
    legal_name,
    website,
    current_student_count,
    default_booking_month,
    default_timezone,
    notes,
    tags,
    created_by
  ) values (
    p_photographer_id,
    coalesce(nullif(p_client ->> 'kind', ''), 'school'),
    btrim(p_client ->> 'display_name'),
    nullif(btrim(p_client ->> 'legal_name'), ''),
    nullif(btrim(p_client ->> 'website'), ''),
    nullif(p_client ->> 'current_student_count', '')::integer,
    nullif(p_client ->> 'default_booking_month', '')::smallint,
    coalesce(nullif(btrim(p_client ->> 'default_timezone'), ''), 'America/Toronto'),
    nullif(p_client ->> 'notes', ''),
    case
      when jsonb_typeof(p_client -> 'tags') = 'array'
        then array(select jsonb_array_elements_text(p_client -> 'tags'))
      else '{}'::text[]
    end,
    p_created_by
  ) returning id into client_id;

  if p_location is not null then
    if jsonb_typeof(p_location) <> 'object' then
      raise exception 'CRM location must be an object' using errcode = '22023';
    end if;
    unknown_key := null;
    select key into unknown_key
    from jsonb_object_keys(p_location) as keys(key)
    where key <> all (array[
      'label', 'address_line1', 'address_line2', 'city', 'region',
      'postal_code', 'country_code', 'timezone', 'phone', 'is_primary'
    ]::text[])
    limit 1;
    if unknown_key is not null then
      raise exception 'Unsupported CRM location key: %', unknown_key using errcode = '22023';
    end if;

    insert into public.crm_locations (
      photographer_id,
      client_id,
      label,
      address_line1,
      address_line2,
      city,
      region,
      postal_code,
      country_code,
      timezone,
      phone,
      is_primary
    ) values (
      p_photographer_id,
      client_id,
      coalesce(nullif(btrim(p_location ->> 'label'), ''), 'Main location'),
      nullif(btrim(p_location ->> 'address_line1'), ''),
      nullif(btrim(p_location ->> 'address_line2'), ''),
      nullif(btrim(p_location ->> 'city'), ''),
      nullif(btrim(p_location ->> 'region'), ''),
      nullif(btrim(p_location ->> 'postal_code'), ''),
      coalesce(nullif(upper(btrim(p_location ->> 'country_code')), ''), 'CA'),
      nullif(btrim(p_location ->> 'timezone'), ''),
      nullif(btrim(p_location ->> 'phone'), ''),
      true
    ) returning id into location_id;
  end if;

  if p_contact is not null then
    if jsonb_typeof(p_contact) <> 'object' then
      raise exception 'CRM contact must be an object' using errcode = '22023';
    end if;
    unknown_key := null;
    select key into unknown_key
    from jsonb_object_keys(p_contact) as keys(key)
    where key <> all (array[
      'full_name', 'job_title', 'role', 'email', 'phone',
      'preferred_channel', 'is_primary', 'marketing_consent',
      'consent_recorded_at', 'consent_source', 'do_not_contact', 'notes'
    ]::text[])
    limit 1;
    if unknown_key is not null then
      raise exception 'Unsupported CRM contact key: %', unknown_key using errcode = '22023';
    end if;
    if nullif(btrim(p_contact ->> 'full_name'), '') is null then
      raise exception 'CRM contact full_name is required' using errcode = '22023';
    end if;
    if p_contact ->> 'marketing_consent' = 'opted_in' and (
      nullif(p_contact ->> 'consent_recorded_at', '') is null
      or nullif(btrim(p_contact ->> 'consent_source'), '') is null
    ) then
      raise exception 'CRM opted-in contact requires consent timestamp and source'
        using errcode = '22023';
    end if;

    insert into public.crm_contacts (
      photographer_id,
      client_id,
      location_id,
      full_name,
      job_title,
      role,
      email,
      phone,
      preferred_channel,
      is_primary,
      marketing_consent,
      consent_recorded_at,
      consent_source,
      do_not_contact,
      notes
    ) values (
      p_photographer_id,
      client_id,
      location_id,
      btrim(p_contact ->> 'full_name'),
      nullif(btrim(p_contact ->> 'job_title'), ''),
      nullif(btrim(p_contact ->> 'role'), ''),
      nullif(btrim(p_contact ->> 'email'), ''),
      nullif(btrim(p_contact ->> 'phone'), ''),
      coalesce(nullif(p_contact ->> 'preferred_channel', ''), 'email'),
      true,
      coalesce(nullif(p_contact ->> 'marketing_consent', ''), 'unknown'),
      nullif(p_contact ->> 'consent_recorded_at', '')::timestamptz,
      nullif(btrim(p_contact ->> 'consent_source'), ''),
      coalesce((p_contact ->> 'do_not_contact')::boolean, false),
      nullif(p_contact ->> 'notes', '')
    ) returning id into contact_id;
  end if;

  if p_booking_cycle is not null then
    if jsonb_typeof(p_booking_cycle) <> 'object' then
      raise exception 'CRM booking cycle must be an object' using errcode = '22023';
    end if;
    unknown_key := null;
    select key into unknown_key
    from jsonb_object_keys(p_booking_cycle) as keys(key)
    where key <> all (array[
      'gallery_school_id', 'project_id', 'season_year', 'cycle_key', 'label',
      'status', 'target_contact_on', 'last_contacted_at', 'next_follow_up_at',
      'booked_at', 'shoot_start_at', 'shoot_end_at', 'student_count_estimate',
      'student_count_actual', 'quoted_amount_cents', 'booked_amount_cents',
      'currency', 'lost_reason', 'notes'
    ]::text[])
    limit 1;
    if unknown_key is not null then
      raise exception 'Unsupported CRM booking cycle key: %', unknown_key using errcode = '22023';
    end if;
    if nullif(p_booking_cycle ->> 'season_year', '') is null then
      raise exception 'CRM booking cycle season_year is required' using errcode = '22023';
    end if;

    insert into public.crm_booking_cycles (
      photographer_id,
      client_id,
      gallery_school_id,
      project_id,
      season_year,
      cycle_key,
      label,
      status,
      target_contact_on,
      last_contacted_at,
      next_follow_up_at,
      booked_at,
      shoot_start_at,
      shoot_end_at,
      student_count_estimate,
      student_count_actual,
      quoted_amount_cents,
      booked_amount_cents,
      currency,
      lost_reason,
      notes,
      created_by
    ) values (
      p_photographer_id,
      client_id,
      nullif(p_booking_cycle ->> 'gallery_school_id', '')::uuid,
      nullif(p_booking_cycle ->> 'project_id', '')::uuid,
      (p_booking_cycle ->> 'season_year')::smallint,
      coalesce(nullif(p_booking_cycle ->> 'cycle_key', ''), 'annual'),
      nullif(btrim(p_booking_cycle ->> 'label'), ''),
      coalesce(nullif(p_booking_cycle ->> 'status', ''), 'not_contacted'),
      nullif(p_booking_cycle ->> 'target_contact_on', '')::date,
      nullif(p_booking_cycle ->> 'last_contacted_at', '')::timestamptz,
      nullif(p_booking_cycle ->> 'next_follow_up_at', '')::timestamptz,
      nullif(p_booking_cycle ->> 'booked_at', '')::timestamptz,
      nullif(p_booking_cycle ->> 'shoot_start_at', '')::timestamptz,
      nullif(p_booking_cycle ->> 'shoot_end_at', '')::timestamptz,
      nullif(p_booking_cycle ->> 'student_count_estimate', '')::integer,
      nullif(p_booking_cycle ->> 'student_count_actual', '')::integer,
      nullif(p_booking_cycle ->> 'quoted_amount_cents', '')::bigint,
      nullif(p_booking_cycle ->> 'booked_amount_cents', '')::bigint,
      coalesce(nullif(upper(p_booking_cycle ->> 'currency'), ''), 'CAD'),
      nullif(p_booking_cycle ->> 'lost_reason', ''),
      nullif(p_booking_cycle ->> 'notes', ''),
      p_created_by
    ) returning id into booking_cycle_id;
  end if;

  bundle_result := jsonb_build_object(
    'clientId', client_id,
    'locationId', location_id,
    'contactId', contact_id,
    'bookingCycleId', booking_cycle_id
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

revoke all on function public.crm_create_client_bundle(
  uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.crm_create_client_bundle(
  uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb
) to service_role;

create or replace function public.crm_apply_signed_unsubscribe(
  p_photographer_id uuid,
  p_contact_id uuid,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
begin
  if normalized_email = '' or not exists (
    select 1
    from public.crm_contacts as contact
    where contact.id = p_contact_id
      and contact.photographer_id = p_photographer_id
      and contact.email_normalized = normalized_email
  ) then
    return false;
  end if;

  insert into public.crm_email_suppressions (
    photographer_id,
    email,
    scope,
    reason,
    source,
    lifted_at,
    lifted_by
  ) values (
    p_photographer_id,
    normalized_email,
    'non_transactional',
    'unsubscribe',
    'signed_recipient_link',
    null,
    null
  )
  on conflict (photographer_id, email_normalized, scope) do update
  set
    reason = 'unsubscribe',
    source = 'signed_recipient_link',
    lifted_at = null,
    lifted_by = null,
    updated_at = timezone('utc', now());

  update public.crm_contacts
  set
    marketing_consent = 'opted_out',
    consent_recorded_at = timezone('utc', now()),
    consent_source = 'signed_recipient_unsubscribe'
  where id = p_contact_id
    and photographer_id = p_photographer_id;

  return true;
end;
$$;

revoke all on function public.crm_apply_signed_unsubscribe(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.crm_apply_signed_unsubscribe(uuid, uuid, text)
  to service_role;

create or replace function public.crm_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.crm_touch_updated_at() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_clients', 'crm_locations', 'crm_contacts', 'crm_agreements',
    'crm_booking_cycles', 'crm_email_templates', 'crm_automation_rules',
    'crm_tasks', 'crm_email_outbox', 'crm_email_suppressions'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.crm_touch_updated_at()',
      table_name || '_touch_updated_at',
      table_name
    );
  end loop;
end
$$;

-- Reserve non-transactional daily capacity atomically when a message first
-- becomes deliverable. Drafts and approval previews do not consume capacity;
-- their transition to queued does. Retries never double count.
create or replace function public.crm_reserve_daily_email_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  new_counted boolean;
  old_counted boolean := false;
  reserved integer;
begin
  new_counted :=
    new.message_class <> 'transactional'
    and new.status in ('queued', 'processing', 'retry', 'sent');

  if tg_op = 'UPDATE' then
    old_counted :=
      old.message_class <> 'transactional'
      and old.status in ('queued', 'processing', 'retry', 'sent');
  end if;

  if new_counted and not old_counted then
    insert into public.crm_email_daily_usage (
      photographer_id,
      usage_date,
      reserved_count
    ) values (
      new.photographer_id,
      timezone('utc', now())::date,
      1
    )
    on conflict (photographer_id, usage_date) do update
      set
        reserved_count = public.crm_email_daily_usage.reserved_count + 1,
        updated_at = timezone('utc', now())
      where public.crm_email_daily_usage.reserved_count < 500
    returning reserved_count into reserved;

    if reserved is null then
      raise exception 'CRM daily non-transactional email queue limit reached'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create trigger crm_email_outbox_reserve_daily_capacity
before insert or update of status, message_class on public.crm_email_outbox
for each row execute function public.crm_reserve_daily_email_capacity();

revoke all on function public.crm_reserve_daily_email_capacity()
  from public, anon, authenticated;

-- Approved template content is immutable. Editing creates a new version so a
-- queued message always has an auditable source.
create or replace function public.crm_guard_approved_template()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.is_system and (
    (to_jsonb(new) - 'updated_at') is distinct from
    (to_jsonb(old) - 'updated_at')
  ) then
    raise exception 'Built-in CRM templates are immutable';
  end if;
  if old.approved_at is not null and (
    new.template_key is distinct from old.template_key
    or new.version is distinct from old.version
    or new.subject_template is distinct from old.subject_template
    or new.html_template is distinct from old.html_template
    or new.text_template is distinct from old.text_template
    or new.allowed_variables is distinct from old.allowed_variables
    or new.message_class is distinct from old.message_class
  ) then
    raise exception 'Approved CRM templates are immutable; create a new version';
  end if;
  return new;
end;
$$;

create trigger crm_email_templates_guard_approved
before update on public.crm_email_templates
for each row execute function public.crm_guard_approved_template();

revoke all on function public.crm_guard_approved_template() from public, anon, authenticated;

create or replace function public.crm_validate_automation_rule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  template_status text;
begin
  if new.mode = 'off' then
    new.enabled := false;
  end if;

  if new.mode = 'autopilot' then
    if not new.enabled then
      raise exception 'Autopilot must be explicitly enabled';
    end if;
    select template.status
      into template_status
    from public.crm_email_templates as template
    where template.id = new.template_id
      and template.photographer_id = new.photographer_id;
    if new.action_type = 'email_client' and template_status is distinct from 'approved' then
      raise exception 'Autopilot client email requires an approved template';
    end if;
  end if;
  return new;
end;
$$;

create trigger crm_automation_rules_validate
before insert or update on public.crm_automation_rules
for each row execute function public.crm_validate_automation_rule();

revoke all on function public.crm_validate_automation_rule() from public, anon, authenticated;

-- Automatic cycle history is append-only and cannot be skipped by API code.
create or replace function public.crm_log_cycle_status_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.crm_activities (
      photographer_id,
      client_id,
      booking_cycle_id,
      activity_type,
      summary,
      details,
      source,
      created_by
    ) values (
      new.photographer_id,
      new.client_id,
      new.id,
      'status_change',
      case
        when tg_op = 'INSERT' then 'Booking cycle created as ' || new.status
        else 'Booking status changed from ' || old.status || ' to ' || new.status
      end,
      case
        when tg_op = 'INSERT' then jsonb_build_object('to', new.status)
        else jsonb_build_object('from', old.status, 'to', new.status)
      end,
      case when auth.uid() is null then 'system' else 'user' end,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

create trigger crm_booking_cycles_log_status
after insert or update of status on public.crm_booking_cycles
for each row execute function public.crm_log_cycle_status_change();

revoke all on function public.crm_log_cycle_status_change() from public, anon, authenticated;

-- Atomic queue claim. It first recovers expired leases and suppresses unsafe
-- recipients, then claims rows with SKIP LOCKED so overlapping cron runs cannot
-- deliver the same message.
create or replace function public.crm_claim_email_batch(
  p_worker text,
  p_limit integer default 25,
  p_allow_non_transactional boolean default false
)
returns setof public.crm_email_outbox
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  if nullif(btrim(p_worker), '') is null then
    raise exception 'worker id is required';
  end if;

  update public.crm_email_outbox
  set
    status = case when attempt_count >= max_attempts then 'failed' else 'retry' end,
    next_attempt_at = timezone('utc', now()),
    locked_at = null,
    lease_expires_at = null,
    locked_by = null,
    last_error = 'Delivery lease expired before completion'
  where status = 'processing'
    and lease_expires_at < timezone('utc', now());

  update public.crm_email_outbox as outbox
  set
    status = 'suppressed',
    last_error = 'Recipient is suppressed or lacks required marketing permission',
    locked_at = null,
    lease_expires_at = null,
    locked_by = null
  where outbox.status in ('queued', 'retry')
    and outbox.scheduled_for <= timezone('utc', now())
    and outbox.next_attempt_at <= timezone('utc', now())
    and (
      exists (
        select 1
        from public.crm_email_suppressions as suppression
        where suppression.photographer_id = outbox.photographer_id
          and suppression.email_normalized = outbox.to_email_normalized
          and suppression.lifted_at is null
          and (
            suppression.scope = 'all'
            or (
              suppression.scope = 'non_transactional'
              and outbox.message_class <> 'transactional'
            )
            or (
              suppression.scope = 'marketing'
              and outbox.message_class = 'marketing'
            )
          )
      )
      or exists (
        select 1
        from public.crm_contacts as contact
        where contact.id = outbox.contact_id
          and contact.photographer_id = outbox.photographer_id
          and contact.do_not_contact
      )
      or (
        outbox.recipient_type = 'client'
        and not exists (
          select 1
          from public.crm_contacts as contact
          where contact.id = outbox.contact_id
            and contact.photographer_id = outbox.photographer_id
            and contact.archived_at is null
            and not contact.do_not_contact
            and contact.email_normalized = outbox.to_email_normalized
        )
      )
      or not exists (
        select 1
        from public.crm_clients as client
        where client.id = outbox.client_id
          and client.photographer_id = outbox.photographer_id
          and client.archived_at is null
      )
      or (
        outbox.message_class <> 'transactional'
        and coalesce(outbox.content_metadata ->> 'unsubscribe_ready', 'false') <> 'true'
      )
      or (
        outbox.automation_rule_id is not null
        and not exists (
          select 1
          from public.crm_automation_rules as rule
          join public.crm_email_templates as template
            on template.id = outbox.template_id
           and template.photographer_id = outbox.photographer_id
          where rule.id = outbox.automation_rule_id
            and rule.photographer_id = outbox.photographer_id
            and rule.enabled
            and template.status = 'approved'
            and template.archived_at is null
            and (
              (outbox.delivery_mode = 'autopilot' and rule.mode = 'autopilot')
              or (outbox.delivery_mode = 'approval' and rule.mode = 'approve')
            )
        )
      )
      or (
        outbox.automation_rule_id is not null
        and outbox.booking_cycle_id is not null
        and not exists (
          select 1
          from public.crm_booking_cycles as cycle
          where cycle.id = outbox.booking_cycle_id
            and cycle.photographer_id = outbox.photographer_id
            and cycle.status not in ('booked', 'completed', 'lost', 'skipped')
        )
      )
      or (
        (
          outbox.message_class = 'marketing'
          or outbox.content_metadata ->> 'requires_explicit_consent' = 'true'
        )
        and not exists (
          select 1
          from public.crm_contacts as contact
          where contact.id = outbox.contact_id
            and contact.photographer_id = outbox.photographer_id
            and contact.archived_at is null
            and not contact.do_not_contact
            and contact.marketing_consent = 'opted_in'
        )
      )
    );

  return query
  with candidates as (
    select outbox.id
    from public.crm_email_outbox as outbox
    where outbox.status in ('queued', 'retry')
      and (p_allow_non_transactional or outbox.message_class = 'transactional')
      and outbox.scheduled_for <= timezone('utc', now())
      and outbox.next_attempt_at <= timezone('utc', now())
      and outbox.attempt_count < outbox.max_attempts
    order by outbox.next_attempt_at, outbox.created_at
    for update skip locked
    limit safe_limit
  )
  update public.crm_email_outbox as outbox
  set
    status = 'processing',
    attempt_count = outbox.attempt_count + 1,
    locked_at = timezone('utc', now()),
    lease_expires_at = timezone('utc', now()) + interval '10 minutes',
    locked_by = p_worker,
    updated_at = timezone('utc', now())
  from candidates
  where outbox.id = candidates.id
  returning outbox.*;
end;
$$;

revoke all on function public.crm_claim_email_batch(text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.crm_claim_email_batch(text, integer, boolean) to service_role;

-- Manual one-click sends use the same queue discipline as cron, but claim one
-- known tenant-owned row. The conditional update is the concurrency guard:
-- only one overlapping request can move a row from queued/retry to processing.
create or replace function public.crm_claim_email_by_id(
  p_outbox_id uuid,
  p_photographer_id uuid,
  p_worker text,
  p_allow_non_transactional boolean default false
)
returns setof public.crm_email_outbox
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if nullif(btrim(p_worker), '') is null then
    raise exception 'worker id is required';
  end if;

  update public.crm_email_outbox as outbox
  set
    status = 'suppressed',
    last_error = 'Recipient is suppressed or lacks required marketing permission',
    locked_at = null,
    lease_expires_at = null,
    locked_by = null
  where outbox.id = p_outbox_id
    and outbox.photographer_id = p_photographer_id
    and outbox.status in ('queued', 'retry')
    and (p_allow_non_transactional or outbox.message_class = 'transactional')
    and (
      exists (
        select 1
        from public.crm_email_suppressions as suppression
        where suppression.photographer_id = outbox.photographer_id
          and suppression.email_normalized = outbox.to_email_normalized
          and suppression.lifted_at is null
          and (
            suppression.scope = 'all'
            or (
              suppression.scope = 'non_transactional'
              and outbox.message_class <> 'transactional'
            )
            or (
              suppression.scope = 'marketing'
              and outbox.message_class = 'marketing'
            )
          )
      )
      or exists (
        select 1
        from public.crm_contacts as contact
        where contact.id = outbox.contact_id
          and contact.photographer_id = outbox.photographer_id
          and contact.do_not_contact
      )
      or (
        outbox.recipient_type = 'client'
        and not exists (
          select 1
          from public.crm_contacts as contact
          where contact.id = outbox.contact_id
            and contact.photographer_id = outbox.photographer_id
            and contact.archived_at is null
            and not contact.do_not_contact
            and contact.email_normalized = outbox.to_email_normalized
        )
      )
      or not exists (
        select 1
        from public.crm_clients as client
        where client.id = outbox.client_id
          and client.photographer_id = outbox.photographer_id
          and client.archived_at is null
      )
      or (
        outbox.message_class <> 'transactional'
        and coalesce(outbox.content_metadata ->> 'unsubscribe_ready', 'false') <> 'true'
      )
      or (
        outbox.automation_rule_id is not null
        and not exists (
          select 1
          from public.crm_automation_rules as rule
          join public.crm_email_templates as template
            on template.id = outbox.template_id
           and template.photographer_id = outbox.photographer_id
          where rule.id = outbox.automation_rule_id
            and rule.photographer_id = outbox.photographer_id
            and rule.enabled
            and template.status = 'approved'
            and template.archived_at is null
            and (
              (outbox.delivery_mode = 'autopilot' and rule.mode = 'autopilot')
              or (outbox.delivery_mode = 'approval' and rule.mode = 'approve')
            )
        )
      )
      or (
        outbox.automation_rule_id is not null
        and outbox.booking_cycle_id is not null
        and not exists (
          select 1
          from public.crm_booking_cycles as cycle
          where cycle.id = outbox.booking_cycle_id
            and cycle.photographer_id = outbox.photographer_id
            and cycle.status not in ('booked', 'completed', 'lost', 'skipped')
        )
      )
      or (
        (
          outbox.message_class = 'marketing'
          or outbox.content_metadata ->> 'requires_explicit_consent' = 'true'
        )
        and not exists (
          select 1
          from public.crm_contacts as contact
          where contact.id = outbox.contact_id
            and contact.photographer_id = outbox.photographer_id
            and contact.archived_at is null
            and not contact.do_not_contact
            and contact.marketing_consent = 'opted_in'
        )
      )
    );

  return query
  update public.crm_email_outbox as outbox
  set
    status = 'processing',
    attempt_count = outbox.attempt_count + 1,
    locked_at = timezone('utc', now()),
    lease_expires_at = timezone('utc', now()) + interval '10 minutes',
    locked_by = p_worker,
    updated_at = timezone('utc', now())
  where outbox.id = p_outbox_id
    and outbox.photographer_id = p_photographer_id
    and outbox.status in ('queued', 'retry')
    and (p_allow_non_transactional or outbox.message_class = 'transactional')
    and outbox.scheduled_for <= timezone('utc', now())
    and outbox.next_attempt_at <= timezone('utc', now())
    and outbox.attempt_count < outbox.max_attempts
  returning outbox.*;
end;
$$;

revoke all on function public.crm_claim_email_by_id(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.crm_claim_email_by_id(uuid, uuid, text, boolean) to service_role;

create or replace function public.crm_finish_email_attempt(
  p_outbox_id uuid,
  p_worker text,
  p_succeeded boolean,
  p_provider_message_id text default null,
  p_error_message text default null,
  p_retry_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_row public.crm_email_outbox%rowtype;
  next_status text;
begin
  select * into current_row
  from public.crm_email_outbox
  where id = p_outbox_id
    and status = 'processing'
    and locked_by = p_worker
  for update;

  if not found then
    return false;
  end if;

  if p_succeeded then
    next_status := 'sent';
  elsif current_row.attempt_count < current_row.max_attempts then
    next_status := 'retry';
  else
    next_status := 'failed';
  end if;

  update public.crm_email_outbox
  set
    status = next_status,
    provider_message_id = case
      when p_succeeded then nullif(btrim(p_provider_message_id), '')
      else provider_message_id
    end,
    sent_at = case when p_succeeded then timezone('utc', now()) else sent_at end,
    next_attempt_at = case
      when next_status = 'retry' then coalesce(
        p_retry_at,
        timezone('utc', now()) + make_interval(
          secs => least(3600, 60 * (2 ^ greatest(current_row.attempt_count - 1, 0)))::integer
        )
      )
      else next_attempt_at
    end,
    last_error = case
      when p_succeeded then null
      else left(coalesce(p_error_message, 'Email provider rejected the request'), 1000)
    end,
    locked_at = null,
    lease_expires_at = null,
    locked_by = null,
    updated_at = timezone('utc', now())
  where id = current_row.id;

  insert into public.crm_email_events (
    photographer_id,
    outbox_id,
    event_type,
    provider_message_id,
    error_message,
    metadata
  ) values (
    current_row.photographer_id,
    current_row.id,
    case
      when p_succeeded then 'provider_accepted'
      when next_status = 'retry' then 'retry_scheduled'
      else 'failed'
    end,
    nullif(btrim(p_provider_message_id), ''),
    case when p_succeeded then null else left(p_error_message, 1000) end,
    coalesce(p_metadata, '{}'::jsonb)
  );

  if p_succeeded then
    insert into public.crm_activities (
      photographer_id,
      client_id,
      contact_id,
      booking_cycle_id,
      outbox_id,
      activity_type,
      summary,
      details,
      source
    ) values (
      current_row.photographer_id,
      current_row.client_id,
      current_row.contact_id,
      current_row.booking_cycle_id,
      current_row.id,
      'email',
      'Email accepted for delivery: ' || current_row.subject,
      jsonb_build_object('provider', current_row.provider),
      case when current_row.delivery_mode = 'autopilot' then 'automation' else 'system' end
    );
  end if;

  return true;
end;
$$;

revoke all on function public.crm_finish_email_attempt(
  uuid, text, boolean, text, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.crm_finish_email_attempt(
  uuid, text, boolean, text, text, timestamptz, jsonb
) to service_role;

-- A compact annual rollup keeps the mobile/web clients consistent without
-- storing a counter that can drift.
create or replace view public.crm_client_rollup
with (security_invoker = true)
as
select
  client.id,
  client.photographer_id,
  count(distinct cycle.season_year)
    filter (where cycle.status in ('booked', 'completed'))::integer as years_booked,
  max(cycle.season_year)
    filter (where cycle.status in ('booked', 'completed')) as last_booked_year,
  min(cycle.next_follow_up_at)
    filter (where cycle.status not in ('booked', 'completed', 'lost', 'skipped'))
    as next_follow_up_at
from public.crm_clients as client
left join public.crm_booking_cycles as cycle on cycle.client_id = client.id
group by client.id, client.photographer_id;

-- RLS: no CRM row is public. Authenticated clients are deliberately read-only;
-- all mutations go through guarded dashboard APIs using the service role.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_clients', 'crm_locations', 'crm_contacts', 'crm_agreements',
    'crm_booking_cycles', 'crm_email_templates', 'crm_automation_rules',
    'crm_tasks', 'crm_email_outbox', 'crm_email_events',
    'crm_email_suppressions', 'crm_email_daily_usage', 'crm_activities',
    'crm_automation_runs',
    'crm_client_bundle_requests'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('revoke all on table public.%I from authenticated', table_name);
  end loop;

  foreach table_name in array array[
    'crm_clients', 'crm_locations', 'crm_contacts', 'crm_agreements',
    'crm_booking_cycles', 'crm_email_templates', 'crm_automation_rules',
    'crm_tasks', 'crm_email_outbox', 'crm_email_events',
    'crm_email_suppressions', 'crm_email_daily_usage', 'crm_activities',
    'crm_automation_runs'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.crm_owns_photographer(photographer_id))',
      table_name || '_tenant_select',
      table_name
    );
    execute format('grant select on table public.%I to authenticated', table_name);
  end loop;
end
$$;

grant select on public.crm_client_rollup to authenticated;
grant all on table
  public.crm_clients,
  public.crm_locations,
  public.crm_contacts,
  public.crm_agreements,
  public.crm_booking_cycles,
  public.crm_email_templates,
  public.crm_automation_rules,
  public.crm_tasks,
  public.crm_email_outbox,
  public.crm_email_events,
  public.crm_email_suppressions,
  public.crm_email_daily_usage,
  public.crm_client_bundle_requests,
  public.crm_activities,
  public.crm_automation_runs
to service_role;
grant select on public.crm_client_rollup to service_role;

comment on table public.crm_clients is
  'Permanent CRM clients; distinct from yearly school/project gallery instances.';
comment on column public.crm_agreements.document_key is
  'Private R2/storage object key only; never store a public agreement URL.';
comment on table public.crm_email_outbox is
  'Server-written durable email queue with immutable rendered content and deterministic dedupe keys.';
comment on table public.crm_email_events is
  'Append-only provider/worker delivery events.';

commit;
