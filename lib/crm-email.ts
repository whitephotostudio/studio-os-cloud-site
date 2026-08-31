import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ResendRequestError,
  resendConfigured,
  sendResendEmail,
} from "@/lib/resend";
import { crmPublicRow, looksLikeCrmEmail, type CrmPhotographer } from "@/lib/crm";
import {
  createCrmUnsubscribeUrl,
  crmUnsubscribeConfigured,
} from "@/lib/crm-unsubscribe";

const SUPPORTED_VARIABLES = new Set([
  "contact_first_name",
  "contact_name",
  "client_name",
  "season_year",
  "shoot_date",
  "studio_name",
  "studio_email",
  "booking_link",
]);

type DatabaseRow = Record<string, unknown>;
type EmailTemplateRow = DatabaseRow & {
  id: string;
  status: string;
  message_class: string;
  is_system: boolean;
  subject_template: string;
  html_template: string | null;
  text_template: string | null;
  allowed_variables: string[] | null;
  ai_instruction: string | null;
};

type ContactRow = DatabaseRow & {
  id: string;
  client_id: string;
  full_name: string;
  email: string | null;
  marketing_consent: string;
  do_not_contact: boolean;
  archived_at: string | null;
};

type ClientRow = DatabaseRow & {
  id: string;
  display_name: string;
};

type BookingCycleRow = DatabaseRow & {
  id: string;
  client_id: string;
  season_year: number;
  shoot_start_at: string | null;
};

const DEFAULT_TEMPLATES = [
  {
    template_key: "annual_booking_invitation",
    name: "Annual booking invitation",
    purpose: "booking_invitation",
    message_class: "relationship",
    subject_template: "Booking {{season_year}} photo dates for {{client_name}}",
    text_template:
      "Hi {{contact_first_name}},\n\nIt is booking time for {{season_year}}, and we would love to photograph {{client_name}} again. Could we reserve your preferred dates?\n\nYou can reply to this email or use {{booking_link}}.\n\nWarmly,\n{{studio_name}}",
    allowed_variables: [
      "contact_first_name",
      "client_name",
      "season_year",
      "booking_link",
      "studio_name",
    ],
  },
  {
    template_key: "booking_follow_up",
    name: "Booking follow-up",
    purpose: "follow_up",
    message_class: "relationship",
    subject_template: "Following up on {{client_name}} photo dates",
    text_template:
      "Hi {{contact_first_name}},\n\nI wanted to follow up about photo dates for {{client_name}} in {{season_year}}. Please let me know what timing works best for your team.\n\nWarmly,\n{{studio_name}}",
    allowed_variables: ["contact_first_name", "client_name", "season_year", "studio_name"],
  },
  {
    template_key: "proposal_agreement",
    name: "Proposal and agreement",
    purpose: "proposal",
    message_class: "relationship",
    subject_template: "Photo program proposal for {{client_name}}",
    text_template:
      "Hi {{contact_first_name}},\n\nThank you for discussing the {{season_year}} photo program for {{client_name}}. I am sending the proposal and agreement for your review. Please reply with any questions or changes.\n\nWarmly,\n{{studio_name}}",
    allowed_variables: ["contact_first_name", "client_name", "season_year", "studio_name"],
  },
  {
    template_key: "shoot_confirmation",
    name: "Shoot date confirmation",
    purpose: "confirmation",
    message_class: "transactional",
    subject_template: "Confirmed: {{client_name}} photo date",
    text_template:
      "Hi {{contact_first_name}},\n\nThis confirms the photo date for {{client_name}}: {{shoot_date}}. Please reply if any of the booking details need to change.\n\nThank you,\n{{studio_name}}",
    allowed_variables: ["contact_first_name", "client_name", "shoot_date", "studio_name"],
  },
  {
    template_key: "client_thank_you",
    name: "Client thank-you",
    purpose: "thank_you",
    message_class: "relationship",
    subject_template: "Thank you, {{client_name}}",
    text_template:
      "Hi {{contact_first_name}},\n\nThank you for trusting {{studio_name}} with {{client_name}} photos this year. We appreciated working with your community and look forward to helping again.\n\nWarmly,\n{{studio_name}}",
    allowed_variables: ["contact_first_name", "client_name", "studio_name"],
  },
  {
    template_key: "annual_renewal",
    name: "Annual renewal",
    purpose: "renewal",
    message_class: "relationship",
    subject_template: "Planning {{client_name}} photos for {{season_year}}",
    text_template:
      "Hi {{contact_first_name}},\n\nAs we plan for {{season_year}}, I would be happy to renew the photo program for {{client_name}}. Shall we review the agreement and hold dates?\n\nWarmly,\n{{studio_name}}",
    allowed_variables: ["contact_first_name", "client_name", "season_year", "studio_name"],
  },
] as const;

const SYSTEM_TEMPLATE_KEYS = new Set<string>(
  DEFAULT_TEMPLATES.map((template) => template.template_key),
);

export function isCrmSystemTemplateKey(value: unknown) {
  return SYSTEM_TEMPLATE_KEYS.has(clean(value));
}

export class CrmEmailError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "crm_email_error") {
    super(message);
    this.name = "CrmEmailError";
    this.status = status;
    this.code = code;
  }
}

export function classifyCrmDraftMessage(input: {
  hasTemplate: boolean;
  templateStatus?: string | null;
  templateMessageClass?: string | null;
  hasManualOverride: boolean;
  useAi: boolean;
}) {
  const templateClass = clean(input.templateMessageClass);
  const rewritten = input.hasManualOverride || input.useAi;
  if (templateClass === "transactional") {
    if (rewritten) {
      throw new CrmEmailError(
        "Transactional templates cannot be rewritten or overridden.",
        400,
        "transactional_override_forbidden",
      );
    }
    if (input.templateStatus !== "approved") {
      throw new CrmEmailError(
        "Transactional sending requires an approved template.",
        409,
        "transactional_template_not_approved",
      );
    }
    return "transactional";
  }
  if (
    !input.hasTemplate ||
    rewritten ||
    input.templateStatus !== "approved"
  ) {
    return "marketing";
  }
  return templateClass === "marketing" ? "marketing" : "relationship";
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanSubject(value: unknown) {
  return clean(value).replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").slice(0, 300);
}

function firstName(value: unknown) {
  return clean(value).split(/\s+/)[0] || "there";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function textToHtml(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br />")}</p>`)
    .join("");
}

function htmlToText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

export function appendCrmUnsubscribe(
  rendered: { subject: string; html: string; text: string },
  unsubscribeUrl: string,
) {
  const baseHtml = rendered.html.replace(
    /<!--crm-unsubscribe-start-->[\s\S]*?<!--crm-unsubscribe-end-->/g,
    "",
  );
  const baseText = rendered.text.replace(
    /\n?\[CRM-UNSUBSCRIBE-START\][\s\S]*?\[CRM-UNSUBSCRIBE-END\]\n?/g,
    "",
  );
  const html = `${baseHtml}<!--crm-unsubscribe-start--><hr style="border:0;border-top:1px solid #d9dee8;margin:24px 0 16px"><p style="font-size:12px;color:#667085">Stop relationship and promotional emails: <a href="${escapeHtml(unsubscribeUrl)}">unsubscribe</a>.</p><!--crm-unsubscribe-end-->`;
  const text = `${baseText}\n\n[CRM-UNSUBSCRIBE-START]\nStop relationship and promotional emails: ${unsubscribeUrl}\n[CRM-UNSUBSCRIBE-END]`;
  return { ...rendered, html, text };
}

function unsubscribeUrl(input: {
  photographerId: string;
  contactId: string;
  email: string;
}) {
  return createCrmUnsubscribeUrl(input);
}

function requireUnsubscribeUrl(input: {
  photographerId: string;
  contactId: string;
  email: string;
}) {
  const url = unsubscribeUrl(input);
  if (!url) {
    throw new CrmEmailError(
      "Relationship and promotional sending is disabled until CRM_UNSUBSCRIBE_SECRET and NEXT_PUBLIC_APP_URL are configured.",
      503,
      "unsubscribe_not_configured",
    );
  }
  return url;
}

function shortDate(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function replaceVariables(
  source: string,
  variables: Record<string, string>,
  allowedVariables: string[],
  html: boolean,
) {
  const allowed = new Set(allowedVariables);
  return source.replace(/{{\s*([a-z][a-z0-9_]*)\s*}}/g, (_match, name: string) => {
    if (!SUPPORTED_VARIABLES.has(name) || !allowed.has(name)) {
      throw new CrmEmailError(
        `Template variable {{${name}}} is not approved for this template.`,
        400,
        "template_variable_not_allowed",
      );
    }
    const value = variables[name] ?? "";
    return html ? escapeHtml(value) : value;
  });
}

export function renderCrmEmailTemplate(input: {
  template: EmailTemplateRow;
  variables: Record<string, string>;
}) {
  const allowedVariables = Array.isArray(input.template.allowed_variables)
    ? input.template.allowed_variables
    : [];
  const subject = cleanSubject(replaceVariables(
    clean(input.template.subject_template),
    input.variables,
    allowedVariables,
    false,
  ));
  const rawHtml = clean(input.template.html_template);
  const rawText = clean(input.template.text_template);
  const isSystemTemplate = input.template.is_system === true;
  const textSource = rawText || htmlToText(rawHtml);
  const text = replaceVariables(textSource, input.variables, allowedVariables, false);
  // Only immutable server-provisioned presets may render trusted HTML. Custom
  // templates are normalized through escaped plain text so they cannot hide or
  // visually suppress the canonical unsubscribe block appended at queue time.
  const html = isSystemTemplate && rawHtml
    ? replaceVariables(rawHtml, input.variables, allowedVariables, true)
    : textToHtml(text);
  if (!subject || (!html && !text)) {
    throw new CrmEmailError("The email template has no usable content.", 400, "empty_template");
  }
  return { subject, html, text };
}

export function crmEmailDedupeKey(parts: Array<string | number | null | undefined>) {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u001f"))
    .digest("hex");
}

export function crmEmailPublicRow(row: DatabaseRow) {
  const shaped = crmPublicRow(row);
  shaped.html = shaped.htmlBody ?? "";
  shaped.text = shaped.textBody ?? "";
  delete shaped.htmlBody;
  delete shaped.textBody;
  delete shaped.toEmailNormalized;
  delete shaped.dedupeKey;
  delete shaped.lockedAt;
  delete shaped.leaseExpiresAt;
  delete shaped.lockedBy;
  delete shaped.lastError;
  return shaped;
}

export async function ensureCrmDefaultTemplates(input: {
  service: SupabaseClient;
  photographerId: string;
  userId: string;
}) {
  const now = new Date().toISOString();
  const rows = DEFAULT_TEMPLATES.map((template) => ({
    photographer_id: input.photographerId,
    ...template,
    version: 1,
    is_system: true,
    html_template: null,
    status: "approved",
    approved_at: now,
    approved_by: input.userId,
  }));
  const { error } = await input.service.from("crm_email_templates").upsert(rows, {
    onConflict: "photographer_id,template_key,version",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

async function requireTemplate(
  service: SupabaseClient,
  photographerId: string,
  templateId: string,
  approvedOnly: boolean,
) {
  let query = service
    .from("crm_email_templates")
    .select("*")
    .eq("id", templateId)
    .eq("photographer_id", photographerId)
    .is("archived_at", null);
  if (approvedOnly) query = query.eq("status", "approved");
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new CrmEmailError(
      approvedOnly ? "Choose an approved email template." : "Email template not found.",
      404,
      "template_not_found",
    );
  }
  const template = data as EmailTemplateRow;
  if (template.message_class === "transactional" && template.is_system !== true) {
    throw new CrmEmailError(
      "Transactional sending is limited to built-in templates.",
      409,
      "transactional_template_not_system",
    );
  }
  return template;
}

async function requireContext(input: {
  service: SupabaseClient;
  photographer: CrmPhotographer;
  contactId: string;
  clientId?: string | null;
  bookingCycleId?: string | null;
}) {
  const { data: contactData, error: contactError } = await input.service
    .from("crm_contacts")
    .select("*")
    .eq("id", input.contactId)
    .eq("photographer_id", input.photographer.id)
    .is("archived_at", null)
    .maybeSingle();
  if (contactError) throw contactError;
  if (!contactData) {
    throw new CrmEmailError("Contact not found.", 404, "contact_not_found");
  }
  const contact = contactData as ContactRow;
  if (input.clientId && contact.client_id !== input.clientId) {
    throw new CrmEmailError("Contact does not belong to that client.", 400, "client_mismatch");
  }

  const { data: clientData, error: clientError } = await input.service
    .from("crm_clients")
    .select("*")
    .eq("id", contact.client_id)
    .eq("photographer_id", input.photographer.id)
    .is("archived_at", null)
    .maybeSingle();
  if (clientError) throw clientError;
  if (!clientData) throw new CrmEmailError("Client not found.", 404, "client_not_found");

  let bookingCycle: BookingCycleRow | null = null;
  if (input.bookingCycleId) {
    const { data, error } = await input.service
      .from("crm_booking_cycles")
      .select("*")
      .eq("id", input.bookingCycleId)
      .eq("client_id", contact.client_id)
      .eq("photographer_id", input.photographer.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new CrmEmailError("Booking cycle not found.", 404, "booking_cycle_not_found");
    }
    bookingCycle = data as BookingCycleRow;
  }

  return { contact, client: clientData as ClientRow, bookingCycle };
}

function contextVariables(input: {
  photographer: CrmPhotographer;
  contact: ContactRow;
  client: ClientRow;
  bookingCycle: BookingCycleRow | null;
}) {
  const appOrigin = clean(process.env.NEXT_PUBLIC_APP_URL).replace(/\/$/, "");
  return {
    contact_first_name: firstName(input.contact.full_name),
    contact_name: clean(input.contact.full_name),
    client_name: clean(input.client.display_name),
    season_year: String(input.bookingCycle?.season_year ?? new Date().getUTCFullYear()),
    shoot_date: shortDate(input.bookingCycle?.shoot_start_at),
    studio_name: clean(input.photographer.business_name) || "Studio OS photographer",
    studio_email: clean(input.photographer.studio_email),
    booking_link: appOrigin ? `${appOrigin}/book` : "",
  };
}

async function assertRecipientAllowed(input: {
  service: SupabaseClient;
  photographerId: string;
  contact: ContactRow;
  messageClass: string;
  requireExplicitConsent?: boolean;
}) {
  const email = clean(input.contact.email).toLowerCase();
  if (!looksLikeCrmEmail(email)) {
    throw new CrmEmailError("This contact needs a valid email address.", 400, "invalid_recipient");
  }
  if (input.contact.do_not_contact) {
    throw new CrmEmailError("This contact is marked do not contact.", 409, "do_not_contact");
  }
  if (
    (input.messageClass === "marketing" || input.requireExplicitConsent) &&
    input.contact.marketing_consent !== "opted_in"
  ) {
    throw new CrmEmailError(
      "This message requires recorded opt-in permission.",
      409,
      "consent_required",
    );
  }
  const { data, error } = await input.service
    .from("crm_email_suppressions")
    .select("scope")
    .eq("photographer_id", input.photographerId)
    .eq("email_normalized", email)
    .is("lifted_at", null);
  if (error) throw error;
  const suppressed = (data ?? []).some(
    (row) =>
      row.scope === "all" ||
      (row.scope === "non_transactional" && input.messageClass !== "transactional") ||
      (row.scope === "marketing" && input.messageClass === "marketing"),
  );
  if (suppressed) {
    throw new CrmEmailError("This email address is suppressed.", 409, "recipient_suppressed");
  }
  return email;
}

function responseOutputText(payload: DatabaseRow) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as DatabaseRow).content;
      return Array.isArray(content) ? content : [];
    })
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const text = (item as DatabaseRow).text;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
}

async function tryAiDraft(input: {
  subject: string;
  text: string;
  instruction: string;
}) {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: clean(process.env.OPENAI_EMAIL_DRAFT_MODEL) || "gpt-4.1-mini",
        max_output_tokens: 900,
        input: [
          {
            role: "system",
            content:
              "Rewrite a business email draft. Preserve facts exactly. Never invent dates, prices, agreements, or commitments. Return JSON only with string fields subject and message.",
          },
          {
            role: "user",
            content: JSON.stringify({
              instruction: input.instruction || "Make it warm, concise, and professional.",
              subject: input.subject,
              message: input.text,
            }),
          },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as DatabaseRow;
    const raw = responseOutputText(payload).replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(raw) as { subject?: unknown; message?: unknown };
    const subject = cleanSubject(parsed.subject);
    const message = clean(parsed.message).slice(0, 100_000);
    if (!subject || !message) return null;
    return { subject, text: message, html: textToHtml(message) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function insertEmailEvent(
  service: SupabaseClient,
  photographerId: string,
  outboxId: string,
  eventType: string,
  metadata: DatabaseRow = {},
) {
  const { error } = await service.from("crm_email_events").insert({
    photographer_id: photographerId,
    outbox_id: outboxId,
    event_type: eventType,
    metadata,
  });
  if (error) throw error;
}

async function selectOutbox(
  service: SupabaseClient,
  photographerId: string,
  outboxId: string,
) {
  const { data, error } = await service
    .from("crm_email_outbox")
    .select("*")
    .eq("id", outboxId)
    .eq("photographer_id", photographerId)
    .maybeSingle();
  if (error) throw error;
  return (data as DatabaseRow | null) ?? null;
}

function throwCrmDatabaseError(error: unknown): never {
  const databaseError = error as { code?: string; message?: string } | null;
  if (databaseError?.message?.includes("daily non-transactional email queue limit")) {
    throw new CrmEmailError(
      "This studio has reached its daily relationship/promotional email queue limit.",
      429,
      "daily_email_limit",
    );
  }
  throw error;
}

async function upsertOutbox(
  service: SupabaseClient,
  row: DatabaseRow,
  photographerId: string,
  dedupeKey: string,
) {
  const { data: inserted, error } = await service
    .from("crm_email_outbox")
    .insert(row)
    .select("*")
    .maybeSingle();
  if (!error && inserted) return { row: inserted as DatabaseRow, inserted: true };
  if (error?.code !== "23505") throwCrmDatabaseError(error);
  const { data, error: selectError } = await service
    .from("crm_email_outbox")
    .select("*")
    .eq("photographer_id", photographerId)
    .eq("dedupe_key", dedupeKey)
    .single();
  if (selectError) throw selectError;
  return { row: data as DatabaseRow, inserted: false };
}

export async function createCrmEmailDraft(input: {
  service: SupabaseClient;
  photographer: CrmPhotographer;
  userId: string;
  contactId: string;
  clientId?: string | null;
  bookingCycleId?: string | null;
  templateId?: string | null;
  requestKey?: string | null;
  useAi?: boolean;
  subject?: string | null;
  message?: string | null;
}) {
  const context = await requireContext(input);
  let template: EmailTemplateRow | null = null;
  let rendered: { subject: string; html: string; text: string };
  if (input.templateId) {
    template = await requireTemplate(input.service, input.photographer.id, input.templateId, false);
    rendered = renderCrmEmailTemplate({
      template,
      variables: contextVariables({ photographer: input.photographer, ...context }),
    });
  } else {
    const subject = clean(input.subject);
    const text = clean(input.message);
    if (!subject || !text) {
      throw new CrmEmailError("Choose a template or enter a subject and message.");
    }
    rendered = { subject: cleanSubject(subject), text, html: textToHtml(text) };
  }

  if (clean(input.subject)) rendered.subject = cleanSubject(input.subject);
  if (clean(input.message)) {
    rendered.text = clean(input.message).slice(0, 100_000);
    rendered.html = textToHtml(rendered.text);
  }

  const hasManualOverride = Boolean(clean(input.subject) || clean(input.message));
  const messageClass = classifyCrmDraftMessage({
    hasTemplate: Boolean(template),
    templateStatus: template?.status,
    templateMessageClass: template?.message_class,
    hasManualOverride,
    useAi: input.useAi === true,
  });

  let contentSource = hasManualOverride ? "manual" : "template";
  let aiFallback = false;
  if (input.useAi) {
    const ai = await tryAiDraft({
      subject: rendered.subject,
      text: rendered.text,
      instruction: clean(template?.ai_instruction),
    });
    if (ai) {
      rendered = ai;
      contentSource = "ai";
    } else {
      aiFallback = true;
    }
  }

  const toEmail = await assertRecipientAllowed({
    service: input.service,
    photographerId: input.photographer.id,
    contact: context.contact,
    messageClass,
  });
  let unsubscribeReady = messageClass === "transactional";
  if (messageClass !== "transactional") {
    const url = unsubscribeUrl({
      photographerId: input.photographer.id,
      contactId: context.contact.id,
      email: toEmail,
    });
    if (url) {
      rendered = appendCrmUnsubscribe(rendered, url);
      unsubscribeReady = true;
    }
  }
  const dedupeKey = crmEmailDedupeKey([
    "draft",
    input.photographer.id,
    input.requestKey || randomUUID(),
    context.contact.id,
    template?.id,
  ]);
  const outbox = await upsertOutbox(
    input.service,
    {
      photographer_id: input.photographer.id,
      client_id: context.client.id,
      contact_id: context.contact.id,
      booking_cycle_id: context.bookingCycle?.id ?? null,
      template_id: template?.id ?? null,
      recipient_type: "client",
      to_name: context.contact.full_name,
      to_email: toEmail,
      message_class: messageClass,
      delivery_mode: "manual",
      status: "draft",
      subject: rendered.subject,
      html_body: rendered.html,
      text_body: rendered.text,
      content_source: contentSource,
      content_metadata: {
        aiRequested: input.useAi === true,
        aiFallback,
        unsubscribe_ready: unsubscribeReady,
      },
      dedupe_key: dedupeKey,
      created_by: input.userId,
    },
    input.photographer.id,
    dedupeKey,
  );
  if (outbox.inserted) {
    await insertEmailEvent(input.service, input.photographer.id, String(outbox.row.id), "drafted", {
      contentSource,
      aiFallback,
    });
  }
  return outbox.row;
}

export async function queueTemplatedCrmEmail(input: {
  service: SupabaseClient;
  photographer: CrmPhotographer;
  userId?: string | null;
  contactId: string;
  clientId?: string | null;
  bookingCycleId?: string | null;
  templateId: string;
  requestKey: string;
  automationRuleId?: string | null;
  deliveryMode: "manual" | "approval" | "autopilot";
  requireExplicitConsent?: boolean;
}) {
  const [context, template] = await Promise.all([
    requireContext(input),
    requireTemplate(input.service, input.photographer.id, input.templateId, true),
  ]);
  const toEmail = await assertRecipientAllowed({
    service: input.service,
    photographerId: input.photographer.id,
    contact: context.contact,
    messageClass: template.message_class,
    requireExplicitConsent: input.requireExplicitConsent,
  });
  let rendered = renderCrmEmailTemplate({
    template,
    variables: contextVariables({ photographer: input.photographer, ...context }),
  });
  let unsubscribeReady = template.message_class === "transactional";
  if (template.message_class !== "transactional") {
    const url = input.deliveryMode === "approval"
      ? unsubscribeUrl({
          photographerId: input.photographer.id,
          contactId: context.contact.id,
          email: toEmail,
        })
      : requireUnsubscribeUrl({
          photographerId: input.photographer.id,
          contactId: context.contact.id,
          email: toEmail,
        });
    if (url) {
      rendered = appendCrmUnsubscribe(rendered, url);
      unsubscribeReady = true;
    }
  }
  const dedupeKey = crmEmailDedupeKey([
    "send",
    input.photographer.id,
    input.requestKey,
    context.contact.id,
    template.id,
  ]);
  const pendingApproval = input.deliveryMode === "approval";
  const outbox = await upsertOutbox(
    input.service,
    {
      photographer_id: input.photographer.id,
      client_id: context.client.id,
      contact_id: context.contact.id,
      booking_cycle_id: context.bookingCycle?.id ?? null,
      automation_rule_id: input.automationRuleId ?? null,
      template_id: template.id,
      recipient_type: "client",
      to_name: context.contact.full_name,
      to_email: toEmail,
      message_class: template.message_class,
      delivery_mode: input.deliveryMode,
      status: pendingApproval ? "pending_approval" : "queued",
      subject: rendered.subject,
      html_body: rendered.html,
      text_body: rendered.text,
      content_source: "template",
      content_metadata: {
        requires_explicit_consent: input.requireExplicitConsent === true,
        unsubscribe_ready: unsubscribeReady,
      },
      dedupe_key: dedupeKey,
      approved_at: input.deliveryMode === "manual" ? new Date().toISOString() : null,
      approved_by: input.deliveryMode === "manual" ? input.userId ?? null : null,
      created_by: input.userId ?? null,
    },
    input.photographer.id,
    dedupeKey,
  );
  if (outbox.inserted) {
    await insertEmailEvent(
      input.service,
      input.photographer.id,
      String(outbox.row.id),
      pendingApproval ? "drafted" : "queued",
      { deliveryMode: input.deliveryMode },
    );
  }
  return outbox.row;
}

async function queueSafetyPatchForOutbox(
  service: SupabaseClient,
  photographerId: string,
  outbox: DatabaseRow,
) {
  const contactId = clean(outbox.contact_id);
  if (!contactId) {
    throw new CrmEmailError("A saved contact is required to unsubscribe.", 409, "contact_required");
  }
  const { data: contact, error } = await service
    .from("crm_contacts")
    .select("*")
    .eq("id", contactId)
    .eq("photographer_id", photographerId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  const email = clean(contact?.email_normalized || contact?.email).toLowerCase();
  if (!contact || !email || email !== clean(outbox.to_email).toLowerCase()) {
    throw new CrmEmailError("The saved recipient changed; create a new draft.", 409, "stale_recipient");
  }
  await assertRecipientAllowed({
    service,
    photographerId,
    contact: contact as ContactRow,
    messageClass: clean(outbox.message_class),
  });
  if (outbox.message_class === "transactional") {
    if (!outbox.template_id || outbox.content_source !== "template") {
      throw new CrmEmailError(
        "Transactional email requires unchanged approved template content.",
        409,
        "transactional_content_invalid",
      );
    }
    const template = await requireTemplate(
      service,
      photographerId,
      String(outbox.template_id),
      true,
    );
    if (template.message_class !== "transactional" || template.is_system !== true) {
      throw new CrmEmailError(
        "Transactional email requires a built-in transactional template.",
        409,
        "transactional_content_invalid",
      );
    }
    return {};
  }
  const url = requireUnsubscribeUrl({ photographerId, contactId, email });
  const rendered = appendCrmUnsubscribe(
    {
      subject: clean(outbox.subject),
      html: clean(outbox.html_body) || textToHtml(clean(outbox.text_body)),
      text: clean(outbox.text_body) || htmlToText(clean(outbox.html_body)),
    },
    url,
  );
  const metadata =
    outbox.content_metadata &&
    typeof outbox.content_metadata === "object" &&
    !Array.isArray(outbox.content_metadata)
      ? (outbox.content_metadata as DatabaseRow)
      : {};
  return {
    html_body: rendered.html,
    text_body: rendered.text,
    content_metadata: { ...metadata, unsubscribe_ready: true },
  };
}

export async function approveCrmEmail(input: {
  service: SupabaseClient;
  photographerId: string;
  userId: string;
  outboxId: string;
}) {
  const existing = await selectOutbox(input.service, input.photographerId, input.outboxId);
  if (!existing) throw new CrmEmailError("Email draft not found.", 404, "email_not_found");
  if (existing.status !== "pending_approval") {
    if (["queued", "processing", "retry", "sent"].includes(String(existing.status))) return existing;
    throw new CrmEmailError("Only pending emails can be approved.", 409, "invalid_email_status");
  }
  const now = new Date().toISOString();
  const unsubscribePatch = await queueSafetyPatchForOutbox(
    input.service,
    input.photographerId,
    existing,
  );
  const { data, error } = await input.service
    .from("crm_email_outbox")
    .update({
      ...unsubscribePatch,
      status: "queued",
      approved_at: now,
      approved_by: input.userId,
    })
    .eq("id", input.outboxId)
    .eq("photographer_id", input.photographerId)
    .eq("status", "pending_approval")
    .select("*")
    .maybeSingle();
  if (error) throwCrmDatabaseError(error);
  const row = (data as DatabaseRow | null) ?? (await selectOutbox(input.service, input.photographerId, input.outboxId));
  if (!row) throw new CrmEmailError("Email draft not found.", 404, "email_not_found");
  if (data) await insertEmailEvent(input.service, input.photographerId, input.outboxId, "approved");
  return row;
}

export async function queueExistingDraft(input: {
  service: SupabaseClient;
  photographerId: string;
  userId: string;
  outboxId: string;
}) {
  const existing = await selectOutbox(input.service, input.photographerId, input.outboxId);
  if (!existing) throw new CrmEmailError("Email draft not found.", 404, "email_not_found");
  if (["queued", "processing", "retry", "sent"].includes(String(existing.status))) return existing;
  if (!['draft', 'pending_approval'].includes(String(existing.status))) {
    throw new CrmEmailError("This email cannot be sent in its current state.", 409, "invalid_email_status");
  }
  const now = new Date().toISOString();
  const unsubscribePatch = await queueSafetyPatchForOutbox(
    input.service,
    input.photographerId,
    existing,
  );
  const { data, error } = await input.service
    .from("crm_email_outbox")
    .update({
      ...unsubscribePatch,
      status: "queued",
      delivery_mode: "manual",
      approved_at: now,
      approved_by: input.userId,
    })
    .eq("id", input.outboxId)
    .eq("photographer_id", input.photographerId)
    .in("status", ["draft", "pending_approval"])
    .select("*")
    .maybeSingle();
  if (error) throwCrmDatabaseError(error);
  const row = (data as DatabaseRow | null) ?? existing;
  if (data) await insertEmailEvent(input.service, input.photographerId, input.outboxId, "queued");
  return row;
}

function retryAtFromError(error: unknown) {
  if (error instanceof ResendRequestError && error.retryAfterMs != null) {
    return new Date(Date.now() + Math.max(1_000, error.retryAfterMs)).toISOString();
  }
  return null;
}

export async function deliverClaimedCrmEmail(input: {
  service: SupabaseClient;
  photographer: CrmPhotographer;
  row: DatabaseRow;
  workerId: string;
}) {
  const outboxId = String(input.row.id);
  try {
    const result = await sendResendEmail({
      to: String(input.row.to_email),
      subject: String(input.row.subject),
      html: clean(input.row.html_body) || textToHtml(clean(input.row.text_body)),
      text: clean(input.row.text_body) || undefined,
      fromName: input.photographer.business_name,
      replyTo: input.photographer.studio_email,
      idempotencyKey: `crm-${outboxId}`,
      tags: [
        { name: "category", value: "crm" },
        { name: "outbox_id", value: outboxId },
      ],
    });
    const { error } = await input.service.rpc("crm_finish_email_attempt", {
      p_outbox_id: outboxId,
      p_worker: input.workerId,
      p_succeeded: true,
      p_provider_message_id: result.id,
      p_error_message: null,
      p_retry_at: null,
      p_metadata: { provider: "resend" },
    });
    if (error) throw error;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email provider request failed.";
    const { error: finishError } = await input.service.rpc("crm_finish_email_attempt", {
      p_outbox_id: outboxId,
      p_worker: input.workerId,
      p_succeeded: false,
      p_provider_message_id: null,
      p_error_message: message.slice(0, 1000),
      p_retry_at: retryAtFromError(error),
      p_metadata: {
        provider: "resend",
        status: error instanceof ResendRequestError ? error.status : null,
      },
    });
    if (finishError) throw finishError;
  }
  return selectOutbox(input.service, input.photographer.id, outboxId);
}

export async function deliverCrmEmailById(input: {
  service: SupabaseClient;
  photographer: CrmPhotographer;
  outboxId: string;
  workerId: string;
}) {
  if (!resendConfigured()) {
    return selectOutbox(input.service, input.photographer.id, input.outboxId);
  }
  const { data, error } = await input.service.rpc("crm_claim_email_by_id", {
    p_outbox_id: input.outboxId,
    p_photographer_id: input.photographer.id,
    p_worker: input.workerId,
    p_allow_non_transactional: crmUnsubscribeConfigured(),
  });
  if (error) throw error;
  const claimed = Array.isArray(data) ? (data[0] as DatabaseRow | undefined) : undefined;
  if (!claimed) return selectOutbox(input.service, input.photographer.id, input.outboxId);
  return deliverClaimedCrmEmail({ ...input, row: claimed });
}

export async function bulkQueueCrmEmails(input: {
  service: SupabaseClient;
  photographer: CrmPhotographer;
  userId: string;
  contactIds: string[];
  templateId: string;
  requestKey: string;
  bookingCycleId?: string | null;
}) {
  const contactIds = [...new Set(input.contactIds)].slice(0, 100);
  if (!contactIds.length) throw new CrmEmailError("Choose at least one contact.");
  const template = await requireTemplate(input.service, input.photographer.id, input.templateId, true);
  if (template.message_class === "transactional") {
    throw new CrmEmailError(
      "Transactional templates cannot be used for bulk outreach.",
      409,
      "invalid_bulk_template",
    );
  }
  if (!crmUnsubscribeConfigured()) {
    throw new CrmEmailError(
      "Bulk sending is disabled until signed unsubscribe is configured.",
      503,
      "unsubscribe_not_configured",
    );
  }
  const emails: DatabaseRow[] = [];
  const skipped: Array<{ contactId: string; code: string }> = [];
  for (const contactId of contactIds) {
    try {
      const row = await queueTemplatedCrmEmail({
        service: input.service,
        photographer: input.photographer,
        userId: input.userId,
        contactId,
        bookingCycleId: input.bookingCycleId,
        templateId: template.id,
        requestKey: `bulk:${input.requestKey}:${contactId}`,
        deliveryMode: "manual",
        requireExplicitConsent: true,
      });
      emails.push(row);
    } catch (error) {
      if (error instanceof CrmEmailError) {
        skipped.push({ contactId, code: error.code });
        continue;
      }
      throw error;
    }
  }
  return { emails, skipped };
}

export async function loadCrmPhotographerById(
  service: SupabaseClient,
  photographerId: string,
) {
  const { data, error } = await service
    .from("photographers")
    .select("id,user_id,business_name,studio_email,studio_phone")
    .eq("id", photographerId)
    .maybeSingle();
  if (error) throw error;
  return (data as CrmPhotographer | null) ?? null;
}
