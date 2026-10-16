"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Check, Crop, Download, ImagePlus, Loader2, Plus, RefreshCw, RotateCw, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { ProductionCrop } from "@/lib/labs/production-types";
import { SHEET_PAPERS, SHEET_TEMPLATES, sheetGeometry, validateSheetCrop, type SheetAction, type SheetCellGeometry, type SheetDocument, type SheetDraft, type SheetGeometry, type SheetPaperId, type SheetResponse, type SheetSource, type SheetTemplateId, type SheetWorkspace } from "@/lib/labs/sheet-layouts";
import { ProductionApiError, productionFetch, productionPrivateBlob, productionSessionRead, productionSessionWrite } from "./production-client";
import { SheetCropEditor, SheetCropFrame, sheetCropFit, sheetCropImageStyle, sheetCropSnap, sheetCropToPixels, type SheetNormalizedCrop } from "./sheet-crop-editor";
import styles from "./sheet-layout-builder.module.css";

const defaultDocument = (): SheetDocument => ({ paperId: "7x10", orientation: 90, templateId: "two-5x7", copies: 1, cells: [{ id: "a", assetId: null, crop: null }, { id: "b", assetId: null, crop: null }] });
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
type Editing = { cellId: string; crop: SheetNormalizedCrop; ready: boolean; reviewed: boolean };
export function sheetCellPosition(cell: SheetCellGeometry, geometry: Pick<SheetGeometry, "widthInches" | "heightInches">): CSSProperties { return { left: `${cell.xInches / geometry.widthInches * 100}%`, top: `${cell.yInches / geometry.heightInches * 100}%`, width: `${cell.widthInches / geometry.widthInches * 100}%`, height: `${cell.heightInches / geometry.heightInches * 100}%` }; }
export function sheetReady(document: SheetDocument, sources: SheetSource[]): boolean {
  try { const geometry = sheetGeometry(document); return geometry.cells.every(cell => { const choice = document.cells.find(value => value.id === cell.id), source = sources.find(value => value.id === choice?.assetId); if (!source || !choice?.crop) return false; validateSheetCrop(source, choice.crop, cell); return true; }); } catch { return false; }
}
export function sheetFits(document: SheetDocument, templateId: SheetTemplateId): boolean {
  try { sheetGeometry({ ...document, templateId, cells: SHEET_TEMPLATES.find(template => template.id === templateId)!.cells.map(cell => ({ id: cell.id, assetId: null, crop: null })) }); return true; } catch { return false; }
}

export function SheetLayoutBuilder({ audience, jobId }: { audience: "studio" | "lab"; jobId?: string }) {
  const endpoint = audience === "lab" ? "/api/lab/sheets" : "/api/dashboard/lab-sheets";
  const [workspace, setWorkspace] = useState<SheetWorkspace | null>(null), [userId, setUserId] = useState("");
  const activeUser = useRef(""), uploadInput = useRef<HTMLInputElement>(null), paperRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [document, setDocument] = useState<SheetDocument>(defaultDocument), [name, setName] = useState("My test print sheet"), [currentId, setCurrentId] = useState("");
  const [paperChosen, setPaperChosen] = useState(false), [selectedCell, setSelectedCell] = useState("a"), [editing, setEditing] = useState<Editing | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({}), [pending, setPending] = useState<SheetAction | null>(null), [confirm, setConfirm] = useState<{ message: string; run: () => void } | null>(null);
  const [proof, setProof] = useState<{ renderId: string; url: string } | null>(null), [proofReady, setProofReady] = useState(false), [proofReviewed, setProofReviewed] = useState(false);
  const clearPreview = useCallback((id: string, url: string) => setPreviews(current => { if (current[id] !== url) return current; const next = { ...current }; delete next[id]; return next; }), []);
  const key = `studio-os-sheet:${userId}:${audience}:${jobId || "library"}`;
  const path = useCallback((params: Record<string, string> = {}) => { const query = new URLSearchParams({ ...(jobId && !["proof", "jpeg", "manifest"].includes(params.file) ? { jobId } : {}), ...params }); return `${endpoint}${query.size ? `?${query}` : ""}`; }, [endpoint, jobId]);
  const saved = workspace?.drafts.find(draft => draft.id === currentId);
  const dirty = !!paperChosen && (!saved || saved.name !== name || JSON.stringify(saved.document) !== JSON.stringify(document));
  const canEdit = !!workspace?.canCreate && !busy && !pending;
  let geometry: SheetGeometry | null = null; try { geometry = paperChosen ? sheetGeometry(document) : null; } catch { /* The user must choose a compatible layout; prints are never scaled. */ }
  const cell = geometry?.cells.find(value => value.id === selectedCell), choice = document.cells.find(value => value.id === selectedCell), source = workspace?.sources.find(value => value.id === choice?.assetId);
  const ready = !!workspace && paperChosen && sheetReady(document, workspace.sources);
  const loadDraft = useCallback((draft: SheetDraft) => { setCurrentId(draft.id); setName(draft.name); setDocument(draft.document); setPaperChosen(true); setSelectedCell(draft.document.cells[0]?.id || "a"); setEditing(null); setProofReviewed(false); }, []);
  const adoptDraft = useCallback((draft: SheetDraft) => { setWorkspace(current => current ? { ...current, drafts: [draft, ...current.drafts.filter(value => value.id !== draft.id)] } : current); loadDraft(draft); }, [loadDraft]);
  useEffect(() => {
    if (audience === "lab" && !jobId) return;
    const controller = new AbortController(), client = createClient();
    client.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) throw new Error("Sign in to open your private print sheets.");
      activeUser.current = session.user.id;
      const savedKey = `studio-os-sheet:${session.user.id}:${audience}:${jobId || "library"}`;
      const remembered = productionSessionRead<{ id: string }>(`${savedKey}:last-draft`), rememberedId = remembered && /^[a-f0-9-]{36}$/i.test(remembered.id) ? remembered.id : "";
      let response: Response;
      try { response = await productionFetch(path(rememberedId ? { draftId: rememberedId } : {}), undefined, session.user.id, controller.signal); }
      catch (cause) { if (!rememberedId || !(cause instanceof ProductionApiError) || cause.status !== 404) throw cause; sessionStorage.removeItem(`${savedKey}:last-draft`); response = await productionFetch(path(), undefined, session.user.id, controller.signal); }
      const result = await response.json() as SheetResponse;
      if (controller.signal.aborted || activeUser.current !== session.user.id) return;
      if (!result.ok || !result.workspace) throw new Error(result.message || "Your saved sheets could not be loaded.");
      setUserId(session.user.id); setWorkspace(result.workspace);
      const rememberedDraft = result.workspace.drafts.find(draft => draft.id === rememberedId); if (rememberedDraft) loadDraft(rememberedDraft);
      const waiting = productionSessionRead<SheetAction>(`${savedKey}:pending`);
      if (waiting) { setPending(waiting); if (waiting.action === "save") { setCurrentId(waiting.draftId); setName(waiting.name); setDocument(waiting.document); setPaperChosen(true); } }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Private sheets could not be opened."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN" && activeUser.current && session?.user.id !== activeUser.current) { controller.abort(); activeUser.current = ""; setWorkspace(null); setUserId(""); setPreviews({}); setPending(null); setError("The account changed. Reopen your private sheet workspace."); setLoading(false); }
    });
    return () => { controller.abort(); subscription.unsubscribe(); };
  }, [audience, jobId, path, loadDraft]);
  useEffect(() => { if (!userId) return; try { if (currentId) productionSessionWrite(`${key}:last-draft`, { id: currentId }); else sessionStorage.removeItem(`${key}:last-draft`); } catch { /* Remembering the open draft is optional; writes validate retry storage before submission. */ } }, [currentId, key, userId]);
  const savedRender = saved?.render, savedId = saved?.id;
  useEffect(() => {
    if (!savedRender || !savedId || dirty || !userId) return;
    const controller = new AbortController(); let objectUrl = "";
    productionPrivateBlob(path({ file: "proof", draftId: savedId, renderId: savedRender.id }), userId, controller.signal).then(blob => { if (controller.signal.aborted || activeUser.current !== userId) return; objectUrl = URL.createObjectURL(blob); setProof({ renderId: savedRender.id, url: objectUrl }); setProofReady(false); setProofReviewed(false); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The saved JPEG preview is unavailable."); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); setProof(null); setProofReady(false); };
  }, [savedId, savedRender, dirty, userId, path]);
  function changeDocument(next: SheetDocument) { setDocument(next); setProofReviewed(false); setNotice(""); }
  function guarded(run: () => void, message = "Your current changes are not saved. Continue without saving this sheet?") { if (dirty || editing) setConfirm({ run, message }); else run(); }
  async function refresh(draftId = currentId) {
    if (!userId || busy) return; setBusy(true); setError("");
    try { const response = await productionFetch(path(draftId ? { draftId } : {}), undefined, userId), result = await response.json() as SheetResponse; if (!result.ok || !result.workspace || activeUser.current !== userId) throw new Error(result.message || "Saved sheets could not be reloaded."); setWorkspace(result.workspace); const draft = result.workspace.drafts.find(value => value.id === draftId); if (draft) loadDraft(draft); setNotice("Saved sheets reloaded from your private workspace."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Saved sheets could not be reloaded."); }
    finally { setBusy(false); }
  }
  async function mutate(action: SheetAction) {
    if (busy || !userId) return;
    try { productionSessionWrite(`${key}:pending`, action); setPending(action); } catch (cause) { setError(cause instanceof Error ? cause.message : "The request could not be retained."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await productionFetch(path(), action, userId), result = await response.json() as SheetResponse;
      if (!result.ok || !result.draft || activeUser.current !== userId) throw new Error(result.message || "The result could not be confirmed. Retry the same request.");
      adoptDraft(result.draft); sessionStorage.removeItem(`${key}:pending`); setPending(null);
      setNotice(action.action === "save" ? "Your sheet is saved privately. Generate its JPEG when every crop is ready." : action.action === "render" ? "Your JPEG is ready to review below. Check the actual saved file before downloading." : "JPEG reviewed. Your test sheet is ready to download.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The update could not be confirmed. Retry the retained request."); }
    finally { setBusy(false); }
  }
  function save() { if (!canEdit || !paperChosen || !geometry || !name.trim() || editing) return; void mutate({ action: "save", draftId: currentId || crypto.randomUUID(), requestId: crypto.randomUUID(), expectedVersion: saved?.version || 0, jobId: jobId || null, name: name.trim(), document }); }
  function newSheet() { setCurrentId(""); setName("My test print sheet"); setDocument(defaultDocument()); setPaperChosen(false); setSelectedCell("a"); setEditing(null); setNotice(""); }
  function chooseTemplate(templateId: SheetTemplateId) {
    if (!canEdit || !paperChosen || templateId === document.templateId || !sheetFits(document, templateId)) return;
    const run = () => { const template = SHEET_TEMPLATES.find(value => value.id === templateId)!; changeDocument({ ...document, templateId, cells: template.cells.map(value => ({ id: value.id, assetId: null, crop: null })) }); setSelectedCell("a"); setEditing(null); };
    if (document.cells.some(value => value.assetId)) setConfirm({ run, message: "Change the layout? You will choose photos and crops again. Finished print sizes will stay fixed." }); else run();
  }
  function assignPhoto(assetId: string, cellId = selectedCell) {
    if (!canEdit || !geometry || !workspace?.sources.some(value => value.id === assetId) || !previews[assetId]) return;
    const photo = workspace.sources.find(value => value.id === assetId)!, print = geometry.cells.find(value => value.id === cellId); if (!print) return;
    changeDocument({ ...document, cells: document.cells.map(value => value.id === cellId ? { ...value, assetId, crop: null } : value) }); setSelectedCell(cellId); setEditing({ cellId, ready: false, reviewed: false, crop: sheetCropSnap(sheetCropFit(photo.widthPixels, photo.heightPixels, print.widthInches, print.heightInches), photo.widthPixels, photo.heightPixels) });
  }
  function beginCrop() {
    if (!canEdit || !source || !cell || !previews[source.id]) return;
    const fit = sheetCropFit(source.widthPixels, source.heightPixels, cell.widthInches, cell.heightInches), old = choice?.crop;
    setEditing({ cellId: selectedCell, ready: false, reviewed: false, crop: old && old.rotation === 0 ? { x: old.x / source.widthPixels, y: old.y / source.heightPixels, width: old.width / source.widthPixels, height: old.height / source.heightPixels } : sheetCropSnap(fit, source.widthPixels, source.heightPixels) });
  }
  function keepCrop() {
    if (!editing || !editing.ready || !editing.reviewed || !source || !cell) return;
    try { const crop = sheetCropToPixels(editing.crop, source.widthPixels, source.heightPixels); validateSheetCrop(source, crop, cell); changeDocument({ ...document, cells: document.cells.map(value => value.id === editing.cellId ? { ...value, crop } : value) }); setEditing(null); setNotice("Crop kept for this print. Save the sheet to retain it online."); }
    catch { setError("This crop needs more photo pixels or a matching shape. Adjust it before keeping the crop."); }
  }
  async function upload(file: File) {
    if (!canEdit || jobId || audience !== "studio") return;
    if (file.size > 4_000_000 || !["image/jpeg", "image/png"].includes(file.type)) { setError("Choose a JPEG or PNG up to 4 MB."); return; }
    setBusy(true); setError("");
    try { const form = new FormData(); form.append("kind", "original"); form.append("file", file); const response = await productionFetch("/api/dashboard/lab-production-assets", form, userId), result = await response.json() as { ok: boolean; asset?: SheetSource; message?: string }; if (!result.ok || !result.asset || activeUser.current !== userId) throw new Error(result.message || "Photo upload could not be confirmed."); setWorkspace(current => current ? { ...current, sources: [result.asset!, ...current.sources.filter(value => value.id !== result.asset!.id)] } : current); setNotice("Photo added privately. Drag it onto a print on the paper."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The photo could not be uploaded."); }
    finally { setBusy(false); }
  }
  async function download(file: "jpeg" | "manifest") {
    if (!saved?.render?.reviewedAt || dirty || editing || busy) return; setBusy(true); setError("");
    try { const blob = await productionPrivateBlob(path({ file, draftId: saved.id, renderId: saved.render.id }), userId); if (activeUser.current !== userId) throw new Error("Reopen this private workspace after signing in."); const url = URL.createObjectURL(blob), anchor = window.document.createElement("a"); anchor.href = url; anchor.download = file === "jpeg" ? saved.render.filename : `${saved.id}-manifest.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The reviewed sheet could not be downloaded."); }
    finally { setBusy(false); }
  }
  if (audience === "lab" && !jobId) return <div className={styles.shell}><main className={styles.page}><nav className={styles.nav}><Link href="/lab/production-v2"><ArrowLeft size={14} />Lab orders</Link></nav><section className={styles.empty}><h1>Open a job to build its test sheet</h1><p>The lab sheet builder uses only the photos assigned to that job. Open the sheet builder from a job in your receiving workspace.</p><Link className={styles.primary} href="/lab/production-v2">Open lab receiving</Link></section></main></div>;
  return <div className={styles.shell}><main className={styles.page}>
    <nav className={styles.nav}><Link href={audience === "lab" ? "/lab/production-v2" : "/dashboard/labs/production-v2"}><ArrowLeft size={14} />{audience === "lab" ? "Lab receiving" : "Photographer production"}</Link><Link href="/labs-pilot/gta-demo">Rehearsal guide</Link></nav>
    <header className={styles.header}><div><p className={styles.eyebrow}>PAPER · LAYOUT · PHOTOS</p><h1>Build a print sheet</h1><p className={styles.intro}>Choose paper, pick a layout, then drag photos into place.</p></div><span className={styles.badge}>TEST SHEET</span></header>
    <p className={styles.boundary}>Private test sheet only · Existing prices and ordered products stay unchanged · No real printer, GTA intake or payment.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    {pending && !busy && <div className={styles.notice}>An update is waiting for confirmation. Its original request is retained.<div className={styles.actions}><button className={styles.primary} onClick={() => void mutate(pending)}>Retry same update</button><button className={styles.secondary} onClick={() => void refresh(pending.draftId)}>Reload saved sheet</button><button className={styles.quiet} onClick={() => { sessionStorage.removeItem(`${key}:pending`); setPending(null); }}>Dismiss retry</button></div></div>}
    {loading ? <section className={styles.empty}><Loader2 className={styles.spin} size={24} /><p>Opening your private sheets…</p></section> : !workspace ? <section className={styles.empty}><h2>Sign in to build a private sheet</h2><p>Your photos and saved layouts are available only to your studio and the assigned receiving team.</p><Link className={styles.primary} href={`/sign-in?redirect=${encodeURIComponent(audience === "lab" ? `/lab/sheets?jobId=${jobId}` : `/dashboard/labs/sheets${jobId ? `?jobId=${jobId}` : ""}`)}`}>Sign in</Link></section> : <>
      {workspace.jobReference && <p className={styles.notice}>Using photos selected for {workspace.jobReference}. This draft starts from the original photos. Existing crop and colour reviews stay with the order.</p>}
      <div className={styles.toolbar}><label className={styles.field}>Saved sheets<select value={currentId} disabled={busy || !!pending} onChange={event => { if (!event.target.value) { guarded(newSheet); return; } const draft = workspace.drafts.find(value => value.id === event.target.value); if (draft) guarded(() => { loadDraft(draft); void refresh(draft.id); }); }}><option value="">New sheet</option>{workspace.drafts.map(draft => <option key={draft.id} value={draft.id}>{draft.name}</option>)}</select></label><button className={styles.secondary} disabled={busy || !!pending || !workspace.canCreate} onClick={() => guarded(newSheet)}><Plus size={14} />New sheet</button><button className={styles.quiet} disabled={busy} onClick={() => guarded(() => void refresh())}><RefreshCw size={13} />Reload</button></div>
      <div className={styles.toolbar}><label className={styles.field}>1. Choose paper<select value={paperChosen ? document.paperId : ""} disabled={!canEdit || !!editing} onChange={event => { setPaperChosen(true); changeDocument({ ...document, paperId: event.target.value as SheetPaperId, orientation: event.target.value === "7x10" ? 90 : 0 }); }}><option value="" disabled>Choose paper size</option>{SHEET_PAPERS.map(paper => <option key={paper.id} value={paper.id}>{paper.name}</option>)}</select></label><button className={styles.secondary} disabled={!canEdit || !paperChosen || !!editing} onClick={() => changeDocument({ ...document, orientation: document.orientation === 0 ? 90 : 0 })}><RotateCw size={14} />Rotate paper</button><label className={styles.field}>Sheet name<input maxLength={100} value={name} disabled={!canEdit} onChange={event => setName(event.target.value)} /></label><div className={styles.toolbarActions}><span className={styles.savedState}>{dirty ? "Unsaved changes" : saved ? `Saved · ${date(saved.updatedAt)}` : "New private sheet"}</span><button className={styles.primary} disabled={!canEdit || !paperChosen || !geometry || !name.trim() || !!editing || !dirty} onClick={save}><Save size={14} />Save sheet</button></div></div>
      <div className={styles.builder}><aside className={styles.rail} aria-label="Print layouts"><h2>2. Choose layout</h2><div className={styles.templateList}>{SHEET_TEMPLATES.map(template => { const fits = paperChosen && sheetFits(document, template.id); return <button key={template.id} className={styles.template} aria-pressed={document.templateId === template.id && paperChosen} disabled={!canEdit || !fits || !!editing} title={fits ? template.name : "Choose paper large enough for these fixed print sizes"} onClick={() => chooseTemplate(template.id)}><span className={styles.miniSheet} style={{ aspectRatio: `${template.widthInches} / ${template.heightInches}` }}>{template.cells.map(value => <span key={value.id} className={styles.miniCell} style={sheetCellPosition(value, template)}><ImagePlus size={13} aria-hidden="true" /></span>)}</span><strong>{template.name}</strong><small>{fits ? `${template.cells.length} ${template.cells.length === 1 ? "print" : "prints"}` : "Needs larger paper"}</small></button>; })}</div></aside>
      <section className={styles.canvasPanel}><header className={styles.canvasHeading}><div><h2>{geometry ? `${geometry.widthInches} × ${geometry.heightInches} inch paper` : paperChosen ? "Choose a layout that fits this paper" : "Start with your paper size"}</h2><p className={styles.hint}>{paperChosen ? "Print sizes stay fixed. Extra paper remains blank." : "Paper size is your first choice. Then pick a layout on the left."}</p></div>{geometry && <span className={styles.badge}>{geometry.cells.length} {geometry.cells.length === 1 ? "print" : "prints"}</span>}</header>
        <div className={styles.paperArea}>{geometry ? <div ref={paperRef} className={styles.paper} aria-label={`${geometry.widthInches} by ${geometry.heightInches} inch paper preview`} style={{ aspectRatio: `${geometry.widthInches} / ${geometry.heightInches}`, width: `min(100%, ${Math.min(720, 360 * geometry.widthInches / geometry.heightInches)}px)` }}>{geometry.cells.map(print => {
          const selected = print.id === selectedCell, assigned = document.cells.find(value => value.id === print.id), photo = workspace.sources.find(value => value.id === assigned?.assetId), crop = assigned?.crop, url = photo ? previews[photo.id] : "", edit = editing?.cellId === print.id ? editing : null;
          return <div key={print.id} data-sheet-cell={print.id} data-drop-hover={hoverCell === print.id} role="button" tabIndex={canEdit ? 0 : -1} aria-pressed={selected} aria-label={`Select ${print.label}${photo ? `: ${photo.filename}` : ": empty"}`} className={styles.cell} style={sheetCellPosition(print, geometry)} onClick={() => { if (!editing) setSelectedCell(print.id); }} onKeyDown={event => { if (["Enter", " "].includes(event.key) && !editing) { event.preventDefault(); setSelectedCell(print.id); } }} onDragOver={event => { if (canEdit && !editing) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={event => { event.preventDefault(); if (!editing) assignPhoto(event.dataTransfer.getData("application/x-studio-os-sheet-photo"), print.id); }}>
            {photo && url ? edit ? <SheetCropFrame key={`${photo.id}:${print.id}`} url={url} width={photo.widthPixels} height={photo.heightPixels} crop={edit.crop} fit={sheetCropFit(photo.widthPixels, photo.heightPixels, print.widthInches, print.heightInches)} label={print.label} disabled={busy || !edit.ready} onChange={rect => setEditing(current => current ? { ...current, crop: sheetCropSnap(rect, photo.widthPixels, photo.heightPixels), reviewed: false } : current)} onReady={value => setEditing(current => current?.cellId === print.id && current.ready !== value ? { ...current, ready: value, reviewed: false } : current)} /> : <SheetCellPhoto source={photo} url={url} crop={crop || null} cell={print} /> : <span className={styles.emptyCell}><ImagePlus size={24} /><span>Drop photo here<br />{print.label}</span></span>}{!edit && <span className={styles.cellBadge}>{print.label}{photo && !crop ? " · Review crop" : crop ? " ✓" : ""}</span>}
          </div>;
        })}</div> : <div className={styles.empty} style={{ width: "100%", background: "transparent", border: 0 }}><ImagePlus size={32} /><p>{paperChosen ? "This layout is too large for the chosen paper. Choose another layout or rotate the paper. Print sizes are never reduced to fit." : "Choose your paper size above to begin."}</p></div>}<p className={styles.hint}>Screen preview · Actual paper proportions</p></div>
        {geometry && <div className={styles.cellTools}><div><h3>{cell?.label || "Select a print"}</h3><p className={styles.hint}>{source ? source.filename : "Select a print above, then drag or tap a photo below."}</p></div><div className={styles.actions}><button className={styles.secondary} disabled={!canEdit || !source || !previews[source.id] || !!editing} onClick={beginCrop}><Crop size={14} />{choice?.crop ? "Move / resize photo" : "Adjust crop"}</button>{source && <button className={styles.quiet} disabled={!canEdit || !!editing} onClick={() => changeDocument({ ...document, cells: document.cells.map(value => value.id === selectedCell ? { ...value, assetId: null, crop: null } : value) })}>Remove photo</button>}</div></div>}
        {editing && source && cell && <div className={styles.cropArea}><SheetCropEditor key={`${editing.cellId}:${source.id}`} crop={editing.crop} fit={sheetCropFit(source.widthPixels, source.heightPixels, cell.widthInches, cell.heightInches)} sourceWidth={source.widthPixels} sourceHeight={source.heightPixels} targetWidth={cell.widthInches} targetHeight={cell.heightInches} label={cell.label} ready={editing.ready} reviewed={editing.reviewed} busy={busy} onReview={reviewed => setEditing(current => current ? { ...current, reviewed } : current)} onChange={rect => setEditing(current => current ? { ...current, crop: sheetCropSnap(rect, source.widthPixels, source.heightPixels), reviewed: false } : current)} onSave={keepCrop} onCancel={() => setEditing(null)} /></div>}
        <section className={styles.photoSection} data-dropzone={audience === "studio" && !jobId} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = canEdit && !jobId && audience === "studio" ? "copy" : "none"; } }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); event.stopPropagation(); if (jobId || audience !== "studio") { setError("Use only the photos assigned to this job."); return; } if (event.dataTransfer.files.length !== 1) { setError("Drop one JPEG or PNG at a time, up to 4 MB."); return; } void upload(event.dataTransfer.files[0]); }}><div className={styles.photoHeading}><div><h2>3. Add your photos</h2><p className={styles.hint}>Drag a photo onto a print. Or select a print and tap its photo here.{audience === "studio" && !jobId && " Drop one JPEG or PNG here to add a photo."}</p></div>{audience === "studio" && !jobId && <><input ref={uploadInput} type="file" accept="image/jpeg,image/png" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /><button className={styles.secondary} disabled={!canEdit || !!editing} onClick={() => uploadInput.current?.click()}><ImagePlus size={13} />Upload photo</button></>}</div><div className={styles.photos}>{workspace.sources.map(photo => <SheetPhotoThumbnail key={photo.id} assetId={photo.id} filename={photo.filename} width={photo.widthPixels} height={photo.heightPixels} url={previews[photo.id]} selected={choice?.assetId === photo.id} disabled={!canEdit || !geometry || !previews[photo.id] || !!editing} onAssign={cellId => assignPhoto(photo.id, cellId)} onHoverCell={setHoverCell} targetAtPoint={(x, y) => !canEdit || editing || !geometry ? null : sheetPhotoDropTarget(window.document.elementFromPoint(x, y), paperRef.current, geometry.cells.map(value => value.id))}><SheetSourcePreview source={photo} path={path({ file: "preview", assetId: photo.id })} userId={userId} onReady={url => setPreviews(current => current[photo.id] === url ? current : { ...current, [photo.id]: url })} onClear={clearPreview} /></SheetPhotoThumbnail>)}</div>{!workspace.sources.length && <p className={styles.hint}>{jobId ? "This job has no available photo sources." : "Upload a photo to start your sheet."}</p>}{!jobId && workspace.sources.length > 0 && <p className={styles.hint}>Recent photos · Photos used by this saved sheet remain available.</p>}</section>
      </section></div>
      <section className={styles.export}><div><h2>Review your test JPEG</h2><p className={styles.hint}>Save all crops, generate the sheet, then review the actual JPEG before downloading.</p></div><div className={styles.actions}><button className={styles.primary} disabled={!canEdit || !saved || dirty || !ready || !!editing} onClick={() => saved && void mutate({ action: "render", draftId: saved.id, expectedVersion: saved.version, requestId: crypto.randomUUID() })}>{busy ? <Loader2 className={styles.spin} size={14} /> : <ImagePlus size={14} />}Generate test JPEG</button><button className={styles.secondary} disabled={busy || dirty || !!editing || !saved?.render?.reviewedAt} onClick={() => void download("jpeg")}><Download size={14} />Download test JPEG</button></div>{!ready && <p className={styles.hint}>Every print needs a photo and a reviewed crop before generation.</p>}
        {saved?.render && !dirty && proof?.renderId === saved.render.id && <div className={styles.proof}><Image key={saved.render.id} unoptimized src={proof.url} width={saved.render.widthPixels} height={saved.render.heightPixels} alt="Actual generated test sheet JPEG for review" onLoad={() => { if (proof.renderId === saved.render?.id) setProofReady(true); }} onError={() => setProofReady(false)} /><div><p className={styles.hint}>{saved.render.widthPixels} × {saved.render.heightPixels} pixels · {saved.render.reviewedAt ? "Reviewed" : "Needs your review"}</p>{!saved.render.reviewedAt && <><label className={styles.proofCheck}><input type="checkbox" checked={proofReviewed} disabled={!proofReady || busy} onChange={event => setProofReviewed(event.target.checked)} /><span>I reviewed the photos, crops and blank paper in this generated sheet.</span></label><button className={styles.primary} disabled={!canEdit || !proofReady || !proofReviewed || proof.renderId !== saved.render?.id} onClick={() => saved.render && void mutate({ action: "review", draftId: saved.id, expectedVersion: saved.version, renderId: saved.render.id, sha256: saved.render.sha256 })}><Check size={14} />Approve this test JPEG</button></>}</div></div>}
      </section>
      <details className={styles.advanced}><summary>Sheet details</summary><dl><dt>Paper</dt><dd>{geometry ? `${geometry.widthInches} × ${geometry.heightInches} inches` : "Choose paper"}</dd><dt>Export</dt><dd>300 pixels per inch · JPEG · sRGB · White blank paper</dd><dt>Print positions</dt><dd>Fixed finished sizes, centered on the paper. Dragging moves the photo inside its print.</dd><dt>Copies</dt><dd>{document.copies} complete {document.copies === 1 ? "sheet" : "sheets"}; downloading does not print.</dd>{saved?.render && <><dt>File checksum</dt><dd>{saved.render.sha256}</dd><dt>Manifest</dt><dd><button className={styles.quiet} disabled={!saved.render.reviewedAt || dirty || busy} onClick={() => void download("manifest")}>Download test manifest</button></dd></>}</dl></details>
    </>}
    {confirm && <div className={styles.dialogBackdrop}><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="sheet-confirm-title"><h2 id="sheet-confirm-title">Keep your current sheet?</h2><p>{confirm.message}</p><div className={styles.actions}><button className={styles.secondary} onClick={() => setConfirm(null)}>Keep editing</button><button className={styles.primary} onClick={() => { confirm.run(); setConfirm(null); }}>Continue</button></div></section></div>}
  </main></div>;
}

function SheetSourcePreview({ source, path, userId, onReady, onClear }: { source: SheetSource; path: string; userId: string; onReady: (url: string) => void; onClear: (id: string, url: string) => void }) {
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); let objectUrl = ""; productionPrivateBlob(path, userId, controller.signal).then(blob => { if (controller.signal.aborted) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Preview unavailable"); }); return () => { controller.abort(); if (objectUrl) { URL.revokeObjectURL(objectUrl); onClear(source.id, objectUrl); } }; }, [path, userId, onClear, source.id]);
  return url ? <Image unoptimized draggable={false} src={url} width={source.widthPixels} height={source.heightPixels} alt={source.filename} onLoad={() => onReady(url)} /> : <span>{error || "Loading photo…"}</span>;
}
function SheetCellPhoto({ source, url, crop, cell }: { source: SheetSource; url: string; crop: ProductionCrop | null; cell: SheetCellGeometry }) {
  const rect = crop ? { x: crop.x / source.widthPixels, y: crop.y / source.heightPixels, width: crop.width / source.widthPixels, height: crop.height / source.heightPixels } : sheetCropFit(source.widthPixels, source.heightPixels, cell.widthInches, cell.heightInches);
  const turn = crop && [90,270].includes(crop.rotation), width = turn ? cell.heightInches / cell.widthInches * 100 : 100, height = turn ? cell.widthInches / cell.heightInches * 100 : 100;
  return <span style={{ position: "absolute", overflow: "hidden", width: `${width}%`, height: `${height}%`, left: `${(100-width)/2}%`, top: `${(100-height)/2}%`, transform: crop?.rotation ? `rotate(${crop.rotation}deg)` : undefined }}><Image unoptimized draggable={false} src={url} width={source.widthPixels} height={source.heightPixels} alt={source.filename} style={sheetCropImageStyle(rect)} /></span>;
}


export function sheetPhotoDragMoved(startX: number, startY: number, x: number, y: number): boolean { return [startX, startY, x, y].every(Number.isFinite) && Math.hypot(x - startX, y - startY) >= 6; }
export function sheetPhotoDropTarget(element: Element | null, paper: HTMLElement | null, allowedCellIds: string[]): string | null {
  const target = element?.closest("[data-sheet-cell]"), id = target?.getAttribute("data-sheet-cell");
  return target && paper?.contains(target) && id && allowedCellIds.includes(id) ? id : null;
}

export function SheetPhotoThumbnail({ assetId, filename, width, height, url, selected, disabled, onAssign, onHoverCell, targetAtPoint, children }: { assetId: string; filename: string; width: number; height: number; url?: string; selected: boolean; disabled: boolean; onAssign: (cellId?: string) => void; onHoverCell: (cellId: string | null) => void; targetAtPoint: (x: number, y: number) => string | null; children: ReactNode }) {
  const drag = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null), skipClick = useRef(false);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  function cancel(event?: PointerEvent<HTMLButtonElement>) { const current = drag.current; if (event && (!current || current.pointerId !== event.pointerId)) return; if (current?.moved) skipClick.current = true; drag.current = null; setGhost(null); onHoverCell(null); }
  function start(event: PointerEvent<HTMLButtonElement>) {
    if (disabled || !url || event.button !== 0 || drag.current) return;
    skipClick.current = false; drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
    if (disabled) { cancel(); return; }
    current.moved = current.moved || sheetPhotoDragMoved(current.x, current.y, event.clientX, event.clientY);
    if (!current.moved) return;
    event.preventDefault(); setGhost({ x: event.clientX, y: event.clientY }); onHoverCell(targetAtPoint(event.clientX, event.clientY));
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
    const moved = current.moved || sheetPhotoDragMoved(current.x, current.y, event.clientX, event.clientY), target = !disabled && moved ? targetAtPoint(event.clientX, event.clientY) : null;
    drag.current = null; setGhost(null); onHoverCell(null);
    if (moved) { skipClick.current = true; event.preventDefault(); event.stopPropagation(); if (target) onAssign(target); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <><button className={styles.photo} data-sheet-photo={assetId} draggable={false} aria-pressed={selected} disabled={disabled} onDragStart={event => event.preventDefault()} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onClick={event => { if (skipClick.current && event.detail !== 0) { skipClick.current = false; event.preventDefault(); event.stopPropagation(); return; } skipClick.current = false; if (!disabled) onAssign(); }}><span className={styles.photoPreview}>{children}</span><span>{filename}</span><small>{width} × {height} px</small></button>{ghost && url && <div className={styles.dragGhost} style={{ left: `clamp(8px, ${ghost.x + 16}px, calc(100vw - 112px))`, top: `clamp(8px, ${ghost.y + 16}px, calc(100vh - 150px))` }} aria-hidden="true"><Image unoptimized draggable={false} src={url} width={width} height={height} alt="" /><span>{filename}</span></div>}</>;
}
