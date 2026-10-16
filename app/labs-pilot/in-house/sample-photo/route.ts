import { isLabPilot } from "@/lib/labs/pilot";
import { readInHouseSampleAsset } from "@/lib/labs/in-house-sample-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isLabPilot()) return new Response(null, { status: 404 });
  try {
    const { bytes } = await readInHouseSampleAsset("sample-8x10");
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/jpeg", "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer",
    } });
  } catch { return new Response(null, { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
}
