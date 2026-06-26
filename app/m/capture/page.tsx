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
  Images,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { proxiedPhotoUrl } from "@/lib/photo-url";
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
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

type SchoolOption = { id: string; name: string };
type StudentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  pin: string | null;
  pin_code: string | null;
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
  // 1. 5-digit PIN anywhere in the payload (the desktop's primary match).
  const pin = t.match(/\b\d{5}\b/)?.[0];
  if (pin) {
    const byPin = students.find(
      (s) => clean(s.pin) === pin || clean(s.pin_code) === pin,
    );
    if (byPin) return byPin;
  }
  // 2. Exact student id.
  const byId = students.find(
    (s) => clean(s.external_student_id) && clean(s.external_student_id) === t,
  );
  if (byId) return byId;
  // 3. Name match in either direction (handles "Last First PIN" payloads).
  const lower = t.toLowerCase();
  const byName = students.find((s) => {
    const name = fullName(s).toLowerCase();
    return name.length > 1 && (name.includes(lower) || lower.includes(name));
  });
  if (byName) return byName;
  // 4. Split a multi-field payload and retry each part (desktop behaviour).
  const parts = t.split(/[|,;\n\t]+|\s{2,}/).map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    for (const part of parts) {
      const hit = findStudentByToken(part, students);
      if (hit) return hit;
    }
  }
  return null;
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
  const [scanInfo, setScanInfo] = useState<
    { text: string; matched: boolean; at: number } | null
  >(null);

  const [sessionCount, setSessionCount] = useState(0);
  const [perStudent, setPerStudent] = useState<Record<string, number>>({});
  const [pending, setPending] = useState(0);
  const [uploaded, setUploaded] = useState(0);
  // Capture source: "phone" shoots with the device camera; "dslr" imports the
  // shots a tethered DSLR auto-sent to this phone (e.g. Canon Camera Connect)
  // from the Photos library and queues them for the locked student.
  const [mode, setMode] = useState<"phone" | "dslr">("phone");
  // Review + delete: the locked student's photos already in their R2 folder.
  const [studentPhotos, setStudentPhotos] = useState<
    Array<{ key: string; url: string; name: string }>
  >([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const dslrInputRef = useRef<HTMLInputElement | null>(null);
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

  // Remember the capture source between sessions (a DSLR shooter stays in DSLR).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("capture-mode");
      if (saved === "dslr" || saved === "phone") setMode(saved);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem("capture-mode", mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

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
    if (!token) return;
    const now = Date.now();
    if (lastScanRef.current.token === token && now - lastScanRef.current.at < 1200) {
      return;
    }
    lastScanRef.current = { token, at: now };
    const match = findStudentByToken(token, studentsRef.current);
    // Always surface what was read so it's clear scanning works, matched or not.
    setScanInfo({ text: token, matched: !!match, at: now });
    window.setTimeout(
      () => setScanInfo((cur) => (cur && cur.at === now ? null : cur)),
      3500,
    );
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
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.DATA_MATRIX,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 120,
        delayBetweenScanSuccess: 800,
      });
      controlsRef.current = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
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

  // Load the locked student's existing photos for the review + delete strip.
  const loadStudentPhotos = useCallback(
    async (student: StudentRow | null) => {
      if (!student || !school) {
        setStudentPhotos([]);
        return;
      }
      setPhotosLoading(true);
      try {
        const res = await fetch("/api/dashboard/capture/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schoolId: school.id, studentId: student.id }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          photos?: Array<{ key: string; url: string; name: string }>;
        };
        setStudentPhotos(res.ok && json.ok ? json.photos ?? [] : []);
      } catch {
        setStudentPhotos([]);
      } finally {
        setPhotosLoading(false);
      }
    },
    [school],
  );

  // Refresh the strip when the active student changes or a capture uploads.
  useEffect(() => {
    if (!active) {
      setStudentPhotos([]);
      return;
    }
    void loadStudentPhotos(active);
  }, [active, uploaded, loadStudentPhotos]);

  async function chooseSchool(opt: SchoolOption) {
    setSchool(opt);
    setLoadingStudents(true);
    setActive(null);
    setPerStudent({});
    const { data } = await supabase
      .from("students")
      .select("id, first_name, last_name, pin, pin_code, external_student_id, class_name")
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

  // Queue the DSLR shots the photographer picked from Photos (where Camera
  // Connect deposited them) for the locked student — same offline queue + R2
  // upload as a phone capture, just sourced from files instead of the camera.
  async function importDslrPhotos(files: FileList | null) {
    const student = active;
    if (!files || files.length === 0 || !student || !school) return;
    let added = 0;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const rec: CaptureRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        schoolId: school.id,
        studentId: student.id,
        studentName: fullName(student),
        className: clean(student.class_name),
        blob: file,
        createdAt: Date.now() + added,
        status: "pending",
        attempts: 0,
      };
      await addCapture(rec);
      added += 1;
    }
    if (dslrInputRef.current) dslrInputRef.current.value = "";
    if (added === 0) return;
    setSessionCount((n) => n + added);
    setPerStudent((m) => ({ ...m, [student.id]: (m[student.id] ?? 0) + added }));
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);
    void refreshQueue();
    pump();
  }

  async function deletePhoto(key: string) {
    if (!school) return;
    if (
      !window.confirm(
        "Delete this photo? This removes it from the gallery permanently.",
      )
    ) {
      return;
    }
    setDeletingKey(key);
    try {
      const res = await fetch("/api/dashboard/capture/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: school.id, key }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && json.ok) {
        setStudentPhotos((prev) => prev.filter((p) => p.key !== key));
      } else {
        window.alert(json.error || "Could not delete the photo.");
      }
    } catch {
      window.alert("Could not delete the photo.");
    } finally {
      setDeletingKey(null);
    }
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

      {/* Capture source: phone camera vs DSLR import */}
      <div style={{ display: "flex", gap: 6, background: "#f3f4f6", borderRadius: 12, padding: 4 }}>
        {([
          { key: "phone", label: "Phone camera", icon: <Camera size={15} /> },
          { key: "dslr", label: "DSLR import", icon: <Images size={15} /> },
        ] as const).map((opt) => {
          const on = mode === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setMode(opt.key)}
              style={{
                flex: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                border: "none",
                borderRadius: 9,
                padding: "9px 8px",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                background: on ? "#fff" : "transparent",
                color: on ? "#111827" : "#6b7280",
                boxShadow: on ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
              }}
            >
              {opt.icon}
              {opt.label}
            </button>
          );
        })}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html:
            ".capture-reticle{width:64%;aspect-ratio:1/1;border:3px solid rgba(250,204,21,0.95);border-radius:18px;animation:captureScanPulse 1.15s ease-in-out infinite}" +
            "@keyframes captureScanPulse{0%,100%{box-shadow:0 0 0 0 rgba(250,204,21,0);border-color:rgba(250,204,21,0.85)}50%{box-shadow:0 0 22px 4px rgba(250,204,21,0.55);border-color:rgba(253,224,71,1)}}",
        }}
      />
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
        {/* Scan target — pulses while looking for a barcode */}
        {!active ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
            }}
          >
            <div className="capture-reticle" />
            <div
              style={{
                position: "absolute",
                bottom: 14,
                left: 0,
                right: 0,
                textAlign: "center",
                color: "#fde047",
                fontSize: 12,
                fontWeight: 800,
                textShadow: "0 1px 4px rgba(0,0,0,0.7)",
              }}
            >
              Aim the QR code inside the box
            </div>
          </div>
        ) : null}
        {/* Capture flash */}
        {flash ? (
          <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.55)" }} />
        ) : null}
      </div>

      {scanInfo && !scanInfo.matched ? (
        <div
          style={{
            background: "#fffbeb",
            color: "#b45309",
            borderRadius: 12,
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          Read &ldquo;{scanInfo.text}&rdquo; — no matching student in{" "}
          {school?.name ?? "this school"}. Check you picked the right school.
        </div>
      ) : null}

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

      {/* Shutter (phone camera) / Import (DSLR) */}
      {mode === "phone" ? (
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
      ) : (
        <>
          <input
            ref={dslrInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => void importDslrPhotos(e.target.files)}
          />
          <button
            type="button"
            onClick={() => dslrInputRef.current?.click()}
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
            <Images size={20} />
            {active ? `Import photos for ${fullName(active)}` : "Scan a student first"}
          </button>
          <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textAlign: "center", lineHeight: 1.5 }}>
            Your DSLR&apos;s shots arrive in this phone&apos;s Photos via Canon Camera
            Connect. Scan the student, tap Import, and pick their latest photos.
          </div>
        </>
      )}

      {/* Review + delete the locked student's photos */}
      {active ? (
        <div style={{ borderTop: "1px solid #eef0f4", paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#374151" }}>
              {fullName(active)}&apos;s photos{studentPhotos.length ? ` · ${studentPhotos.length}` : ""}
            </div>
            <button
              type="button"
              onClick={() => void loadStudentPhotos(active)}
              style={{ background: "transparent", border: "none", color: "#6b7280", fontSize: 12, fontWeight: 800, cursor: "pointer", padding: 0 }}
            >
              {photosLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {studentPhotos.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9ca3af", padding: "2px 0 6px" }}>
              {photosLoading ? "Loading photos…" : "No photos yet for this student."}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {studentPhotos.map((p) => (
                <div key={p.key} style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 10, overflow: "hidden", background: "#f3f4f6" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${proxiedPhotoUrl(p.key) || p.url}?w=400`} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button
                    type="button"
                    onClick={() => void deletePhoto(p.key)}
                    disabled={deletingKey === p.key}
                    aria-label="Delete photo"
                    style={{ position: "absolute", top: 5, right: 5, width: 30, height: 30, borderRadius: 8, border: "none", background: "rgba(204,0,0,0.92)", color: "#fff", display: "grid", placeItems: "center", cursor: deletingKey === p.key ? "default" : "pointer", opacity: deletingKey === p.key ? 0.6 : 1 }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", color: "#6b7280", fontSize: 12, fontWeight: 700 }}>
        <CheckCircle2 size={14} color="#16a34a" /> {sessionCount} captured this session
      </div>
    </div>
  );
}
