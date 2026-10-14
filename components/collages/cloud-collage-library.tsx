"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseCollageTemplate, type CollageTemplate } from "@/lib/collage-template";
import type { CollageGalleryVersion } from "@/lib/collage-client";

type LibraryVersion = CollageGalleryVersion & { published: boolean; availableGalleryCount?: number };
type Gallery = { id: string; label: string; kind: "school" | "project" };
export function CloudCollageLibrary({ design, onLoad, onMessage }: {
  design: CollageTemplate; onLoad: (design: CollageTemplate) => void;
  onMessage: (message: string, error?: boolean) => void;
}) {
  const [versions, setVersions] = useState<LibraryVersion[]>([]);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [selected, setSelected] = useState("");
  const [templateId, setTemplateId] = useState<string>();
  const [assigned, setAssigned] = useState<string[]>([]);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  async function refresh() {
    const response = await fetch("/api/dashboard/collages", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw Error(payload.message || "Could not load saved collage versions.");
    setVersions(payload.versions ?? []);
  }
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(refresh).catch(e => { if (alive) setLoadError(e.message); });
    const client = createClient();
    void Promise.all([
      client.from("schools").select("id,school_name").order("school_name"),
      client.from("projects").select("id,title").order("title"),
    ]).then(([schools, projects]) => {
      if (!alive) return;
      if (schools.error || projects.error) { setLoadError("Gallery choices could not be loaded. Keep a private version or retry later."); return; }
      setGalleries([
        ...(schools.data ?? []).map(s => ({ id: s.id, label: s.school_name || "School", kind: "school" as const })),
        ...(projects.data ?? []).map(p => ({ id: p.id, label: p.title || "Project", kind: "project" as const })),
      ]);
    });
    return () => { alive = false; };
  }, []);
  async function load() {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/dashboard/collages/${selected}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.message || "Could not open this saved design.");
      onLoad(parseCollageTemplate(payload.version.design));
      setTemplateId(payload.version.templateId); setAvailable(false); setAssigned([]);
      onMessage("Saved design opened. Select galleries again when saving a new version; earlier versions stay unchanged.");
    } catch (e) { onMessage(e instanceof Error ? e.message : "Could not load the design.", true); }
    finally { setBusy(false); }
  }
  async function save(asNew = false) {
    setBusy(true);
    try {
      if (available && !assigned.length) throw Error("Choose at least one gallery for this version.");
      const response = await fetch("/api/dashboard/collages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ design: parseCollageTemplate(design), templateId: asNew ? undefined : templateId,
          publish: available, schoolIds: galleries.filter(g => g.kind === "school" && assigned.includes(g.id)).map(g => g.id),
          projectIds: galleries.filter(g => g.kind === "project" && assigned.includes(g.id)).map(g => g.id) }),
      });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.message || "Could not save this template.");
      setTemplateId(payload.version.templateId); setSelected(payload.version.id);
      await refresh(); setLoadError("");
      onMessage(`Saved immutable version ${payload.version.versionNumber}. ${available ? "Connect this version to a package item in Packages. Purchasing remains a preview." : "This design is private."}`);
    } catch (e) { onMessage(e instanceof Error ? e.message : "Could not save the design.", true); }
    finally { setBusy(false); }
  }
  async function withdraw() {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/dashboard/collages/${selected}/withdraw`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.message || "Could not withdraw this version from galleries.");
      await refresh(); setAvailable(false); setAssigned([]);
      onMessage("Gallery access withdrawn for this version. Existing paid orders keep their design. Save a new version to make it available again.");
    } catch (e) { onMessage(e instanceof Error ? e.message : "Could not withdraw gallery access.", true); }
    finally { setBusy(false); }
  }
  return <section style={{ marginBottom: 22, padding: 16, border: "1px solid #d9dfe8", borderRadius: 12, background: "white" }}>
    <h2 style={{ margin: "0 0 8px", fontSize: 15 }}>Your Cloud template library · preview</h2>
    {loadError && <p role="status" style={{ fontSize: 12, color: "#9b2323" }}>{loadError}</p>}
    <div style={{ display: "flex", alignItems: "end", flexWrap: "wrap", gap: 10 }}>
      <label style={{ flex: "1 1 240px" }}>Saved version<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a saved design</option>{versions.map(v => <option key={v.id} value={v.id}>{v.design.name} · v{v.versionNumber}{v.published && (v.availableGalleryCount ?? 0) > 0 ? ` · ${v.availableGalleryCount} galleries` : " · private / withdrawn"}</option>)}</select></label>
      <button disabled={busy || !selected} onClick={() => void load()}>Open version</button>
      <button disabled={busy} onClick={() => void save()}>Save new version</button>
      <button disabled={busy} onClick={() => void save(true)}>Save as new template</button>
      <button disabled={busy || !selected || !(versions.find(v => v.id === selected)?.availableGalleryCount)} onClick={() => void withdraw()}>Withdraw gallery access</button>
    </div>
    <label style={{ flexDirection: "row", alignItems: "center" }}><input type="checkbox" style={{ width: "auto" }} checked={available} onChange={e => setAvailable(e.target.checked)} />Make this version available to selected galleries</label>
    {available && <label>Gallery access<select aria-label="Galleries allowed to use this collage" multiple size={Math.min(6, Math.max(2, galleries.length))} value={assigned} onChange={e => setAssigned(Array.from(e.target.selectedOptions, o => o.value))}>{galleries.map(g => <option key={g.id} value={g.id}>{g.kind === "school" ? "School" : "Project"}: {g.label}</option>)}</select></label>}
    <p style={{ fontSize: 12, color: "#626d80", marginBottom: 0 }}>Each save creates a separate version. Paid orders keep the purchased design and crops. Cloud storage requires the reviewed preview migration; download a JSON copy as a backup.</p>
  </section>;
}
