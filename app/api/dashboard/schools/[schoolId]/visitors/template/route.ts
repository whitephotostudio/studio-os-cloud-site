import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { guardAgreement } from "@/lib/require-agreement";
import { recordAudit } from "@/lib/audit";
import { mergeSchoolVisitorEmailTemplate, readSchoolVisitorEmailTemplate } from "@/lib/school-visitor-email-template";
import { readSchoolVisitorEmailSettingsRevision } from "@/lib/event-gallery-settings";

export const dynamic = "force-dynamic";

const SaveTemplateSchema = z.object({
  template: z.object({
    subject: z.string().max(500),
    headline: z.string().max(500),
    message: z.string().max(10_000),
  }),
  expectedVersion: z.string().min(1).max(128).nullable(),
});

type SchoolRow = {
  id: string;
  photographer_id: string;
  gallery_settings: unknown;
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function failure(message: string, status: number, code?: string) {
  return privateJson({ ok: false, message, error: message, ...(code ? { code } : {}) }, status);
}

function snapshot(school: SchoolRow) {
  return { template: readSchoolVisitorEmailTemplate(school.gallery_settings), version: readSchoolVisitorEmailSettingsRevision(school.gallery_settings) };
}

async function authorizedSchool(request: NextRequest, schoolId: string, writing: boolean) {
  const { user, mfaSatisfied } = await resolveDashboardAuth(request);
  if (!user) return { response: failure("Please sign in again.", 401) };
  if (mfaSatisfied !== true) return { response: failure("Complete two-step verification before using email templates.", 403, "mfa_required") };
  const service = createDashboardServiceClient();
  if (writing) {
    const guard = await guardAgreement({ service, userId: user.id });
    if (!guard.ok) return { response: privateJson({ ...guard.body, ok: false, message: guard.body.error }, guard.status) };
  }
  const { data: photographer, error: photographerError } = await service
    .from("photographers").select("id").eq("user_id", user.id).maybeSingle();
  if (photographerError) throw photographerError;
  if (!photographer?.id) return { response: failure("Photographer profile not found.", 403) };
  const { data: school, error: schoolError } = await service
    .from("schools").select("id,photographer_id,gallery_settings")
    .eq("id", schoolId).eq("photographer_id", photographer.id).maybeSingle<SchoolRow>();
  if (schoolError) throw schoolError;
  if (!school) return { response: failure("School not found.", 404) };
  return { service, school, photographer, user };
}

type Context = { params: Promise<{ schoolId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const auth = await authorizedSchool(request, (await params).schoolId, false);
    if (auth.response) return auth.response;
    return privateJson({ ok: true, ...snapshot(auth.school) });
  } catch {
    return failure("Could not load the saved email template. Please try again.", 503);
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const auth = await authorizedSchool(request, (await params).schoolId, true);
    if (auth.response) return auth.response;
    const parsed = await parseJson(request, SaveTemplateSchema);
    if (!parsed.ok) return parsed.response;
    const { template, expectedVersion } = parsed.data;
    const current = snapshot(auth.school);
    if (current.version !== expectedVersion) {
      return privateJson({ ok: false, message: "This gallery changed in another window. Reload the saved template before saving.", error: "This gallery changed in another window.", code: "template_conflict", ...current }, 409);
    }
    if (JSON.stringify(current.template) === JSON.stringify(template)) {
      return privateJson({ ok: true, ...current });
    }
    const version = randomUUID();
    let update = auth.service.from("schools").update({
      gallery_settings: { ...mergeSchoolVisitorEmailTemplate(auth.school.gallery_settings, template), visitorEmailSettingsRevision: version },
    }).eq("id", auth.school.id).eq("photographer_id", auth.photographer.id);
    update = expectedVersion === null ? update.is("gallery_settings->>visitorEmailSettingsRevision", null) : update.eq("gallery_settings->>visitorEmailSettingsRevision", expectedVersion);
    const { data: saved, error } = await update.select("id,photographer_id,gallery_settings").maybeSingle<SchoolRow>();
    if (error) throw error;
    if (!saved) {
      const { data: latest, error: latestError } = await auth.service.from("schools")
        .select("id,photographer_id,gallery_settings").eq("id", auth.school.id)
        .eq("photographer_id", auth.photographer.id).maybeSingle<SchoolRow>();
      if (latestError) throw latestError;
      if (!latest) return failure("School not found.", 404);
      return privateJson({ ok: false, message: "This gallery changed while the template was saving. Reload the saved template before saving.", error: "This gallery changed while the template was saving.", code: "template_conflict", ...snapshot(latest) }, 409);
    }
    await recordAudit({
      request, actorUserId: auth.user.id, actorPhotographerId: auth.photographer.id,
      action: "school.visitor_email_template_save", entityType: "school", entityId: saved.id,
      targetPhotographerId: auth.photographer.id, result: "ok",
      metadata: { subjectLength: template.subject.length, headlineLength: template.headline.length, messageLength: template.message.length },
    });
    return privateJson({ ok: true, ...snapshot(saved) });
  } catch {
    return failure("Could not save the email template. Your message has not been saved; please try again.", 503);
  }
}
