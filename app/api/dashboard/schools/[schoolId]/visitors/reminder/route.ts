import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { guardAgreement } from "@/lib/require-agreement";
import { recordAudit } from "@/lib/audit";
import {
  isSchoolVisitorReminderTimeZone,
  normalizeSchoolVisitorDeadlineReminder,
} from "@/lib/event-gallery-settings";
import { readSchoolVisitorEmailTemplate } from "@/lib/school-visitor-email-template";
import { compareSchoolVisitorClasses, isSchoolVisitorClassRangeValid } from "@/lib/school-visitor-filters";
import { calendarDateInputValue } from "@/lib/calendar-dates";
import { loadSchoolDeadlineReminderStatus } from "@/lib/school-deadline-reminders";
import { loadSchoolDeadlineReminderPhotoClasses } from "@/lib/school-deadline-reminder-photo-classes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SaveReminderSchema = z.object({
  enabled: z.boolean(),
  expectedVersion: z.string().min(1).max(128).nullable(),
  timeZone: z.string().max(100).refine(isSchoolVisitorReminderTimeZone, "Choose a valid IANA time zone.").optional(),
  classMode: z.enum(["all", "range"]).optional(),
  classFrom: z.string().max(200).optional(),
  classTo: z.string().max(200).optional(),
  photosOnly: z.literal(true).optional(),
});

type SchoolRow = {
  id: string;
  photographer_id: string;
  gallery_settings: unknown;
  order_due_date: string | null;
  updated_at: string | null;
};
type ReminderStatus = {
  deadline: string;
  accepted: number;
  failed: number;
  pending: number;
  excluded: number;
  lastAttemptAt: string | null;
  completedAt: string | null;
  message: string | null;
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
function failure(message: string, status: number, code?: string) {
  return privateJson({ ok: false, message, error: message, ...(code ? { code } : {}) }, status);
}
function settingsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function validDeadline(value: string | null) {
  const date = calendarDateInputValue(value);
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}
function snapshot(school: SchoolRow) {
  const settings = normalizeSchoolVisitorDeadlineReminder(settingsObject(school.gallery_settings).visitorDeadlineReminder);
  const template = readSchoolVisitorEmailTemplate(school.gallery_settings);
  const templateReady = Boolean(template?.subject.trim() && template.headline.trim() && template.message.trim());
  const deadline = validDeadline(school.order_due_date);
  const plannedReminderDate = deadline
    ? new Date(new Date(`${deadline}T00:00:00.000Z`).getTime() - 86_400_000).toISOString().slice(0, 10) : null;
  const statusMessage = !settings.enabled ? undefined : !templateReady
    ? "Automatic reminders are waiting for a saved email subject, headline and message."
    : !deadline ? "Automatic reminders are waiting for a valid order deadline."
    : settings.classMode === "range" && !isSchoolVisitorClassRangeValid(settings.classFrom, settings.classTo)
      ? "Automatic reminders are waiting for a valid class range." : undefined;
  return {
    settings, templateReady, dueDate: school.order_due_date ?? null, plannedReminderDate,
    version: school.updated_at ?? null, ...(statusMessage ? { statusMessage } : {}),
  };
}

async function authorizedSchool(request: NextRequest, schoolId: string, writing: boolean) {
  const { user, mfaSatisfied } = await resolveDashboardAuth(request);
  if (!user) return { response: failure("Please sign in again.", 401) };
  if (mfaSatisfied !== true) return { response: failure("Complete two-step verification before using automatic reminders.", 403, "mfa_required") };
  const service = createDashboardServiceClient();
  if (writing) {
    const guard = await guardAgreement({ service, userId: user.id });
    if (!guard.ok) return { response: privateJson({ ...guard.body, ok: false, message: guard.body.error }, guard.status) };
  }
  const { data: photographer, error: photographerError } = await service
    .from("photographers").select("id").eq("user_id", user.id).maybeSingle();
  if (photographerError) throw photographerError;
  if (!photographer?.id) return { response: failure("Photographer profile not found.", 403) };
  const { data: school, error: schoolError } = await service.from("schools")
    .select("id,photographer_id,gallery_settings,order_due_date,updated_at")
    .eq("id", schoolId).eq("photographer_id", photographer.id).maybeSingle<SchoolRow>();
  if (schoolError) throw schoolError;
  if (!school) return { response: failure("School not found.", 404) };
  return { service, school, photographer, user };
}

type Context = { params: Promise<{ schoolId: string }> };

async function photoClassDetails(auth: Awaited<ReturnType<typeof authorizedSchool>>) {
  if (auth.response) return { photoClasses: null };
  try {
    const classes = await loadSchoolDeadlineReminderPhotoClasses(auth.service, auth.school.id);
    return { photoClasses: [...classes].sort(compareSchoolVisitorClasses) };
  } catch {
    return {
      photoClasses: null,
      eligibilityMessage: "The classes with available gallery photos could not be confirmed. Automatic reminders will wait until photo availability can be checked.",
    };
  }
}

// The worker writes only these scoped summary rows. A missing row means that
// the automatic reminder has not run; it never means that messages were sent.
async function reminderStatus(auth: Awaited<ReturnType<typeof authorizedSchool>>): Promise<ReminderStatus | null> {
  if (auth.response) return null;
  const status = await loadSchoolDeadlineReminderStatus(auth.service, auth.photographer.id, auth.school.id, validDeadline(auth.school.order_due_date) ?? undefined);
  if (status && status.deadline === validDeadline(auth.school.order_due_date)) return status;
  const current = snapshot(auth.school);
  if (!current.settings.enabled || !current.plannedReminderDate) return null;
  const parts = new Map(new Intl.DateTimeFormat("en-CA", { timeZone: current.settings.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const today = `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
  if (current.plannedReminderDate >= today) return null;
  return {
    deadline: validDeadline(auth.school.order_due_date)!, accepted: 0, failed: 0, pending: 0, excluded: 0,
    lastAttemptAt: null, completedAt: null,
    message: "The day-before reminder date has passed. No automatic email was sent for this deadline.",
  };
}

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const auth = await authorizedSchool(request, (await params).schoolId, false);
    if (auth.response) return auth.response;
    const [status, photos] = await Promise.all([reminderStatus(auth), photoClassDetails(auth)]);
    return privateJson({ ok: true, ...snapshot(auth.school), status, ...photos });
  } catch {
    return failure("Could not load automatic reminder settings and delivery status. Please try again.", 503);
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const auth = await authorizedSchool(request, (await params).schoolId, true);
    if (auth.response) return auth.response;
    const parsed = await parseJson(request, SaveReminderSchema);
    if (!parsed.ok) return parsed.response;
    const current = snapshot(auth.school);
    if (current.version !== parsed.data.expectedVersion) {
      return privateJson({ ok: false, message: "This gallery changed in another window. Reload before changing its automatic reminder.", code: "reminder_conflict", ...current }, 409);
    }
    const settings = normalizeSchoolVisitorDeadlineReminder({ ...current.settings, ...parsed.data });
    if (settings.enabled && settings.classMode === "range" && !isSchoolVisitorClassRangeValid(settings.classFrom, settings.classTo)) {
      return failure("Choose a valid starting and ending class for the automatic reminder.", 400, "reminder_class_range_required");
    }
    if (settings.enabled) {
      if (!current.plannedReminderDate) return failure("Set this school's order deadline before enabling automatic reminders.", 400, "reminder_deadline_required");
      const template = readSchoolVisitorEmailTemplate(auth.school.gallery_settings);
      if (!template?.subject.trim() || !template.headline.trim() || !template.message.trim()) {
        return failure("Save an email subject, headline and message before enabling automatic reminders.", 400, "reminder_template_required");
      }
    }
    if (JSON.stringify(settings) === JSON.stringify(current.settings)) {
      const [status, photos] = await Promise.all([reminderStatus(auth), photoClassDetails(auth)]);
      return privateJson({ ok: true, ...current, status, ...photos });
    }
    const previousTime = current.version ? Date.parse(current.version) : NaN;
    const version = new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
    let update = auth.service.from("schools").update({
      gallery_settings: { ...settingsObject(auth.school.gallery_settings), visitorDeadlineReminder: settings }, updated_at: version,
    }).eq("id", auth.school.id).eq("photographer_id", auth.photographer.id);
    update = current.version === null ? update.is("updated_at", null) : update.eq("updated_at", current.version);
    update = auth.school.order_due_date === null ? update.is("order_due_date", null) : update.eq("order_due_date", auth.school.order_due_date);
    const { data: saved, error } = await update.select("id,photographer_id,gallery_settings,order_due_date,updated_at").maybeSingle<SchoolRow>();
    if (error) throw error;
    if (!saved) return failure("This gallery changed while the automatic reminder was saving. Reload before trying again.", 409, "reminder_conflict");
    await recordAudit({
      request, actorUserId: auth.user.id, actorPhotographerId: auth.photographer.id,
      action: "school.visitor_deadline_reminder_save", entityType: "school", entityId: saved.id,
      targetPhotographerId: auth.photographer.id, result: "ok",
      before: { visitorDeadlineReminder: current.settings }, after: { visitorDeadlineReminder: settings },
    });
    // Disabling must still succeed if delivery status is temporarily
    // unavailable after the settings write has already been confirmed.
    let statusMessage: string | undefined;
    const savedAuth = { ...auth, school: saved };
    const [status, photos] = await Promise.all([
      reminderStatus(savedAuth).catch(() => { statusMessage = "Settings saved. Delivery status is temporarily unavailable; reload to check it."; return null; }),
      photoClassDetails(savedAuth),
    ]);
    return privateJson({ ok: true, ...snapshot(saved), status, ...photos, ...(statusMessage ? { statusMessage } : {}) });
  } catch {
    return failure("Could not save automatic reminder settings. Please try again.", 503);
  }
}
