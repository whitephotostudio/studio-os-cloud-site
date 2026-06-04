import { NextResponse } from "next/server";
import { z } from "zod";
import { recordOwnerActivity } from "@/lib/admin-notification-center";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

const payloadSchema = z.object({
  type: z.enum(["page_view", "marketing_click"]),
  event: z.string().min(1).max(80).optional(),
  href: z.string().max(500).optional(),
  label: z.string().max(140).optional(),
  path: z.string().min(1).max(260),
  placement: z.string().max(140).optional(),
  referrer: z.string().max(500).optional(),
  anonymousId: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const limit = await rateLimit(ip, {
      namespace: "marketing-activity",
      limit: 120,
      windowSeconds: 60,
    });

    if (!limit.allowed) {
      return new NextResponse(null, { status: 204 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) {
      return new NextResponse(null, { status: 204 });
    }

    await recordOwnerActivity(parsed.data, request);
  } catch (error) {
    console.warn("[marketing-activity]", error);
  }

  return new NextResponse(null, { status: 204 });
}
