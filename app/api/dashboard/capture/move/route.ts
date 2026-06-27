import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { r2Copy, r2DeleteWithVariants, r2PublicUrl, r2VariantKeys } from "@/lib/r2";
import { r2KeyFromAnyUrl } from "@/lib/r2-signed-urls";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

// Mirror the capture-upload folder convention so the moved photo lands in a
// folder the gallery enumerates for the destination student.
function safeSegment(value: string, fallback: string) {
  const cleaned = clean(value)
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function baseNameNoVariant(fileName: string) {
  return clean(fileName)
    .replace(/\.[^.]+$/i, "")
    .replace(/_(preview|thumbnail|cutout|nobg)$/i, "");
}

type StudentRow = {
  id: string;
  school_id: string | null;
  first_name: string | null;
  last_name: string | null;
  pin: string | null;
  class_name: string | null;
  folder_name: string | null;
  photo_url: string | null;
};

type SchoolRow = { id: string; local_school_id: string | null };

// Capture move / re-assign (mobile Sort panel).
//
// Moves a photo (and its thumbnail/preview variants) from one student's R2
// folder into another student's folder — the "wrong kid / wrong QR scan" fix.
// Mirrors the desktop `_reassignSelected` (disk move + rename) but done
// server-side in R2. Scoped so a photographer can only move within their own
// school's storage prefix.
export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createDashboardServiceClient();

  const guard = await guardAgreement({ service, userId: auth.user.id });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const { data: photographer } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle<{ id: string }>();
  if (!photographer?.id) {
    return NextResponse.json(
      { error: "Photographer profile not found." },
      { status: 403 },
    );
  }

  let body: {
    schoolId?: string;
    key?: string;
    fromStudentId?: string;
    toStudentId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const schoolId = clean(body.schoolId);
  const key = clean(body.key);
  const fromStudentId = clean(body.fromStudentId);
  const toStudentId = clean(body.toStudentId);

  if (!schoolId || !key || !toStudentId) {
    return NextResponse.json(
      { error: "schoolId, key and toStudentId are required." },
      { status: 400 },
    );
  }
  if (key.includes("..") || key.startsWith("/") || key.includes("://")) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }

  const { data: school } = await service
    .from("schools")
    .select("id, local_school_id")
    .eq("id", schoolId)
    .eq("photographer_id", photographer.id)
    .maybeSingle<SchoolRow>();
  if (!school?.id) {
    return NextResponse.json(
      { error: "School not found for this account." },
      { status: 404 },
    );
  }

  const schoolBaseId = clean(school.local_school_id) || school.id;
  if (!key.startsWith(`${schoolBaseId}/`)) {
    return NextResponse.json(
      { error: "That photo is not in this school." },
      { status: 403 },
    );
  }

  const { data: dest } = await service
    .from("students")
    .select(
      "id, school_id, first_name, last_name, pin, class_name, folder_name, photo_url",
    )
    .eq("id", toStudentId)
    .eq("school_id", schoolId)
    .maybeSingle<StudentRow>();
  if (!dest?.id) {
    return NextResponse.json(
      { error: "Destination student not found in this school." },
      { status: 404 },
    );
  }

  const destClass = safeSegment(dest.class_name ?? "", "Unassigned");
  const destFallback = safeSegment(
    [clean(dest.last_name), clean(dest.first_name), clean(dest.pin)]
      .filter(Boolean)
      .join(" "),
    `student ${dest.id.slice(0, 8)}`,
  );
  // Match the Flutter "Last First PIN" folder convention (not the
  // studentId_Last_First students.folder_name) so a re-assigned photo lands in
  // the same folder the Mac app uses for that student.
  const destFolderName = destFallback;
  const destFolder = `${schoolBaseId}/${destClass}/${destFolderName}`;

  const origBasename = key.split("/").pop() ?? "";
  if (!origBasename) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }
  const destKey = `${destFolder}/${origBasename}`;

  if (destKey === key) {
    return NextResponse.json({ ok: true, newKey: destKey, noop: true });
  }

  // Copy the original (must succeed), then variants best-effort, then remove source.
  try {
    await r2Copy(key, destKey);
  } catch (error) {
    console.error("[capture/move] copy failed", error);
    return NextResponse.json(
      { error: "Move failed. Please try again." },
      { status: 502 },
    );
  }
  for (const vKey of r2VariantKeys(key)) {
    if (vKey === key) continue;
    const vName = vKey.split("/").pop();
    if (!vName) continue;
    try {
      await r2Copy(vKey, `${destFolder}/${vName}`);
    } catch {
      /* variant may not exist — skip */
    }
  }
  try {
    await r2DeleteWithVariants([key]);
  } catch (error) {
    console.error("[capture/move] source delete failed (copy already done)", error);
  }

  // Fix cover photos: clear the source student's cover if it was the moved
  // photo; set the destination's cover if it has none.
  const movedBase = baseNameNoVariant(origBasename);
  const movedFolder = key.slice(0, key.lastIndexOf("/"));

  if (fromStudentId) {
    const { data: fromStudent } = await service
      .from("students")
      .select("id, photo_url")
      .eq("id", fromStudentId)
      .eq("school_id", schoolId)
      .maybeSingle<{ id: string; photo_url: string | null }>();
    const fromKey = fromStudent?.photo_url
      ? r2KeyFromAnyUrl(fromStudent.photo_url)
      : "";
    if (fromKey) {
      const fromFolder = fromKey.slice(0, fromKey.lastIndexOf("/"));
      const fromBase = baseNameNoVariant(fromKey.split("/").pop() ?? "");
      if (fromFolder === movedFolder && fromBase === movedBase) {
        await service
          .from("students")
          .update({ photo_url: null })
          .eq("id", fromStudentId);
      }
    }
  }

  const destUrl = r2PublicUrl(destKey);
  if (!clean(dest.photo_url) && destUrl) {
    await service
      .from("students")
      .update({ photo_url: destUrl })
      .eq("id", dest.id);
  }

  return NextResponse.json({ ok: true, newKey: destKey });
}
