import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  countCrmActiveCashPaidBookings,
  summarizeCrmBookingPayments,
} = await import("../../lib/crm.ts");

const migration = source(
  "supabase/migrations/20260826120000_create_crm_booking_jobs.sql",
);
const route = source("app/api/dashboard/crm/route.ts");
const loader = source("lib/crm.ts");
const workspace = source("components/crm/crm-clients-workspace.tsx");

test("CRM booking jobs migration is atomic and tenant-safe", () => {
  assert.match(migration, /\bbegin;/i);
  assert.match(migration, /\bcommit;\s*$/i);
  assert.match(migration, /create table public\.crm_booking_jobs \(/i);
  for (const column of [
    "photographer_id",
    "client_id",
    "location_id",
    "booking_cycle_id",
    "gallery_school_id",
    "booking_event_id",
    "role",
    "created_by",
    "created_at",
    "updated_at",
  ]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`, "i"));
  }
  assert.match(migration, /role in \('primary', 'retake', 'makeup', 'other'\)/i);
  assert.match(
    migration,
    /booking_events_id_school_photographer_crm_uidx[\s\S]*\(id, school_id, photographer_id\)/i,
  );
  assert.match(
    migration,
    /schools_local_school_photographer_uidx[\s\S]*\(local_school_id, photographer_id\)/i,
  );
  assert.match(
    migration,
    /booking_events_school_id_crm_uidx[\s\S]*\(school_id\)/i,
  );
  assert.match(
    migration,
    /foreign key \(booking_event_id, gallery_school_id, photographer_id\)[\s\S]*references public\.booking_events\(id, school_id, photographer_id\)/i,
  );
  assert.match(
    migration,
    /foreign key \(location_id, client_id, photographer_id\)[\s\S]*references public\.crm_locations\(id, client_id, photographer_id\)/i,
  );
  assert.match(
    migration,
    /foreign key \(booking_cycle_id, client_id, photographer_id\)[\s\S]*references public\.crm_booking_cycles\(id, client_id, photographer_id\)/i,
  );
  assert.match(migration, /unique \(photographer_id, gallery_school_id\)/i);
  assert.match(
    migration,
    /unique index crm_booking_jobs_event_idx[\s\S]*\(photographer_id, booking_event_id\)[\s\S]*where booking_event_id is not null/i,
  );
  assert.match(
    migration,
    /group by cycle\.photographer_id, cycle\.gallery_school_id[\s\S]*having count\(\*\) > 1[\s\S]*Cannot backfill CRM booking jobs/i,
  );
  const backfill = migration.slice(
    migration.indexOf("insert into public.crm_booking_jobs"),
    migration.indexOf("create or replace function public.crm_ensure_school_booking_job"),
  );
  assert.doesNotMatch(backfill, /on conflict[\s\S]*do nothing/i);
});

test("CRM booking jobs are authenticated read-only and service-mutated", () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /for select[\s\S]*to authenticated[\s\S]*crm_owns_photographer\(photographer_id\)/i);
  assert.match(migration, /grant select on table public\.crm_booking_jobs to authenticated/i);
  assert.doesNotMatch(migration, /for (?:insert|update|delete|all)[\s\S]{0,80}to authenticated/i);
  assert.match(
    migration,
    /revoke all on function public\.crm_ensure_school_booking_job[\s\S]*public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.crm_ensure_school_booking_job[\s\S]*to service_role/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.crm_reassign_school_booking_job[\s\S]*public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.crm_reassign_school_booking_job[\s\S]*to service_role/i,
  );
});

test("ensure-school-job RPC is owner-bound, exact-ID-only, replay-safe, and repairs later links", () => {
  assert.match(migration, /photographer\.user_id = p_actor_user_id/i);
  assert.match(migration, /school\.id = p_gallery_school_id[\s\S]*school\.photographer_id = p_photographer_id/i);
  assert.match(migration, /client\.id = p_client_id[\s\S]*client\.photographer_id = p_photographer_id/i);
  assert.match(migration, /location\.id = p_location_id[\s\S]*location\.client_id = selected_client_id/i);
  assert.doesNotMatch(migration, /\bilike\b/i);
  assert.match(migration, /on conflict \(photographer_id, request_key\) do nothing/i);
  assert.match(migration, /request\.payload_fingerprint[\s\S]*different data/i);
  assert.match(migration, /insert into public\.crm_clients/i);
  assert.match(migration, /insert into public\.crm_locations[\s\S]*'Main campus'/i);
  assert.match(migration, /insert into public\.crm_booking_cycles/i);
  assert.match(migration, /insert into public\.crm_booking_jobs/i);
  assert.match(migration, /if existing_job\.booking_event_id is null then[\s\S]*set booking_event_id = selected_event_id/i);
  assert.match(migration, /if existing_job\.location_id is null then[\s\S]*set location_id = selected_location_id/i);
  assert.match(migration, /elsif existing_job\.location_id <> selected_location_id then[\s\S]*another CRM campus/i);
  assert.match(migration, /selected_location_count > 1[\s\S]*CRM campus is required when this client has multiple campuses/i);
  assert.doesNotMatch(migration, /order by location\.is_primary desc/i);
  assert.match(migration, /p_repair_only boolean default false/i);
  assert.match(migration, /if coalesce\(p_repair_only, false\) then[\s\S]*repair target was not found/i);
  assert.match(migration, /result = bundle_result,[\s\S]*completed_at = timezone\('utc', now\(\)\)/i);
  assert.ok(
    [...migration.matchAll(/pg_catalog\.pg_advisory_xact_lock\([\s\S]*?'crm_school_booking_job:' \|\| p_photographer_id::text[\s\S]*?\)/gi)].length >= 2,
    "ensure and reassign must share one photographer-scoped transaction mutex",
  );

  const replayStart = migration.indexOf("if not coalesce(request_inserted, false) then");
  const existingJobStart = migration.indexOf("select job.* into existing_job", replayStart);
  assert.ok(replayStart >= 0 && existingJobStart > replayStart);
  assert.doesNotMatch(migration.slice(replayStart, existingJobStart), /return bundle_result;/i);
});

test("a distinct event-repair request can reuse an explicit existing binding", () => {
  const jobLookup = migration.indexOf("select job.* into existing_job");
  const existingBranch = migration.indexOf("if existing_job.id is not null then", jobLookup);
  const createClientBranch = migration.indexOf("if p_client_id is null then", existingBranch);
  assert.ok(jobLookup >= 0 && existingBranch > jobLookup && createClientBranch > existingBranch);
  const reuseSection = migration.slice(existingBranch, createClientBranch);
  assert.match(reuseSection, /where job\.photographer_id = p_photographer_id|existing_job\.client_id/);
  assert.match(reuseSection, /if existing_job\.booking_event_id is null then/);
  assert.match(reuseSection, /set booking_event_id = selected_event_id/);
  assert.match(reuseSection, /'jobId', existing_job\.id/);
  assert.match(route, /clientId: Uuid\.nullable\(\)\.optional\(\)/);
  assert.match(route, /locationId: Uuid\.nullable\(\)\.optional\(\)/);
  assert.match(route, /repairOnly: z\.boolean\(\)\.optional\(\)/);
  assert.match(route, /p_repair_only: body\.repairOnly \?\? false/);
});

test("existing school jobs reconcile only their cycle when the shoot year changes", () => {
  assert.match(migration, /existing_cycle_year is distinct from selected_year/i);
  assert.match(
    migration,
    /where cycle\.client_id = existing_job\.client_id[\s\S]*cycle\.season_year = selected_year/i,
  );
  assert.match(
    migration,
    /update public\.crm_booking_jobs[\s\S]*set booking_cycle_id = selected_cycle_id[\s\S]*where id = existing_job\.id/i,
  );
  assert.doesNotMatch(
    migration,
    /update public\.crm_booking_cycles[\s\S]*set season_year = selected_year/i,
  );
  assert.match(
    migration,
    /Neutralize only the untouched, generated source cycle[\s\S]*status = 'not_contacted'[\s\S]*not exists \([\s\S]*public\.crm_booking_jobs/i,
  );
  assert.ok(
    [...migration.matchAll(/and cycle\.project_id is null/gi)].length >= 4,
    "school jobs must never reuse project-linked CRM cycles",
  );
  assert.match(
    migration,
    /'school_' \|\| left\(replace\((?:p_gallery_school_id|existing_job\.gallery_school_id)::text, '-', ''\), 32\)/i,
  );
  assert.match(
    migration,
    /set gallery_school_id = null[\s\S]*if selected_cycle_id is null then[\s\S]*insert into public\.crm_booking_cycles/i,
  );
  assert.match(
    migration,
    /activity\.activity_type = 'status_change'[\s\S]*activity\.summary = 'Booking cycle created as booked'[\s\S]*activity\.details = jsonb_build_object\('to', 'booked'\)[\s\S]*activity\.source = 'system'[\s\S]*activity\.created_by is null/i,
  );
  assert.ok(
    [...migration.matchAll(/on conflict \(client_id, season_year, cycle_key\) do update[\s\S]*?where crm_booking_cycles\.project_id is null[\s\S]*?returning id into selected_cycle_id;[\s\S]*?if selected_cycle_id is null then[\s\S]*?school cycle key conflicts with another source/gi)].length >= 3,
    "every school-cycle upsert must reject a conflicting project/other source",
  );
  assert.match(
    migration,
    /if existing_job\.id is not null then[\s\S]*perform 1[\s\S]*client\.id = existing_job\.client_id[\s\S]*for update;[\s\S]*select cycle\.season_year into existing_cycle_year[\s\S]*cycle\.id = existing_job\.booking_cycle_id[\s\S]*for update;[\s\S]*if school_row\.shoot_date is null then[\s\S]*selected_year := existing_cycle_year/i,
  );
  for (const historyTable of [
    "crm_tasks",
    "crm_email_outbox",
    "crm_activities",
    "crm_automation_runs",
  ]) {
    assert.match(
      migration,
      new RegExp(`not exists \\([\\s\\S]*public\\.${historyTable}`, "i"),
    );
  }
});

test("dashboard API exposes an audited, payload-fingerprinted ensure action", () => {
  assert.match(route, /action: z\.literal\("ensureSchoolBookingJob"\)/);
  assert.match(route, /gallerySchoolId: Uuid/);
  assert.match(route, /Choose the CRM client before assigning one of its campuses/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /service\.rpc\("crm_ensure_school_booking_job"/);
  assert.match(route, /p_photographer_id: photographer\.id/);
  assert.match(route, /p_actor_user_id: user\.id/);
  assert.match(route, /SchoolBookingJobBundleResult\.safeParse\(data\)/);
  assert.match(route, /action: "crm\.booking_job\.ensure"/);
});

test("exact-ID booking-job repair is tenant-bound, campus-bound, audited, and preserves source truth", () => {
  assert.match(migration, /create or replace function public\.crm_reassign_school_booking_job/i);
  assert.match(
    migration,
    /where job\.id = p_job_id[\s\S]*job\.photographer_id = p_photographer_id[\s\S]*for update/i,
  );
  assert.match(
    migration,
    /client\.id = p_client_id[\s\S]*client\.photographer_id = p_photographer_id[\s\S]*client\.kind in \('school', 'college', 'university', 'daycare', 'montessori'\)/i,
  );
  assert.match(
    migration,
    /location\.id = p_location_id[\s\S]*location\.client_id = p_client_id[\s\S]*location\.photographer_id = p_photographer_id/i,
  );
  const repairFunction = migration.slice(
    migration.indexOf("create or replace function public.crm_reassign_school_booking_job"),
    migration.indexOf("revoke all on function public.crm_ensure_school_booking_job"),
  );
  assert.match(
    repairFunction,
    /set[\s\S]*client_id = p_client_id,[\s\S]*location_id = p_location_id,[\s\S]*booking_cycle_id = selected_cycle_id/i,
  );
  assert.doesNotMatch(repairFunction, /set[\s\S]*gallery_school_id = p_gallery_school_id/i);
  assert.doesNotMatch(repairFunction, /delete from public\.crm_booking_jobs/i);
  assert.doesNotMatch(repairFunction, /\bilike\b/i);
  assert.match(
    repairFunction,
    /cycle\.id = previous_cycle_id[\s\S]*cycle\.client_id = p_client_id[\s\S]*cycle\.season_year = selected_year[\s\S]*cycle\.project_id is null/i,
  );
  assert.match(
    repairFunction,
    /perform 1[\s\S]*from public\.crm_clients as client[\s\S]*client\.id = p_client_id[\s\S]*client\.archived_at is null[\s\S]*for update;[\s\S]*if not found then[\s\S]*Education CRM client not found/i,
  );
  const sourceRead = repairFunction.indexOf("select job.gallery_school_id into selected_school_id");
  const schoolLock = repairFunction.indexOf("select school.* into school_row", sourceRead);
  const jobLock = repairFunction.indexOf("select job.* into existing_job", schoolLock);
  assert.ok(sourceRead >= 0 && schoolLock > sourceRead && jobLock > schoolLock);
  assert.match(
    repairFunction.slice(sourceRead, schoolLock),
    /select job\.gallery_school_id into selected_school_id[\s\S]*CRM booking job was not found/i,
  );
  assert.match(
    repairFunction.slice(schoolLock, jobLock),
    /from public\.schools as school[\s\S]*for update/i,
  );
  assert.match(
    repairFunction.slice(jobLock),
    /from public\.crm_booking_jobs as job[\s\S]*for update/i,
  );
  assert.match(
    repairFunction,
    /if school_row\.shoot_date is null then[\s\S]*select cycle\.season_year into selected_year[\s\S]*cycle\.id = existing_job\.booking_cycle_id[\s\S]*for update;/i,
  );

  assert.match(route, /action: z\.literal\("reassignSchoolBookingJob"\)/);
  assert.match(route, /service\.rpc\("crm_reassign_school_booking_job"/);
  assert.match(route, /p_job_id: body\.jobId/);
  assert.match(route, /p_client_id: body\.clientId/);
  assert.match(route, /p_location_id: body\.locationId/);
  assert.match(route, /action: "crm\.booking_job\.reassign"/);
});

test("CRM cash totals exclude studio credit and split active from retained cancellation cash", () => {
  const totals = summarizeCrmBookingPayments(
    [
      { id: "active", status: "confirmed" },
      { id: "cancelled", status: "cancelled" },
      { id: "canceled", status: "canceled" },
      { id: "credit-only", status: "confirmed" },
    ],
    [
      { booking_id: "active", status: "succeeded", amount_cents: 3000, currency: "CAD", type: "card" },
      { booking_id: "cancelled", status: "succeeded", amount_cents: 3000, currency: "CAD", type: "card" },
      { booking_id: "canceled", status: "succeeded", amount_cents: 500, currency: "CAD", type: "card" },
      { booking_id: "active", status: "succeeded", amount_cents: 1500, currency: "CAD", type: "credit" },
      { booking_id: "credit-only", status: "succeeded", amount_cents: 1700, currency: "CAD", type: "credit" },
      { booking_id: "active", status: "succeeded", amount_cents: 2200, currency: "USD", type: "card" },
      { booking_id: "active", status: "failed", amount_cents: 9000, currency: "CAD", type: "card" },
      { booking_id: "not-this-event", status: "succeeded", amount_cents: 1200, currency: "CAD", type: "card" },
    ],
  );
  assert.deepEqual(totals, [
    {
      currency: "CAD",
      activeCashCents: 3000,
      retainedCancellationCashCents: 3500,
      grossCollectedCents: 6500,
      creditRedeemedCents: 3200,
    },
    {
      currency: "USD",
      activeCashCents: 2200,
      retainedCancellationCashCents: 0,
      grossCollectedCents: 2200,
      creditRedeemedCents: 0,
    },
  ]);
  assert.equal(
    countCrmActiveCashPaidBookings(
      [
        { id: "active", status: "confirmed" },
        { id: "cancelled", status: "cancelled" },
        { id: "credit-only", status: "confirmed" },
      ],
      [
        { booking_id: "active", status: "succeeded", type: "card" },
        { booking_id: "active", status: "succeeded", type: "card" },
        { booking_id: "cancelled", status: "succeeded", type: "card" },
        { booking_id: "credit-only", status: "succeeded", type: "credit" },
      ],
    ),
    1,
  );
});

test("CRM dashboard batches owner-scoped booking history without exposing payment credentials", () => {
  assert.match(loader, /offset \+= 200/);
  assert.match(loader, /select\(input\.select, \{ count: "exact" \}\)/);
  assert.match(loader, /\.order\("id", \{ ascending: true \}\)/);
  assert.match(loader, /\.range\(rowOffset, rowOffset \+ pageSize - 1\)/);
  assert.match(loader, /rowOffset >= count/);
  assert.match(loader, /\.eq\("photographer_id", input\.photographerId\)/);
  assert.match(loader, /table: "crm_booking_jobs"/);
  assert.match(loader, /table: "crm_locations"/);
  assert.match(loader, /table: "crm_booking_cycles"/);
  assert.match(loader, /table: "booking_events"/);
  assert.match(loader, /table: "booking_slots"/);
  assert.match(loader, /table: "bookings"/);
  assert.match(loader, /table: "booking_payments"/);
  assert.match(loader, /select: "id,booking_id,status,amount_cents,currency,type,created_at"/);
  assert.match(loader, /bookingJobs: bookingJobRows\.map/);
  assert.match(loader, /bookingHistory,/);
  assert.match(loader, /bookingEventId: eventId \|\| null/);
  assert.match(loader, /publicUrl: summary\?\.publicUrl \?\? null/);
  assert.match(loader, /activeCashCents/);
  assert.match(loader, /retainedCancellationCashCents/);
  assert.match(loader, /paymentTotalsByCurrency/);
  assert.match(loader, /countCrmActiveCashPaidBookings\(eventBookings, eventPayments\)/);
  assert.match(loader, /total\.activeCashCents \+ total\.retainedCancellationCashCents/);
  assert.doesNotMatch(loader, /stripe_(?:payment_intent|charge)_id/i);
});

test("Cloud CRM presents lifetime booking history and never mixes currency totals", () => {
  assert.match(workspace, /bookingJobs: arrayOrEmpty<CrmBookingJob>\(source\.bookingJobs\)/);
  assert.match(workspace, /bookingHistory: arrayOrEmpty<CrmBookingHistory>\(source\.bookingHistory\)/);
  assert.match(workspace, /const moneyByCurrency = new Map/);
  assert.match(workspace, /moneyByCurrency\.set\(currency, total\)/);
  assert.match(workspace, /School booking history/);
  assert.match(workspace, /Lifetime shoots/);
  assert.match(workspace, /Cash-paid bookings/);
  assert.match(workspace, /Gross booking fees collected/);
  assert.match(workspace, /From active appointment bookings/);
  assert.match(workspace, /Retained cancellation fees/);
  assert.match(workspace, /Studio credit redeemed/);
  assert.match(workspace, /history\.locationLabel \|\| "Campus not assigned"/);
  assert.match(workspace, /Open booking page/);
  assert.match(workspace, /href=\{history\.publicUrl\}/);
  assert.match(workspace, /target="_blank"/);
  assert.match(workspace, /Repair CRM link/);
  assert.match(workspace, /action: "reassignSchoolBookingJob"/);
  assert.match(workspace, /Choose the exact campus/);
  assert.match(workspace, /gallery, appointment page, bookings, and payments stay intact/i);
  assert.doesNotMatch(workspace, /Net revenue/i);
});
