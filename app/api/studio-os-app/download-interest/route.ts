import { NextRequest, NextResponse } from "next/server";

import { createDashboardServiceClient } from "@/lib/dashboard-auth";

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
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to save your email right now.",
      },
      { status: 500 },
    );
  }
}
