"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { createClient } from "@/lib/supabase/client";

type CallbackState =
  | { kind: "loading" }
  | { kind: "success"; email: string | null }
  | { kind: "error"; message: string };

/**
 * Email-verification landing page.
 *
 * Supabase email confirmation links redirect the user back here after they
 * click the link in their welcome email. We finish the auth exchange, show
 * a friendly "you're verified" screen, and then bounce them into the
 * dashboard so their 30-day trial starts immediately.
 *
 * Supports two link formats:
 *   1. PKCE (?code=...)        — exchangeCodeForSession
 *   2. Implicit (#access_token) — Supabase auto-detects from the URL hash
 */
export default function AuthCallbackPage() {
  const supabase = createClient();
  const [state, setState] = useState<CallbackState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const errorDescription =
          url.searchParams.get("error_description") ||
          new URLSearchParams(window.location.hash.replace(/^#/, "")).get(
            "error_description",
          );

        if (errorDescription) {
          if (!cancelled) {
            setState({ kind: "error", message: errorDescription });
          }
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            if (!cancelled) setState({ kind: "error", message: error.message });
            return;
          }
        }

        // Whether we came in via PKCE or implicit hash, the supabase-js
        // client will have a session by now if verification succeeded.
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          if (!cancelled) {
            setState({
              kind: "error",
              message:
                "We could not confirm your email automatically. Try signing in — if it still says the email is not confirmed, click 'Resend verification email' on the sign-in page.",
            });
          }
          return;
        }

        if (!cancelled) {
          setState({ kind: "success", email: session.user.email ?? null });
        }

        // Auto-redirect to the dashboard after a short pause so the user
        // sees the success state rather than getting bounced instantly.
        setTimeout(() => {
          window.location.href = "/dashboard";
        }, 1800);
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : "Something went wrong confirming your email.",
          });
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl items-center justify-center px-6 py-24">
        <div className="w-full rounded-3xl border border-black/5 bg-white p-10 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
          {state.kind === "loading" ? (
            <>
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100">
                <svg
                  className="h-6 w-6 animate-spin text-neutral-600"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">
                Confirming your email...
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                Hang tight — this only takes a moment.
              </p>
            </>
          ) : null}

          {state.kind === "success" ? (
            <>
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100">
                <svg
                  className="h-6 w-6 text-emerald-700"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight">
                Email confirmed
              </h1>
              <p className="mt-3 text-base leading-7 text-neutral-600">
                Welcome to Studio OS Cloud
                {state.email ? (
                  <>
                    , <span className="font-semibold">{state.email}</span>
                  </>
                ) : null}
                . Your 30-day free trial is now active. Taking you to your
                dashboard...
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Go to dashboard
                </Link>
                <Link
                  href="/studio-os/download"
                  className="inline-flex items-center justify-center rounded-2xl border border-neutral-200 px-5 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-50"
                >
                  Download the app
                </Link>
              </div>
            </>
          ) : null}

          {state.kind === "error" ? (
            <>
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100">
                <svg
                  className="h-6 w-6 text-red-700"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">
                We could not confirm your email
              </h1>
              <p className="mt-3 text-sm leading-6 text-neutral-600">
                {state.message}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Back to sign in
                </Link>
                <Link
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-2xl border border-neutral-200 px-5 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-50"
                >
                  Create a new account
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
