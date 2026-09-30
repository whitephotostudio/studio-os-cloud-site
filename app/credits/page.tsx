"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { creditPurchaseSignInUrl, selectedCreditPack } from "@/lib/credit-purchase-link";

type Pack = { id: string; code: string; name: string; label?: string; credits: number; priceCents: number };
type CreditStatus = {
  signedIn: boolean;
  creditBalance: number;
  currency: string;
  packs: Pack[];
  expiresAt?: string | null;
  creditDebt?: number;
  isOwner?: boolean;
  premiumCloudAvailable?: boolean;
};

export default function CreditsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signInUrl, setSignInUrl] = useState("/sign-in?redirect=%2Fcredits");
  const submitting = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStatus({ signedIn: false, creditBalance: 0, currency: "cad", packs: [] });
        return;
      }
      const response = await fetch("/api/stripe/status", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();
      if (response.status === 401) {
        setStatus({ signedIn: false, creditBalance: 0, currency: "cad", packs: [] });
        return;
      }
      if (!response.ok || !data.ok) throw new Error(data.message || "Unable to load your credits. Please try again.");
      const packs: Pack[] = data.billingCatalog.creditPacks;
      setStatus({ signedIn: true, creditBalance: data.creditBalance, packs,
        currency: data.billingCatalog.currency || "cad", expiresAt: data.creditExpiresAt,
        creditDebt: data.creditDebt, isOwner: data.isPlatformAdmin, premiumCloudAvailable: data.premiumCloudAvailable });
      setSelected(selectedCreditPack(window.location.search, packs));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load your credits.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    setSignInUrl(creditPurchaseSignInUrl(window.location.search));
    const billing = new URLSearchParams(window.location.search).get("billing");
    if (billing === "credits_success") setNotice("Stripe returned from checkout. Refresh your balance after payment confirmation, then refresh credits in Studio OS.");
    if (billing === "credits_cancel") setNotice("Checkout was cancelled. No new credits were added.");
    void refresh();
  }, [refresh]);

  async function buyCredits(pack: Pack) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(pack.code);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = signInUrl;
        return;
      }
      const response = await fetch("/api/stripe/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        credentials: "include",
        body: JSON.stringify({ action: "buy_credits", packCode: pack.code, returnTo: "credits" }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.url) throw new Error(data.message || "Unable to open credit checkout. Please try again.");
      const checkout = new URL(data.url);
      if (checkout.protocol !== "https:" || checkout.hostname !== "checkout.stripe.com") throw new Error("Unable to open credit checkout.");
      window.location.href = checkout.href;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open credit checkout.");
    } finally {
      submitting.current = false;
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-5 py-10 text-neutral-900 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="text-sm font-semibold">Studio OS Cloud</Link>
        <div className="mt-10 flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Buy background credits</h1>
            <p className="mt-3 max-w-xl leading-7 text-neutral-600">Use credits in Studio OS for local background removal with Photoshop (1 credit per photo) or Premium Cloud processing (4 credits per photo).</p>
          </div>
          {status?.signedIn && <Link href="/dashboard/membership" className="rounded-xl border border-neutral-300 px-4 py-3 text-sm font-semibold">Membership &amp; billing</Link>}
        </div>
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          Before using background credits, <Link href="/studio-os/download" className="font-semibold underline underline-offset-4">install Studio OS for Mac 0.1.14 (18) or later</Link> and sign in with the same account. Older cutouts without a verified paid record remain saved for review.
        </p>
        {notice && <p role="status" className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">{notice}</p>}
        {error && <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">{error} <button onClick={() => void refresh()} className="ml-2 underline">Try again</button></div>}
        {loading ? <p role="status" className="mt-8 text-neutral-600">Loading credits…</p> : status?.signedIn ? (
          <>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-200 bg-white p-6">
              <div><div className="text-sm text-neutral-500">Available balance</div><div className="mt-1 text-2xl font-bold">{status.isOwner ? "Owner access included" : `${status.creditBalance.toLocaleString()} credits`}</div></div>
              <button onClick={() => void refresh()} disabled={Boolean(busy)} className="rounded-xl border border-neutral-300 px-4 py-3 text-sm font-semibold disabled:opacity-50">Refresh balance</button>
            </div>
            <p className="mt-5 text-sm leading-6 text-neutral-600">Purchased credits expire at your next monthly billing date and do not carry over. {status.expiresAt ? `Current credits expire ${new Date(status.expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}. ` : ""}Payments are processed securely by Stripe. After purchasing, refresh your credit balance in the desktop app.</p>
            {!status.premiumCloudAvailable && <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">Premium Cloud is currently unavailable. Credits can be used for local removal with Photoshop. Buy only if you can use them before your next monthly billing date.</p>}
            {Boolean(status.creditDebt) && <p className="mt-3 text-sm leading-6 text-amber-900">Your next purchase first settles {status.creditDebt} credits from a refunded purchase that was already used.</p>}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {status.packs.map(pack => (
                <div key={pack.code} className={`flex flex-col justify-between rounded-2xl border bg-white p-6 ${selected === pack.code ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200"}`}>
                  <div>
                    {selected === pack.code && <p className="mb-2 text-xs font-semibold uppercase tracking-wide">Selected in Studio OS</p>}
                    <h2 className="text-xl font-bold">{pack.label || pack.name}</h2>
                    <p className="mt-2 text-2xl font-semibold">{new Intl.NumberFormat(undefined, { style: "currency", currency: status.currency.toUpperCase() }).format(pack.priceCents / 100)} <span className="text-xs font-normal text-neutral-500">{status.currency.toUpperCase()}</span></p>
                    <p className="mt-2 text-sm text-neutral-600">{pack.credits.toLocaleString()} local removals or up to {Math.floor(pack.credits / 4).toLocaleString()} Premium Cloud removals.</p>
                  </div>
                  <button onClick={() => void buyCredits(pack)} disabled={Boolean(busy)} className="mt-6 rounded-xl bg-neutral-900 px-5 py-3 font-semibold text-white disabled:cursor-wait disabled:opacity-50">{busy === pack.code ? "Opening Stripe…" : "Buy credits"}</button>
                </div>
              ))}
            </div>
          </>
        ) : status && (
          <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-7">
            <h2 className="text-xl font-semibold">Sign in to your photographer account</h2>
            <p className="mt-3 leading-7 text-neutral-600">Use the same account as your Studio OS app so purchased credits appear in your balance. Your selected pack will be waiting after sign-in.</p>
            <Link href={signInUrl} className="mt-6 inline-block rounded-xl bg-neutral-900 px-6 py-3 font-semibold text-white">Sign in to buy credits</Link>
          </div>
        )}
      </div>
    </main>
  );
}
