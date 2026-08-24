import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../app/api/dashboard/schools/[schoolId]/emails/route.ts", import.meta.url),
  "utf8",
);
const classPage = readFileSync(
  new URL(
    "../app/dashboard/projects/schools/[schoolId]/classes/[classId]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const schoolPage = readFileSync(
  new URL(
    "../app/dashboard/projects/schools/[schoolId]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("test and resend resolve an owned booking and a server-side roster PIN", () => {
  const post = route.slice(route.indexOf("export async function POST"));
  const specialActionAt = post.indexOf('if (action !== "campaign")');
  const campaignAudienceAt = post.indexOf("collectSchoolRecipientEmails");

  assert.ok(specialActionAt >= 0);
  assert.ok(campaignAudienceAt > specialActionAt);
  assert.match(post, /\.eq\("id", body\.bookingId\)[\s\S]*\.eq\("school_id", schoolId\)[\s\S]*\.eq\("photographer_id", photographerRow\.id\)/);
  assert.match(post, /matchSchoolGalleryBookingsToRoster/);
  assert.match(
    post,
    /const testRecipient = \[[\s\S]*photographerRow\.studio_email[\s\S]*user\.email[\s\S]*\.find\(looksLikeEmail\)/,
  );
  assert.match(post, /recipientEmail = action === "test"[\s\S]*\? testRecipient/);
  assert.doesNotMatch(post, /body\.studentPin|\.eq\("access_pin"/);
});

test("individual student action is school scoped and cancelled-only matches are blocked", () => {
  assert.match(route, /\.eq\("id", body\.studentId\)[\s\S]*\.eq\("school_id", schoolId\)/);
  assert.match(route, /This student's booking was cancelled, so no gallery email was sent/);
  assert.match(route, /Only confirmed bookings can receive gallery emails/);
});

test("class roster emails one student using only a server-resolved student id", () => {
  const emailAction = classPage.slice(
    classPage.indexOf("async function emailStudentGallery"),
    classPage.indexOf("async function copyClassLink"),
  );

  assert.match(classPage, /<Mail size=\{15\} \/> Email Gallery \+ PIN/);
  assert.match(
    emailAction,
    /JSON\.stringify\(\{ action: "student", studentId: student\.id \}\)/,
  );
  assert.doesNotMatch(emailAction, /studentPin|recipientEmail|\$\{pin\}|PIN \$\{/);
  assert.match(emailAction, /if \(emailingStudentRef\.current\) return/);
  assert.match(emailAction, /emailingStudentRef\.current = student\.id/);
  assert.match(emailAction, /finally \{[\s\S]*emailingStudentRef\.current = null[\s\S]*setEmailingStudentId\(null\)/);
  assert.match(classPage, /disabled=\{emailingStudentId !== null\}/);
});

test("class roster confirmation and feedback never render the raw PIN", () => {
  const emailAction = classPage.slice(
    classPage.indexOf("async function emailStudentGallery"),
    classPage.indexOf("async function copyClassLink"),
  );

  assert.match(
    emailAction,
    /Send \$\{studentName\}'s private gallery link and PIN to their registered email\?/,
  );
  assert.match(emailAction, /Gallery link and private access details emailed for \$\{studentName\}/);
  assert.doesNotMatch(emailAction, /setShareNotice\([^\n]*pin/i);
  assert.doesNotMatch(emailAction, /window\.confirm\([\s\S]*?student\.pin/);
});

test("private PINs are isolated while custom recipients remain generic", () => {
  assert.match(route, /studentName,\s*studentPin,/);
  assert.match(route, /studentName: delivery\.studentName \|\| null[\s\S]*studentPin: delivery\.studentPin \|\| null/);
  assert.match(route, /body\.recipientMode !== "others"/);
  assert.match(route, /additionalCcRecipients/);
});

test("send route has strict validation, rate and volume limits, bounded concurrency, and audit", () => {
  assert.match(route, /\.strict\(\)/);
  assert.match(route, /school-gallery-email-send/);
  assert.match(route, /MAX_CAMPAIGN_DELIVERIES/);
  assert.match(route, /SEND_CONCURRENCY/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /recordAudit/);
});

test("school share dialog contains focus and serializes every outbound email action", () => {
  assert.match(schoolPage, /ref=\{shareDialogRef\}[\s\S]*tabIndex=\{-1\}[\s\S]*onKeyDown=\{handleShareDialogKeyDown\}/);
  assert.match(schoolPage, /shareDialogRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(schoolPage, /event\.key !== "Tab"/);
  assert.match(schoolPage, /event\.stopPropagation\(\)[\s\S]*setSharePreviewPickerOpen\(false\)/);
  assert.match(schoolPage, /if \(shareEmailActionPendingRef\.current\) return/);
  assert.match(schoolPage, /disabled=\{shareEmailActionPending\}/);
});
