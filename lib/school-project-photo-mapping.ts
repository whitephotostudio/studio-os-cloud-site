import type { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  schoolPhotoFamilyForKey,
  schoolPhotoReferenceMatchesFamily,
  storageKeyFromSchoolPhotoReference,
} from "@/lib/school-photo-deletions";
import {
  projectAlbumReferenceParts,
  projectAlbumSchoolPhotoReference,
  selectResolvedOwnedProjectSchool,
  type LinkedSchoolProjectIdentity,
  type OwnedLinkedSchoolIdentity,
} from "@/lib/school-project-photo-mapping-core";

type DashboardServiceClient = ReturnType<typeof createDashboardServiceClient>;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

/**
 * Resolve a project link only after checking the school belongs to the same
 * photographer. Legacy local ids are supported, but duplicates, stale links,
 * and conflicting cloud/local links deliberately resolve to null.
 */
export async function resolveOwnedProjectLinkedSchool(params: {
  service: DashboardServiceClient;
  project: LinkedSchoolProjectIdentity;
  photographerId: string;
}) {
  const photographerId = clean(params.photographerId);
  const workflowType = clean(params.project.workflow_type).toLowerCase();
  const linkedSchoolId = clean(params.project.linked_school_id);
  const linkedLocalSchoolId = clean(params.project.linked_local_school_id);
  if (workflowType !== "school") {
    return { status: "unlinked", school: null } as const;
  }
  if (!photographerId || (!linkedSchoolId && !linkedLocalSchoolId)) {
    return { status: "invalid", school: null } as const;
  }

  const candidates: OwnedLinkedSchoolIdentity[] = [];
  if (linkedSchoolId) {
    const { data, error } = await params.service
      .from("schools")
      .select("id,local_school_id,photographer_id")
      .eq("photographer_id", photographerId)
      .eq("id", linkedSchoolId)
      .limit(2);
    if (error) throw error;
    candidates.push(...((data ?? []) as OwnedLinkedSchoolIdentity[]));
  }

  if (linkedLocalSchoolId) {
    const { data, error } = await params.service
      .from("schools")
      .select("id,local_school_id,photographer_id")
      .eq("photographer_id", photographerId)
      .eq("local_school_id", linkedLocalSchoolId)
      .limit(2);
    if (error) throw error;
    candidates.push(...((data ?? []) as OwnedLinkedSchoolIdentity[]));
  }

  const school = selectResolvedOwnedProjectSchool(
    params.project,
    Array.from(new Map(candidates.map((candidate) => [candidate.id, candidate])).values()),
    photographerId,
  );
  return school
    ? ({ status: "resolved", school } as const)
    : ({ status: "invalid", school: null } as const);
}

/**
 * Match either a direct school object or an exact desktop project copy. No
 * basename/suffix fallback is allowed: project copies require the expected
 * project, collection, nonblank collection title, and student subfolder.
 */
export function projectMediaReferenceMatchesSchoolPhotoFamily(params: {
  reference: string | null | undefined;
  families: ReadonlySet<string>;
  projectId: string;
  collectionId: string;
  collectionTitle: string | null | undefined;
}) {
  if (schoolPhotoReferenceMatchesFamily(params.reference, params.families)) {
    return true;
  }

  const storageKey = storageKeyFromSchoolPhotoReference(params.reference);
  const schoolReference = projectAlbumSchoolPhotoReference({
    storageKey,
    projectId: params.projectId,
    collectionId: params.collectionId,
    collectionTitle: params.collectionTitle,
  });
  if (!schoolReference) return false;

  const family = schoolPhotoFamilyForKey(`project-copy/${schoolReference}`);
  return !!family && params.families.has(family);
}

export function projectPhotoCollectionId(
  reference: string | null | undefined,
  expectedProjectId: string,
) {
  const key = storageKeyFromSchoolPhotoReference(reference);
  const parts = projectAlbumReferenceParts(key);
  return parts?.projectId === clean(expectedProjectId) ? parts.collectionId : "";
}
