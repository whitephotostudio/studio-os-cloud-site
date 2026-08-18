import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import { studioBookingRecipientFingerprint } from "../../lib/studio-booking-email.ts";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function section(value, start, end) {
  const startAt = value.indexOf(start);
  assert.notEqual(startAt, -1, `Expected source marker: ${start}`);
  const endAt = value.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `Expected source marker after ${start}: ${end}`);
  return value.slice(startAt, endAt);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(
        new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href,
        context,
      );
    }
    return nextResolve(specifier, context);
  },
});

const {
  filterNewStudioBookingRecipients,
  studioBookingCampaignDeliveryKey,
} = await import("../../lib/studio-booking-email-campaign.ts");

const campaignFixture = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  eventId: "11111111-1111-4111-8111-111111111111",
  photographerId: "22222222-2222-4222-8222-222222222222",
  subject: "Picture day details",
  headline: "Your appointment",
  message: "Please arrive five minutes early.",
  location: "Main campus",
  address: "10 Example Road",
  directions: "Use the east entrance.",
  photoKeys: [],
  savedAt: "2026-08-17T12:00:00.000Z",
};

const firstBooking = {
  id: "33333333-3333-4333-8333-333333333333",
};
const laterBooking = {
  id: "44444444-4444-4444-8444-444444444444",
};

test("new-only selection tracks booking IDs, not parent email addresses", () => {
  const handled = new Set([firstBooking.id]);
  const original = [{ email: "parent@example.com", bookings: [firstBooking] }];
  assert.deepEqual(filterNewStudioBookingRecipients(original, handled), []);

  const sameParentWithLaterBooking = [
    {
      email: "Parent@Example.com",
      bookings: [firstBooking, laterBooking],
    },
  ];
  const next = filterNewStudioBookingRecipients(sameParentWithLaterBooking, handled);

  assert.equal(next.length, 1);
  assert.equal(next[0].email, "Parent@Example.com");
  assert.deepEqual(next[0].bookings.map((booking) => booking.id), [laterBooking.id]);
  assert.notEqual(
    studioBookingRecipientFingerprint(original),
    studioBookingRecipientFingerprint(sameParentWithLaterBooking),
  );

  const helper = source("lib/studio-booking-email-campaign.ts");
  const tracking = section(
    helper,
    "export async function recordHandledStudioBookingRecipients",
    "export function studioBookingCampaignDeliveryKey",
  );
  assert.match(tracking, /recipient\.bookings\.map\(\(booking\) =>/);
  assert.match(tracking, /dedupe_key:\s*bookingDedupeKey\([\s\S]*booking\.id/);
  assert.match(tracking, /booking_id:\s*booking\.id/);
  assert.match(helper, /\.in\("status", \["sent", "baseline"\]\)/);
});

test("new-only delivery keys are stable for the same booking set", () => {
  const recipient = {
    email: "parent@example.com",
    bookings: [laterBooking, firstBooking],
  };
  const reordered = {
    email: "PARENT@example.com",
    bookings: [firstBooking, laterBooking],
  };

  const key = studioBookingCampaignDeliveryKey(campaignFixture, recipient);
  assert.equal(key, studioBookingCampaignDeliveryKey(campaignFixture, reordered));
  assert.notEqual(
    key,
    studioBookingCampaignDeliveryKey(campaignFixture, {
      email: recipient.email,
      bookings: [laterBooking],
    }),
  );
  assert.doesNotMatch(key, /parent@example\.com/i);
  assert.match(key, /^booking-campaign-/);
});

test("the full send saves first, tracks only successful parents, and pauses on tracking failure", () => {
  const route = source("app/api/dashboard/admin/bookings/[eventId]/email/route.ts");
  const saveAt = route.indexOf("await saveStudioBookingEmailCampaign({");
  const sendAt = route.indexOf("return sendStudioBookingEmailWithRetry({");
  const trackAt = route.indexOf("await recordHandledStudioBookingRecipients({");
  const pauseAt = route.indexOf("await pauseStudioBookingEmailCampaign(");

  assert.ok(saveAt > 0 && saveAt < sendAt, "campaign must be durable before delivery begins");
  assert.match(route, /could not be saved, so no emails were sent/i);
  assert.ok(sendAt < trackAt, "successful delivery must precede handled-booking tracking");
  assert.ok(trackAt < pauseAt, "a tracking failure must pause the saved campaign");
  assert.match(route, /result\.status === "fulfilled"[\s\S]*handledRecipients\.push\(/);

  const staffResultBranch = section(
    route,
    'if (target.kind === "staff-copy")',
    "if (offset + SEND_CONCURRENCY",
  );
  assert.doesNotMatch(staffResultBranch.split("} else if")[0], /handledRecipients\.push/);
  assert.match(route, /status:\s*"sent",\s*recipients:\s*handledRecipients/);
  assert.match(route, /campaignTrackingFailed = true/);
});

test("saved direction photos use private object keys and never persist base64", () => {
  const helper = source("lib/studio-booking-email-campaign.ts");
  const saveFunction = section(
    helper,
    "export async function saveStudioBookingEmailCampaign",
    "export async function loadStudioBookingCampaignAttachments",
  );
  const persistedPayload = section(saveFunction, "payload: {", "},\n    });");

  assert.match(helper, /booking-email-campaigns\/\$\{photographerId\}\/\$\{eventId\}\/\$\{campaignId\}/);
  assert.match(saveFunction, /r2Upload\(key, bytes, "image\/jpeg", "private, no-store"\)/);
  assert.match(persistedPayload, /photo_keys:\s*photoKeys/);
  assert.doesNotMatch(persistedPayload, /attachment\.content|base64|data:image|\bcontent\s*:/i);
  assert.match(helper, /value\.startsWith\(prefix\) && value\.endsWith\("\.jpg"\)/);
  assert.match(helper, /\.slice\(0, 4\)/);
});

test("campaign API is owner/event scoped and accepts no client-supplied audience", () => {
  const route = source(
    "app/api/dashboard/admin/bookings/[eventId]/email/campaign/route.ts",
  );
  const actionSchema = section(
    route,
    "const CampaignActionSchema",
    "type ServiceClient",
  );
  const authorization = section(
    route,
    "async function loadAuthorizedContext",
    "export async function GET",
  );

  assert.match(actionSchema, /discriminatedUnion\("action"/);
  assert.match(actionSchema, /action:\s*z\.literal\("save-baseline"\)/);
  assert.match(actionSchema, /action:\s*z\.literal\("send-new"\)/);
  assert.match(actionSchema, /recipientFingerprint:\s*z\.string\(\)\.regex/);
  assert.match(actionSchema, /\.strict\(\)/);
  assert.doesNotMatch(actionSchema, /\brecipients?\s*:|\bemails?\s*:|\bstaffCopy\s*:/i);

  assert.match(authorization, /resolveDashboardAuth\(request\)/);
  assert.match(authorization, /photographer\.is_platform_admin/);
  assert.match(
    authorization,
    /loadStudioBookingDetail\(service, photographer\.id, eventId\)/,
  );
  assert.match(route, /loadStudioBookingEmailCampaign\([\s\S]*input\.photographerId,[\s\S]*input\.eventId/);
  assert.match(route, /loadHandledStudioBookingIds\([\s\S]*input\.photographerId,[\s\S]*input\.eventId,[\s\S]*campaign\.id/);
  assert.match(route, /collectStudioBookingEmailRecipients\([\s\S]*"confirmed",[\s\S]*validSlotIds/);
  assert.match(route, /filterNewStudioBookingRecipients\([\s\S]*recipientSummary\.recipients,[\s\S]*handledBookingIds/);
});

test("campaign GET returns counts and opaque fingerprints without message or recipient data", () => {
  const route = source(
    "app/api/dashboard/admin/bookings/[eventId]/email/campaign/route.ts",
  );
  const publicSummary = section(
    route,
    "publicSummary: {",
    "\n    },\n  };\n}",
  );
  const getHandler = section(
    route,
    "export async function GET",
    "export async function POST",
  );

  assert.match(getHandler, /campaign:\s*state\.publicSummary/);
  assert.doesNotMatch(getHandler, /campaign:\s*state\.campaign/);
  assert.match(publicSummary, /photoCount:\s*campaign\?\.photoKeys\.length/);
  assert.match(publicSummary, /currentFingerprint:\s*studioBookingRecipientFingerprint/);
  assert.match(publicSummary, /newFingerprint:\s*studioBookingRecipientFingerprint\(newRecipients\)/);
  assert.doesNotMatch(
    publicSummary,
    /campaign\?\.(?:headline|message|location|address|directions|photoKeys)(?!\.length)|\bphoto_keys\b|\bbookingIds?\b|recipientSummary\s*[,}]|newRecipients\s*[,}]|\.email\b/,
  );
  assert.doesNotMatch(getHandler, /recipientSummary|newRecipients|photoKeys|photo_keys|\.email\b/);
});

test("baseline and send-new recompute fingerprints and never repeat a staff copy", () => {
  const route = source(
    "app/api/dashboard/admin/bookings/[eventId]/email/campaign/route.ts",
  );
  const postHandler = route.slice(route.indexOf("export async function POST"));

  assert.match(
    postHandler,
    /parsed\.data\.recipientFingerprint\s*!==\s*currentState\.publicSummary\.currentFingerprint/,
  );
  assert.match(
    postHandler,
    /parsed\.data\.recipientFingerprint\s*!==\s*currentState\.publicSummary\.newFingerprint/,
  );
  assert.ok(
    (postHandler.match(/status:\s*409/g) ?? []).length >= 2,
    "both baseline and new-only audience changes must fail closed",
  );
  assert.match(
    postHandler,
    /status:\s*"baseline",\s*recipients:\s*currentState\.recipientSummary\.recipients\.map/,
  );
  assert.match(postHandler, /sent:\s*0,[\s\S]*failed:\s*0,[\s\S]*total:\s*0/);
  assert.match(postHandler, /sendState\.newRecipients\.slice/);
  assert.match(
    postHandler,
    /idempotencyKey:\s*studioBookingCampaignDeliveryKey\([\s\S]*sendCampaign,[\s\S]*recipient/,
  );
  assert.match(postHandler, /name:\s*"audience", value:\s*"parent"/);
  assert.doesNotMatch(route, /buildStudioBookingStaffCopyDocument|StaffCopySchema|staffCopyEmail|staffCopy:/);
});

test("composer exposes explicit saved/new-only controls and labels Mail/BCC as untracked", () => {
  const component = source("components/studio-booking-email-composer.tsx");
  const baselineAction = section(
    component,
    "async function saveCampaignBaseline",
    "async function sendNewBookings",
  );
  const newOnlyAction = section(
    component,
    "async function sendNewBookings",
    "async function sendBrandedEmail",
  );
  const externalMailActions = section(
    component,
    "async function copyBccList",
    "function validatedStaffCopy",
  );

  assert.match(component, /Remember this message for future new bookings/);
  assert.match(component, /I already sent this — save for future bookings/);
  assert.match(
    component,
    /Send to \{campaign\.newRecipients\} new parent/,
  );
  assert.match(component, /School\/staff copy is manual only and is never included in new-booking delivery/);
  assert.match(component, /checked=\{rememberForNewBookings\}/);
  assert.match(component, /onClick=\{\(\) => void saveCampaignBaseline\(\)\}/);
  assert.match(component, /onClick=\{\(\) => void sendNewBookings\(\)\}/);

  assert.match(baselineAction, /action:\s*"save-baseline"/);
  assert.match(baselineAction, /recipientFingerprint:\s*campaign\?\.currentFingerprint \|\| recipientFingerprint/);
  assert.match(baselineAction, /This action sends no email/);
  assert.match(newOnlyAction, /action:\s*"send-new"/);
  assert.match(newOnlyAction, /recipientFingerprint:\s*campaign\.newFingerprint/);
  assert.match(newOnlyAction, /optional school\/staff copy is not included/i);
  assert.doesNotMatch(newOnlyAction, /staffCopyEmail|normalizedStaffCopyEmail|staffCopy:/);

  assert.match(externalMailActions, /bcc:\s*recipientEmails/);
  assert.match(externalMailActions, /External BCC sends are not tracked as saved-campaign deliveries/);
  assert.match(externalMailActions, /External Mail sends are not tracked as saved-campaign deliveries/);
  assert.doesNotMatch(
    externalMailActions,
    /\/email\/campaign|action:\s*"(?:save-baseline|send-new)"|recordHandledStudioBooking/,
  );
});

test("send-new revalidates after photo loading and keeps stable-key recovery active", () => {
  const route = source(
    "app/api/dashboard/admin/bookings/[eventId]/email/campaign/route.ts",
  );
  const sendNew = route.slice(route.indexOf("const campaign = currentState.campaign"));
  const attachmentsAt = sendNew.indexOf(
    "await loadStudioBookingCampaignAttachments(campaign)",
  );
  const reloadAt = sendNew.indexOf("const sendDetail = await loadStudioBookingDetail(");
  const stateAt = sendNew.indexOf("const sendState = await campaignState({");
  const rateLimitAt = sendNew.indexOf("const campaignLimit = await rateLimit(");
  const sendAt = sendNew.indexOf("return sendStudioBookingEmailWithRetry({");

  assert.ok(
    attachmentsAt >= 0 &&
      attachmentsAt < reloadAt &&
      reloadAt < stateAt &&
      stateAt < rateLimitAt &&
      rateLimitAt < sendAt,
    "the audience and campaign must be revalidated after photo I/O and before rate/send",
  );
  assert.match(sendNew, /sendCampaign\.id !== campaign\.id/);
  assert.match(sendNew, /sendCampaign\.savedAt !== campaign\.savedAt/);
  assert.match(
    sendNew,
    /sendState\.publicSummary\.newFingerprint !== parsed\.data\.recipientFingerprint/,
  );
  assert.match(sendNew, /sendState\.newRecipients\.slice/);

  const trackingBlock = section(
    sendNew,
    "if (handledRecipients.length)",
    "if (offset + SEND_CONCURRENCY",
  );
  assert.match(trackingBlock, /trackingFailed = true/);
  assert.doesNotMatch(trackingBlock, /pauseStudioBookingEmailCampaign/);
  assert.match(sendNew, /trackingFailed,\s*message/);
  assert.match(sendNew, /same stable delivery keys/);

  const component = source("components/studio-booking-email-composer.tsx");
  const newOnlyAction = section(
    component,
    "async function sendNewBookings",
    "async function sendBrandedEmail",
  );
  const resultActions = section(
    component,
    '<div className={styles.emailResultActions}>',
    "          </div>\n        ) : (\n          <fieldset",
  );
  assert.match(newOnlyAction, /payload\.trackingFailed/);
  assert.match(newOnlyAction, /Retry with the same delivery keys; accepted emails will not be duplicated/);
  assert.doesNotMatch(newOnlyAction, /saved campaign was paused/);
  assert.match(resultActions, /result\.deliveryKind === "new"[\s\S]*retrySeconds > 0/);
  assert.doesNotMatch(resultActions, /campaignError/);
});
