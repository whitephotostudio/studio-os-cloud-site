import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import {
  buildSchoolShareEmail,
  eventFromName,
  eventReplyTo,
} from "@/lib/event-gallery-email";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { recordAudit } from "@/lib/audit";
import { recordProjectEmailDelivery } from "@/lib/project-email-deliveries";
import {
  listRecentResendEmailStatuses,
  resendConfigured,
  sendResendEmail,
} from "@/lib/resend";
import { collectSchoolRecipientEmails } from "@/lib/school-email-recipients";
import {
  buildSchoolGalleryEmailDeliveries,
  excludeCancelledOnlyRecipientEmails,
  isConfirmedSchoolGalleryBooking,
  matchSchoolGalleryBookingsToRoster,
  resolveSchoolGalleryStudentRecipient,
  type SchoolGalleryMatchedBookingEmailRow,
} from "@/lib/school-gallery-email-personalization";
import { rateLimit } from "@/lib/rate-limit";
import { guardAgreement } from "@/lib/require-agreement";

export const dynamic = "force-dynamic";

const MAX_CAMPAIGN_DELIVERIES = 500;
const SEND_CONCURRENCY = 5;

const SendCampaignBodySchema = z.object({
  action: z.enum(["campaign", "test", "student", "resend"]).optional(),
  bookingId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  recipientMode: z.enum(["visitors", "others"]).optional(),
  recipients: z.union([z.array(z.string().max(320)).max(MAX_CAMPAIGN_DELIVERIES), z.string().max(20_000)]).optional(),
  ccRecipients: z.union([z.array(z.string().max(320)).max(MAX_CAMPAIGN_DELIVERIES), z.string().max(20_000)]).optional(),
  subject: z.string().max(500).optional(),
  headline: z.string().max(500).optional(),
  buttonLabel: z.string().max(200).optional(),
  message: z.string().max(10_000).optional(),
}).strict();

type SchoolRow = {
  id: string;
  school_name: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  cover_photo_url?: string | null;
  gallery_settings?: unknown;
  photographer_id?: string | null;
};

type SchoolBookingRow = {
  id: string;
  parent_email: string | null;
  student_first_name: string | null;
  student_last_name: string | null;
  class_name: string | null;
  status: string | null;
};

type SchoolStudentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  class_name: string | null;
  pin: string | null;
  parent_email: string | null;
};

type SchoolDeliveryHistoryRow = {
  id: string;
  recipient_email: string;
  email_type: string;
  resend_email_id: string | null;
  subject: string | null;
  status: string;
  payload: Record<string, unknown> | null;
  error_message: string | null;
  sent_at: string;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function looksLikeEmail(value: string | null | undefined) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function parseRecipients(value: string[] | string | undefined) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => clean(entry).toLowerCase())
      .filter(looksLikeEmail);
  }
  return clean(value)
    .split(/[,;\n]+/)
    .map((entry) => clean(entry).toLowerCase())
    .filter(looksLikeEmail);
}

function isCancelled(status: string | null | undefined) {
  const value = clean(status).toLowerCase();
  return value === "cancelled" || value === "canceled";
}

function deliveryStatus(providerEvent: string | null | undefined, storedStatus: string) {
  const event = clean(providerEvent).toLowerCase().replace(/^email\./, "");
  if (event === "opened" || event === "clicked") {
    return { key: event, label: event === "opened" ? "Opened" : "Clicked" };
  }
  if (event === "delivered") return { key: "delivered", label: "Delivered" };
  if (event === "bounced") return { key: "bounced", label: "Bounced" };
  if (event === "complained") return { key: "complained", label: "Spam complaint" };
  if (event === "failed" || event === "canceled") {
    return { key: "failed", label: "Failed" };
  }
  if (clean(storedStatus).toLowerCase() === "failed") {
    return { key: "failed", label: "Failed" };
  }
  return { key: "sent", label: "Sent" };
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ schoolId: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { schoolId } = await context.params;
    const service = createDashboardServiceClient();
    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id,studio_email")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id")
      .eq("id", schoolId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (schoolError) throw schoolError;
    if (!schoolRow?.id) {
      return NextResponse.json(
        { ok: false, message: "School not found." },
        { status: 404 },
      );
    }

    const [bookingsResult, studentsResult] = await Promise.all([
      service
        .from("bookings")
        .select("id,parent_email,student_first_name,student_last_name,class_name,status")
        .eq("school_id", schoolId)
        .eq("photographer_id", photographerRow.id),
      service
        .from("students")
        .select("id,first_name,last_name,class_name,pin,parent_email")
        .eq("school_id", schoolId),
    ]);
    if (bookingsResult.error) throw bookingsResult.error;
    if (studentsResult.error) throw studentsResult.error;

    const bookings = (bookingsResult.data ?? []) as SchoolBookingRow[];
    const students = (studentsResult.data ?? []) as SchoolStudentRow[];
    const confirmedBookings = bookings.filter((booking) =>
      isConfirmedSchoolGalleryBooking(booking.status),
    );
    const matchedBookings = matchSchoolGalleryBookingsToRoster(
      confirmedBookings,
      students,
    );
    const matchedBookingById = new Map(
      matchedBookings.map((booking) => [clean(booking.id), booking]),
    );
    const previewStudents = matchedBookings
      .filter((booking) => Boolean(clean(booking.access_pin)))
      .map((booking) => ({
        bookingId: booking.id,
        studentId: booking.student_id,
        studentName: [
          clean(booking.student_first_name),
          clean(booking.student_last_name),
        ].filter(Boolean).join(" ") || "Student",
        studentPin: clean(booking.access_pin),
        className: clean(booking.class_name),
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName));

    const collectedRecipientEmails = await collectSchoolRecipientEmails(service, schoolId);
    const recipientEmails = excludeCancelledOnlyRecipientEmails([
      ...collectedRecipientEmails,
      ...confirmedBookings
        .map((booking) => clean(booking.parent_email).toLowerCase())
        .filter(looksLikeEmail),
      ...matchedBookings
        .map(
          (booking) => [
            clean(booking.parent_email).toLowerCase(),
            clean(booking.roster_parent_email).toLowerCase(),
          ].find(looksLikeEmail) ?? "",
        )
        .filter(looksLikeEmail),
    ], bookings);
    const campaignDeliveries = buildSchoolGalleryEmailDeliveries(
      recipientEmails,
      matchedBookings,
      true,
    );
    const sendSummary = {
      totalEmails: campaignDeliveries.length,
      personalizedEmails: campaignDeliveries.filter((delivery) => !!delivery.studentPin).length,
      standardVisitorEmails: campaignDeliveries.filter((delivery) => !delivery.studentPin).length,
      uniqueAddresses: new Set(campaignDeliveries.map((delivery) => delivery.recipientEmail)).size,
      cancelledExcluded: bookings.filter((booking) => isCancelled(booking.status)).length,
      missingEmail: confirmedBookings.filter((booking) => {
        const matched = matchedBookingById.get(clean(booking.id));
        return !looksLikeEmail(booking.parent_email) &&
          !looksLikeEmail(matched?.roster_parent_email);
      }).length,
      missingPin: matchedBookings.filter((booking) => !clean(booking.access_pin)).length,
      unmatchedStudent: Math.max(0, confirmedBookings.length - matchedBookings.length),
    };

    const { data: historyRows, error: historyError } = await service
      .from("project_email_deliveries")
      .select("id,recipient_email,email_type,resend_email_id,subject,status,payload,error_message,sent_at")
      .eq("photographer_id", photographerRow.id)
      .contains("payload", { schoolId })
      .order("sent_at", { ascending: false })
      .limit(50);

    if (historyError && historyError.code !== "42P01") throw historyError;

    let providerStatuses = new Map<string, string>();
    try {
      const providerRows = await listRecentResendEmailStatuses(100);
      providerStatuses = new Map(providerRows.map((row) => [row.id, row.lastEvent]));
    } catch {
      // A send-only Resend key can still send campaigns. In that case the
      // report safely falls back to the locally recorded Sent/Failed state.
    }

    const deliveryReport = ((historyRows ?? []) as SchoolDeliveryHistoryRow[]).map((row) => {
      const payload = row.payload ?? {};
      const status = deliveryStatus(
        row.resend_email_id ? providerStatuses.get(row.resend_email_id) : null,
        row.status,
      );
      return {
        id: row.id,
        recipientEmail: row.recipient_email,
        emailType: row.email_type,
        subject: row.subject,
        status: status.key,
        statusLabel: status.label,
        errorMessage: row.error_message,
        sentAt: row.sent_at,
        bookingId: typeof payload.bookingId === "string" ? payload.bookingId : null,
        studentName: typeof payload.studentName === "string" ? payload.studentName : "",
        isTest: payload.action === "test" || row.email_type === "campaign_test",
      };
    });

    return privateJson({
      ok: true,
      previewStudents,
      sendSummary,
      deliveryReport,
      testRecipient: [clean(photographerRow.studio_email), clean(user.email)]
        .find(looksLikeEmail) ?? "",
    });
  } catch (error) {
    console.error("[dashboard:schools:emails:preview]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load personalized email previews." },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ schoolId: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const sendLimit = await rateLimit(user.id, {
      namespace: "school-gallery-email-send",
      limit: 6,
      windowSeconds: 60,
    });
    if (!sendLimit.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many email sends. Please wait a minute and try again." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.max(
              1,
              Math.ceil((sendLimit.resetAt - Date.now()) / 1000),
            ).toString(),
          },
        },
      );
    }

    if (!resendConfigured()) {
      return NextResponse.json(
        { ok: false, message: "Resend is not configured on the server yet." },
        { status: 500 },
      );
    }

    const { schoolId } = await context.params;
    const parsed = await parseJson(request, SendCampaignBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const service = createDashboardServiceClient();

    // Agreement gate — refuse to act for users who haven't accepted the
    // Studio OS Cloud legal agreement. Defense in depth behind the client
    // modal. Same pattern as upload-to-r2 / generate-thumbnails.
    {
      const guard = await guardAgreement({ service, userId: user.id });
      if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    }

    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id,business_name,studio_email")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name,access_mode,access_pin,email_required,cover_photo_url,gallery_settings,gallery_slug,photographer_id")
      .eq("id", schoolId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle<SchoolRow>();

    if (schoolError) throw schoolError;
    if (!schoolRow?.id) {
      return NextResponse.json(
        { ok: false, message: "School not found." },
        { status: 404 },
      );
    }

    const gallerySettings = normalizeEventGallerySettings(schoolRow.gallery_settings);
    const action = body.action ?? "campaign";
    const suppliedOperationId = clean(request.headers.get("idempotency-key"));
    const operationId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedOperationId)
      ? suppliedOperationId
      : crypto.randomUUID();

    if (action !== "campaign") {
      let booking: SchoolBookingRow | null = null;
      let student: SchoolStudentRow | null = null;
      let matchedBooking: SchoolGalleryMatchedBookingEmailRow | null = null;
      let studentActionRecipient = "";

      if (action === "student") {
        if (!body.studentId) {
          return NextResponse.json(
            { ok: false, message: "Choose a student first." },
            { status: 400 },
          );
        }

        const { data: studentRow, error: studentError } = await service
          .from("students")
          .select("id,first_name,last_name,class_name,pin,parent_email")
          .eq("id", body.studentId)
          .eq("school_id", schoolId)
          .maybeSingle<SchoolStudentRow>();
        if (studentError) throw studentError;
        if (!studentRow?.id) {
          return NextResponse.json(
            { ok: false, message: "Student not found." },
            { status: 404 },
          );
        }
        student = studentRow;
        if (!clean(student.pin)) {
          return NextResponse.json(
            { ok: false, message: "This student does not have a gallery PIN yet." },
            { status: 400 },
          );
        }

        const { data: schoolBookings, error: matchingError } = await service
          .from("bookings")
          .select("id,parent_email,student_first_name,student_last_name,class_name,status")
          .eq("school_id", schoolId)
          .eq("photographer_id", photographerRow.id);
        if (matchingError) throw matchingError;
        const rosterMatches = matchSchoolGalleryBookingsToRoster(
          (schoolBookings ?? []) as SchoolBookingRow[],
          [student],
        ).filter((row) => row.student_id === student?.id);
        const confirmedMatches = rosterMatches.filter((row) =>
          isConfirmedSchoolGalleryBooking(row.status),
        );
        if (
          confirmedMatches.length === 0 &&
          rosterMatches.some((row) => isCancelled(row.status))
        ) {
          return NextResponse.json(
            { ok: false, message: "This student's booking was cancelled, so no gallery email was sent." },
            { status: 400 },
          );
        }
        if (confirmedMatches.length === 0 && rosterMatches.length > 0) {
          return NextResponse.json(
            { ok: false, message: "Only confirmed bookings can receive gallery emails." },
            { status: 400 },
          );
        }
        const studentRecipientResolution =
          resolveSchoolGalleryStudentRecipient(
            confirmedMatches,
            student.parent_email,
          );
        if (studentRecipientResolution.conflict) {
          return NextResponse.json(
            { ok: false, message: "The confirmed bookings and roster have different registered emails. Review them before sending private access details." },
            { status: 409 },
          );
        }
        studentActionRecipient = studentRecipientResolution.recipientEmail;
        matchedBooking = confirmedMatches.find(
          (row) =>
            clean(row.parent_email).toLowerCase() === studentActionRecipient,
        ) ?? confirmedMatches[0] ?? null;
        booking = matchedBooking as SchoolBookingRow | null;
      } else {
        if (!body.bookingId) {
          return NextResponse.json(
            { ok: false, message: "Choose a booked student first." },
            { status: 400 },
          );
        }
        const { data: bookingRow, error: bookingError } = await service
          .from("bookings")
          .select("id,parent_email,student_first_name,student_last_name,class_name,status")
          .eq("id", body.bookingId)
          .eq("school_id", schoolId)
          .eq("photographer_id", photographerRow.id)
          .maybeSingle<SchoolBookingRow>();
        if (bookingError) throw bookingError;
        booking = bookingRow;

        if (booking?.id) {
          const { data: studentRows, error: studentsError } = await service
            .from("students")
            .select("id,first_name,last_name,class_name,pin,parent_email")
            .eq("school_id", schoolId);
          if (studentsError) throw studentsError;
          const matches = matchSchoolGalleryBookingsToRoster(
            [booking],
            (studentRows ?? []) as SchoolStudentRow[],
          );
          if (matches.length !== 1) {
            return NextResponse.json(
              {
                ok: false,
                message: "The selected booking does not map to one unique roster student. Review the student name and class first.",
              },
              { status: 409 },
            );
          }
          matchedBooking = matches[0];
          student = ((studentRows ?? []) as SchoolStudentRow[]).find(
            (row) => row.id === matchedBooking?.student_id,
          ) ?? null;
        }
      }

      if (action !== "student" && !booking?.id) {
        return NextResponse.json(
          { ok: false, message: "The selected booking could not be found." },
          { status: 404 },
        );
      }

      if (booking && !isConfirmedSchoolGalleryBooking(booking.status)) {
        return NextResponse.json(
          {
            ok: false,
            message: isCancelled(booking.status)
              ? "Cancelled bookings cannot receive gallery emails."
              : "Only confirmed bookings can receive gallery emails.",
          },
          { status: 400 },
        );
      }

      const studentPin = clean(matchedBooking?.access_pin) || clean(student?.pin);
      const studentName = [
        clean(booking?.student_first_name) || clean(student?.first_name),
        clean(booking?.student_last_name) || clean(student?.last_name),
      ].filter(Boolean).join(" ") || "Student";
      if (!studentPin) {
        return NextResponse.json(
          { ok: false, message: "This student does not have a gallery PIN yet." },
          { status: 400 },
        );
      }

      const testRecipient = [
        clean(photographerRow.studio_email),
        clean(user.email),
      ].find(looksLikeEmail) ?? "";
      const bookingRecipient = clean(booking?.parent_email);
      const studentRecipient = clean(student?.parent_email);
      const registeredRecipients = new Set(
        [studentActionRecipient, bookingRecipient, studentRecipient]
          .map((email) => email.toLowerCase())
          .filter(looksLikeEmail),
      );
      if (action !== "test" && registeredRecipients.size > 1) {
        return NextResponse.json(
          {
            ok: false,
            message: "The booking and roster have different registered emails. Review them before sending private access details.",
          },
          { status: 409 },
        );
      }
      const recipientEmail = action === "test"
        ? testRecipient
        : Array.from(registeredRecipients)[0] ?? "";
      if (!looksLikeEmail(recipientEmail)) {
        return NextResponse.json(
          {
            ok: false,
            message: action === "test"
              ? "Add your studio email in Settings before sending a test."
              : "This student does not have a valid registered email address.",
          },
          { status: 400 },
        );
      }

      const baseSubject = clean(body.subject) || gallerySettings.share.emailSubject;
      const email = buildSchoolShareEmail({
        school: schoolRow,
        photographer: photographerRow,
        share: {
          emailSubject: action === "test" ? `[TEST] ${baseSubject}` : baseSubject,
          emailHeadline: clean(body.headline) || gallerySettings.share.emailHeadline,
          emailButtonLabel: clean(body.buttonLabel) || gallerySettings.share.emailButtonLabel,
          emailMessage: clean(body.message) || gallerySettings.share.emailMessage,
        },
        origin: new URL(request.url).origin,
        studentName,
        studentPin,
      });

      try {
        const deliveryKey = `school-${action}:${schoolId}:${booking?.id ?? student?.id ?? "student"}:${recipientEmail}:${operationId}`;
        const sendResult = await sendResendEmail({
          to: recipientEmail,
          subject: email.subject,
          html: email.html,
          text: email.text,
          fromName: eventFromName(photographerRow),
          replyTo: eventReplyTo(photographerRow),
          idempotencyKey: deliveryKey,
          tags: [
            { name: "type", value: action === "test" ? "campaign_test" : "campaign" },
            { name: "school_id", value: schoolId },
          ],
        });

        try {
          await recordProjectEmailDelivery(service, {
            photographerId: photographerRow.id,
            recipientEmail,
            emailType: action === "test" ? "campaign_test" : "campaign",
            dedupeKey: deliveryKey,
            resendEmailId: sendResult.id,
            subject: email.subject,
            status: "sent",
            payload: {
              schoolId,
              action,
              bookingId: booking?.id ?? null,
              studentId: student?.id ?? matchedBooking?.student_id ?? null,
              studentName,
              personalizedStudentPin: true,
            },
          });
        } catch (recordError) {
          console.error("[dashboard:schools:emails:record-sent]", recordError);
        }
      } catch (error) {
        try {
          await recordProjectEmailDelivery(service, {
            photographerId: photographerRow.id,
            recipientEmail,
            emailType: action === "test" ? "campaign_test" : "campaign",
            subject: email.subject,
            status: "failed",
            payload: {
              schoolId,
              action,
              bookingId: booking?.id ?? null,
              studentId: student?.id ?? matchedBooking?.student_id ?? null,
              studentName,
              personalizedStudentPin: true,
            },
            errorMessage: error instanceof Error ? error.message : "Email delivery failed.",
          });
        } catch (recordError) {
          console.error("[dashboard:schools:emails:record-failed]", recordError);
        }
        throw error;
      }

      try {
        await recordAudit({
          request,
          actorUserId: user.id,
          actorPhotographerId: photographerRow.id,
          action: action === "test" ? "school.gallery_email_test" : "school.gallery_email_send",
          entityType: "school",
          entityId: schoolId,
          targetPhotographerId: photographerRow.id,
          metadata: {
            emailAction: action,
            bookingId: booking?.id ?? null,
            studentId: student?.id ?? matchedBooking?.student_id ?? null,
            recipients: 1,
          },
          result: "ok",
        });
      } catch (auditError) {
        console.error("[dashboard:schools:emails:audit]", auditError);
      }

      return NextResponse.json({
        ok: true,
        sent: 1,
        failed: 0,
        recipients: 1,
        action,
        studentName,
      });
    }

    let bookingRows: SchoolBookingRow[] = [];
    let matchedBookingRows: SchoolGalleryMatchedBookingEmailRow[] = [];
    if (body.recipientMode !== "others") {
      const [bookingsResult, studentsResult] = await Promise.all([
        service
          .from("bookings")
          .select("id,parent_email,student_first_name,student_last_name,class_name,status")
          .eq("school_id", schoolId)
          .eq("photographer_id", photographerRow.id),
        service
          .from("students")
          .select("id,first_name,last_name,class_name,pin,parent_email")
          .eq("school_id", schoolId),
      ]);
      if (bookingsResult.error) throw bookingsResult.error;
      if (studentsResult.error) throw studentsResult.error;
      bookingRows = (bookingsResult.data ?? []) as SchoolBookingRow[];
      matchedBookingRows = matchSchoolGalleryBookingsToRoster(
        bookingRows.filter((booking) =>
          isConfirmedSchoolGalleryBooking(booking.status),
        ),
        (studentsResult.data ?? []) as SchoolStudentRow[],
      );
    }
    const collectedRecipientEmails = body.recipientMode === "others"
      ? []
      : await collectSchoolRecipientEmails(service, schoolId);
    const primaryRecipients = body.recipientMode === "others"
      ? parseRecipients(body.recipients)
      : excludeCancelledOnlyRecipientEmails([
          ...collectedRecipientEmails,
          ...bookingRows
            .filter((booking) => isConfirmedSchoolGalleryBooking(booking.status))
            .map((booking) => clean(booking.parent_email).toLowerCase())
            .filter(looksLikeEmail),
          ...matchedBookingRows
            .map(
              (booking) => [
                clean(booking.parent_email).toLowerCase(),
                clean(booking.roster_parent_email).toLowerCase(),
              ].find(looksLikeEmail) ?? "",
            )
            .filter(looksLikeEmail),
        ], bookingRows);
    const ccRecipients = parseRecipients(body.ccRecipients);
    const primaryRecipientSet = new Set(primaryRecipients);
    const additionalCcRecipients = ccRecipients.filter(
      (email) => !primaryRecipientSet.has(email),
    );
    const deliveries = [
      ...buildSchoolGalleryEmailDeliveries(
        primaryRecipients,
        matchedBookingRows,
        body.recipientMode !== "others",
      ),
      ...buildSchoolGalleryEmailDeliveries(
        additionalCcRecipients,
        [],
        false,
      ),
    ];

    if (!deliveries.length) {
      return NextResponse.json(
        { ok: false, message: "No valid recipient emails were found." },
        { status: 400 },
      );
    }
    if (deliveries.length > MAX_CAMPAIGN_DELIVERIES) {
      return NextResponse.json(
        {
          ok: false,
          message: `This campaign resolves to ${deliveries.length} emails. Limit each send to ${MAX_CAMPAIGN_DELIVERIES} emails.`,
        },
        { status: 413 },
      );
    }

    let sent = 0;
    let failed = 0;
    const failedRecipients: string[] = [];

    for (let index = 0; index < deliveries.length; index += SEND_CONCURRENCY) {
      const batch = deliveries.slice(index, index + SEND_CONCURRENCY);
      await Promise.all(batch.map(async (delivery) => {
        const recipientEmail = delivery.recipientEmail;
        const email = buildSchoolShareEmail({
          school: schoolRow,
          photographer: photographerRow,
          share: {
            emailSubject: clean(body.subject) || gallerySettings.share.emailSubject,
            emailHeadline: clean(body.headline) || gallerySettings.share.emailHeadline,
            emailButtonLabel: clean(body.buttonLabel) || gallerySettings.share.emailButtonLabel,
            emailMessage: clean(body.message) || gallerySettings.share.emailMessage,
          },
          origin: new URL(request.url).origin,
          studentName: delivery.studentName || null,
          studentPin: delivery.studentPin || null,
        });
        try {
          const deliveryKey = `school-campaign:${schoolId}:${delivery.studentId ?? delivery.bookingId ?? "visitor"}:${recipientEmail}:${operationId}`;
          const sendResult = await sendResendEmail({
            to: recipientEmail,
            subject: email.subject,
            html: email.html,
            text: email.text,
            fromName: eventFromName(photographerRow),
            replyTo: eventReplyTo(photographerRow),
            idempotencyKey: deliveryKey,
            tags: [
              { name: "type", value: "campaign" },
              { name: "school_id", value: schoolId },
            ],
          });

          try {
            await recordProjectEmailDelivery(service, {
              photographerId: photographerRow.id,
              recipientEmail,
              emailType: "campaign",
              dedupeKey: deliveryKey,
              resendEmailId: sendResult.id,
              subject: email.subject,
              status: "sent",
              payload: {
                schoolId,
                action: "campaign",
                recipientMode: body.recipientMode || "visitors",
                bookingId: delivery.bookingId,
                studentId: delivery.studentId,
                studentName: delivery.studentName,
                personalizedStudentPin: Boolean(delivery.studentPin),
              },
            });
          } catch (recordError) {
            console.error("[dashboard:schools:emails:record-sent]", recordError);
          }
          sent += 1;
        } catch (error) {
          failed += 1;
          failedRecipients.push(recipientEmail);
          try {
            await recordProjectEmailDelivery(service, {
              photographerId: photographerRow.id,
              recipientEmail,
              emailType: "campaign",
              subject: email.subject,
              status: "failed",
              payload: {
                schoolId,
                action: "campaign",
                recipientMode: body.recipientMode || "visitors",
                bookingId: delivery.bookingId,
                studentId: delivery.studentId,
                studentName: delivery.studentName,
                personalizedStudentPin: Boolean(delivery.studentPin),
              },
              errorMessage:
                error instanceof Error ? error.message : "Failed to send school campaign email.",
            });
          } catch (recordError) {
            console.error("[dashboard:schools:emails:record-failed]", recordError);
          }
        }
      }));
    }

    try {
      await recordAudit({
        request,
        actorUserId: user.id,
        actorPhotographerId: photographerRow.id,
        action: "school.gallery_email_campaign",
        entityType: "school",
        entityId: schoolId,
        targetPhotographerId: photographerRow.id,
        metadata: {
          recipientMode: body.recipientMode || "visitors",
          recipients: deliveries.length,
          sent,
          failed,
          personalized: deliveries.filter((delivery) => Boolean(delivery.studentPin)).length,
        },
        result: failed === deliveries.length ? "error" : "ok",
      });
    } catch (auditError) {
      console.error("[dashboard:schools:emails:audit]", auditError);
    }

    return NextResponse.json({
      ok: sent > 0,
      sent,
      failed,
      recipients: deliveries.length,
      failedRecipients,
    }, { status: sent > 0 ? 200 : 502 });
  } catch (error) {
    console.error("[dashboard:schools:emails]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to send school campaign emails." },
      { status: 500 },
    );
  }
}
