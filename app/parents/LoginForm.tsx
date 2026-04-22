"use client";
// app/parents/LoginForm.tsx
//
// ✅ PERF: Extracted from page.tsx so it can be used as a Client Component
// child of a Server Component parent. The parent fetches schools/events
// server-side (HTML arrives already populated) — no loading spinner,
// no extra API round-trip on the client.

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Images, KeyRound, Mail, School } from "lucide-react";

type SchoolRow = {
  id: string;
  school_name: string;
  status: string | null;
  expiration_date: string | null;
  email_required: boolean | null;
};

type EventProjectRow = {
  id: string;
  title: string | null;
  client_name: string | null;
  workflow_type: string | null;
  status: string | null;
  portal_status: string | null;
  event_date: string | null;
  email_required: boolean | null;
};

type AccessMode = "school" | "event";

type Step =
  | "login"
  | "school_prerelease"
  | "school_prerelease_done"
  | "school_closed"
  | "event_prerelease"
  | "event_prerelease_done";

type SchoolAccessPayload = {
  ok?: boolean;
  message?: string;
  step?: Step;
  schoolId?: string;
  pin?: string;
  // ✅ Prefetched gallery context returned alongside school validation
  // so the gallery page can skip its own API call entirely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  galleryContext?: Record<string, any>;
};

type EventAccessPayload = {
  ok?: boolean;
  message?: string;
  step?: Step;
  projectId?: string;
  email?: string;
  pin?: string;
};

function projectLabel(project: EventProjectRow) {
  return project.title?.trim() || project.client_name?.trim() || "Untitled Event";
}

export default function LoginForm({
  initialSchools,
  initialEventProjects,
  prefilledEventId,
  prefilledEventEmail,
  prefilledMode,
}: {
  initialSchools: SchoolRow[];
  initialEventProjects: EventProjectRow[];
  prefilledEventId?: string;
  prefilledEventEmail?: string;
  prefilledMode?: AccessMode;
}) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("login");
  const [mode, setMode] = useState<AccessMode>("school");

  // ✅ Initialised from server-fetched props — no spinner, instant render
  const [schools] = useState<SchoolRow[]>(initialSchools);
  const [eventProjects] = useState<EventProjectRow[]>(initialEventProjects);

  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<SchoolRow | null>(null);
  const [schoolEmail, setSchoolEmail] = useState("");
  const [schoolPin, setSchoolPin] = useState("");

  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<EventProjectRow | null>(null);
  const [eventEmail, setEventEmail] = useState("");
  const [eventPin, setEventPin] = useState("");

  const [loginError, setLoginError] = useState("");
  const [searching, setSearching] = useState(false);

  const [regEmail, setRegEmail] = useState("");
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regError, setRegError] = useState("");
  const [schoolPrereleaseRegistered, setSchoolPrereleaseRegistered] = useState(false);
  const [eventPrereleaseRegistered, setEventPrereleaseRegistered] = useState(false);

  useEffect(() => {
    if (prefilledMode === "event" || prefilledEventId) {
      setMode("event");
      if (prefilledEventId) {
        setSelectedEventId(prefilledEventId);
        setSelectedEvent(
          initialEventProjects.find((row) => row.id === prefilledEventId) ?? null,
        );
      }
      if (prefilledEventEmail) {
        setEventEmail(prefilledEventEmail);
      }
    }
  }, [initialEventProjects, prefilledEventEmail, prefilledEventId, prefilledMode]);

  function isSchoolPreRelease(school: SchoolRow | null) {
    return school?.status?.toLowerCase().replaceAll("-", "_") === "pre_release";
  }

  function resetErrors() {
    setLoginError("");
    setRegError("");
  }

  function switchMode(nextMode: AccessMode) {
    setMode(nextMode);
    setStep("login");
    setSelectedSchoolId("");
    setSelectedSchool(null);
    setSchoolEmail("");
    setSchoolPin("");
    setSelectedEventId("");
    setSelectedEvent(null);
    setEventEmail("");
    setEventPin("");
    resetErrors();
    setSchoolPrereleaseRegistered(false);
    setEventPrereleaseRegistered(false);
  }

  async function handleSchoolLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    resetErrors();

    if (!selectedSchoolId || !selectedSchool) {
      setLoginError("Please choose your school.");
      return;
    }
    if (!schoolEmail.trim()) {
      setLoginError("Please enter your email to register for updates.");
      return;
    }

    // Pre-release school: register email directly — no PIN needed
    if (isSchoolPreRelease(selectedSchool)) {
      setSearching(true);
      try {
        await fetch("/api/portal/pre-release-register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ schoolId: selectedSchoolId, email: schoolEmail.trim().toLowerCase() }),
        });
      } catch { /* non-fatal */ }
      setSchoolPrereleaseRegistered(true);
      setSearching(false);
      return;
    }

    if (!schoolPin.trim()) {
      setLoginError("Please enter the PIN from your photo envelope.");
      return;
    }

    setSearching(true);
    try {
      const response = await fetch("/api/portal/school-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          pin: schoolPin.trim(),
          email: schoolEmail.trim().toLowerCase(),
          // ✅ PERF: Ask server to also return gallery data in the same
          // response — gallery page then reads from sessionStorage instead
          // of making its own separate API call.
          prefetch: true,
        }),
      });

      // Parse defensively: if the server returned an HTML error page (e.g.
      // a 500 with a Vercel/Next runtime error), response.json() throws a
      // cryptic DOMException ("The string did not match the expected
      // pattern." in Safari). Show a friendly message instead.
      let payload: SchoolAccessPayload;
      try {
        payload = (await response.json()) as SchoolAccessPayload;
      } catch {
        setSearching(false);
        setLoginError(
          response.status >= 500
            ? "Server error — please try again in a moment."
            : "Could not reach the gallery service. Please try again.",
        );
        return;
      }
      setSearching(false);

      if (payload.step === "school_closed") { setStep("school_closed"); return; }
      if (payload.step === "school_prerelease") {
        // Auto-register with the email already entered — no second screen
        try {
          await fetch("/api/portal/pre-release-register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ schoolId: selectedSchoolId, email: schoolEmail.trim().toLowerCase() }),
          });
        } catch { /* non-fatal */ }
        setSchoolPrereleaseRegistered(true);
        setSearching(false);
        return;
      }

      if (!response.ok || payload.ok === false || !payload.schoolId || !payload.pin) {
        setLoginError(payload.message || "No gallery was found for that school and PIN.");
        return;
      }

      // ✅ PERF: Cache prefetched gallery context so the gallery page can
      // skip its own /api/portal/gallery-context call entirely.
      if (payload.galleryContext) {
        try {
          const cacheKey = `gallery_ctx:${payload.pin}:${payload.schoolId}`;
          sessionStorage.setItem(
            cacheKey,
            JSON.stringify({ ...payload.galleryContext, ts: Date.now() }),
          );
        } catch { /* sessionStorage unavailable in some contexts */ }
      }

      // ✅ PERF: Use router.push (SPA navigation) instead of
      // window.location.href (full page reload) — avoids re-downloading
      // the JS bundle and re-running layout code.
      router.push(
        `/parents/${encodeURIComponent(payload.pin)}?mode=school&school=${encodeURIComponent(payload.schoolId)}&email=${encodeURIComponent(schoolEmail.trim().toLowerCase())}`,
      );
    } catch (error) {
      setSearching(false);
      setLoginError(error instanceof Error ? error.message : "No gallery was found for that school and PIN.");
    }
  }

  async function handleEventLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    resetErrors();

    if (!selectedEventId || !selectedEvent) {
      setLoginError("Please choose your event.");
      return;
    }
    if (!eventEmail.trim()) {
      setLoginError("Please enter your email to register for updates.");
      return;
    }

    // Pre-release event: register email directly — no PIN needed
    if (selectedEvent.portal_status?.toLowerCase().replaceAll("-", "_") === "pre_release") {
      setSearching(true);
      try {
        await fetch("/api/portal/pre-release-register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: selectedEventId, email: eventEmail.trim().toLowerCase() }),
        });
      } catch { /* non-fatal */ }
      setEventPrereleaseRegistered(true);
      setSearching(false);
      return;
    }

    if (!eventPin.trim()) {
      setLoginError("Please enter your event access PIN.");
      return;
    }

    setSearching(true);
    try {
      const response = await fetch("/api/portal/event-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: selectedEventId,
          email: eventEmail.trim(),
          pin: eventPin.trim(),
        }),
      });

      // Defensive parse (see school-access notes above).
      let payload: EventAccessPayload;
      try {
        payload = (await response.json()) as EventAccessPayload;
      } catch {
        setSearching(false);
        setLoginError(
          response.status >= 500
            ? "Server error — please try again in a moment."
            : "Could not reach the gallery service. Please try again.",
        );
        return;
      }
      setSearching(false);

      if (payload.step === "event_prerelease") {
        // Auto-register inline — no second screen
        try {
          await fetch("/api/portal/pre-release-register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: selectedEventId, email: eventEmail.trim().toLowerCase() }),
          });
        } catch { /* non-fatal */ }
        setEventPrereleaseRegistered(true);
        setSearching(false);
        return;
      }

      if (!response.ok || payload.ok === false || !payload.projectId || !payload.email || !payload.pin) {
        setLoginError(payload.message || "No event gallery was found for that email and PIN.");
        return;
      }

      // ✅ PERF: SPA navigation (no full page reload)
      router.push(
        `/parents/${encodeURIComponent(payload.pin)}?mode=event&project=${encodeURIComponent(payload.projectId)}&email=${encodeURIComponent(payload.email)}`,
      );
    } catch (error) {
      setSearching(false);
      setLoginError(error instanceof Error ? error.message : "No event gallery was found for that email and PIN.");
    }
  }

  async function handleEventPreReleaseRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRegSubmitting(true);
    setRegError("");
    try {
      const response = await fetch("/api/portal/pre-release-register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: selectedEventId,
          email: regEmail.trim().toLowerCase(),
        }),
      });

      const payload = (await response.json()) as { ok?: boolean; message?: string };
      setRegSubmitting(false);

      if (!response.ok || payload.ok === false) {
        setRegError(payload.message || "Something went wrong. Please try again.");
        return;
      }
    } catch (error) {
      setRegSubmitting(false);
      setRegError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      return;
    }
    setStep("event_prerelease_done");
  }

  async function handleSchoolPreReleaseRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRegSubmitting(true);
    setRegError("");
    try {
      const response = await fetch("/api/portal/pre-release-register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          email: regEmail.trim().toLowerCase(),
        }),
      });

      const payload = (await response.json()) as { ok?: boolean; message?: string };
      setRegSubmitting(false);

      if (!response.ok || payload.ok === false) {
        setRegError(payload.message || "Something went wrong. Please try again.");
        return;
      }
    } catch (error) {
      setRegSubmitting(false);
      setRegError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      return;
    }
    setStep("school_prerelease_done");
  }

  const inputStyle = {
    width: "100%",
    border: "1.5px solid #e1e3e8",
    borderRadius: 12,
    padding: "14px 16px",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box" as const,
    color: "#111",
    background: "#fff",
    fontFamily: "inherit",
  };

  const card = {
    background: "#fff",
    borderRadius: 24,
    padding: "42px 38px",
    boxShadow: "0 20px 60px rgba(17,24,39,0.08)",
    width: "100%",
    maxWidth: 520,
    border: "1px solid rgba(17,24,39,0.04)",
  };

  const labelStyle = {
    display: "block",
    fontSize: 11,
    fontWeight: 800,
    color: "#7b8190",
    marginBottom: 7,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f7f8fa 0%, #eff2f6 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, sans-serif",
      }}
    >
      {step === "login" && (
        <div style={card}>
          <div
            style={{
              width: 62,
              height: 62,
              background: "#111827",
              borderRadius: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
              boxShadow: "0 16px 40px rgba(17,24,39,0.22)",
            }}
          >
            {mode === "school" ? (
              <School size={26} color="#fff" strokeWidth={2} />
            ) : (
              <Images size={26} color="#fff" strokeWidth={2} />
            )}
          </div>

          <div
            style={{
              display: "flex",
              background: "#f3f5f8",
              borderRadius: 14,
              padding: 6,
              gap: 6,
              marginBottom: 24,
            }}
          >
            <button
              type="button"
              onClick={() => switchMode("school")}
              style={{
                flex: 1, border: "none", borderRadius: 10, padding: "12px 14px",
                fontSize: 14, fontWeight: 700, cursor: "pointer",
                background: mode === "school" ? "#fff" : "transparent",
                color: mode === "school" ? "#111" : "#6b7280",
                boxShadow: mode === "school" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              }}
            >
              School Access
            </button>
            <button
              type="button"
              onClick={() => switchMode("event")}
              style={{
                flex: 1, border: "none", borderRadius: 10, padding: "12px 14px",
                fontSize: 14, fontWeight: 700, cursor: "pointer",
                background: mode === "event" ? "#fff" : "transparent",
                color: mode === "event" ? "#111" : "#6b7280",
                boxShadow: mode === "event" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              }}
            >
              Event Access
            </button>
          </div>

          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#111", margin: "0 0 8px", textAlign: "center" }}>
            Client Panel
          </h1>
          <p style={{ fontSize: 14, color: "#667085", margin: "0 0 28px", lineHeight: 1.7, textAlign: "center" }}>
            {mode === "school"
              ? "Choose your school, then enter your email and the PIN from your child's photo envelope."
              : selectedEvent?.portal_status === "pre_release"
                ? "Choose your event and enter your email to join the gallery release list."
                : "Choose your event, then enter the email and PIN the photographer provided."}
          </p>

          {mode === "school" ? (
            <form onSubmit={handleSchoolLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={labelStyle}>School</label>
                <div style={{ position: "relative" }}>
                  <select
                    value={selectedSchoolId}
                    onChange={(e) => {
                      const nextSchool = schools.find((s) => s.id === e.target.value) ?? null;
                      setSelectedSchoolId(e.target.value);
                      setSelectedSchool(nextSchool);
                      resetErrors();
                    }}
                    required
                    style={{
                      ...inputStyle,
                      appearance: "none",
                      paddingRight: 42,
                      cursor: "pointer",
                      color: selectedSchoolId ? "#111" : "#98a2b3",
                    }}
                  >
                    <option value="" disabled>Select your school…</option>
                    {schools.map((row) => (
                      <option key={row.id} value={row.id}>{row.school_name}</option>
                    ))}
                  </select>
                  <ChevronDown size={18} color="#98a2b3" style={{ position: "absolute", right: 14, top: 15, pointerEvents: "none" }} />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Email</label>
                <div style={{ position: "relative" }}>
                  <Mail size={16} color="#98a2b3" style={{ position: "absolute", left: 14, top: 17 }} />
                  <input
                    type="email"
                    value={schoolEmail}
                    onChange={(e) => setSchoolEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    style={{ ...inputStyle, paddingLeft: 42 }}
                  />
                </div>
              </div>

              {isSchoolPreRelease(selectedSchool) ? (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: 12, padding: "13px 16px", fontSize: 13, lineHeight: 1.7 }}>
                  <strong>This gallery isn't available yet.</strong> Enter your email and we'll send you a notification as soon as the photos are ready — no PIN needed right now.
                </div>
              ) : (
                <div>
                  <label style={labelStyle}>PIN</label>
                  <input
                    value={schoolPin}
                    onChange={(e) => setSchoolPin(e.target.value)}
                    placeholder="Enter school PIN"
                    required={!isSchoolPreRelease(selectedSchool)}
                    style={inputStyle}
                  />
                </div>
              )}

              {loginError ? (
                <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", borderRadius: 12, padding: "12px 14px", fontSize: 13 }}>
                  {loginError}
                </div>
              ) : null}

              {schoolPrereleaseRegistered ? (
                <div style={{ background: "#ecfdf3", border: "1px solid #6ee7b7", color: "#065f46", borderRadius: 14, padding: "16px 18px", fontSize: 14, lineHeight: 1.6, textAlign: "center" }}>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>You're on the list!</div>
                  We'll notify you at <strong>{schoolEmail.trim().toLowerCase()}</strong> when this gallery goes live.
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={searching}
                  style={{ height: 52, borderRadius: 14, border: "none", background: "#111827", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                >
                  {searching
                    ? (isSchoolPreRelease(selectedSchool) ? "Registering…" : "Checking access…")
                    : (isSchoolPreRelease(selectedSchool) ? "Notify me when it's ready" : "Open school gallery")}
                </button>
              )}

            </form>
          ) : (
            <form onSubmit={handleEventLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={labelStyle}>Event</label>
                <div style={{ position: "relative" }}>
                  <select
                    value={selectedEventId}
                    onChange={(e) => {
                      setSelectedEventId(e.target.value);
                      setSelectedEvent(eventProjects.find((row) => row.id === e.target.value) ?? null);
                      resetErrors();
                    }}
                    required
                    style={{ ...inputStyle, appearance: "none", paddingRight: 42, cursor: "pointer", color: selectedEventId ? "#111" : "#98a2b3" }}
                  >
                    <option value="" disabled>Select your event…</option>
                    {eventProjects.map((row) => (
                      <option key={row.id} value={row.id}>{projectLabel(row)}</option>
                    ))}
                  </select>
                  <ChevronDown size={18} color="#98a2b3" style={{ position: "absolute", right: 14, top: 15, pointerEvents: "none" }} />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Email</label>
                <div style={{ position: "relative" }}>
                  <Mail size={16} color="#98a2b3" style={{ position: "absolute", left: 14, top: 17 }} />
                  <input type="email" value={eventEmail} onChange={(e) => setEventEmail(e.target.value)} placeholder="Enter your email" required style={{ ...inputStyle, paddingLeft: 42 }} />
                </div>
              </div>

              {selectedEvent?.portal_status?.toLowerCase().replaceAll("-", "_") === "pre_release" ? (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: 12, padding: "13px 16px", fontSize: 13, lineHeight: 1.7 }}>
                  <strong>This event gallery isn't available yet.</strong> Enter your email and we'll send you a notification as soon as the photos are ready — no PIN needed right now.
                </div>
              ) : (
                <div>
                  <label style={labelStyle}>Event PIN</label>
                  <input value={eventPin} onChange={(e) => setEventPin(e.target.value)} placeholder="Enter event access PIN" required style={inputStyle} />
                </div>
              )}

              {loginError ? (
                <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", borderRadius: 12, padding: "12px 14px", fontSize: 13 }}>
                  {loginError}
                </div>
              ) : null}

              {eventPrereleaseRegistered ? (
                <div style={{ background: "#ecfdf3", border: "1px solid #6ee7b7", color: "#065f46", borderRadius: 14, padding: "16px 18px", fontSize: 14, lineHeight: 1.6, textAlign: "center" }}>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>You're on the list!</div>
                  We'll notify you at <strong>{eventEmail.trim().toLowerCase()}</strong> when this gallery goes live.
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={searching}
                  style={{ height: 52, borderRadius: 14, border: "none", background: "#111827", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                >
                  {searching
                    ? (selectedEvent?.portal_status?.toLowerCase().replaceAll("-", "_") === "pre_release" ? "Registering…" : "Checking access…")
                    : (selectedEvent?.portal_status?.toLowerCase().replaceAll("-", "_") === "pre_release" ? "Notify me when it's ready" : "Open event gallery")}
                </button>
              )}
            </form>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              marginTop: 14,
              gap: 6,
            }}
          >
            <Image
              src="/studio_os_logo.png"
              alt="Studio OS Cloud"
              width={58}
              height={40}
              style={{
                width: 58,
                height: "auto",
                opacity: 0.96,
              }}
            />
            <div
              style={{
                fontSize: 9,
                lineHeight: 1.2,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#6b7280",
                fontWeight: 700,
              }}
            >
              Powered by Studio OS Cloud
            </div>
          </div>

        </div>
      )}

      {step === "school_prerelease" && (
        <div style={card}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px" }}>
            <Mail size={26} color="#4338ca" />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", margin: "0 0 10px", color: "#111" }}>Gallery coming soon</h1>
          <p style={{ textAlign: "center", color: "#667085", lineHeight: 1.7, margin: "0 0 26px" }}>
            Leave your email and we'll notify you when your school gallery opens.
          </p>
          <form onSubmit={handleSchoolPreReleaseRegister} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} required style={inputStyle} placeholder="name@example.com" />
            </div>
            {regError ? (
              <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", borderRadius: 12, padding: "12px 14px", fontSize: 13 }}>
                {regError}
              </div>
            ) : null}
            <button type="submit" disabled={regSubmitting} style={{ height: 52, borderRadius: 14, border: "none", background: "#111827", color: "#fff", fontWeight: 800, cursor: "pointer" }}>
              {regSubmitting ? "Saving…" : "Notify me"}
            </button>
            <button type="button" onClick={() => setStep("login")} style={{ height: 48, borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#344054", fontWeight: 700, cursor: "pointer" }}>
              Back
            </button>
          </form>
        </div>
      )}

      {step === "school_prerelease_done" && (
        <div style={card}>
          <div style={{ width: 60, height: 60, borderRadius: 999, background: "#ecfdf3", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px" }}>
            <Check size={28} color="#16a34a" />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", margin: "0 0 10px", color: "#111" }}>You're on the list</h1>
          <p style={{ textAlign: "center", color: "#667085", lineHeight: 1.7, margin: 0 }}>
            We saved your email and will send an update when the school gallery is live.
          </p>
        </div>
      )}

      {step === "event_prerelease" && (
        <div style={card}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px" }}>
            <Mail size={26} color="#4338ca" />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", margin: "0 0 10px", color: "#111" }}>
            {selectedEvent ? `${projectLabel(selectedEvent)} is coming soon` : "Gallery coming soon"}
          </h1>
          <p style={{ textAlign: "center", color: "#667085", lineHeight: 1.7, margin: "0 0 26px" }}>
            Leave your email and the photographer can send you the gallery link and any access PIN as soon as this event is released.
          </p>
          <form onSubmit={handleEventPreReleaseRegister} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} required style={inputStyle} placeholder="name@example.com" />
            </div>
            {regError ? (
              <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", borderRadius: 12, padding: "12px 14px", fontSize: 13 }}>
                {regError}
              </div>
            ) : null}
            <button type="submit" disabled={regSubmitting} style={{ height: 52, borderRadius: 14, border: "none", background: "#111827", color: "#fff", fontWeight: 800, cursor: "pointer" }}>
              {regSubmitting ? "Saving…" : "Notify me when it opens"}
            </button>
            <button type="button" onClick={() => setStep("login")} style={{ height: 48, borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#344054", fontWeight: 700, cursor: "pointer" }}>
              Back
            </button>
          </form>
        </div>
      )}

      {step === "event_prerelease_done" && (
        <div style={card}>
          <div style={{ width: 60, height: 60, borderRadius: 999, background: "#ecfdf3", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px" }}>
            <Check size={28} color="#16a34a" />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", margin: "0 0 10px", color: "#111" }}>You're on the release list</h1>
          <p style={{ textAlign: "center", color: "#667085", lineHeight: 1.7, margin: 0 }}>
            We saved your email. Once the photographer activates the gallery, they can share the live link and any access PIN with everyone registered here.
          </p>
        </div>
      )}

      {step === "school_closed" && (
        <div style={card}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px" }}>
            <KeyRound size={26} color="#c2410c" />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", margin: "0 0 10px", color: "#111" }}>This school gallery is closed</h1>
          <p style={{ textAlign: "center", color: "#667085", lineHeight: 1.7, margin: 0 }}>
            The ordering window has ended for this school. Please contact your photographer if you still need help.
          </p>
        </div>
      )}
    </div>
  );
}
