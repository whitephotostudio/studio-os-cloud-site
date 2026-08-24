export const MAX_R2_OBJECT_KEY_LENGTH = 1024;

export type R2ResourceScope =
  | { kind: "photographer"; id: string }
  | { kind: "project"; id: string }
  | { kind: "school"; id: string };

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function isUuid(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    clean(value),
  );
}

/**
 * Normalize an object key without changing meaningful characters such as
 * spaces. R2 keys come from desktop folders, so encoding/decoding here would
 * risk pointing at a different object. Reject URL syntax, traversal, control
 * characters, and ambiguous path separators before any ownership lookup.
 */
export function normalizeR2Key(
  rawValue: string | null | undefined,
  options: { prefix?: boolean; allowQueryCharacters?: boolean } = {},
): string | null {
  const raw = clean(rawValue);
  if (!raw || raw.length > MAX_R2_OBJECT_KEY_LENGTH) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null;
  const unsafeCharacters = options.allowQueryCharacters
    ? /[\\\u0000-\u001f\u007f]/
    : /[\\\u0000-\u001f\u007f?#]/;
  if (unsafeCharacters.test(raw)) return null;
  if (raw.startsWith("/") || raw.startsWith("//")) return null;

  const hadTrailingSlash = raw.endsWith("/");
  const segments = raw.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.trim().length === 0,
    )
  ) {
    // A single trailing slash is valid only for a listing prefix.
    const onlyTrailingEmpty =
      options.prefix &&
      hadTrailingSlash &&
      segments.at(-1) === "" &&
      segments.slice(0, -1).every((segment) => segment && segment !== "." && segment !== "..");
    if (!onlyTrailingEmpty) return null;
  }

  const normalized = segments.filter(Boolean).join("/");
  if (!normalized) return null;
  return options.prefix && hadTrailingSlash ? `${normalized}/` : normalized;
}

/**
 * Identify the database resource that owns a supported Studio OS R2 path.
 * The caller must still verify this id against the signed-in photographer.
 */
export function scopeForR2Key(key: string): R2ResourceScope | null {
  const segments = key.replace(/\/$/, "").split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const [first, second, third] = segments;

  if (first === "projects") {
    return second ? { kind: "project", id: second } : null;
  }
  if (first === "probes") {
    return second ? { kind: "project", id: second } : null;
  }
  if (first === "backdrops") {
    return second ? { kind: "photographer", id: second } : null;
  }
  if (first === "schools") {
    return second ? { kind: "school", id: second } : null;
  }
  if (first === "photos") {
    return second ? { kind: "school", id: second } : null;
  }
  if (first === "nobg-photos") {
    if (second === "projects") {
      return third ? { kind: "project", id: third } : null;
    }
    if (second === "schools") {
      return third ? { kind: "school", id: third } : null;
    }
    return second ? { kind: "school", id: second } : null;
  }

  // Legacy school uploads are rooted directly at local_school_id.
  return { kind: "school", id: first };
}
