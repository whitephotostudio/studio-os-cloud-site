"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { createClient } from "@/lib/supabase/client";

type ResetStage =
  | "verifying-link"
  | "checking-security"
  | "mfa"
  | "password"
  | "done"
  | "invalid";

type TotpFactor = {
  id: string;
  friendlyName: string;
};

type RecoveryProof = {
  userId: string;
};

const SUPABASE_PASSWORD_SYMBOLS =
  "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

const PASSWORD_REQUIREMENTS = [
  {
    key: "length",
    label: "At least 8 characters",
    test: (value: string) => value.length >= 8,
  },
  {
    key: "lower",
    label: "One lowercase letter",
    test: (value: string) => /[a-z]/.test(value),
  },
  {
    key: "upper",
    label: "One uppercase letter",
    test: (value: string) => /[A-Z]/.test(value),
  },
  {
    key: "number",
    label: "One number",
    test: (value: string) => /\d/.test(value),
  },
  {
    key: "symbol",
    label: "One special character",
    test: (value: string) =>
      Array.from(value).some((character) =>
        SUPABASE_PASSWORD_SYMBOLS.includes(character),
      ),
  },
] as const;

function VisibilityIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 3 18 18" />
      <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
      <path d="M9.9 4.2A11 11 0 0 1 12 4c6.5 0 10 8 10 8a16 16 0 0 1-2.1 3.3" />
      <path d="M6.6 6.6C3.6 8.5 2 12 2 12s3.5 8 10 8a9.8 9.8 0 0 0 4.1-.9" />
    </svg>
  );
}

export default function ResetPasswordPage() {
  // Keep one client for the lifetime of this page. Recreating it during a
  // render can lose the one-time PASSWORD_RECOVERY auth event.
  const [supabase] = useState(() => createClient());

  const recoveryProofRef = useRef<RecoveryProof | null>(null);
  const [recoveryUserId, setRecoveryUserId] = useState("");
  const [securityCheckVersion, setSecurityCheckVersion] = useState(0);
  const [stage, setStage] = useState<ResetStage>("verifying-link");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [totpFactors, setTotpFactors] = useState<TotpFactor[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState("");
  const [mfaCode, setMfaCode] = useState("");

  const clearSensitiveFields = useCallback(() => {
    setPassword("");
    setConfirm("");
    setMfaCode("");
    setShowPassword(false);
    setShowConfirm(false);
  }, []);

  const invalidateRecovery = useCallback(
    (message: string) => {
      recoveryProofRef.current = null;
      setRecoveryUserId("");
      setTotpFactors([]);
      setSelectedFactorId("");
      clearSensitiveFields();
      setLoading(false);
      setError(message);
      setStage("invalid");
    },
    [clearSensitiveFields],
  );

  useEffect(() => {
    let active = true;
    const timeoutId = window.setTimeout(() => {
      if (active && !recoveryProofRef.current) {
        invalidateRecovery(
          "This password reset link is invalid or has expired. Request a new link and try again.",
        );
      }
    }, 10000);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      if (event === "PASSWORD_RECOVERY" && session?.user?.id) {
        window.clearTimeout(timeoutId);
        recoveryProofRef.current = { userId: session.user.id };
        setRecoveryUserId(session.user.id);
        setSecurityCheckVersion((version) => version + 1);
        setError("");
        setStage("checking-security");
        return;
      }

      const proof = recoveryProofRef.current;
      if (
        proof &&
        (event === "SIGNED_OUT" || !session || session.user.id !== proof.userId)
      ) {
        invalidateRecovery(
          "Your password reset session is no longer valid. Request a new link and try again.",
        );
      }
    });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
      recoveryProofRef.current = null;
    };
  }, [invalidateRecovery, supabase]);

  useEffect(() => {
    if (!recoveryUserId) return;

    let cancelled = false;

    async function checkRecoverySecurity() {
      const proof = recoveryProofRef.current;
      if (!proof || proof.userId !== recoveryUserId) return;

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (cancelled) return;
      if (userError || !user || user.id !== proof.userId) {
        invalidateRecovery(
          "This password reset link could not be verified. Request a new link and try again.",
        );
        return;
      }

      const { data: aalData, error: aalError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (cancelled) return;
      if (aalError || !aalData) {
        invalidateRecovery(
          "We could not verify your account security. Request a new link and try again.",
        );
        return;
      }

      if (
        aalData.nextLevel === "aal2" &&
        aalData.currentLevel !== "aal2"
      ) {
        const { data: factorsData, error: factorsError } =
          await supabase.auth.mfa.listFactors();

        if (cancelled) return;
        if (factorsError) {
          invalidateRecovery(
            "We could not load your authenticator. Request a new reset link and try again.",
          );
          return;
        }

        const verifiedTotp = (factorsData?.totp ?? [])
          .filter((factor) => factor.status === "verified")
          .map((factor) => ({
            id: factor.id,
            friendlyName: factor.friendly_name || "Authenticator app",
          }));

        if (verifiedTotp.length === 0) {
          invalidateRecovery(
            "This account requires two-step verification, but no verified authenticator is available. Contact support for help.",
          );
          return;
        }

        setTotpFactors(verifiedTotp);
        setSelectedFactorId(verifiedTotp[0].id);
        setStage("mfa");
        return;
      }

      setStage("password");
    }

    void checkRecoverySecurity();

    return () => {
      cancelled = true;
    };
  }, [
    invalidateRecovery,
    recoveryUserId,
    securityCheckVersion,
    supabase,
  ]);

  async function handleMfaSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError("");

    const code = mfaCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    const proof = recoveryProofRef.current;
    const selectedFactor = totpFactors.find(
      (factor) => factor.id === selectedFactorId,
    );
    if (!proof || !selectedFactor) {
      invalidateRecovery(
        "Your password reset session is no longer valid. Request a new link and try again.",
      );
      return;
    }

    setLoading(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user || user.id !== proof.userId) {
      invalidateRecovery(
        "Your password reset session is no longer valid. Request a new link and try again.",
      );
      return;
    }

    const { data: challengeData, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId: selectedFactor.id });

    if (challengeError || !challengeData) {
      setMfaCode("");
      setError("We could not start verification. Please try again.");
      setLoading(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: selectedFactor.id,
      challengeId: challengeData.id,
      code,
    });

    setMfaCode("");

    if (verifyError) {
      setError("That verification code was not accepted. Please try again.");
      setLoading(false);
      return;
    }

    const { data: aalData, error: aalError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (
      aalError ||
      !aalData ||
      (aalData.nextLevel === "aal2" && aalData.currentLevel !== "aal2")
    ) {
      setError("Two-step verification could not be confirmed. Please try again.");
      setLoading(false);
      return;
    }

    setError("");
    setLoading(false);
    setStage("password");
  }

  async function handlePasswordSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setSubmitAttempted(true);
    setError("");

    const requirements = PASSWORD_REQUIREMENTS.map((requirement) => ({
      ...requirement,
      met: requirement.test(password),
    }));

    if (!requirements.every((requirement) => requirement.met)) {
      setError("Your password does not meet all requirements below.");
      return;
    }

    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }

    const proof = recoveryProofRef.current;
    if (!proof) {
      invalidateRecovery(
        "Your password reset session is no longer valid. Request a new link and try again.",
      );
      return;
    }

    setLoading(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user || user.id !== proof.userId) {
      invalidateRecovery(
        "Your password reset session is no longer valid. Request a new link and try again.",
      );
      return;
    }

    const { data: aalData, error: aalError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalError || !aalData) {
      invalidateRecovery(
        "We could not verify your account security. Request a new link and try again.",
      );
      return;
    }

    if (
      aalData.nextLevel === "aal2" &&
      aalData.currentLevel !== "aal2"
    ) {
      setLoading(false);
      setError(
        "Your authenticator verification expired. Enter a new 6-digit code before changing the password.",
      );
      setStage("checking-security");
      setSecurityCheckVersion((version) => version + 1);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      const message = (updateError.message || "").toLowerCase();
      setLoading(false);

      if (message.includes("aal2") || message.includes("mfa")) {
        setError(
          "Enter a fresh 6-digit authenticator code before changing the password.",
        );
        setStage("checking-security");
        setSecurityCheckVersion((version) => version + 1);
        return;
      }

      if (message.includes("weak") || message.includes("password should")) {
        setError("Your password does not meet all requirements below.");
        return;
      }

      if (message.includes("same password") || message.includes("different")) {
        setError("Choose a password you have not used for this account.");
        return;
      }

      if (
        message.includes("expired") ||
        message.includes("session") ||
        message.includes("jwt")
      ) {
        invalidateRecovery(
          "This password reset link has expired. Request a new link and try again.",
        );
        return;
      }

      setError("We could not update your password. Please try again.");
      return;
    }

    recoveryProofRef.current = null;
    clearSensitiveFields();
    setLoading(false);
    setError("");
    setStage("done");
  }

  const requirements = PASSWORD_REQUIREMENTS.map((requirement) => ({
    ...requirement,
    met: requirement.test(password),
  }));

  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />

      <main className="mx-auto flex max-w-7xl px-6 py-20">
        <div className="mx-auto w-full max-w-md">
          <div className="rounded-3xl border border-black/5 bg-white p-8 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
            {stage === "done" ? (
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
                  <svg
                    aria-hidden="true"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-green-600"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                  Password updated
                </h2>
                <p className="mt-3 text-sm leading-6 text-neutral-500">
                  Your password has been changed successfully. You can now use
                  it to sign in to Studio OS Cloud.
                </p>
                <Link
                  href="/dashboard"
                  className="mt-6 inline-block w-full rounded-2xl bg-black px-4 py-3 text-center text-sm font-medium text-white transition hover:opacity-90"
                >
                  Go to Dashboard
                </Link>
              </div>
            ) : stage === "invalid" ? (
              <div className="text-center">
                <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                  Request a new reset link
                </h2>
                <p
                  aria-live="polite"
                  className="mt-3 text-sm leading-6 text-red-700"
                >
                  {error}
                </p>
                <Link
                  href="/forgot-password"
                  className="mt-6 inline-block w-full rounded-2xl bg-black px-4 py-3 text-center text-sm font-medium text-white transition hover:opacity-90"
                >
                  Request a new link
                </Link>
              </div>
            ) : stage === "verifying-link" ||
              stage === "checking-security" ? (
              <div className="text-center">
                <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                  {stage === "verifying-link"
                    ? "Verifying your reset link..."
                    : "Checking account security..."}
                </h2>
                <p className="mt-3 text-sm text-neutral-500">
                  Keep this page open while Studio OS Cloud securely prepares
                  your password reset.
                </p>
              </div>
            ) : stage === "mfa" ? (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                  Verify it&apos;s you
                </h2>
                <p className="mt-2 text-sm leading-6 text-neutral-500">
                  Two-step verification protects this account. Enter the
                  6-digit code from your authenticator app before choosing a
                  new password.
                </p>

                <form onSubmit={handleMfaSubmit} className="mt-8 space-y-5">
                  {totpFactors.length > 1 ? (
                    <div>
                      <label
                        htmlFor="reset-mfa-factor"
                        className="mb-2 block text-sm font-medium text-neutral-700"
                      >
                        Authenticator
                      </label>
                      <select
                        id="reset-mfa-factor"
                        value={selectedFactorId}
                        onChange={(event) =>
                          setSelectedFactorId(event.target.value)
                        }
                        disabled={loading}
                        className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-black"
                      >
                        {totpFactors.map((factor) => (
                          <option key={factor.id} value={factor.id}>
                            {factor.friendlyName}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div>
                    <label
                      htmlFor="reset-mfa-code"
                      className="mb-2 block text-sm font-medium text-neutral-700"
                    >
                      Verification code
                    </label>
                    <input
                      id="reset-mfa-code"
                      name="one-time-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(event) =>
                        setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      required
                      disabled={loading}
                      className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-center text-lg tracking-[0.3em] outline-none transition focus:border-black"
                      placeholder="000000"
                    />
                  </div>

                  {error ? (
                    <div
                      aria-live="polite"
                      className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                    >
                      {error}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? "Verifying..." : "Verify and continue"}
                  </button>
                </form>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                  Set a new password
                </h2>
                <p className="mt-2 text-sm text-neutral-500">
                  Choose a strong new password for your Studio OS Cloud account.
                </p>

                <form onSubmit={handlePasswordSubmit} className="mt-8 space-y-5">
                  <div>
                    <label
                      htmlFor="new-password"
                      className="mb-2 block text-sm font-medium text-neutral-700"
                    >
                      New password
                    </label>
                    <div className="relative">
                      <input
                        id="new-password"
                        name="new-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        onBlur={() => setPasswordTouched(true)}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        autoCapitalize="none"
                        spellCheck={false}
                        aria-describedby="new-password-requirements"
                        className="w-full rounded-2xl border border-neutral-200 px-4 py-3 pr-12 text-sm outline-none transition focus:border-black"
                        placeholder="Create a strong password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        aria-label={
                          showPassword ? "Hide new password" : "Show new password"
                        }
                        aria-pressed={showPassword}
                        title={showPassword ? "Hide new password" : "Show new password"}
                        className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                      >
                        <VisibilityIcon visible={showPassword} />
                      </button>
                    </div>

                    <ul
                      id="new-password-requirements"
                      aria-label="Password requirements"
                      className="mt-3 grid gap-1.5 text-sm"
                    >
                      {requirements.map((requirement) => {
                        const showUnmet =
                          !requirement.met &&
                          (submitAttempted || passwordTouched);
                        const color = requirement.met
                          ? "text-green-700"
                          : showUnmet
                            ? "text-red-700"
                            : "text-neutral-500";

                        return (
                          <li
                            key={requirement.key}
                            className={`flex items-center gap-2 ${color}`}
                          >
                            <span
                              aria-hidden="true"
                              className="inline-flex w-4 justify-center font-semibold"
                            >
                              {requirement.met ? "✓" : showUnmet ? "×" : "○"}
                            </span>
                            <span>{requirement.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="mb-2 block text-sm font-medium text-neutral-700"
                    >
                      Confirm password
                    </label>
                    <div className="relative">
                      <input
                        id="confirm-password"
                        name="confirm-password"
                        type={showConfirm ? "text" : "password"}
                        value={confirm}
                        onChange={(event) => setConfirm(event.target.value)}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        autoCapitalize="none"
                        spellCheck={false}
                        className="w-full rounded-2xl border border-neutral-200 px-4 py-3 pr-12 text-sm outline-none transition focus:border-black"
                        placeholder="Type the new password again"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((visible) => !visible)}
                        aria-label={
                          showConfirm
                            ? "Hide confirmation password"
                            : "Show confirmation password"
                        }
                        aria-pressed={showConfirm}
                        title={
                          showConfirm
                            ? "Hide confirmation password"
                            : "Show confirmation password"
                        }
                        className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                      >
                        <VisibilityIcon visible={showConfirm} />
                      </button>
                    </div>
                  </div>

                  {error ? (
                    <div
                      aria-live="polite"
                      className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                    >
                      {error}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? "Updating..." : "Update password"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
