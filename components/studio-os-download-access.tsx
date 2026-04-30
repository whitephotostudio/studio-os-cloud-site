"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Clock3,
  Download,
  Laptop,
  Loader2,
  Mail,
  MonitorSmartphone,
  ShieldCheck,
} from "lucide-react";

import { Reveal } from "@/components/reveal";
import { createClient } from "@/lib/supabase/client";

type StudioOSDownloadAccessProps = {
  publicRelease: boolean;
  macReady: boolean;
  windowsReady: boolean;
};

type StudioAppStatusPayload = {
  ok?: boolean;
  signedIn?: boolean;
  userEmail?: string | null;
  message?: string;
  release?: {
    version: string;
    macDownloadUrl: string | null;
    windowsDownloadUrl: string | null;
  };
  entitlement?: {
    planCode?: string | null;
    appAccessEnabled?: boolean;
    canDownload?: boolean;
  };
  trialActive?: boolean;
  trialEndsAt?: string | null;
  trialDaysRemaining?: number;
};

function buildSignInHref(email: string, redirect: string) {
  const params = new URLSearchParams();
  params.set("redirect", redirect);
  if (email.trim()) params.set("email", email.trim());
  return `/sign-in?${params.toString()}`;
}

function buildSignUpHref(email: string, redirect: string) {
  const params = new URLSearchParams();
  params.set("redirect", redirect);
  params.set("source", "download-app");
  if (email.trim()) params.set("email", email.trim());
  return `/sign-up?${params.toString()}`;
}

export function StudioOSDownloadAccess({
  publicRelease,
  macReady,
  windowsReady,
}: StudioOSDownloadAccessProps) {
  const supabase = useMemo(() => createClient(), []);
  const formRef = useRef<HTMLDivElement | null>(null);
  const redirectPath = "/studio-os/download";

  const [authResolved, setAuthResolved] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<StudioAppStatusPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<"mac" | "windows">("mac");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get("email");
    if (emailParam) setEmail(emailParam);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const response = await fetch("/api/studio-os-app/status", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });

        const json = (await response.json().catch(() => null)) as StudioAppStatusPayload | null;
        if (cancelled) return;

        if (response.ok && json?.signedIn) {
          setSignedIn(true);
          setStatus(json);
          if (json.userEmail) setEmail(json.userEmail);
        } else {
          setSignedIn(false);
          setStatus(null);
          // Clear any stale browser-only auth so this page doesn't look signed in
          // when the server session is already gone.
          await supabase.auth.signOut().catch(() => undefined);
        }
      } finally {
        if (!cancelled) setAuthResolved(true);
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut().catch(() => undefined);
    setSignedIn(false);
    setStatus(null);
    window.location.href = redirectPath;
  }

  async function handleTrialStart() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setMessage("Please enter your email first.");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      const response = await fetch("/api/studio-os-app/download-interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          platform: selectedPlatform,
        }),
      });

      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;

      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || "Unable to save your email right now.");
      }

      window.location.href = buildSignUpHref(normalizedEmail, redirectPath);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to start your trial right now.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function requestTrialFor(platform: "mac" | "windows") {
    setSelectedPlatform(platform);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const releaseReady =
    publicRelease &&
    Boolean(status?.entitlement?.canDownload ?? (macReady || windowsReady));
  const trialEndsLabel =
    status?.trialEndsAt
      ? new Date(status.trialEndsAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null;

  return (
    <>
      {!authResolved ? (
        <Reveal
          repeat
          className="download-card-motion download-reveal-strong mx-auto mt-12 max-w-4xl rounded-[28px] border border-neutral-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)] sm:p-8"
        >
          <div className="flex items-center gap-3 text-neutral-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm font-medium">Checking your app access...</span>
          </div>
        </Reveal>
      ) : null}

      {authResolved && !signedIn ? (
        <Reveal repeat delay={80} className="download-reveal-side-left">
        <div
          ref={formRef}
          className="download-card-motion mx-auto mt-12 max-w-4xl rounded-[28px] border border-neutral-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)] sm:p-8"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">
                <Clock3 className="h-4 w-4" />
                Activate your 7-day trial
              </div>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-neutral-950 sm:text-4xl">
                Use your email first, then download the app.
              </h2>
              <p className="mt-4 text-base leading-7 text-neutral-600">
                Create your photographer account first so we can activate your 7-day Studio OS trial,
                track your access, and bring you back to the app download when you are ready.
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-700">
              Installer ready for {selectedPlatform === "mac" ? "Mac" : "Windows"} after account setup
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-4 sm:flex-row">
            <label className="flex-1">
              <span className="mb-2 block text-sm font-semibold text-neutral-700">
                Your email
              </span>
              <div className="flex items-center gap-3 rounded-[22px] border border-neutral-200 bg-white px-4 py-3">
                <Mail className="h-4 w-4 text-neutral-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full border-0 bg-transparent text-sm text-neutral-950 outline-none"
                />
              </div>
            </label>

            <div className="flex flex-col justify-end gap-3 sm:w-[260px]">
              <button
                type="button"
                onClick={handleTrialStart}
                disabled={submitting}
                className="download-button-motion inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting trial...
                  </>
                ) : (
                  <>
                    Start Free 7-Day Trial
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              <Link
                href={buildSignInHref(email, redirectPath)}
                className="text-center text-sm font-semibold text-neutral-700 underline underline-offset-4"
              >
                Already have an account? Sign in
              </Link>
            </div>
          </div>

          {message ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {message}
            </div>
          ) : null}
        </div>
        </Reveal>
      ) : null}

      {authResolved && signedIn ? (
        <Reveal
          repeat
          delay={80}
          className="download-card-motion download-reveal-side-left mx-auto mt-12 max-w-4xl rounded-[28px] border border-neutral-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)] sm:p-8"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-neutral-700">
                <ShieldCheck className="h-4 w-4" />
                Signed in as {status?.userEmail || email}
              </div>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-neutral-950 sm:text-4xl">
                Your app download is ready.
              </h2>
              <p className="mt-4 text-base leading-7 text-neutral-600">
                Download the installer, sign in inside the app, and Studio OS will check your trial or subscription access automatically.
              </p>
            </div>

            {status?.trialActive ? (
              <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800">
                Free trial active — {status.trialDaysRemaining} day{status.trialDaysRemaining === 1 ? "" : "s"} left
                {trialEndsLabel ? ` (ends ${trialEndsLabel})` : ""}
              </div>
            ) : null}
          </div>

          {status?.message ? (
            <div className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm leading-7 text-neutral-600">
              {status.message}
            </div>
          ) : null}

          <div className="mt-5">
            <button
              type="button"
              onClick={handleSignOut}
              className="text-sm font-semibold text-neutral-600 underline underline-offset-4 transition hover:text-neutral-950"
            >
              Not you? Sign out
            </button>
          </div>
        </Reveal>
      ) : null}

      <div className="mx-auto mt-12 grid max-w-4xl gap-6 lg:grid-cols-2">
        <Reveal repeat delay={150} className="download-reveal-side-left">
        <div className="download-platform-card rounded-[28px] border border-neutral-200 bg-white p-8 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3 text-neutral-950">
            <Laptop className="h-6 w-6 text-red-500" />
            <div className="text-2xl font-bold">Mac</div>
          </div>
          <p className="mt-4 text-sm leading-7 text-neutral-600">
            Best for photographers using macOS today. Download, install, then sign in from inside the app.
          </p>
          {signedIn ? (
            releaseReady && macReady ? (
              <a
                href="/api/studio-os-app/download?platform=mac"
                className="download-button-motion mt-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-5 py-3 font-semibold text-white transition hover:bg-neutral-800"
              >
                <Download className="h-4 w-4" />
                Download for Mac
              </a>
            ) : (
              <div className="mt-6 inline-flex items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-100 px-5 py-3 font-semibold text-neutral-400">
                Mac download coming soon
              </div>
            )
          ) : (
            <button
              type="button"
              onClick={() => requestTrialFor("mac")}
              className="download-button-motion mt-6 inline-flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 px-5 py-3 font-semibold text-neutral-900 transition hover:bg-neutral-100"
            >
              Activate Trial to Download
            </button>
          )}
        </div>
        </Reveal>

        <Reveal repeat delay={280} className="download-reveal-side-right">
        <div className="download-platform-card rounded-[28px] border border-neutral-200 bg-white p-8 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3 text-neutral-950">
            <MonitorSmartphone className="h-6 w-6 text-red-500" />
            <div className="text-2xl font-bold">Windows</div>
          </div>
          <p className="mt-4 text-sm leading-7 text-neutral-600">
            Windows support can live here too. Once your Windows installer is uploaded, this button will light up automatically.
          </p>
          {signedIn ? (
            releaseReady && windowsReady ? (
              <a
                href="/api/studio-os-app/download?platform=windows"
                className="download-button-motion mt-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-5 py-3 font-semibold text-white transition hover:bg-neutral-800"
              >
                <Download className="h-4 w-4" />
                Download for Windows
              </a>
            ) : (
              <div className="mt-6 inline-flex flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-100 px-5 py-3 font-semibold text-neutral-400">
                <span>Windows Download</span>
                <span className="mt-1 text-[11px] uppercase tracking-[0.16em] text-neutral-400">
                  Coming soon
                </span>
              </div>
            )
          ) : (
            <button
              type="button"
              onClick={() => requestTrialFor("windows")}
              className="download-button-motion mt-6 inline-flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 px-5 py-3 font-semibold text-neutral-900 transition hover:bg-neutral-100"
            >
              Activate Trial to Download
            </button>
          )}
        </div>
        </Reveal>
      </div>

      {!signedIn ? (
        <Reveal
          repeat
          delay={220}
          className="download-card-motion download-reveal-strong mx-auto mt-10 max-w-3xl rounded-[24px] border border-neutral-200 bg-white/90 p-6 text-center shadow-[0_16px_36px_rgba(15,23,42,0.04)]"
        >
          <div className="text-sm font-bold uppercase tracking-[0.18em] text-neutral-500">
            Already a photographer account?
          </div>
          <p className="mt-3 text-base leading-7 text-neutral-600">
            Sign in first and this page will immediately swap over to your app download buttons. New photographers can start with the free 7-day trial.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={buildSignInHref(email, redirectPath)}
              className="download-button-motion rounded-2xl bg-neutral-950 px-5 py-3 font-semibold text-white transition hover:bg-neutral-800"
            >
              Sign In to Download
            </Link>
            <Link
              href="/pricing"
              className="rounded-2xl border border-neutral-200 px-5 py-3 font-semibold text-neutral-900 transition hover:bg-neutral-50"
            >
              See Pricing
            </Link>
          </div>
        </Reveal>
      ) : null}
    </>
  );
}
