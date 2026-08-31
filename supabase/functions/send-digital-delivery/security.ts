export const MAX_DELIVERY_PHOTOS = 200;

export function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function encodeObjectKey(key: string): string {
  return key
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function validateOrderId(value: unknown): string | null {
  const id = cleanText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

export function validatePhotoPaths(
  value: unknown,
  schoolId: string,
  studentId: string,
): { ok: true; paths: string[] } | { ok: false; error: string } {
  if (!schoolId || !studentId) {
    return { ok: false, error: "This order is not linked to a student folder." };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "At least one photo is required." };
  }
  if (value.length > MAX_DELIVERY_PHOTOS) {
    return { ok: false, error: `A delivery can contain at most ${MAX_DELIVERY_PHOTOS} photos.` };
  }

  const expectedPrefix = `${schoolId}/${studentId}/`;
  const unique = new Set<string>();

  for (const rawPath of value) {
    const path = cleanText(rawPath);
    if (
      !path ||
      path.length > 1024 ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.includes("?") ||
      path.includes("#") ||
      /[\u0000-\u001f\u007f]/.test(path)
    ) {
      return { ok: false, error: "One or more photo paths are invalid." };
    }

    const segments = path.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      return { ok: false, error: "One or more photo paths are invalid." };
    }
    if (!path.startsWith(expectedPrefix)) {
      return { ok: false, error: "A photo does not belong to this order's student folder." };
    }
    unique.add(path);
  }

  return { ok: true, paths: [...unique] };
}
