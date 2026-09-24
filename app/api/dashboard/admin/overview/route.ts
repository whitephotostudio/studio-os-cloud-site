import { NextRequest } from "next/server";
import { z } from "zod";
import { ownerJson, requireOwner } from "@/lib/owner-admin";

export const dynamic = "force-dynamic";
const querySchema = z.object({ page: z.coerce.number().int().min(0).max(10000), search: z.string().max(120), attention: z.enum(["true", "false"]) });

export async function GET(request: NextRequest) {
  try {
    const auth = await requireOwner(request);
    if (auth.response) return auth.response;
    const params = request.nextUrl.searchParams;
    const query = querySchema.safeParse({ page: params.get("page") ?? 0, search: params.get("search") ?? "", attention: params.get("attention") ?? "false" });
    if (!query.success) return ownerJson({ message: "Invalid search or page." }, 400);
    const { data, error } = await auth.service.rpc("owner_overview_snapshot", {
      p_actor: auth.user.id, p_page: query.data.page, p_search: query.data.search, p_attention: query.data.attention === "true",
    }).abortSignal(AbortSignal.timeout(12000));
    if (error || !data) throw error ?? new Error("No overview returned");
    return ownerJson(data);
  } catch (error) {
    console.error("[owner-overview]", error instanceof Error ? error.message : "Database request failed");
    return ownerJson({ message: "Owner overview could not be checked. Retry to get current information." }, 503);
  }
}
