import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { rateLimit } from "@/lib/rate-limit";
import { MIGRATION_MAX_CSV_CHARS, previewGotphotoMigration } from "@/lib/gotphoto-migration";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const mappingSchema = z.object({
  sourceId: z.string().max(300).optional(), firstName: z.string().max(300).optional(),
  lastName: z.string().max(300).optional(), className: z.string().max(300).optional(),
  parentEmail: z.string().max(300).optional(), photoFilename: z.string().max(300).optional(),
  fullName: z.string().max(300).optional(), email: z.string().max(300).optional(), phone: z.string().max(300).optional(),
}).strict();
const bodySchema = z.object({
  action: z.enum(["preview", "import"]), schoolId: z.string().uuid(),
  kind: z.enum(["roster", "contacts"]), csv: z.string().max(MIGRATION_MAX_CSV_CHARS), mapping: mappingSchema,
  photos: z.array(z.object({ path: z.string().max(500), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(25 * 1024 * 1024) }).strict()).max(5000).optional(),
  requestKey: z.string().min(8).max(200).optional(), previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
const privateJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function authorized(request: NextRequest) {
  const { user, mfaSatisfied } = await resolveDashboardAuth(request);
  if (!user) return { response: privateJson({ ok: false, message: "Please sign in again." }, 401) };
  if (mfaSatisfied === false) return { response: privateJson({ ok: false, message: "Complete MFA before importing customer data." }, 403) };
  const service = createDashboardServiceClient();
  const { data: photographer, error } = await service.from("photographers").select("id").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!photographer) return { response: privateJson({ ok: false, message: "Photographer profile not found." }, 403) };
  return { user, service, photographer };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorized(request);
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.service.from("schools").select("id,school_name").eq("photographer_id", auth.photographer.id).order("school_name").limit(500);
    if (error) throw error;
    return privateJson({ ok: true, schools: data ?? [] });
  } catch { return privateJson({ ok: false, message: "School list is unavailable. Try again." }, 503); }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorized(request);
    if ("response" in auth) return auth.response;
    const { user, service, photographer } = auth;
    const limit = await rateLimit(photographer.id, { namespace: "gotphoto-migration", limit: 20, windowSeconds: 60 });
    if (!limit.allowed) return privateJson({ ok: false, message: "Too many previews. Please wait a moment." }, 429);
    const raw = await request.text();
    if (raw.length > 4_000_000) return privateJson({ ok: false, message: "Import request is too large." }, 413);
    let decoded: unknown;
    try { decoded = JSON.parse(raw); } catch { return privateJson({ ok: false, message: "Invalid JSON request." }, 400); }
    const parsed = bodySchema.safeParse(decoded);
    if (!parsed.success) return privateJson({ ok: false, message: "Invalid import request." }, 400);
    const body = parsed.data;
    const { data: school, error: schoolError } = await service.from("schools").select("id,school_name").eq("id", body.schoolId).eq("photographer_id", photographer.id).maybeSingle();
    if (schoolError) throw schoolError;
    if (!school) return privateJson({ ok: false, requiresPreview: true, message: "School not found." }, 404);
    const agreement = await guardAgreement({ service, userId: user.id });
    if (!agreement.ok) return privateJson(agreement.body, agreement.status);
    const inputFingerprint = digest([user.id, photographer.id, school.id, body.kind, body.csv,
      Object.entries(body.mapping).sort(([a], [b]) => a.localeCompare(b)), [...(body.photos ?? [])].sort((a, b) => a.path.localeCompare(b.path))]);
    if (body.action === "import") {
      if (!body.requestKey || !body.previewFingerprint) return privateJson({ ok: false, requiresPreview: true, message: "Preview and review this import first." }, 400);
      const prior = await service.from("gotphoto_import_requests").select("school_id,input_fingerprint,receipt").eq("photographer_id", photographer.id).eq("request_key", body.requestKey).maybeSingle();
      if (prior.error) throw prior.error;
      if (prior.data) {
        if (prior.data.school_id !== school.id || prior.data.input_fingerprint !== inputFingerprint) return privateJson({ ok: false, message: "This request belongs to different import data." }, 409);
        return privateJson({ ok: true, receipt: prior.data.receipt, replayed: true });
      }
    }
    // Page the identity inventory completely; a partial list cannot authorize an import.
    const existingStudentIds: string[] = [], existingContactEmails: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      if (offset >= 100_000) throw Error("The current identity inventory is too large for this importer.");
      const query = body.kind === "roster"
        ? service.from("students").select("external_student_id").eq("school_id", school.id).order("id")
        : service.from("crm_contacts").select("email_normalized").eq("photographer_id", photographer.id).order("id");
      const { data, error } = await query.range(offset, offset + 999);
      if (error) throw error;
      for (const row of data ?? []) {
        if ("external_student_id" in row && row.external_student_id) existingStudentIds.push(row.external_student_id);
        if ("email_normalized" in row && row.email_normalized) existingContactEmails.push(row.email_normalized);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
    let preview;
    try { preview = previewGotphotoMigration({ ...body, existingStudentIds, existingContactEmails }); }
    catch (error) { return privateJson({ ok: false, requiresPreview: true, message: error instanceof Error ? error.message : "CSV could not be reviewed." }, 400); }
    const previewFingerprint = digest([inputFingerprint, preview]);
    if (body.action === "preview") return privateJson({ ok: true, school, preview, previewFingerprint });
    if (preview.issues.length || body.previewFingerprint !== previewFingerprint) return privateJson({ ok: false, requiresPreview: true, message: "The CSV, mapping or existing records changed. Resolve issues and preview again." }, 409);
    if (!preview.students.length && !preview.contacts.length) return privateJson({ ok: false, requiresPreview: true, message: "There are no new records to import. Existing records were preserved." }, 409);
    const { data: receipt, error } = await service.rpc("import_reviewed_gotphoto_csv", {
      p_actor_user_id: user.id, p_photographer_id: photographer.id, p_school_id: school.id,
      p_request_key: body.requestKey, p_input_fingerprint: inputFingerprint,
      p_students: preview.students, p_contacts: preview.contacts,
    });
    if (error) return privateJson({ ok: false, message: "Import could not be confirmed. Keep this request and retry it to reconcile before starting another import." }, 409);
    return privateJson({ ok: true, receipt, replayed: false });
  } catch {
    return privateJson({ ok: false, message: "Migration service is unavailable. No import is confirmed; retry the same request to reconcile." }, 503);
  }
}
