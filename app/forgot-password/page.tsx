"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/reset-password` },
    );

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />

      <main className="mx-auto flex max-w-7xl px-6 py-20">
        <div className="mx-auto w-full max-w-md">
          <div className="rounded-3xl border border-black/5 bg-white p-8 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
            {sent ? (
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                  Check your email
                </h2>
                <p className="mt-3 text-sm leading-6 text-neutral-500">
                  We sent a password reset link to <strong className="text-neutral-700">{email}</strong>. Click the link in the email to set a new password.
                </p>
                <p className="mt-4 text-sm text-neutral-400">
                  Didn&apos;t receive it? Check your spam folder or try again.
                </p>
                <div className="mt-6 flex flex-col gap-3">
                  <button
                    onClick={() => { setSent(false); setEmail(""); }}
                    className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
                  >
                    Try a different email
                  </button>
                  <Link
                    href="/sign-in"
                    className="w-full rounded-2xl bg-black px-4 py-3 text-center text-sm font-medium text-white transition hover:opacity-90"
                  >
                    Back to Sign In
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                  Reset your password
                </h2>
                <p className="mt-2 text-sm text-neutral-500">
                  Enter the email you used to sign up and we&apos;ll send you a link to reset your password.
                </p>

                <form onSubmit={handleSubmit} className="mt-8 space-y-5">
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

                  {error ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? "Sending..." : "Send Reset Link"}
                  </button>
                </form>

                <div className="mt-6 text-sm text-neutral-600">
                  Remember your password?{" "}
                  <Link href="/sign-in" className="font-medium text-black underline underline-offset-4">
                    Sign in
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
