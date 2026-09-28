import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { recordAudit } from "@/lib/audit";
import {
  CRM_CLIENT_KINDS,
  CRM_RESOURCES,
  CRM_RESOURCE_TABLE,
  crmPublicRow,
  loadCrmClientIndexPage,
  loadCrmDashboard,
  parseCrmValues,
  requiredCrmCreateFields,
  resolveCrmPhotographer,
  type CrmResource,
} from "@/lib/crm";
import {
  approveCrmEmail,
  bulkQueueCrmEmails,
  createCrmEmailDraft,
  CrmEmailError,
  crmEmailPublicRow,
  deliverCrmEmailById,
  ensureCrmDefaultTemplates,
  isCrmSystemTemplateKey,
  queueExistingDraft,
  queueTemplatedCrmEmail,
} from "@/lib/crm-email";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  CRM_LOCATION_MAX_INPUT_PHOTO_BASE64,
  CRM_LOCATION_PHOTO_AUDIENCES,
  CRM_LOCATION_PHOTO_CATEGORIES,
  InvalidCrmLocationPhotoError,
  crmLocationPhotoPublicRow,
  prepareCrmLocationPhoto,
} from "@/lib/crm-location-photos";
import { r2Delete, r2Upload } from "@/lib/r2";
import { rateLimit } from "@/lib/rate-limit";
import { guardAgreement } from "@/lib/require-agreement";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Uuid = z.string().uuid();
const RequestKey = z.string().trim().min(8).max(200);
const Resource = z.enum(CRM_RESOURCES);
const DeleteResource = z.enum([
  "location",
  "contact",
  "agreement",
  "bookingCycle",
  "task",
  "emailTemplate",
  "automationRule",
]);

const SaveAction = z
  .object({
    action: z.literal("save"),
    resource: Resource,
    id: Uuid.optional(),
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
    values: z.record(z.string(), z.unknown()),
  })
  .strict();
const CreateClientBundleAction = z
  .object({
    action: z.literal("createClientBundle"),
    requestKey: RequestKey,
    client: z.record(z.string(), z.unknown()),
    location: z.record(z.string(), z.unknown()).nullable().optional(),
    contact: z.record(z.string(), z.unknown()).nullable().optional(),
    bookingCycle: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();
const EnsureSchoolBookingJobAction = z
  .object({
    action: z.literal("ensureSchoolBookingJob"),
    requestKey: RequestKey,
    gallerySchoolId: Uuid,
    clientId: Uuid.nullable().optional(),
    locationId: Uuid.nullable().optional(),
    role: z.enum(["primary", "retake", "makeup", "other"]).optional(),
    repairOnly: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.locationId && !value.clientId) {
      context.addIssue({
        code: "custom",
        path: ["clientId"],
        message: "Choose the CRM client before assigning one of its campuses.",
      });
    }
  });
const ReassignSchoolBookingJobAction = z
  .object({
    action: z.literal("reassignSchoolBookingJob"),
    jobId: Uuid,
    clientId: Uuid,
    locationId: Uuid,
  })
  .strict();
const ArchiveAction = z
  .object({ action: z.literal("archive"), resource: z.literal("client"), id: Uuid })
  .strict();
const DeleteAction = z
  .object({ action: z.literal("delete"), resource: DeleteResource, id: Uuid })
  .strict();
const SetPrimaryAction = z
  .object({
    action: z.literal("setPrimary"),
    resource: z.enum(["contact", "location"]),
    clientId: Uuid,
    id: Uuid,
  })
  .strict();
const UploadLocationPhotoAction = z
  .object({
    action: z.literal("uploadLocationPhoto"),
    locationId: Uuid,
    requestKey: RequestKey,
    audience: z.enum(CRM_LOCATION_PHOTO_AUDIENCES),
    category: z.enum(CRM_LOCATION_PHOTO_CATEGORIES),
    caption: z.string().trim().max(1000).nullable().optional(),
    altText: z.string().trim().max(500).nullable().optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
    photo: z
      .object({
        filename: z.string().trim().min(1).max(255),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        content: z.string().min(4).max(CRM_LOCATION_MAX_INPUT_PHOTO_BASE64),
      })
      .strict(),
  })
  .strict();
const DeleteLocationPhotoAction = z
  .object({ action: z.literal("deleteLocationPhoto"), id: Uuid })
  .strict();
const DraftEmailAction = z
  .object({
    action: z.literal("draftEmail"),
    contactId: Uuid,
    clientId: Uuid.nullable().optional(),
    bookingCycleId: Uuid.nullable().optional(),
    templateId: Uuid.nullable().optional(),
    requestKey: RequestKey.nullable().optional(),
    useAi: z.boolean().optional(),
    subject: z.string().trim().max(300).nullable().optional(),
    message: z.string().trim().max(100_000).nullable().optional(),
  })
  .strict();
const SendEmailAction = z
  .object({
    action: z.literal("sendEmail"),
    outboxId: Uuid.optional(),
    contactId: Uuid.optional(),
    clientId: Uuid.nullable().optional(),
    bookingCycleId: Uuid.nullable().optional(),
    templateId: Uuid.optional(),
    requestKey: RequestKey.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outboxId) return;
    if (!value.contactId || !value.templateId || !value.requestKey) {
      context.addIssue({
        code: "custom",
        message: "Use outboxId, or provide contactId, templateId, and requestKey.",
      });
    }
  });
const ApproveEmailAction = z
  .object({ action: z.literal("approveEmail"), outboxId: Uuid })
  .strict();
const BulkQueueAction = z
  .object({
    action: z.literal("bulkQueue"),
    contactIds: z.array(Uuid).min(1).max(100),
    templateId: Uuid,
    bookingCycleId: Uuid.nullable().optional(),
    requestKey: RequestKey,
  })
  .strict();

const PostBody = z.union([
  CreateClientBundleAction,
  EnsureSchoolBookingJobAction,
  ReassignSchoolBookingJobAction,
  SaveAction,
  SetPrimaryAction,
  UploadLocationPhotoAction,
  DeleteLocationPhotoAction,
  ArchiveAction,
  DeleteAction,
  DraftEmailAction,
  SendEmailAction,
  ApproveEmailAction,
  BulkQueueAction,
]);

const BundleResult = z.object({
  clientId: Uuid,
  locationId: Uuid.nullable(),
  contactId: Uuid.nullable(),
  bookingCycleId: Uuid.nullable(),
});

const SchoolBookingJobBundleResult = z.object({
  jobId: Uuid,
  clientId: Uuid,
  locationId: Uuid.nullable(),
  bookingCycleId: Uuid,
  gallerySchoolId: Uuid,
  bookingEventId: Uuid.nullable(),
  createdClient: z.boolean(),
});

const RemovalResult = z.object({
  id: Uuid,
  clientId: Uuid,
  disposition: z.enum(["deleted", "archived"]),
  message: z.string().min(1),
  photoObjectKeys: z.array(z.string()),
});

const GetQuery = z.object({
  mode: z.enum(["index", "desktop"]).nullable().optional(),
  offset: z.coerce.number().int().min(0).optional(),
  clientId: Uuid.nullable().optional(),
  search: z.string().trim().max(200).nullable().optional(),
  kind: z.enum(CRM_CLIENT_KINDS).nullable().optional(),
  seasonYear: z.coerce.number().int().min(2000).max(2200).nullable().optional(),
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
    .nullable()
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

function privateJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

function dbErrorStatus(error: { code?: string } | null | undefined) {
  if (error?.code === "22023") return 400;
  if (error?.code === "42501") return 403;
  if (error?.code === "P0002") return 404;
  if (error?.code === "40001") return 409;
  if (error?.code === "23505" || error?.code === "23503" || error?.code === "23514") return 409;
  return 500;
}

function normalizeContactEmailIdentity(value: unknown) {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase() || null;
}

function consentTimestampValue(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createdByResource(resource: CrmResource) {
  return new Set<CrmResource>([
    "client",
    "agreement",
    "bookingCycle",
    "task",
    "automationRule",
    "activity",
  ]).has(resource);
}

async function auditMutation(input: {
  request: NextRequest;
  userId: string;
  photographerId: string;
  action: string;
  resource: string;
  id?: string | null;
}) {
  await recordAudit({
    request: input.request,
    actorUserId: input.userId,
    actorPhotographerId: input.photographerId,
    targetPhotographerId: input.photographerId,
    action: input.action,
    entityType: `crm_${input.resource}`,
    entityId: input.id,
    result: "ok",
  });
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) return privateJson({ ok: false, message: "Please sign in again." }, { status: 401 });
    const service = createDashboardServiceClient();
    const photographer = await resolveCrmPhotographer(service, user.id);
    if (!photographer) {
      return privateJson({ ok: false, message: "Photographer profile not found." }, { status: 404 });
    }
    const url = new URL(request.url);
    const parsed = GetQuery.safeParse({
      mode: url.searchParams.get("mode"),
      offset: url.searchParams.get("offset") ?? undefined,
      clientId: url.searchParams.get("clientId"),
      search: url.searchParams.get("search"),
      kind: url.searchParams.get("kind"),
      seasonYear: url.searchParams.get("seasonYear"),
      status: url.searchParams.get("status"),
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return privateJson({ ok: false, message: "Invalid CRM filters." }, { status: 400 });
    }
    if (parsed.data.mode !== "index" || !parsed.data.offset) {
      await ensureCrmDefaultTemplates({
        service,
        photographerId: photographer.id,
        userId: user.id,
      });
    }
    if (parsed.data.mode === "index") {
      const result = await loadCrmClientIndexPage({
        service,
        photographerId: photographer.id,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
      return privateJson({ ok: true, ...result });
    }
    const result = await loadCrmDashboard({
      service,
      photographerId: photographer.id,
      clientId: parsed.data.clientId,
      search: parsed.data.search,
      kind: parsed.data.kind,
      seasonYear: parsed.data.seasonYear,
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      includeTimeline: parsed.data.mode !== "desktop",
    });
    return privateJson({ ok: true, ...result });
  } catch (error) {
    console.error("[dashboard:crm:GET]", error);
    return privateJson({ ok: false, message: "Failed to load CRM records." }, { status: 500 });
  }
}

async function saveResource(input: {
  service: ReturnType<typeof createDashboardServiceClient>;
  photographerId: string;
  userId: string;
  resource: CrmResource;
  id?: string;
  expectedUpdatedAt?: string;
  values: Record<string, unknown>;
}) {
  const parsed = parseCrmValues(input.resource, input.values);
  if (!parsed.ok) {
    throw new CrmEmailError("Invalid CRM fields.", 400, "invalid_crm_fields");
  }
  const data = { ...parsed.data };
  if (input.resource === "location") {
    let existingLocation: Record<string, unknown> | null = null;
    if (input.id) {
      const { data: existingData, error: existingError } = await input.service
        .from("crm_locations")
        .select("client_id,updated_at,archived_at,latitude,longitude")
        .eq("id", input.id)
        .eq("photographer_id", input.photographerId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existingData) {
        throw new CrmEmailError("CRM location not found.", 404, "crm_record_not_found");
      }
      existingLocation = existingData as Record<string, unknown>;
      if (existingLocation.archived_at != null) {
        throw new CrmEmailError(
          "Archived locations are read-only.",
          409,
          "location_archived",
        );
      }
      if (data.client_id && data.client_id !== existingLocation.client_id) {
        throw new CrmEmailError(
          "A location cannot be moved to another client.",
          409,
          "location_client_immutable",
        );
      }
      delete data.client_id;
    }
    if (Object.hasOwn(data, "archived_at")) {
      throw new CrmEmailError(
        "Use Delete to retire a location safely.",
        409,
        "location_archive_action_required",
      );
    }
    for (const field of [
      "arrival_instructions",
      "parking_instructions",
      "setup_instructions",
      "internal_notes",
      "place_id",
    ]) {
      if (typeof data[field] === "string" && !String(data[field]).trim()) data[field] = null;
    }
    const effectiveLatitude = Object.hasOwn(data, "latitude")
      ? data.latitude
      : existingLocation?.latitude ?? null;
    const effectiveLongitude = Object.hasOwn(data, "longitude")
      ? data.longitude
      : existingLocation?.longitude ?? null;
    if ((effectiveLatitude == null) !== (effectiveLongitude == null)) {
      throw new CrmEmailError(
        "Latitude and longitude must be saved or cleared together.",
        400,
        "location_coordinates_pair_required",
      );
    }
  }
  if (
    (input.resource === "contact" || input.resource === "location") &&
    data.is_primary === true
  ) {
    throw new CrmEmailError(
      "Use the atomic setPrimary action to promote a contact or location.",
      409,
      "set_primary_action_required",
    );
  }
  if (input.resource === "contact") {
    if (Object.hasOwn(data, "archived_at")) {
      throw new CrmEmailError(
        "Use Remove to retire a contact safely.",
        409,
        "contact_archive_action_required",
      );
    }
    let existing: Record<string, unknown> | null = null;
    let contactClientId = typeof data.client_id === "string" ? data.client_id : "";
    if (input.id) {
      const { data: contactState, error: contactStateError } = await input.service
        .from("crm_contacts")
        .select("client_id,archived_at")
        .eq("id", input.id)
        .eq("photographer_id", input.photographerId)
        .maybeSingle();
      if (contactStateError) throw contactStateError;
      if (!contactState) {
        throw new CrmEmailError("CRM contact not found.", 404, "crm_record_not_found");
      }
      if (contactState.archived_at != null) {
        throw new CrmEmailError(
          "Archived contacts are read-only.",
          409,
          "contact_archived",
        );
      }
      if (data.client_id && data.client_id !== contactState.client_id) {
        throw new CrmEmailError(
          "A contact cannot be moved to another client.",
          409,
          "contact_client_immutable",
        );
      }
      contactClientId = String(contactState.client_id ?? "");
      delete data.client_id;
      const { data: existingData, error: existingError } = await input.service
        .from("crm_contacts")
        .select("email_normalized,marketing_consent,consent_recorded_at,consent_source")
        .eq("id", input.id)
        .eq("photographer_id", input.photographerId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existingData) {
        throw new CrmEmailError("CRM contact not found.", 404, "crm_record_not_found");
      }
      existing = existingData as Record<string, unknown>;
    }
    if (Object.hasOwn(data, "location_id") && data.location_id != null) {
      const { data: activeLocation, error: activeLocationError } = await input.service
        .from("crm_locations")
        .select("id")
        .eq("id", data.location_id)
        .eq("client_id", contactClientId)
        .eq("photographer_id", input.photographerId)
        .is("archived_at", null)
        .maybeSingle();
      if (activeLocationError) throw activeLocationError;
      if (!activeLocation) {
        throw new CrmEmailError(
          "Choose an active location owned by this client.",
          400,
          "contact_active_location_required",
        );
      }
    }
    const existingEmailIdentity = normalizeContactEmailIdentity(existing?.email_normalized);
    const effectiveEmailIdentity = "email" in data
      ? normalizeContactEmailIdentity(data.email)
      : existingEmailIdentity;
    const emailIdentityChanged = existing !== null
      && effectiveEmailIdentity !== existingEmailIdentity;
    const effectiveConsent = "marketing_consent" in data
      ? data.marketing_consent
      : existing?.marketing_consent ?? "unknown";
    const effectiveRecordedAt = "consent_recorded_at" in data
      ? data.consent_recorded_at
      : existing?.consent_recorded_at ?? null;
    const effectiveSource = "consent_source" in data
      ? data.consent_source
      : existing?.consent_source ?? null;
    const submittedConsentTime = "consent_recorded_at" in data
      ? consentTimestampValue(data.consent_recorded_at)
      : null;
    const existingConsentTime = consentTimestampValue(existing?.consent_recorded_at);
    const submittedConsentSource = "consent_source" in data
      ? String(data.consent_source ?? "").trim()
      : "";
    const freshConsentEvidenceSubmitted = "consent_recorded_at" in data
      && "consent_source" in data
      && submittedConsentTime !== null
      && submittedConsentSource.length > 0
      && (existingConsentTime === null || submittedConsentTime !== existingConsentTime);
    if (emailIdentityChanged && effectiveConsent === "opted_in" && !freshConsentEvidenceSubmitted) {
      throw new CrmEmailError(
        "Changing a contact email requires fresh promotional consent evidence.",
        409,
        "consent_email_identity_changed",
      );
    }
    if (
      emailIdentityChanged
      && existing?.marketing_consent === "opted_in"
      && effectiveConsent !== "opted_in"
      && !freshConsentEvidenceSubmitted
    ) {
      data.consent_recorded_at = null;
      data.consent_source = null;
    }
    if (
      effectiveConsent === "opted_in" &&
      (!effectiveRecordedAt || !String(effectiveSource ?? "").trim())
    ) {
      throw new CrmEmailError(
        "Opted-in contacts require a consent timestamp and source.",
        400,
        "consent_evidence_required",
      );
    }
  }
  if (
    input.id
    && (input.resource === "agreement" || input.resource === "bookingCycle")
  ) {
    const { data: existingParent, error: existingParentError } = await input.service
      .from(CRM_RESOURCE_TABLE[input.resource])
      .select("client_id")
      .eq("id", input.id)
      .eq("photographer_id", input.photographerId)
      .maybeSingle();
    if (existingParentError) throw existingParentError;
    if (!existingParent) {
      throw new CrmEmailError("CRM record not found.", 404, "crm_record_not_found");
    }
    if (data.client_id && data.client_id !== existingParent.client_id) {
      throw new CrmEmailError(
        "This record cannot be moved to another client.",
        409,
        "crm_client_immutable",
      );
    }
    delete data.client_id;
  }
  if (input.resource === "activity" && input.id) {
    throw new CrmEmailError("CRM timeline entries are append-only.", 409, "activity_append_only");
  }
  if (input.resource === "agreement" && typeof data.document_key === "string") {
    const expectedPrefix = `crm-agreements/${input.photographerId}/`;
    if (
      !data.document_key.startsWith(expectedPrefix) ||
      data.document_key.includes("..") ||
      /[?#\u0000-\u001f]/.test(data.document_key)
    ) {
      throw new CrmEmailError("Agreement document key is outside this studio.", 400, "invalid_document_key");
    }
  }
  if (input.resource === "task" && data.assigned_user_id && data.assigned_user_id !== input.userId) {
    throw new CrmEmailError("Tasks can only be assigned to the current owner.", 400, "invalid_assignee");
  }
  if (input.resource === "task") {
    let existingTask: Record<string, unknown> | null = null;
    if (input.id) {
      const { data: existingTaskData, error: existingTaskError } = await input.service
        .from("crm_tasks")
        .select("client_id,status,completed_at")
        .eq("id", input.id)
        .eq("photographer_id", input.photographerId)
        .maybeSingle();
      if (existingTaskError) throw existingTaskError;
      if (!existingTaskData) {
        throw new CrmEmailError("CRM task not found.", 404, "crm_record_not_found");
      }
      existingTask = existingTaskData as Record<string, unknown>;
      if (data.client_id && data.client_id !== existingTask.client_id) {
        throw new CrmEmailError(
          "Move tasks by creating a new task for the other client.",
          409,
          "task_client_immutable",
        );
      }
    }

    if (Object.hasOwn(data, "status")) {
      if (data.status === "completed") {
        data.completed_at = data.completed_at || existingTask?.completed_at || new Date().toISOString();
      } else {
        // Reopening, snoozing, or cancelling a task must clear the old completion
        // timestamp so status filters and reminder counts cannot disagree.
        data.completed_at = null;
      }
    } else if (Object.hasOwn(data, "completed_at")) {
      const effectiveStatus = existingTask?.status ?? "open";
      if (data.completed_at && effectiveStatus !== "completed") {
        throw new CrmEmailError(
          "Set task status to completed when recording its completion time.",
          400,
          "task_completion_status_required",
        );
      }
      if (data.completed_at == null && effectiveStatus === "completed") {
        throw new CrmEmailError(
          "Reopen a completed task by changing its status at the same time.",
          400,
          "task_reopen_status_required",
        );
      }
    }
  }
  if (input.resource === "emailTemplate") {
    if (data.message_class === "transactional") {
      throw new CrmEmailError(
        "Transactional templates are limited to built-in presets.",
        400,
        "transactional_template_reserved",
      );
    }
    if (data.template_key && isCrmSystemTemplateKey(data.template_key)) {
      throw new CrmEmailError(
        "That template key is reserved for a built-in preset.",
        409,
        "system_template_key_reserved",
      );
    }
    if (typeof data.html_template === "string" && data.html_template.trim()) {
      throw new CrmEmailError(
        "Custom templates accept plain-text content only. Studio OS generates the safe email HTML.",
        400,
        "custom_template_plain_text_only",
      );
    }
    if (Object.hasOwn(data, "html_template")) data.html_template = null;
    if (
      input.id &&
      Object.hasOwn(data, "text_template") &&
      !String(data.text_template ?? "").trim()
    ) {
      throw new CrmEmailError(
        "Custom email templates need plain-text content.",
        400,
        "empty_template",
      );
    }
    if (input.id) {
      const { data: existingTemplate, error: templateError } = await input.service
        .from("crm_email_templates")
        .select("is_system")
        .eq("id", input.id)
        .eq("photographer_id", input.photographerId)
        .maybeSingle();
      if (templateError) throw templateError;
      if (!existingTemplate) {
        throw new CrmEmailError("CRM template not found.", 404, "crm_record_not_found");
      }
      if (existingTemplate.is_system) {
        throw new CrmEmailError(
          "Built-in email templates are immutable; create a custom template instead.",
          409,
          "system_template_immutable",
        );
      }
    }
  }
  if (input.resource === "emailTemplate" && data.status === "approved") {
    data.approved_at = new Date().toISOString();
    data.approved_by = input.userId;
  }
  if (input.resource === "automationRule") {
    if (data.mode === "autopilot") {
      if (!parsed.confirmAutopilot) {
        throw new CrmEmailError(
          "Autopilot requires explicit confirmation.",
          409,
          "autopilot_confirmation_required",
        );
      }
      data.autopilot_approved_at = new Date().toISOString();
      data.autopilot_approved_by = input.userId;
    } else if (data.mode) {
      data.autopilot_approved_at = null;
      data.autopilot_approved_by = null;
    }
    if (data.mode === "off") data.enabled = false;
  }
  if (input.resource === "activity") {
    data.source = "user";
    data.created_by = input.userId;
  }
  if (!input.id) {
    const missing = requiredCrmCreateFields(input.resource).filter(
      (field) => data[field] == null || data[field] === "",
    );
    if (missing.length) {
      throw new CrmEmailError(
        `Missing required fields: ${missing.join(", ")}.`,
        400,
        "missing_crm_fields",
      );
    }
    if (input.resource === "emailTemplate" && !String(data.text_template ?? "").trim()) {
      throw new CrmEmailError(
        "Custom email templates need plain-text content.",
        400,
        "empty_template",
      );
    }
    data.photographer_id = input.photographerId;
    if (createdByResource(input.resource) && data.created_by == null) {
      data.created_by = input.userId;
    }
    const { data: row, error } = await input.service
      .from(CRM_RESOURCE_TABLE[input.resource])
      .insert(data)
      .select("*")
      .single();
    if (error) {
      const wrapped = new CrmEmailError(error.message, dbErrorStatus(error), error.code ?? "database_error");
      throw wrapped;
    }
    return row as Record<string, unknown>;
  }
  if (!Object.keys(data).length) {
    throw new CrmEmailError("Provide at least one field to update.", 400, "empty_update");
  }
  let updateQuery = input.service
    .from(CRM_RESOURCE_TABLE[input.resource])
    .update(data)
    .eq("id", input.id)
    .eq("photographer_id", input.photographerId);
  if (input.expectedUpdatedAt) {
    updateQuery = updateQuery.eq("updated_at", input.expectedUpdatedAt);
  }
  const { data: row, error } = await updateQuery.select("*").maybeSingle();
  if (error) throw new CrmEmailError(error.message, dbErrorStatus(error), error.code ?? "database_error");
  if (!row && input.expectedUpdatedAt) {
    const { data: current, error: currentError } = await input.service
      .from(CRM_RESOURCE_TABLE[input.resource])
      .select("id")
      .eq("id", input.id)
      .eq("photographer_id", input.photographerId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (current) {
      throw new CrmEmailError(
        "This record changed after you opened it. Reload and try again.",
        409,
        "crm_edit_conflict",
      );
    }
  }
  if (!row) throw new CrmEmailError("CRM record not found.", 404, "crm_record_not_found");
  return row as Record<string, unknown>;
}

async function uploadLocationPhoto(input: {
  service: ReturnType<typeof createDashboardServiceClient>;
  photographerId: string;
  userId: string;
  body: z.infer<typeof UploadLocationPhotoAction>;
}) {
  const limit = await rateLimit(`${input.photographerId}:upload`, {
    namespace: "crm-location-photo",
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    throw new CrmEmailError(
      "Too many location photo changes. Please wait a minute and try again.",
      429,
      "location_photo_rate_limited",
    );
  }

  const { data: location, error: locationError } = await input.service
    .from("crm_locations")
    .select("id,client_id")
    .eq("id", input.body.locationId)
    .eq("photographer_id", input.photographerId)
    .is("archived_at", null)
    .maybeSingle();
  if (locationError) throw locationError;
  if (!location) {
    throw new CrmEmailError(
      "Active CRM location not found.",
      404,
      "crm_location_not_found",
    );
  }

  let prepared;
  try {
    prepared = await prepareCrmLocationPhoto(input.body.photo);
  } catch (error) {
    if (error instanceof InvalidCrmLocationPhotoError) {
      throw new CrmEmailError(error.message, 400, "invalid_location_photo");
    }
    throw error;
  }

  const metadata = {
    locationId: input.body.locationId,
    contentSha256: prepared.contentSha256,
    filename: prepared.filename,
    audience: input.body.audience,
    category: input.body.category,
    caption: input.body.caption?.trim() || null,
    altText: input.body.altText?.trim() || null,
    sortOrder: input.body.sortOrder ?? 0,
  };
  const payloadFingerprint = createHash("sha256")
    .update(JSON.stringify(metadata))
    .digest("hex");

  const existingResult = await input.service
    .from("crm_location_photos")
    .select("*")
    .eq("photographer_id", input.photographerId)
    .eq("request_key", input.body.requestKey)
    .maybeSingle();
  if (existingResult.error) throw existingResult.error;
  if (existingResult.data) {
    if (existingResult.data.payload_fingerprint !== payloadFingerprint) {
      throw new CrmEmailError(
        "That photo request key was already used with different data.",
        409,
        "location_photo_request_key_reused",
      );
    }
    return existingResult.data as Record<string, unknown>;
  }

  const { count, error: countError } = await input.service
    .from("crm_location_photos")
    .select("id", { count: "exact", head: true })
    .eq("photographer_id", input.photographerId)
    .eq("location_id", input.body.locationId);
  if (countError) throw countError;
  if ((count ?? 0) >= 12) {
    throw new CrmEmailError(
      "This location already has the maximum of 12 photos.",
      409,
      "location_photo_limit",
    );
  }

  const requestHash = createHash("sha256").update(input.body.requestKey).digest("hex");
  const objectKey = [
    "crm-locations",
    input.photographerId,
    input.body.locationId,
    `${requestHash.slice(0, 20)}-${prepared.contentSha256.slice(0, 20)}.jpg`,
  ].join("/");

  await r2Upload(objectKey, prepared.bytes, prepared.contentType, "private, no-store");
  const cleanupUpload = async () => {
    try {
      await r2Delete(objectKey);
    } catch (error) {
      console.error("[dashboard:crm:photo-upload-cleanup]", error);
    }
  };

  const insertResult = await input.service
    .from("crm_location_photos")
    .insert({
      photographer_id: input.photographerId,
      client_id: location.client_id,
      location_id: input.body.locationId,
      object_key: objectKey,
      filename: prepared.filename,
      content_type: prepared.contentType,
      byte_size: prepared.byteSize,
      width: prepared.width,
      height: prepared.height,
      content_sha256: prepared.contentSha256,
      payload_fingerprint: payloadFingerprint,
      audience: input.body.audience,
      category: input.body.category,
      caption: metadata.caption,
      alt_text: metadata.altText,
      sort_order: metadata.sortOrder,
      request_key: input.body.requestKey,
      created_by: input.userId,
    })
    .select("*")
    .maybeSingle();

  if (insertResult.error || !insertResult.data) {
    if (insertResult.error?.code === "23505") {
      const replayResult = await input.service
        .from("crm_location_photos")
        .select("*")
        .eq("photographer_id", input.photographerId)
        .eq("request_key", input.body.requestKey)
        .maybeSingle();
      if (!replayResult.error && replayResult.data) {
        if (replayResult.data.object_key !== objectKey) await cleanupUpload();
        if (replayResult.data.payload_fingerprint === payloadFingerprint) {
          return replayResult.data as Record<string, unknown>;
        }
        throw new CrmEmailError(
          "That photo request key was already used with different data.",
          409,
          "location_photo_request_key_reused",
        );
      }
    }
    await cleanupUpload();
    if (insertResult.error) {
      throw new CrmEmailError(
        insertResult.error.message,
        dbErrorStatus(insertResult.error),
        insertResult.error.code ?? "location_photo_database_error",
      );
    }
    throw new CrmEmailError(
      "The location photo could not be saved.",
      500,
      "location_photo_database_error",
    );
  }
  return insertResult.data as Record<string, unknown>;
}

async function deleteLocationPhoto(input: {
  service: ReturnType<typeof createDashboardServiceClient>;
  photographerId: string;
  id: string;
}) {
  const limit = await rateLimit(`${input.photographerId}:delete`, {
    namespace: "crm-location-photo",
    limit: 60,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    throw new CrmEmailError(
      "Too many location photo changes. Please wait a minute and try again.",
      429,
      "location_photo_rate_limited",
    );
  }

  const { data: photo, error: photoError } = await input.service
    .from("crm_location_photos")
    .select("id,object_key")
    .eq("id", input.id)
    .eq("photographer_id", input.photographerId)
    .maybeSingle();
  if (photoError) throw photoError;
  if (!photo) {
    throw new CrmEmailError(
      "Location photo not found.",
      404,
      "location_photo_not_found",
    );
  }

  // Keep the database row if object removal fails so the owner can retry and
  // the private object never becomes an untracked orphan.
  await r2Delete(photo.object_key);
  const { data: removed, error: deleteError } = await input.service
    .from("crm_location_photos")
    .delete()
    .eq("id", input.id)
    .eq("photographer_id", input.photographerId)
    .select("id")
    .maybeSingle();
  if (deleteError) throw deleteError;
  if (!removed) {
    throw new CrmEmailError(
      "Location photo not found.",
      404,
      "location_photo_not_found",
    );
  }
}

function bundleValues(
  resource: "client" | "location" | "contact" | "bookingCycle",
  raw: Record<string, unknown> | null | undefined,
) {
  if (raw == null) return null;
  const forbiddenByResource: Record<typeof resource, string[]> = {
    client: [],
    location: ["clientId"],
    contact: ["clientId", "locationId", "archivedAt"],
    bookingCycle: ["clientId", "agreementId"],
  };
  const forbidden = forbiddenByResource[resource].find((key) => key in raw);
  if (forbidden) {
    throw new CrmEmailError(
      `${forbidden} is assigned by createClientBundle.`,
      400,
      "invalid_bundle_field",
    );
  }
  const parsed = parseCrmValues(resource, raw);
  if (!parsed.ok) {
    throw new CrmEmailError("Invalid client bundle fields.", 400, "invalid_bundle_fields");
  }
  const required = requiredCrmCreateFields(resource).filter(
    (field) => field !== "client_id" && (parsed.data[field] == null || parsed.data[field] === ""),
  );
  if (required.length) {
    throw new CrmEmailError(
      `Missing required fields: ${required.join(", ")}.`,
      400,
      "missing_bundle_fields",
    );
  }
  if (
    resource === "contact" &&
    parsed.data.marketing_consent === "opted_in" &&
    (!parsed.data.consent_recorded_at ||
      !String(parsed.data.consent_source ?? "").trim())
  ) {
    throw new CrmEmailError(
      "Opted-in contacts require a consent timestamp and source.",
      400,
      "consent_evidence_required",
    );
  }
  return parsed.data;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) return privateJson({ ok: false, message: "Please sign in again." }, { status: 401 });
    const service = createDashboardServiceClient();
    const agreement = await guardAgreement({ service, userId: user.id });
    if (!agreement.ok) return privateJson(agreement.body, { status: agreement.status });
    const photographer = await resolveCrmPhotographer(service, user.id);
    if (!photographer) {
      return privateJson({ ok: false, message: "Photographer profile not found." }, { status: 404 });
    }
    const parsed = await parseJson(request, PostBody);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    if (body.action === "uploadLocationPhoto") {
      const row = await uploadLocationPhoto({
        service,
        photographerId: photographer.id,
        userId: user.id,
        body,
      });
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: "crm.location_photo.upload",
        resource: "location_photo",
        id: String(row.id),
      });
      return privateJson({ ok: true, photo: crmLocationPhotoPublicRow(row) });
    }

    if (body.action === "deleteLocationPhoto") {
      await deleteLocationPhoto({
        service,
        photographerId: photographer.id,
        id: body.id,
      });
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: "crm.location_photo.delete",
        resource: "location_photo",
        id: body.id,
      });
      return privateJson({ ok: true, id: body.id });
    }

    if (body.action === "ensureSchoolBookingJob") {
      const role = body.role ?? "primary";
      let effectiveClientId = body.clientId ?? null;
      let effectiveLocationId = body.locationId ?? null;
      if (!effectiveClientId) {
        const { data: existingJob, error: existingJobError } = await service
          .from("crm_booking_jobs")
          .select("client_id")
          .eq("gallery_school_id", body.gallerySchoolId)
          .eq("photographer_id", photographer.id)
          .maybeSingle();
        if (existingJobError) throw existingJobError;
        effectiveClientId = existingJob?.client_id ?? null;
      }
      if (effectiveClientId) {
        const { data: activeLocations, error: activeLocationsError } = await service
          .from("crm_locations")
          .select("id")
          .eq("client_id", effectiveClientId)
          .eq("photographer_id", photographer.id)
          .is("archived_at", null)
          .order("is_primary", { ascending: false })
          .limit(3);
        if (activeLocationsError) throw activeLocationsError;
        if (effectiveLocationId) {
          if (!(activeLocations ?? []).some((location) => location.id === effectiveLocationId)) {
            throw new CrmEmailError(
              "Choose an active campus owned by this client.",
              400,
              "active_booking_location_required",
            );
          }
        } else if ((activeLocations ?? []).length > 1) {
          throw new CrmEmailError(
            "Choose the campus for this booking.",
            400,
            "booking_location_required",
          );
        } else {
          effectiveLocationId = activeLocations?.[0]?.id ?? null;
        }
      }
      const rpcInput = {
        gallerySchoolId: body.gallerySchoolId,
        clientId: effectiveClientId,
        locationId: effectiveLocationId,
        role,
        repairOnly: body.repairOnly ?? false,
      };
      const payloadFingerprint = createHash("sha256")
        .update(JSON.stringify(rpcInput))
        .digest("hex");
      const { data, error } = await service.rpc("crm_ensure_school_booking_job", {
        p_photographer_id: photographer.id,
        p_actor_user_id: user.id,
        p_request_key: body.requestKey,
        p_payload_fingerprint: payloadFingerprint,
        p_gallery_school_id: body.gallerySchoolId,
        p_client_id: effectiveClientId,
        p_location_id: effectiveLocationId,
        p_role: role,
        p_repair_only: body.repairOnly ?? false,
      });
      if (error) {
        throw new CrmEmailError(
          error.message,
          dbErrorStatus(error),
          error.code ?? "booking_job_failed",
        );
      }
      const bundle = SchoolBookingJobBundleResult.safeParse(data);
      if (!bundle.success) throw new Error("CRM booking job RPC returned an invalid result.");
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: "crm.booking_job.ensure",
        resource: "booking_job",
        id: bundle.data.jobId,
      });
      return privateJson({ ok: true, bundle: bundle.data });
    }

    if (body.action === "reassignSchoolBookingJob") {
      const { data: activeLocation, error: activeLocationError } = await service
        .from("crm_locations")
        .select("id")
        .eq("id", body.locationId)
        .eq("client_id", body.clientId)
        .eq("photographer_id", photographer.id)
        .is("archived_at", null)
        .maybeSingle();
      if (activeLocationError) throw activeLocationError;
      if (!activeLocation) {
        throw new CrmEmailError(
          "Choose an active campus owned by this client.",
          400,
          "active_booking_location_required",
        );
      }
      const { data, error } = await service.rpc("crm_reassign_school_booking_job", {
        p_photographer_id: photographer.id,
        p_actor_user_id: user.id,
        p_job_id: body.jobId,
        p_client_id: body.clientId,
        p_location_id: body.locationId,
      });
      if (error) {
        throw new CrmEmailError(
          error.message,
          dbErrorStatus(error),
          error.code ?? "booking_job_reassignment_failed",
        );
      }
      const bundle = SchoolBookingJobBundleResult.safeParse(data);
      if (!bundle.success) {
        throw new Error("CRM booking job reassignment RPC returned an invalid result.");
      }
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: "crm.booking_job.reassign",
        resource: "booking_job",
        id: bundle.data.jobId,
      });
      return privateJson({ ok: true, bundle: bundle.data });
    }

    if (body.action === "createClientBundle") {
      const client = bundleValues("client", body.client)!;
      const location = bundleValues("location", body.location);
      const contact = bundleValues("contact", body.contact);
      const bookingCycle = bundleValues("bookingCycle", body.bookingCycle);
      const payloadFingerprint = createHash("sha256")
        .update(JSON.stringify({ client, location, contact, bookingCycle }))
        .digest("hex");
      const { data, error } = await service.rpc("crm_create_client_bundle", {
        p_photographer_id: photographer.id,
        p_created_by: user.id,
        p_request_key: body.requestKey,
        p_payload_fingerprint: payloadFingerprint,
        p_client: client,
        p_location: location,
        p_contact: contact,
        p_booking_cycle: bookingCycle,
      });
      if (error) {
        throw new CrmEmailError(
          error.message,
          dbErrorStatus(error),
          error.code ?? "client_bundle_failed",
        );
      }
      const bundle = BundleResult.safeParse(data);
      if (!bundle.success) throw new Error("CRM client bundle RPC returned an invalid result.");
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: "crm.client_bundle.create",
        resource: "client",
        id: bundle.data.clientId,
      });
      return privateJson({ ok: true, bundle: bundle.data });
    }

    if (body.action === "save") {
      const row = await saveResource({
        service,
        photographerId: photographer.id,
        userId: user.id,
        resource: body.resource,
        id: body.id,
        expectedUpdatedAt: body.expectedUpdatedAt,
        values: body.values,
      });
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: body.id ? "crm.update" : "crm.create",
        resource: body.resource,
        id: String(row.id),
      });
      return privateJson({ ok: true, resource: body.resource, record: crmPublicRow(row) });
    }

    if (body.action === "setPrimary") {
      const functionName = body.resource === "contact"
        ? "crm_set_primary_contact"
        : "crm_set_primary_location";
      const targetParameter = body.resource === "contact"
        ? { p_contact_id: body.id }
        : { p_location_id: body.id };
      const { data, error } = await service.rpc(functionName, {
        p_photographer_id: photographer.id,
        p_client_id: body.clientId,
        p_actor_user_id: user.id,
        ...targetParameter,
      });
      if (error) {
        throw new CrmEmailError(
          error.message,
          dbErrorStatus(error),
          error.code ?? "set_primary_failed",
        );
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("CRM set-primary RPC returned an invalid record.");
      }
      const row = data as Record<string, unknown>;
      if (row.id !== body.id || row.client_id !== body.clientId || row.is_primary !== true) {
        throw new Error("CRM set-primary RPC returned a mismatched record.");
      }
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: `crm.${body.resource}.set_primary`,
        resource: body.resource,
        id: body.id,
      });
      return privateJson({
        ok: true,
        resource: body.resource,
        record: crmPublicRow(row),
      });
    }

    if (body.action === "archive") {
      const { data, error } = await service
        .from("crm_clients")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("photographer_id", photographer.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new CrmEmailError("Client not found.", 404, "client_not_found");
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: "crm.archive",
        resource: "client",
        id: body.id,
      });
      return privateJson({ ok: true, id: body.id, record: crmPublicRow(data) });
    }

    if (body.action === "delete") {
      if (body.resource === "location" || body.resource === "contact") {
        const { data, error } = await service.rpc("crm_remove_location_or_contact", {
          p_photographer_id: photographer.id,
          p_actor_user_id: user.id,
          p_resource: body.resource,
          p_id: body.id,
        });
        if (error) {
          throw new CrmEmailError(
            error.message,
            dbErrorStatus(error),
            error.code ?? "crm_removal_failed",
          );
        }
        const removal = RemovalResult.safeParse(data);
        if (!removal.success || removal.data.id !== body.id) {
          throw new Error("CRM removal RPC returned an invalid result.");
        }
        if (removal.data.disposition === "deleted" && removal.data.photoObjectKeys.length) {
          const cleanup = await Promise.allSettled(
            removal.data.photoObjectKeys.map((key) => r2Delete(key)),
          );
          cleanup.forEach((result, index) => {
            if (result.status === "rejected") {
              console.error("[dashboard:crm:location-delete-cleanup]", {
                key: removal.data.photoObjectKeys[index],
                error: result.reason,
              });
            }
          });
        }
        await auditMutation({
          request,
          userId: user.id,
          photographerId: photographer.id,
          action: removal.data.disposition === "archived" ? "crm.archive" : "crm.delete",
          resource: body.resource,
          id: body.id,
        });
        return privateJson({
          ok: true,
          id: body.id,
          disposition: removal.data.disposition,
          message: removal.data.message,
        });
      }
      const table = CRM_RESOURCE_TABLE[body.resource];
      if (body.resource === "emailTemplate") {
        const { data: template, error: templateError } = await service
          .from("crm_email_templates")
          .select("is_system")
          .eq("id", body.id)
          .eq("photographer_id", photographer.id)
          .maybeSingle();
        if (templateError) throw templateError;
        if (!template) {
          throw new CrmEmailError("CRM record not found.", 404, "crm_record_not_found");
        }
        if (template.is_system) {
          throw new CrmEmailError(
            "Built-in email templates cannot be deleted.",
            409,
            "system_template_immutable",
          );
        }
      }
      const { data, error } = await service
        .from(table)
        .delete()
        .eq("id", body.id)
        .eq("photographer_id", photographer.id)
        .select("id")
        .maybeSingle();
      if (error) throw new CrmEmailError(error.message, dbErrorStatus(error), error.code ?? "database_error");
      if (!data) throw new CrmEmailError("CRM record not found.", 404, "crm_record_not_found");
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: "crm.delete",
        resource: body.resource,
        id: body.id,
      });
      return privateJson({
        ok: true,
        id: body.id,
        disposition: "deleted" as const,
        message: "CRM record deleted.",
      });
    }

    if (body.action === "draftEmail") {
      const row = await createCrmEmailDraft({
        service,
        photographer,
        userId: user.id,
        ...body,
      });
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: "crm.email.draft",
        resource: "email",
        id: String(row.id),
      });
      return privateJson({ ok: true, email: crmEmailPublicRow(row) });
    }

    if (body.action === "sendEmail") {
      let row;
      if (body.outboxId) {
        row = await queueExistingDraft({
          service,
          photographerId: photographer.id,
          userId: user.id,
          outboxId: body.outboxId,
        });
      } else {
        row = await queueTemplatedCrmEmail({
          service,
          photographer,
          userId: user.id,
          contactId: body.contactId!,
          clientId: body.clientId,
          bookingCycleId: body.bookingCycleId,
          templateId: body.templateId!,
          requestKey: body.requestKey!,
          deliveryMode: "manual",
        });
      }
      const delivered = await deliverCrmEmailById({
        service,
        photographer,
        outboxId: String(row.id),
        workerId: `manual:${user.id}:${randomUUID()}`,
      });
      const result = delivered ?? row;
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: "crm.email.send",
        resource: "email",
        id: String(result.id),
      });
      return privateJson({ ok: true, email: crmEmailPublicRow(result) });
    }

    if (body.action === "approveEmail") {
      const row = await approveCrmEmail({
        service,
        photographerId: photographer.id,
        userId: user.id,
        outboxId: body.outboxId,
      });
      await auditMutation({
        request,
        userId: user.id,
        photographerId: photographer.id,
        action: "crm.email.approve",
        resource: "email",
        id: body.outboxId,
      });
      return privateJson({ ok: true, email: crmEmailPublicRow(row) });
    }

    const bulk = await bulkQueueCrmEmails({
      service,
      photographer,
      userId: user.id,
      contactIds: body.contactIds,
      templateId: body.templateId,
      bookingCycleId: body.bookingCycleId,
      requestKey: body.requestKey,
    });
    await auditMutation({
      request,
      userId: user.id,
      photographerId: photographer.id,
      action: "crm.email.bulk_queue",
      resource: "email",
    });
    return privateJson({
      ok: true,
      queued: bulk.emails.length,
      skipped: bulk.skipped,
      emails: bulk.emails.map(crmEmailPublicRow),
    });
  } catch (error) {
    if (error instanceof CrmEmailError) {
      return privateJson(
        { ok: false, message: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[dashboard:crm:POST]", error);
    return privateJson({ ok: false, message: "CRM request failed." }, { status: 500 });
  }
}
