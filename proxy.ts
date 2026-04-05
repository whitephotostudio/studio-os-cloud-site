import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

/** Routes that need strict rate limiting (auth-sensitive) */
const STRICT_ROUTES = [
  "/api/studio-os-app/activate",
  "/api/studio-os-app/validate",
  "/api/portal/school-access",
  "/api/portal/event-access",
  "/forgot-password",
];

/** Routes that get standard API rate limiting */
const API_PREFIX = "/api/";

function addSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
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

export function proxy(request: NextRequest) {
  const ip = getClientIp(request);
  const pathname = request.nextUrl.pathname;

  // Strict rate limiting for auth-sensitive routes (10 requests per minute)
  const isStrict = STRICT_ROUTES.some((route) => pathname.startsWith(route));
  if (isStrict) {
    const result = rateLimit(ip, {
      namespace: "strict",
      limit: 10,
      windowSeconds: 60,
    });

    if (!result.allowed) {
      const res = NextResponse.json(
        { ok: false, message: "Too many requests. Please wait a moment." },
        { status: 429 },
      );
      res.headers.set("Retry-After", String(Math.ceil((result.resetAt - Date.now()) / 1000)));
      return addSecurityHeaders(res);
    }
  }

  // Standard rate limiting for all API routes (100 requests per minute)
  if (pathname.startsWith(API_PREFIX)) {
    const result = rateLimit(ip, {
      namespace: "api",
      limit: 100,
      windowSeconds: 60,
    });

    if (!result.allowed) {
      const res = NextResponse.json(
        { ok: false, message: "Rate limit exceeded. Please try again shortly." },
        { status: 429 },
      );
      res.headers.set("Retry-After", String(Math.ceil((result.resetAt - Date.now()) / 1000)));
      return addSecurityHeaders(res);
    }
  }

  // Add security headers to all responses
  const response = NextResponse.next();
  return addSecurityHeaders(response);
}

export const config = {
  matcher: [
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
