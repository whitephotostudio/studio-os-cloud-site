export type SchoolCheckoutGalleryContext = {
  pin: string;
  schoolId: string;
  email: string;
};

export function hasSchoolCheckoutGalleryContext(context: SchoolCheckoutGalleryContext): boolean {
  return Boolean(context.pin.trim())
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.schoolId)
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(context.email.trim());
}

/** Accept only a verified confirmation's school link for this exact session. */
export function schoolCheckoutRecoveryUrl(
  value: unknown,
  current: SchoolCheckoutGalleryContext,
  sessionId: string,
): string | null {
  if (typeof value !== "string" || !value.startsWith("/parents/") || !sessionId
      || /[\\\x00-\x20#]/.test(value)) return null;
  try {
    const origin = "https://parent-checkout.invalid";
    const url = new URL(value, origin);
    if (url.origin !== origin || !/^\/parents\/[^/]+$/.test(url.pathname)) return null;
    for (const name of ["mode", "school", "email", "checkout", "session_id"]) {
      if (url.searchParams.getAll(name).length !== 1) return null;
    }
    if (url.searchParams.get("mode") !== "school"
        || url.searchParams.get("checkout") !== "success"
        || url.searchParams.get("session_id") !== sessionId) return null;
    const context = {
      pin: decodeURIComponent(url.pathname.slice("/parents/".length)),
      schoolId: url.searchParams.get("school") ?? "",
      email: url.searchParams.get("email") ?? "",
    };
    if (context.pin !== context.pin.trim() || /[/\\\x00-\x20]/.test(context.pin)
        || !hasSchoolCheckoutGalleryContext(context)) return null;
    if (context.pin === current.pin
        && context.schoolId.toLowerCase() === current.schoolId.toLowerCase()
        && context.email.trim().toLowerCase() === current.email.trim().toLowerCase()) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
