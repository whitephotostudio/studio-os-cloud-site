"use client";

import { type CSSProperties, type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Mail, School, X } from "lucide-react";

type SchoolRow = {
  id: string;
  school_name: string;
  status: string | null;
  portal_status: string | null;
  expiration_date: string | null;
  email_required: boolean | null;
};

type SchoolAccessPayload = {
  ok?: boolean;
  message?: string;
  step?: "school_prerelease" | "school_closed";
  schoolId?: string;
  pin?: string;
  galleryContext?: Record<string, unknown>;
};

function normalizedStatus(school: SchoolRow) {
  return (school.portal_status ?? school.status ?? "").toLowerCase().replaceAll("-", "_");
}

function isSchoolPreRelease(school: SchoolRow) {
  return normalizedStatus(school) === "pre_release";
}

export default function SchoolDirectLoginForm({ school }: { school: SchoolRow }) {
  const router = useRouter();
  const preRelease = isSchoolPreRelease(school);
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState(false);

  async function registerForRelease() {
    await fetch("/api/portal/pre-release-register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schoolId: school.id,
        email: email.trim().toLowerCase(),
      }),
    });
    setRegistered(true);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }

    if (preRelease) {
      setSubmitting(true);
      try {
        await registerForRelease();
      } catch {
        setRegistered(true);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!pin.trim()) {
      setError("Please enter the PIN from your photo envelope.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/portal/school-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schoolId: school.id,
          email: email.trim().toLowerCase(),
          pin: pin.trim(),
          prefetch: true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as SchoolAccessPayload;
      setSubmitting(false);

      if (payload.step === "school_closed") {
        setError("This school gallery is closed.");
        return;
      }

      if (payload.step === "school_prerelease") {
        await registerForRelease().catch(() => setRegistered(true));
        return;
      }

      if (!response.ok || payload.ok === false || !payload.schoolId || !payload.pin) {
        setError(payload.message || "No gallery was found for that school and PIN.");
        return;
      }

      if (payload.galleryContext) {
        try {
          sessionStorage.setItem(
            `gallery_ctx:${payload.pin}:${payload.schoolId}`,
            JSON.stringify({ ...payload.galleryContext, ts: Date.now() }),
          );
        } catch {
          // Continue even when private browsing blocks sessionStorage.
        }
      }

      router.push(
        `/parents/${encodeURIComponent(payload.pin)}?mode=school&school=${encodeURIComponent(payload.schoolId)}&email=${encodeURIComponent(email.trim().toLowerCase())}`,
      );
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Could not reach the gallery service.");
    }
  }

  return (
    <div
      className="parents-motion-page"
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f7e9ee 0%, #f8fafc 46%, #f4e8ef 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 18px",
      }}
    >
      <div
        className="parents-motion-card"
        style={{
          width: "min(100%, 520px)",
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(17,24,39,0.08)",
          borderRadius: 24,
          boxShadow: "0 28px 80px rgba(17,24,39,0.12)",
          padding: "42px 34px 30px",
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 18,
            background: "#111827",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 28px",
          }}
        >
          <School size={28} />
        </div>

        <h1 style={{ fontSize: 30, fontWeight: 800, textAlign: "center", margin: "0 0 10px", color: "#111" }}>
          Client Panel
        </h1>
        <p style={{ fontSize: 14, color: "#667085", margin: "0 0 28px", lineHeight: 1.7, textAlign: "center" }}>
          {preRelease
            ? "Enter your email and we'll send you a notification as soon as the photos are ready."
            : "Enter your email and the PIN from your child's photo envelope."}
        </p>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>School</label>
            <div style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 12, paddingLeft: 16 }}>
              <School size={16} color="#98a2b3" />
              <span style={{ flex: 1, color: "#111" }}>{school.school_name}</span>
              <Link href="/parents" aria-label="Choose another school" style={{ color: "#98a2b3", display: "flex" }}>
                <X size={16} />
              </Link>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Email</label>
            <div style={{ position: "relative" }}>
              <Mail size={16} color="#98a2b3" style={{ position: "absolute", left: 14, top: 17 }} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Enter your email"
                required
                style={{ ...inputStyle, paddingLeft: 42, width: "100%" }}
              />
            </div>
          </div>

          {preRelease ? (
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: 12, padding: "13px 16px", fontSize: 13, lineHeight: 1.7 }}>
              <strong>This gallery isn&apos;t available yet.</strong> Enter your email and we&apos;ll send you a notification as soon as the photos are ready - no PIN needed right now.
            </div>
          ) : (
            <div>
              <label style={labelStyle}>PIN</label>
              <input
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder="Enter school PIN"
                required
                style={{ ...inputStyle, width: "100%" }}
              />
            </div>
          )}

          {error ? (
            <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", borderRadius: 12, padding: "12px 14px", fontSize: 13 }}>
              {error}
            </div>
          ) : null}

          {registered ? (
            <div style={{ background: "#ecfdf3", border: "1px solid #6ee7b7", color: "#065f46", borderRadius: 14, padding: "16px 18px", fontSize: 14, lineHeight: 1.6, textAlign: "center" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", fontWeight: 800, marginBottom: 4 }}>
                <Check size={17} />
                You&apos;re on the list!
              </div>
              We&apos;ll notify you at <strong>{email.trim().toLowerCase()}</strong> when this gallery goes live.
            </div>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              style={{
                height: 52,
                borderRadius: 14,
                border: "none",
                background: "#111827",
                color: "#fff",
                fontWeight: 800,
                fontSize: 14,
                cursor: submitting ? "wait" : "pointer",
              }}
            >
              {submitting ? (preRelease ? "Registering..." : "Checking access...") : preRelease ? "Notify me when it's ready" : "Open school gallery"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 800,
  color: "#667085",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 8,
};

const inputStyle: CSSProperties = {
  minHeight: 52,
  borderRadius: 14,
  border: "1px solid #d9dee7",
  background: "#fff",
  color: "#111827",
  caretColor: "#111827",
  colorScheme: "light",
  padding: "0 14px",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};
