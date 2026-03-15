// app/parents/page.tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, ChevronDown, Clock, KeyRound, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type School = {
  id: string;
  school_name: string;
  status: string | null;
  expiration_date: string | null;
};

type Student = {
  id: string;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  class_id: string | null;
  school_id: string;
};

type Step = "login" | "prerelease" | "prerelease_done" | "closed";

export default function ParentsPage() {
  const supabase = createClient();

  const [step, setStep] = useState<Step>("login");
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);

  const [pin, setPin] = useState("");
  const [loginError, setLoginError] = useState("");
  const [searching, setSearching] = useState(false);

  const [, setStudent] = useState<Student | null>(null);

  const [regEmail, setRegEmail] = useState("");
  const [regName, setRegName] = useState("");
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regError, setRegError] = useState("");

  useEffect(() => {
    supabase
      .from("schools")
      .select("id,school_name,status,expiration_date")
      .order("school_name")
      .then(({ data }) => {
        const seen = new Set<string>();
        const unique = (data ?? []).filter((s) => {
          const key = s.school_name?.toLowerCase().trim();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setSchools(unique.filter((s) => s.status !== "inactive"));
      });
  }, [supabase]);

  function handleSchoolChange(schoolId: string) {
    setSelectedSchoolId(schoolId);
    setLoginError("");
    setPin("");
    setSelectedSchool(schools.find((s) => s.id === schoolId) ?? null);
  }

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!selectedSchoolId || !selectedSchool) {
      setLoginError("Please select your school first.");
      return;
    }

    if (selectedSchool.expiration_date && new Date(selectedSchool.expiration_date) < new Date()) {
      setStep("closed");
      return;
    }

    if (selectedSchool.status === "pre-released") {
      setStep("prerelease");
      return;
    }

    setSearching(true);
    setLoginError("");

    const selectedSchoolName = schools.find((s) => s.id === selectedSchoolId)?.school_name ?? "";
    const { data: sameNameSchools } = await supabase.from("schools").select("id").ilike("school_name", selectedSchoolName);
    const candidateSchoolIds = Array.from(new Set([selectedSchoolId, ...(sameNameSchools ?? []).map((s) => s.id)]));

    const { data: studentCandidates, error: studentCandidatesError } = await supabase
      .from("students")
      .select("id,first_name,last_name,photo_url,class_id,school_id")
      .in("school_id", candidateSchoolIds)
      .eq("pin", pin.trim());

    if (studentCandidatesError || !studentCandidates || studentCandidates.length === 0) {
      setLoginError("No student found with that PIN at this school. Please check your child's photo envelope.");
      setSearching(false);
      return;
    }

    const bestStudent =
      studentCandidates.find((s) => s.school_id === selectedSchoolId && !!s.photo_url) ??
      studentCandidates.find((s) => !!s.photo_url) ??
      studentCandidates.find((s) => s.school_id === selectedSchoolId) ??
      studentCandidates[0];

    setStudent(bestStudent);
    setSearching(false);
    window.location.href = `/parents/${encodeURIComponent(pin.trim())}?school=${encodeURIComponent(bestStudent.school_id)}`;
  }

  async function handlePreReleaseRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRegSubmitting(true);
    setRegError("");

    const { error } = await supabase.from("pre_release_registrations").insert({
      school_id: selectedSchoolId,
      email: regEmail.trim().toLowerCase(),
    });

    if (error && error.code !== "23505") {
      setRegError("Something went wrong. Please try again.");
      setRegSubmitting(false);
      return;
    }

    setRegSubmitting(false);
    setStep("prerelease_done");
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1.5px solid #e0e0e0",
    borderRadius: 10,
    padding: "13px 16px",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    color: "#111",
    background: "#fff",
    fontFamily: "inherit",
    transition: "border-color 0.15s",
  };

  const card: React.CSSProperties = {
    background: "#fff",
    borderRadius: 20,
    padding: "44px 40px",
    boxShadow: "0 2px 40px rgba(0,0,0,0.1)",
    width: "100%",
    maxWidth: 440,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    color: "#888",
    marginBottom: 7,
    textTransform: "uppercase",
    letterSpacing: "0.09em",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f2f2f2",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      }}
    >
      {/* ── Login ───────────────────────────────────────────────────── */}
      {step === "login" && (
        <div style={card}>
          {/* Icon */}
          <div style={{ width: 56, height: 56, background: "#111", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
            <KeyRound size={24} color="#fff" strokeWidth={2} />
          </div>

          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111", margin: "0 0 6px", textAlign: "center" }}>
            View Your Child&apos;s Photos
          </h1>
          <p style={{ fontSize: 13, color: "#999", margin: "0 0 28px", lineHeight: 1.6, textAlign: "center" }}>
            Select your school and enter the PIN from your child&apos;s photo envelope.
          </p>

          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* School selector */}
            <div>
              <label style={labelStyle}>School</label>
              <div style={{ position: "relative" }}>
                <select
                  value={selectedSchoolId}
                  onChange={(e) => handleSchoolChange(e.target.value)}
                  required
                  style={{
                    ...inputStyle,
                    appearance: "none",
                    paddingRight: 40,
                    cursor: "pointer",
                    color: selectedSchoolId ? "#111" : "#bbb",
                  }}
                >
                  <option value="" disabled>Select your school…</option>
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>{s.school_name}</option>
                  ))}
                </select>
                <ChevronDown size={15} color="#bbb" style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              </div>
            </div>

            {/* Pre-release notice OR PIN input */}
            {selectedSchool?.status === "pre-released" ? (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <Clock size={15} color="#f59e0b" />
                  <span style={{ fontWeight: 700, fontSize: 13, color: "#92400e" }}>Photos Coming Soon</span>
                </div>
                <p style={{ fontSize: 12, color: "#92400e", margin: 0, lineHeight: 1.5 }}>
                  Your photos aren&apos;t ready yet. Register your email and we&apos;ll notify you when they&apos;re online.
                </p>
              </div>
            ) : (
              <div>
                <label style={labelStyle}>PIN Code</label>
                <input
                  value={pin}
                  onChange={(e) => { setPin(e.target.value); setLoginError(""); }}
                  required
                  placeholder="• • • • • •"
                  style={{
                    ...inputStyle,
                    fontSize: 24,
                    textAlign: "center",
                    letterSpacing: "0.3em",
                    fontFamily: "monospace",
                    fontWeight: 700,
                  }}
                />
              </div>
            )}

            {/* Error message */}
            {loginError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#b91c1c" }}>
                {loginError}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={searching || !selectedSchoolId || (!pin && selectedSchool?.status !== "pre-released")}
              style={{
                background: "#111",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "14px",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                opacity: (searching || !selectedSchoolId || (!pin && selectedSchool?.status !== "pre-released")) ? 0.4 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {searching ? "Looking up…" : selectedSchool?.status === "pre-released" ? "Notify Me When Ready →" : "Open My Gallery →"}
            </button>

            <p style={{ fontSize: 12, color: "#ccc", margin: 0, textAlign: "center" }}>
              Your PIN is printed on the envelope from photo day.
            </p>
          </form>
        </div>
      )}

      {/* ── Pre-release registration ────────────────────────────────── */}
      {step === "prerelease" && (
        <div style={card}>
          <div style={{ width: 56, height: 56, background: "#f59e0b", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
            <Mail size={24} color="#fff" strokeWidth={2} />
          </div>

          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111", margin: "0 0 8px", textAlign: "center" }}>Get Notified First!</h1>

          <p style={{ fontSize: 13, color: "#999", margin: "0 0 6px", lineHeight: 1.6, textAlign: "center" }}>
            Photos for <strong style={{ color: "#111" }}>{selectedSchool?.school_name}</strong> aren&apos;t available yet.
          </p>
          <p style={{ fontSize: 13, color: "#999", margin: "0 0 28px", lineHeight: 1.6, textAlign: "center" }}>
            Register your email below and you&apos;ll receive a notification with a direct link the moment they go online.
          </p>

          <form onSubmit={handlePreReleaseRegister} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Your Name (optional)</label>
              <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Jane Smith" style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>Email Address *</label>
              <input
                type="email"
                value={regEmail}
                onChange={(e) => { setRegEmail(e.target.value); setRegError(""); }}
                required
                placeholder="jane@email.com"
                style={inputStyle}
              />
            </div>

            {regError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#b91c1c" }}>
                {regError}
              </div>
            )}

            <button
              type="submit"
              disabled={regSubmitting || !regEmail}
              style={{ background: "#f59e0b", color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: regSubmitting || !regEmail ? 0.5 : 1 }}
            >
              {regSubmitting ? "Registering…" : "Notify Me When Photos Are Ready 🔔"}
            </button>

            <button
              type="button"
              onClick={() => setStep("login")}
              style={{ background: "none", border: "none", fontSize: 13, color: "#bbb", cursor: "pointer", padding: "4px 0", textAlign: "center" }}
            >
              ← Back
            </button>
          </form>
        </div>
      )}

      {/* ── Pre-release done ────────────────────────────────────────── */}
      {step === "prerelease_done" && (
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ width: 68, height: 68, background: "#f59e0b", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
            <Check size={30} color="#fff" strokeWidth={2.5} />
          </div>

          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111", margin: "0 0 12px" }}>You&apos;re on the list! 🎉</h1>

          <p style={{ fontSize: 14, color: "#777", margin: "0 0 10px", lineHeight: 1.7 }}>
            We&apos;ve saved your email. You&apos;ll receive a notification at{" "}
            <strong style={{ color: "#111" }}>{regEmail}</strong> as soon as photos for{" "}
            <strong style={{ color: "#111" }}>{selectedSchool?.school_name}</strong> are live.
          </p>

          <p style={{ fontSize: 13, color: "#aaa", margin: "0 0 28px", lineHeight: 1.6 }}>
            When you get the email, click the link and enter your child&apos;s PIN from the photo envelope.
          </p>

          <button
            onClick={() => { setStep("login"); setSelectedSchoolId(""); setSelectedSchool(null); setRegEmail(""); setRegName(""); }}
            style={{ background: "#111", color: "#fff", border: "none", borderRadius: 10, padding: "13px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            Done
          </button>
        </div>
      )}

      {/* ── Gallery closed ──────────────────────────────────────────── */}
      {step === "closed" && (
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>

          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111", margin: "0 0 12px" }}>Gallery Closed</h1>

          <p style={{ fontSize: 14, color: "#777", margin: "0 0 24px", lineHeight: 1.7 }}>
            The ordering period for{" "}
            <strong style={{ color: "#111" }}>{selectedSchool?.school_name}</strong> has ended. Please contact your photographer if you have questions.
          </p>

          <button
            onClick={() => { setStep("login"); setSelectedSchoolId(""); setSelectedSchool(null); }}
            style={{ background: "#111", color: "#fff", border: "none", borderRadius: 10, padding: "13px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            ← Back
          </button>
        </div>
      )}
    </div>
  );
}
