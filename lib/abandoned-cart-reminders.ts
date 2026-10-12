import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAbandonedCartEmail, buildSchoolAbandonedCartEmail, eventFromName, eventReplyTo } from "@/lib/event-gallery-email";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { createAbandonedCartStopUrl } from "@/lib/abandoned-cart-reminder-links";
import { retrieveCheckoutSession, retrievePaymentIntent } from "@/lib/payments";
import { resendConfigured, sendResendEmail } from "@/lib/resend";
import { hasActiveSubscription } from "@/lib/subscription-gate";
import { calendarBoundaryEnd, hasCalendarBoundaryPassed } from "@/lib/calendar-dates";

/** Payment and identity policy shared by abandoned-cart delivery workers. */
export type CartReminderOrder = {
  id: string;
  photographer_id: string | null;
  project_id: string | null;
  school_id: string | null;
  student_id: string | null;
  customer_email: string | null;
  parent_email: string | null;
  status: string | null;
  payment_status: string | null;
  paid_at: string | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  created_at: string | null;
  refund_status?: string | null;
  refund_amount_cents?: number | null;
  is_test?: boolean | null;
};

const successfulPaymentStates = new Set([
  "paid", "succeeded", "no_payment_required", "partially_refunded", "refunded",
]);
const unpaidPaymentStates = new Set(["", "pending", "unpaid", "failed"]);
export const CART_REMINDER_FIRST_DELAY_HOURS = 24;
export const CART_REMINDER_SECOND_DELAY_HOURS = 72;
export const CART_REMINDER_MIN_GAP_HOURS = 48;

const clean = (value: string | null | undefined) => (value ?? "").trim();
const time = (value: string | null | undefined) => {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
};

/** Prefer the actual purchase email. An invalid explicit email never falls
 * back to an older parent contact and sends to a different person. */
export function cartReminderRecipient(order: Pick<CartReminderOrder, "customer_email" | "parent_email">) {
  const value = clean(order.customer_email) || clean(order.parent_email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null;
}

/** School identity includes the child; events use the exact project/gallery.
 * Missing or ambiguous identities cannot widen suppression to another child. */
export function cartReminderScope(order: CartReminderOrder) {
  const photographer = clean(order.photographer_id);
  const project = clean(order.project_id);
  const school = clean(order.school_id);
  const student = clean(order.student_id);
  const recipient = cartReminderRecipient(order);
  if (!photographer || !recipient || !!project === !!school || (school && !student)) return null;
  return JSON.stringify([photographer, project ? "project" : "school", project || school, school ? student : null, recipient]);
}

/** A status label alone is insufficient evidence that a later draft was paid.
 * Refunds retain their original purchase proof and do not resurrect old carts. */
export function isVerifiedCartPurchase(order: CartReminderOrder) {
  return time(order.paid_at) !== null &&
    order.is_test !== true &&
    successfulPaymentStates.has(clean(order.payment_status).toLowerCase()) &&
    !!(clean(order.stripe_payment_intent_id) || clean(order.stripe_checkout_session_id)) &&
    time(order.created_at) !== null;
}

/** Inconsistent or potentially paid rows fail closed rather than receiving a
 * misleading payment reminder. Closed/fulfilled orders never qualify. */
export function isUnpaidReminderDraft(order: CartReminderOrder) {
  return clean(order.status).toLowerCase() === "payment_pending" &&
    unpaidPaymentStates.has(clean(order.payment_status).toLowerCase()) &&
    !clean(order.paid_at) && !clean(order.stripe_payment_intent_id) &&
    ["", "none"].includes(clean(order.refund_status).toLowerCase()) &&
    Number(order.refund_amount_cents ?? 0) === 0 && order.is_test !== true &&
    time(order.created_at) !== null && cartReminderScope(order) !== null;
}

/** Choose one freshest useful draft per exact recipient/gallery/child scope.
 * The database claim repeats this policy transactionally before every send. */
export function freshestCartReminderDrafts(orders: CartReminderOrder[]) {
  const paidByScope = new Map<string, number>();
  for (const order of orders) {
    const scope = cartReminderScope(order);
    if (!scope || !isVerifiedCartPurchase(order)) continue;
    paidByScope.set(scope, Math.max(paidByScope.get(scope) ?? -Infinity, time(order.created_at)!));
  }
  const freshest = new Map<string, CartReminderOrder>();
  for (const order of orders) {
    if (!isUnpaidReminderDraft(order)) continue;
    const scope = cartReminderScope(order)!;
    const createdAt = time(order.created_at)!;
    if (createdAt <= (paidByScope.get(scope) ?? -Infinity)) continue;
    const previous = freshest.get(scope);
    if (!previous || createdAt > time(previous.created_at)! ||
        (createdAt === time(previous.created_at)! && order.id > previous.id)) {
      freshest.set(scope, order);
    }
  }
  return [...freshest.values()];
}

export function cartReminderStageDue(input: {
  createdAt: string;
  now: number;
  previousSentAt?: string | null;
  sentCount: number;
  blocked?: boolean;
}) {
  const createdAt = time(input.createdAt);
  if (input.blocked || createdAt === null || !Number.isFinite(input.now) ||
      !Number.isInteger(input.sentCount) || input.sentCount < 0 || input.sentCount >= 2) return null;
  if (input.sentCount === 0) {
    return input.now - createdAt >= CART_REMINDER_FIRST_DELAY_HOURS * 3_600_000 ? 1 : null;
  }
  const previous = time(input.previousSentAt);
  return previous !== null && input.now - createdAt >= CART_REMINDER_SECOND_DELAY_HOURS * 3_600_000 &&
    input.now - previous >= CART_REMINDER_MIN_GAP_HOURS * 3_600_000 ? 2 : null;
}

export type CartReminderClaim = {
  claim_id: string;
  lease_token: string;
  order_id: string;
  stage: number;
  dedupe_key: string;
  recipient_email: string;
  photographer_id: string;
  project_id: string | null;
  school_id: string | null;
  student_id: string | null;
  created_at: string;
};
type DeliveryOrder = CartReminderOrder & {
  order_group_id: string | null;
  package_name: string | null;
  total_cents: number | null;
  total_amount: number | null;
};
const orderColumns = "id,photographer_id,project_id,school_id,student_id,customer_email,parent_email,status,payment_status,paid_at,stripe_payment_intent_id,stripe_checkout_session_id,refund_status,refund_amount_cents,is_test,created_at,order_group_id,package_name,total_cents,total_amount";

function metadataMatches(metadata: Record<string, string> | null | undefined, order: DeliveryOrder) {
  return metadata?.photographer_id === order.photographer_id && metadata?.billing_flow === "customer_order" &&
    (metadata?.order_id === order.id || (!!order.order_group_id && metadata?.order_group_id === order.order_group_id));
}

/** Read-only provider verification catches paid/processing checkouts before a
 * delayed webhook has updated orders. Outages and ambiguous identities stop. */
export async function verifyCartReminderCheckout(order: DeliveryOrder, accountId: string | null, deadline = Date.now() + 8_000) {
  const sessionId = clean(order.stripe_checkout_session_id);
  if (!sessionId) return true;
  if (!accountId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return false;
  const session = await beforeDeadline(retrieveCheckoutSession(sessionId, accountId), deadline);
  const checkoutEmail = clean(session.customer_details?.email) || clean((session as { customer_email?: string | null }).customer_email);
  if (session.id !== sessionId || !metadataMatches(session.metadata, order) ||
      checkoutEmail.toLowerCase() !== cartReminderRecipient(order) || session.payment_status !== "unpaid" ||
      !["open", "expired"].includes(session.status ?? "")) return false;
  if (session.payment_intent) {
    if (typeof session.payment_intent !== "string" || !/^pi_[A-Za-z0-9_]+$/.test(session.payment_intent)) return false;
    const intent = await beforeDeadline(retrievePaymentIntent(session.payment_intent, accountId), deadline);
    if (intent.id !== session.payment_intent || !metadataMatches(intent.metadata, order) ||
        !["requires_payment_method", "canceled"].includes(intent.status)) return false;
  }
  return true;
}

async function beforeDeadline<T>(request: PromiseLike<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Reminder processing time budget reached.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(request), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Reminder processing time budget reached.")), remaining);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function cartReminderGalleryUsable(gallery: {
  status?: string | null; portal_status?: string | null; expiration_date?: string | null;
}) {
  const unavailable = new Set(["inactive", "closed", "pre_release", "prerelease", "archived", "deleted"]);
  if ([gallery.status, gallery.portal_status].some(value => unavailable.has(clean(value).toLowerCase().replaceAll("-", "_")))) return false;
  const expiration = clean(gallery.expiration_date);
  return !expiration || (calendarBoundaryEnd(expiration) !== null && !hasCalendarBoundaryPassed(expiration));
}

async function finishClaim(service: SupabaseClient, claim: CartReminderClaim,
  status: "sent" | "skipped" | "uncertain", receipt: string | null = null, deadline = Date.now() + 5_000) {
  const { data, error } = await beforeDeadline(service.rpc("complete_abandoned_cart_reminder", {
    p_claim_id: claim.claim_id, p_lease_token: claim.lease_token, p_status: status, p_resend_email_id: receipt,
    p_error: status === "uncertain" ? "Provider outcome could not be confirmed. Review before retrying." :
      status === "skipped" ? "Cart or delivery context is no longer eligible." : null,
  }), deadline);
  if (error || data !== true) throw new Error("Cart reminder claim completion was not confirmed.");
}

/** Automatic/manual callers share database timing, stops and caps. Force is
 * intentionally not a supported override of recipient eligibility. */
export async function deliverAbandonedCartReminders(service: SupabaseClient, options: {
  origin: string; orderIds?: string[] | null; photographerId?: string | null; limit?: number; maxDurationMs?: number;
}) {
  if (!resendConfigured()) return { processed: 0, sent: 0, skipped: 0, failed: 0, warning: "Resend is not configured on the server." };
  if (options.orderIds?.length === 0) return { processed: 0, sent: 0, skipped: 0, failed: 0 };
  const budget = Math.max(1_000, Math.min(options.maxDurationMs ?? 45_000, 45_000));
  const deadline = Date.now() + budget;
  const workDeadline = deadline - Math.min(5_000, budget / 4);
  const { data, error } = await beforeDeadline(service.rpc("claim_abandoned_cart_reminders", {
    p_order_ids: options.orderIds ?? null, p_photographer_id: options.photographerId ?? null, p_limit: options.limit ?? 100,
  }), workDeadline);
  if (error) throw error;
  const claims = (data ?? []) as CartReminderClaim[];
  let sent = 0; let skipped = 0; let failed = 0;
  for (const [index, claim] of claims.entries()) {
    if (Date.now() >= workDeadline - 17_000) {
      const remaining = claims.slice(index);
      await Promise.allSettled(remaining.map(row => finishClaim(service, row, "skipped", null, deadline)));
      skipped += remaining.length;
      break;
    }
    let providerAttempted = false;
    try {
      const { data: order, error: orderError } = await beforeDeadline(service.from("orders").select(orderColumns)
        .eq("id", claim.order_id).eq("photographer_id", claim.photographer_id).maybeSingle(), workDeadline);
      if (orderError) throw orderError;
      const candidate = order as DeliveryOrder | null;
      if (!candidate || !isUnpaidReminderDraft(candidate) || cartReminderRecipient(candidate) !== claim.recipient_email ||
          candidate.project_id !== claim.project_id || candidate.school_id !== claim.school_id ||
          candidate.student_id !== claim.student_id || Date.parse(candidate.created_at ?? "") !== Date.parse(claim.created_at) ||
          (options.photographerId && claim.photographer_id !== options.photographerId)) {
        await finishClaim(service, claim, "skipped", null, deadline); skipped++; continue;
      }
      const { data: photographer, error: photographerError } = await beforeDeadline(service.from("photographers")
        .select("id,business_name,studio_email,stripe_account_id,stripe_connected_account_id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at")
        .eq("id", claim.photographer_id).maybeSingle(), workDeadline);
      if (photographerError) throw photographerError;
      if (!photographer || !hasActiveSubscription(photographer)) { await finishClaim(service, claim, "skipped", null, deadline); skipped++; continue; }
      const projectId = clean(candidate.project_id); const schoolId = clean(candidate.school_id);
      const galleryResult = projectId
        ? await beforeDeadline(service.from("projects").select("id,photographer_id,title,client_name,access_mode,access_pin,email_required,cover_photo_url,gallery_settings,gallery_slug,status,portal_status,expiration_date").eq("id", projectId).eq("photographer_id", claim.photographer_id).maybeSingle(), workDeadline)
        : await beforeDeadline(service.from("schools").select("id,photographer_id,school_name,access_mode,access_pin,email_required,gallery_settings,gallery_slug,status,portal_status,expiration_date").eq("id", schoolId).eq("photographer_id", claim.photographer_id).maybeSingle(), workDeadline);
      if (galleryResult.error) throw galleryResult.error;
      const gallery = galleryResult.data;
      const settings = normalizeEventGallerySettings(gallery?.gallery_settings);
      const stopRemindersUrl = createAbandonedCartStopUrl({ origin: options.origin, orderId: candidate.id,
        photographerId: claim.photographer_id, recipientEmail: claim.recipient_email });
      if (!gallery || !cartReminderGalleryUsable(gallery) || !settings.extras.enableAbandonedCartEmail || !stopRemindersUrl) {
        await finishClaim(service, claim, "skipped", null, deadline); skipped++; continue;
      }
      const total = Number(candidate.total_cents ?? Math.round(Number(candidate.total_amount ?? 0) * 100));
      const orderTotalLabel = Number.isFinite(total) && total > 0 ? `$${(total / 100).toFixed(2)}` : "your saved cart";
      const email = projectId
        ? buildAbandonedCartEmail({ project: gallery, photographer, share: settings.share, origin: options.origin, orderTotalLabel, stopRemindersUrl })
        : buildSchoolAbandonedCartEmail({ school: gallery, photographer, origin: options.origin, orderTotalLabel, stopRemindersUrl });
      if (!await verifyCartReminderCheckout(candidate, photographer.stripe_connected_account_id || photographer.stripe_account_id || null,
        Math.min(Date.now() + 8_000, workDeadline - 17_000))) {
        await finishClaim(service, claim, "skipped", null, deadline); skipped++; continue;
      }
      if (Date.now() >= workDeadline - 17_000) {
        await finishClaim(service, claim, "skipped", null, deadline); skipped++; continue;
      }
      const { data: authorized, error: authorizationError } = await beforeDeadline(service.rpc("authorize_abandoned_cart_reminder_send", {
        p_claim_id: claim.claim_id, p_lease_token: claim.lease_token,
      }), workDeadline - 16_000);
      if (authorizationError) throw authorizationError;
      if (authorized !== true) { skipped++; continue; }
      providerAttempted = true;
      const receipt = await beforeDeadline(sendResendEmail({ to: claim.recipient_email, ...email,
        fromName: eventFromName(photographer), replyTo: eventReplyTo(photographer), idempotencyKey: claim.dedupe_key,
        timeoutMs: 15_000, tags: [{ name: "type", value: "abandoned_cart" }, { name: "stage", value: String(claim.stage) }],
      }), workDeadline);
      if (!receipt.id) throw new Error("Provider receipt missing.");
      await finishClaim(service, claim, "sent", receipt.id, deadline); sent++;
    } catch {
      failed++;
      try { await finishClaim(service, claim, providerAttempted ? "uncertain" : "skipped", null, deadline); }
      catch { console.error("[cart-reminder] Claim requires reconciliation", { claimId: claim.claim_id }); }
    }
  }
  return { processed: claims.length, sent, skipped, failed };
}
