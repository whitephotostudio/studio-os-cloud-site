import { NextResponse } from "next/server";
import { z } from "zod";
import { recordOwnerActivity } from "@/lib/admin-notification-center";

const allowedEvents = new Set([
  "cta_download_app",
  "cta_parents_portal",
  "cta_photographer_sign_in",
  "cta_sample_galleries",
  "cta_start_trial",
  "cta_view_pricing",
  "sample_gallery_card",
]);

const payloadSchema = z.object({
  event: z.string().min(1).max(80),
  href: z.string().url().max(500).optional(),
  label: z.string().max(140).optional(),
  path: z.string().max(220).optional(),
  placement: z.string().max(140).optional(),
  referrer: z.string().max(500).optional(),
  anonymousId: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const parsed = payloadSchema.safeParse(payload);

  if (!parsed.success || !allowedEvents.has(parsed.data.event)) {
    return new NextResponse(null, { status: 204 });
  }

  console.info(
    "marketing_conversion",
    JSON.stringify({
      ...parsed.data,
      receivedAt: new Date().toISOString(),
    }),
  );

  try {
    await recordOwnerActivity(
      {
        type: "marketing_click",
        event: parsed.data.event,
        href: parsed.data.href,
        label: parsed.data.label,
        path: parsed.data.path || "/",
        placement: parsed.data.placement,
        referrer: parsed.data.referrer,
        anonymousId: parsed.data.anonymousId,
      },
      request,
    );
  } catch (error) {
    console.warn("[marketing-conversions]", error);
  }

  return new NextResponse(null, { status: 204 });
}
