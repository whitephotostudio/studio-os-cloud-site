"use client";
import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentSnapshot } from "@/lib/order-payment-policy";

export function OrderPaymentControls({ orderId, supabase, onChanged }: { orderId: string; supabase: SupabaseClient; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [payment, setPayment] = useState<PaymentSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const money = (cents: number, currency = payment?.currency || "CAD") => {
    const formatter = new Intl.NumberFormat("en-CA", { style: "currency", currency });
    const digits = ["ISK", "UGX"].includes(currency.toUpperCase()) ? 2 : (formatter.resolvedOptions().maximumFractionDigits ?? 2);
    return formatter.format(cents / 10 ** digits);
  };
  async function request(action?: "refund" | "cancel") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`/api/dashboard/orders/payment${action ? "" : `?orderId=${encodeURIComponent(orderId)}`}`, {
        method: action ? "POST" : "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` },
        body: action ? JSON.stringify({ orderId, action, reason, paymentId: payment?.paymentId, amountCents: payment?.remainingCents, orderIds: payment?.orderIds }) : undefined,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Payment status could not be verified. Refresh before trying again.");
      if (action) { setPayment(null); setMessage(result.message); await onChanged(); }
      else setPayment(result);
    } catch (error) { setPayment(null); setMessage(error instanceof Error ? error.message : "Could not verify payment."); }
    finally { setConfirmed(false); setBusy(false); inFlight.current = false; }
  }
  const completingFee = Boolean(payment?.canCompleteApplicationFeeRefund && payment.applicationFeeRefundPending &&
    Number.isSafeInteger(payment.applicationFeeRefundRemainingCents) && (payment.applicationFeeRefundRemainingCents || 0) > 0 &&
    /^[a-z]{3}$/i.test(payment.applicationFeeCurrency || ""));
  const action = payment?.canRefund || completingFee ? "refund" : payment?.canCancel ? "cancel" : null;
  return <>
    <button type="button" onClick={() => { setOpen(true); void request(); }} style={{ padding: "9px 14px", border: "1px solid #cbd5e1", borderRadius: 10, background: "white", color: "#334155", cursor: "pointer" }}>Refund / cancel</button>
    {open && <div role="presentation" style={{ position: "fixed", inset: 0, background: "#0f172a99", zIndex: 1000, display: "grid", placeItems: "center", padding: 20 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="payment-dialog-title" style={{ background: "white", color: "#0f172a", width: "100%", maxWidth: 510, maxHeight: "90vh", overflow: "auto", borderRadius: 18, padding: 24 }}>
        <h2 id="payment-dialog-title">Refund or cancel order</h2>
        {busy && <p role="status">Checking payment…</p>}
        {message && <p role="status">{message}</p>}
        {payment && <>
          <p><strong>{payment.customer} · {payment.status}</strong></p>
          <p>Charged: {money(payment.chargedCents)}<br />Refunded: {money(payment.refundedCents)}</p>
          {payment.paymentId && <p style={{ fontSize: 12, overflowWrap: "anywhere" }}>Payment: {payment.paymentId}</p>}
          <p>{payment.orderIds.length > 1 ? `One shared payment covers ${payment.orderIds.length} orders. This action closes ALL linked orders.` : "The order stays in your history after it is closed."}</p>
          <p style={{ fontSize: 13 }}>Stop any print job already at the printer separately. Files already downloaded cannot be recalled.</p>
          {action ? <>
            <label>Reason<textarea value={reason} maxLength={500} disabled={busy} onChange={(e) => setReason(e.target.value)} style={{ display: "block", width: "100%", minHeight: 70, border: "1px solid #94a3b8", borderRadius: 8, padding: 8 }} /></label>
            <label style={{ display: "flex", gap: 10, margin: "16px 0" }}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />{completingFee
              ? `Refund the remaining ${money(payment.applicationFeeRefundRemainingCents!, payment.applicationFeeCurrency!)} Studio OS platform fee to the studio’s Stripe balance. The customer payment is already fully refunded.`
              : action === "refund" ? `Refund ${money(payment.remainingCents)} to the original payment method and close the order${payment.orderIds.length > 1 ? "s" : ""}.` : "Cancel the unpaid order and disable checkout."}</label>
          </> : <p>No payment action is available. Refresh to check for an updated status.</p>}
        </>}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>Close</button>
          <button type="button" disabled={busy} onClick={() => void request()}>Refresh status</button>
          {action && <button type="button" disabled={busy || !confirmed || reason.trim().length < 3} onClick={() => void request(action)}>{completingFee ? "Complete platform fee refund" : action === "refund" ? "Confirm refund" : "Confirm cancellation"}</button>}
        </div>
      </section>
    </div>}
  </>;
}
