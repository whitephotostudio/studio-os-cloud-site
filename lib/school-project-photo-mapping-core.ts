export type LinkedSchoolProjectIdentity = {
  id?: string | null;
  workflow_type?: string | null;
  linked_school_id?: string | null;
  linked_local_school_id?: string | null;
};

export type OwnedLinkedSchoolIdentity = {
  id: string;
  local_school_id?: string | null;
  photographer_id?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

/**
 * Resolve already-loaded school candidates against both explicit project
 * links. Every supplied link must identify exactly one owned school, and two
 * supplied links must resolve to the same row. That makes stale cross-campus
 * links and duplicate legacy local ids fail closed.
 */
export function selectResolvedOwnedProjectSchool(
  project: LinkedSchoolProjectIdentity,
  candidates: OwnedLinkedSchoolIdentity[],
  photographerId: string,
) {
  const ownerId = clean(photographerId);
  const workflowType = clean(project.workflow_type).toLowerCase();
  const linkedSchoolId = clean(project.linked_school_id);
  const linkedLocalSchoolId = clean(project.linked_local_school_id);
  if (
    workflowType !== "school" ||
    !ownerId ||
    (!linkedSchoolId && !linkedLocalSchoolId)
  ) {
    return null;
  }

  const ownedCandidates = candidates.filter(
    (candidate) => clean(candidate.photographer_id) === ownerId,
  );
  const cloudMatches = linkedSchoolId
    ? ownedCandidates.filter((candidate) => clean(candidate.id) === linkedSchoolId)
    : [];
  const localMatches = linkedLocalSchoolId
    ? ownedCandidates.filter(
        (candidate) =>
          clean(candidate.local_school_id) === linkedLocalSchoolId,
      )
    : [];

  if (linkedSchoolId && cloudMatches.length !== 1) return null;
  if (linkedLocalSchoolId && localMatches.length !== 1) return null;

  const cloudSchool = cloudMatches[0] ?? null;
  const localSchool = localMatches[0] ?? null;
  if (cloudSchool && localSchool && cloudSchool.id !== localSchool.id) return null;
  return cloudSchool ?? localSchool;
}

export type ProjectAlbumReferenceParts = {
  projectId: string;
  collectionId: string;
  relativePath: string;
};

/** Parse only the canonical project-album object layout. */
export function projectAlbumReferenceParts(storageKey: string | null | undefined) {
  const key = clean(storageKey);
  const match = key.match(/^projects\/([^/]+)\/albums\/([^/]+)\/(.+)$/);
  if (!match) return null;

  return {
    projectId: match[1],
    collectionId: match[2],
    relativePath: match[3],
  } satisfies ProjectAlbumReferenceParts;
}

/**
 * Deterministically map a desktop-created project copy back to its school
 * location. A collection title supplies the school class folder and the
 * relative path must still contain a student-folder separator. A flat/manual
 * project filename has no deterministic school origin and is preserved.
 */
export function projectAlbumSchoolPhotoReference(params: {
  storageKey: string | null | undefined;
  projectId: string;
  collectionId: string;
  collectionTitle: string | null | undefined;
}) {
  const parts = projectAlbumReferenceParts(params.storageKey);
  const projectId = clean(params.projectId);
  const collectionId = clean(params.collectionId);
  const collectionTitle = clean(params.collectionTitle);
  if (
    !parts ||
    !projectId ||
    !collectionId ||
    !collectionTitle ||
    parts.projectId !== projectId ||
    parts.collectionId !== collectionId
  ) {
    return null;
  }

  const studentFolderSeparator = parts.relativePath.indexOf("/");
  if (
    studentFolderSeparator <= 0 ||
    studentFolderSeparator === parts.relativePath.length - 1
  ) {
    return null;
  }

  return `${collectionTitle}/${parts.relativePath}`;
}
