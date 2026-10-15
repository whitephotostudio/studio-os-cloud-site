import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ResendRequestError, sendResendEmailBatch, type SendResendEmailInput } from "@/lib/resend";

export const SCHOOL_VISITOR_EMAIL_BATCH_SIZE = 100;
// Leave a margin before Resend expires its idempotency keys after 24 hours.
const CONFIRMATION_WINDOW_MS = 23 * 60 * 60 * 1000;

export type SchoolVisitorEmailOutcome = {
  recipientEmail: string;
  status: "sent" | "failed" | "pending" | "excluded";
  providerId?: string;
  error?: string;
};
export type SchoolVisitorEmailBatchResult = {
  ok: true; total: number; offset: number; sent: number; failed: number; pending: number; excluded: number;
  outcomes: SchoolVisitorEmailOutcome[]; paused: boolean; nextOffset: number | null;
  retryAllowed?: boolean; retryAfterMs?: number; providerErrorCode?: string | null; message?: string;
};

export class SchoolVisitorEmailConflict extends Error {}

type Checkpoint = { status: string; created_at: string; payload: Record<string, unknown>; firstReservation?: boolean };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const recipientSchema = z.string().email().max(320);
const campaignKey = (photographerId: string, schoolId: string, requestId: string, namespace = "school-visitor-campaign") =>
  `${namespace}:${hash([photographerId, schoolId, requestId])}`;

/** Read-only recovery is independent of today's order/filter eligibility.
 * A changed audience must not turn a lost successful response into a resend. */
export async function schoolVisitorEmailCampaignStatus(service: SupabaseClient, input: {
  photographerId: string; schoolId: string; requestId: string;
}) {
  const key = campaignKey(input.photographerId, input.schoolId, input.requestId);
  const outcomes: SchoolVisitorEmailOutcome[] = [];
  const uncertainBatches: { offset: number; recipientEmails: string[] }[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await service.from("project_email_deliveries")
      .select("status,payload").eq("photographer_id", input.photographerId)
      .eq("email_type", "school_visitor_batch").like("dedupe_key", `${key}:%`)
      .order("dedupe_key").range(offset, offset + 499);
    if (error) throw error;
    for (const row of data ?? []) {
      const payload = row.payload as Record<string, unknown>;
      if ((row.status === "completed" || row.status === "sent") && Array.isArray(payload.outcomes)) {
        outcomes.push(...payload.outcomes as SchoolVisitorEmailOutcome[]);
      } else uncertainBatches.push({ offset: Number(payload.offset) || 0,
        recipientEmails: Array.isArray(payload.selectedRecipients) ? payload.selectedRecipients as string[] : [] });
    }
    if ((data ?? []).length < 500) break;
  }
  return { outcomes, uncertainBatches, canReviewRemaining: uncertainBatches.length === 0 };
}

async function reserveCheckpoint(service: SupabaseClient, input: {
  photographerId: string; recipientEmail: string; key: string; type: string;
  subject: string; payload: Record<string, unknown>;
}): Promise<Checkpoint> {
  const read = () => service.from("project_email_deliveries")
    .select("status,created_at,payload").eq("dedupe_key", input.key)
    .eq("photographer_id", input.photographerId).maybeSingle<Checkpoint>();
  const existing = await read();
  if (existing.error) throw existing.error;
  if (existing.data) return { ...existing.data, firstReservation: false };
  // A unique ledger key chooses one immutable payload even when two retries
  // race. Do not use a check-then-insert or overwrite the first timestamp.
  const { data: inserted, error } = await service.from("project_email_deliveries").upsert({
    photographer_id: input.photographerId,
    recipient_email: input.recipientEmail,
    email_type: input.type,
    dedupe_key: input.key,
    subject: input.subject,
    status: "pending",
    payload: input.payload,
  }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("dedupe_key").maybeSingle();
  if (error) throw error;
  const reserved = await read();
  if (reserved.error) throw reserved.error;
  if (!reserved.data) throw new Error("Could not save the email batch before sending. Please try again.");
  return { ...reserved.data, firstReservation: !!inserted };
}

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function sendWithRetry(inputs: SendResendEmailInput[], key: string, maxAttempts = 3): Promise<
  { ok: true; results: { id: string }[] } | { ok: false; error: unknown; uncertain: boolean }
> {
  let uncertain = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { ok: true, results: await sendResendEmailBatch(inputs, { idempotencyKey: key, timeoutMs: 10_000 }) };
    } catch (error) {
      const provider = error instanceof ResendRequestError ? error : null;
      const quota = provider?.code === "daily_quota_exceeded" || provider?.code === "monthly_quota_exceeded";
      uncertain ||= !provider || provider.status >= 500 || provider.status === 408 || provider.status === 409;
      const retryable = !provider || provider.status === 429 || provider.status >= 500 || provider.code === "concurrent_idempotent_requests";
      const delay = Math.max(1000 * 2 ** attempt, provider?.retryAfterMs ?? 0);
      // Long waits belong in the browser continuation, keeping this function
      // within its serverless execution budget. Never shorten Retry-After.
      if (!retryable || quota || attempt >= maxAttempts - 1 || delay > 5000) return { ok: false, error, uncertain };
      await wait(delay);
    }
  }
}

/** One bounded, resumable provider request. There is no campaign-size cap:
 * the browser continues through deterministic slices of the reviewed list. */
export async function sendSchoolVisitorEmailBatch(service: SupabaseClient, input: {
  photographerId: string;
  schoolId: string;
  requestId: string;
  audienceFingerprint: string;
  recipients: string[];
  offset: number;
  subject: string;
  headline: string;
  message: string;
  email: Omit<SendResendEmailInput, "to" | "idempotencyKey">;
  namespace?: "school-visitor-campaign" | "school-deadline-campaign";
  emailType?: string;
  excludedRecipients?: string[];
  maxAttempts?: 1 | 3;
}): Promise<SchoolVisitorEmailBatchResult> {
  const { recipients, offset } = input;
  if (offset % SCHOOL_VISITOR_EMAIL_BATCH_SIZE || offset < 0 || offset >= recipients.length) {
    throw new SchoolVisitorEmailConflict("The email batch position is invalid. Review the recipients again.");
  }
  const key = campaignKey(input.photographerId, input.schoolId, input.requestId, input.namespace);
  const signature = hash([input.audienceFingerprint, input.subject, input.headline, input.message]);
  const campaign = await reserveCheckpoint(service, {
    photographerId: input.photographerId, recipientEmail: recipients[0], key,
    type: "school_visitor_campaign", subject: input.subject,
    payload: { signature, audienceSchoolId: input.schoolId, requestId: input.requestId },
  });
  if (campaign.payload.signature !== signature) {
    throw new SchoolVisitorEmailConflict("This email attempt has different recipients or text. Review it as a new batch before sending.");
  }
  const selected = recipients.slice(offset, offset + SCHOOL_VISITOR_EMAIL_BATCH_SIZE);
  const excludedEmails = new Set(input.excludedRecipients ?? []);
  const validSelected = selected.filter(recipientEmail => !excludedEmails.has(recipientEmail) && recipientSchema.safeParse(recipientEmail).success);
  const invalid = new Map(selected.filter(recipientEmail => !excludedEmails.has(recipientEmail) && !recipientSchema.safeParse(recipientEmail).success)
    .map(recipientEmail => [recipientEmail, { recipientEmail, status: "failed" as const,
      error: "This saved email address is invalid. Correct it in the visitor report before sending." }]));
  const excluded = new Map(selected.filter(recipientEmail => excludedEmails.has(recipientEmail))
    .map(recipientEmail => [recipientEmail, { recipientEmail, status: "excluded" as const, error: "This contact no longer qualifies for the reminder." }]));
  const omitted = new Map<string, SchoolVisitorEmailOutcome>([...invalid, ...excluded]);
  const batchKey = `${key}:${offset}`;
  const checkpoint = await reserveCheckpoint(service, {
    photographerId: input.photographerId, recipientEmail: selected[0], key: batchKey,
    type: "school_visitor_batch", subject: input.subject,
    payload: {
      signature, audienceSchoolId: input.schoolId, requestId: input.requestId, offset,
      selectedRecipients: selected,
      // Store the exact provider body. Signed branding URLs must not change
      // between idempotent retries after a browser refresh or lost response.
      inputs: validSelected.map(to => ({ ...input.email, to })),
    },
  });
  const savedInputs = checkpoint.payload.inputs as SendResendEmailInput[] | undefined;
  const savedSelected = checkpoint.payload.selectedRecipients as string[] | undefined;
  if (checkpoint.payload.signature !== signature || !Array.isArray(savedInputs) ||
      !Array.isArray(savedSelected) || savedSelected.length !== selected.length || savedSelected.some((email, index) => email !== selected[index])) {
    throw new SchoolVisitorEmailConflict("The saved email batch could not be verified. Review the recipients again.");
  }
  const success = (outcomes: SchoolVisitorEmailOutcome[]): SchoolVisitorEmailBatchResult => ({
    ok: true, total: recipients.length, offset, sent: outcomes.filter(row => row.status === "sent").length,
    failed: outcomes.filter(row => row.status === "failed").length, pending: 0,
    excluded: outcomes.filter(row => row.status === "excluded").length,
    outcomes, paused: false, nextOffset: offset + selected.length < recipients.length ? offset + selected.length : null,
  });
  const persistHistory = async (outcomes: SchoolVisitorEmailOutcome[]) => {
    // Recipient-level history can be repaired from the durable batch results
    // on a replay, without making another request to the email provider.
    // Exclusions belong to the batch/run audit, never sent-email history:
    // they did not attempt delivery and must not displace actual deliveries.
    const deliveries = outcomes.filter(row => row.status !== "excluded");
    if (!deliveries.length) return;
    try {
      const { error } = await service.from("project_email_deliveries").upsert(deliveries.map(row => ({
        photographer_id: input.photographerId, recipient_email: row.recipientEmail,
        email_type: input.emailType ?? "mass-promo", dedupe_key: `${batchKey}:${hash(row.recipientEmail)}`,
        resend_email_id: row.providerId ?? null, subject: input.subject, status: row.status, error_message: row.error ?? null,
        payload: { schoolId: input.schoolId, requestId: input.requestId, action: "visitor_campaign" },
      })), { onConflict: "dedupe_key" });
      if (error) console.error("[school-visitors:batch:record-history]", error);
    } catch (error) {
      console.error("[school-visitors:batch:record-history]", error);
    }
  };
  if (checkpoint.status === "sent" || checkpoint.status === "completed") {
    const outcomes = checkpoint.payload.outcomes as SchoolVisitorEmailOutcome[] | undefined;
    if (!Array.isArray(outcomes) || outcomes.length !== selected.length || outcomes.some((row, index) =>
      row.recipientEmail !== selected[index] || (row.status === "sent" ? !row.providerId : !["failed", "excluded"].includes(row.status)))) {
      throw new SchoolVisitorEmailConflict("The saved email results need review before this batch can continue.");
    }
    await persistHistory(outcomes);
    return success(outcomes);
  }
  if (savedInputs.length !== validSelected.length || savedInputs.some((email, index) => email.to !== validSelected[index])) {
    throw new SchoolVisitorEmailConflict("An unconfirmed reminder batch has changed recipients. Check provider records before retrying.");
  }
  const reservedAt = Date.parse(checkpoint.created_at);
  if (validSelected.length && (!Number.isFinite(reservedAt) || Date.now() - reservedAt >= CONFIRMATION_WINDOW_MS)) {
    return {
      ok: true, total: recipients.length, offset, sent: 0, failed: invalid.size, pending: validSelected.length,
      excluded: excluded.size,
      outcomes: selected.map(recipientEmail => omitted.get(recipientEmail) ?? ({ recipientEmail, status: "pending" as const,
        error: "This earlier attempt must be checked with the email provider before retrying." })),
      paused: true, nextOffset: offset, retryAllowed: false,
      message: "An earlier batch has an unconfirmed outcome outside the safe retry window. Check provider delivery records before starting another send.",
    };
  }
  const attempt = savedInputs.length ? await sendWithRetry(savedInputs, batchKey, input.maxAttempts) : { ok: true as const, results: [] };
  if (!attempt.ok) {
    const { error, uncertain } = attempt;
    const provider = error instanceof ResendRequestError ? error : null;
    // A previous invocation or simultaneous duplicate may have reached the
    // provider. A later 4xx only rejects that attempt; it cannot prove that
    // the earlier batch was never accepted.
    const definitiveRejection = checkpoint.firstReservation && !uncertain && !!provider && provider.status >= 400 && provider.status < 500 && provider.status !== 408 && provider.status !== 409;
    const message = error instanceof Error ? error.message : "The email provider could not confirm this batch.";
    const status = definitiveRejection ? "failed" as const : "pending" as const;
    return {
      ok: true, total: recipients.length, offset, sent: 0,
      failed: definitiveRejection ? validSelected.length + invalid.size : invalid.size, pending: definitiveRejection ? 0 : validSelected.length,
      excluded: excluded.size,
      outcomes: selected.map(recipientEmail => omitted.get(recipientEmail) ?? ({ recipientEmail, status, error: message })),
      paused: true, nextOffset: offset, retryAllowed: provider?.code !== "invalid_idempotent_request",
      retryAfterMs: Math.max(1000, provider?.retryAfterMs ?? 1000),
      providerErrorCode: provider?.code ?? null, message,
    };
  }
  const accepted = new Map(attempt.results.map((result, index) => [validSelected[index], { recipientEmail: validSelected[index], status: "sent" as const, providerId: result.id }]));
  const outcomes: SchoolVisitorEmailOutcome[] = selected.map(recipientEmail => omitted.get(recipientEmail) ?? accepted.get(recipientEmail)!);
  let checkpointSaved = false;
  try {
    const { data, error } = await service.from("project_email_deliveries").update({
      status: "completed", payload: { ...checkpoint.payload, outcomes }, sent_at: new Date().toISOString(),
    }).eq("dedupe_key", batchKey).eq("photographer_id", input.photographerId).select("dedupe_key").maybeSingle();
    checkpointSaved = !error && !!data;
    if (error) console.error("[school-visitors:batch:record-accepted]", error);
  } catch (error) {
    console.error("[school-visitors:batch:record-accepted]", error);
  }
  await persistHistory(outcomes);
  if (!checkpointSaved) return {
    ...success(outcomes), paused: true, nextOffset: offset, retryAllowed: true, retryAfterMs: 1000,
    message: "The provider accepted this batch, but progress could not be saved. Retry this same batch to confirm progress before continuing.",
  };
  return success(outcomes);
}
