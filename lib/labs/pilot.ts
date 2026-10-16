import "server-only";

const PILOT_SUPABASE_URL = "https://lgwmxqjwgkzktikhkebp.supabase.co/";

export function labPilotRequested(): boolean {
  return process.env.STUDIO_OS_LAB_PILOT === "1";
}

/** Pilot surfaces fail closed unless they use the dedicated, isolated project. */
export function isLabPilot(): boolean {
  if (!labPilotRequested()) return false;

  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").href === PILOT_SUPABASE_URL;
  } catch {
    return false;
  }
}

const PILOT_EXACT_PATHS = new Set([
  "/labs-pilot", "/labs-pilot/sample-file", "/lab", "/sign-in",
  "/api/dashboard/labs", "/api/dashboard/lab-catalog", "/api/dashboard/lab-orders",
  "/api/dashboard/in-house-price-sheets",
  "/api/dashboard/in-house-test-orders", "/api/dashboard/in-house-test-files",
  "/api/labs-pilot/in-house", "/labs-pilot/in-house/sample-photo",
  "/api/dashboard/lab-order-assets", "/api/lab/orders", "/api/dashboard/mfa",
  "/api/dashboard/agreement/status", "/api/dashboard/agreement/accept",
  "/api/csp-report", "/manifest.webmanifest",
  "/terms", "/privacy", "/data-responsibility-agreement",
]);

/** Only the pilot workflow can reach application routes in a pilot deployment. */
export function isLabPilotPath(pathname: string): boolean {
  if (!pathname.startsWith("/") || /[%\\?#]/.test(pathname) || pathname.includes("//")) return false;
  const segments = pathname.split("/");
  if (segments.some(segment => segment === "." || segment === "..")) return false;
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return PILOT_EXACT_PATHS.has(path) || path === "/dashboard/labs" ||
    path.startsWith("/dashboard/labs/") || path.startsWith("/api/lab/orders/") ||
    /^\/labs-pilot\/in-house\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(path);
}
