-- ISOLATED LAB PILOT BASELINE ONLY. Never a production migration.
-- Schema metadata captured read-only from the current Cloud database on 2026-10-15.
-- Copies column types/defaults, constraints and indexes only; no customer rows,
-- auth signup triggers, other triggers, external hooks, cron jobs or credentials.
-- Runner MUST verify the explicit isolated project ref, then prepend:
-- SET studio_os.lab_pilot_project_ref='lgwmxqjwgkzktikhkebp';
-- Empty-database assertions below also prevent accidental use on an existing project.
-- Not a full Studio OS schema: desktop access/billing/ordinary gallery workflows
-- are intentionally outside this disposable photographer/lab pilot.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=public,extensions,pg_catalog;

do $$ begin
  if current_setting('studio_os.lab_pilot_project_ref',true) is distinct from 'lgwmxqjwgkzktikhkebp' then
    raise exception 'LAB_PILOT_EXPLICIT_ISOLATED_PROJECT_REQUIRED';
  end if;
  if exists(select 1 from pg_tables where schemaname='public')
     or exists(select 1 from auth.users) or exists(select 1 from storage.objects)
     or exists(select 1 from storage.buckets) then
    raise exception 'LAB_PILOT_BASELINE_REQUIRES_EMPTY_DATABASE';
  end if;
end $$;

create table public."studios" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "owner_user_id" uuid,
  "plan" text,
  "subscription_status" text default 'trialing'::text not null,
  "trial_started_at" timestamp with time zone,
  "trial_ends_at" timestamp with time zone,
  "subscription_started_at" timestamp with time zone,
  "subscription_ends_at" timestamp with time zone,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."photographers" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "user_id" uuid not null,
  "business_name" text,
  "logo_url" text,
  "brand_color" text default '#000000'::text,
  "stripe_account_id" text,
  "subscription_status" text default 'trial'::text not null,
  "created_at" timestamp without time zone default now(),
  "studio_id" uuid,
  "is_platform_admin" boolean default false not null,
  "watermark_enabled" boolean default true,
  "watermark_logo_url" text default ''::text,
  "studio_address" text default ''::text,
  "studio_phone" text default ''::text,
  "studio_email" text default ''::text,
  "stripe_connected_account_id" text,
  "stripe_connect_onboarding_complete" boolean default false not null,
  "stripe_connect_charges_enabled" boolean default false not null,
  "stripe_connect_payouts_enabled" boolean default false not null,
  "stripe_platform_customer_id" text,
  "stripe_subscription_id" text,
  "stripe_subscription_item_base_id" text,
  "stripe_subscription_item_extra_keys_id" text,
  "stripe_subscription_item_usage_id" text,
  "subscription_plan_code" text,
  "subscription_current_period_start" timestamp with time zone,
  "subscription_current_period_end" timestamp with time zone,
  "billing_email" text,
  "billing_currency" text default 'cad'::text,
  "order_usage_rate_cents" integer default 25 not null,
  "extra_desktop_keys" integer default 0 not null,
  "subscription_billing_interval" text default 'month'::text not null,
  "studio_app_beta_access" boolean default false not null,
  "studio_app_trial_expires_at" timestamp with time zone,
  "trial_starts_at" timestamp with time zone,
  "trial_ends_at" timestamp with time zone,
  "default_package_profile_id" text,
  "voice_premium_enabled" boolean default false not null,
  "voice_monthly_char_limit" integer default 1000 not null,
  "voice_chars_used_this_month" integer default 0 not null,
  "voice_usage_period_start" timestamp with time zone default now() not null,
  "admin_seen_users_at" timestamp with time zone,
  "sibling_discount_tiers" jsonb default '{"2": 5, "3": 10}'::jsonb not null,
  "shipping_fee_cents" integer default 0 not null,
  "late_handling_fee_percent" numeric(5,2) default 10.0 not null,
  "seen_features" jsonb default '[]'::jsonb not null,
  "tax_enabled" boolean default false not null,
  "tax_percent" numeric(6,3) default 0 not null,
  "tax_label" text default 'Tax'::text not null,
  "tax_country" text default 'CA'::text not null,
  "tax_rates_by_country" jsonb default '{}'::jsonb not null,
  "order_push_show_details" boolean default false not null,
  "watermark_opacity" double precision,
  "business_country" text,
  "stripe_connect_country" text,
  "sales_currency_configured" boolean default false not null,
  "online_backdrops_enabled" boolean default true not null,
  "stripe_standard_migrated_at" timestamp with time zone,
  "stripe_connect_route_version" bigint default 0 not null,
  "stripe_account_history_required" boolean default false not null
);

create table public."subscriptions" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "status" text default 'inactive'::text not null,
  "plan" text,
  "is_admin" boolean default false not null,
  "created_at" timestamp with time zone default now(),
  "photographer_id" uuid,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "stripe_connected_account_id" text,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "billing_email" text,
  "billing_currency" text default 'cad'::text,
  "extra_desktop_keys" integer default 0 not null,
  "updated_at" timestamp with time zone default now() not null,
  "billing_interval" text default 'month'::text not null
);

create table public."photographer_agreements" (
  "id" uuid default gen_random_uuid() not null,
  "photographer_id" uuid not null,
  "user_id" uuid not null,
  "agreement_version" text not null,
  "terms_version" text not null,
  "privacy_version" text not null,
  "accepted_at" timestamp with time zone default now() not null,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone default now() not null
);

create table public."package_profiles" (
  "id" text not null,
  "name" text not null,
  "photographer_id" uuid,
  "created_at" timestamp with time zone default now(),
  "composites_enabled" boolean default false not null
);

create table public."packages" (
  "id" uuid default gen_random_uuid() not null,
  "local_id" text,
  "photographer_id" uuid not null,
  "name" text not null,
  "description" text,
  "price_cents" integer default 0 not null,
  "items" jsonb default '[]'::jsonb,
  "active" boolean default true,
  "created_at" timestamp with time zone default now(),
  "profile_id" text default 'default'::text,
  "profile_name" text default 'Default'::text,
  "category" text default 'package'::text,
  "sort_order" integer,
  "is_retouch_addon" boolean default false not null
);

create table public."schools" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "photographer_id" uuid,
  "school_name" text,
  "event_date" date,
  "created_at" timestamp without time zone default now(),
  "local_school_id" text not null,
  "package_profile_id" text default 'default'::text,
  "shoot_date" timestamp with time zone,
  "order_due_date" timestamp with time zone,
  "notes" text,
  "expiration_date" timestamp with time zone,
  "status" text default 'active'::text,
  "access" text default 'private'::text,
  "password_protected" boolean default false,
  "email_required" boolean default false,
  "gallery_status" text default 'draft'::text,
  "gallery_release_at" timestamp with time zone,
  "gallery_expires_at" timestamp with time zone,
  "pricing_profile_id" uuid,
  "gallery_settings" jsonb default '{}'::jsonb not null,
  "checkout_contact_required" boolean default false not null,
  "internal_notes" text,
  "access_mode" text,
  "access_pin" text,
  "cover_photo_url" text,
  "portal_status" text generated always as (status) stored,
  "gallery_slug" text,
  "screenshot_protection_desktop" boolean default false not null,
  "screenshot_protection_mobile" boolean default false not null,
  "screenshot_protection_watermark" boolean default false not null,
  "archive_date" timestamp with time zone,
  "group_label_singular" text default 'Class'::text not null,
  "group_label_plural" text default 'Classes'::text not null,
  "registration_class_required" boolean default false not null,
  "online_backdrops_override" boolean
);

create table public."projects" (
  "id" uuid default gen_random_uuid() not null,
  "photographer_id" uuid not null,
  "workflow_type" text not null,
  "source_type" text default 'cloud_only'::text not null,
  "linked_school_id" uuid,
  "title" text not null,
  "client_name" text,
  "event_date" date,
  "status" text default 'active'::text,
  "cover_photo_url" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "portal_status" text default 'inactive'::text,
  "pre_release" boolean default false,
  "shoot_date" date,
  "order_due_date" date,
  "expiration_date" date,
  "package_profile_id" uuid,
  "email_required" boolean default false,
  "checkout_contact_required" boolean default false,
  "internal_notes" text,
  "linked_local_school_id" text,
  "access_mode" text default 'public'::text not null,
  "access_pin" text,
  "access_updated_at" timestamp with time zone,
  "access_updated_source" text,
  "gallery_settings" jsonb default '{}'::jsonb not null,
  "cover_focal_x" real default 0.5 not null,
  "cover_focal_y" real default 0.5 not null,
  "gallery_slug" text,
  "screenshot_protection_desktop" boolean default false not null,
  "screenshot_protection_mobile" boolean default false not null,
  "screenshot_protection_watermark" boolean default false not null,
  "archive_date" timestamp with time zone
);

create table public."audit_log" (
  "id" uuid default gen_random_uuid() not null,
  "occurred_at" timestamp with time zone default timezone('utc'::text, now()) not null,
  "actor_user_id" uuid,
  "actor_photographer_id" uuid,
  "actor_ip" inet,
  "actor_user_agent" text,
  "action" text not null,
  "entity_type" text not null,
  "entity_id" text,
  "target_photographer_id" uuid,
  "before" jsonb,
  "after" jsonb,
  "metadata" jsonb default '{}'::jsonb not null,
  "result" text not null,
  "error_message" text,
  "duration_ms" integer
);

alter table public."audit_log" add constraint "audit_log_pkey" PRIMARY KEY (id);
alter table public."audit_log" add constraint "audit_log_result_check" CHECK ((result = ANY (ARRAY['ok'::text, 'denied'::text, 'error'::text])));
alter table public."package_profiles" add constraint "package_profiles_pkey" PRIMARY KEY (id);
alter table public."packages" add constraint "packages_local_id_photographer_id_key" UNIQUE (local_id, photographer_id);
alter table public."packages" add constraint "packages_pkey" PRIMARY KEY (id);
alter table public."photographer_agreements" add constraint "photographer_agreements_pkey" PRIMARY KEY (id);
alter table public."photographers" add constraint "photographers_business_country_check" CHECK ((business_country = ANY (ARRAY['CA'::text, 'US'::text])));
alter table public."photographers" add constraint "photographers_pkey" PRIMARY KEY (id);
alter table public."photographers" add constraint "photographers_stripe_connect_country_check" CHECK ((stripe_connect_country ~ '^[A-Z]{2}$'::text));
alter table public."photographers" add constraint "photographers_subscription_status_check" CHECK ((subscription_status = ANY (ARRAY['trial'::text, 'trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text])));
alter table public."photographers" add constraint "photographers_user_id_unique" UNIQUE (user_id);
alter table public."photographers" add constraint "photographers_voice_chars_used_chk" CHECK ((voice_chars_used_this_month >= 0));
alter table public."photographers" add constraint "photographers_voice_monthly_char_limit_chk" CHECK (((voice_monthly_char_limit >= 0) AND (voice_monthly_char_limit <= 1000000)));
alter table public."photographers" add constraint "photographers_watermark_opacity_range" CHECK (((watermark_opacity IS NULL) OR ((watermark_opacity >= (0)::double precision) AND (watermark_opacity <= (1)::double precision))));
alter table public."projects" add constraint "projects_pkey" PRIMARY KEY (id);
alter table public."projects" add constraint "projects_source_type_check" CHECK ((source_type = ANY (ARRAY['local_school_sync'::text, 'cloud_only'::text, 'hybrid'::text])));
alter table public."projects" add constraint "projects_workflow_type_check" CHECK ((workflow_type = ANY (ARRAY['school'::text, 'event'::text])));
alter table public."schools" add constraint "schools_local_school_id_photographer_id_unique" UNIQUE (local_school_id, photographer_id);
alter table public."schools" add constraint "schools_local_school_id_safe_storage_segment" CHECK (((local_school_id IS NULL) OR ((local_school_id = btrim(local_school_id)) AND (local_school_id <> ''::text) AND (strpos(local_school_id, '/'::text) = 0) AND (strpos(local_school_id, chr(92)) = 0) AND (strpos(local_school_id, '?'::text) = 0) AND (strpos(local_school_id, '#'::text) = 0) AND (local_school_id !~ '[[:cntrl:]]'::text) AND (local_school_id <> ALL (ARRAY['.'::text, '..'::text])) AND (lower(local_school_id) <> ALL (ARRAY['schools'::text, 'photos'::text, 'projects'::text, 'nobg-photos'::text, 'thumbs'::text, 'backdrops'::text, 'probes'::text])))));
alter table public."schools" add constraint "schools_pkey" PRIMARY KEY (id);
alter table public."schools" add constraint "schools_unique_local_photographer" UNIQUE (local_school_id, photographer_id);
alter table public."studios" add constraint "studios_pkey" PRIMARY KEY (id);
alter table public."studios" add constraint "studios_subscription_status_check" CHECK ((subscription_status = ANY (ARRAY['trialing'::text, 'active'::text, 'expired'::text, 'past_due'::text, 'canceled'::text, 'suspended'::text])));
alter table public."subscriptions" add constraint "subscriptions_pkey" PRIMARY KEY (id);
alter table public."subscriptions" add constraint "subscriptions_user_id_key" UNIQUE (user_id);
alter table public."audit_log" add constraint "audit_log_actor_photographer_id_fkey" FOREIGN KEY (actor_photographer_id) REFERENCES photographers(id) ON DELETE SET NULL;
alter table public."audit_log" add constraint "audit_log_target_photographer_id_fkey" FOREIGN KEY (target_photographer_id) REFERENCES photographers(id) ON DELETE SET NULL;
alter table public."package_profiles" add constraint "package_profiles_photographer_id_fkey" FOREIGN KEY (photographer_id) REFERENCES photographers(id) ON DELETE CASCADE;
alter table public."packages" add constraint "packages_photographer_id_fkey" FOREIGN KEY (photographer_id) REFERENCES photographers(id) ON DELETE CASCADE;
alter table public."photographer_agreements" add constraint "photographer_agreements_photographer_id_fkey" FOREIGN KEY (photographer_id) REFERENCES photographers(id) ON DELETE CASCADE;
alter table public."photographer_agreements" add constraint "photographer_agreements_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."photographers" add constraint "photographers_studio_id_fkey" FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE SET NULL;
alter table public."projects" add constraint "projects_linked_school_id_fkey" FOREIGN KEY (linked_school_id) REFERENCES schools(id) ON DELETE CASCADE;
alter table public."projects" add constraint "projects_photographer_id_fkey" FOREIGN KEY (photographer_id) REFERENCES photographers(id) ON DELETE CASCADE;
alter table public."schools" add constraint "schools_photographer_id_fkey" FOREIGN KEY (photographer_id) REFERENCES photographers(id) ON DELETE CASCADE;
alter table public."studios" add constraint "studios_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."subscriptions" add constraint "subscriptions_photographer_id_fkey" FOREIGN KEY (photographer_id) REFERENCES photographers(id) ON DELETE SET NULL;
alter table public."subscriptions" add constraint "subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX audit_actor_user_owner_overview_idx ON public.audit_log USING btree (actor_user_id, occurred_at DESC);
CREATE INDEX audit_log_action_idx ON public.audit_log USING btree (action, occurred_at DESC);
CREATE INDEX audit_log_actor_idx ON public.audit_log USING btree (actor_photographer_id, occurred_at DESC);
CREATE INDEX audit_log_entity_idx ON public.audit_log USING btree (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_log_target_idx ON public.audit_log USING btree (target_photographer_id, occurred_at DESC);
CREATE INDEX photographer_agreements_photographer_version_idx ON public.photographer_agreements USING btree (photographer_id, agreement_version);
CREATE INDEX photographer_agreements_user_version_idx ON public.photographer_agreements USING btree (user_id, agreement_version);
CREATE INDEX idx_photographers_studio_id ON public.photographers USING btree (studio_id);
CREATE INDEX idx_photographers_user_id ON public.photographers USING btree (user_id);
CREATE INDEX photographers_created_at_idx ON public.photographers USING btree (created_at);
CREATE UNIQUE INDEX photographers_stripe_connected_account_id_key ON public.photographers USING btree (stripe_connected_account_id) WHERE (stripe_connected_account_id IS NOT NULL);
CREATE UNIQUE INDEX photographers_stripe_platform_customer_id_key ON public.photographers USING btree (stripe_platform_customer_id) WHERE (stripe_platform_customer_id IS NOT NULL);
CREATE UNIQUE INDEX photographers_stripe_subscription_id_key ON public.photographers USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);
CREATE INDEX photographers_tax_enabled_idx ON public.photographers USING btree (tax_enabled);
CREATE INDEX photographers_trial_ends_at_idx ON public.photographers USING btree (trial_ends_at) WHERE (trial_ends_at IS NOT NULL);
CREATE UNIQUE INDEX photographers_user_id_crm_uidx ON public.photographers USING btree (user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX photographers_voice_premium_enabled_idx ON public.photographers USING btree (voice_premium_enabled) WHERE (voice_premium_enabled = true);
CREATE INDEX idx_projects_linked_local_school_id ON public.projects USING btree (linked_local_school_id);
CREATE UNIQUE INDEX projects_gallery_slug_unique ON public.projects USING btree (gallery_slug) WHERE (gallery_slug IS NOT NULL);
CREATE UNIQUE INDEX projects_id_photographer_crm_uidx ON public.projects USING btree (id, photographer_id);
CREATE UNIQUE INDEX projects_linked_school_id_unique ON public.projects USING btree (linked_school_id) WHERE (linked_school_id IS NOT NULL);
CREATE INDEX projects_photographer_id_idx ON public.projects USING btree (photographer_id);
CREATE INDEX projects_workflow_type_idx ON public.projects USING btree (workflow_type);
CREATE UNIQUE INDEX schools_gallery_slug_unique ON public.schools USING btree (gallery_slug) WHERE (gallery_slug IS NOT NULL);
CREATE UNIQUE INDEX schools_id_photographer_crm_uidx ON public.schools USING btree (id, photographer_id);
CREATE UNIQUE INDEX schools_local_school_id_uniq ON public.schools USING btree (local_school_id);
CREATE UNIQUE INDEX schools_local_school_id_unique ON public.schools USING btree (local_school_id) WHERE (local_school_id IS NOT NULL);
CREATE UNIQUE INDEX schools_local_school_id_unique_nonblank_idx ON public.schools USING btree (lower(local_school_id)) WHERE ((local_school_id IS NOT NULL) AND (local_school_id <> ''::text));
CREATE UNIQUE INDEX schools_local_school_photographer_uidx ON public.schools USING btree (local_school_id, photographer_id);
CREATE INDEX schools_owner_overview_idx ON public.schools USING btree (photographer_id, created_at);
CREATE INDEX idx_studios_owner_user_id ON public.studios USING btree (owner_user_id);
CREATE INDEX idx_studios_subscription_status ON public.studios USING btree (subscription_status);
CREATE UNIQUE INDEX subscriptions_stripe_subscription_id_key ON public.subscriptions USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);

-- No browser can create profiles, change billing, or mutate legacy pilot tables.
alter table public."studios" enable row level security;
alter table public."studios" force row level security;
revoke all on public."studios" from public,anon,authenticated;
grant select,insert,update,delete on public."studios" to service_role;
alter table public."photographers" enable row level security;
alter table public."photographers" force row level security;
revoke all on public."photographers" from public,anon,authenticated;
grant select,insert,update,delete on public."photographers" to service_role;
alter table public."subscriptions" enable row level security;
alter table public."subscriptions" force row level security;
revoke all on public."subscriptions" from public,anon,authenticated;
grant select,insert,update,delete on public."subscriptions" to service_role;
alter table public."photographer_agreements" enable row level security;
alter table public."photographer_agreements" force row level security;
revoke all on public."photographer_agreements" from public,anon,authenticated;
grant select,insert,update,delete on public."photographer_agreements" to service_role;
alter table public."package_profiles" enable row level security;
alter table public."package_profiles" force row level security;
revoke all on public."package_profiles" from public,anon,authenticated;
grant select,insert,update,delete on public."package_profiles" to service_role;
alter table public."packages" enable row level security;
alter table public."packages" force row level security;
revoke all on public."packages" from public,anon,authenticated;
grant select,insert,update,delete on public."packages" to service_role;
alter table public."schools" enable row level security;
alter table public."schools" force row level security;
revoke all on public."schools" from public,anon,authenticated;
grant select,insert,update,delete on public."schools" to service_role;
alter table public."projects" enable row level security;
alter table public."projects" force row level security;
revoke all on public."projects" from public,anon,authenticated;
grant select,insert,update,delete on public."projects" to service_role;
alter table public."audit_log" enable row level security;
alter table public."audit_log" force row level security;
revoke all on public."audit_log" from public,anon,authenticated;
grant select,insert,update,delete on public."audit_log" to service_role;

-- Use the real MFA/session policy semantics without importing unrelated RPCs.
create or replace function public.dashboard_session_mfa_allowed(p_allow_admin_setup boolean default false)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  if exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified') then
    return coalesce(auth.jwt()->>'aal'='aal2',false);
  end if;
  -- An owner without an enrolled factor may read their own profile to enroll.
  -- All other owner data and mutations require enrollment, including legacy admins.
  return p_allow_admin_setup or not (
    exists(select 1 from public.photographers p where p.user_id=auth.uid() and p.is_platform_admin)
    or exists(select 1 from public.subscriptions s where s.user_id=auth.uid() and s.is_admin)
  );
end $$;
revoke all on function public.dashboard_session_mfa_allowed(boolean) from public,anon,authenticated;
grant execute on function public.dashboard_session_mfa_allowed(boolean) to authenticated,service_role;
grant select on public.photographers,public.subscriptions,public.photographer_agreements to authenticated;
create policy pilot_photographer_read_own on public.photographers for select to authenticated
  using(user_id=auth.uid() and public.dashboard_session_mfa_allowed(true));
create policy pilot_subscription_read_own on public.subscriptions for select to authenticated
  using(user_id=auth.uid() and public.dashboard_session_mfa_allowed(false));
create policy pilot_agreement_read_own on public.photographer_agreements for select to authenticated
  using(user_id=auth.uid() and public.dashboard_session_mfa_allowed(false));

-- Real, confirmed-user database initialization; no signup email or provider calls.
-- Signup creates a placeholder profile. Initialize it exactly once after a
-- verified sign-in, rather than bypassing it because the row already exists.
create or replace function public.initialize_photographer_trial(p_user_id uuid)
returns table (photographer_id uuid, trial_initialized boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user auth.users%rowtype;
  v_profile public.photographers%rowtype;
  v_name text;
  v_start timestamptz;
  v_end timestamptz;
  v_initialized boolean := false;
begin
  -- Also serializes creation when multiple first-visit requests arrive together.
  select * into v_user from auth.users where id = p_user_id for update;
  if not found or v_user.email_confirmed_at is null then
    raise exception 'A confirmed account is required to initialize a trial.';
  end if;

  v_name := coalesce(nullif(btrim(v_user.raw_user_meta_data->>'business_name'), ''),
    nullif(split_part(v_user.email, '@', 1), ''), 'Studio OS Photographer');

  insert into public.photographers (user_id, business_name, billing_email)
  values (p_user_id, v_name, v_user.email)
  on conflict (user_id) do nothing;

  select * into strict v_profile from public.photographers where user_id = p_user_id for update;

  -- Never reset an established trial or rewrite a paid/canceled/owner account.
  if not v_profile.is_platform_admin
     and v_profile.subscription_status = 'trial'
     and v_profile.stripe_subscription_id is null
     and (nullif(btrim(v_profile.subscription_plan_code), '') is null
       or v_profile.trial_starts_at is null or v_profile.trial_ends_at is null) then
    v_start := coalesce(v_profile.trial_starts_at,
      v_profile.trial_ends_at - interval '720 hours', transaction_timestamp());
    v_end := coalesce(v_profile.trial_ends_at, v_start + interval '720 hours');
    update public.photographers set
      subscription_plan_code = coalesce(nullif(btrim(subscription_plan_code), ''), 'studio'),
      trial_starts_at = v_start,
      trial_ends_at = v_end,
      billing_email = coalesce(nullif(btrim(billing_email), ''), v_user.email),
      business_name = case when nullif(btrim(business_name), '') is null
        or business_name = 'My Photography Business' then v_name else business_name end
    where id = v_profile.id;
    v_initialized := true;
  end if;

  return query select v_profile.id, v_initialized;
end;
$$;

revoke all on function public.initialize_photographer_trial(uuid) from public, anon, authenticated;
grant execute on function public.initialize_photographer_trial(uuid) to service_role;

comment on function public.initialize_photographer_trial(uuid) is
  'Service-only, confirmed-user trial initialization; preserves existing expiry, billing, and owner state.';

commit;
