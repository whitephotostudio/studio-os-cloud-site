export type SchoolProjectIdentityCandidate = {
  id?: string | null;
  linked_school_id?: string | null;
  linked_local_school_id?: string | null;
};

function normalizeLink(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Rank a school project only by its explicit cloud/local identities.
 *
 * A historical row can contain one correct link and one stale link after two
 * similarly named campuses were merged by an older title matcher. Any
 * explicit conflict therefore disqualifies the entire row; it must never be
 * borrowed by the other campus just because one identifier happens to match.
 */
export function schoolProjectIdentityPriority(
  candidate: SchoolProjectIdentityCandidate,
  expected: {
    schoolId: string;
    localSchoolId?: string | null;
  },
) {
  const candidateSchoolId = normalizeLink(candidate.linked_school_id);
  const candidateLocalSchoolId = normalizeLink(candidate.linked_local_school_id);
  const expectedSchoolId = normalizeLink(expected.schoolId);
  const expectedLocalSchoolId = normalizeLink(expected.localSchoolId);

  if (
    candidateSchoolId &&
    (!expectedSchoolId || candidateSchoolId !== expectedSchoolId)
  ) {
    return 0;
  }
  if (
    candidateLocalSchoolId &&
    (!expectedLocalSchoolId || candidateLocalSchoolId !== expectedLocalSchoolId)
  ) {
    return 0;
  }

  if (candidateLocalSchoolId && expectedLocalSchoolId) return 3;
  if (candidateSchoolId && expectedSchoolId) return 2;
  return 0;
}

/** Pick the strongest compatible row while preserving query order on ties. */
export function selectSyncedSchoolProjectCandidate(
  candidates: SchoolProjectIdentityCandidate[],
  expected: {
    schoolId: string;
    localSchoolId?: string | null;
  },
) {
  let best: SchoolProjectIdentityCandidate | null = null;
  let bestPriority = 0;

  for (const candidate of candidates) {
    const priority = schoolProjectIdentityPriority(candidate, expected);
    if (priority > bestPriority) {
      best = candidate;
      bestPriority = priority;
    }
  }

  return best;
}
