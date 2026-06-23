import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { sendFavoritesDeliveryEmail } from "@/lib/favorites-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { id: projectId } = await context.params;

    let body: { viewerEmail?: string } = {};
    try {
      body = (await request.json()) as { viewerEmail?: string };
    } catch {
      body = {};
    }
    const viewerEmail = clean(body.viewerEmail).toLowerCase();
    if (!viewerEmail || !looksLikeEmail(viewerEmail)) {
      return NextResponse.json(
        { ok: false, message: "Enter a valid client email." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();

    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    // Ownership check — the project must belong to this photographer.
    const { data: projectRow, error: projectError } = await service
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!projectRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    const result = await sendFavoritesDeliveryEmail(service, {
      projectId,
      viewerEmail,
    });

    if (!result.ok) {
      const status = result.reason === "no_favorites" ? 400 : 503;
      return NextResponse.json(
        { ok: false, message: result.message },
        { status },
      );
    }

    return NextResponse.json({
      ok: true,
      fileCount: result.fileCount,
      recipientEmail: result.recipientEmail,
      message: `Sent ${result.fileCount} favorite photo${
        result.fileCount === 1 ? "" : "s"
      } to ${result.recipientEmail}.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to send favorites.",
      },
      { status: 500 },
    );
  }
}
