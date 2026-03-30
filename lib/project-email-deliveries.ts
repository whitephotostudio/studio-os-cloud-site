import type { SupabaseClient } from "@supabase/supabase-js";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export type ProjectEmailDeliveryRecord = {
  projectId?: string | null;
  orderId?: string | null;
  photographerId?: string | null;
  recipientEmail: string;
  emailType: string;
  dedupeKey?: string | null;
  resendEmailId?: string | null;
  subject?: string | null;
  status?: string | null;
  payload?: Record<string, unknown> | null;
  errorMessage?: string | null;
};

export async function hasProjectEmailDelivery(
  service: SupabaseClient,
  dedupeKey: string,
) {
  const key = clean(dedupeKey);
  if (!key) return false;
  const { data, error } = await service
    .from("project_email_deliveries")
    .select("id")
    .eq("dedupe_key", key)
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return !!data;
}

export async function recordProjectEmailDelivery(
  service: SupabaseClient,
  record: ProjectEmailDeliveryRecord,
) {
  const dedupeKey = clean(record.dedupeKey);
  const payload = {
    project_id: clean(record.projectId) || null,
    order_id: clean(record.orderId) || null,
    photographer_id: clean(record.photographerId) || null,
    recipient_email: clean(record.recipientEmail).toLowerCase(),
    email_type: clean(record.emailType),
    dedupe_key: dedupeKey || null,
    resend_email_id: clean(record.resendEmailId) || null,
    subject: clean(record.subject) || null,
    status: clean(record.status) || "sent",
    payload: record.payload ?? {},
    error_message: clean(record.errorMessage) || null,
  };

  if (dedupeKey) {
    const { data: existing, error: existingError } = await service
      .from("project_email_deliveries")
      .select("id")
      .eq("dedupe_key", dedupeKey)
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing?.id) {
      const { error: updateError } = await service
        .from("project_email_deliveries")
        .update({
          ...payload,
          sent_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) throw updateError;
      return;
    }
  }

  const { error } = await service.from("project_email_deliveries").insert(payload);
  if (error) throw error;
}
