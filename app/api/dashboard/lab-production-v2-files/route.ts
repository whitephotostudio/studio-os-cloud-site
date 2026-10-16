import { NextRequest } from "next/server";
import { z } from "zod";
import { isLabPilot } from "@/lib/labs/pilot";
import { productionAccess } from "@/lib/labs/production-server";
import { productionImageFailure, productionPrivateHeaders } from "@/lib/labs/production-image-server";
import { prepareProductionV2Files } from "@/lib/labs/production-v2-files";
import { LabError } from "@/lib/labs/validation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    if (!isLabPilot()) throw new LabError("The production rehearsal is unavailable here.", 404);
    const id = z.string().uuid().parse(request.nextUrl.searchParams.get("jobId"));
    const file = z.enum(["manifest", "8x10", "10x7", "5x7-a", "5x7-b"]).parse(request.nextUrl.searchParams.get("file"));
    const access = await productionAccess(request, request.nextUrl.searchParams.get("audience") === "lab" ? "lab" : "studio");
    const output = await prepareProductionV2Files(access, id);
    return new Response(new Uint8Array(output.files.get(file)!), { headers: { ...productionPrivateHeaders,
      "Content-Type": file === "manifest" ? "application/json" : "image/jpeg",
      "Content-Disposition": `attachment; filename="${output.job.reference}-${file}.${file === "manifest" ? "json" : "jpg"}"` } });
  } catch (error) { return productionImageFailure(error); }
}
