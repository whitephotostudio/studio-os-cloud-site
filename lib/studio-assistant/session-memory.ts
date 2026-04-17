// Studio Assistant — lightweight session memory (Phase 3).
//
// Lives in sessionStorage so it clears when the tab closes.  We intentionally
// only keep the bare minimum needed for follow-ups like:
//   "Set due date to June 1" → apply to last referenced school.

export type AssistantMemory = {
  lastSchoolId: string | null;
  lastSchoolName: string | null;
  updatedAt: number;
};

const KEY = "studio-assistant:memory:v1";

const EMPTY: AssistantMemory = {
  lastSchoolId: null,
  lastSchoolName: null,
  updatedAt: 0,
};

export function loadAssistantMemory(): AssistantMemory {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<AssistantMemory>;
    return { ...EMPTY, ...parsed };
  } catch {
    return EMPTY;
  }
}

export function saveAssistantMemory(next: AssistantMemory): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...next, updatedAt: Date.now() }),
    );
  } catch {
    /* session storage disabled — best effort */
  }
}

/**
 * Extract a school reference from an executor result so we can remember it.
 * Accepts shapes from create/update/release/toggle/assign/find intents.
 */
export function updateMemoryFromResult(
  prev: AssistantMemory,
  data: Record<string, unknown> | undefined | null,
): AssistantMemory {
  if (!data) return prev;
  const school = (data.school ?? data.destination_school) as
    | Record<string, unknown>
    | undefined;

  if (school && typeof school === "object") {
    const id = typeof school.id === "string" ? school.id : null;
    const name =
      typeof school.school_name === "string" ? school.school_name : null;
    if (id || name) {
      return {
        lastSchoolId: id ?? prev.lastSchoolId,
        lastSchoolName: name ?? prev.lastSchoolName,
        updatedAt: Date.now(),
      };
    }
  }

  // find_school returns results[] — pick the first if unambiguous.
  const results = data.results as unknown;
  if (Array.isArray(results) && results.length === 1) {
    const row = results[0] as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : null;
    const name =
      typeof row.school_name === "string"
        ? row.school_name
        : typeof row.name === "string"
          ? row.name
          : null;
    if (id || name) {
      return {
        lastSchoolId: id ?? prev.lastSchoolId,
        lastSchoolName: name ?? prev.lastSchoolName,
        updatedAt: Date.now(),
      };
    }
  }

  return prev;
}
