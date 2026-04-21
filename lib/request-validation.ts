/**
 * Lightweight request-body guardrails for public portal routes.
 *
 * We don't need a full schema library here. Portal payloads are small and
 * shallow — a handful of strings plus occasionally a list of media IDs. What
 * we DO need is defense against:
 *
 *   1. Oversized payloads: a caller pasting a 50 MB string into `email` or
 *      shipping 100k entries in `mediaIds`. Next's default body parser
 *      already caps at 4 MB, but that's still plenty of room to blow up an
 *      `.in()` query or flood the logs.
 *   2. Type confusion: `mediaIds` arriving as a string or an object, which
 *      previously slipped past `as string[]` casts.
 *   3. Format drift: UUID fields arriving as random unbounded strings that
 *      hit the DB and generate noisy errors.
 *
 * Each helper returns a discriminated union so callers can surface a 400
 * without throwing. We keep the shape `{ ok: true; value } | { ok: false; message }`
 * consistent with the rest of the codebase.
 */

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

/** Trim + length-cap a required string. */
export function validateString(
  raw: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): ValidationResult<string> {
  const { min = 1, max = 500 } = opts;
  if (typeof raw !== "string") {
    return { ok: false, message: `${field} must be a string.` };
  }
  const trimmed = raw.trim();
  if (trimmed.length < min) {
    return { ok: false, message: `${field} is required.` };
  }
  if (trimmed.length > max) {
    return { ok: false, message: `${field} is too long.` };
  }
  return { ok: true, value: trimmed };
}

/** Validate a field that should be a UUID (pin/schoolId/projectId etc). */
export function validateUuid(raw: unknown, field: string): ValidationResult<string> {
  const s = validateString(raw, field, { max: 64 });
  if (!s.ok) return s;
  if (!UUID_REGEX.test(s.value)) {
    return { ok: false, message: `${field} is not a valid identifier.` };
  }
  return s;
}

/** Validate an email-shaped string and return it lowercased + trimmed. */
export function validateEmail(raw: unknown, field = "email"): ValidationResult<string> {
  const s = validateString(raw, field, { max: 320 });
  if (!s.ok) return s;
  const normalized = s.value.toLowerCase();
  if (!EMAIL_REGEX.test(normalized)) {
    return { ok: false, message: `${field} is not a valid email.` };
  }
  return { ok: true, value: normalized };
}

/**
 * Validate an array of UUIDs with a hard length cap. This is the main
 * DoS surface on download-batching endpoints — a caller shipping 100k
 * IDs would fan out into huge DB queries and storage fetches.
 */
export function validateUuidArray(
  raw: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): ValidationResult<string[]> {
  const { min = 0, max = 500 } = opts;
  if (!Array.isArray(raw)) {
    return { ok: false, message: `${field} must be an array.` };
  }
  if (raw.length < min) {
    return { ok: false, message: `${field} is required.` };
  }
  if (raw.length > max) {
    return { ok: false, message: `${field} has too many entries (max ${max}).` };
  }
  const result: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      return { ok: false, message: `${field} contains a non-string value.` };
    }
    const trimmed = entry.trim();
    if (!UUID_REGEX.test(trimmed)) {
      return { ok: false, message: `${field} contains an invalid identifier.` };
    }
    result.push(trimmed);
  }
  return { ok: true, value: result };
}

/**
 * Guard that a parsed JSON body is a plain object. Arrays and primitives
 * are rejected — portal routes always expect `{ ... }` shaped bodies.
 */
export function ensureObjectBody(raw: unknown): ValidationResult<Record<string, unknown>> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Invalid request body." };
  }
  return { ok: true, value: raw as Record<string, unknown> };
}
