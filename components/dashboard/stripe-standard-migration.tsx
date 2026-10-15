"use client";

import { useCallback, useEffect, useState } from "react";

type MigrationStatus = {
  enabled: boolean; testOnly?: boolean; currentAccountId?: string | null;
  pending?: { accountId: string; country: string; ready: boolean; ownershipBound?: boolean; message: string } | null;
  history?: Array<{ accountId: string; accountType: string; status: string }>;
  backfillAvailable?: boolean;
  activationAvailable?: boolean;
};

/** Server status controls visibility. No public/browser feature flag enables this. */
export function StripeStandardMigration({ accessToken, signedIn, onAccountChange }: {
  accessToken: string | null; signedIn: boolean; onAccountChange?: () => void | Promise<void>;
}) {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [backfillCursor, setBackfillCursor] = useState<string | null>(null);
  const [historyReviews, setHistoryReviews] = useState<Array<{ orderId: string; reason: string }>>([]);
  const headers = useCallback(() => ({ "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }), [accessToken]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!signedIn) return;
    const response = await fetch("/api/stripe/standard/status", { headers: headers(), credentials: "include", cache: "no-store", signal });
    const result = await response.json();
    if (signal?.aborted) return;
    if (!response.ok || !result.ok) {
      // A disabled deployment remains invisible, including errors during auth.
      setStatus(result.enabled ? { enabled: true, testOnly: result.testOnly !== false } : null);
      if (result.enabled) setMessage(result.message || "Unable to verify the payment connection.");
      return;
    }
    setStatus(result);
    setConfirmed(false);
  }, [headers, signedIn]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => refresh(controller.signal)).catch(() => {
      if (!controller.signal.aborted) setStatus(null);
    });
    return () => controller.abort();
  }, [refresh]);

  async function action(name: "start" | "activate" | "rollback" | "backfill", accountId?: string) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/stripe/standard/${name}`, {
        method: "POST", headers: headers(), credentials: "include",
        body: JSON.stringify({ accountId: accountId || (name === "start" ? status?.pending?.accountId : undefined), expectedCurrentAccountId: status?.currentAccountId ?? null, confirmed,
          ...(name === "backfill" ? { afterOrderId: backfillCursor, batchSize: 10 } : {}) }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "The payment connection could not be changed.");
      if (name === "start" && result.url) {
        const target = new URL(result.url);
        if (target.protocol !== "https:" || target.hostname !== "connect.stripe.com") throw new Error("The onboarding address could not be verified.");
        window.location.assign(target.toString());
        return;
      }
      if (name === "backfill") {
        setBackfillCursor(result.nextCursor || null);
        setHistoryReviews(result.reviewRequired || []);
        await refresh();
        setMessage(`Verified ${result.mappedOrders} old orders across ${result.mappedPayments} payments. ${result.reviewNeeded} need review.${result.hasMore ? " Another batch is available." : " This scan has reached the end."} No money or order statuses were changed.`);
        return;
      }
      setBackfillCursor(null); setHistoryReviews([]);
      await refresh();
      await onAccountChange?.();
      setMessage(name === "start" ? "The Standard connection is verified. Express remains selected until the checkout switch passes its release checks."
        : name === "rollback" ? "Previous account restored for future checkouts. Historical payments keep their original account."
        : "Standard selected for future checkouts. Existing payments keep their original account.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update the connection."); }
    finally { setBusy(false); }
  }

  if (!signedIn || !status?.enabled) return null;
  const testOnly = status.testOnly !== false;
  const prior = status.history?.find(account => account.status === "legacy" && account.accountType === "express");
  const standardSelected = status.history?.some(account => account.accountId === status.currentAccountId && account.status === "active" && account.accountType === "standard");
  const buttonStyle = { border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 14px", background: "#fff", color: "#0f172a", fontWeight: 700, cursor: busy ? "wait" : "pointer" };
  return (
    <section aria-label={testOnly ? "Stripe Standard test migration" : "WhitePhoto Stripe Standard migration"} style={{ marginBottom: 20, padding: 22, border: "1px solid #93c5fd", borderRadius: 20, background: "#eff6ff", color: "#0f172a" }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>Standard payment connection{testOnly ? " — test preview" : ""}</h2>
      <p style={{ lineHeight: 1.6 }}>{testOnly ? "This preview uses a local test database and Stripe test accounts." : "This release uses WhitePhoto’s existing verified Standard account. Express keeps existing payments and refunds."}</p>
      <p style={{ lineHeight: 1.6 }}>New paid Gallery plans charge 55¢ per paid order; Core and Studio charge 45¢, in the sales currency. Stripe processing is separate. Existing subscriptions and frozen order fees retain their agreed rates.</p>
      <p>Current sales account: <strong>{status.currentAccountId || "None"}</strong></p>
      {standardSelected ? <p>Standard is selected for future checkouts.</p> : null}
      {status.pending ? <p>Pending Standard account: <strong>{status.pending.accountId}</strong> ({status.pending.country}). {status.pending.message}</p> : null}
      {!testOnly && !standardSelected && !status.activationAvailable ? <p>Express remains selected while the payment-history and release checks finish.</p> : null}
      {status.pending || prior ? <label style={{ display: "block", margin: "12px 0" }}>
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} />{" "}
        I confirm ownership of the displayed account for future checkouts. Existing payments keep their original account.
      </label> : null}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {!standardSelected ? <button type="button" style={buttonStyle} disabled={busy || !testOnly && !confirmed} onClick={() => action("start")}>{testOnly ? status.pending ? "Continue test onboarding" : "Create Standard test account" : status.pending?.ownershipBound ? "Reverify Standard account" : "Verify existing Standard ownership"}</button> : null}
        <button type="button" style={buttonStyle} disabled={busy} onClick={() => { setBusy(true); refresh().catch(() => setMessage("Unable to refresh the connection.")).finally(() => setBusy(false)); }}>Refresh verification</button>
        {status.backfillAvailable && !standardSelected ? <button type="button" style={buttonStyle} disabled={busy} onClick={() => action("backfill")}>{backfillCursor ? "Verify next old-payment batch" : "Verify old payment history"}</button> : null}
        {status.pending ? <button type="button" style={buttonStyle} disabled={busy || !confirmed || !status.pending.ready || !testOnly && !status.activationAvailable} onClick={() => action("activate", status.pending?.accountId)}>Switch future checkouts</button> : null}
        {prior ? <button type="button" style={buttonStyle} disabled={busy || !confirmed} onClick={() => action("rollback", prior.accountId)}>Restore previous account</button> : null}
      </div>
      {testOnly ? <p style={{ lineHeight: 1.6, fontSize: 13 }}>Use synthetic studios and Stripe test payment details only.</p> : null}
      {historyReviews.length ? <ul>{historyReviews.map(review => <li key={review.orderId}>{review.orderId}: {review.reason}</li>)}</ul> : null}
      {message ? <p role="status" style={{ fontWeight: 700 }}>{message}</p> : null}
    </section>
  );
}
