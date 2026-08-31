import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { guardAgreement } from "@/lib/require-agreement";
import {
  normalizeStudentRecipientEmail,
  studentRecipientEmailError,
} from "@/lib/student-recipient-email";
import {
  loadSchoolPhotoTombstones,
  schoolPhotoFamilyForKey,
  storageKeyFromSchoolPhotoReference,
  tombstoneFamilySet,
} from "@/lib/school-photo-deletions";

export const dynamic = "force-dynamic";

const StudentPayloadSchema = z.object({
  first_name: z.string().max(200).nullable().optional(),
  last_name: z.string().max(200).nullable().optional(),
  pin: z.string().max(64).nullable().optional(),
  class_name: z.string().max(200).nullable().optional(),
  role: z.string().max(64).nullable().optional(),
  student_id: z.string().max(200).nullable().optional(),
  external_student_id: z.string().max(200).nullable().optional(),
  photo_url: z.string().max(2000).nullable().optional(),
  folder_name: z.string().max(500).nullable().optional(),
  parent_email: z.string().max(254).nullable().optional(),
  parentEmail: z.string().max(254).nullable().optional(),
  email: z.string().max(254).nullable().optional(),
});

const DesktopSyncBodySchema = z.object({
  schoolId: z.string().min(1).max(128).nullable().optional(),
  students: z.array(StudentPayloadSchema).max(10_000).nullable().optional(),
});

type StudentPayload = z.infer<typeof StudentPayloadSchema>;

type StudentRow = {
  id: string;
  school_id: string;
  first_name: string;
  last_name: string | null;
  pin: string | null;
  class_name: string | null;
  role: string | null;
  external_student_id: string | null;
  photo_url: string | null;
  folder_name: string | null;
  parent_email: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function incomingParentEmail(student: StudentPayload) {
  const keyProvided =
    hasOwn(student, "parent_email") ||
    hasOwn(student, "parentEmail") ||
    hasOwn(student, "email");
  const raw = hasOwn(student, "parent_email")
    ? student.parent_email
    : hasOwn(student, "parentEmail")
      ? student.parentEmail
      : student.email;
  const value = normalizeStudentRecipientEmail(raw);
  return {
    // Older clients commonly serialize unknown optional strings as "". Treat
    // that as omitted so a retry cannot erase an email already in Cloud.
    provided: keyProvided && value !== null,
    value,
    error: keyProvided ? studentRecipientEmailError(raw) : null,
  };
}

function stableExternalStudentId(params: {
  schoolId: string;
  student: StudentPayload;
  firstName: string;
  lastName: string | null;
  className: string | null;
  pin: string | null;
  folderName: string | null;
}) {
  const explicit =
    clean(params.student.external_student_id) || clean(params.student.student_id);
  if (explicit) return { id: explicit, legacy: false };

  // Old desktop clients did not always send an external ID. Give their exact
  // roster identity a deterministic ID so a network retry cannot append a
  // second row. Folder and PIN are preferred over names because they are less
  // likely to collide; ambiguous duplicate identities are rejected below.
  const identity = params.folderName
    ? `folder:${params.folderName.toLowerCase()}`
    : params.pin
      ? `pin:${params.pin.toLowerCase()}`
      : `name:${params.firstName.toLowerCase()}\u0000${(params.lastName ?? "").toLowerCase()}\u0000${(params.className ?? "").toLowerCase()}`;
  const digest = createHash("sha256")
    .update(`${params.schoolId}\u0000${identity}`)
    .digest("hex")
    .slice(0, 40);
  return { id: `desktop-legacy-${digest}`, legacy: true };
}

/**
 * GET /api/dashboard/schools/desktop-sync
 *
 * Fetch all students for a school, intended for Flutter/desktop app sync.
 * Query params:
 *   - schoolId (required): the school UUID
 *   - since (optional): ISO timestamp — only return students updated after this time
 */
export async function GET(request: NextRequest) {
  try {
    const syncCutoff = new Date().toISOString();
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const schoolId = clean(searchParams.get("schoolId"));
    const since = clean(searchParams.get("since"));

    if (!schoolId) {
      return NextResponse.json(
        { ok: false, message: "schoolId is required." },
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

    // Verify the photographer owns this school
    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name,local_school_id,status")
      .eq("id", schoolId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (schoolError) throw schoolError;
    if (!schoolRow) {
      return NextResponse.json(
        { ok: false, message: "School not found." },
        { status: 404 },
      );
    }

    let query = service
      .from("students")
      .select(
        "id,school_id,first_name,last_name,pin,class_name,role,external_student_id,photo_url,folder_name,parent_email,created_at,updated_at",
      )
      .eq("school_id", schoolId)
      .order("class_name", { ascending: true })
      .order("first_name", { ascending: true });

    if (since) {
      query = query.gte("updated_at", since);
    }

    const { data: students, error: studentsError } = await query;

    if (studentsError) throw studentsError;

    const photoDeletions = await loadSchoolPhotoTombstones(service, schoolId, {
      since,
    });

    return NextResponse.json({
      ok: true,
      school: schoolRow,
      students: (students ?? []) as StudentRow[],
      photoDeletions: photoDeletions.map((row) => ({
        id: row.id,
        storageKey: row.storage_key,
        storageFamily: row.storage_family,
        studentId: row.student_id,
        deletedAt: row.created_at,
      })),
      syncedAt: syncCutoff,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch school students for sync.",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/dashboard/schools/desktop-sync
 *
 * Sync students from Flutter/desktop app to the cloud.
 * Accepts a batch of students — creates new ones and updates existing ones.
 *
 * Body:
 *   - schoolId (required): the school UUID
 *   - students (required): array of StudentPayload
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }
    // Agreement gate — the desktop app syncs through here, so this stops
    // a user from syncing rosters before accepting the Studio OS Cloud
    // legal agreement on the web.
    {
      const service = createDashboardServiceClient();
      const guard = await guardAgreement({ service, userId: user.id });
      if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    }

    const parsed = await parseJson(request, DesktopSyncBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const schoolId = clean(body.schoolId);
    if (!schoolId) {
      return NextResponse.json(
        { ok: false, message: "schoolId is required." },
        { status: 400 },
      );
    }

    const incomingStudents = Array.isArray(body.students) ? body.students : [];
    if (!incomingStudents.length) {
      return NextResponse.json({
        ok: true,
        created: 0,
        updated: 0,
        students: [],
      });
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

    // Verify the photographer owns this school
    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name,local_school_id,photographer_id")
      .eq("id", schoolId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (schoolError) throw schoolError;
    if (!schoolRow) {
      return NextResponse.json(
        { ok: false, message: "School not found." },
        { status: 404 },
      );
    }

    const deletedFamilies = tombstoneFamilySet(
      await loadSchoolPhotoTombstones(service, schoolId),
    );

    const preparedByExternalId = new Map<string, {
      row: Record<string, unknown>;
      emailProvided: boolean;
      legacy: boolean;
    }>();
    const incomingExternalIdByPin = new Map<string, string>();
    for (const incoming of incomingStudents) {
      const firstName = clean(incoming.first_name);
      if (!firstName) continue;

      const lastName = clean(incoming.last_name) || null;
      const className = clean(incoming.class_name) || null;
      const pin = clean(incoming.pin) || null;
      const role = clean(incoming.role) || "Student";
      const photoUrl = clean(incoming.photo_url) || null;
      const folderName = clean(incoming.folder_name) || null;
      const email = incomingParentEmail(incoming);
      if (email.error) {
        return NextResponse.json(
          { ok: false, message: email.error },
          { status: 400 },
        );
      }

      const identity = stableExternalStudentId({
        schoolId,
        student: incoming,
        firstName,
        lastName,
        className,
        pin,
        folderName,
      });
      if (pin) {
        const existingIdentity = incomingExternalIdByPin.get(pin);
        if (existingIdentity && existingIdentity !== identity.id) {
          return NextResponse.json(
            {
              ok: false,
              message:
                "Two students cannot share the same gallery PIN in one school.",
            },
            { status: 409 },
          );
        }
        incomingExternalIdByPin.set(pin, identity.id);
      }
      const row: Record<string, unknown> = {
        school_id: schoolId,
        first_name: firstName,
        last_name: lastName,
        pin,
        class_name: className,
        role,
        external_student_id: identity.id,
        photo_url: photoUrl,
        folder_name: folderName,
        ...(email.provided ? { parent_email: email.value } : {}),
      };

      const previous = preparedByExternalId.get(identity.id);
      if (previous) {
        if (JSON.stringify(previous.row) !== JSON.stringify(row)) {
          return NextResponse.json(
            {
              ok: false,
              message:
                "Two roster entries use the same student identity. Give each student a unique ID or PIN and retry.",
            },
            { status: 409 },
          );
        }
        continue;
      }
      preparedByExternalId.set(identity.id, {
        row,
        emailProvided: email.provided,
        legacy: identity.legacy,
      });
    }

    const prepared = [...preparedByExternalId.values()];
    if (!prepared.length) {
      return NextResponse.json({ ok: true, created: 0, updated: 0, students: [] });
    }

    // Fetch existing students to calculate a stable create/update summary and
    // attach deterministic legacy IDs to rows created by older releases.
    const { data: existingStudents, error: existingError } = await service
      .from("students")
      .select("id,external_student_id,first_name,last_name,class_name,pin,folder_name,photo_url")
      .eq("school_id", schoolId);

    if (existingError) throw existingError;

    type ExistingStudentRef = {
      id: string;
      externalId: string;
      pin: string;
      photoUrl: string | null;
    };
    const existingByExternalId = new Map<string, ExistingStudentRef>();
    const existingByPin = new Map<string, ExistingStudentRef>();
    const unlinkedLegacyRows = new Map<string, ExistingStudentRef[]>();

    for (const student of existingStudents ?? []) {
      const extId = clean((student as { external_student_id?: string | null }).external_student_id);
      const existingPin = clean((student as { pin?: string | null }).pin);
      const reference: ExistingStudentRef = {
        id: (student as { id: string }).id,
        externalId: extId,
        pin: existingPin,
        photoUrl: clean((student as { photo_url?: string | null }).photo_url) || null,
      };
      if (existingPin) existingByPin.set(existingPin, reference);
      if (extId) {
        existingByExternalId.set(extId, reference);
        continue;
      }
      const legacyIdentity = stableExternalStudentId({
        schoolId,
        student: {},
        firstName: clean((student as { first_name?: string | null }).first_name),
        lastName: clean((student as { last_name?: string | null }).last_name) || null,
        className: clean((student as { class_name?: string | null }).class_name) || null,
        pin: clean((student as { pin?: string | null }).pin) || null,
        folderName: clean((student as { folder_name?: string | null }).folder_name) || null,
      });
      const rows = unlinkedLegacyRows.get(legacyIdentity.id) ?? [];
      rows.push(reference);
      unlinkedLegacyRows.set(legacyIdentity.id, rows);
    }

    for (const item of prepared) {
      const externalId = String(item.row.external_student_id);
      if (!item.legacy || existingByExternalId.has(externalId)) continue;
      const candidates = unlinkedLegacyRows.get(externalId) ?? [];
      if (candidates.length > 1) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "More than one existing student matches a legacy roster identity. Assign unique student IDs before syncing.",
          },
          { status: 409 },
        );
      }
      if (candidates.length !== 1) continue;
      const { error: linkError } = await service
        .from("students")
        .update({ external_student_id: externalId })
        .eq("id", candidates[0].id)
        .eq("school_id", schoolId);
      if (linkError) throw linkError;
      candidates[0].externalId = externalId;
      existingByExternalId.set(externalId, candidates[0]);
    }

    // A modern roster can repair an older row that pre-dates external IDs by
    // its unique PIN. Otherwise fail explicitly instead of letting portal PIN
    // lookup become ambiguous or relying on a database error after the batch.
    for (const item of prepared) {
      const externalId = String(item.row.external_student_id);
      const pin = clean(String(item.row.pin ?? ""));
      if (!pin) continue;
      const owner = existingByPin.get(pin);
      if (!owner || owner.externalId === externalId) continue;
      if (!owner.externalId) {
        const { error: linkError } = await service
          .from("students")
          .update({ external_student_id: externalId })
          .eq("id", owner.id)
          .eq("school_id", schoolId)
          .is("external_student_id", null);
        if (linkError) throw linkError;
        owner.externalId = externalId;
        existingByExternalId.set(externalId, owner);
        continue;
      }
      return NextResponse.json(
        {
          ok: false,
          message:
            "That gallery PIN is already assigned to another student in this school.",
        },
        { status: 409 },
      );
    }

    // A desktop retry must not resurrect an image that the photographer
    // removed online. Keep a still-valid existing representative when
    // possible; otherwise clear the tombstoned reference before upsert.
    for (const item of prepared) {
      const externalId = String(item.row.external_student_id);
      const existing = existingByExternalId.get(externalId);
      const incomingPhotoUrl = clean(String(item.row.photo_url ?? "")) || null;
      const incomingFamily = schoolPhotoFamilyForKey(
        storageKeyFromSchoolPhotoReference(incomingPhotoUrl),
      );
      const incomingPhotoWasDeleted =
        !!incomingFamily && deletedFamilies.has(incomingFamily);
      if (!incomingPhotoWasDeleted) continue;
      const existingFamily = schoolPhotoFamilyForKey(
        storageKeyFromSchoolPhotoReference(existing?.photoUrl),
      );
      item.row.photo_url =
        existingFamily && !deletedFamilies.has(existingFamily)
          ? existing?.photoUrl ?? null
          : null;
    }

    const created = prepared.filter(
      (item) => !existingByExternalId.has(String(item.row.external_student_id)),
    ).length;
    const updated = prepared.length - created;
    const syncedStudents: StudentRow[] = [];
    const selectColumns =
      "id,school_id,first_name,last_name,pin,class_name,role,external_student_id,photo_url,folder_name,parent_email,created_at,updated_at";

    for (const batch of [
      {
        rows: prepared.filter((item) => item.emailProvided).map((item) => item.row),
        defaultToNull: true,
      },
      {
        rows: prepared.filter((item) => !item.emailProvided).map((item) => item.row),
        defaultToNull: false,
      },
    ]) {
      if (!batch.rows.length) continue;
      const { data, error } = await service
        .from("students")
        .upsert(batch.rows, {
          onConflict: "school_id,external_student_id",
          defaultToNull: batch.defaultToNull,
        })
        .select(selectColumns);
      if (error?.code === "23505") {
        return NextResponse.json(
          {
            ok: false,
            message:
              "A student ID or gallery PIN is already assigned to another student in this school.",
          },
          { status: 409 },
        );
      }
      if (error) throw error;
      syncedStudents.push(...((data ?? []) as StudentRow[]));
    }

    return NextResponse.json({
      ok: true,
      created,
      updated,
      students: syncedStudents,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to sync students from desktop.",
      },
      { status: 500 },
    );
  }
}
