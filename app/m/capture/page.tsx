"use client";

// Picture Day Capture — /m/capture
//
// The photographer picks a school, then a live camera continuously reads each
// student's 5-digit-PIN barcode (matching the desktop _findByToken: PIN → ID →
// name), locks that student, and the shutter captures photos that queue and
// upload in the background (offline-safe). Photos land in the student's R2
// folder so the parent gallery picks them up automatically.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  CloudUpload,
  Search,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  addCapture,
  allCaptures,
  processCaptureQueue,
  type CaptureRecord,
} from "@/lib/capture-queue";
import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";

type SchoolOption = { id: string; name: string };
type StudentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  pin: string | null;
  external_student_id: string | null;
  class_name: string | null;
};

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}
function fullName(s: StudentRow) {
  return (
    [clean(s.first_name), clean(s.last_name)].filter(Boolean).join(" ") ||
    "Student"
  );
}

// Mirrors the desktop _findByToken: 5-digit PIN first, then student id, then name.
function findStudentByToken(
  raw: string,
  students: StudentRow[],
): StudentRow | null {
  const t = clean(raw);
  if (!t) return null;
  const pin = t.match(/\b\d{5}\b/)?.[0];
  if (pin) {
    const byPin = students.find((s) => clean(s.pin) === pin);
    if (byPin) return byPin;
  }
  const byId = students.find(
    (s) => clean(s.external_student_id) && clean(s.external_student_id) === t,
  );
  if (byId) return byId;
  const lower = t.toLowerCase();
  return students.find((s) => fullName(s).toLowerCase().includes(lower)) ?? null;
}

async function captureFrame(
  video: HTMLVideoElement,
  maxEdge = 2400,
): Promise<Blob | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxEdge / Math.max(vw, vh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9),
  );
}

export default function CapturePage() {
  const [supabase] = useState(() => createClient());
  const [step, setStep] = useState<"pick" | "capture">("pick");
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [schoolFilter, setSchoolFilter] = useState("");
  const [school, setSchool] = useState<SchoolOption | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  const [active, setActive] = useState<StudentRow | null>(null);
  const [manualPin, setManualPin] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [flash, setFlash] = useState(false);

  const [sessionCount, setSessionCount] = useState(0);
  const [perStudent, setPerStudent] = useState<Record<string, number>>({});
  const [pending, setPending] = useState(0);
  const [uploaded, setUploaded] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const activeRef = useRef<StudentRow | null>(null);
  const studentsRef = useRef<StudentRow[]>([]);
  const lastScanRef = useRef<{ token: string; at: number }>({ token: "", at: 0 });
  activeRef.current = active;
  studentsRef.current = students;

  // Load the photographer's schools.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: pg } = await supabase
        .from("photographers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!pg?.id || cancelled) return;
      const { data } = await supabase
        .from("schools")
        .select("id, school_name")
        .eq("photographer_id", pg.id)
        .order("school_name");
      if (cancelled) return;
      setSchools(
        ((data ?? []) as Array<{ id: string; school_name: string | null }>).map(
          (s) => ({ id: s.id, name: clean(s.school_name) || "Untitled school" }),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Background upload pump + queue counter.
  const refreshQueue = useCallback(async () => {
    try {
      setPending((await allCaptures()).length);
    } catch {
      /* ignore */
    }
  }, []);
  const pump = useCallback(() => {
    void processCaptureQueue({
      onChange: refreshQueue,
      onUploaded: () => {
        setUploaded((n) => n + 1);
        void refreshQueue();
      },
    });
  }, [refreshQueue]);
  useEffect(() => {
    void refreshQueue();
    const id = window.setInterval(pump, 2500);
    window.addEventListener("online", pump);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", pump);
    };
  }, [pump, refreshQueue]);

  const handleToken = useCallback((raw: string) => {
    const token = clean(raw);
    const now = Date.now();
    if (lastScanRef.current.token === token && now - lastScanRef.current.at < 1500) {
      return;
    }
    lastScanRef.current = { token, at: now };
    const match = findStudentByToken(token, studentsRef.current);
    if (!match || activeRef.current?.id === match.id) return;
    setActive(match);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 320);
    navigator.vibrate?.(40);
  }, []);

  const startScanner = useCallback(async () => {
    setCameraError("");
    const video = videoRef.current;
    if (!video) return;
    try {
      const reader = new BrowserMultiFormatReader();
      controlsRef.current = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
        },
        video,
        (result) => {
          if (result) handleToken(result.getText());
        },
      );
    } catch (e) {
      setCameraError(
        e instanceof Error
          ? e.message
          : "Could not start the camera. Allow camera access and try again.",
      );
    }
  }, [handleToken]);

  const stopScanner = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      /* ignore */
    }
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (step !== "capture") return;
    void startScanner();
    return () => stopScanner();
  }, [step, startScanner, stopScanner]);

  async function chooseSchool(opt: SchoolOption) {
    setSchool(opt);
    setLoadingStudents(true);
    setActive(null);
    setPerStudent({});
    const { data } = await supabase
      .from("students")
      .select("id, first_name, last_name, pin, external_student_id, class_name")
      .eq("school_id", opt.id);
    setStudents((data ?? []) as StudentRow[]);
    setLoadingStudents(false);
    setStep("capture");
  }

  function applyManualPin() {
    const m = findStudentByToken(manualPin, students);
    if (m) {
      setActive(m);
      setManualPin("");
    }
  }

  async function shoot() {
    const video = videoRef.current;
    const student = active;
    if (!video || !student || !school) return;
    const blob = await captureFrame(video);
    if (!blob) return;
    const rec: CaptureRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      schoolId: school.id,
      studentId: student.id,
      studentName: fullName(student),
      className: clean(student.class_name),
      blob,
      createdAt: Date.now(),
      status: "pending",
      attempts: 0,
    };
    await addCapture(rec);
    setSessionCount((n) => n + 1);
    setPerStudent((m) => ({ ...m, [student.id]: (m[student.id] ?? 0) + 1 }));
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);
    void refreshQueue();
    pump();
  }

  // ── School picker ──
  if (step === "pick") {
    const filtered = schools.filter((s) =>
      s.name.toLowerCase().includes(schoolFilter.trim().toLowerCase()),
    );
    return (
      <div>
        <Link
          href="/m"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "#6b7280",
            fontSize: 13,
            fontWeight: 700,
            textDecoration: "none",
            marginBottom: 10,
          }}
        >
          <ArrowLeft size={15} /> Home
        </Link>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#111827" }}>
          Picture Day Capture
        </div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2, marginBottom: 14 }}>
          Pick a school, then scan each student&apos;s barcode and shoot.
        </div>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search
            size={16}
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#6b7280" }}
          />
          <input
            value={schoolFilter}
            onChange={(e) => setSchoolFilter(e.target.value)}
            placeholder="Search schools…"
            style={{
              width: "100%",
              boxSizing: "border-box",
              borderRadius: 14,
              border: "1px solid #e5e7eb",
              padding: "12px 14px 12px 38px",
              fontSize: 15,
              fontWeight: 600,
              outline: "none",
            }}
          />
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => void chooseSchool(s)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                width: "100%",
                textAlign: "left",
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                padding: "14px 16px",
                fontSize: 15,
                fontWeight: 800,
                color: "#111827",
                cursor: "pointer",
              }}
            >
              {s.name}
              <Camera size={18} color="#cc0000" />
            </button>
          ))}
          {schools.length === 0 ? (
            <div style={{ color: "#6b7280", fontSize: 13, padding: 12 }}>
              Loading schools…
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Capture ──
  const activeCount = active ? perStudent[active.id] ?? 0 : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            stopScanner();
            setStep("pick");
            setActive(null);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "none",
            color: "#6b7280",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            padding: 0,
          }}
        >
          <ArrowLeft size={15} /> {school?.name ?? "School"}
        </button>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 800,
            color: pending > 0 ? "#b45309" : "#16a34a",
          }}
        >
          <CloudUpload size={14} />
          {uploaded} up · {pending} pending
        </div>
      </div>

      {/* Camera */}
      <div
        style={{
          position: "relative",
          borderRadius: 18,
          overflow: "hidden",
          background: "#000",
          aspectRatio: "3 / 4",
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        {/* Active-student banner */}
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            right: 10,
            borderRadius: 12,
            padding: "10px 12px",
            background: active ? "rgba(22,163,74,0.92)" : "rgba(17,17,17,0.72)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 8,
            backdropFilter: "blur(6px)",
          }}
        >
          {active ? <UserRound size={18} /> : <Camera size={18} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {active ? fullName(active) : "Point at a student's barcode"}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.9 }}>
              {active
                ? `${clean(active.class_name) || "No class"} · PIN ${clean(active.pin) || "—"} · ${activeCount} shot${activeCount === 1 ? "" : "s"}`
                : "Scanning…"}
            </div>
          </div>
        </div>
        {/* Capture flash */}
        {flash ? (
          <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.55)" }} />
        ) : null}
      </div>

      {cameraError ? (
        <div style={{ background: "#fff1f0", color: "#9f2f24", borderRadius: 12, padding: "10px 12px", fontSize: 13, fontWeight: 600 }}>
          {cameraError}
        </div>
      ) : null}

      {/* Manual PIN fallback */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={manualPin}
          onChange={(e) => setManualPin(e.target.value)}
          inputMode="numeric"
          placeholder="Type a 5-digit PIN…"
          onKeyDown={(e) => {
            if (e.key === "Enter") applyManualPin();
          }}
          style={{
            flex: 1,
            boxSizing: "border-box",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            padding: "11px 12px",
            fontSize: 15,
            fontWeight: 700,
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={applyManualPin}
          style={{
            borderRadius: 12,
            border: "1px solid #111827",
            background: "#111827",
            color: "#fff",
            padding: "0 16px",
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Set
        </button>
      </div>

      {/* Shutter */}
      <button
        type="button"
        onClick={() => void shoot()}
        disabled={!active}
        style={{
          width: "100%",
          borderRadius: 16,
          border: "none",
          background: active ? "#cc0000" : "#e5e7eb",
          color: active ? "#fff" : "#9ca3af",
          padding: "16px",
          fontSize: 17,
          fontWeight: 900,
          cursor: active ? "pointer" : "default",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <Camera size={20} />
        {active ? `Capture ${fullName(active)}` : "Scan a student first"}
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", color: "#6b7280", fontSize: 12, fontWeight: 700 }}>
        <CheckCircle2 size={14} color="#16a34a" /> {sessionCount} captured this session
      </div>
    </div>
  );
}
