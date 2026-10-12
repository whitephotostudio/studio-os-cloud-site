"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { YearbookSelection, YearbookSettings } from "@/lib/school-yearbook";

type Photo = { mediaKey: string; filename: string; previewUrl: string };
type Student = { id: string; name: string; className: string | null; selection: YearbookSelection | null; selectionAvailable: boolean; photos: Photo[] };
type Payload = { ok?: boolean; message?: string; settings: YearbookSettings; open: boolean; students: Student[] };
const buttonStyle = { border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", background: "white", color: "#111827", cursor: "pointer" } as const;

function StudentChoice({ student, open, onSave }: { student: Student; open: boolean; onSave: (student: Student, mediaKey: string) => Promise<void> }) {
  const [draft, setDraft] = useState(student.selectionAvailable ? student.selection?.media_key ?? "" : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { setDraft(student.selectionAvailable ? student.selection?.media_key ?? "" : ""); }, [student.selection?.media_key, student.selectionAvailable]);
  return <div style={{ paddingTop: 12, borderTop: "1px solid #e5e7eb", marginTop: 12 }}>
    <strong>{student.name || "Student"}</strong>{student.className ? <span> · {student.className}</span> : null}
    <p style={{ margin: "6px 0", fontSize: 13 }}>{student.selectionAvailable ? `Saved yearbook portrait: ${student.selection?.filename}` : student.selection ? "Your previous choice is no longer available. Please choose another portrait." : "Choose one portrait for the yearbook."}</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0" }}>
      {student.photos.map(photo => <button key={photo.mediaKey} type="button" aria-pressed={draft === photo.mediaKey} disabled={!open || busy} onClick={() => { setDraft(photo.mediaKey); setMessage(""); }} style={{ ...buttonStyle, width: 108, padding: 5, border: draft === photo.mediaKey ? "3px solid #2563eb" : "1px solid #d1d5db" }}>
        {/* Private preview grants preserve gallery permissions and watermarking. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.previewUrl} alt={`Yearbook portrait ${photo.filename}`} style={{ width: "100%", height: 112, objectFit: "contain" }} />
        <span style={{ display: "block", fontSize: 11, overflowWrap: "anywhere" }}>{photo.filename}</span>
      </button>)}
    </div>
    {!student.photos.length ? <p>No portraits are available yet. Please contact your photographer.</p> : null}
    {open && student.photos.length > 0 ? <button type="button" style={buttonStyle} disabled={!draft || busy || (student.selectionAvailable && draft === student.selection?.media_key)} onClick={async () => {
      setBusy(true); setMessage("");
      try { await onSave(student, draft); setMessage("Your yearbook portrait is saved. You can change it until selections close."); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Could not save. Please try again."); }
      finally { setBusy(false); }
    }}>{busy ? "Saving…" : "Save yearbook portrait"}</button> : null}
    {message ? <p role="status" style={{ fontSize: 13, margin: "8px 0" }}>{message}</p> : null}
  </div>;
}

export function SchoolYearbookParentPanel({ schoolId, pin, email }: { schoolId: string; pin: string; email: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const scope = `${schoolId}:${pin}:${email}`;
  const currentScope = useRef(scope);
  useEffect(() => { currentScope.current = scope; }, [scope]);
  const load = useCallback(async () => {
    const response = await fetch("/api/portal/yearbook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "load", schoolId, pin, email }), cache: "no-store" });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.message || "Could not load yearbook selections.");
    if (currentScope.current === scope) { setPayload(body); setError(""); }
  }, [schoolId, pin, email, scope]);
  useEffect(() => { let cancelled = false; Promise.resolve().then(() => { if (!cancelled) return load(); }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : "Could not load yearbook selections."); }); return () => { cancelled = true; }; }, [load]);
  if (!error && (!payload || !payload.settings.enabled)) return null;
  return <details style={{ background: "#fff", color: "#111827", borderBottom: "1px solid #d1d5db", padding: "12px 18px", flexShrink: 0, maxHeight: "50vh", overflow: "auto" }}>
    <summary style={{ cursor: "pointer", fontWeight: 700 }}>Yearbook portrait{payload?.students.some(student => !student.selectionAvailable) ? " · choose your pose" : " · review your choice"}</summary>
    {error ? <p role="alert">{error} <button style={buttonStyle} type="button" onClick={() => { load().catch(error => setError(String(error.message))); }}>Try again</button></p> : null}
    {payload ? <>
      <p style={{ margin: "8px 0", fontSize: 13 }}>{payload.open ? "Choose and save one portrait per student." : "Selections are closed. Contact your photographer if a change is needed."} {payload.settings.deadline ? `Deadline: ${payload.settings.deadline} (Eastern Time).` : ""}</p>
      {payload.students.map(student => <StudentChoice key={student.id} student={student} open={payload.open} onSave={async (current, mediaKey) => {
        const response = await fetch("/api/portal/yearbook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "select", schoolId, pin, email, studentId: current.id, mediaKey, expectedRevision: current.selection?.revision ?? 0 }) });
        const body = await response.json();
        if (!response.ok || !body.ok) { if (response.status === 409) await load(); throw new Error(body.message || "Could not save yearbook portrait."); }
        // Read back the persisted server choice before confirming success.
        await load();
      }} />)}
    </> : null}
  </details>;
}
