import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { randomBytes } from "node:crypto";
import { contentSecurityPolicy } from "@/lib/content-security-policy";
import { portalPinAttemptLimit } from "@/lib/portal-pin-rate-limit";

/** Routes that need strict rate limiting (auth-sensitive) */
const STRICT_ROUTES = [
  "/api/studio-os-app/activate",
  "/api/studio-os-app/validate",
  "/forgot-password",
];

/** Routes that get standard API rate limiting */
const API_PREFIX = "/api/";

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

  const pinLimit = await portalPinAttemptLimit(request);
  if (pinLimit) {
    const response = NextResponse.json({ ok: false, message: pinLimit.message }, { status: pinLimit.status });
    response.headers.set("Retry-After", String(pinLimit.retryAfter));
    return addSecurityHeaders(response);
  }

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
      return addSecurityHeaders(res);
    }
  }

  // Standard rate limiting for all API routes (100 requests per minute)
  if (pathname.startsWith(API_PREFIX)) {
    const result = await rateLimit(ip, {
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
  const nonce = randomBytes(16).toString("base64");
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");
  const requestHeaders = new Headers(request.headers);
  // Next reads the request policy to nonce its bootstrap/hydration scripts.
  // Always replace caller-supplied values.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  if (pathname.startsWith("/parents") || pathname.startsWith("/api/portal/") || pathname.startsWith("/dashboard")) {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
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
