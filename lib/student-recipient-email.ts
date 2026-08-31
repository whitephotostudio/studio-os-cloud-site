const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeStudentRecipientEmail(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

export function studentRecipientEmailError(value: unknown): string | null {
  const normalized = normalizeStudentRecipientEmail(value);
  if (!normalized) return null;
  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    return "Enter a valid parent / recipient email address.";
  }
  return null;
}

