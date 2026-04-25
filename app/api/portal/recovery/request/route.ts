// POST /api/portal/recovery/request
//
// The "I lost the PIN" flow's entry point.  Body: {firstName, lastName,
// schoolId, parentEmail}.  Runs the 5-door check from lib/pin-recovery,
// emails a magic link on success, and ALWAYS returns a generic response so
// the form can't be used to enumerate which kids are at which school.
//
// Spec: docs/design/combine-orders-and-recovery.md (sections 4.4 + 4.5).
//
// Notes:
//   - This route is anonymous (no auth required).  Rate-limited internally
//     by IP and by student.
//   - We never reveal the raw PIN, only a single-use signed link.
//   - When door 3 (pre-registration) fails, we ALSO insert a Tier 3 row
//     into pin_recovery_requests so the photographer's dashboard surfaces
//     the unresolved help request and they can one-click send a token.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import {
  logRecoveryAttempt,
  runRecoveryDoorCheck,
} from "@/lib/pin-recovery";
import { buildPinRecoveryEmail } from "@/lib/pin-recovery-email";
import { sendResendEmail } from "@/lib/resend";

export const dynamic = "force-dynamic";

const RecoveryRequestSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  schoolId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
});

function clientIp(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? null;
}

/** The single response body we return on EVERY outcome — generic, not enumeration-leaky. */
function genericResponse(extras?: Record<string, unknown>) {
  return NextResponse.json({
    ok: true,
    message:
      "If we found a match, we've emailed a recovery link to the address on file. Check your inbox. The link expires in 24 hours.",
    ...extras,
  });
}

export async function POST(request: NextRequest) {
  const parsed = await parseJson(request, RecoveryRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (!body.schoolId && !body.projectId) {
    return NextResponse.json(
      { ok: false, error: "schoolId or projectId is required." },
      { status: 400 },
    );
  }

  const service = createDashboardServiceClient();
  const ipAddress = clientIp(request);
  const userAgent = request.headers.get("user-agent");

  const input = {
    email: body.email.toLowerCase(),
    firstName: body.firstName.toLowerCase(),
    lastName: body.lastName.toLowerCase(),
    schoolId: body.schoolId ?? null,
    projectId: body.projectId ?? null,
    ipAddress,
    userAgent,
  };

  let outcome;
  try {
    outcome = await runRecoveryDoorCheck(service, input);
  } catch {
    // Defensive: never crash a recovery request — log the failure and
    // return the generic response so the parent's form looks normal.
    await logRecoveryAttempt(service, {
      input,
      succeeded: false,
      failureReason: "internal_error",
    });
    return genericResponse();
  }

  // Resolve sender + URL pieces up front (used in both success and fallback paths).
  const origin =
    request.headers.get("origin") ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://studiooscloud.com";

  if (!outcome.ok) {
    await logRecoveryAttempt(service, {
      input,
      succeeded: false,
      failureReason: outcome.reason,
    });

    // Door 3 (email_not_registered) is the path that should ALSO surface
    // a Tier 3 photographer-assist queue row, because the parent might be
    // legitimate and just never pre-registered.  We don't fail loudly to
    // them — the photographer can resolve from the dashboard.
    if (outcome.reason === "email_not_registered") {
      await tryQueueManualRequest(service, input);
      return genericResponse({
        photographerContact: outcome.photographerContact ?? null,
      });
    }

    return genericResponse();
  }

  // SUCCESS — issue the email + log the attempt.
  await logRecoveryAttempt(service, {
    input,
    studentId: outcome.student.id,
    photographerId: outcome.photographer.id,
    succeeded: true,
  });

  // Pick the studio's contact email for the "from" line + the email body.
  const senderName = outcome.photographer.businessName || "Studio OS Cloud";
  const studioContactEmail =
    outcome.photographer.studioEmail || outcome.photographer.billingEmail || null;

  const galleryLabel =
    outcome.student.schoolName || outcome.student.projectTitle || "your gallery";
  const studentName = `${outcome.student.firstName} ${outcome.student.lastName}`.trim();

  const recoveryUrl = `${origin.replace(/\/$/, "")}/api/portal/recovery/claim?token=${encodeURIComponent(outcome.plaintextToken)}`;

  const email = buildPinRecoveryEmail({
    studentName,
    schoolOrEventLabel: galleryLabel,
    recoveryUrl,
    studioName: senderName,
    studioContactEmail,
  });

  try {
    await sendResendEmail({
      to: input.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      fromName: senderName,
      replyTo: studioContactEmail || undefined,
      tags: [
        { name: "category", value: "pin_recovery" },
        { name: "photographer_id", value: outcome.photographer.id },
      ],
    });
  } catch {
    // We've already issued the token in the DB; if the email failed, the
    // user will just not receive it.  Log the failure so the photographer
    // can spot it in the audit log.  Still return generic to the client.
    await logRecoveryAttempt(service, {
      input,
      studentId: outcome.student.id,
      photographerId: outcome.photographer.id,
      succeeded: false,
      failureReason: "internal_error",
    });
  }

  return genericResponse();
}

/**
 * Tier 3: when door #3 fails, queue a manual recovery request so the
 * photographer can step in from the dashboard.  Best-effort — never fails
 * the user-facing response if this insert errors.
 */
async function tryQueueManualRequest(
  service: ReturnType<typeof createDashboardServiceClient>,
  input: {
    email: string;
    firstName: string;
    lastName: string;
    schoolId: string | null;
    projectId: string | null;
  },
) {
  try {
    // Resolve photographer_id for the school/project so the row lands on
    // the right photographer's queue.
    let photographerId: string | null = null;
    if (input.schoolId) {
      const { data } = await service
        .from("schools")
        .select("photographer_id")
        .eq("id", input.schoolId)
        .maybeSingle();
      photographerId = (data?.photographer_id as string | null) ?? null;
    } else if (input.projectId) {
      const { data } = await service
        .from("projects")
        .select("photographer_id")
        .eq("id", input.projectId)
        .maybeSingle();
      photographerId = (data?.photographer_id as string | null) ?? null;
    }
    if (!photographerId) return;

    await service.from("pin_recovery_requests").insert({
      photographer_id: photographerId,
      student_id: null,
      parent_email: input.email,
      typed_first_name: input.firstName,
      typed_last_name: input.lastName,
      typed_school_label: null,
      school_id: input.schoolId ?? null,
      project_id: input.projectId ?? null,
      status: "pending",
    });
  } catch {
    // ignore — best effort
  }
}
