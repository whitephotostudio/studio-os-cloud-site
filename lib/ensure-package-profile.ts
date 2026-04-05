import type { SupabaseClient } from "@supabase/supabase-js";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

type EnsurePackageProfileParams = {
  service: SupabaseClient;
  photographerId: string;
  packageProfileId?: string | null;
};

export async function ensurePackageProfile({
  service,
  photographerId,
  packageProfileId,
}: EnsurePackageProfileParams) {
  const profileId = clean(packageProfileId);
  const ownerId = clean(photographerId);

  if (!profileId || !ownerId) return null;

  // If profileId isn't a valid UUID, skip DB lookups that would fail with 22P02
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(profileId)) return null;

  const { data: existingProfile, error: existingProfileError } = await service
    .from("package_profiles")
    .select("id")
    .eq("id", profileId)
    .eq("photographer_id", ownerId)
    .maybeSingle();

  if (existingProfileError) throw existingProfileError;
  if (existingProfile?.id) return existingProfile.id;

  const { data: packageRow, error: packageRowError } = await service
    .from("packages")
    .select("profile_name")
    .eq("photographer_id", ownerId)
    .eq("profile_id", profileId)
    .limit(1)
    .maybeSingle<{ profile_name?: string | null }>();

  if (packageRowError) throw packageRowError;
  if (!packageRow) return null;

  const profileName = clean(packageRow.profile_name) || profileId;

  const { data: insertedProfile, error: insertedProfileError } = await service
    .from("package_profiles")
    .upsert(
      {
        id: profileId,
        name: profileName,
        photographer_id: ownerId,
      },
      { onConflict: "id" },
    )
    .select("id")
    .maybeSingle();

  if (insertedProfileError) throw insertedProfileError;

  return insertedProfile?.id ?? profileId;
}
