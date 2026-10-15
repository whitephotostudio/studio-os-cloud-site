import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isLabPilot } from "@/lib/labs/pilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isLabPilot()) return new Response(null, { status: 404 });

  const sample = await readFile(join(process.cwd(), "tests/helpers/lab-order-sample.jpg"));
  return new Response(new Uint8Array(sample), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": 'attachment; filename="studio-os-lab-pilot-sample.jpg"',
      "Content-Length": String(sample.byteLength),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
