"use client";

// AgreementGate
//
// Wraps protected children (dashboard, /m, /studio-os/download).  On mount
// it calls /api/dashboard/agreement/status.  Until we get a "yes" back it
// shows a blocking full-screen modal.  The modal has:
//   - Checkbox unchecked by default
//   - Agree button disabled until the checkbox is ticked
//   - "I do not agree" → signs the user out locally and redirects to
//     /sign-in with a flag so the sign-in page can show a short explainer
//   - Links to /terms, /privacy, /data-responsibility-agreement
//
// While the status is still loading we render a neutral splash so the
// dashboard never flashes briefly before being covered.  If the status
// call says the user isn't signed in we just render the children; their
// own layout's auth guard will do the redirect.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  AGREEMENT_POLICY_LINKS,
  CURRENT_AGREEMENT_VERSION,
} from "@/lib/agreement";

type Status = "loading" | "required" | "ok" | "no-session";

export function AgreementGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/agreement/status", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        // Network/server trouble — default to "required" to be safe.
        setStatus("required");
        return;
      }
      let payload: {
        accepted?: boolean;
        authenticated?: boolean;
      } = {};
      try {
        payload = await res.json();
      } catch {
        payload = {};
      }
      if (!payload.authenticated) {
        setStatus("no-session");
        return;
      }
      setStatus(payload.accepted ? "ok" : "required");
    } catch {
      setStatus("required");
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleAccept = useCallback(async () => {
    if (!agreed || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard/agreement/accept", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        let message = "We couldn't record your acceptance. Please try again.";
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // ignore
        }
        setError(message);
        return;
      }
      setStatus("ok");
    } catch {
      setError("Network problem. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [agreed, submitting]);

  const handleDecline = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Best effort — still redirect.
    }
    window.location.href = "/sign-in?declined=1";
  }, [submitting]);

  // Render strategy:
  //   loading → neutral splash (covers children so nothing leaks)
  //   required → splash + modal on top
  //   ok → just children
  //   no-session → just children (the page's own auth guard handles it)
  if (status === "ok" || status === "no-session") {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      {status === "loading" ? <LoadingSplash /> : null}
      {status === "required" ? (
        <AgreementModal
          agreed={agreed}
          onToggle={() => setAgreed((v) => !v)}
          onAccept={handleAccept}
          onDecline={handleDecline}
          submitting={submitting}
          error={error}
        />
      ) : null}
    </>
  );
}

function LoadingSplash() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        background: "#f0f0f0",
        zIndex: 9998,
      }}
    />
  );
}

type ModalProps = {
  agreed: boolean;
  onToggle: () => void;
  onAccept: () => void;
  onDecline: () => void;
  submitting: boolean;
  error: string;
};

function AgreementModal({
  agreed,
  onToggle,
  onAccept,
  onDecline,
  submitting,
  error,
}: ModalProps) {
  // Lock body scroll while the modal is up so the dashboard behind can't
  // be interacted with even if the user tabs away from the modal.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Intercept Escape — user should not be able to "close" the modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const canSubmit = useMemo(
    () => agreed && !submitting,
    [agreed, submitting],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="agreement-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15,23,42,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        overflowY: "auto",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "#ffffff",
          borderRadius: 20,
          boxShadow: "0 30px 80px rgba(15,23,42,0.28)",
          overflow: "hidden",
          color: "#111827",
        }}
      >
        {/* Header band */}
        <div
          style={{
            padding: "18px 22px",
            background: "#cc0000",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            aria-hidden
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "rgba(255,255,255,0.16)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AlertTriangle size={18} />
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.14em",
                fontWeight: 800,
                opacity: 0.9,
                textTransform: "uppercase",
              }}
            >
              Required · Studio OS Cloud
            </div>
            <h2
              id="agreement-title"
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 900,
                letterSpacing: "0.01em",
              }}
            >
              Studio OS Cloud Agreement Required
            </h2>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 22px" }}>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.55,
              color: "#111827",
              fontWeight: 500,
            }}
          >
            Before using Studio OS Cloud, you must confirm that you have
            permission to upload and manage photos, names, emails,
            student/client information, parent/client access, galleries,
            orders, and related data through this platform.
          </p>

          <div
            style={{
              marginTop: 16,
              padding: "12px 14px",
              border: "1px solid #fee2e2",
              background: "#fff5f5",
              borderRadius: 12,
              fontSize: 12,
              color: "#7f1d1d",
              fontWeight: 600,
              lineHeight: 1.5,
            }}
          >
            Please review each document before accepting:
            <ul
              style={{
                margin: "8px 0 0 0",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <li>
                <Link
                  href={AGREEMENT_POLICY_LINKS.terms}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#cc0000", fontWeight: 800 }}
                >
                  Studio OS Cloud Terms →
                </Link>
              </li>
              <li>
                <Link
                  href={AGREEMENT_POLICY_LINKS.privacy}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#cc0000", fontWeight: 800 }}
                >
                  Privacy Policy →
                </Link>
              </li>
              <li>
                <Link
                  href={AGREEMENT_POLICY_LINKS.dataResponsibility}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#cc0000", fontWeight: 800 }}
                >
                  Data Responsibility Agreement →
                </Link>
              </li>
            </ul>
          </div>

          <label
            htmlFor="agreement-accept"
            style={{
              marginTop: 18,
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              cursor: "pointer",
              padding: "12px 14px",
              border: agreed ? "1.5px solid #cc0000" : "1.5px solid #e5e7eb",
              background: agreed ? "#fff5f5" : "#ffffff",
              borderRadius: 14,
              transition: "border-color 120ms ease, background 120ms ease",
            }}
          >
            <input
              id="agreement-accept"
              type="checkbox"
              checked={agreed}
              onChange={onToggle}
              disabled={submitting}
              style={{
                marginTop: 3,
                width: 18,
                height: 18,
                accentColor: "#cc0000",
                cursor: "pointer",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: "#111827",
                fontWeight: 600,
              }}
            >
              I agree to the Studio OS Cloud Terms, Privacy Policy, and
              Data Responsibility Agreement. I confirm that I have the
              legal right, permission, or client/school authorization to
              upload and manage this data.
            </span>
          </label>

          {error ? (
            <div
              role="alert"
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          ) : null}

          <div
            style={{
              marginTop: 18,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <button
              type="button"
              onClick={onAccept}
              disabled={!canSubmit}
              style={{
                padding: "13px 16px",
                borderRadius: 12,
                border: "none",
                background: canSubmit ? "#cc0000" : "#f3f4f6",
                color: canSubmit ? "#ffffff" : "#9ca3af",
                fontWeight: 900,
                fontSize: 14,
                letterSpacing: "0.02em",
                cursor: canSubmit ? "pointer" : "not-allowed",
                transition: "background 120ms ease",
              }}
            >
              {submitting ? "Saving…" : "Agree and continue"}
            </button>
            <button
              type="button"
              onClick={onDecline}
              disabled={submitting}
              style={{
                padding: "11px 16px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#ffffff",
                color: "#111827",
                fontWeight: 800,
                fontSize: 13,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              I do not agree — sign me out
            </button>
          </div>

          <div
            style={{
              marginTop: 14,
              fontSize: 11,
              color: "#6b7280",
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            Agreement version {CURRENT_AGREEMENT_VERSION}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AgreementGate;
