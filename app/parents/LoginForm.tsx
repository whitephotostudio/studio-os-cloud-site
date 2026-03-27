"use client";
// app/parents/LoginForm.tsx
//
// ✅ PERF: Extracted from page.tsx so it can be used as a Client Component
// child of a Server Component parent. The parent fetches schools/events
// server-side (HTML arrives already populated) — no loading spinner,
// no extra API round-trip on the client.

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Images, KeyRound, Mail, School, Sparkles } from "lucide-react";

type SchoolRow = {
  id: string;
  school_name: string;
  status: string | null;
  expiration_date: string | null;
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
  | "school_closed";

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
}: {
  initialSchools: SchoolRow[];
  initialEventProjects: EventProjectRow[];
}) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("login");
  const [mode, setMode] = useState<AccessMode>("school");

  // ✅ Initialised from server-fetched props — no spinner, instant render
  const [schools] = useState<SchoolRow[]>(initialSchools);
  const [eventProjects] = useState<EventProjectRow[]>(initialEventProjects);

  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<SchoolRow | null>(null);
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

  function resetErrors() {
    setLoginError("");
    setRegError("");
  }

  function switchMode(nextMode: AccessMode) {
    setMode(nextMode);
    setStep("login");
    setSelectedSchoolId("");
    setSelectedSchool(null);
    setSchoolPin("");
    setSelectedEventId("");
    setSelectedEvent(null);
    setEventEmail("");
    setEventPin("");
    resetErrors();
  }

  async function handleSchoolLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    resetErrors();

    if (!selectedSchoolId || !selectedSchool) {
      setLoginError("Please choose your school.");
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
          // ✅ PERF: Ask server to also return gallery data in the same
          // response — gallery page then reads from sessionStorage instead
          // of making its own separate API call.
          prefetch: true,
        }),
      });

      const payload = (await response.json()) as SchoolAccessPayload;
      setSearching(false);

      if (payload.step === "school_closed") { setStep("school_closed"); return; }
      if (payload.step === "school_prerelease") { setStep("school_prerelease"); return; }

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
        `/parents/${encodeURIComponent(payload.pin)}?mode=school&school=${encodeURIComponent(payload.schoolId)}`,
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
      setLoginError("Please enter the email the photographer sent the invite to.");
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

      const payload = (await response.json()) as EventAccessPayload;
      setSearching(false);

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
              ? "Choose your school and enter the PIN from your child's photo envelope."
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
                      setSelectedSchoolId(e.target.value);
                      setSelectedSchool(schools.find((s) => s.id === e.target.value) ?? null);
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
                <label style={labelStyle}>PIN</label>
                <input
                  value={schoolPin}
                  onChange={(e) => setSchoolPin(e.target.value)}
                  placeholder="Enter school PIN"
                  required
                  style={inputStyle}
                />
              </div>

              {loginError ? (
                <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", borderRadius: 12, padding: "12px 14px", fontSize: 13 }}>
                  {loginError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={searching}
                style={{ height: 52, borderRadius: 14, border: "none", background: "#111827", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
              >
                {searching ? "Checking access…" : "Open school gallery"}
              </button>
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

              <div>
                <label style={labelStyle}>Event PIN</label>
                <input value={eventPin} onChange={(e) => setEventPin(e.target.value)} placeholder="Enter event access PIN" required style={inputStyle} />
              </div>

              {loginError ? (
                <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", borderRadius: 12, padding: "12px 14px", fontSize: 13 }}>
                  {loginError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={searching}
                style={{ height: 52, borderRadius: 14, border: "none", background: "#111827", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
              >
                {searching ? "Checking access…" : "Open event gallery"}
              </button>
            </form>
          )}

          <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "#f8fafc", borderRadius: 14, color: "#475467", fontSize: 13, lineHeight: 1.6 }}>
            {mode === "school" ? <School size={16} /> : <Sparkles size={16} />}
            {mode === "school"
              ? "School packages and orders stay linked to the photographer's Studio OS sync."
              : "Event galleries can use email + PIN access while still sending orders into the same workflow."}
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
