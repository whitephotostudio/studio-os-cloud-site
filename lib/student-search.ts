const DEFAULT_STUDENT_SEARCH_FIELDS = [
  "first_name",
  "last_name",
  "class_name",
  "role",
] as const;

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Each word must match, but names can be entered in either order. */
export function studentSearchTokens(term: string): string[] {
  const value = normalized(term);
  return value ? value.split(" ") : [];
}

function quotedLikePattern(token: string): string {
  // Escape LIKE metacharacters first, then quote the resulting pattern for
  // PostgREST's filter grammar. Commas and parentheses remain literal inside
  // the quoted value, including when a name contains a double quote.
  const likePattern = `%${token.replace(/[\\%_]/g, "\\$&")}%`;
  return `"${likePattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Pass the returned expression to one Supabase .or() call. */
export function studentSearchFilter(
  term: string,
  fields: readonly string[] = DEFAULT_STUDENT_SEARCH_FIELDS,
): string | null {
  const tokens = studentSearchTokens(term);
  if (!tokens.length || !fields.length) return null;
  if (fields.some((field) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field))) {
    throw new Error("Invalid student search field.");
  }
  return `and(${tokens
    .map((token) => {
      const pattern = quotedLikePattern(token);
      return `or(${fields.map((field) => `${field}.ilike.${pattern}`).join(",")})`;
    })
    .join(",")})`;
}

export function studentMatchesSearch(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  term: string,
): boolean {
  const name = normalized([firstName, lastName].filter(Boolean).join(" "));
  return studentSearchTokens(term).every((token) => name.includes(token));
}

/** Lower scores sort first: exact full name, exact words, prefixes, substrings.
 *  A row matched only by class or role receives the final score (4). */
export function studentSearchRank(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  term: string,
): number {
  const query = normalized(term);
  if (!query) return 4;
  const first = normalized(firstName);
  const last = normalized(lastName);
  const forward = [first, last].filter(Boolean).join(" ");
  const reversed = [last, first].filter(Boolean).join(" ");
  if (query === forward || query === reversed) return 0;
  const queryTokens = studentSearchTokens(query);
  const nameTokens = studentSearchTokens(forward);
  if (queryTokens.every((token) => nameTokens.includes(token))) return 1;
  if (queryTokens.every((token) => nameTokens.some((name) => name.startsWith(token)))) {
    return 2;
  }
  return studentMatchesSearch(firstName, lastName, query) ? 3 : 4;
}

type StudentSearchPage<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/** Fetch every filtered page, preserving distinct student IDs and records.
 *  The callback must apply stable ordering before its inclusive range.
 *  Cancellation discards the whole result so stale searches cannot display
 *  a partially fetched set. */
export async function fetchStudentSearchPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<StudentSearchPage<T>>,
  isCancelled: () => boolean = () => false,
): Promise<T[]> {
  const pageSize = 200;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    if (isCancelled()) return [];
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (isCancelled()) return [];
    if (error) throw new Error(error.message || "Unable to search students.");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
