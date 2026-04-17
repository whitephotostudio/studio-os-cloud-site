import { createDashboardServiceClient } from "@/lib/dashboard-auth";

export type EventGalleryProjectAccessRow = {
  id: string;
  title: string | null;
  workflow_type: string | null;
  status: string | null;
  email_required: boolean | null;
  access_mode: string | null;
  access_pin: string | null;
  gallery_settings: unknown;
  photographer_id: string | null;
};

type EventGalleryCollectionAccessRow = {
  id: string;
  slug: string | null;
  access_mode: string | null;
  access_pin: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizedAccessMode(value: string | null | undefined) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "public";
  if (raw === "pin" || raw === "protected" || raw === "private") return "pin";
  if (raw === "inherit" || raw === "inherit_project" || raw === "project") {
    return "inherit_project";
  }
  return raw;
}

function isInactive(value: string | null | undefined) {
  return clean(value).toLowerCase() === "inactive";
}

function isEventProject(row: Pick<EventGalleryProjectAccessRow, "workflow_type">) {
  return clean(row.workflow_type).toLowerCase() === "event";
}

function matchesProjectPin(
  row: Pick<EventGalleryProjectAccessRow, "access_mode" | "access_pin">,
  pin: string,
) {
  return normalizedAccessMode(row.access_mode) === "pin" && clean(row.access_pin) === pin;
}

function matchesCollectionPin(row: EventGalleryCollectionAccessRow, pin: string) {
  return (
    clean(row.slug) === pin ||
    (normalizedAccessMode(row.access_mode) === "pin" && clean(row.access_pin) === pin)
  );
}

export async function validateEventGalleryAccess(params: {
  projectId: string;
  email: string;
  pin: string;
}) {
  const service = createDashboardServiceClient();
  const selectedProjectId = clean(params.projectId);
  const normalizedEmail = clean(params.email).toLowerCase();
  const pinValue = clean(params.pin);

  const { data: projectRow, error: projectError } = await service
    .from("projects")
    .select(
      "id,title,workflow_type,status,email_required,access_mode,access_pin,gallery_settings,photographer_id",
    )
    .eq("id", selectedProjectId)
    .maybeSingle<EventGalleryProjectAccessRow>();

  if (projectError) throw projectError;
  if (!projectRow || !isEventProject(projectRow) || isInactive(projectRow.status)) {
    return { ok: false as const, status: 404, message: "Event gallery not found." };
  }

  const { data: whitelistRows, error: whitelistError } = await service
    .from("pre_release_emails")
    .select("id")
    .eq("project_id", selectedProjectId)
    .eq("email", normalizedEmail)
    .limit(1);

  if (whitelistError) throw whitelistError;

  const emailRequired = projectRow.email_required !== false;
  if (emailRequired && (whitelistRows?.length ?? 0) === 0) {
    const { data: anyWhitelist, error: anyWhitelistError } = await service
      .from("pre_release_emails")
      .select("id")
      .eq("project_id", selectedProjectId)
      .limit(1);

    if (anyWhitelistError) throw anyWhitelistError;

    if ((anyWhitelist?.length ?? 0) > 0) {
      return {
        ok: false as const,
        status: 403,
        message: "That email is not approved for this event gallery.",
      };
    }
  }

  const [matchingSubjectResult, collectionAccessResult] = await Promise.all([
    service
      .from("subjects")
      .select("id")
      .eq("project_id", selectedProjectId)
      .eq("external_ref", pinValue)
      .limit(1)
      .maybeSingle(),
    service
      .from("collections")
      .select("id,slug,access_mode,access_pin")
      .eq("project_id", selectedProjectId),
  ]);

  if (matchingSubjectResult.error) throw matchingSubjectResult.error;
  if (collectionAccessResult.error) throw collectionAccessResult.error;

  const matchingCollection = (
    (collectionAccessResult.data ?? []) as EventGalleryCollectionAccessRow[]
  ).find((row) => matchesCollectionPin(row, pinValue));
  const projectPinMatch = matchesProjectPin(projectRow, pinValue);

  if (!projectPinMatch && !matchingSubjectResult.data && !matchingCollection) {
    return {
      ok: false as const,
      status: 404,
      message: "No event gallery was found for that email and PIN.",
    };
  }

  return {
    ok: true as const,
    service,
    project: projectRow,
    projectId: selectedProjectId,
    email: normalizedEmail,
  };
}
