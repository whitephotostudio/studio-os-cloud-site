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
  appendCrmUnsubscribe,
  classifyCrmDraftMessage,
  crmEmailDedupeKey,
  renderCrmEmailTemplate,
} = await import("../../lib/crm-email.ts");
const { crmPublicRow, parseCrmValues } = await import("../../lib/crm.ts");
const {
  createCrmUnsubscribeUrl,
  verifyCrmUnsubscribeToken,
} = await import("../../lib/crm-unsubscribe.ts");

const migration = source(
  "supabase/migrations/20260824200000_create_crm_foundation.sql",
);
const primaryMigration = source(
  "supabase/migrations/20260824210000_add_crm_atomic_primary_switch.sql",
);
const api = source("app/api/dashboard/crm/route.ts");
const email = source("lib/crm-email.ts");
const cron = source("app/api/cron/crm-automation/route.ts");
const unsubscribeRoute = source("app/api/crm/unsubscribe/route.ts");

test("CRM migration is atomic and creates the complete shared model", () => {
  assert.match(migration, /\bbegin;/i);
  assert.match(migration, /\bcommit;\s*$/i);
  for (const table of [
    "crm_clients",
    "crm_locations",
    "crm_contacts",
    "crm_agreements",
    "crm_booking_cycles",
    "crm_tasks",
    "crm_email_templates",
    "crm_automation_rules",
    "crm_email_outbox",
    "crm_email_events",
    "crm_email_suppressions",
    "crm_activities",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table} \\(`));
  }
  for (const kind of [
    "school",
    "corporate",
    "wedding",
    "event",
    "sports",
    "family",
    "person",
    "nonprofit",
    "other",
  ]) {
    assert.match(migration, new RegExp(`'${kind}'`));
  }
});

test("every relationship carries a composite tenant foreign key", () => {
  assert.match(
    migration,
    /foreign key \(client_id, photographer_id\)[\s\S]*references public\.crm_clients\(id, photographer_id\)/i,
  );
  assert.match(
    migration,
    /foreign key \(contact_id, client_id, photographer_id\)[\s\S]*references public\.crm_contacts\(id, client_id, photographer_id\)/i,
  );
  assert.match(
    migration,
    /foreign key \(booking_cycle_id, client_id, photographer_id\)[\s\S]*references public\.crm_booking_cycles\(id, client_id, photographer_id\)/i,
  );
  assert.match(
    migration,
    /foreign key \(template_id, photographer_id\)[\s\S]*references public\.crm_email_templates\(id, photographer_id\)/i,
  );
  assert.match(migration, /schools_id_photographer_crm_uidx/i);
  assert.match(migration, /projects_id_photographer_crm_uidx/i);
});

test("RLS is forced and ownership resolves through the authenticated photographer", () => {
  assert.match(migration, /create or replace function public\.crm_owns_photographer/i);
  assert.match(migration, /photographer\.user_id = auth\.uid\(\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /revoke all on table public\.%I from anon/i);
  assert.match(migration, /using \(public\.crm_owns_photographer\(photographer_id\)\)/i);
  assert.doesNotMatch(migration, /for (?:select|all) to anon/i);
  assert.doesNotMatch(migration, /for all to authenticated/i);
  assert.doesNotMatch(migration, /for (?:insert|update|delete) to authenticated/i);
  assert.doesNotMatch(migration, /grant select, insert[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)[\s\S]*to authenticated/i);
  assert.match(migration, /revoke all on table public\.%I from authenticated/i);
});

test("client bundle creation is transactional, owner-bound, service-only, and idempotent", () => {
  assert.match(migration, /create table public\.crm_client_bundle_requests/i);
  assert.match(migration, /primary key \(photographer_id, request_key\)/i);
  assert.match(migration, /payload_fingerprint text not null/i);
  assert.match(migration, /create or replace function public\.crm_create_client_bundle/i);
  assert.match(migration, /photographer\.user_id = p_created_by/i);
  assert.match(migration, /on conflict \(photographer_id, request_key\) do nothing/i);
  assert.match(migration, /request\.payload_fingerprint[\s\S]*different data/i);
  for (const table of ["crm_clients", "crm_locations", "crm_contacts", "crm_booking_cycles"]) {
    assert.match(migration, new RegExp(`insert into public\\.${table}`));
  }
  assert.match(
    migration,
    /revoke all on function public\.crm_create_client_bundle[\s\S]*public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.crm_create_client_bundle[\s\S]*to service_role/i,
  );
  assert.match(api, /action: z\.literal\("createClientBundle"\)/);
  assert.match(api, /requestKey: RequestKey/);
  assert.match(api, /service\.rpc\("crm_create_client_bundle"/);
  assert.match(api, /action: "crm\.client_bundle\.create"/);
});

test("primary contact and location switching is atomic, serialized, and service-only", () => {
  assert.match(primaryMigration, /\bbegin;/i);
  assert.match(primaryMigration, /\bcommit;\s*$/i);
  for (const resource of ["contact", "location"]) {
    const functionName = `crm_set_primary_${resource}`;
    assert.match(primaryMigration, new RegExp(`create or replace function public\\.${functionName}`));
    assert.match(
      primaryMigration,
      new RegExp(`revoke all on function public\\.${functionName}[\\s\\S]*public, anon, authenticated`, "i"),
    );
    assert.match(
      primaryMigration,
      new RegExp(`grant execute on function public\\.${functionName}[\\s\\S]*to service_role`, "i"),
    );
  }
  assert.match(primaryMigration, /photographer\.user_id = p_actor_user_id/i);
  assert.match(
    primaryMigration,
    /from public\.crm_clients as client[\s\S]*client\.archived_at is null[\s\S]*for update/i,
  );
  assert.match(
    primaryMigration,
    /contact\.client_id = p_client_id[\s\S]*contact\.photographer_id = p_photographer_id[\s\S]*contact\.archived_at is null/i,
  );
  assert.match(
    primaryMigration,
    /location\.client_id = p_client_id[\s\S]*location\.photographer_id = p_photographer_id/i,
  );
  assert.match(primaryMigration, /set is_primary = false/i);
  assert.match(primaryMigration, /set is_primary = true/i);
  assert.match(api, /action: z\.literal\("setPrimary"\)/);
  assert.match(api, /resource: z\.enum\(\["contact", "location"\]\)/);
  assert.match(api, /service\.rpc\(functionName/);
  assert.match(api, /p_photographer_id: photographer\.id/);
  assert.match(api, /p_client_id: body\.clientId/);
  assert.match(api, /p_actor_user_id: user\.id/);
  assert.match(api, /action: `crm\.\$\{body\.resource\}\.set_primary`/);
  assert.match(api, /record: crmPublicRow\(row\)/);
  assert.match(api, /data\.is_primary === true/);
  assert.match(api, /set_primary_action_required/);
});

test("CRM DTO mapping translates enum fields without rewriting user-authored text", () => {
  const location = parseCrmValues("location", {
    clientId: "11111111-1111-4111-8111-111111111111",
    label: "followUp",
  });
  assert.equal(location.ok, true);
  assert.equal(location.data.label, "followUp");
  assert.equal(crmPublicRow(location.data).label, "followUp");

  const snakeCaseLocation = parseCrmValues("location", {
    clientId: "11111111-1111-4111-8111-111111111111",
    label: "follow_up",
  });
  assert.equal(snakeCaseLocation.ok, true);
  assert.equal(snakeCaseLocation.data.label, "follow_up");
  assert.equal(crmPublicRow(snakeCaseLocation.data).label, "follow_up");

  const client = parseCrmValues("client", { displayName: "followUp" });
  assert.equal(client.ok, true);
  assert.equal(client.data.display_name, "followUp");
  assert.equal(crmPublicRow(client.data).displayName, "followUp");

  assert.deepEqual(
    crmPublicRow({
      label: "follow_up",
      display_name: "follow_up",
      notes: "pending_approval",
    }),
    {
      label: "follow_up",
      displayName: "follow_up",
      notes: "pending_approval",
    },
  );

  const cycle = parseCrmValues("bookingCycle", { status: "followUp" });
  assert.equal(cycle.ok, true);
  assert.equal(cycle.data.status, "follow_up");
  const task = parseCrmValues("task", { kind: "followUp" });
  assert.equal(task.ok, true);
  assert.equal(task.data.kind, "follow_up");
  assert.deepEqual(
    crmPublicRow({ status: "pending_approval", kind: "follow_up" }),
    { status: "pendingApproval", kind: "followUp" },
  );
});

test("task edits are owner-scoped, client-stable, and keep completion state consistent", () => {
  const editableTask = parseCrmValues("task", {
    title: "Confirm fall photography dates",
    notes: "Ask whether all campuses use the same week.",
    dueAt: "2026-09-02T14:30:00.000Z",
    remindAt: "2026-09-01T14:30:00.000Z",
    status: "snoozed",
  });
  assert.equal(editableTask.ok, true);
  assert.equal(editableTask.data.title, "Confirm fall photography dates");
  assert.equal(editableTask.data.status, "snoozed");
  assert.match(api, /from\("crm_tasks"\)[\s\S]*select\("client_id,status,completed_at"\)/);
  assert.match(api, /\.eq\("id", input\.id\)[\s\S]*\.eq\("photographer_id", input\.photographerId\)/);
  assert.match(api, /task_client_immutable/);
  assert.match(api, /data\.status === "completed"/);
  assert.match(api, /data\.completed_at = data\.completed_at \|\| existingTask\?\.completed_at \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(api, /data\.completed_at = null/);
  assert.match(api, /Object\.hasOwn\(data, "completed_at"\)/);
  assert.match(api, /task_completion_status_required/);
  assert.match(api, /task_reopen_status_required/);
});

test("email delivery uses atomic leases, deterministic dedupe, and service-only workers", () => {
  assert.match(migration, /create or replace function public\.crm_claim_email_batch/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /lease_expires_at = timezone\('utc', now\(\)\) \+ interval '10 minutes'/i);
  assert.match(migration, /create or replace function public\.crm_claim_email_by_id/i);
  assert.match(migration, /outbox\.photographer_id = p_photographer_id/i);
  assert.match(migration, /grant execute on function public\.crm_claim_email_batch[\s\S]*to service_role/i);
  assert.match(migration, /grant execute on function public\.crm_claim_email_by_id[\s\S]*to service_role/i);
  assert.match(migration, /revoke all on function public\.crm_claim_email_batch[\s\S]*authenticated/i);
  assert.match(migration, /constraint crm_email_outbox_dedupe_key unique \(photographer_id, dedupe_key\)/i);
});

test("claim-time gates catch suppressions, consent, opt-out, archived and stale recipients", () => {
  assert.match(migration, /crm_email_suppressions[\s\S]*suppression\.lifted_at is null/i);
  assert.match(migration, /contact\.do_not_contact/i);
  assert.match(migration, /contact\.marketing_consent = 'opted_in'/i);
  assert.match(migration, /requires_explicit_consent/i);
  assert.match(migration, /contact\.archived_at is null/i);
  assert.match(migration, /contact\.email_normalized = outbox\.to_email_normalized/i);
  assert.match(migration, /client\.archived_at is null/i);
  assert.match(migration, /rule\.enabled/i);
  assert.match(migration, /cycle\.status not in \('booked', 'completed', 'lost', 'skipped'\)/i);
  assert.match(migration, /unsubscribe_ready/i);
  assert.match(migration, /p_allow_non_transactional boolean default false/i);
  assert.match(
    migration,
    /p_allow_non_transactional or outbox\.message_class = 'transactional'/i,
  );
});

test("daily non-transactional queue capacity is atomic and fail closed at 500", () => {
  assert.match(migration, /create table public\.crm_email_daily_usage/i);
  assert.match(migration, /reserved_count between 0 and 500/i);
  assert.match(migration, /create or replace function public\.crm_reserve_daily_email_capacity/i);
  assert.match(migration, /before insert or update of status, message_class on public\.crm_email_outbox/i);
  assert.match(migration, /on conflict \(photographer_id, usage_date\) do update/i);
  assert.match(migration, /reserved_count < 500/i);
  assert.match(migration, /daily non-transactional email queue limit reached/i);
  assert.match(email, /daily_email_limit/);
});

test("opted-in contacts require recorded consent evidence at every write layer", () => {
  assert.match(migration, /constraint crm_contacts_optin_evidence_check/i);
  assert.match(
    migration,
    /marketing_consent <> 'opted_in'[\s\S]*consent_recorded_at is not null[\s\S]*nullif\(btrim\(consent_source\), ''\) is not null/i,
  );
  assert.match(migration, /CRM opted-in contact requires consent timestamp and source/i);
  assert.match(api, /consent_evidence_required/);
  assert.match(api, /effectiveConsent === "opted_in"/);
  assert.match(api, /parsed\.data\.marketing_consent === "opted_in"/);
});

test("normalized contact email changes cannot inherit opted-in evidence", () => {
  assert.match(api, /function normalizeContactEmailIdentity/);
  assert.match(api, /value\.trim\(\)\.toLowerCase\(\) \|\| null/);
  assert.match(api, /\.select\("email_normalized,marketing_consent,consent_recorded_at,consent_source"\)/);
  assert.match(api, /const emailIdentityChanged = existing !== null/);
  assert.match(api, /effectiveEmailIdentity !== existingEmailIdentity/);
  assert.match(api, /const freshConsentEvidenceSubmitted = "consent_recorded_at" in data/);
  assert.match(api, /submittedConsentTime !== existingConsentTime/);
  assert.match(api, /emailIdentityChanged && effectiveConsent === "opted_in" && !freshConsentEvidenceSubmitted/);
  assert.match(api, /consent_email_identity_changed/);
  assert.match(api, /data\.consent_recorded_at = null/);
  assert.match(api, /data\.consent_source = null/);
});

test("dashboard API accepts contact IDs but no arbitrary recipient address", () => {
  assert.match(api, /contactId: Uuid/);
  assert.match(api, /templateId: Uuid/);
  assert.match(api, /requestKey: RequestKey/);
  assert.doesNotMatch(api, /\bto\s*:\s*z\./);
  assert.doesNotMatch(api, /recipientEmail\s*:/);
  assert.match(api, /resolveDashboardAuth\(request\)/);
  assert.match(api, /resolveCrmPhotographer\(service, user\.id\)/);
  assert.match(api, /\.eq\("photographer_id", photographer\.id\)/);
  assert.match(email, /\.eq\("id", input\.contactId\)[\s\S]*\.eq\("photographer_id", input\.photographer\.id\)/);
});

test("bulk outreach is bounded, opt-in only, approved-template only, and queue only", () => {
  assert.match(api, /contactIds: z\.array\(Uuid\)\.min\(1\)\.max\(100\)/);
  assert.match(email, /requireTemplate\(input\.service, input\.photographer\.id, input\.templateId, true\)/);
  assert.match(email, /requireExplicitConsent: true/);
  assert.match(email, /Transactional templates cannot be used for bulk outreach/);
  assert.match(email, /if \(!crmUnsubscribeConfigured\(\)\)/);
  const bulkStart = email.indexOf("export async function bulkQueueCrmEmails");
  const bulkSection = email.slice(bulkStart);
  assert.doesNotMatch(bulkSection, /sendResendEmail\(/);
});

test("automation modes cannot silently promote reminders or drafts into sends", () => {
  assert.match(cron, /mode === "remind" \|\| actionType !== "email_client"/);
  assert.match(cron, /deliveryMode: mode === "autopilot" \? "autopilot" : "approval"/);
  assert.match(cron, /requireExplicitConsent: mode === "autopilot"/);
  assert.match(cron, /rule\.autopilot_approved_at/);
  assert.match(cron, /rule\.autopilot_approved_by/);
  assert.match(cron, /crm_claim_email_batch/);
  assert.match(cron, /timingSafeEqual/);
  assert.doesNotMatch(cron, /OPENAI|tryAiDraft/);
  assert.match(migration, /max_runs_per_cycle integer not null default 1 check \(max_runs_per_cycle = 1\)/i);
  assert.match(migration, /create table public\.crm_automation_runs/i);
  assert.match(
    migration,
    /constraint crm_automation_runs_one_per_rule_cycle[\s\S]*unique \(photographer_id, automation_rule_id, booking_cycle_id\)/i,
  );
  assert.match(cron, /from\("crm_automation_runs"\)/);
  assert.match(cron, /recordAutomationRun/);
  assert.match(cron, /return triggerValue \? `\$\{String\(rule\.id\)\}:\$\{String\(cycle\.id\)\}:\$\{triggerValue\}`/);
  assert.doesNotMatch(cron, /localDateKey/);
});

test("booking-season automation waits for the due calendar date in the rule timezone", () => {
  assert.match(cron, /function localCalendarDate\(timeZone: string, now: Date\)/);
  assert.match(cron, /function shiftedCalendarDate\(value: unknown, daysOffset: number\)/);
  assert.match(cron, /function localCalendarDateReached/);
  assert.match(
    cron,
    /trigger === "booking_season_open"[\s\S]*localCalendarDateReached\([\s\S]*cycle\.target_contact_on/,
  );
  assert.doesNotMatch(cron, /Date\.parse\(`\$\{date\}T00:00:00\.000Z`\)/);
});

test("signed unsubscribe contains no raw email and resolves suppression server-side", () => {
  const previousSecret = process.env.CRM_UNSUBSCRIBE_SECRET;
  const previousOrigin = process.env.NEXT_PUBLIC_APP_URL;
  process.env.CRM_UNSUBSCRIBE_SECRET = "test-only-secret-that-is-more-than-thirty-two-characters";
  process.env.NEXT_PUBLIC_APP_URL = "https://studio.example";
  try {
    const url = createCrmUnsubscribeUrl({
      photographerId: "11111111-1111-4111-8111-111111111111",
      contactId: "22222222-2222-4222-8222-222222222222",
      email: "principal@example.com",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    assert.ok(url);
    assert.doesNotMatch(url, /principal|example\.com/i);
    const token = new URL(url).searchParams.get("token");
    assert.ok(token);
    assert.equal(
      verifyCrmUnsubscribeToken(token, new Date("2026-01-02T00:00:00.000Z"))?.c,
      "22222222-2222-4222-8222-222222222222",
    );
    assert.equal(verifyCrmUnsubscribeToken(`${token}x`), null);
    assert.equal(
      verifyCrmUnsubscribeToken(token, new Date("2028-01-02T00:00:01.000Z")),
      null,
    );
  } finally {
    if (previousSecret == null) delete process.env.CRM_UNSUBSCRIBE_SECRET;
    else process.env.CRM_UNSUBSCRIBE_SECRET = previousSecret;
    if (previousOrigin == null) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousOrigin;
  }

  assert.match(email, /appendCrmUnsubscribe/);
  assert.match(email, /unsubscribe_not_configured/);
  assert.match(email, /p_allow_non_transactional: crmUnsubscribeConfigured\(\)/);
  assert.match(cron, /p_allow_non_transactional: crmUnsubscribeConfigured\(\)/);
  assert.match(unsubscribeRoute, /verifyCrmUnsubscribeToken/);
  assert.match(unsubscribeRoute, /\.eq\("id", payload\.c\)/);
  assert.match(unsubscribeRoute, /crm_apply_signed_unsubscribe/);
  assert.match(migration, /create or replace function public\.crm_apply_signed_unsubscribe/);
  assert.match(migration, /'non_transactional',[\s\S]*'unsubscribe'/);
  assert.match(
    migration,
    /revoke all on function public\.crm_apply_signed_unsubscribe[\s\S]*public, anon, authenticated/i,
  );
  assert.doesNotMatch(unsubscribeRoute, /body\?\.email|form\?\.get\("email"\)/);
  assert.match(
    email,
    /row\.scope === "non_transactional" && input\.messageClass !== "transactional"/,
  );
});

test("AI is draft-only and deterministic template content remains the fallback", () => {
  const aiStart = email.indexOf("async function tryAiDraft");
  const createStart = email.indexOf("export async function createCrmEmailDraft");
  const queueStart = email.indexOf("export async function queueTemplatedCrmEmail");
  assert.ok(aiStart >= 0 && createStart > aiStart && queueStart > createStart);
  const draftSection = email.slice(createStart, queueStart);
  assert.match(draftSection, /const ai = await tryAiDraft/);
  assert.match(draftSection, /aiFallback = true/);
  assert.doesNotMatch(email.slice(queueStart), /tryAiDraft\(/);
});

test("custom or rewritten drafts cannot borrow transactional classification", () => {
  assert.equal(
    classifyCrmDraftMessage({
      hasTemplate: false,
      hasManualOverride: false,
      useAi: false,
    }),
    "marketing",
  );
  assert.equal(
    classifyCrmDraftMessage({
      hasTemplate: true,
      templateStatus: "approved",
      templateMessageClass: "relationship",
      hasManualOverride: true,
      useAi: false,
    }),
    "marketing",
  );
  assert.equal(
    classifyCrmDraftMessage({
      hasTemplate: true,
      templateStatus: "approved",
      templateMessageClass: "relationship",
      hasManualOverride: false,
      useAi: false,
    }),
    "relationship",
  );
  for (const rewrite of [
    { hasManualOverride: true, useAi: false },
    { hasManualOverride: false, useAi: true },
  ]) {
    assert.throws(
      () => classifyCrmDraftMessage({
        hasTemplate: true,
        templateStatus: "approved",
        templateMessageClass: "transactional",
        ...rewrite,
      }),
      (error) => error?.code === "transactional_override_forbidden",
    );
  }
  assert.match(email, /await assertRecipientAllowed\([\s\S]*messageClass/);
  assert.match(email, /queueSafetyPatchForOutbox/);
  assert.match(email, /Transactional email requires unchanged approved template content/);
  assert.match(
    email,
    /template\.message_class !== "transactional" \|\| template\.is_system !== true/,
  );
});

test("unsubscribe footer ignores spoofed body markers and replaces only canonical blocks", () => {
  const signedUrl = "https://studio.example/api/crm/unsubscribe?token=server-signed";
  const spoofed = appendCrmUnsubscribe(
    {
      subject: "Hello",
      html: '<p data-crm-unsubscribe="true">attacker marker</p>',
      text: "Stop relationship and promotional emails: attacker marker",
    },
    signedUrl,
  );
  assert.match(spoofed.html, /attacker marker/);
  assert.match(spoofed.html, /server-signed/);
  assert.match(spoofed.text, /server-signed/);
  assert.equal((spoofed.html.match(/<!--crm-unsubscribe-start-->/g) ?? []).length, 1);
  assert.equal((spoofed.text.match(/\[CRM-UNSUBSCRIBE-START\]/g) ?? []).length, 1);

  const replaced = appendCrmUnsubscribe(
    {
      subject: "Hello",
      html: "<p>Body</p><!--crm-unsubscribe-start--><a href=\"https://evil.example\">unsubscribe</a><!--crm-unsubscribe-end-->",
      text: "Body\n[CRM-UNSUBSCRIBE-START]\nhttps://evil.example\n[CRM-UNSUBSCRIBE-END]",
    },
    signedUrl,
  );
  assert.doesNotMatch(replaced.html, /evil\.example/);
  assert.doesNotMatch(replaced.text, /evil\.example/);
  assert.match(replaced.html, /server-signed/);
  assert.doesNotMatch(email, /\.includes\(["']data-crm-unsubscribe/);
  assert.doesNotMatch(email, /\.includes\(["']Stop relationship and promotional emails/);
});

test("custom templates cannot hide the canonical unsubscribe link with HTML or CSS", () => {
  const custom = renderCrmEmailTemplate({
    template: {
      is_system: false,
      subject_template: "Hello",
      html_template:
        '<style>hr,p{display:none!important}</style><div style="display:none"><p>Hidden body',
      text_template: null,
      allowed_variables: [],
    },
    variables: {},
  });
  assert.doesNotMatch(custom.html, /<(?:style|div)\b/i);
  assert.match(custom.html, /<p>/i);

  const delivered = appendCrmUnsubscribe(
    custom,
    "https://studio.example/api/crm/unsubscribe?token=server-signed",
  );
  assert.match(delivered.html, /server-signed/);
  assert.match(api, /custom_template_plain_text_only/);
  assert.match(api, /Custom templates accept plain-text content only/);
  assert.match(email, /Only immutable server-provisioned presets may render trusted HTML/);
});

test("new owners receive approved, versioned one-click presets without overwrites", () => {
  for (const key of [
    "annual_booking_invitation",
    "booking_follow_up",
    "proposal_agreement",
    "shoot_confirmation",
    "client_thank_you",
    "annual_renewal",
  ]) {
    assert.match(email, new RegExp(`template_key: "${key}"`));
  }
  assert.match(email, /status: "approved"/);
  assert.match(email, /is_system: true/);
  assert.match(email, /onConflict: "photographer_id,template_key,version"/);
  assert.match(email, /ignoreDuplicates: true/);
  assert.match(api, /await ensureCrmDefaultTemplates/);
});

test("transactional templates are server-only and built-in presets are immutable", () => {
  assert.match(migration, /is_system boolean not null default false/i);
  assert.match(
    migration,
    /crm_email_templates_transactional_system_check[\s\S]*message_class <> 'transactional' or is_system/i,
  );
  assert.match(migration, /crm_email_templates_reserved_key_check/i);
  assert.match(migration, /if old\.is_system[\s\S]*Built-in CRM templates are immutable/i);
  assert.match(migration, /if old\.approved_at is not null/i);
  assert.match(api, /data\.message_class === "transactional"/);
  assert.match(api, /transactional_template_reserved/);
  assert.match(api, /isCrmSystemTemplateKey\(data\.template_key\)/);
  assert.match(api, /existingTemplate\.is_system/);
  assert.match(api, /Built-in email templates cannot be deleted/);
  assert.match(email, /template\.message_class === "transactional" && template\.is_system !== true/);
});

test("template rendering escapes variables and dedupe keys are stable", () => {
  const template = {
    subject_template: "Hello {{contact_first_name}}",
    text_template: "Welcome to {{client_name}}",
    html_template: "<p>Welcome to {{client_name}}</p>",
    allowed_variables: ["contact_first_name", "client_name"],
  };
  const rendered = renderCrmEmailTemplate({
    template,
    variables: { contact_first_name: "Sam", client_name: "<Example & Co>" },
  });
  assert.equal(rendered.subject, "Hello Sam");
  assert.match(rendered.html, /&lt;Example &amp; Co&gt;/);
  assert.equal(
    crmEmailDedupeKey(["tenant", "request", "contact"]),
    crmEmailDedupeKey(["tenant", "request", "contact"]),
  );
  assert.notEqual(
    crmEmailDedupeKey(["tenant", "request", "contact"]),
    crmEmailDedupeKey(["tenant", "request-2", "contact"]),
  );
});
