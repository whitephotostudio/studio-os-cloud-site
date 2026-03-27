import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  class_id: string | null;
  school_id: string;
  class_name?: string | null;
  folder_name?: string | null;
  pin?: string | null;
};

type SchoolRow = {
  id: string;
  school_name: string | null;
  photographer_id: string | null;
  package_profile_id: string | null;
  local_school_id?: string | null;
  status?: string | null;
  order_due_date?: string | null;
  expiration_date?: string | null;
};

type ProjectRow = {
  id: string;
  portal_status?: string | null;
  order_due_date?: string | null;
  expiration_date?: string | null;
  project_name?: string | null;
  name?: string | null;
  title?: string | null;
};

type PackageItemValue =
  | string
  | {
      qty?: number | string | null;
      name?: string | null;
      type?: string | null;
      size?: string | null;
      finish?: string | null;
    };

type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  items?: PackageItemValue[] | null;
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
    const { pin, schoolId } = (await request.json()) as {
      pin?: string;
      schoolId?: string;
    };

    const selectedPin = clean(pin);
    const selectedSchoolId = clean(schoolId);

    if (!selectedPin) {
      return NextResponse.json({ ok: false, message: "Missing PIN." }, { status: 400 });
    }

    const service = createDashboardServiceClient();

    const { data: currentSchool, error: currentSchoolError } = selectedSchoolId
      ? await service
          .from("schools")
          .select("id,school_name,photographer_id,package_profile_id,local_school_id,status,order_due_date,expiration_date")
          .eq("id", selectedSchoolId)
          .maybeSingle<SchoolRow>()
      : { data: null as SchoolRow | null, error: null };

    if (currentSchoolError) throw currentSchoolError;

    const schoolNameForMatch = clean(currentSchool?.school_name);
    let schoolIdsToSearch: string[] = [];
    let schoolRowsForMatch: SchoolRow[] = currentSchool ? [currentSchool] : [];

    if (schoolNameForMatch) {
      const { data: sameNameSchools, error: sameNameError } = await service
        .from("schools")
        .select("id,school_name,photographer_id,package_profile_id,local_school_id,status,order_due_date,expiration_date")
        .ilike("school_name", schoolNameForMatch)
        .order("created_at", { ascending: false });

      if (sameNameError) throw sameNameError;

      schoolRowsForMatch = (sameNameSchools as SchoolRow[] | null) ?? schoolRowsForMatch;
      schoolIdsToSearch = Array.from(
        new Set([
          ...schoolRowsForMatch.map((row) => row.id),
          ...(selectedSchoolId ? [selectedSchoolId] : []),
        ]),
      );
    } else if (selectedSchoolId) {
      schoolIdsToSearch = [selectedSchoolId];
    }

    const studentQuery = service
      .from("students")
        .select("id,first_name,last_name,photo_url,class_id,school_id,class_name,folder_name,pin")
      .eq("pin", selectedPin);

    const { data: studentRows, error: studentsError } =
      schoolIdsToSearch.length > 0
        ? await studentQuery.in("school_id", schoolIdsToSearch)
        : await studentQuery;

    if (studentsError) throw studentsError;

    const studentCandidates = (studentRows as StudentRow[] | null) ?? [];
    if (!studentCandidates.length) {
      return NextResponse.json(
        { ok: false, message: "Student not found for this PIN." },
        { status: 404 },
      );
    }

    const primaryStudent =
      studentCandidates.find((row) => row.school_id === selectedSchoolId && !!row.photo_url) ??
      studentCandidates.find((row) => !!row.photo_url) ??
      studentCandidates.find((row) => row.school_id === selectedSchoolId) ??
      studentCandidates[0];

    const knownSchoolsById = new Map<string, SchoolRow>();
    for (const row of schoolRowsForMatch) {
      knownSchoolsById.set(row.id, row);
    }
    if (currentSchool?.id) {
      knownSchoolsById.set(currentSchool.id, currentSchool);
    }

    let activeSchool = knownSchoolsById.get(primaryStudent.school_id) ?? null;
    if (!activeSchool && primaryStudent.school_id) {
      const { data: fetchedSchool, error: fetchedSchoolError } = await service
        .from("schools")
        .select("id,school_name,photographer_id,package_profile_id,local_school_id,status,order_due_date,expiration_date")
        .eq("id", primaryStudent.school_id)
        .maybeSingle<SchoolRow>();

      if (fetchedSchoolError) throw fetchedSchoolError;
      activeSchool = fetchedSchool ?? null;
    }

    const activeProject: ProjectRow | null = activeSchool
      ? {
          id: activeSchool.id,
          portal_status: activeSchool.status ?? null,
          order_due_date: activeSchool.order_due_date ?? null,
          expiration_date: activeSchool.expiration_date ?? null,
        }
      : null;

    let packageRows: PackageRow[] = [];
    let backdropRows: BackdropRow[] = [];
    let photographerId: string | null = activeSchool?.photographer_id ?? null;
    let watermarkEnabled = true;
    let watermarkLogoUrl = "";
    let studioInfo = {
      businessName: "",
      logoUrl: "",
      address: "",
      phone: "",
      email: "",
    };

    if (activeSchool?.photographer_id) {
      const [packagesResult, backdropsResult, photographerResult] = await Promise.all([
        service
          .from("packages")
          .select("id,name,description,price_cents,items,profile_id,category")
          .eq("photographer_id", activeSchool.photographer_id)
          .eq("active", true)
          .order("price_cents", { ascending: true }),
        service
          .from("backdrop_catalog")
          .select("id,name,image_url,thumbnail_url,tier,price_cents,category,tags,sort_order")
          .eq("photographer_id", activeSchool.photographer_id)
          .eq("active", true)
          .order("sort_order", { ascending: true }),
        service
          .from("photographers")
          .select("id,watermark_enabled,watermark_logo_url,business_name,studio_address,studio_phone,studio_email")
          .eq("id", activeSchool.photographer_id)
          .maybeSingle(),
      ]);

      if (packagesResult.error) throw packagesResult.error;
      if (backdropsResult.error) throw backdropsResult.error;
      if (photographerResult.error) throw photographerResult.error;

      const availablePackages = (packagesResult.data ?? []) as PackageRow[];
      const normalizedProfile = clean(activeSchool.package_profile_id).toLowerCase();
      const profilePackages =
        normalizedProfile && normalizedProfile !== "default"
          ? availablePackages.filter(
              (pkg) => clean(pkg.profile_id) === clean(activeSchool.package_profile_id),
            )
          : [];

      packageRows = profilePackages.length ? profilePackages : availablePackages;
      backdropRows = (backdropsResult.data ?? []) as BackdropRow[];

      const photographer = photographerResult.data;
      if (photographer) {
        photographerId = photographer.id ?? photographerId;
        watermarkEnabled = photographer.watermark_enabled !== false;
        watermarkLogoUrl = photographer.watermark_logo_url || "";
        studioInfo = {
          businessName: photographer.business_name || "",
          logoUrl: photographer.watermark_logo_url || "",
          address: photographer.studio_address || "",
          phone: photographer.studio_phone || "",
          email: photographer.studio_email || "",
        };
      }
    }

    return NextResponse.json({
      ok: true,
      currentSchool,
      schoolRowsForMatch,
      studentCandidates,
      primaryStudent,
      activeSchool,
      activeProject,
      packages: packageRows,
      backdrops: backdropRows,
      photographerId,
      watermarkEnabled,
      watermarkLogoUrl,
      studioInfo,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load gallery context.",
      },
      { status: 500 },
    );
  }
}
