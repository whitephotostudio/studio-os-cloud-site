"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { createClient } from "@/lib/supabase/client";
import {
  getPlanPriceCents,
  normalizeBillingInterval,
  normalizePlanCode,
} from "@/lib/studio-pricing";

export default function SignUpPage() {
  const supabase = createClient();
  const [selectedPlan, setSelectedPlan] = useState<ReturnType<typeof normalizePlanCode>>(null);
  const [selectedInterval, setSelectedInterval] = useState<"month" | "year">("month");
  const [redirectPath, setRedirectPath] = useState("");
  const [downloadSource, setDownloadSource] = useState(false);

  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [accountCreated, setAccountCreated] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSelectedPlan(normalizePlanCode(params.get("plan")));
    setSelectedInterval(normalizeBillingInterval(params.get("interval")) ?? "month");
    setRedirectPath(params.get("redirect") ?? "");
    setDownloadSource(params.get("source") === "download-app");
    const prefilledEmail = params.get("email");
    if (prefilledEmail) setEmail(prefilledEmail);
  }, []);

  async function handleSignUp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          business_name: businessName,
          phone: phone,
        },
        // Land on our friendly /auth/callback page after the user clicks the
        // verification link in their welcome email, then bounce them to the
        // dashboard with their trial active.
        emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
      },
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    const existingEmailDetected =
      Array.isArray(data.user?.identities) && data.user!.identities.length === 0;

    if (existingEmailDetected) {
      setMessage(
        "This email already has a Studio OS Cloud account. Sign in instead, or use Forgot password if you need to reset it.",
      );
      setLoading(false);
      return;
    }

    setAccountCreated(true);
    setMessage("Check your email to confirm your account, then choose where you want to go next.");
    setLoading(false);
  }

  const signInHref = (() => {
    const params = new URLSearchParams();
    if (redirectPath) params.set("redirect", redirectPath);
    if (email.trim()) params.set("email", email.trim());
    return params.toString() ? `/sign-in?${params.toString()}` : "/sign-in";
  })();

  const dashboardHref = (() => {
    const params = new URLSearchParams();
    params.set("redirect", "/dashboard");
    if (email.trim()) params.set("email", email.trim());
    return `/sign-in?${params.toString()}`;
  })();

  const downloadAppHref = (() => {
    const params = new URLSearchParams();
    params.set("redirect", "/studio-os/download");
    if (email.trim()) params.set("email", email.trim());
    return `/sign-in?${params.toString()}`;
  })();

  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />

      <main className="mx-auto flex max-w-7xl px-6 py-20">
        <div className="grid w-full gap-12 lg:grid-cols-2">
          <div className="flex flex-col justify-center">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-neutral-500">
              Photographer Registration
            </p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-neutral-950 md:text-5xl">
              Start your free 30-day trial
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-neutral-600">
              Get full access to every Studio OS Cloud feature for 30 days — no credit
              card required. Build your photographer portal, school galleries, and
              connected online workflow.
            </p>

            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Full Studio plan access — free for 30 days
            </div>

            {selectedPlan ? (
              <div className="mt-8 max-w-xl rounded-[28px] border border-neutral-200 bg-neutral-50 p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">
                  Selected package
                </div>
                <div className="mt-3 text-2xl font-semibold text-neutral-950">
                  {selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} ·{" "}
                  {selectedInterval === "year" ? "Annual prepaid" : "Monthly"}
                </div>
                <div className="mt-3 text-base text-neutral-600">
                  {new Intl.NumberFormat("en-CA", {
                    style: "currency",
                    currency: "CAD",
                  }).format(getPlanPriceCents(selectedPlan, selectedInterval) / 100)}
                </div>
                <div className="mt-3 text-sm leading-7 text-neutral-500">
                  Create your account first, then finish Stripe Connect and plan activation in
                  billing settings.
                </div>
              </div>
            ) : null}

            <div className="mt-8 text-sm text-neutral-500">
              Need to compare packages first?{" "}
              <Link href="/pricing" className="font-medium text-neutral-950 underline underline-offset-4">
                View pricing
              </Link>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <div className="w-full max-w-md rounded-3xl border border-black/5 bg-white p-8 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
              {!accountCreated ? (
                <>
                  <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                    Create your free account
                  </h2>
                  <p className="mt-2 text-sm text-neutral-500">
                    No credit card needed. Your 30-day trial begins after email verification.
                  </p>

                  <form onSubmit={handleSignUp} className="mt-8 space-y-5">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-neutral-700">
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-black"
                        placeholder="Your full name"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-neutral-700">
                        Business Name
                      </label>
                      <input
                        type="text"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-black"
                        placeholder="WhitePhoto"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-neutral-700">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-black"
                        placeholder="+1 (555) 000-0000"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-neutral-700">
                        Email
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-black"
                        placeholder="you@example.com"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-neutral-700">
                        Password
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-black"
                        placeholder="Create a password"
                      />
                    </div>

                    {message ? (
                      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
                        {message}
                      </div>
                    ) : null}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loading ? "Creating account..." : "Start Free Trial"}
                    </button>
                  </form>

                  <div className="mt-6 text-sm text-neutral-600">
                    Already have an account?{" "}
                    <Link href={signInHref} className="font-medium text-black underline underline-offset-4">
                      Sign in
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Trial activated
                  </div>

                  <h2 className="mt-5 text-3xl font-semibold tracking-tight text-neutral-950">
                    Congratulations, your free trial is ready.
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-neutral-600">
                    {message}
                  </p>

                  <div className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
                    Signed up with <span className="font-semibold text-neutral-950">{email}</span>
                  </div>

                  <div className="mt-8 grid gap-3 sm:grid-cols-2">
                    <Link
                      href={dashboardHref}
                      className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                    >
                      Access Dashboard
                    </Link>
                    <Link
                      href={downloadAppHref}
                      className="inline-flex items-center justify-center rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-50"
                    >
                      Download the App
                    </Link>
                  </div>

                  <p className="mt-5 text-xs leading-6 text-neutral-500">
                    After you confirm your email, either option will guide you back into the right place.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
