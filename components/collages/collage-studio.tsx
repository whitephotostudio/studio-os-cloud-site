"use client";

/* Local blob URLs cannot use the Next image optimisation service. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { collagePreset, parseCollageTemplate, collageResolution, COLLAGE_DPI, MAX_TEMPLATE_BYTES,
  type CollageTemplate, type CollagePhoto, type CollagePlacement } from "@/lib/collage-template";
import { loadCollageImage, renderCollage } from "@/lib/collage-render";
import { CloudCollageLibrary } from "./cloud-collage-library";
import { collageTrimPercent } from "@/lib/collage-client";
import styles from "./collage-studio.module.css";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function fileStem(name: string) { return name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "collage"; }
function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
async function artworkData(file: File) {
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 8 * 1024 * 1024) throw Error("Choose PNG or JPEG artwork under 8 MB.");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error("Could not read the artwork."));
    reader.readAsDataURL(file);
  });
}

export function CollageStudio() {
  const [template, setTemplate] = useState<CollageTemplate>(() => collagePreset("triptych"));
  const [photos, setPhotos] = useState<CollagePhoto[]>([]);
  const [placements, setPlacements] = useState<Record<string, CollagePlacement>>({});
  const [selectedSlot, setSelectedSlot] = useState("left");
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [year, setYear] = useState("");
  const [mode, setMode] = useState<"design" | "preview">("design");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [renderError, setRenderError] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const photoUrls = useRef<string[]>([]);
  const active = template.slots.find(s => s.id === selectedSlot) ?? template.slots[0];
  const placement = Object.hasOwn(placements, active.id) ? placements[active.id] : undefined;
  const complete = template.slots.every(s => Object.hasOwn(placements, s.id));

  useEffect(() => () => photoUrls.current.forEach(url => URL.revokeObjectURL(url)), []);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => renderCollage(parseCollageTemplate(template), placements, [name, school, year], 900, true))
      .then(canvas => {
        if (cancelled) return;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `Preview of ${template.name}`);
        preview.current?.replaceChildren(canvas);
        setRenderError("");
      }).catch(e => { if (!cancelled) setRenderError(message(e)); });
    return () => { cancelled = true; };
  }, [template, placements, name, school, year]);

  function preset(kind: "triptych" | "graduation") {
    const next = collagePreset(kind);
    setTemplate(next); setPlacements({}); setSelectedSlot(next.slots[0].id); setError(""); setNotice("");
  }
  function updatePlacement(patch: Partial<CollagePlacement>) {
    if (!placement) return;
    setPlacements(p => ({ ...p, [active.id]: { ...placement, ...patch } }));
  }
  function updateSlot(patch: Partial<typeof active>) {
    setTemplate(t => ({ ...t, slots: t.slots.map(s => s.id === active.id ? { ...s, ...patch } : s) }));
  }
  async function importTemplate(file: File | undefined) {
    if (!file) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      if (file.size > MAX_TEMPLATE_BYTES) throw Error("Template files must be under 12 MB.");
      const next = parseCollageTemplate(JSON.parse(await file.text()));
      if (next.overlay) await loadCollageImage(next.overlay);
      setTemplate(next); setPlacements({}); setSelectedSlot(next.slots[0].id);
      setNotice("Template imported. Choose photos to preview it.");
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function uploadPhotos(files: FileList | null) {
    if (!files) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      if (files.length + photos.length > 30) throw Error("Use up to 30 test photos at a time.");
      const added: CollagePhoto[] = [];
      const addedUrls: string[] = [];
      try {
        for (const file of Array.from(files)) {
          if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 30 * 1024 * 1024) throw Error("Choose PNG or JPEG photos under 30 MB each.");
          const url = URL.createObjectURL(file);
          addedUrls.push(url);
          const image = await loadCollageImage(url);
          added.push({ url, filename: file.name, width: image.naturalWidth, height: image.naturalHeight });
        }
      } catch (e) { addedUrls.forEach(url => URL.revokeObjectURL(url)); throw e; }
      photoUrls.current.push(...addedUrls);
      setPhotos(p => [...p, ...added]);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function uploadArtwork(file: File | undefined) {
    if (!file) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      const overlay = await artworkData(file);
      await loadCollageImage(overlay);
      setTemplate(t => ({ ...t, overlay }));
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  function saveTemplate() {
    setError(""); setNotice("");
    try {
      const design = parseCollageTemplate(template);
      download(new Blob([JSON.stringify(design, null, 2)], { type: "application/json" }), `${fileStem(design.name)}.collage.json`);
      setNotice("Template downloaded. It includes artwork and layout, without test photos or student details.");
    } catch (e) { setError(message(e)); }
  }
  async function exportPrint() {
    setBusy(true); setError(""); setNotice("");
    try {
      const design = parseCollageTemplate(template);
      const canvas = await renderCollage(design, placements, [name, school, year], design.widthInches * COLLAGE_DPI);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error("Could not export this print.")), "image/png"));
      download(blob, `${fileStem(design.name)}-${design.widthInches}x${design.heightInches}-${COLLAGE_DPI}ppi.png`);
      const bleed = design.bleedInches ?? 0;
      setNotice(`Print downloaded: ${canvas.width} × ${canvas.height} pixels. Trim ${design.widthInches} × ${design.heightInches} inches; full image ${design.widthInches + 2 * bleed} × ${design.heightInches + 2 * bleed} inches, including ${bleed}-inch bleed. Give the lab both dimensions.`);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  return <main className={styles.studio}>
    <header className={styles.header}>
      <div><Link href="/dashboard/packages">← Packages</Link><p className={styles.eyebrow}>COLLAGE STUDIO · DESIGN PREVIEW</p><h1>One layout. Their favourite moments.</h1><p>Create a reusable design, then try choosing photos as a parent would.</p></div>
      <div className={styles.actions}>
        <label className={styles.button}>Import template<input disabled={busy} type="file" accept=".json" onChange={e => { void importTemplate(e.target.files?.[0]); e.target.value = ""; }} /></label>
        <button disabled={busy} onClick={saveTemplate}>Download template</button>
      </div>
    </header>
    <div className={styles.banner}>Preview workspace · Save private, versioned templates or download JSON. Gallery selection and production integration are under review; purchasing stays disabled by default.</div>
    {(error || renderError) && <p role="alert" className={styles.error}>{error || renderError}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <CloudCollageLibrary design={template} onLoad={next => { setTemplate(next); setPlacements({}); setSelectedSlot(next.slots[0].id); }} onMessage={(text, failed) => { setError(failed ? text : ""); setNotice(failed ? "" : text); }} />
    <div className={styles.workspace}>
      <aside className={styles.panel}>
        <div className={styles.tabs} role="group" aria-label="Editor mode">
          <button aria-pressed={mode === "design"} onClick={() => setMode("design")}>Design template</button>
          <button aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Try photo selection</button>
        </div>
        {mode === "design" ? <>
          <h2>Start with a layout</h2>
          <div className={styles.actions}><button onClick={() => preset("triptych")}>Three photos</button><button onClick={() => preset("graduation")}>Graduation</button></div>
          <label>Template name<input maxLength={100} value={template.name} onChange={e => setTemplate(t => ({ ...t, name: e.target.value }))} /></label>
          <div className={styles.pair}>
            <label>Width (inches)<input type="number" min={4} max={30} step={.5} value={template.widthInches} onChange={e => setTemplate(t => ({ ...t, widthInches: Number(e.target.value) }))} /></label>
            <label>Height (inches)<input type="number" min={4} max={30} step={.5} value={template.heightInches} onChange={e => setTemplate(t => ({ ...t, heightInches: Number(e.target.value) }))} /></label>
          </div>
          <div className={styles.pair}>
            <label>Bleed (inches)<input type="number" min={0} max={.5} step={.025} value={template.bleedInches ?? 0} onChange={e => setTemplate(t => ({ ...t, bleedInches: Number(e.target.value) }))} /></label>
            <label>Safe inset (inches)<input type="number" min={0} max={.5} step={.025} value={template.safeInsetInches ?? .125} onChange={e => setTemplate(t => ({ ...t, safeInsetInches: Number(e.target.value) }))} /></label>
          </div>
          <div className={styles.pair}><label>Paper colour<input type="color" value={template.background} onChange={e => setTemplate(t => ({ ...t, background: e.target.value }))} /></label><label>Text colour<input type="color" value={template.ink} onChange={e => setTemplate(t => ({ ...t, ink: e.target.value }))} /></label></div>
          <h2>Artwork and borders</h2>
          <p className={styles.help}>Upload a transparent PNG with openings for the photos. Include your borders, school logo and decoration in this artwork. A photographed sample is a reference; its existing portraits will not be removed automatically.</p>
          <label className={styles.button}>Upload artwork<input disabled={busy} type="file" accept="image/png,image/jpeg" onChange={e => { void uploadArtwork(e.target.files?.[0]); e.target.value = ""; }} /></label>
          {template.overlay && <button onClick={() => setTemplate(t => ({ ...t, overlay: null }))}>Remove artwork</button>}
          <h2>Photo spaces</h2>
          <label>Selected space<select value={active.id} onChange={e => setSelectedSlot(e.target.value)}>{template.slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label>Space label<input maxLength={80} value={active.label} onChange={e => updateSlot({ label: e.target.value })} /></label>
          <div className={styles.pair}>{(["x", "y", "width", "height"] as const).map(key => <label key={key}>{({ x: "Left", y: "Top", width: "Width", height: "Height" })[key]} (%)<input type="number" min={key === "width" || key === "height" ? 2 : 0} max={100} step={.5} value={Math.round(active[key] * 1000) / 10} onChange={e => updateSlot({ [key]: Number(e.target.value) / 100 })} /></label>)}</div>
          <div className={styles.pair}>
            <label>Space border colour<input type="color" value={active.border?.color ?? "#172033"} onChange={e => updateSlot({ border: { color: e.target.value, widthInches: active.border?.widthInches ?? .025 } })} /></label>
            <label>Border (inches)<input type="number" min={0} max={.25} step={.005} value={active.border?.widthInches ?? 0} onChange={e => updateSlot({ border: { color: active.border?.color ?? "#172033", widthInches: Number(e.target.value) } })} /></label>
          </div>
          <div className={styles.actions}><button disabled={template.slots.length >= 8} onClick={() => {
            const id = `photo_${crypto.randomUUID()}`;
            setTemplate(t => ({ ...t, slots: [...t.slots, { id, label: `Photo ${t.slots.length + 1}`, x: .1, y: .1, width: .3, height: .4 }] })); setSelectedSlot(id);
          }}>Add space</button><button disabled={template.slots.length === 1} onClick={() => {
            const next = template.slots.filter(s => s.id !== active.id);
            setTemplate(t => ({ ...t, slots: next })); setSelectedSlot(next[0].id);
          }}>Remove space</button></div>
          <h2>Caption position</h2>
          <div className={styles.pair}>{(["x", "y", "size"] as const).map(key => <label key={key}>{({ x: "Centre X", y: "Top Y", size: "Text size" })[key]} (%)<input type="number" min={key === "size" ? 1 : 0} max={key === "size" ? 6 : key === "y" ? 90 : 100} step={.5} value={Math.round(template.caption[key] * 1000) / 10} onChange={e => setTemplate(t => ({ ...t, caption: { ...t.caption, [key]: Number(e.target.value) / 100 } }))} /></label>)}</div>
        </> : <>
          <h2>Choose photos for each space</h2><p className={styles.help}>Select a space on the preview, then choose a photo below. The same photo can fill multiple spaces.</p>
          <label>Choose photo space<select value={active.id} onChange={e => setSelectedSlot(e.target.value)}>{template.slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className={styles.button}>Upload test photos<input disabled={busy} type="file" accept="image/png,image/jpeg" multiple onChange={e => { void uploadPhotos(e.target.files); e.target.value = ""; }} /></label>
          <p className={styles.help}>Test photos stay in this page and are not uploaded or saved in the template.</p>
          <div className={styles.photoList}>{photos.map(photo => <button key={photo.url} aria-label={`Assign ${photo.filename} to ${active.label}`} aria-pressed={placement?.photo.url === photo.url} onClick={() => {
            setPlacements(p => ({ ...p, [active.id]: { photo, zoom: 1, x: .5, y: .5 } }));
            const next = template.slots.find(s => s.id !== active.id && !Object.hasOwn(placements, s.id));
            if (next) setSelectedSlot(next.id);
          }}><img src={photo.url} alt={photo.filename} /><span>{photo.filename}</span></button>)}</div>
          {placement && <><h2>Crop: {active.label}</h2>{(["zoom", "x", "y"] as const).map(key => <label key={key}>{({ zoom: "Zoom", x: "Horizontal position", y: "Vertical position" })[key]}<input type="range" min={key === "zoom" ? 1 : 0} max={key === "zoom" ? 3 : 1} step={.01} value={placement[key]} onChange={e => updatePlacement({ [key]: Number(e.target.value) })} /></label>)}<button onClick={() => setPlacements(p => { const next = { ...p }; delete next[active.id]; return next; })}>Clear selected photo</button></>}
        </>}
      </aside>
      <section className={styles.previewPanel}>
        <div className={styles.previewHeading}><h2>{mode === "design" ? "Live design" : "Parent selection preview"}</h2><span>{template.widthInches} × {template.heightInches} in</span></div>
        <div className={styles.paper}>
          <div ref={preview} className={styles.canvas} />
          <div className={styles.slots} style={collageTrimPercent(template)}>{template.slots.map(s => <button key={s.id} aria-label={`Select ${s.label}`} aria-pressed={active.id === s.id} className={active.id === s.id ? styles.activeSlot : styles.slot} style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.width * 100}%`, height: `${s.height * 100}%` }} onClick={() => setSelectedSlot(s.id)}><span>{s.label}{Object.hasOwn(placements, s.id) ? " ✓" : ""}</span></button>)}</div>
        </div>
        <div className={styles.captionFields}><label>Student name<input maxLength={100} placeholder="Student name" value={name} onChange={e => setName(e.target.value)} /></label><label>School / occasion<input maxLength={100} placeholder="School or occasion" value={school} onChange={e => setSchool(e.target.value)} /></label><label>Year / class<input maxLength={100} placeholder="Class of 2026" value={year} onChange={e => setYear(e.target.value)} /></label></div>
        <ul className={styles.checklist}>{template.slots.map(s => {
          const p = Object.hasOwn(placements, s.id) ? placements[s.id] : undefined;
          let dpi: number | null = null;
          try { if (p) dpi = collageResolution(template, s, p); } catch { /* Invalid geometry is reported above. */ }
          return <li key={s.id}><span>{s.label}: {p?.photo.filename ?? "Choose a photo"}</span>{dpi !== null && <span className={dpi < 200 ? styles.warning : ""}>{dpi} ppi{dpi < 200 ? " · Low resolution" : ""}</span>}</li>;
        })}</ul>
        <div className={styles.exportRow}><p className={styles.help}>PNG at 300 pixels per inch. Width and height are the trimmed print; bleed is added outside it. Artwork covers trim. Keep captions and logos inside the safe inset and confirm the lab’s requirements.</p><button className={styles.primary} disabled={busy || !complete || !!renderError} onClick={() => void exportPrint()}>{busy ? "Working…" : "Download print PNG"}</button></div>
      </section>
    </div>
  </main>;
}
