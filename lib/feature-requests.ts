import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Types ───────────────────────────────────────────────────────────

export type FeatureRequestStatus = "open" | "in_progress" | "done" | "declined";

export type FeatureRequestRow = {
  id: string;
  photographer_id: string;
  title: string;
  description: string;
  status: FeatureRequestStatus;
  vote_count: number;
  admin_note: string;
  created_at: string;
  updated_at: string;
};

export type FeatureRequestVoteRow = {
  id: string;
  feature_request_id: string;
  photographer_id: string;
  created_at: string;
};

export type FeatureRequestWithMeta = FeatureRequestRow & {
  author_email?: string;
  has_voted?: boolean;
};

// ─── Queries ─────────────────────────────────────────────────────────

/** Fetch all feature requests, ordered by votes then recency. */
export async function listFeatureRequests(
  client: SupabaseClient,
  opts?: { status?: FeatureRequestStatus },
) {
  let query = client
    .from("feature_requests")
    .select("*")
    .order("vote_count", { ascending: false })
    .order("created_at", { ascending: false });

  if (opts?.status) {
    query = query.eq("status", opts.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FeatureRequestRow[];
}

/** Fetch which requests a photographer has voted for. */
export async function listVotesByPhotographer(
  client: SupabaseClient,
  photographerId: string,
) {
  const { data, error } = await client
    .from("feature_request_votes")
    .select("feature_request_id")
    .eq("photographer_id", photographerId);

  if (error) throw error;
  return new Set((data ?? []).map((v) => v.feature_request_id));
}

// ─── Mutations ───────────────────────────────────────────────────────

/** Create a new feature request. */
export async function createFeatureRequest(
  client: SupabaseClient,
  photographerId: string,
  title: string,
  description: string,
) {
  const { data, error } = await client
    .from("feature_requests")
    .insert({ photographer_id: photographerId, title, description })
    .select()
    .single();

  if (error) throw error;
  return data as FeatureRequestRow;
}

/** Toggle vote on a feature request. Returns true if voted, false if unvoted. */
export async function toggleVote(
  client: SupabaseClient,
  featureRequestId: string,
  photographerId: string,
): Promise<boolean> {
  // Check if vote exists
  const { data: existing } = await client
    .from("feature_request_votes")
    .select("id")
    .eq("feature_request_id", featureRequestId)
    .eq("photographer_id", photographerId)
    .maybeSingle();

  if (existing) {
    // Remove vote
    await client
      .from("feature_request_votes")
      .delete()
      .eq("id", existing.id);

    // Decrement count
    await client.rpc("decrement_vote_count", { request_id: featureRequestId });
    return false;
  } else {
    // Add vote
    const { error } = await client
      .from("feature_request_votes")
      .insert({ feature_request_id: featureRequestId, photographer_id: photographerId });

    if (error) throw error;

    // Increment count
    await client.rpc("increment_vote_count", { request_id: featureRequestId });
    return true;
  }
}

/** Admin: update status and/or admin note. */
export async function updateFeatureRequestStatus(
  service: SupabaseClient,
  requestId: string,
  status: FeatureRequestStatus,
  adminNote?: string,
) {
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (adminNote !== undefined) {
    updates.admin_note = adminNote;
  }

  const { data, error } = await service
    .from("feature_requests")
    .update(updates)
    .eq("id", requestId)
    .select()
    .single();

  if (error) throw error;
  return data as FeatureRequestRow;
}
