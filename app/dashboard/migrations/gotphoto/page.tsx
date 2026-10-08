"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseMigrationCsv, suggestMigrationMapping, migrationPhotoAssociationJson,
  type MigrationKind, type MigrationMapping, type MigrationPhoto, type MigrationPreview } from "@/lib/gotphoto-migration";

type PreviewResponse = { ok: boolean; message?: string; requiresPreview?: boolean; preview?: MigrationPreview; previewFingerprint?: string };
type Receipt = { importedStudents: number; importedContacts: number; photosUploaded: number; students: { id: string; sourceId: string; className: string }[] };
const fields = {
  roster: [["sourceId", "GotPhoto child ID / stable student ID (required)"], ["firstName", "First name (required)"], ["lastName", "Last name (required)"], ["className", "Class / group"], ["parentEmail", "Parent email"], ["photoFilename", "Exact relative photo path (optional)"]],
  contacts: [["fullName", "Customer full name (or map first + last names)"], ["firstName", "Customer first name"], ["lastName", "Customer last name"], ["email", "Customer email (required)"], ["phone", "Phone"]],
} as const;

export default function GotphotoMigrationPage() {
  const [schools, setSchools] = useState<{ id: string; school_name: string }[]>([]);
  const [schoolId, setSchoolId] = useState("");
  const [kind, setKind] = useState<MigrationKind>("roster");
  const [csv, setCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<MigrationMapping>({});
  const [photos, setPhotos] = useState<MigrationPhoto[]>([]);
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [fingerprint, setFingerprint] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [owner, setOwner] = useState("");
  const epoch = useRef(0), ownerRef = useRef("");
  const requestKey = useRef("");
  const submitted = useRef(false);
  const [inputEpoch, setInputEpoch] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    const sessionEpoch = epoch;
    let alive = true;
    async function activate(nextOwner: string) {
      if (!alive || nextOwner === ownerRef.current) return;
      const generation = ++epoch.current;
      ownerRef.current = nextOwner;
      setOwner(nextOwner); setSchools([]); setSchoolId(""); setCsv(""); setHeaders([]); setMapping({});
      setPhotos([]); setPreview(null); setReceipt(null); setReviewed(false); setFingerprint("");
      requestKey.current = ""; submitted.current = false; setBusy(false); setInputEpoch((value) => value + 1);
      if (!nextOwner) { setMessage("Sign in to preview an import."); return; }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch("/api/dashboard/migrations/gotphoto", { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}, cache: "no-store" });
        const result = await response.json();
        if (!alive || epoch.current !== generation) return;
        if (!response.ok || !result.ok) throw Error(result.message || "Schools could not be loaded.");
        setSchools(result.schools); setMessage("");
      } catch (error) { if (alive && epoch.current === generation) setMessage(error instanceof Error ? error.message : "Schools could not be loaded."); }
    }
    void supabase.auth.getUser().then(({ data }) => activate(data.user?.id ?? ""));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { void activate(session?.user.id ?? ""); });
    return () => { alive = false; sessionEpoch.current++; subscription.unsubscribe(); };
  }, []);

  function invalidatePreview() {
    if (submitted.current) return;
    setPreview(null); setFingerprint(""); setReviewed(false); setReceipt(null); requestKey.current = "";
  }

  async function loadCsv(file: File | undefined) {
    if (!file) return;
    const generation = epoch.current;
    try {
      if (file.size > 2_000_000) throw Error("Choose a CSV no larger than 2 MB.");
      const text = await file.text();
      const parsed = parseMigrationCsv(text);
      if (generation !== epoch.current) return;
      invalidatePreview(); setCsv(text); setHeaders(parsed.headers); setMapping(suggestMigrationMapping(parsed.headers, kind)); setMessage("");
    } catch (error) { if (generation === epoch.current) setMessage(error instanceof Error ? error.message : "CSV could not be read."); }
  }

  async function loadPhotos(files: FileList | null) {
    const generation = epoch.current;
    try {
      if (!files?.length) { invalidatePreview(); setPhotos([]); return; }
      if (files.length > 5000) throw Error("Choose at most 5,000 images from one exported school folder.");
      setBusy(true); setMessage("Checking image filenames and SHA-256 hashes locally…");
      const inventory: MigrationPhoto[] = [];
      for (const file of Array.from(files)) {
        if (!/\.(jpe?g|png|webp)$/i.test(file.name)) continue;
        if (file.size > 25 * 1024 * 1024 || !file.size) throw Error(`${file.name} must be between 1 byte and 25 MB.`);
        const bytes = await file.arrayBuffer();
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        if (generation !== epoch.current) return;
        const sha256 = Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, "0")).join("");
        const relative = file.webkitRelativePath.split("/").slice(1).join("/") || file.name;
        inventory.push({ path: relative, sha256, bytes: file.size });
      }
      if (generation === epoch.current) { invalidatePreview(); setPhotos(inventory); setMessage(`${inventory.length} images checked locally. Photo bytes have not been uploaded.`); }
    } catch (error) { if (generation === epoch.current) setMessage(error instanceof Error ? error.message : "Image inventory failed."); }
    finally { if (generation === epoch.current) setBusy(false); }
  }

  async function submit(action: "preview" | "import") {
    const generation = epoch.current, requestOwner = ownerRef.current;
    setBusy(true); setMessage("");
    if (action === "import") { requestKey.current ||= crypto.randomUUID(); submitted.current = true; }
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (generation !== epoch.current) return;
      if (!requestOwner || session?.user.id !== requestOwner) throw Error("The studio account changed. Reload this import.");
      const response = await fetch("/api/dashboard/migrations/gotphoto", { method: "POST", headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`,
      }, body: JSON.stringify({ action, schoolId, kind, csv, mapping, photos: kind === "roster" ? photos : [],
        ...(action === "import" ? { requestKey: requestKey.current, previewFingerprint: fingerprint } : {}),
      }) });
      const result = await response.json() as PreviewResponse & { receipt?: Receipt; replayed?: boolean };
      if (generation !== epoch.current) return;
      if (result.requiresPreview) { submitted.current = false; invalidatePreview(); }
      if (!response.ok || !result.ok) throw Error(result.message || "Import could not be confirmed. Retry this same request.");
      if (action === "preview") {
        setPreview(result.preview!); setFingerprint(result.previewFingerprint!); setReviewed(false); setReceipt(null);
      } else {
        setReceipt(result.receipt!); setMessage(`${result.receipt!.importedStudents} students and ${result.receipt!.importedContacts} contacts imported${result.replayed ? " (existing receipt confirmed)" : ""}. Photos have not been uploaded.`);
      }
    } catch (error) { if (generation === epoch.current) setMessage(error instanceof Error ? error.message : "Import could not be confirmed."); }
    finally { if (generation === epoch.current) setBusy(false); }
  }

  function downloadAssociations() {
    if (!preview) return;
    const url = URL.createObjectURL(new Blob([migrationPhotoAssociationJson(preview)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "gotphoto-reviewed-photo-associations.json"; anchor.click(); URL.revokeObjectURL(url);
  }

  const locked = busy || submitted.current;
  return <main className="mx-auto max-w-5xl p-6 sm:p-10">
    <Link href="/dashboard/schools" className="text-sm underline">Back to schools</Link>
    <h1 className="mt-4 text-3xl font-semibold">Import from GotPhoto</h1>
    <p className="mt-3 text-gray-600">Start with one school. Export the names list from GotPhoto’s Subjects tab, or export customers as CSV from Contacts. Review the source columns before creating new records.</p>
    <p className="mt-2 text-sm text-gray-600">Existing records stay intact. New gallery PINs are generated. Pricing, packages, paid orders, invoices, original access codes and marketing permission are not restored by this import. Imported CRM contacts start with contact disabled until you review their permission.</p>
    {kind === "contacts" && <p className="mt-2 text-sm text-gray-600">Customers are added to Clients. The selected school records this import’s source; it does not attach contacts to individual students.</p>}
    <fieldset disabled={locked || !owner} className="mt-6 grid gap-5 rounded-xl border bg-white p-6 sm:grid-cols-2">
      <label className="grid gap-2">Destination school<select className="rounded border p-2" value={schoolId} onChange={(event) => { invalidatePreview(); setSchoolId(event.target.value); }}><option value="">Choose a school</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.school_name}</option>)}</select></label>
      <label className="grid gap-2">Import type<select className="rounded border p-2" value={kind} onChange={(event) => { const next = event.target.value as MigrationKind; invalidatePreview(); setKind(next); setMapping(suggestMigrationMapping(headers, next)); }}><option value="roster">Student roster</option><option value="contacts">Customer contacts</option></select></label>
      <label className="grid gap-2">GotPhoto CSV<input key={`csv-${inputEpoch}`} type="file" accept=".csv,text/csv" onChange={(event) => { void loadCsv(event.target.files?.[0]); }} /></label>
      {kind === "roster" && <label className="grid gap-2">Optional exported photo folder<input key={`photos-${inputEpoch}`} type="file" multiple accept="image/jpeg,image/png,image/webp" ref={(element) => { element?.setAttribute("webkitdirectory", ""); }} onChange={(event) => { void loadPhotos(event.target.files); }} /><span className="text-xs text-gray-600">The selected folder’s root is omitted; subfolders are preserved. Only exact relative paths are matched. This creates a reviewed association file; upload photos through the student gallery after import.</span></label>}
      {headers.length > 0 && <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">{fields[kind].map(([field, label]) => <label key={field} className="grid gap-1 text-sm">{label}<select className="rounded border p-2" value={mapping[field] || ""} onChange={(event) => { invalidatePreview(); setMapping((current) => ({ ...current, [field]: event.target.value || undefined })); }}><option value="">Not mapped</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>}
    </fieldset>
    <button className="mt-4 rounded bg-black px-5 py-2 text-white disabled:opacity-50" disabled={!schoolId || !csv || !owner || locked} onClick={() => { void submit("preview"); }}>Preview import</button>
    {message && <p role="status" className="mt-4 rounded border bg-white p-4">{message}</p>}
    {preview && <section className="mt-6 rounded-xl border bg-white p-6">
      <h2 className="text-xl font-semibold">Review {preview.sourceRows} source rows</h2>
      <p className="mt-2">{preview.students.length} new students · {preview.contacts.length} new contacts · {preview.skipped.length} existing records preserved · {preview.photoAssociations.length} exact photo associations</p>
      {preview.issues.length > 0 && <div role="alert" className="mt-4 text-red-700"><p>Resolve every issue before importing.</p><ul className="mt-2 list-disc pl-5">{preview.issues.slice(0, 50).map((issue, index) => <li key={index}>Row {issue.row}: {issue.message}</li>)}</ul>{preview.issues.length > 50 && <p>{preview.issues.length - 50} more issues remain.</p>}</div>}
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Source identity</th><th className="p-2">Name</th><th className="p-2">Class / email</th></tr></thead><tbody>{preview.students.slice(0, 50).map((student) => <tr key={student.externalId}><td className="p-2">{student.sourceId}</td><td className="p-2">{student.firstName} {student.lastName}</td><td className="p-2">{student.className}</td></tr>)}{preview.contacts.slice(0, 50).map((contact) => <tr key={contact.email}><td className="p-2">{contact.email}</td><td className="p-2">{contact.fullName}</td><td className="p-2">{contact.phone || "—"}</td></tr>)}</tbody></table></div>
      {preview.skipped.length > 0 && <p className="mt-3 text-sm text-gray-600">Existing identities are skipped. They are never merged by name or email guesses.</p>}
      {preview.photoAssociations.length > 0 && <button className="mt-4 rounded border px-4 py-2 disabled:opacity-50" disabled={!!preview.issues.length} onClick={downloadAssociations}>Download reviewed photo associations</button>}
      {!receipt && <><label className="mt-5 flex items-start gap-3"><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed this school and column mapping. Create these new records; preserve existing data and keep customer contact disabled.</span></label><button className="mt-4 rounded bg-black px-5 py-2 text-white disabled:opacity-50" disabled={!reviewed || !!preview.issues.length || (!preview.students.length && !preview.contacts.length) || busy || !owner} onClick={() => { void submit("import"); }}>{submitted.current ? "Reconcile this import" : "Import reviewed records"}</button></>}
      {receipt && <div className="mt-5"><Link className="underline" href={`/dashboard/projects/schools/${schoolId}`}>Open the imported school</Link><p className="mt-2 text-sm text-gray-600">The import receipt confirms created records. Photo upload, gallery review and lab fulfillment are separate steps.</p><button className="mt-3 rounded border px-4 py-2" onClick={() => { submitted.current = false; invalidatePreview(); setCsv(""); setHeaders([]); setMapping({}); setPhotos([]); setInputEpoch((value) => value + 1); setMessage(""); }}>Start another import</button></div>}
    </section>}
  </main>;
}
