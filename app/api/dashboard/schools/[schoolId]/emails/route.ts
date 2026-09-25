import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
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
import { recordProjectEmailDelivery } from "@/lib/project-email-deliveries";
import {
  listRecentResendEmailStatuses,
  resendConfigured,
} from "@/lib/resend";
import { sendStudioBookingEmailWithRetry } from "@/lib/studio-booking-email-send";
import { collectSchoolRecipientEmails } from "@/lib/school-email-recipients";
import {
  buildIndependentRosterEmailRows,
  buildSchoolGalleryEmailDeliveries,
  excludeCancelledOnlyRecipientEmails,
} from "@/lib/school-gallery-email-personalization";
import { guardAgreement } from "@/lib/require-agreement";
import { loadSchoolClassEmailAudience } from "@/lib/school-class-email-audience";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CAMPAIGN_DELIVERIES = 500;
const SEND_CONCURRENCY = 5;

const SendCampaignBodySchema = z.object({
  action: z.enum(["campaign", "test", "student", "resend"]).optional(),
  bookingId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  recipientMode: z.enum(["visitors", "others", "classes"]).optional(),
  classNames: z.array(z.string().trim().min(1).max(500)).max(200).optional(),
  onlyWithPhotos: z.boolean().optional(),
  includeClassRegistrations: z.boolean().optional(),
  audienceFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  recipients: z.union([z.array(z.string().max(320)).max(MAX_CAMPAIGN_DELIVERIES), z.string().max(20_000)]).optional(),
  ccRecipients: z.union([z.array(z.string().max(320)).max(MAX_CAMPAIGN_DELIVERIES), z.string().max(20_000)]).optional(),
  subject: z.string().max(500).optional(),
  headline: z.string().max(500).optional(),
  buttonLabel: z.string().max(200).optional(),
  message: z.string().max(10_000).optional(),
  requestId: z.string().uuid().optional(),
});

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
  access_pin: string | null;
  student_first_name: string | null;
  student_last_name: string | null;
  class_name: string | null;
  status: string | null;
};

type SchoolStudentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  pin: string | null;
  parent_email: string | null;
  class_name: string | null;
  role: string | null;
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
    .split(",")
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

function schoolEmailDeliveryKey(params: {
  action: string;
  schoolId: string;
  requestId: string;
  recipientEmail: string;
  identity: string;
}) {
  const digest = createHash("sha256")
    .update(
      [
        params.action,
        params.schoolId,
        params.requestId,
        params.recipientEmail.toLowerCase(),
        params.identity,
      ].join("\u0000"),
    )
    .digest("hex");
  return `school-email:${digest}`;
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

    const { data: bookingRows, error: bookingsError } = await service
      .from("bookings")
      .select("id,parent_email,access_pin,student_first_name,student_last_name,class_name,status")
      .eq("school_id", schoolId);

    if (bookingsError) throw bookingsError;

    const { data: studentRows, error: studentsError } = await service
      .from("students")
      .select("id,first_name,last_name,pin,parent_email,class_name,role")
      .eq("school_id", schoolId);

    if (studentsError) throw studentsError;

    const bookings = (bookingRows ?? []) as SchoolBookingRow[];
    const students = (studentRows ?? []) as SchoolStudentRow[];
    const activeBookings = bookings.filter((booking) => !isCancelled(booking.status));
    const manualEmailRows = buildIndependentRosterEmailRows(students, bookings);
    const previewStudents = [
      ...activeBookings
      .filter((booking) => Boolean(clean(booking.access_pin)))
      .map((booking) => ({
        bookingId: booking.id,
        studentId: null,
        studentName: [
          clean(booking.student_first_name),
          clean(booking.student_last_name),
        ].filter(Boolean).join(" ") || "Student",
        studentPin: clean(booking.access_pin),
        className: clean(booking.class_name),
      })),
      ...manualEmailRows
        .filter((student) => Boolean(clean(student.access_pin)))
        .map((student) => ({
          bookingId: null,
          studentId: clean(student.student_id),
          studentName: [clean(student.student_first_name), clean(student.student_last_name)]
            .filter(Boolean)
            .join(" ") || "Student",
          studentPin: clean(student.access_pin),
          className: clean(student.class_name),
        })),
    ]
      .sort((a, b) => a.studentName.localeCompare(b.studentName));

    const collectedRecipientEmails = await collectSchoolRecipientEmails(service, schoolId);
    const recipientEmails = excludeCancelledOnlyRecipientEmails([
      ...collectedRecipientEmails,
      ...activeBookings
        .map((booking) => clean(booking.parent_email).toLowerCase())
        .filter(looksLikeEmail),
      ...manualEmailRows
        .map((student) => clean(student.parent_email).toLowerCase())
        .filter(looksLikeEmail),
    ], [...bookings, ...manualEmailRows]);
    const campaignDeliveries = buildSchoolGalleryEmailDeliveries(
      recipientEmails,
      [...activeBookings, ...manualEmailRows],
      true,
    );
    const activeRecipientRows = [...activeBookings, ...manualEmailRows];
    const sendSummary = {
      totalEmails: campaignDeliveries.length,
      personalizedEmails: campaignDeliveries.filter((delivery) => !!delivery.studentPin).length,
      standardVisitorEmails: campaignDeliveries.filter((delivery) => !delivery.studentPin).length,
      uniqueAddresses: new Set(campaignDeliveries.map((delivery) => delivery.recipientEmail)).size,
      cancelledExcluded: bookings.filter((booking) => isCancelled(booking.status)).length,
      missingEmail: activeRecipientRows.filter((row) => !looksLikeEmail(row.parent_email)).length,
      missingPin: activeRecipientRows.filter((row) => !clean(row.access_pin)).length,
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
        studentId: typeof payload.studentId === "string" ? payload.studentId : null,
        studentName: typeof payload.studentName === "string" ? payload.studentName : "",
        isTest: payload.action === "test" || row.email_type === "campaign_test",
      };
    });

    const query = new URL(request.url).searchParams;
    const classAudience = query.get("recipientMode") === "classes"
      ? await loadSchoolClassEmailAudience(service, schoolId, query.getAll("className"), query.get("onlyWithPhotos") !== "false", query.get("includeClassRegistrations") === "true")
      : null;
    return privateJson({
      ok: true,
      previewStudents,
      sendSummary,
      deliveryReport,
      testRecipient: clean(photographerRow.studio_email) || clean(user.email),
      classAudience: classAudience ? {
        classOptions: classAudience.classOptions,
        fingerprint: classAudience.fingerprint,
        review: classAudience.review,
        summary: classAudience.summary,
        totalEmails: classAudience.deliveries.length,
        uniqueAddresses: new Set(classAudience.deliveries.map((d) => d.recipientEmail)).size,
        maxEmails: MAX_CAMPAIGN_DELIVERIES,
      } : null,
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
    // The dashboard supplies one request ID per deliberate click. If the same
    // HTTP request is retried after a lost response, every delivery keeps the
    // same provider and ledger key. A later deliberate resend gets a new ID.
    const requestId = body.requestId ?? randomUUID();

    if (action !== "campaign") {
      let booking: SchoolBookingRow | null = null;
      let student: SchoolStudentRow | null = null;
      const useStudent = Boolean(body.studentId);

      if (action === "student" && !body.studentId) {
        return NextResponse.json(
          { ok: false, message: "Choose a student first." },
          { status: 400 },
        );
      }

      if (useStudent) {
        if (!body.studentId) {
          return NextResponse.json(
            { ok: false, message: "Choose a student first." },
            { status: 400 },
          );
        }

        const { data: studentRow, error: studentError } = await service
          .from("students")
          .select("id,first_name,last_name,pin,parent_email,class_name,role")
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
        const studentPin = clean(student.pin);
        if (!studentPin) {
          return NextResponse.json(
            { ok: false, message: "This student does not have a gallery PIN yet." },
            { status: 400 },
          );
        }

        const { data: matchingBookings, error: matchingError } = await service
          .from("bookings")
          .select("id,parent_email,access_pin,student_first_name,student_last_name,class_name,status")
          .eq("school_id", schoolId)
          .eq("access_pin", studentPin)
          .limit(3);
        if (matchingError) throw matchingError;
        const activeMatches = ((matchingBookings ?? []) as SchoolBookingRow[]).filter(
          (row) => !isCancelled(row.status),
        );
        if ((matchingBookings ?? []).length > 0 && activeMatches.length === 0) {
          return NextResponse.json(
            { ok: false, message: "This student's booking was cancelled, so no gallery email was sent." },
            { status: 400 },
          );
        }
        if (activeMatches.length > 1) {
          return NextResponse.json(
            { ok: false, message: "More than one active booking uses this PIN. Please review the booking before emailing." },
            { status: 409 },
          );
        }
        booking = activeMatches[0] ?? null;
      } else {
        if (!body.bookingId) {
          return NextResponse.json(
            { ok: false, message: "Choose a student first." },
            { status: 400 },
          );
        }
        const { data: bookingRow, error: bookingError } = await service
          .from("bookings")
          .select("id,parent_email,access_pin,student_first_name,student_last_name,class_name,status")
          .eq("id", body.bookingId)
          .eq("school_id", schoolId)
          .maybeSingle<SchoolBookingRow>();
        if (bookingError) throw bookingError;
        booking = bookingRow;
      }

      if (!booking?.id && !student?.id) {
        return NextResponse.json(
          { ok: false, message: "The selected student could not be found." },
          { status: 404 },
        );
      }

      if (booking && isCancelled(booking.status)) {
        return NextResponse.json(
          { ok: false, message: "Cancelled bookings cannot receive gallery emails." },
          { status: 400 },
        );
      }

      const studentPin = clean(booking?.access_pin) || clean(student?.pin);
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

      const recipientEmail = action === "test"
        ? clean(photographerRow.studio_email) || clean(user.email)
        : clean(booking?.parent_email) || clean(student?.parent_email);
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
      const deliveryKey = schoolEmailDeliveryKey({
        action,
        schoolId,
        requestId,
        recipientEmail,
        identity: booking?.id ?? student?.id ?? "student",
      });

      try {
        const sendResult = await sendStudioBookingEmailWithRetry({
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
            studentId: student?.id ?? null,
            studentName,
            personalizedStudentPin: true,
          },
        });
      } catch (error) {
        await recordProjectEmailDelivery(service, {
          photographerId: photographerRow.id,
          recipientEmail,
          emailType: action === "test" ? "campaign_test" : "campaign",
          dedupeKey: deliveryKey,
          subject: email.subject,
          status: "failed",
          payload: {
            schoolId,
            action,
            bookingId: booking?.id ?? null,
            studentId: student?.id ?? null,
            studentName,
            personalizedStudentPin: true,
          },
          errorMessage: error instanceof Error ? error.message : "Email delivery failed.",
        });
        throw error;
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
    let studentRows: SchoolStudentRow[] = [];
    if (body.recipientMode !== "others" && body.recipientMode !== "classes") {
      const [bookingsResult, studentsResult] = await Promise.all([
        service
          .from("bookings")
          .select("id,parent_email,access_pin,student_first_name,student_last_name,class_name,status")
          .eq("school_id", schoolId),
        service
          .from("students")
          .select("id,first_name,last_name,pin,parent_email,class_name,role")
          .eq("school_id", schoolId),
      ]);
      if (bookingsResult.error) throw bookingsResult.error;
      if (studentsResult.error) throw studentsResult.error;
      bookingRows = (bookingsResult.data ?? []) as SchoolBookingRow[];
      studentRows = (studentsResult.data ?? []) as SchoolStudentRow[];
    }
    const manualEmailRows = buildIndependentRosterEmailRows(studentRows, bookingRows);
    const activeBookingRows = bookingRows.filter((booking) => !isCancelled(booking.status));
    const personalizedRows = [...activeBookingRows, ...manualEmailRows];
    const collectedRecipientEmails = body.recipientMode === "others" || body.recipientMode === "classes"
      ? []
      : await collectSchoolRecipientEmails(service, schoolId);
    const primaryRecipients = body.recipientMode === "others"
      ? parseRecipients(body.recipients)
      : excludeCancelledOnlyRecipientEmails([
          ...collectedRecipientEmails,
          ...bookingRows
            .filter((booking) => !isCancelled(booking.status))
            .map((booking) => clean(booking.parent_email).toLowerCase())
            .filter(looksLikeEmail),
          ...manualEmailRows
            .map((student) => clean(student.parent_email).toLowerCase())
            .filter(looksLikeEmail),
        ], [...bookingRows, ...manualEmailRows]);
    const ccRecipients = parseRecipients(body.ccRecipients);
    const primaryRecipientSet = new Set(primaryRecipients);
    const additionalCcRecipients = ccRecipients.filter(
      (email) => !primaryRecipientSet.has(email),
    );
    let deliveries = [
      ...buildSchoolGalleryEmailDeliveries(
        primaryRecipients,
        personalizedRows,
        body.recipientMode !== "others",
      ),
      ...buildSchoolGalleryEmailDeliveries(
        additionalCcRecipients,
        [],
        false,
      ),
    ];

    if (body.recipientMode === "classes") {
      if (!body.classNames?.length || !body.audienceFingerprint) {
        return privateJson({ ok: false, message: "Choose classes and review the recipients before sending." }, 400);
      }
      // Always resolve the selection again on the server. Never accept a
      // client-supplied student list, recipient address or PIN for this mode.
      const audience = await loadSchoolClassEmailAudience(service, schoolId, body.classNames, body.onlyWithPhotos !== false, body.includeClassRegistrations === true);
      if (audience.unknownClasses.length || audience.fingerprint !== body.audienceFingerprint) {
        return privateJson({ ok: false, message: "The recipients changed. Refresh the recipient review before sending." }, 409);
      }
      deliveries = audience.deliveries;
      // Class sends deliberately omit custom recipients and CC: these cannot
      // be matched to the selected students. Use Send Test to Me for a copy.
    }

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
          studentName: delivery.studentName,
          studentPin: delivery.studentPin,
        });
        const deliveryKey = schoolEmailDeliveryKey({
          action: "campaign",
          schoolId,
          requestId,
          recipientEmail,
          identity: delivery.bookingId ?? delivery.studentId ?? "visitor",
        });

        let sendResult: Awaited<
          ReturnType<typeof sendStudioBookingEmailWithRetry>
        >;
        try {
          sendResult = await sendStudioBookingEmailWithRetry({
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
        } catch (error) {
          failed += 1;
          failedRecipients.push(recipientEmail);
          try {
            await recordProjectEmailDelivery(service, {
              photographerId: photographerRow.id,
              recipientEmail,
              emailType: "campaign",
              dedupeKey: deliveryKey,
              subject: email.subject,
              status: "failed",
              payload: {
                schoolId,
                action: "campaign",
                recipientMode: body.recipientMode || "visitors",
                classNames: body.recipientMode === "classes" ? body.classNames : undefined,
                bookingId: delivery.bookingId,
                studentId: delivery.studentId ?? null,
                studentName: delivery.studentName,
                personalizedStudentPin: Boolean(delivery.studentPin),
              },
              errorMessage:
                error instanceof Error ? error.message : "Failed to send school campaign email.",
            });
          } catch (recordError) {
            console.error("[dashboard:schools:emails:record-failed]", recordError);
          }
          return;
        }

        sent += 1;
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
              classNames: body.recipientMode === "classes" ? body.classNames : undefined,
              bookingId: delivery.bookingId,
              studentId: delivery.studentId ?? null,
              studentName: delivery.studentName,
              personalizedStudentPin: Boolean(delivery.studentPin),
            },
          });
        } catch (recordError) {
          // The provider already accepted this message. Do not misreport a
          // delivery as failed or resend it merely because history logging had
          // a transient problem; the stable delivery key keeps retries safe.
          console.error("[dashboard:schools:emails:record-sent]", recordError);
        }
      }));
    }

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      recipients: deliveries.length,
      failedRecipients,
    });
  } catch (error) {
    console.error("[dashboard:schools:emails]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to send school campaign emails." },
      { status: 500 },
    );
  }
}
