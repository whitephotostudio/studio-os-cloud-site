import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

/**
 * Public short-link resolver: /g/{slug}
 * Looks up gallery_slug in projects and schools tables,
 * then redirects to the appropriate /parents gallery page.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    const normalizedSlug = clean(slug).toLowerCase();

    if (!normalizedSlug) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    const service = createDashboardServiceClient();
    const origin = new URL(request.url).origin;

    // Check projects (events) first
    const { data: projectRow } = await service
      .from("projects")
      .select("id")
      .eq("gallery_slug", normalizedSlug)
      .maybeSingle();

    if (projectRow?.id) {
      const params = new URLSearchParams({
        mode: "event",
        project: projectRow.id,
      });
      return NextResponse.redirect(`${origin}/parents?${params.toString()}`);
    }

    // Check schools
    const { data: schoolRow } = await service
      .from("schools")
      .select("id")
      .eq("gallery_slug", normalizedSlug)
      .maybeSingle();

    if (schoolRow?.id) {
      const params = new URLSearchParams({
        mode: "school",
        school: schoolRow.id,
      });
      return NextResponse.redirect(`${origin}/parents?${params.toString()}`);
    }

    // No match found — redirect to homepage
    return NextResponse.redirect(new URL("/", request.url));
  } catch {
    return NextResponse.redirect(new URL("/", request.url));
  }
}
