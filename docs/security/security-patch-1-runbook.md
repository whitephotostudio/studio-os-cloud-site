# Security Patch 1 runbook

Status: Phase A and Phase B were deployed on 2026-07-21. `send-digital-delivery`
is active as version 19; requests with no authorization and an invalid bearer
token both returned HTTP 401. The reviewed database transaction was applied
successfully and recorded as migration `20260722010000` in the live migration
ledger. No rollback was required.

## Scope

This patch does three things and nothing else:

1. Requires a valid Supabase user session for `send-digital-delivery`, verifies
   that the order belongs to that photographer, derives the recipient from the
   order, and limits photo paths to that order's student folder.
2. Removes blanket anonymous reads/inserts from private gallery tables while
   preserving authenticated photographer RLS and server-side parent portal
   access.
3. Revokes anonymous execution of two elevated internal device-registration
   helpers.

R2 credentials, R2 public access, Stripe, booking creation, booking payments,
automatic roster creation, printing, and Noritsu output are not changed.

## Critical migration warning

Do **not** run `supabase db push` for this repository. The local and remote
migration histories are divergent, and a bulk push could attempt unrelated old
migrations.

The only SQL applied for this patch was the single transaction in:

`supabase/migrations/20260722010000_security_patch_1_close_anonymous_access.sql`

It was applied by itself through a controlled SQL execution after the Edge
Function smoke test. Its final assertions completed successfully. Do not
reapply it manually.

## Pre-deployment checks

- Confirm the verified external backup location in
  `/Users/harout/StudioOS_Security_Backups/LATEST_BACKUP_LOCATION.md`.
- Run `npm run test:security`.
- Run targeted ESLint on the function and security tests.
- Run `npm run build`.
- Record booking/student/order totals. Do not print names, PINs, emails, tokens,
  or photo URLs.

## Controlled deployment order

### Phase A: Edge Function only

1. [Complete] Deploy only `send-digital-delivery`; do not deploy every function.
2. [Complete] Confirm requests without a valid user JWT return HTTP 401 and send
   no email.
3. [Pending] With the user present, send one explicitly approved test delivery from the
   signed-in Studio OS app.
4. [Pending] Confirm the correct existing order and recipient were used and no unrelated
   order changed.

Stop and restore the backed-up function if the signed-in test fails.

### Phase B: database transaction only

1. [Complete] Execute only the Security Patch 1 migration file.
2. [Complete] Confirm anonymous REST reads return no rows for `students`, `projects`,
   `schools`, `collections`, `package_profiles`, `pre_release_emails`, and
   `pre_release_registrations`.
3. [Complete] Confirm anonymous RPC calls to both internal helper functions return
   permission denied.
4. [Complete: RLS role simulation] Confirm the authenticated photographer role
   can still read the same schools, projects, students, collections, package
   profiles, packages, bookings, and orders.
5. [Complete] Confirm the parent portal, portal choices API, and public booking
   availability remain healthy.
6. [Pending user workflow check] Confirm a signed-in Studio OS refresh and the
   next controlled booking/payment/automatic-roster/printing/Noritsu workflow.

## Emergency database rollback

Use only if an authenticated production workflow fails after Phase B. This
temporarily restores the insecure legacy access while the cause is diagnosed.

```sql
begin;

create policy "Anon can read collections"
  on public.collections for select to anon using (true);
create policy "Anon can read package profiles"
  on public.package_profiles for select to anon using (true);
create policy "Anon can read projects"
  on public.projects for select to anon using (true);
create policy "Anon can read schools"
  on public.schools for select to anon using (true);
create policy "Anon can read students"
  on public.students for select to anon using (true);
create policy parent_pin_lookup
  on public.students for select using (true);

create policy public_can_read_own
  on public.pre_release_emails for select to authenticated, anon using (true);
create policy public_can_register
  on public.pre_release_emails for insert to authenticated, anon with check (true);
create policy parents_can_check_own
  on public.pre_release_registrations for select using (true);
create policy photographer_can_read
  on public.pre_release_registrations for select using (true);
create policy parents_can_register
  on public.pre_release_registrations for insert with check (true);

grant execute on function public._link_device_to_photography_key(uuid, text, text, text, text)
  to anon, authenticated;
grant execute on function public._upsert_device_registration(text, uuid, uuid, text, text, text, text, timestamptz)
  to anon, authenticated;

commit;
```

After any rollback, re-run the read-only audit and prepare a corrected patch.
