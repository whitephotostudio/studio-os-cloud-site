// Server-side gate: "has the current user accepted the CURRENT agreement?"
//
// Used in two places:
//   1. /api/dashboard/agreement/status — tells the client whether to show
//      the blocking modal.
//   2. Protected write endpoints (upload, schools mutate, etc.) — refuses
//      to do work on behalf of a photographer who hasn't accepted. This
//      stops an attacker from skipping the modal by poking the API
//      directly with their session token.
//
// The check is deliberately CURRENT_AGREEMENT_VERSION-scoped. Old
// acceptance rows from prior versions don't count — bumping the version
// string in lib/agreement.ts forces every photographer to re-accept.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CURRENT_AGREEMENT_VERSION } from "./agreement";

type HasAcceptedArgs = {
  /** Service-role Supabase client. Bypasses RLS. */
  service: SupabaseClient;
  /** The authenticated user's id (auth.users.id). */
  userId: string;
};

export async function hasAcceptedCurrentAgreement({
  service,
  userId,
}: HasAcceptedArgs): Promise<boolean> {
  const { data, error } = await service
    .from("photographer_agreements")
    .select("id")
    .eq("user_id", userId)
    .eq("agreement_version", CURRENT_AGREEMENT_VERSION)
    .limit(1)
    .maybeSingle();

  if (error) {
    // Be conservative: if we can't tell, treat as not-accepted so the
    // modal appears. That's safer than letting a potential non-acceptor
    // slip through during a transient DB hiccup.
    return false;
  }
  return Boolean(data?.id);
}

export type AgreementGuardResult =
  | { ok: true }
  | { ok: false; status: number; body: { error: string; code: string } };

/**
 * Convenience wrapper for API routes: returns `{ ok: true }` if the user
 * has accepted the current agreement, or a NextResponse-shaped failure if
 * they haven't. Routes can just `if (!check.ok) return NextResponse.json(check.body, { status: check.status });`.
 */
export async function guardAgreement(args: HasAcceptedArgs): Promise<AgreementGuardResult> {
  const accepted = await hasAcceptedCurrentAgreement(args);
  if (accepted) return { ok: true };
  return {
    ok: false,
    status: 403,
    body: {
      error:
        "You must accept the Studio OS Cloud Agreement before using this feature.",
      code: "agreement_required",
    },
  };
}
