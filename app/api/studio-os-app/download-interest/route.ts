import { NextRequest, NextResponse } from "next/server";

import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizePlatform(value: string | null | undefined) {
  const normalized = clean(value).toLowerCase();
  if (normalized === "mac" || normalized === "windows") return normalized;
  return null;
}

export async function POST(request: NextRequest) {
  try {
    // Unauthenticated marketing capture endpoint. Without a limit an
    // attacker can flood portal_email_captures with millions of junk
    // @attacker.com addresses. A real visitor only clicks Download once
    // per platform, so 5/hour per IP is more than enough.
    const limitResult = rateLimit(getClientIp(request), {
      namespace: "download-interest",
      limit: 5,
      windowSeconds: 3600,
    });
    if (!limitResult.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.max(
              1,
              Math.ceil((limitResult.resetAt - Date.now()) / 1000),
            ).toString(),
          },
        },
      );
    }

    const { email, platform } = (await request.json()) as {
      email?: string;
      platform?: string;
    };

    const normalizedEmail = clean(email).toLowerCase();
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return NextResponse.json(
        { ok: false, message: "Please enter a valid email address." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();
    const selectedPlatform = normalizePlatform(platform);
    const source = selectedPlatform
      ? `studio_os_download_${selectedPlatform}`
      : "studio_os_download";

    const { error } = await service.from("portal_email_captures").insert({
      email: normalizedEmail,
      source,
    });

    if (error && error.code !== "23505") throw error;

    return NextResponse.json({ ok: true, email: normalizedEmail });
  } catch (error) {
    console.error("[download-interest]", error);
    return NextResponse.json(
      { ok: false, message: "Unable to save your email right now." },
      { status: 500 },
    );
  }
}
