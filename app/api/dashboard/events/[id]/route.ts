import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

type StudentRow = {
  id: string;
  class_name: string | null;
  role: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizeRole(rawRole: string | null | undefined): string {
  const role = clean(rawRole).toLowerCase();
  if (!role) return "Unassigned";
  if (role === "student" || role === "students") return "Student";
  if (role === "teacher" || role === "teachers") return "Teacher";
  if (role === "coach" || role === "coaches") return "Coach";
  if (["principal", "head principal", "school principal"].includes(role)) return "Principal";
  if (["office", "office staff", "admin", "administrator", "administration", "front office"].includes(role)) return "Office Staff";
  if (["staff", "faculty", "employee", "employees", "support staff", "school staff"].includes(role)) return "Staff";
  return clean(rawRole) || "Unassigned";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { id: projectId } = await context.params;
    const service = createDashboardServiceClient();

    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const { data: projectRow, error: projectError } = await service
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!projectRow) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    let classesCount = 0;
    let rolesCount = 0;
    let peopleCount = 0;

    const schoolId = projectRow.linked_school_id || projectRow.school_id || null;

    if (schoolId) {
      const { data: studentRows, error: studentsError } = await service
        .from("students")
        .select("id,class_name,role")
        .eq("school_id", schoolId);

      if (studentsError) throw studentsError;

      const students = (studentRows ?? []) as StudentRow[];
      peopleCount = students.length;
      const classSet = new Set<string>();
      const roleSet = new Set<string>();

      for (const row of students) {
        const className = clean(row.class_name);
        const role = normalizeRole(row.role);
        if (className) classSet.add(className);
        else if (role !== "Student") roleSet.add(role);
      }

      classesCount = classSet.size;
      rolesCount = roleSet.size;
    }

    const { data: collectionRows, error: collectionsError } = await service
      .from("collections")
      .select(
        "id,title,kind,slug,cover_photo_url,sort_order,created_at,access_mode,access_pin",
      )
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (collectionsError) throw collectionsError;

    const collections = (collectionRows ?? []).filter((row) => {
      const kind = clean((row as { kind?: string | null }).kind).toLowerCase();
      return kind === "album" || kind === "class" || kind === "gallery" || !kind;
    });

    let galleriesCount = 0;
    let albumsCount = 0;
    for (const row of collections as Array<{ kind?: string | null }>) {
      const kind = clean(row.kind).toLowerCase();
      if (kind === "gallery") galleriesCount += 1;
      else albumsCount += 1;
    }

    const { data: mediaRows, error: mediaError } = await service
      .from("media")
      .select("id,collection_id,preview_url,thumbnail_url,filename,created_at,sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (mediaError) throw mediaError;

    return NextResponse.json({
      ok: true,
      project: projectRow,
      collections,
      media: mediaRows ?? [],
      mediaCount: (mediaRows ?? []).length,
      classesCount,
      rolesCount,
      peopleCount,
      galleriesCount,
      albumsCount,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load project.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { id: projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      cover_photo_url?: string | null;
    };

    if (!Object.prototype.hasOwnProperty.call(body, "cover_photo_url")) {
      return NextResponse.json(
        { ok: false, message: "A cover photo URL is required." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();

    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const { data: projectData, error: projectError } = await service
      .from("projects")
      .update({
        cover_photo_url: clean(body.cover_photo_url) || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .select(
        "id,title,client_name,workflow_type,status,portal_status,shoot_date,event_date,cover_photo_url",
      )
      .maybeSingle();

    if (projectError) throw projectError;
    if (!projectData) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      project: projectData,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to update project.",
      },
      { status: 500 },
    );
  }
}
