"use client";

import { FormEvent, useState, useRef, useEffect } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { createClient } from "@/lib/supabase/client";

type StudioAppSignInStatus = {
  ok?: boolean;
  entitlement?: {
    appAccessEnabled?: boolean;
    canDownload?: boolean;
    planCode?: string | null;
  };
};

// LocalStorage keys used by the "Keep me signed in" feature.  Kept in one
// place so the matching guard inside the dashboard layout can reference the
// same constants and stay in sync.
const REMEMBER_ME_KEY = "studio-os-remember-me";
const REMEMBERED_EMAIL_KEY = "studio-os-last-email";
export const TRANSIENT_SESSION_FLAG = "studio-os-transient-session";
export const SESSION_STARTED_FLAG = "studio-os-session-started";

export default function SignInPage() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  // Default ON — Supabase already persists the session; this toggle lets the
  // photographer opt out so the dashboard guard clears their session the next
  // time they reopen the browser.
  const [rememberMe, setRememberMe] = useState(true);

  // MFA challenge state
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaVerifying, setMfaVerifying] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Unverified-email state — shown when the user tries to sign in before
  // clicking the confirmation link in their welcome email.
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNotice, setResendNotice] = useState("");

  // Focus the TOTP code input when MFA challenge appears
  useEffect(() => {
    if (mfaRequired && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [mfaRequired]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefilledEmail = params.get("email");
    if (prefilledEmail) {
      setEmail(prefilledEmail);
      return;
    }
    // Restore the saved "Remember me" preference + email so returning
    // photographers land on a prefilled form.
    try {
      const savedRemember = window.localStorage.getItem(REMEMBER_ME_KEY);
      if (savedRemember != null) setRememberMe(savedRemember !== "0");
      const savedEmail = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);
      if (savedEmail) setEmail(savedEmail);
    } catch {
      // localStorage may be unavailable (private mode) – fail silently.
    }
  }, []);

  function persistRememberPreference(nextEmail: string) {
    try {
      if (rememberMe) {
        window.localStorage.setItem(REMEMBER_ME_KEY, "1");
        window.localStorage.setItem(REMEMBERED_EMAIL_KEY, nextEmail);
        // We're remembering the session, so clear any transient marker from
        // a previous "uncheck" flow.
        window.localStorage.removeItem(TRANSIENT_SESSION_FLAG);
      } else {
        window.localStorage.setItem(REMEMBER_ME_KEY, "0");
        window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
        // Mark this session as transient and tag the current browser session
        // so the dashboard layout won't sign us out on first load.
        window.localStorage.setItem(TRANSIENT_SESSION_FLAG, "1");
        window.sessionStorage.setItem(SESSION_STARTED_FLAG, "1");
      }
    } catch {
      // Ignore – persistence is a nice-to-have, not required for sign-in.
    }
  }

  async function handleSignIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        const msg = (error.message ?? "").toLowerCase();
        if (msg.includes("email not confirmed") || msg.includes("not confirmed")) {
          // Friendly path for the most common stuck-user case: signed up,
          // hasn't clicked the confirmation link yet.
          setNeedsVerification(true);
          setMessage("");
          setResendNotice("");
          setLoading(false);
          return;
        }
        if (error.message === "Invalid login credentials") {
          setMessage(
            "That email already has an account, but the password did not match. Try again or use Forgot password.",
          );
        } else {
          setMessage(error.message);
        }
        setLoading(false);
        return;
      }

      // Check if MFA verification is required
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (
        aalData &&
        aalData.nextLevel === "aal2" &&
        aalData.currentLevel === "aal1"
      ) {
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        const totpFactor = factorsData?.totp?.find(
          (f) => f.status === "verified",
        );

        if (totpFactor) {
          setMfaRequired(true);
          setMfaFactorId(totpFactor.id);
          setLoading(false);
          return;
        }
      }

      persistRememberPreference(email.trim());
      await redirectAfterSignIn(data.session?.access_token ?? null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
      setLoading(false);
    }
  }

  async function handleMfaVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMfaVerifying(true);
    setMessage("");

    const code = mfaCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setMessage("Please enter a 6-digit code.");
      setMfaVerifying(false);
      return;
    }

    const { data: challengeData, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId: mfaFactorId });

    if (challengeError) {
      setMessage(challengeError.message);
      setMfaVerifying(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: challengeData.id,
      code,
    });

    if (verifyError) {
      setMessage("Invalid verification code. Please try again.");
      setMfaCode("");
      setMfaVerifying(false);
      return;
    }

    // MFA verified — redirect, with Studio OS welcome when eligible.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    persistRememberPreference(email.trim());
    await redirectAfterSignIn(session?.access_token ?? null);
  }

  async function redirectAfterSignIn(accessToken: string | null) {
    const params = new URLSearchParams(window.location.search);
    const requestedRedirect = params.get("redirect") || "/dashboard";

    try {
      const res = await fetch("/api/studio-os-app/status", {
        method: "GET",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: "include",
        cache: "no-store",
      });

      const studioStatus = (await res.json().catch(() => ({}))) as StudioAppSignInStatus;
      const eligible =
        Boolean(studioStatus.ok) &&
        Boolean(studioStatus.entitlement?.appAccessEnabled) &&
        Boolean(studioStatus.entitlement?.canDownload) &&
        (studioStatus.entitlement?.planCode === "core" ||
          studioStatus.entitlement?.planCode === "studio");

      if (eligible && requestedRedirect === "/dashboard") {
        window.location.href = "/dashboard?studio-os-welcome=1";
        return;
      }
    } catch {
      // Fall back to the normal redirect when the welcome check fails.
    }

    window.location.href = requestedRedirect;
  }

  async function handleResendVerification() {
    if (!email.trim()) {
      setResendNotice("Enter your email address first.");
      return;
    }
    setResendBusy(true);
    setResendNotice("");
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: origin
          ? { emailRedirectTo: `${origin}/auth/callback` }
          : undefined,
      });
      if (error) {
        setResendNotice(error.message);
      } else {
        setResendNotice(
          "Verification email sent. Check your inbox (and spam folder) for the confirmation link.",
        );
      }
    } catch (err) {
      setResendNotice(
        err instanceof Error ? err.message : "Unable to resend verification email.",
      );
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />

      <main className="mx-auto flex max-w-7xl px-6 py-20">
        <div className="grid w-full gap-12 lg:grid-cols-2">
          <div className="flex flex-col justify-center">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-neutral-500">
              Photographer Access
            </p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-neutral-950 md:text-5xl">
              Sign in to Studio OS Cloud
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-neutral-600">
              Access your photographer account, manage schools, organize galleries,
              and continue building your connected Studio OS workflow.
            </p>
          </div>

          <div className="flex items-center justify-center">
            <div className="w-full max-w-md rounded-3xl border border-black/5 bg-white p-8 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
              {needsVerification ? (
                <>
                  <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-amber-700"
                    >
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                    Confirm your email
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-neutral-600">
                    Your account exists, but we still need you to verify it.
                    We sent a confirmation link to{" "}
                    <span className="font-semibold text-neutral-950">{email}</span>.
                    Click the link in that email, then come back here and sign in.
                  </p>
                  <p className="mt-3 text-xs leading-5 text-neutral-500">
                    Tip: check your spam or junk folder if you don&apos;t see it
                    within a minute. The link expires after 24 hours.
                  </p>

                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendBusy}
                    className="mt-6 w-full rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resendBusy ? "Sending..." : "Resend verification email"}
                  </button>

                  {resendNotice ? (
                    <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
                      {resendNotice}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      setNeedsVerification(false);
                      setResendNotice("");
                    }}
                    className="mt-4 w-full text-sm font-medium text-neutral-500 transition hover:text-black"
                  >
                    Back to sign in
                  </button>
                </>
              ) : !mfaRequired ? (
                <>
                  <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                    Welcome back
                  </h2>
                  <p className="mt-2 text-sm text-neutral-500">
                    Sign in with your email and password.
                  </p>

                  <form onSubmit={handleSignIn} className="mt-8 space-y-5">
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
                      <div className="mb-2 flex items-center justify-between">
                        <label className="block text-sm font-medium text-neutral-700">
                          Password
                        </label>
                        <Link
                          href="/forgot-password"
                          className="text-sm font-medium text-neutral-500 transition hover:text-black"
                        >
                          Forgot password?
                        </Link>
                      </div>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-black"
                        placeholder="Your password"
                      />
                    </div>

                    {message ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {message}
                      </div>
                    ) : null}

                    <label className="flex cursor-pointer items-center gap-3 text-sm text-neutral-700 select-none">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="h-4 w-4 cursor-pointer rounded border-neutral-300 accent-black"
                      />
                      <span>
                        Keep me signed in on this device
                      </span>
                    </label>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loading ? "Signing in..." : "Sign In"}
                    </button>
                  </form>

                  <div className="mt-6 text-sm text-neutral-600">
                    New to Studio OS Cloud?{" "}
                    <Link href="/sign-up" className="font-medium text-black underline underline-offset-4">
                      Create an account
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600">
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                    Two-factor authentication
                  </h2>
                  <p className="mt-2 text-sm text-neutral-500">
                    Enter the 6-digit code from your authenticator app to continue.
                  </p>

                  <form onSubmit={handleMfaVerify} className="mt-8 space-y-5">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-neutral-700">
                        Verification code
                      </label>
                      <input
                        ref={codeInputRef}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={mfaCode}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                          setMfaCode(val);
                        }}
                        required
                        className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-center text-lg font-semibold tracking-[0.3em] outline-none transition focus:border-black"
                        placeholder="000000"
                      />
                    </div>

                    {message ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {message}
                      </div>
                    ) : null}

                    <button
                      type="submit"
                      disabled={mfaVerifying || mfaCode.length !== 6}
                      className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {mfaVerifying ? "Verifying..." : "Verify"}
                    </button>
                  </form>

                  <button
                    onClick={() => {
                      setMfaRequired(false);
                      setMfaCode("");
                      setMfaFactorId("");
                      setMessage("");
                    }}
                    className="mt-4 text-sm font-medium text-neutral-500 transition hover:text-black"
                  >
                    Back to sign in
                  </button>
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
