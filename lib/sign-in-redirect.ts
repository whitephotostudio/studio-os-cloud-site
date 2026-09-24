/** Preserve protected-download destinations while keeping navigation on this site. */
export function resolveSignInRedirect(search: string) {
  const params = new URLSearchParams(search);
  const candidate = params.get("redirect") || params.get("next") || "/dashboard";
  if (!candidate.startsWith("/") || candidate.startsWith("//") || /[\\\u0000-\u0020]/.test(candidate)) return "/dashboard";
  const base = "https://studiooscloud.com";
  try {
    const url = new URL(candidate, base);
    if (url.origin !== base) return "/dashboard";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/dashboard";
  }
}
