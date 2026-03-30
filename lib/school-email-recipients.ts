import type { SupabaseClient } from "@supabase/supabase-js";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function looksLikeEmail(value: string | null | undefined) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

export async function collectSchoolRecipientEmails(
  service: SupabaseClient,
  schoolId: string,
) {
  const [visitorsResult, prereleaseResult, ordersResult] = await Promise.all([
    service
      .from("school_gallery_visitors")
      .select("viewer_email")
      .eq("school_id", schoolId),
    service
      .from("pre_release_registrations")
      .select("email")
      .eq("school_id", schoolId),
    service
      .from("orders")
      .select("parent_email,customer_email")
      .eq("school_id", schoolId),
  ]);

  if (visitorsResult.error && visitorsResult.error.code !== "42P01") {
    throw visitorsResult.error;
  }
  if (prereleaseResult.error) throw prereleaseResult.error;
  if (ordersResult.error) throw ordersResult.error;

  return Array.from(
    new Set(
      [
        ...(visitorsResult.data ?? []).map((row) =>
          clean((row as { viewer_email?: string | null }).viewer_email).toLowerCase(),
        ),
        ...(prereleaseResult.data ?? []).map((row) =>
          clean((row as { email?: string | null }).email).toLowerCase(),
        ),
        ...(ordersResult.data ?? []).flatMap((row) => [
          clean((row as { parent_email?: string | null }).parent_email).toLowerCase(),
          clean((row as { customer_email?: string | null }).customer_email).toLowerCase(),
        ]),
      ].filter(looksLikeEmail),
    ),
  );
}
