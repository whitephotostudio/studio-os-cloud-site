// GET  /api/dashboard/admin/recovery — list pending Tier 3 requests + recent attempts.
// POST /api/dashboard/admin/recovery — { action: 'approve' | 'reject', requestId, studentId? }
//
// Photographer-scoped. Only the studio that owns the request/attempt can
// see + act on it. Used by /dashboard/admin/recovery-requests.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import {
  generatePlaintextToken,
  hashToken,
  TOKEN_TTL_MS,
} from "@/lib/pin-recovery";
import { buildPinRecoveryEmail } from "@/lib/pin-recovery-email";
import { sendResendEmail } from "@/lib/resend";

export const dynamic = "force-dynamic";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    requestId: z.string().uuid(),
    studentId: z.string().uuid(),
    note: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal("reject"),
    requestId: z.string().uuid(),
    note: z.string().max(2000).optional().nullable(),
  }),
]);

async function resolvePhotographer(request: NextRequest) {
  const { user } = await resolveDashboardAuth(request);
  if (!user?.id) return null;
  const service = createDashboardServiceClient();
  const { data } = await service
    .from("photographers")
    .select("id, business_name, studio_email, billing_email, studio_phone")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data?.id) return null;
  return { service, photographer: data, userId: user.id };
}

export async function GET(request: NextRequest) {
  const ctx = await resolvePhotographer(request);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, message: "Sign in as a photographer." },
      { status: 401 },
    );
  }

  // Pending Tier 3 queue.
  const { data: requests } = await ctx.service
    .from("pin_recovery_requests")
    .select(
      "id, parent_email, typed_first_name, typed_last_name, typed_school_label, school_id, project_id, status, requested_at, photographer_note, resolved_at",
    )
    .eq("photographer_id", ctx.photographer.id)
    .order("requested_at", { ascending: false })
    .limit(100);

  // 200 most-recent attempts, success + failure.
  const { data: attempts } = await ctx.service
    .from("pin_recovery_attempts")
    .select(
      "id, ip_address, user_agent, student_id, email_tried, first_name_tried, last_name_tried, school_id_tried, project_id_tried, succeeded, failure_reason, created_at",
    )
    .eq("photographer_id", ctx.photographer.id)
    .order("created_at", { ascending: false })
    .limit(200);

  return NextResponse.json({
    ok: true,
    requests: requests ?? [],
    attempts: attempts ?? [],
  });
}

export async function POST(request: NextRequest) {
  const ctx = await resolvePhotographer(request);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, message: "Sign in as a photographer." },
      { status: 401 },
    );
  }

  const parsed = await parseJson(request, ActionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Confirm the request belongs to this photographer.
  const { data: row } = await ctx.service
    .from("pin_recovery_requests")
    .select("id, photographer_id, parent_email, school_id, project_id, status")
    .eq("id", body.requestId)
    .maybeSingle();
  if (!row || row.photographer_id !== ctx.photographer.id) {
    return NextResponse.json(
      { ok: false, message: "Request not found." },
      { status: 404 },
    );
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      { ok: false, message: "This request has already been resolved." },
      { status: 409 },
    );
  }

  if (body.action === "reject") {
    await ctx.service
      .from("pin_recovery_requests")
      .update({
        status: "rejected",
        photographer_note: body.note ?? null,
        resolved_at: new Date().toISOString(),
        resolved_by: ctx.photographer.id,
      })
      .eq("id", body.requestId);
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // Approve — manually issue a token + email it to the parent.
  // Look up the student to get name + school for the email body.
  const { data: student } = await ctx.service
    .from("students")
    .select(
      "id, first_name, last_name, school_id, schools!inner(school_name, photographer_id)",
    )
    .eq("id", body.studentId)
    .maybeSingle();
  if (!student) {
    return NextResponse.json(
      { ok: false, message: "Student not found." },
      { status: 404 },
    );
  }
  const schoolRow = Array.isArray(student.schools) ? student.schools[0] : student.schools;
  if (schoolRow?.photographer_id !== ctx.photographer.id) {
    return NextResponse.json(
      { ok: false, message: "That student doesn't belong to your studio." },
      { status: 403 },
    );
  }

  // Mint a single-use token good for 24h.
  const plaintextToken = generatePlaintextToken();
  const tokenHash = hashToken(plaintextToken);
  const { error: tokenErr } = await ctx.service
    .from("pin_recovery_tokens")
    .insert({
      token_hash: tokenHash,
      student_id: student.id,
      photographer_id: ctx.photographer.id,
      parent_email: row.parent_email,
      expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      manual_request_id: row.id,
    });
  if (tokenErr) {
    return NextResponse.json(
      { ok: false, message: "Could not issue recovery token." },
      { status: 500 },
    );
  }

  // Email the parent.
  const origin =
    request.headers.get("origin") ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://studiooscloud.com";
  const recoveryUrl = `${origin.replace(/\/$/, "")}/api/portal/recovery/claim?token=${encodeURIComponent(plaintextToken)}`;
  const studentName = `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() || "your child";
  const studioName = ctx.photographer.business_name || "Studio OS Cloud";
  const studioContact = ctx.photographer.studio_email || ctx.photographer.billing_email || null;
  const galleryLabel = (schoolRow?.school_name as string | null) || "your gallery";

  const email = buildPinRecoveryEmail({
    studentName,
    schoolOrEventLabel: galleryLabel,
    recoveryUrl,
    studioName,
    studioContactEmail: studioContact,
  });

  try {
    await sendResendEmail({
      to: row.parent_email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      fromName: studioName,
      replyTo: studioContact || undefined,
      tags: [
        { name: "category", value: "pin_recovery_manual" },
        { name: "photographer_id", value: ctx.photographer.id },
      ],
    });
  } catch {
    // Mark the request approved anyway — the photographer can re-trigger
    // the email if delivery failed.
  }

  await ctx.service
    .from("pin_recovery_requests")
    .update({
      status: "approved",
      student_id: student.id,
      photographer_note: body.note ?? null,
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.photographer.id,
    })
    .eq("id", body.requestId);

  return NextResponse.json({ ok: true, status: "approved" });
}
