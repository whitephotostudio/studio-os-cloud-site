import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalCheckoutJson } from "@/lib/checkout-attempt";
import { findStripeAccountOwner, isStripeHistorySchemaMissing, markStripeAccountDeauthorized } from "@/lib/stripe-connect-history";
import { reconcileOrderRefundFromStripe, recordStripeEvent, retrieveStripeAccount, stripeRequest, syncConnectState, verifySavedOrderPaymentFromStripe } from "@/lib/payments";
import { scheduleOrderRefundEmails } from "@/lib/order-refund-notifications";
import { refreshStandardSignupFromAccount } from "@/lib/stripe-standard-signup";

export type StripeMerchantEvent = {
  id: string; type: string; account?: string; livemode?: boolean;
  data: { object: Record<string, unknown> };
};
export const STRIPE_MERCHANT_EVENT_TYPES = new Set([
  "account.updated", "account.application.deauthorized", "charge.refunded", "refund.updated", "refund.failed",
  "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
  "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated",
  "application_fee.refunded", "application_fee.refund.updated",
]);
class MerchantScopeError extends Error {}
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const accountPattern = /^acct_[A-Za-z0-9_]+$/;
const objectId = (value: unknown) => typeof value === "string" ? value : value && typeof value === "object"
  ? clean((value as Record<string, unknown>).id) : "";

export function isStripeMerchantEvent(event: StripeMerchantEvent) {
  return typeof event?.type === "string" && STRIPE_MERCHANT_EVENT_TYPES.has(event.type) && (event.type.startsWith("account.") ||
    event.type.startsWith("application_fee.") || Boolean(event.account));
}

async function scope(event: StripeMerchantEvent) {
  const object = event.data.object;
  if (event.type.startsWith("application_fee.")) {
    // Application fees are platform objects. A Connect envelope must never
    // make us interpret a merchant-controlled object as a platform fee.
    if (event.account) throw new MerchantScopeError("Application fee must be platform scoped.");
    const feeId = event.type === "application_fee.refund.updated" ? objectId(object.fee) : clean(object.id);
    if (!/^fee_[A-Za-z0-9_]+$/.test(feeId)) throw new MerchantScopeError("Invalid application fee reference.");
    const fee = await stripeRequest<{ id: string; account: string; charge: string; livemode: boolean }>(`application_fees/${encodeURIComponent(feeId)}`);
    if (fee.id !== feeId || !accountPattern.test(fee.account) || fee.livemode !== event.livemode) {
      throw new MerchantScopeError("Application fee ownership or mode differs.");
    }
    return { accountId: fee.account, chargeId: fee.charge };
  }
  const accountId = event.type === "account.updated" ? clean(object.id) : clean(event.account);
  if (!accountPattern.test(accountId) || (event.account && event.account !== accountId)) {
    throw new MerchantScopeError("Merchant event account differs.");
  }
  return { accountId, chargeId: "" };
}

async function verifiedChargePayment(service: SupabaseClient, accountId: string, chargeId: string, photographerId: string) {
  if (!/^ch_[A-Za-z0-9_]+$/.test(chargeId)) throw new MerchantScopeError("Invalid merchant charge.");
  const charge = await stripeRequest<{ id: string; payment_intent: string | null }>(`charges/${encodeURIComponent(chargeId)}`, { account: accountId });
  if (charge.id !== chargeId || !/^pi_[A-Za-z0-9_]+$/.test(charge.payment_intent || "")) throw new MerchantScopeError("Merchant charge has no verified payment.");
  const payment = await stripeRequest<{ id: string; status: string; amount: number; amount_received: number; currency: string;
    metadata?: Record<string, string> }>(`payment_intents/${encodeURIComponent(charge.payment_intent!)}`, { account: accountId });
  if (payment.id !== charge.payment_intent) throw new MerchantScopeError("Merchant payment identity differs.");
  // A Standard merchant can also take payments outside Studio OS. Those
  // charges must not create orphan retry loops or Studio production records.
  if (payment.metadata?.billing_flow !== "customer_order" || !payment.metadata.order_id) return null;
  if (payment.metadata.photographer_id !== photographerId) throw new MerchantScopeError("Merchant payment owner differs.");
  if (!await verifySavedOrderPaymentFromStripe(service, accountId, charge.payment_intent!, payment)) {
    throw new MerchantScopeError("Merchant charge does not belong to this studio checkout.");
  }
  return charge.payment_intent!;
}

async function reconcileRefund(service: SupabaseClient, accountId: string, paymentIntentId: string) {
  if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) throw new MerchantScopeError("Invalid customer payment reference.");
  const result = await reconcileOrderRefundFromStripe(service, accountId, paymentIntentId);
  if (result) await scheduleOrderRefundEmails(service, { account: accountId, paymentIntentId, orderId: result.orderId, refunds: result.verifiedRefunds });
}

/** Handle only signed events passed by the webhook, or their stored payloads.
 * A lease prevents concurrent delivery; completion is recorded AFTER effects.
 * The legacy fallback is allowed only for an unmigrated studio when the new
 * schema is genuinely absent. Provider/database outages remain retryable.
 */
export async function processStripeMerchantEvent(service: SupabaseClient, event: StripeMerchantEvent) {
  if (!isStripeMerchantEvent(event)) return null;
  if (!clean(event.id) || event.id.length > 255 || typeof event.livemode !== "boolean" || !event.data?.object) {
    return { ok: false, status: 400, review: true };
  }
  let eventScope: Awaited<ReturnType<typeof scope>>;
  try { eventScope = await scope(event); }
  catch (error) {
    if (error instanceof MerchantScopeError) return { ok: false, status: 400, review: true };
    throw error;
  }
  const owner = await findStripeAccountOwner(service, eventScope.accountId, { livemode: event.livemode });
  const deauthorization = event.type === "account.application.deauthorized";
  const accountUpdate = event.type === "account.updated";
  // Revocation can race the first account-registration reply. Preserve every
  // signed deauthorization in the durable inbox even before an owner exists;
  // signup registration/activation rejects that account+mode tombstone.
  if (!owner && !deauthorization && !accountUpdate) return { ok: true, status: 200, ignored: true };
  const token = randomUUID();
  const { data: claim, error: claimError } = await service.rpc("claim_stripe_merchant_event", {
    p_event_id: event.id, p_account: eventScope.accountId, p_livemode: event.livemode, p_event_type: event.type,
    p_payload_hash: createHash("sha256").update(canonicalCheckoutJson(event)).digest("hex"), p_payload: event, p_token: token,
  });
  if (claimError) {
    if (isStripeHistorySchemaMissing(claimError) && owner && !owner.migratedAt && !owner.historyRequired && !deauthorization) return null;
    throw claimError;
  }
  if (claim === "processed") return { ok: true, status: 200, duplicate: true };
  if (claim === "review") return { ok: false, status: 400, review: true };
  if (claim !== "claimed") return { ok: false, status: 503, retry: true };
  const finish = async (result: "processed" | "pending" | "review") => {
    const { data, error } = await service.rpc("finish_stripe_merchant_event", { p_event_id: event.id, p_token: token, p_result: result });
    if (error) throw error;
    if (!data) throw new Error("Merchant event lease changed during processing.");
  };
  try {
    const photographerId = owner?.photographerId || "";
    if (!photographerId && !deauthorization && !accountUpdate) throw new MerchantScopeError("Merchant ownership is unavailable.");
    if (event.type === "account.updated") {
      // Always read current account state: a delayed older event cannot undo
      // the latest readiness or switch the active account pointer.
      if (owner?.status !== "blocked") {
        // An account.updated can arrive before first registration. The signup
        // helper resolves only an immutable owned intent, GETs current provider
        // state, and first-activates only after readiness and revocation guards.
        const signup = await refreshStandardSignupFromAccount(service, {
          account: { id: eventScope.accountId }, livemode: event.livemode!,
        });
        if (!signup.handled && owner) {
          const account = await retrieveStripeAccount(eventScope.accountId);
          if (account.id !== eventScope.accountId) throw new MerchantScopeError("Stripe account identity changed.");
          // Express studios without registry rows retain readiness updates;
          // historical rows can never replace the selected current account.
          await syncConnectState(service, photographerId, account);
        } else if (!signup.handled) {
          await recordStripeEvent(service, event, event); await finish("processed");
          return { ok: true, status: 200, ignored: true };
        }
      }
    } else if (event.type === "account.application.deauthorized") {
      await markStripeAccountDeauthorized(service, { accountId: eventScope.accountId, livemode: event.livemode });
    } else if (event.type.startsWith("charge.dispute.")) {
      const disputeId = clean(event.data.object.id);
      if (!/^(?:dp|du)_[A-Za-z0-9_]+$/.test(disputeId)) throw new MerchantScopeError("Invalid dispute reference.");
      const observedAt = new Date().toISOString();
      const dispute = await stripeRequest<{ id: string; charge: string; payment_intent?: string; status: string; amount: number;
        currency: string; livemode: boolean; evidence_details?: { due_by?: number } }>(`disputes/${encodeURIComponent(disputeId)}`, { account: eventScope.accountId });
      if (dispute.id !== disputeId || dispute.livemode !== event.livemode || !Number.isSafeInteger(dispute.amount) || dispute.amount < 0 ||
          !dispute.currency || !dispute.status) throw new MerchantScopeError("Dispute identity or amount differs.");
      const paymentIntentId = await verifiedChargePayment(service, eventScope.accountId, objectId(dispute.charge), photographerId);
      if (!paymentIntentId) {
        await recordStripeEvent(service, event, event); await finish("processed");
        return { ok: true, status: 200, ignored: true };
      }
      if (dispute.payment_intent && dispute.payment_intent !== paymentIntentId) throw new MerchantScopeError("Dispute payment differs.");
      const { error } = await service.from("stripe_merchant_disputes").upsert({ stripe_account_id: eventScope.accountId,
        dispute_id: dispute.id, photographer_id: photographerId, payment_intent_id: paymentIntentId,
        charge_id: objectId(dispute.charge), livemode: event.livemode, status: dispute.status, amount_cents: dispute.amount,
        currency: dispute.currency.toLowerCase(), evidence_due_at: dispute.evidence_details?.due_by
          ? new Date(dispute.evidence_details.due_by * 1000).toISOString() : null, observed_at: observedAt, verified_at: new Date().toISOString(),
      }, { onConflict: "stripe_account_id,dispute_id" });
      if (error) throw error;
    } else if (event.type.startsWith("application_fee.")) {
      const payment = await verifiedChargePayment(service, eventScope.accountId, eventScope.chargeId, photographerId);
      if (payment) await reconcileRefund(service, eventScope.accountId, payment);
    } else {
      let payment: string | null = objectId(event.data.object.payment_intent);
      if (!payment && objectId(event.data.object.charge)) payment = await verifiedChargePayment(service, eventScope.accountId,
        objectId(event.data.object.charge), photographerId);
      // The reconciler verifies the original saved account, group, amount and
      // fee before touching orders, and ignores payments outside Studio OS.
      if (payment) await reconcileRefund(service, eventScope.accountId, payment);
      else if (!objectId(event.data.object.charge)) throw new MerchantScopeError("Refund has no customer payment reference.");
    }
    await recordStripeEvent(service, event, event);
    await finish("processed");
    return { ok: true, status: 200 };
  } catch (error) {
    const review = error instanceof MerchantScopeError;
    try { await finish(review ? "review" : "pending"); } catch { /* Lease expiry recovers a lost acknowledgement. */ }
    return { ok: false, status: review ? 400 : 503, ...(review ? { review: true } : { retry: true }) };
  }
}

export async function recoverStripeMerchantEvents(service: SupabaseClient, limit = 25) {
  const { data, error } = await service.from("stripe_merchant_events").select("payload")
    .in("status", ["pending", "processing"]).lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at").limit(Math.max(1, Math.min(50, limit)));
  if (error) {
    // Schema absence is safe only when no completed migration marker exists.
    // Turning onboarding off must never hide lost refund/account history.
    if (isStripeHistorySchemaMissing(error)) {
      const marker = await service.from("photographers").select("stripe_standard_migrated_at")
        .not("stripe_standard_migrated_at", "is", null).limit(1);
      if (marker.error && !isStripeHistorySchemaMissing(marker.error)) throw marker.error;
      const signupMarker = await service.from("photographers").select("stripe_account_history_required")
        .eq("stripe_account_history_required", true).limit(1);
      if (signupMarker.error && !isStripeHistorySchemaMissing(signupMarker.error)) throw signupMarker.error;
      if (!marker.data?.length && !signupMarker.data?.length) return { checked: 0, recovered: 0, retry: 0, schemaMissing: true };
    }
    throw error;
  }
  let recovered = 0, retry = 0;
  for (const row of data ?? []) {
    const result = await processStripeMerchantEvent(service, row.payload as StripeMerchantEvent);
    if (result?.ok) recovered++; else retry++;
  }
  return { checked: data?.length ?? 0, recovered, retry };
}
