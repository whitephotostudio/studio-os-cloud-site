import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";
import { loadStudioBookingDetail } from "@/lib/studio-bookings-detail-server";
import {
  createStudioBookingsPdf,
  safeBookingPdfFilename,
  type StudioBookingPdfFilter,
} from "@/lib/studio-bookings-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTERS = new Set<StudioBookingPdfFilter>(["confirmed", "cancelled", "all"]);

function privateJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const requestedFilter = request.nextUrl.searchParams.get("status") ?? "confirmed";
    if (!UUID_RE.test(eventId) || !FILTERS.has(requestedFilter as StudioBookingPdfFilter)) {
      return privateJson({ ok: false, message: "That PDF report request is not valid." }, 400);
    }

    const { user } = await resolveDashboardAuth(request);
    if (!user) return privateJson({ ok: false, message: "Please sign in again." }, 401);

    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);
    if (!photographer.is_platform_admin) {
      return privateJson(
        { ok: false, message: "Only the Studio OS Cloud owner can export booking reports." },
        403,
      );
    }

    const detail = await loadStudioBookingDetail(service, photographer.id, eventId);
    if (!detail) return privateJson({ ok: false, message: "Booking event not found." }, 404);

    const filter = requestedFilter as StudioBookingPdfFilter;
    const pdfBytes = await createStudioBookingsPdf(detail, filter);
    const filename = safeBookingPdfFilename(detail.event.name, filter);

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBytes.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("[studio-bookings:pdf-export]", error);
    return privateJson(
      { ok: false, message: "The booking PDF could not be created. No booking data was changed." },
      500,
    );
  }
}
