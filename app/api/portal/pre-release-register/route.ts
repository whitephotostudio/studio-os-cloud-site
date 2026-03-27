import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const { schoolId, email } = (await request.json()) as {
      schoolId?: string;
      email?: string;
    };

    const selectedSchoolId = clean(schoolId);
    const normalizedEmail = clean(email).toLowerCase();

    if (!selectedSchoolId || !normalizedEmail) {
      return NextResponse.json(
        { ok: false, message: "Please enter your email." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();
    const { error } = await service.from("pre_release_registrations").insert({
      school_id: selectedSchoolId,
      email: normalizedEmail,
    });

    if (error && error.code !== "23505") {
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
      },
      { status: 500 },
    );
  }
}
