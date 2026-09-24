import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";

export function ownerJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
}

/** Fail closed; a configured email address is not proof of owner access. */
export async function requireOwner(request: NextRequest) {
  const { user, mfaSatisfied } = await resolveDashboardAuth(request);
  if (!user) return { response: ownerJson({ message: "Please sign in again." }, 401) } as const;
  if (!mfaSatisfied) return { response: ownerJson({ message: "Complete two-factor verification to open owner tools." }, 403) } as const;
  const service = createDashboardServiceClient();
  const { data, error } = await service.from("photographers").select("id,is_platform_admin").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!data?.is_platform_admin) return { response: ownerJson({ message: "Only the platform owner can use this overview." }, 403) } as const;
  return { user, service, photographerId: data.id as string } as const;
}
