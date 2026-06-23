import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  contentDispositionAttachment,
  createFavoritesDeliveryZipStream,
  favoritesZipFileName,
  resolveFavoritesDeliveryContext,
  renderFavoritesDeliveryPage,
  verifyFavoritesDeliveryToken,
} from "@/lib/favorites-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export async function GET(request: NextRequest) {
  try {
    const token = clean(request.nextUrl.searchParams.get("token"));
    const wantsDownload = clean(request.nextUrl.searchParams.get("download")) === "1";
    if (!token) {
      return NextResponse.json(
        { ok: false, message: "Missing favorites link." },
        { status: 400 },
      );
    }

    const payload = verifyFavoritesDeliveryToken(token);
    const service = createDashboardServiceClient();
    const context = await resolveFavoritesDeliveryContext(service, {
      projectId: payload.projectId,
      viewerEmail: payload.recipientEmail,
    });

    if (context.recipientEmail.toLowerCase() !== payload.recipientEmail.toLowerCase()) {
      return NextResponse.json(
        { ok: false, message: "This favorites link does not match." },
        { status: 403 },
      );
    }

    if (wantsDownload) {
      if (!context.photos.length) {
        return NextResponse.json(
          { ok: false, message: "No favorite photos are available to download." },
          { status: 404 },
        );
      }
      const fileName = favoritesZipFileName(context);
      return new NextResponse(createFavoritesDeliveryZipStream(context), {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": contentDispositionAttachment(fileName),
          "cache-control": "private, no-store",
        },
      });
    }

    const downloadUrl = `${request.nextUrl.pathname}?token=${encodeURIComponent(token)}&download=1`;
    const html = renderFavoritesDeliveryPage(context, { downloadUrl });
    return new NextResponse(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    console.error("[favorites-delivery]", error);
    const message =
      error instanceof Error ? error.message : "Failed to open your favorite photos.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
