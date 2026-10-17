"use client";
/* Gallery previews are already authorized; local object URLs avoid exporting remote images directly. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { loadCollageImage, renderCollage } from "@/lib/collage-render";
import { collageSelectionComplete, collageTrimPercent, type CollageGalleryPhoto, type CollageGalleryVersion } from "@/lib/collage-client";
import type { CollageSelection } from "@/lib/collage-selection";
import type { CollagePlacement } from "@/lib/collage-template";
import styles from "./collage-studio.module.css";

type VerifiedPreview = { preview: string; width: number; height: number; warnings: Array<{ slotId: string; ppi: number }> };
function useTemplateArtwork(version?: CollageGalleryVersion, laneId?: string) {
  const [result, setResult] = useState<{ id: string; lane: string; version?: CollageGalleryVersion; error?: string }>();
  const id = version?.id, needsArtwork = version?.hasArtwork && !version.design.overlay;
  useEffect(() => {
    if (!id || !needsArtwork || !laneId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ parentLaneId: laneId, versionIds: id, artwork: "1" });
    void fetch(`/api/portal/collages?${query}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok || payload.versions?.[0]?.id !== id) throw Error(payload.message || "This collage artwork is unavailable. Reopen the gallery.");
        if (!controller.signal.aborted) setResult({ id, lane: laneId, version: payload.versions[0] });
      }).catch(error => { if (!controller.signal.aborted) setResult({ id, lane: laneId, error: error instanceof Error ? error.message : "Could not open the design artwork." }); });
    return () => controller.abort();
  }, [id, needsArtwork, laneId]);
  const current = result?.id === id && result?.lane === laneId ? result : undefined;
  return { version: current?.version ?? version, error: current?.error };
}
function useOriginalPreview(selection: CollageSelection, version?: CollageGalleryVersion, laneId?: string) {
  const [result, setResult] = useState<{ key: string; value?: VerifiedPreview; error?: string }>();
  const key = JSON.stringify(selection);
  useEffect(() => {
    if (!laneId || !selection.placements.length || (version && !collageSelectionComplete(selection, version.design))) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch("/api/portal/collages/preview", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentLaneId: laneId, selection }) })
        .then(async response => {
          const payload = await response.json();
          if (!response.ok) throw Error(payload.message || "Could not verify the finished print preview.");
          if (!controller.signal.aborted) setResult({ key, value: payload });
        }).catch(error => { if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "Could not verify this preview." }); });
    }, 650);
    return () => { clearTimeout(timer); controller.abort(); };
    // The recipe key changes on every crop/caption edit; unrelated gallery renders do not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, laneId]);
  return result?.key === key ? result : undefined;
}

function useCollageCanvas(selection: CollageSelection, version: CollageGalleryVersion | undefined, photos: CollageGalleryPhoto[]) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const photoMap = JSON.stringify(photos.map(p => [p.mediaId, p.url]));
  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    const urls: string[] = [];
    async function draw() {
      const placements: Record<string, CollagePlacement> = {};
      const loaded = new Map<string, CollagePlacement["photo"]>();
      for (const placement of selection.placements) {
        const photo = photos.find(p => p.mediaId === placement.mediaId);
        if (!photo) throw Error("A selected photo is unavailable in this gallery. Reopen that gallery to review this collage.");
        if (!loaded.has(photo.mediaId)) {
          const response = await fetch(photo.url, { credentials: "same-origin", cache: "no-store" });
          if (!response.ok) throw Error("A gallery photo could not be loaded. Reopen the gallery and try again.");
          const blob = await response.blob();
          if (blob.size > 30 * 1024 * 1024) throw Error("This preview image is too large.");
          const url = URL.createObjectURL(blob); urls.push(url);
          const image = await loadCollageImage(url);
          loaded.set(photo.mediaId, { url, filename: photo.filename, width: image.naturalWidth, height: image.naturalHeight });
        }
        placements[placement.slotId] = { photo: loaded.get(photo.mediaId)!, zoom: placement.zoom, x: placement.x, y: placement.y };
      }
      const canvas = await renderCollage(version!.design, placements,
        [selection.caption.studentName, selection.caption.schoolName, selection.caption.year], 800, true);
      if (!cancelled) { canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Collage selection preview"); host.current?.replaceChildren(canvas); setError(""); }
    }
    void draw().catch(e => { if (!cancelled) { host.current?.replaceChildren(); setError(e instanceof Error ? e.message : "Could not render this collage."); } }).finally(() => { if (cancelled) urls.forEach(url => URL.revokeObjectURL(url)); });
    return () => { cancelled = true; urls.forEach(url => URL.revokeObjectURL(url)); };
    // Photo maps are serialized so a gallery render does not refetch identical previews.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, version, photoMap]);
  return { host, error };
}

export function CollageCartPreview({ selection, version, photos, laneId }: { selection: CollageSelection; version?: CollageGalleryVersion; photos: CollageGalleryPhoto[]; laneId?: string }) {
  const { host, error } = useCollageCanvas(selection, version, photos);
  const verified = useOriginalPreview(selection, version, laneId);
  return <div style={{ width: "100%", maxWidth: 320 }}>
    <p style={{ fontSize: 12 }}>Collage · {selection.placements.length} photo spaces · one finished print</p>
    {verified?.value ? <img src={verified.value.preview} alt="Finished collage print preview" style={{ width: "100%" }} /> : version ? <div ref={host} className={styles.canvas} /> : <p>Reopen this item’s gallery to review its collage.</p>}
    {verified?.error && <p role="alert">Finished print preview unavailable: {verified.error}</p>}
    {laneId && !verified && <p role="status">Verifying the finished print preview…</p>}
    {!verified?.value && error && <p role="alert">{error}</p>}
    <small>{[selection.caption.studentName, selection.caption.schoolName, selection.caption.year].filter(Boolean).join(" · ")}</small>
  </div>;
}

export function ParentCollagePicker({ selection, version, photos, onChange, laneId, reviewed, onReviewed }: {
  selection: CollageSelection; version?: CollageGalleryVersion; photos: CollageGalleryPhoto[];
  onChange: (selection: CollageSelection) => void;
  laneId?: string; reviewed?: boolean; onReviewed?: () => void;
}) {
  const [selected, setSelected] = useState("");
  const artwork = useTemplateArtwork(version, laneId);
  const { host, error } = useCollageCanvas(selection, artwork.version, photos);
  const verified = useOriginalPreview(selection, version, laneId);
  if (!version) return <p role="status">Loading this collage design…</p>;
  const active = version.design.slots.find(s => s.id === selected) ?? version.design.slots[0];
  const placement = selection.placements.find(p => p.slotId === active.id);
  function assign(mediaId: string) {
    onChange({ ...selection, placements: [...selection.placements.filter(p => p.slotId !== active.id), { slotId: active.id, mediaId, zoom: 1, x: .5, y: .5 }] });
    const next = version!.design.slots.find(s => s.id !== active.id && !selection.placements.some(p => p.slotId === s.id));
    if (next) setSelected(next.id);
  }
  return <div className={styles.parentPicker}>
    <p className={styles.help}>Collage preview · Tap each photo space, choose a photo, then adjust its crop. You can use the same photo again.</p>
    <div className={styles.paper}>
      {verified?.value && <img src={verified.value.preview} alt="Finished collage print preview" style={{ display: "block", width: "100%" }} />}
      <div ref={host} className={styles.canvas} style={{ display: verified?.value ? "none" : "block" }} />
      <div className={styles.slots} style={collageTrimPercent(version.design)}>{version.design.slots.map(s => <button key={s.id} type="button" aria-label={`Choose ${s.label}`} aria-pressed={active.id === s.id} className={active.id === s.id ? styles.activeSlot : styles.slot} style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.width * 100}%`, height: `${s.height * 100}%` }} onClick={() => setSelected(s.id)}><span>{s.label}{selection.placements.some(p => p.slotId === s.id) ? " ✓" : ""}</span></button>)}</div>
    </div>
    {error && <p role="alert">{error}</p>}
    {artwork.error && <p role="alert">{artwork.error}</p>}
    <label>Photo space<select value={active.id} onChange={e => setSelected(e.target.value)}>{version.design.slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
    <div className={styles.photoList}>{photos.map(photo => <button key={photo.mediaId} type="button" aria-label={`Use ${photo.filename} for ${active.label}`} aria-pressed={placement?.mediaId === photo.mediaId} onClick={() => assign(photo.mediaId)}><img src={photo.url} alt={photo.filename} /><span>{photo.filename}</span></button>)}</div>
    {placement && <div className={styles.pair}>{(["zoom", "x", "y"] as const).map(key => <label key={key}>{({ zoom: "Crop closer", x: "Horizontal position", y: "Vertical position" })[key]}<input type="range" min={key === "zoom" ? 1 : 0} max={key === "zoom" ? 3 : 1} step={.01} value={placement[key]} onChange={e => onChange({ ...selection, placements: selection.placements.map(p => p.slotId === active.id ? { ...p, [key]: Number(e.target.value) } : p) })} /></label>)}</div>}
    <div className={styles.captionFields}>{(["studentName", "schoolName", "year"] as const).map(key => <label key={key}>{({ studentName: "Name", schoolName: "School / occasion", year: "Year / class" })[key]}<input maxLength={100} value={selection.caption[key]} onChange={e => onChange({ ...selection, caption: { ...selection.caption, [key]: e.target.value } })} /></label>)}</div>
    <p role="status" className={styles.help}>{collageSelectionComplete(selection, version.design) ? "All photo spaces selected. Review each crop before adding this print." : "Choose a photo for every space."} Trim {version.design.widthInches} × {version.design.heightInches} in · bleed {version.design.bleedInches ?? 0} in · 300 ppi output.</p>
    {collageSelectionComplete(selection, version.design) && <div>
      {verified?.error ? <p role="alert">{verified.error}</p> : !verified?.value ? <p role="status">Preparing the finished print preview from your original photos…</p> : <>
        <p className={styles.help}>Finished print preview · {verified.value.width} × {verified.value.height} pixels. This preview uses the production layout and crops.</p>
        {verified.value.warnings.map(warning => <p key={warning.slotId} className={styles.warning}>{version.design.slots.find(s => s.id === warning.slotId)?.label}: {warning.ppi} ppi{warning.ppi < 200 ? " · Low resolution; try a wider crop or another photo." : " · Below 300 ppi."}</p>)}
        <button type="button" disabled={reviewed} onClick={onReviewed}>{reviewed ? "Print preview reviewed ✓" : "I have reviewed this print and its crops"}</button>
      </>}
    </div>}
  </div>;
}
