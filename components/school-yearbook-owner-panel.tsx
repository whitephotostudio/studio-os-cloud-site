"use client";
import { useCallback, useEffect, useState } from "react";
import type { YearbookSettings, YearbookSelection } from "@/lib/school-yearbook";

type Student = { id: string; name: string; className: string | null; selection: YearbookSelection | null };
type Photo = { mediaKey: string; filename: string; previewUrl: string };
export function SchoolYearbookOwnerPanel({ schoolId }: { schoolId: string }) {
  const endpoint = `/api/dashboard/schools/${encodeURIComponent(schoolId)}/yearbook`;
  const [settings, setSettings] = useState<YearbookSettings | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Student | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [draft, setDraft] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.message || "Could not load yearbook tools.");
    setSettings(body.settings); setEnabled(body.settings.enabled); setDeadline(body.settings.deadline ?? ""); setStudents(body.students); setError("");
  }, [endpoint]);
  useEffect(() => { load().catch(error => setError(error.message)); }, [load]);
  async function patch(body: unknown) {
    const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || "Could not save.");
    return result;
  }
  async function download(format: "csv" | "zip", batch = 0) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${endpoint}?format=${format}&batch=${batch}`, { cache: "no-store" });
      if (!response.ok) { const result = await response.json(); throw new Error(result.message || "Could not export."); }
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = format === "csv" ? "yearbook-selections.csv" : `yearbook-portraits-${batch + 1}.zip`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not export."); }
    finally { setBusy(false); }
  }
  const selected = students.filter(student => student.selection).length;
  const control = "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm disabled:opacity-50";
  return <section className="rounded-[24px] border border-neutral-200 bg-white p-6 shadow-sm" aria-label="Yearbook portrait selection">
    <h3 className="font-semibold">Yearbook portrait selection</h3>
    <p className="mt-1 text-sm text-neutral-600">Collect one designated portrait per student. Choices are saved separately from shopping favorites and desktop best shots.</p>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error} <button className={control} onClick={() => load().catch(error => setError(error.message))}>Reload</button></p> : null}
    {settings ? <>
      <div className="my-4 flex flex-wrap items-end gap-4">
        <label className="text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Allow parent yearbook choices</label>
        <label className="text-sm">Deadline (Eastern Time)<input type="date" value={deadline} onChange={event => setDeadline(event.target.value)} className={`ml-2 ${control}`} /></label>
        <button disabled={busy} className={control} onClick={async () => { setBusy(true); setError(""); setMessage(""); try { await patch({ action: "settings", enabled, deadline: deadline || null, expectedRevision: settings.revision }); await load(); setMessage("Yearbook settings saved."); } catch (error) { setError(error instanceof Error ? error.message : "Could not save."); } finally { setBusy(false); } }}>Save yearbook settings</button>
      </div>
      <p className="text-sm">{selected} of {students.length} students have a saved choice. Photographer choices remain available after the parent deadline.</p>
      <div className="my-3 flex flex-wrap gap-2">
        <button className={control} disabled={busy} onClick={() => download("csv")}>Export selection CSV</button>
        {Array.from({ length: Math.ceil(selected / 72) }, (_, batch) => <button key={batch} className={control} disabled={busy} onClick={() => download("zip", batch)}>Download portraits {batch + 1}{selected > 72 ? ` (${batch * 72 + 1}–${Math.min(selected, (batch + 1) * 72)})` : ""}</button>)}
      </div>
      <p className="text-xs text-neutral-500">Exports contain selected originals and a student/class manifest. Unavailable portraits are flagged in the CSV. Confirm your yearbook publisher&apos;s required format before submission.</p>
      <div className="mt-4 max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Student</th><th className="p-2">Class</th><th className="p-2">Saved portrait</th><th className="p-2">Selected by</th><th /></tr></thead><tbody>{students.slice(page * 50, (page + 1) * 50).map(student => <tr key={student.id} className="border-t"><td className="p-2">{student.name}</td><td className="p-2">{student.className}</td><td className="p-2">{student.selection?.filename ?? "Awaiting choice"}</td><td className="p-2">{student.selection?.source ?? ""}</td><td className="p-2"><button disabled={busy} className={control} onClick={async () => {
        setBusy(true); setError("");
        try { const response = await fetch(`${endpoint}?studentId=${student.id}`, { cache: "no-store" }); const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.message); setEditing({ ...student, selection: body.selection }); setPhotos(body.photos); setDraft(body.selection?.media_key ?? ""); }
        catch (error) { setError(error instanceof Error ? error.message : "Could not load portraits."); }
        finally { setBusy(false); }
      }}>Review / choose</button></td></tr>)}</tbody></table></div>
      {students.length > 50 ? <div className="mt-2 flex items-center gap-3"><button className={control} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span className="text-sm">Page {page + 1}</span><button className={control} disabled={(page + 1) * 50 >= students.length} onClick={() => setPage(page + 1)}>Next</button></div> : null}
      {editing ? <div className="mt-4 rounded-xl border p-4"><strong>{editing.name} · yearbook portrait</strong><div className="my-3 flex flex-wrap gap-3">{photos.map(photo => <button key={photo.mediaKey} className={control} aria-pressed={draft === photo.mediaKey} onClick={() => setDraft(photo.mediaKey)} style={{ borderColor: draft === photo.mediaKey ? "#2563eb" : undefined, borderWidth: draft === photo.mediaKey ? 3 : 1, width: 115 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.previewUrl} alt={photo.filename} style={{ width: "100%", height: 105, objectFit: "contain" }} /><span className="break-all text-xs">{photo.filename}</span>
      </button>)}</div>{!photos.length ? <p className="text-sm">No current original portraits are available.</p> : null}<button className={control} disabled={busy || !draft} onClick={async () => { setBusy(true); setError(""); try { await patch({ action: "select", studentId: editing.id, mediaKey: draft, expectedRevision: editing.selection?.revision ?? 0 }); await load(); setEditing(null); setMessage("Photographer yearbook choice saved."); } catch (error) { setError(error instanceof Error ? error.message : "Could not save."); } finally { setBusy(false); } }}>Save photographer choice</button> <button className={control} disabled={busy} onClick={() => setEditing(null)}>Close</button></div> : null}
    </> : null}
    {message ? <p role="status" className="mt-3 text-sm text-green-800">{message}</p> : null}
  </section>;
}
