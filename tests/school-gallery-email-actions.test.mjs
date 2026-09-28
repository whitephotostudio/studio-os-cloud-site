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
const galleryEmail = readFileSync(
  new URL("../lib/event-gallery-email.ts", import.meta.url),
  "utf8",
);
const deliveryLedger = readFileSync(
  new URL("../lib/project-email-deliveries.ts", import.meta.url),
  "utf8",
);

test("test email borrows an owned booking PIN but overrides only the recipient", () => {
  const post = route.slice(route.indexOf("export async function POST"));
  const specialActionAt = post.indexOf('if (action !== "campaign")');
  const campaignAudienceAt = post.indexOf("collectSchoolRecipientEmails");

  assert.ok(specialActionAt >= 0);
  assert.ok(campaignAudienceAt > specialActionAt, "test/student actions must branch before campaign expansion");
  assert.match(post, /action === "test"[\s\S]*photographerRow\.studio_email/);
  assert.match(post, /studentName,\s*studentPin,/);
  assert.match(post, /emailType: action === "test" \? "campaign_test" : "campaign"/);
  assert.doesNotMatch(post, /body\.studentPin/);
});

test("individual student action is server resolved and cancelled bookings are blocked", () => {
  assert.match(route, /\.eq\("id", body\.studentId\)[\s\S]*\.eq\("school_id", schoolId\)/);
  assert.match(route, /This student's booking was cancelled, so no gallery email was sent/);
  assert.match(
    classPage,
    /action: "student",[\s\S]*studentId: student\.id,[\s\S]*requestId: crypto\.randomUUID\(\)/,
  );
  assert.match(classPage, /Email Gallery \+ PIN/);
});

test("preview student picker supports name, PIN, and class or grade search", () => {
  assert.match(route, /className: clean\(booking\.class_name\)/);
  assert.doesNotMatch(route, /seenPins/);
  assert.match(schoolPage, /Search name, PIN, class, or grade\.\.\./);
  assert.match(schoolPage, /All classes \/ grades/);
  assert.match(
    schoolPage,
    /\[student\.studentName, student\.studentPin, student\.className\]/,
  );
  assert.match(schoolPage, /filteredSharePreviewStudents/);
  assert.match(schoolPage, /aria-label=\{shareRecipientMode === "student" \? "Choose student to email" : "Choose preview student"\}/);
  assert.match(schoolPage, /event\.key === "Escape"/);
  assert.match(schoolPage, /Retry the student list above/);
});

test("campaign review names no-PIN visitors and excludes cancelled-only addresses", () => {
  assert.match(route, /excludeCancelledOnlyRecipientEmails\(\[/);
  assert.match(schoolPage, /other gallery visitor/);
  assert.match(schoolPage, /— no PIN/);
});

test("school campaigns include synced walk-in students with their private PIN", () => {
  assert.match(route, /\.from\("students"\)[\s\S]*\.select\("id,first_name,last_name,pin,parent_email,class_name,role"\)/);
  assert.match(route, /buildIndependentRosterEmailRows\(studentRows, bookingRows\)/);
  assert.match(route, /studentId: delivery\.studentId \?\? null/);
  assert.match(schoolPage, /studentId: sharePreviewStudent\.studentId \?\? undefined/);
  assert.match(schoolPage, /row\.bookingId \|\| row\.studentId/);
});

test("personalized school emails make the private PIN prominent", () => {
  assert.match(galleryEmail, /font-size:44px/);
  assert.match(galleryEmail, /Use this PIN to open your private photos/);
  assert.match(galleryEmail, /background:#fff7ed;border:2px solid #fb923c/);
  assert.match(schoolPage, /fontSize: 40/);
});

test("school email sends are retry-safe and unchanged campaign retries reuse their request", () => {
  assert.match(route, /requestId: z\.string\(\)\.uuid\(\)\.optional\(\)/);
  assert.match(route, /function schoolEmailDeliveryKey/);
  assert.match(route, /idempotencyKey: deliveryKey/);
  assert.match(route, /dedupeKey: deliveryKey/);
  assert.doesNotMatch(route, /idempotencyKey:[^\n]*randomUUID/);
  assert.match(schoolPage, /shareCampaignAttemptRef/);
  assert.match(schoolPage, /existingAttempt\?\.fingerprint === fingerprint/);
  assert.match(
    schoolPage,
    /const requestId = existingAttempt\?\.fingerprint === fingerprint\s*\? existingAttempt\.requestId\s*: crypto\.randomUUID\(\)/,
  );
  assert.match(schoolPage, /if \(result\.failed === 0\) \{\s*shareCampaignAttemptRef\.current = null/);
  assert.match(schoolPage, /action: "test",\s*requestId: crypto\.randomUUID\(\)/);
  assert.match(schoolPage, /action: "resend",\s*requestId: crypto\.randomUUID\(\)/);
  assert.match(classPage, /action: "student",[\s\S]*requestId: crypto\.randomUUID\(\)/);
  assert.match(deliveryLedger, /\.upsert\([\s\S]*onConflict: "dedupe_key"/);
  assert.doesNotMatch(deliveryLedger, /if \(existing\?\.id\)/);
});
