import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { randomBytes } from "node:crypto";
import { contentSecurityPolicy } from "@/lib/content-security-policy";
import { PORTAL_PIN_RESERVATION_HEADER, portalPinAttemptLimit, portalPinReservationHeader } from "@/lib/portal-pin-rate-limit";
import { parentSessionRateBudgetKey } from "@/lib/parent-gallery-session";
import { isLabPilot, labPilotRequested, isLabPilotPath } from "@/lib/labs/pilot";

/** Routes that need strict rate limiting (auth-sensitive) */
const STRICT_ROUTES = [
  "/api/studio-os-app/activate",
  "/api/studio-os-app/validate",
  "/forgot-password",
];

/** Routes that get standard API rate limiting */
const API_PREFIX = "/api/";
const PRIVATE_MEDIA_PREFIXES = ["/api/r2/img/", "/api/storage/legacy-media/"];

function addSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  if (!response.headers.has("Referrer-Policy")) response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  return response;
}

export async function proxy(request: NextRequest) {
  const ip = getClientIp(request);
  const pathname = request.nextUrl.pathname;
  const privateProduction = ["/api/dashboard/lab-production", "/api/dashboard/lab-production-assets", "/api/dashboard/lab-production-files", "/api/lab/production", "/api/labs-pilot/production", "/lab/production"].includes(pathname) || pathname.startsWith("/labs-pilot/production/");
  const finish = (response: NextResponse) => {
    if (privateProduction) {
      response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
      response.headers.set("Cache-Control", "private, no-store");
    }
    return addSecurityHeaders(response);
  };
  // The disposable lab pilot must never expose unrelated commerce, email,
  // school or desktop actions. This runs before any shared-provider helper.
  if (labPilotRequested()) {
    if (!isLabPilot()) return finish(NextResponse.json({ ok: false, message: "Lab test configuration unavailable." }, { status: 503 }));
    if (!isLabPilotPath(pathname)) {
      const response = pathname.startsWith("/api/")
        ? NextResponse.json({ ok: false, message: "This test environment is for lab workflows only." }, { status: 404 })
        : NextResponse.redirect(new URL("/labs-pilot", request.url));
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
      return finish(response);
    }
  }
  const requestHeaders = new Headers(request.headers);
  // No browser may supply a reservation identity, even on exempt/error paths.
  requestHeaders.delete(PORTAL_PIN_RESERVATION_HEADER);

  // Session bootstrap translates galleryId and owns its one shared PIN budget.
  const pinLimit = pathname === "/api/portal/session" ? null : await portalPinAttemptLimit(request);
  if (pinLimit) {
    const response = NextResponse.json({ ok: false, message: pinLimit.message }, { status: pinLimit.status });
    response.headers.set("Retry-After", String(pinLimit.retryAfter));
    return finish(response);
  }
  const reservation = portalPinReservationHeader(request);
  if (reservation) requestHeaders.set(PORTAL_PIN_RESERVATION_HEADER, reservation);

  // Strict rate limiting for auth-sensitive routes (10 requests per minute)
  const isStrict = STRICT_ROUTES.some((route) => pathname.startsWith(route));
  if (isStrict) {
    const result = await rateLimit(ip, {
      namespace: "strict",
      limit: 10,
      windowSeconds: 60,
      failClosed: true,
    });

    if (!result.allowed) {
      const res = NextResponse.json(
        { ok: false, message: "Too many requests. Please wait a moment." },
        { status: 429 },
      );
      res.headers.set("Retry-After", String(Math.ceil((result.resetAt - Date.now()) / 1000)));
      return finish(res);
    }
  }

  // A gallery can request the original, preview and thumbnail for hundreds
  // of photos. Keep those reads bounded independently of checkout/actions.
  // This chooses a counter only; the image route still checks capability or
  // dashboard MFA and retained namespace ownership before any storage read.
  const isPrivateMediaRead = (request.method === "GET" || request.method === "HEAD") &&
    PRIVATE_MEDIA_PREFIXES.some(prefix => pathname.startsWith(prefix) && pathname.length > prefix.length);
  if (pathname.startsWith(API_PREFIX)) {
    const parentBudgetKey = await parentSessionRateBudgetKey(request);
    const result = await rateLimit(parentBudgetKey || ip, {
      namespace: isPrivateMediaRead ? "private-media-read" : "api",
      limit: isPrivateMediaRead ? 3000 : 100,
      windowSeconds: 60,
    });

    if (!result.allowed) {
      const res = NextResponse.json(
        { ok: false, message: "Rate limit exceeded. Please try again shortly." },
        { status: 429 },
      );
      res.headers.set("Retry-After", String(Math.ceil((result.resetAt - Date.now()) / 1000)));
      return finish(res);
    }
  }

  // Add security headers to all responses
  const nonce = randomBytes(16).toString("base64");
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");
  // Next reads the request policy to nonce its bootstrap/hydration scripts.
  // Always replace caller-supplied values.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (isLabPilot()) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Content-Security-Policy", policy);
  if (pathname.startsWith("/parents") || pathname.startsWith("/api/portal/") || pathname.startsWith("/dashboard") ||
      pathname.startsWith("/labs-pilot/in-house/") || pathname.startsWith("/labs-pilot/production/") || pathname === "/api/labs-pilot/production" ||
      pathname === "/lab/production" || pathname === "/api/lab/production" || pathname === "/api/labs-pilot/in-house" ||
      pathname === "/api/dashboard/in-house-test-orders" || pathname === "/api/dashboard/in-house-test-files") {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return finish(response);
}

export const config = {
  matcher: [
    "/api/:path*",
    // Apply the finite media budget even when the stored key ends in a
    // lowercase image extension excluded by the generic matcher below.
    "/api/r2/img/:path*",
    "/api/storage/legacy-media/:path*",
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files (images, fonts, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
