import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  buildBookingEventSummary,
  cleanBookingValue,
  type BookingDataRow,
} from "@/lib/studio-bookings-server";
import { crmLocationPhotoPublicRow } from "@/lib/crm-location-photos";

export const CRM_RESOURCES = [
  "client",
  "location",
  "contact",
  "agreement",
  "bookingCycle",
  "task",
  "emailTemplate",
  "automationRule",
  "activity",
] as const;

export type CrmResource = (typeof CRM_RESOURCES)[number];

export const CRM_CLIENT_KINDS = [
  "school",
  "college",
  "university",
  "daycare",
  "montessori",
  "corporate",
  "wedding",
  "event",
  "sports",
  "family",
  "person",
  "nonprofit",
  "other",
] as const;

export type CrmClientKind = (typeof CRM_CLIENT_KINDS)[number];

export const CRM_RESOURCE_TABLE: Record<CrmResource, string> = {
  client: "crm_clients",
  location: "crm_locations",
  contact: "crm_contacts",
  agreement: "crm_agreements",
  bookingCycle: "crm_booking_cycles",
  task: "crm_tasks",
  emailTemplate: "crm_email_templates",
  automationRule: "crm_automation_rules",
  activity: "crm_activities",
};

const NullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional();
const NullableUuid = z.string().uuid().nullable().optional();
const NullableIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();
const NullableIsoTime = z.string().datetime({ offset: true }).nullable().optional();
const NullableNonnegativeInt = z.number().int().min(0).nullable().optional();

export const CrmValueSchemas: Record<CrmResource, z.ZodType<Record<string, unknown>>> = {
  client: z
    .object({
      kind: z.enum(CRM_CLIENT_KINDS).optional(),
      displayName: z.string().trim().min(1).max(300).optional(),
      legalName: NullableText(300),
      website: NullableText(500),
      currentStudentCount: NullableNonnegativeInt,
      defaultBookingMonth: z.number().int().min(1).max(12).nullable().optional(),
      defaultTimezone: z.string().trim().min(1).max(100).optional(),
      notes: NullableText(20_000),
      tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    })
    .strict(),
  location: z
    .object({
      clientId: z.string().uuid().optional(),
      label: z.string().trim().min(1).max(200).optional(),
      addressLine1: NullableText(500),
      addressLine2: NullableText(500),
      city: NullableText(200),
      region: NullableText(200),
      postalCode: NullableText(40),
      countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
      timezone: NullableText(100),
      phone: NullableText(80),
      isPrimary: z.boolean().optional(),
      arrivalInstructions: NullableText(10_000),
      parkingInstructions: NullableText(10_000),
      setupInstructions: NullableText(20_000),
      internalNotes: NullableText(20_000),
      latitude: z.number().finite().min(-90).max(90).nullable().optional(),
      longitude: z.number().finite().min(-180).max(180).nullable().optional(),
      placeId: NullableText(500),
      archivedAt: NullableIsoTime,
    })
    .strict(),
  contact: z
    .object({
      clientId: z.string().uuid().optional(),
      locationId: NullableUuid,
      fullName: z.string().trim().min(1).max(300).optional(),
      jobTitle: NullableText(300),
      role: NullableText(200),
      email: NullableText(320),
      phone: NullableText(80),
      preferredChannel: z.enum(["email", "phone", "none"]).optional(),
      isPrimary: z.boolean().optional(),
      marketingConsent: z.enum(["unknown", "optedIn", "optedOut"]).optional(),
      consentRecordedAt: NullableIsoTime,
      consentSource: NullableText(300),
      doNotContact: z.boolean().optional(),
      notes: NullableText(20_000),
      archivedAt: NullableIsoTime,
    })
    .strict(),
  agreement: z
    .object({
      clientId: z.string().uuid().optional(),
      title: z.string().trim().min(1).max(300).optional(),
      status: z.enum(["draft", "sent", "signed", "active", "expired", "terminated"]).optional(),
      startsOn: NullableIsoDate,
      endsOn: NullableIsoDate,
      signedAt: NullableIsoTime,
      amountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
      currency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional(),
      studentCommitment: NullableNonnegativeInt,
      renewalNoticeDays: z.number().int().min(0).max(730).optional(),
      documentKey: NullableText(1000),
      termsSummary: NullableText(20_000),
      notes: NullableText(20_000),
    })
    .strict(),
  bookingCycle: z
    .object({
      clientId: z.string().uuid().optional(),
      agreementId: NullableUuid,
      gallerySchoolId: NullableUuid,
      projectId: NullableUuid,
      seasonYear: z.number().int().min(2000).max(2200).optional(),
      cycleKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/).optional(),
      label: NullableText(300),
      status: z
        .enum([
          "notContacted",
          "contactDue",
          "contacted",
          "followUp",
          "proposalSent",
          "negotiating",
          "booked",
          "completed",
          "lost",
          "skipped",
        ])
        .optional(),
      targetContactOn: NullableIsoDate,
      lastContactedAt: NullableIsoTime,
      nextFollowUpAt: NullableIsoTime,
      bookedAt: NullableIsoTime,
      shootStartAt: NullableIsoTime,
      shootEndAt: NullableIsoTime,
      studentCountEstimate: NullableNonnegativeInt,
      studentCountActual: NullableNonnegativeInt,
      quotedAmountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
      bookedAmountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
      currency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional(),
      lostReason: NullableText(2000),
      notes: NullableText(20_000),
    })
    .strict(),
  task: z
    .object({
      clientId: z.string().uuid().optional(),
      contactId: NullableUuid,
      bookingCycleId: NullableUuid,
      automationRuleId: NullableUuid,
      kind: z.enum(["followUp", "call", "email", "agreement", "booking", "custom"]).optional(),
      title: z.string().trim().min(1).max(300).optional(),
      notes: NullableText(20_000),
      dueAt: NullableIsoTime,
      remindAt: NullableIsoTime,
      status: z.enum(["open", "snoozed", "completed", "cancelled"]).optional(),
      priority: z.number().int().min(0).max(3).optional(),
      assignedUserId: NullableUuid,
      dedupeKey: NullableText(500),
      completedAt: NullableIsoTime,
    })
    .strict(),
  emailTemplate: z
    .object({
      templateKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/).optional(),
      version: z.number().int().min(1).max(10_000).optional(),
      name: z.string().trim().min(1).max(200).optional(),
      purpose: z
        .enum([
          "bookingInvitation",
          "followUp",
          "proposal",
          "confirmation",
          "renewal",
          "thankYou",
          "photographerReminder",
          "custom",
        ])
        .optional(),
      messageClass: z.enum(["transactional", "relationship", "marketing"]).optional(),
      subjectTemplate: z.string().trim().min(1).max(300).optional(),
      htmlTemplate: NullableText(100_000),
      textTemplate: NullableText(100_000),
      allowedVariables: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(50).optional(),
      status: z.enum(["draft", "approved", "archived"]).optional(),
      aiInstruction: NullableText(4000),
    })
    .strict(),
  automationRule: z
    .object({
      clientId: NullableUuid,
      templateId: NullableUuid,
      name: z.string().trim().min(1).max(200).optional(),
      triggerType: z
        .enum(["bookingSeasonOpen", "followUpDue", "agreementExpiring", "shootAnniversary", "manual"])
        .optional(),
      actionType: z.enum(["createTask", "emailPhotographer", "emailClient"]).optional(),
      mode: z.enum(["off", "remind", "approve", "autopilot"]).optional(),
      daysOffset: z.number().int().min(-730).max(730).optional(),
      maxRunsPerCycle: z.literal(1).optional(),
      sendLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).optional(),
      timezone: z.string().trim().min(1).max(100).optional(),
      conditions: z.record(z.string(), z.unknown()).optional(),
      enabled: z.boolean().optional(),
      confirmAutopilot: z.boolean().optional(),
    })
    .strict(),
  activity: z
    .object({
      clientId: z.string().uuid().optional(),
      contactId: NullableUuid,
      bookingCycleId: NullableUuid,
      activityType: z.enum(["note", "call", "email", "task", "agreement"]).optional(),
      summary: z.string().trim().min(1).max(500).optional(),
      details: z.record(z.string(), z.unknown()).optional(),
      occurredAt: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
};

const FIELD_MAP: Record<CrmResource, Record<string, string>> = {
  client: {
    kind: "kind",
    displayName: "display_name",
    legalName: "legal_name",
    website: "website",
    currentStudentCount: "current_student_count",
    defaultBookingMonth: "default_booking_month",
    defaultTimezone: "default_timezone",
    notes: "notes",
    tags: "tags",
  },
  location: {
    clientId: "client_id",
    label: "label",
    addressLine1: "address_line1",
    addressLine2: "address_line2",
    city: "city",
    region: "region",
    postalCode: "postal_code",
    countryCode: "country_code",
    timezone: "timezone",
    phone: "phone",
    isPrimary: "is_primary",
    arrivalInstructions: "arrival_instructions",
    parkingInstructions: "parking_instructions",
    setupInstructions: "setup_instructions",
    internalNotes: "internal_notes",
    latitude: "latitude",
    longitude: "longitude",
    placeId: "place_id",
    archivedAt: "archived_at",
  },
  contact: {
    clientId: "client_id",
    locationId: "location_id",
    fullName: "full_name",
    jobTitle: "job_title",
    role: "role",
    email: "email",
    phone: "phone",
    preferredChannel: "preferred_channel",
    isPrimary: "is_primary",
    marketingConsent: "marketing_consent",
    consentRecordedAt: "consent_recorded_at",
    consentSource: "consent_source",
    doNotContact: "do_not_contact",
    notes: "notes",
    archivedAt: "archived_at",
  },
  agreement: {
    clientId: "client_id",
    title: "title",
    status: "status",
    startsOn: "starts_on",
    endsOn: "ends_on",
    signedAt: "signed_at",
    amountCents: "amount_cents",
    currency: "currency",
    studentCommitment: "student_commitment",
    renewalNoticeDays: "renewal_notice_days",
    documentKey: "document_key",
    termsSummary: "terms_summary",
    notes: "notes",
  },
  bookingCycle: {
    clientId: "client_id",
    agreementId: "agreement_id",
    gallerySchoolId: "gallery_school_id",
    projectId: "project_id",
    seasonYear: "season_year",
    cycleKey: "cycle_key",
    label: "label",
    status: "status",
    targetContactOn: "target_contact_on",
    lastContactedAt: "last_contacted_at",
    nextFollowUpAt: "next_follow_up_at",
    bookedAt: "booked_at",
    shootStartAt: "shoot_start_at",
    shootEndAt: "shoot_end_at",
    studentCountEstimate: "student_count_estimate",
    studentCountActual: "student_count_actual",
    quotedAmountCents: "quoted_amount_cents",
    bookedAmountCents: "booked_amount_cents",
    currency: "currency",
    lostReason: "lost_reason",
    notes: "notes",
  },
  task: {
    clientId: "client_id",
    contactId: "contact_id",
    bookingCycleId: "booking_cycle_id",
    automationRuleId: "automation_rule_id",
    kind: "kind",
    title: "title",
    notes: "notes",
    dueAt: "due_at",
    remindAt: "remind_at",
    status: "status",
    priority: "priority",
    assignedUserId: "assigned_user_id",
    dedupeKey: "dedupe_key",
    completedAt: "completed_at",
  },
  emailTemplate: {
    templateKey: "template_key",
    version: "version",
    name: "name",
    purpose: "purpose",
    messageClass: "message_class",
    subjectTemplate: "subject_template",
    htmlTemplate: "html_template",
    textTemplate: "text_template",
    allowedVariables: "allowed_variables",
    status: "status",
    aiInstruction: "ai_instruction",
  },
  automationRule: {
    clientId: "client_id",
    templateId: "template_id",
    name: "name",
    triggerType: "trigger_type",
    actionType: "action_type",
    mode: "mode",
    daysOffset: "days_offset",
    maxRunsPerCycle: "max_runs_per_cycle",
    sendLocalTime: "send_local_time",
    timezone: "timezone",
    conditions: "conditions",
    enabled: "enabled",
  },
  activity: {
    clientId: "client_id",
    contactId: "contact_id",
    bookingCycleId: "booking_cycle_id",
    activityType: "activity_type",
    summary: "summary",
    details: "details",
    occurredAt: "occurred_at",
  },
};

const CAMEL_TO_DB_VALUE: Record<string, string> = {
  optedIn: "opted_in",
  optedOut: "opted_out",
  notContacted: "not_contacted",
  contactDue: "contact_due",
  followUp: "follow_up",
  proposalSent: "proposal_sent",
  pendingApproval: "pending_approval",
  statusChange: "status_change",
  bookingInvitation: "booking_invitation",
  thankYou: "thank_you",
  photographerReminder: "photographer_reminder",
  bookingSeasonOpen: "booking_season_open",
  followUpDue: "follow_up_due",
  agreementExpiring: "agreement_expiring",
  shootAnniversary: "shoot_anniversary",
  createTask: "create_task",
  emailPhotographer: "email_photographer",
  emailClient: "email_client",
  providerAccepted: "provider_accepted",
  retryScheduled: "retry_scheduled",
};

const DB_TO_CAMEL_VALUE = Object.fromEntries(
  Object.entries(CAMEL_TO_DB_VALUE).map(([camel, database]) => [database, camel]),
);

// Enum values use snake_case in Postgres and camelCase in the dashboard API.
// Keep this field-aware: labels, names, notes, and other user-authored text may
// legitimately equal an enum token and must never be rewritten as a side effect.
const CAMEL_CASED_ENUM_DATABASE_FIELDS = new Set([
  "marketing_consent",
  "status",
  "kind",
  "purpose",
  "trigger_type",
  "action_type",
  "event_type",
  "activity_type",
  "outcome",
]);

export function cleanCrmText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function looksLikeCrmEmail(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanCrmText(value));
}

export function parseCrmValues(
  resource: CrmResource,
  raw: unknown,
): { ok: true; data: Record<string, unknown>; confirmAutopilot: boolean } | { ok: false; issues: unknown } {
  const parsed = CrmValueSchemas[resource].safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  const source = parsed.data;
  const mapped: Record<string, unknown> = {};
  for (const [camelKey, databaseKey] of Object.entries(FIELD_MAP[resource])) {
    if (!(camelKey in source)) continue;
    let value = source[camelKey];
    if (
      CAMEL_CASED_ENUM_DATABASE_FIELDS.has(databaseKey) &&
      typeof value === "string" &&
      CAMEL_TO_DB_VALUE[value]
    ) {
      value = CAMEL_TO_DB_VALUE[value];
    }
    if (databaseKey === "country_code" || databaseKey === "currency") {
      value = typeof value === "string" ? value.toUpperCase() : value;
    }
    mapped[databaseKey] = value;
  }
  return {
    ok: true,
    data: mapped,
    confirmAutopilot: source.confirmAutopilot === true,
  };
}

function camelKey(value: string) {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function crmPublicRow(row: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [databaseKey, originalValue] of Object.entries(row)) {
    if (databaseKey === "photographer_id" || databaseKey === "created_by") continue;
    let value = originalValue;
    if (
      CAMEL_CASED_ENUM_DATABASE_FIELDS.has(databaseKey) &&
      typeof value === "string" &&
      DB_TO_CAMEL_VALUE[value]
    ) {
      value = DB_TO_CAMEL_VALUE[value];
    }
    output[camelKey(databaseKey)] = value;
  }
  return output;
}

function crmOutboxPublicRow(row: Record<string, unknown>) {
  const output = crmPublicRow(row);
  output.html = output.htmlBody ?? "";
  output.text = output.textBody ?? "";
  delete output.htmlBody;
  delete output.textBody;
  delete output.toEmailNormalized;
  delete output.dedupeKey;
  delete output.lockedAt;
  delete output.leaseExpiresAt;
  delete output.lockedBy;
  delete output.lastError;
  return output;
}

export type CrmPhotographer = {
  id: string;
  user_id: string;
  business_name: string | null;
  studio_email: string | null;
  studio_phone: string | null;
};

export async function resolveCrmPhotographer(
  service: SupabaseClient,
  userId: string,
) {
  const { data, error } = await service
    .from("photographers")
    .select("id,user_id,business_name,studio_email,studio_phone")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as CrmPhotographer | null) ?? null;
}

function currentCycleForClient(rows: Record<string, unknown>[], year: number) {
  return rows.find((row) => Number(row.season_year) === year) ?? null;
}

async function loadOwnedRowsIn(input: {
  service: SupabaseClient;
  photographerId: string;
  table: string;
  select: string;
  column: string;
  ids: string[];
}) {
  const ids = Array.from(new Set(input.ids.filter(Boolean)));
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    let rowOffset = 0;
    const pageSize = 500;
    for (;;) {
      const { data, error, count } = await input.service
        .from(input.table)
        .select(input.select, { count: "exact" })
        .eq("photographer_id", input.photographerId)
        .in(input.column, batch)
        .order("id", { ascending: true })
        .range(rowOffset, rowOffset + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as unknown as Record<string, unknown>[];
      rows.push(...page);
      rowOffset += page.length;
      if (!page.length || (typeof count === "number" && rowOffset >= count)) break;
      if (count == null && page.length < pageSize) break;
    }
  }
  return rows;
}

function bookingStatusForSummary(row: Record<string, unknown>) {
  const status = cleanBookingValue(row.status).toLowerCase();
  return status === "canceled" ? { ...row, status: "cancelled" } : row;
}

function succeededBookingPayment(row: Record<string, unknown>) {
  return cleanBookingValue(row.status).toLowerCase() === "succeeded";
}

function cents(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

export function summarizeCrmBookingPayments(
  bookings: Record<string, unknown>[],
  payments: Record<string, unknown>[],
) {
  const statusByBookingId = new Map(
    bookings.map((row) => {
      const normalized = bookingStatusForSummary(row);
      return [
        cleanBookingValue(normalized.id),
        cleanBookingValue(normalized.status).toLowerCase(),
      ] as const;
    }),
  );
  const successfulPayments = payments.filter((row) =>
    statusByBookingId.has(cleanBookingValue(row.booking_id)) && succeededBookingPayment(row),
  );
  const totalsByCurrency = new Map<string, {
    activeCashCents: number;
    retainedCancellationCashCents: number;
    creditRedeemedCents: number;
  }>();
  for (const payment of successfulPayments) {
    const currency = cleanBookingValue(payment.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    const total = totalsByCurrency.get(currency) || {
      activeCashCents: 0,
      retainedCancellationCashCents: 0,
      creditRedeemedCents: 0,
    };
    const amountCents = cents(payment.amount_cents);
    if (cleanBookingValue(payment.type).toLowerCase() === "credit") {
      total.creditRedeemedCents += amountCents;
    } else if (statusByBookingId.get(cleanBookingValue(payment.booking_id)) === "cancelled") {
      total.retainedCancellationCashCents += amountCents;
    } else {
      total.activeCashCents += amountCents;
    }
    totalsByCurrency.set(currency, total);
  }
  return Array.from(totalsByCurrency.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({
      currency,
      activeCashCents: total.activeCashCents,
      retainedCancellationCashCents: total.retainedCancellationCashCents,
      grossCollectedCents:
        total.activeCashCents + total.retainedCancellationCashCents,
      creditRedeemedCents: total.creditRedeemedCents,
    }));
}

export function countCrmActiveCashPaidBookings(
  bookings: Record<string, unknown>[],
  payments: Record<string, unknown>[],
) {
  const activeBookingIds = new Set(
    bookings
      .map(bookingStatusForSummary)
      .filter((row) => cleanBookingValue(row.status).toLowerCase() !== "cancelled")
      .map((row) => cleanBookingValue(row.id))
      .filter(Boolean),
  );
  const paidBookingIds = new Set<string>();
  for (const payment of payments) {
    const bookingId = cleanBookingValue(payment.booking_id);
    if (!activeBookingIds.has(bookingId) || !succeededBookingPayment(payment)) continue;
    if (cleanBookingValue(payment.type).toLowerCase() === "credit") continue;
    paidBookingIds.add(bookingId);
  }
  return paidBookingIds.size;
}

export async function loadCrmDashboard(input: {
  service: SupabaseClient;
  photographerId: string;
  clientId?: string | null;
  search?: string | null;
  kind?: string | null;
  seasonYear?: number | null;
  status?: string | null;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
  let clientsQuery = input.service
    .from("crm_clients")
    .select("*")
    .eq("photographer_id", input.photographerId)
    .is("archived_at", null)
    .order("display_name", { ascending: true })
    .limit(limit);
  if (input.clientId) clientsQuery = clientsQuery.eq("id", input.clientId);
  if (input.search) clientsQuery = clientsQuery.ilike("display_name", `%${input.search}%`);
  if (input.kind) clientsQuery = clientsQuery.eq("kind", input.kind);

  const [clientsResult, templatesResult, rulesResult] = await Promise.all([
    clientsQuery,
    input.service
      .from("crm_email_templates")
      .select("*")
      .eq("photographer_id", input.photographerId)
      .is("archived_at", null)
      .order("name", { ascending: true }),
    input.service
      .from("crm_automation_rules")
      .select("*")
      .eq("photographer_id", input.photographerId)
      .order("name", { ascending: true }),
  ]);
  if (clientsResult.error) throw clientsResult.error;
  if (templatesResult.error) throw templatesResult.error;
  if (rulesResult.error) throw rulesResult.error;

  const clientRows = (clientsResult.data ?? []) as Record<string, unknown>[];
  const clientIds = clientRows.map((row) => String(row.id));
  if (!clientIds.length) {
    return {
      clients: [],
      locations: [],
      locationPhotos: [],
      contacts: [],
      agreements: [],
      bookingCycles: [],
      bookingJobs: [],
      bookingHistory: [],
      tasks: [],
      emails: [],
      activities: [],
      templates: (templatesResult.data ?? []).map((row) => crmPublicRow(row)),
      automationRules: (rulesResult.data ?? []).map((row) => crmPublicRow(row)),
      summary: {
        totalClients: 0,
        bookedThisYear: 0,
        notBookedThisYear: 0,
        followUpsDue: 0,
        openTasks: 0,
        pendingApprovals: 0,
      },
    };
  }

  const [
    loadedLocationRows,
    contactsResult,
    agreementsResult,
    loadedCycleRows,
    tasksResult,
    emailsResult,
    activitiesResult,
    rollupResult,
  ] =
    await Promise.all([
      loadOwnedRowsIn({
        service: input.service,
        photographerId: input.photographerId,
        table: "crm_locations",
        select: "*",
        column: "client_id",
        ids: clientIds,
      }),
      input.service.from("crm_contacts").select("*").eq("photographer_id", input.photographerId).in("client_id", clientIds).is("archived_at", null),
      input.service.from("crm_agreements").select("*").eq("photographer_id", input.photographerId).in("client_id", clientIds),
      loadOwnedRowsIn({
        service: input.service,
        photographerId: input.photographerId,
        table: "crm_booking_cycles",
        select: "*",
        column: "client_id",
        ids: clientIds,
      }),
      input.service.from("crm_tasks").select("*").eq("photographer_id", input.photographerId).in("client_id", clientIds).order("due_at", { ascending: true, nullsFirst: false }),
      input.service.from("crm_email_outbox").select("*").eq("photographer_id", input.photographerId).in("client_id", clientIds).order("created_at", { ascending: false }).limit(1000),
      input.service.from("crm_activities").select("*").eq("photographer_id", input.photographerId).in("client_id", clientIds).order("occurred_at", { ascending: false }).limit(2000),
      input.service.from("crm_client_rollup").select("*").eq("photographer_id", input.photographerId).in("id", clientIds),
    ]);
  for (const result of [
    contactsResult,
    agreementsResult,
    tasksResult,
    emailsResult,
    activitiesResult,
    rollupResult,
  ]) {
    if (result.error) throw result.error;
  }

  const bookingJobRows = await loadOwnedRowsIn({
    service: input.service,
    photographerId: input.photographerId,
    table: "crm_booking_jobs",
    select: "id,client_id,location_id,booking_cycle_id,gallery_school_id,booking_event_id,role,created_at,updated_at",
    column: "client_id",
    ids: clientIds,
  });
  const gallerySchoolIds = bookingJobRows
    .map((row) => cleanBookingValue(row.gallery_school_id))
    .filter(Boolean);
  const [bookingSchoolRows, bookingEventRows] = await Promise.all([
    loadOwnedRowsIn({
      service: input.service,
      photographerId: input.photographerId,
      table: "schools",
      select: "id,school_name,status,shoot_date",
      column: "id",
      ids: gallerySchoolIds,
    }),
    loadOwnedRowsIn({
      service: input.service,
      photographerId: input.photographerId,
      table: "booking_events",
      select: "id,school_id,enabled,timezone,slot_duration_minutes,require_payment,sitting_fee_cents,currency,includes_digital_images,created_at,updated_at",
      column: "school_id",
      ids: gallerySchoolIds,
    }),
  ]);
  const bookingEventIds = bookingEventRows
    .map((row) => cleanBookingValue(row.id))
    .filter(Boolean);
  const [bookingSlotRows, bookingRows] = await Promise.all([
    loadOwnedRowsIn({
      service: input.service,
      photographerId: input.photographerId,
      table: "booking_slots",
      select: "id,event_id,start_at,end_at,status,capacity,booked_count",
      column: "event_id",
      ids: bookingEventIds,
    }),
    loadOwnedRowsIn({
      service: input.service,
      photographerId: input.photographerId,
      table: "bookings",
      select: "id,event_id,slot_id,status,created_at,updated_at",
      column: "event_id",
      ids: bookingEventIds,
    }),
  ]);
  const bookingIds = bookingRows.map((row) => cleanBookingValue(row.id)).filter(Boolean);
  const bookingPaymentRows = await loadOwnedRowsIn({
    service: input.service,
    photographerId: input.photographerId,
    table: "booking_payments",
    select: "id,booking_id,status,amount_cents,currency,type,created_at",
    column: "booking_id",
    ids: bookingIds,
  });

  const allCycleRows = loadedCycleRows.sort((a, b) =>
    Number(b.season_year ?? 0) - Number(a.season_year ?? 0)
    || cleanBookingValue(a.id).localeCompare(cleanBookingValue(b.id)),
  );
  let cycleRows = allCycleRows;
  if (input.seasonYear) {
    cycleRows = cycleRows.filter((row) => Number(row.season_year) === input.seasonYear);
  }
  if (input.status) {
    const databaseStatus = CAMEL_TO_DB_VALUE[input.status] ?? input.status;
    cycleRows = cycleRows.filter((row) => row.status === databaseStatus);
  }

  const contactRows = (contactsResult.data ?? []) as Record<string, unknown>[];
  const locationRows = loadedLocationRows.filter((row) => row.archived_at == null);
  const locationPhotoRows = await loadOwnedRowsIn({
    service: input.service,
    photographerId: input.photographerId,
    table: "crm_location_photos",
    select: "id,photographer_id,client_id,location_id,object_key,filename,content_type,byte_size,width,height,audience,category,caption,alt_text,sort_order,created_at,updated_at",
    column: "location_id",
    ids: locationRows.map((row) => cleanBookingValue(row.id)).filter(Boolean),
  });
  const rollupByClient = new Map(
    ((rollupResult.data ?? []) as Record<string, unknown>[]).map((row) => [String(row.id), row]),
  );
  const currentYear = input.seasonYear ?? new Date().getUTCFullYear();
  const clients = clientRows.map((row) => {
    const id = String(row.id);
    const currentCycle = currentCycleForClient(
      allCycleRows.filter((cycle) => cycle.client_id === id),
      currentYear,
    );
    const primaryContact = contactRows.find(
      (contact) => contact.client_id === id && contact.is_primary === true,
    );
    const rollup = rollupByClient.get(id);
    return {
      ...crmPublicRow(row),
      yearsBooked: Number(rollup?.years_booked ?? 0),
      lastBookedYear: rollup?.last_booked_year ?? null,
      currentCycleStatus:
        typeof currentCycle?.status === "string"
          ? DB_TO_CAMEL_VALUE[currentCycle.status] ?? currentCycle.status
          : null,
      primaryContactId: primaryContact?.id ?? null,
    };
  });

  const now = Date.now();
  const bookedClientIds = new Set(
    allCycleRows
      .filter(
        (row) =>
          Number(row.season_year) === currentYear &&
          (row.status === "booked" || row.status === "completed"),
      )
      .map((row) => String(row.client_id)),
  );
  const followUpsDue = allCycleRows.filter((row) => {
    const value = typeof row.next_follow_up_at === "string" ? Date.parse(row.next_follow_up_at) : Number.NaN;
    return Number.isFinite(value) && value <= now && !["booked", "completed", "lost", "skipped"].includes(String(row.status));
  }).length;
  const taskRows = (tasksResult.data ?? []) as Record<string, unknown>[];
  const emailRows = (emailsResult.data ?? []) as Record<string, unknown>[];

  const schoolsById = new Map(
    bookingSchoolRows.map((row) => [cleanBookingValue(row.id), row]),
  );
  const eventsById = new Map(
    bookingEventRows.map((row) => [cleanBookingValue(row.id), row]),
  );
  const eventBySchoolId = new Map(
    bookingEventRows.map((row) => [cleanBookingValue(row.school_id), row]),
  );
  const locationsById = new Map(
    loadedLocationRows.map((row) => [cleanBookingValue(row.id), row]),
  );
  const cyclesById = new Map(
    allCycleRows.map((row) => [cleanBookingValue(row.id), row]),
  );
  const bookingIdsByEvent = new Map<string, Set<string>>();
  for (const booking of bookingRows) {
    const eventId = cleanBookingValue(booking.event_id);
    const rows = bookingIdsByEvent.get(eventId) ?? new Set<string>();
    rows.add(cleanBookingValue(booking.id));
    bookingIdsByEvent.set(eventId, rows);
  }

  const bookingHistory = bookingJobRows.map((job) => {
    const gallerySchoolId = cleanBookingValue(job.gallery_school_id);
    const school = schoolsById.get(gallerySchoolId) ?? null;
    const storedEventId = cleanBookingValue(job.booking_event_id);
    const event = (storedEventId ? eventsById.get(storedEventId) : null)
      ?? eventBySchoolId.get(gallerySchoolId)
      ?? null;
    const eventId = cleanBookingValue(event?.id);
    const eventBookingIds = bookingIdsByEvent.get(eventId) ?? new Set<string>();
    const eventBookings = bookingRows
      .filter((row) => cleanBookingValue(row.event_id) === eventId)
      .map(bookingStatusForSummary);
    const eventPayments = bookingPaymentRows.filter((row) =>
      eventBookingIds.has(cleanBookingValue(row.booking_id)),
    );
    const paymentTotalsByCurrency = summarizeCrmBookingPayments(eventBookings, eventPayments);
    const summary = event
      ? buildBookingEventSummary({
          event: event as BookingDataRow,
          slots: bookingSlotRows.filter((row) => cleanBookingValue(row.event_id) === eventId),
          bookings: eventBookings,
          payments: eventPayments,
          source: school,
          kind: "school",
        })
      : null;
    const location = locationsById.get(cleanBookingValue(job.location_id)) ?? null;
    const cycle = cyclesById.get(cleanBookingValue(job.booking_cycle_id)) ?? null;
    const eventCurrency = summary?.currency ?? null;
    const primaryPaymentTotals = paymentTotalsByCurrency.find(
      (total) => total.currency === eventCurrency,
    );
    return {
      jobId: cleanBookingValue(job.id),
      clientId: cleanBookingValue(job.client_id),
      locationId: cleanBookingValue(job.location_id) || null,
      locationLabel: cleanBookingValue(location?.label) || null,
      bookingCycleId: cleanBookingValue(job.booking_cycle_id),
      seasonYear: Number(cycle?.season_year) || null,
      gallerySchoolId,
      schoolName: cleanBookingValue(school?.school_name) || "Untitled school",
      schoolStatus: cleanBookingValue(school?.status) || null,
      shootDate: cleanBookingValue(school?.shoot_date) || null,
      role: cleanBookingValue(job.role) || "primary",
      bookingEventId: eventId || null,
      bookingEnabled: summary?.enabled ?? false,
      publicUrl: summary?.publicUrl ?? null,
      currency: eventCurrency,
      capacity: summary?.capacity ?? 0,
      booked: summary?.booked ?? 0,
      cancelled: summary?.cancelled ?? 0,
      paidBookings: countCrmActiveCashPaidBookings(eventBookings, eventPayments),
      activeCashCents: primaryPaymentTotals?.activeCashCents ?? 0,
      retainedCancellationCashCents:
        primaryPaymentTotals?.retainedCancellationCashCents ?? 0,
      grossCollectedCents: primaryPaymentTotals?.grossCollectedCents ?? 0,
      creditRedeemedCents: primaryPaymentTotals?.creditRedeemedCents ?? 0,
      paymentTotalsByCurrency,
      firstSlotAt: summary?.firstSlotAt ?? null,
      lastSlotAt: summary?.lastSlotAt ?? null,
      lastBookingAt: summary?.lastBookingAt ?? null,
    };
  }).sort((a, b) => {
    const aDate = a.shootDate ? Date.parse(a.shootDate) : 0;
    const bDate = b.shootDate ? Date.parse(b.shootDate) : 0;
    return bDate - aDate || a.schoolName.localeCompare(b.schoolName);
  });

  return {
    clients,
    locations: locationRows.map((row) => crmPublicRow(row)),
    locationPhotos: locationPhotoRows
      .sort((a, b) =>
        Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
        || cleanBookingValue(a.created_at).localeCompare(cleanBookingValue(b.created_at))
        || cleanBookingValue(a.id).localeCompare(cleanBookingValue(b.id)),
      )
      .map((row) => crmLocationPhotoPublicRow(row)),
    contacts: contactRows.map((row) => crmPublicRow(row)),
    agreements: (agreementsResult.data ?? []).map((row) => crmPublicRow(row)),
    bookingCycles: cycleRows.map((row) => crmPublicRow(row)),
    bookingJobs: bookingJobRows.map((row) => crmPublicRow(row)),
    bookingHistory,
    tasks: taskRows.map((row) => crmPublicRow(row)),
    emails: emailRows.map((row) => crmOutboxPublicRow(row)),
    activities: (activitiesResult.data ?? []).map((row) => crmPublicRow(row)),
    templates: (templatesResult.data ?? []).map((row) => crmPublicRow(row)),
    automationRules: (rulesResult.data ?? []).map((row) => crmPublicRow(row)),
    summary: {
      totalClients: clients.length,
      bookedThisYear: bookedClientIds.size,
      notBookedThisYear: Math.max(0, clients.length - bookedClientIds.size),
      followUpsDue,
      openTasks: taskRows.filter((row) => row.status === "open" || row.status === "snoozed").length,
      pendingApprovals: emailRows.filter((row) => row.status === "pending_approval").length,
    },
  };
}

export function requiredCrmCreateFields(resource: CrmResource) {
  const fields: Partial<Record<CrmResource, string[]>> = {
    client: ["display_name"],
    location: ["client_id"],
    contact: ["client_id", "full_name"],
    agreement: ["client_id", "title"],
    bookingCycle: ["client_id", "season_year"],
    task: ["client_id", "title"],
    emailTemplate: ["template_key", "name", "subject_template"],
    automationRule: ["name", "trigger_type", "action_type"],
    activity: ["client_id", "activity_type", "summary"],
  };
  return fields[resource] ?? [];
}
