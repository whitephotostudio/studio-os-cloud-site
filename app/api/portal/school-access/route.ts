import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

type SchoolRow = {
  id: string;
  school_name: string;
  status: string | null;
  expiration_date: string | null;
};

type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items?: any[] | null;
  profile_id?: string | null;
  category?: string | null;
};

type BackdropRow = {
  id: string;
  name: string;
  image_url: string;
  thumbnail_url: string | null;
  tier: "free" | "premium";
  price_cents: number;
  category: string | null;
  tags: string[] | null;
  sort_order: number;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      schoolId?: string;
      pin?: string;
      // ✅ PERF: When true, also fetch packages/backdrops/photographer in
      // the same request so the gallery page can skip its own API call.
      prefetch?: boolean;
    };

    const selectedSchoolId = clean(body.schoolId);
    const selectedPin = clean(body.pin);
    const prefetch = body.prefetch === true;

    if (!selectedSchoolId) {
      return NextResponse.json({ ok: false, message: "Please choose your school." }, { status: 400 });
    }
    if (!selectedPin) {
      return NextResponse.json({ ok: false, message: "Please enter the PIN from your photo envelope." }, { status: 400 });
    }

    const service = createDashboardServiceClient();

    // Step 1: Validate school
    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name,status,expiration_date,photographer_id,package_profile_id,local_school_id,order_due_date")
      .eq("id", selectedSchoolId)
      .maybeSingle();

    if (schoolError) throw schoolError;
    if (!schoolRow) {
      return NextResponse.json({ ok: false, message: "Please choose your school." }, { status: 404 });
    }

    const selectedSchool = schoolRow as SchoolRow & {
      photographer_id: string | null;
      package_profile_id: string | null;
      local_school_id: string | null;
      order_due_date: string | null;
    };

    if (selectedSchool.expiration_date && new Date(selectedSchool.expiration_date) < new Date()) {
      return NextResponse.json({ ok: false, step: "school_closed" }, { status: 409 });
    }

    if (selectedSchool.status === "pre-released") {
      return NextResponse.json({ ok: false, step: "school_prerelease" }, { status: 409 });
    }

    // Step 2: Find same-name schools + validate PIN in parallel
    const selectedSchoolName = clean(selectedSchool.school_name);
    const [sameNameResult, pinResult] = await Promise.all([
      service
        .from("schools")
        .select("id")
        .ilike("school_name", selectedSchoolName),
      // ✅ PERF: We already have the school — look up the student PIN
      // scoped to the candidate school IDs (resolved below) but we can
      // start with just the selected school as an optimistic first check.
      service
        .from("students")
        .select("id,school_id,photo_url")
        .eq("pin", selectedPin)
        .eq("school_id", selectedSchoolId),
    ]);

    if (sameNameResult.error) throw sameNameResult.error;
    if (pinResult.error) throw pinResult.error;

    const candidateSchoolIds = Array.from(
      new Set([selectedSchoolId, ...(sameNameResult.data ?? []).map((row) => row.id)]),
    );

    // If direct school match found, use it; otherwise expand to same-name schools
    let matches = pinResult.data ?? [];
    if (!matches.length && candidateSchoolIds.length > 1) {
      const { data: broadMatches, error: broadError } = await service
        .from("students")
        .select("id,school_id,photo_url")
        .in("school_id", candidateSchoolIds)
        .eq("pin", selectedPin);

      if (broadError) throw broadError;
      matches = broadMatches ?? [];
    }

    if (!matches.length) {
      return NextResponse.json(
        { ok: false, message: "No gallery was found for that school and PIN." },
        { status: 404 },
      );
    }

    const best =
      matches.find((row) => row.school_id === selectedSchoolId && !!row.photo_url) ??
      matches.find((row) => !!row.photo_url) ??
      matches.find((row) => row.school_id === selectedSchoolId) ??
      matches[0];

    const resolvedSchoolId = best.school_id ?? selectedSchoolId;

    // ─────────────────────────────────────────────────────────────────────
    // ✅ PERF: Prefetch gallery context in same request when requested.
    // This lets the gallery page skip its own API call entirely.
    // ─────────────────────────────────────────────────────────────────────
    let galleryContext: Record<string, unknown> | undefined;

    if (prefetch && selectedSchool.photographer_id) {
      try {
        // Resolve full student list for all candidate schools
        const [studentsResult, packagesResult, backdropsResult, photographerResult] =
          await Promise.all([
            service
              .from("students")
              .select("id,first_name,last_name,photo_url,class_id,school_id,class_name,folder_name,pin")
              .eq("pin", selectedPin)
              .in("school_id", candidateSchoolIds),
            service
              .from("packages")
              .select("id,name,description,price_cents,items,profile_id,category")
              .eq("photographer_id", selectedSchool.photographer_id)
              .eq("active", true)
              .order("price_cents", { ascending: true }),
            service
              .from("backdrop_catalog")
              .select("id,name,image_url,thumbnail_url,tier,price_cents,category,tags,sort_order")
              .eq("photographer_id", selectedSchool.photographer_id)
              .eq("active", true)
              .order("sort_order", { ascending: true }),
            service
              .from("photographers")
              .select("id,watermark_enabled,watermark_logo_url,business_name,studio_address,studio_phone,studio_email")
              .eq("id", selectedSchool.photographer_id)
              .maybeSingle(),
          ]);

        const studentCandidates = studentsResult.data ?? [];
        const primaryStudent =
          studentCandidates.find((s) => s.school_id === resolvedSchoolId && !!s.photo_url) ??
          studentCandidates.find((s) => !!s.photo_url) ??
          studentCandidates.find((s) => s.school_id === resolvedSchoolId) ??
          studentCandidates[0] ??
          null;

        const availablePackages = (packagesResult.data ?? []) as PackageRow[];
        const normalizedProfile = clean(selectedSchool.package_profile_id).toLowerCase();
        const profilePackages =
          normalizedProfile && normalizedProfile !== "default"
            ? availablePackages.filter((pkg) => clean(pkg.profile_id) === clean(selectedSchool.package_profile_id))
            : [];
        const packageRows = profilePackages.length ? profilePackages : availablePackages;

        const photographer = photographerResult.data;
        const watermarkEnabled = photographer?.watermark_enabled !== false;
        const watermarkLogoUrl = photographer?.watermark_logo_url || "";
        const studioInfo = {
          businessName: photographer?.business_name || "",
          logoUrl: photographer?.watermark_logo_url || "",
          address: photographer?.studio_address || "",
          phone: photographer?.studio_phone || "",
          email: photographer?.studio_email || "",
        };

        const activeProject = {
          id: selectedSchool.id,
          portal_status: selectedSchool.status ?? null,
          order_due_date: selectedSchool.order_due_date ?? null,
          expiration_date: selectedSchool.expiration_date ?? null,
        };

        // Resolve the set of school rows needed by gallery-context consumers
        const { data: sameNameFull } = await service
          .from("schools")
          .select("id,school_name,photographer_id,package_profile_id,local_school_id,status,order_due_date,expiration_date")
          .ilike("school_name", selectedSchoolName)
          .order("created_at", { ascending: false });

        galleryContext = {
          ok: true,
          currentSchool: selectedSchool,
          schoolRowsForMatch: sameNameFull ?? [selectedSchool],
          studentCandidates,
          primaryStudent,
          activeSchool: selectedSchool,
          activeProject,
          packages: packageRows,
          backdrops: backdropsResult.data ?? [],
          photographerId: photographer?.id ?? selectedSchool.photographer_id,
          watermarkEnabled,
          watermarkLogoUrl,
          studioInfo,
        };
      } catch (prefetchErr) {
        // Prefetch failure is non-fatal — gallery page will fetch on its own
        console.warn("[school-access] prefetch failed:", prefetchErr);
      }
    }

    return NextResponse.json({
      ok: true,
      schoolId: resolvedSchoolId,
      pin: selectedPin,
      ...(galleryContext ? { galleryContext } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to check school access.",
      },
      { status: 500 },
    );
  }
}
