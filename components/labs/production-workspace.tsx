"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Crop, Download, ImageIcon, Inbox, Loader2, LockKeyhole, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/labs/money";
import type { ProductionAsset, ProductionCrop, ProductionGallery, ProductionJob, ProductionOwnerAction, ProductionPolicy, ProductionSize, ProductionWorkspace as Workspace } from "@/lib/labs/production-types";
import { ProductionCropEditor, type ProductionCropRect } from "./production-crop-editor";
import { productionGalleryPath, productionPrivateBlob, productionRequest, productionSessionRead, productionSessionWrite, productionToken } from "./production-client";
import { productionEventLabel, productionHoldLabel } from "./production-labels";
import styles from "./production.module.css";

const statuses = { submitted: "Submitted", accepted: "Accepted", in_production: "In production", ready: "Ready", completed: "Completed" };
const defaults: ProductionPolicy = { autoApprove: false, cropResponsibility: "photographer", labColourCorrection: false };
type Pending = { action: ProductionOwnerAction; token?: string };
type CropSelection = { jobId: string; size: ProductionSize; url: string };
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const normalizedSize = (value: string) => value.toLowerCase().replace(/[\s″"']/g, "").replace(/×/g, "x");

export function productionCropPixels(rect: ProductionCropRect, width: number, height: number): ProductionCrop {
  const x = Math.round(rect.x * width), y = Math.round(rect.y * height);
  return { x, y, width: Math.min(width - x, Math.round(rect.width * width)), height: Math.min(height - y, Math.round(rect.height * height)), rotation: 0 };
}
export function productionOriginalEligible(asset: Pick<ProductionAsset, "widthPixels" | "heightPixels">): boolean { return asset.widthPixels >= 1600 && asset.heightPixels >= 2000; }
export function productionVisibleOriginals(assets: ProductionAsset[], selectedIds: string[], limit = 20): ProductionAsset[] {
  const selected = new Set(selectedIds);
  return assets.filter(asset => asset.kind === "original").filter((asset, index) => index < limit || selected.has(asset.id));
}

export function ProductionWorkspace({ audience }: { audience: "studio" | "lab" }) {
  const endpoint = audience === "lab" ? "/api/lab/production" : "/api/dashboard/lab-production";
  const [workspace, setWorkspace] = useState<Workspace | null>(null), [userId, setUserId] = useState("");
  const activeUser = useRef("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"galleries" | "jobs">(audience === "lab" ? "jobs" : "galleries");
  const [policy, setPolicy] = useState<ProductionPolicy>(defaults), [sheetId, setSheetId] = useState(""), [entryId, setEntryId] = useState("");
  const [name, setName] = useState("Private production gallery"), [assetIds, setAssetIds] = useState<string[]>([]), [targetLabId, setTargetLabId] = useState("");
  const [originalLimit, setOriginalLimit] = useState(20);
  const [links, setLinks] = useState<Record<string, string>>({}), [pending, setPending] = useState<Pending | null>(null), [selectedId, setSelectedId] = useState("");
  const [crop, setCrop] = useState<CropSelection | null>(null), [fileBusy, setFileBusy] = useState("");
  const key = `studio-os-production:${userId}:${audience}`;
  const adopt = useCallback((next: Workspace) => {
    setWorkspace(next); setPolicy(next.policy.policy);
    setSheetId(current => next.sheets.some(sheet => sheet.id === current) ? current : next.sheets[0]?.id ?? "");
    setSelectedId(current => next.jobs.some(job => job.id === current) ? current : next.jobs[0]?.id ?? "");
  }, []);
  useEffect(() => {
    const controller = new AbortController(), client = createClient();
    client.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) throw new Error("Sign in to open private production.");
      activeUser.current = session.user.id;
      const result = await productionRequest(endpoint, undefined, session.user.id, controller.signal);
      if (controller.signal.aborted || activeUser.current !== session.user.id) return;
      if (!result.workspace) throw new Error("The production workspace was not returned.");
      setUserId(session.user.id); adopt(result.workspace);
      const savedKey = `studio-os-production:${session.user.id}:${audience}`;
      setLinks(productionSessionRead<Record<string, string>>(`${savedKey}:links`) ?? {});
      setPending(productionSessionRead<Pending>(`${savedKey}:pending`));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Private production could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN" && activeUser.current && session?.user.id !== activeUser.current) { controller.abort(); activeUser.current = ""; setWorkspace(null); setUserId(""); setLinks({}); setPending(null); setLoading(false); setError("The signed-in account changed. Reopen your private production workspace."); }
    });
    return () => { controller.abort(); subscription.unsubscribe(); };
  }, [adopt, audience, endpoint]);
  useEffect(() => () => { if (crop) URL.revokeObjectURL(crop.url); }, [crop]);
  const sheet = workspace?.sheets.find(value => value.id === sheetId), offer = sheet?.offers.find(value => value.id === entryId) ?? sheet?.offers[0];
  const policyDirty = !!workspace && JSON.stringify(policy) !== JSON.stringify(workspace.policy.policy);
  const selected = workspace?.jobs.find(job => job.id === selectedId);
  const originalCount = workspace?.assets.filter(asset => asset.kind === "original").length ?? 0;
  const visibleOriginals = productionVisibleOriginals(workspace?.assets ?? [], assetIds, originalLimit);
  const chosenLabProducts = workspace?.catalog.filter(product => product.labId === targetLabId) ?? [];
  const product8 = chosenLabProducts.find(product => normalizedSize(product.size) === "8x10"), product5 = chosenLabProducts.find(product => normalizedSize(product.size) === "5x7");
  const canCreate = !!sheet && !!offer && !!name.trim() && assetIds.length > 0 && assetIds.length <= 20 && assetIds.every(id => { const asset = workspace?.assets.find(value => value.id === id); return !!asset && productionOriginalEligible(asset); }) && !policyDirty && (!targetLabId || !!product8 && !!product5);

  async function refresh() {
    if (busy) return; setBusy(true); setError("");
    try { const result = await productionRequest(endpoint, undefined, userId); if (!result.workspace || activeUser.current !== userId) throw new Error("Reopen this workspace after signing in."); adopt(result.workspace); setNotice("Latest production checks and order history loaded."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The workspace could not be refreshed."); }
    finally { setBusy(false); }
  }
  async function mutate(attempt: Pending): Promise<boolean> {
    if (busy || !userId) return false;
    try { productionSessionWrite(`${key}:pending`, attempt); setPending(attempt); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The request could not be retained."); return false; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await productionRequest(endpoint, attempt.action, userId);
      if (!result.workspace || activeUser.current !== userId) throw new Error("The saved result could not be confirmed. Retry the same request.");
      adopt(result.workspace);
      if (result.gallery && attempt.token) { const saved = { ...links, [result.gallery.id]: attempt.token }; productionSessionWrite(`${key}:links`, saved); setLinks(saved); }
      if (result.job) setSelectedId(result.job.id);
      if (attempt.action.action === "save_crop") setCrop(null);
      sessionStorage.removeItem(`${key}:pending`); setPending(null);
      setNotice(attempt.action.action === "save_policy" ? "Production preferences saved for future galleries. Existing jobs keep their saved instructions." : attempt.action.action === "save_crop" ? "The cropped print file was generated and confirmed. Review its saved preview before approving it." : "Your production update is saved. Required checks remain independent.");
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The result could not be confirmed. Retry the same request."); return false; }
    finally { setBusy(false); }
  }
  async function uploadOriginal(file: File) {
    if (busy || pending || policyDirty) return;
    if (file.size > 4_000_000 || !["image/jpeg", "image/png"].includes(file.type)) { setError("Choose a JPEG or PNG up to 4 MB. Your original is kept privately."); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("kind", "original"); form.append("file", file);
      const result = await productionRequest("/api/dashboard/lab-production-assets", form, userId);
      if (!result.asset || activeUser.current !== userId) throw new Error("The original upload could not be confirmed.");
      setWorkspace(current => current ? { ...current, assets: [result.asset!, ...current.assets.filter(asset => asset.id !== result.asset!.id)] } : current);
      setAssetIds(current => [...current.filter(id => id !== result.asset!.id), ...(productionOriginalEligible(result.asset!) ? [result.asset!.id] : [])].slice(0, 20));
      setNotice(productionOriginalEligible(result.asset) ? "Original uploaded privately. No crop or colour change has been approved." : "This original was uploaded privately, but is too small for this print package. Choose at least 1600 × 2000 upright pixels before creating a gallery.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The original could not be uploaded."); }
    finally { setBusy(false); }
  }
  function createGallery() {
    if (!canCreate || !sheet || !offer) return;
    const token = productionToken();
    void mutate({ token, action: { action: "create_gallery", requestId: crypto.randomUUID(), sheetId: sheet.id, expectedSheetVersion: sheet.version, entryId: offer.id, name: name.trim(), assetIds, accessToken: token, target: targetLabId ? { kind: "partner_lab", labId: targetLabId, product8x10Id: product8!.id, product5x7Id: product5!.id } : { kind: "in_house" } } });
  }
  function openGallery(gallery: ProductionGallery) {
    try { window.open(productionGalleryPath(gallery.id, links[gallery.id]), "_blank", "noopener,noreferrer"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Generate a private link first."); }
  }
  async function startCrop(job: ProductionJob, size: ProductionSize) {
    setFileBusy(`crop:${size}`); setError("");
    try { const blob = await productionPrivateBlob(`/api/dashboard/lab-production-assets?assetId=${encodeURIComponent(job.source.id)}&preview=1&audience=${audience}`, userId); if (activeUser.current !== userId) throw new Error("Reopen this workspace after signing in."); setCrop({ jobId: job.id, size, url: URL.createObjectURL(blob) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The original preview could not be opened."); }
    finally { setFileBusy(""); }
  }
  async function saveCrop(rect: ProductionCropRect) {
    if (!crop || !selected || selected.id !== crop.jobId) return;
    if (await mutate({ action: { action: "save_crop", jobId: selected.id, expectedVersion: selected.version, requestId: crypto.randomUUID(), productSize: crop.size, rect: productionCropPixels(rect, selected.source.widthPixels, selected.source.heightPixels) } })) setCrop(null);
  }
  async function corrected(job: ProductionJob, size: ProductionSize, file: File) {
    const line = job.lines.find(value => value.size === size); if (!line?.cropAsset) return;
    if (file.size > 4_000_000 || !["image/jpeg", "image/png"].includes(file.type)) { setError("Choose a corrected JPEG or PNG up to 4 MB with the same pixels as its cropped print file."); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("kind", "corrected"); form.append("file", file); form.append("jobId", job.id); form.append("productSize", size); form.append("sourceAssetId", line.cropAsset.id); form.append("audience", audience);
      const result = await productionRequest("/api/dashboard/lab-production-assets", form, userId);
      if (!result.asset || activeUser.current !== userId) throw new Error("The corrected file could not be confirmed.");
      const attempt: Pending = { action: { action: "complete_colour", jobId: job.id, expectedVersion: job.version, requestId: crypto.randomUUID(), size, assetId: result.asset.id, reviewNoChange: false } };
      productionSessionWrite(`${key}:pending`, attempt); setPending(attempt);
      const saved = await productionRequest(endpoint, attempt.action, userId);
      if (!saved.workspace || activeUser.current !== userId) throw new Error("The colour review could not be confirmed. Retry the retained request.");
      adopt(saved.workspace); sessionStorage.removeItem(`${key}:pending`); setPending(null); setNotice("The lab’s corrected file and review are saved. Final file review is still required.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The corrected file could not be saved."); }
    finally { setBusy(false); }
  }
  async function download(jobId: string, file: "manifest" | "8x10" | "10x7") {
    setFileBusy(file); setError("");
    try { const blob = await productionPrivateBlob(`/api/dashboard/lab-production-files?jobId=${encodeURIComponent(jobId)}&file=${file}&audience=${audience}`, userId); if (activeUser.current !== userId) throw new Error("Reopen this workspace after signing in."); const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = file === "manifest" ? `${jobId}.json` : `${file}.jpg`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This production download is not ready."); }
    finally { setFileBusy(""); }
  }
  async function downloadAsset(asset: ProductionAsset) {
    setFileBusy(asset.id); setError("");
    try { const blob = await productionPrivateBlob(`/api/dashboard/lab-production-assets?assetId=${encodeURIComponent(asset.id)}&audience=${audience}`, userId); if (activeUser.current !== userId) throw new Error("Reopen this workspace after signing in."); const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = asset.filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The cropped print file could not be downloaded."); }
    finally { setFileBusy(""); }
  }
  return <div className={styles.shell}><main className={styles.page}>
    <nav className={styles.nav}><Link href={audience === "lab" ? "/lab" : "/dashboard/labs"}><ArrowLeft size={14} />{audience === "lab" ? "Existing lab orders" : "Labs & price sheets"}</Link><Link href={audience === "lab" ? "/dashboard/labs/production" : "/lab/production"}>{audience === "lab" ? "Photographer production" : "Lab production receiving"}</Link></nav>
    <header className={styles.header}><div><div className={styles.eyebrow}>PRIVATE PHOTO PRODUCTION PILOT</div><h1>{audience === "lab" ? "Lab production receiving" : "From original photo to reviewed print files"}</h1><p>Keep order approval, cropping, colour correction and final file review separate. Each generated file stays linked to its preserved original.</p></div><span className={styles.badge}><LockKeyhole size={13} />Private pilot</span></header>
    <div className={styles.boundary}><ShieldCheck size={15} style={{ display: "inline", verticalAlign: "middle", marginRight: 7 }} />Test order · No payment collected · Physical printing disabled. GTA remains on hold. Current schools, prices and existing order workflows stay unchanged.</div>
    {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
    {pending && !busy && <div className={styles.notice}><strong>An update needs confirmation.</strong> Its original request is retained.<div className={styles.actions}><button className={styles.primary} onClick={() => void mutate(pending)}>Retry same update</button><button className={styles.secondary} onClick={() => void refresh()}>Refresh & review</button><button className={styles.quiet} onClick={() => { sessionStorage.removeItem(`${key}:pending`); setPending(null); }}>Dismiss pending retry</button></div></div>}
    {loading ? <section className={styles.empty}><Loader2 className={styles.spin} size={27} /><h2>Opening private production</h2></section> : !workspace ? <section className={`${styles.panel} ${styles.empty}`}><Inbox size={28} /><h2>Sign in to your connected account</h2><p>Only the studio and assigned lab can review their production jobs.</p><Link className={styles.primary} href={`/sign-in?redirect=${encodeURIComponent(audience === "lab" ? "/lab/production" : "/dashboard/labs/production")}`}>Sign in</Link></section> : <>
      <div className={styles.tabs} role="tablist" aria-label="Production views">{audience === "studio" && <button role="tab" aria-selected={tab === "galleries"} onClick={() => setTab("galleries")}>Galleries & preferences</button>}<button role="tab" aria-selected={tab === "jobs"} onClick={() => setTab("jobs")}>{audience === "lab" ? "Receiving queue" : "Orders & production checks"}</button><button className={styles.quiet} disabled={busy} onClick={() => void refresh()}><RefreshCw size={13} />Refresh</button></div>
      {tab === "galleries" && audience === "studio" ? <div className={styles.grid}><section className={`${styles.panel} ${styles.form}`}><h2>1. Choose production preferences</h2><p className={styles.muted}>Saved preferences apply to future galleries. Existing galleries and orders keep their instructions.</p><fieldset disabled={busy || !!pending} className={styles.policy}><label className={styles.check}><input type="checkbox" checked={policy.autoApprove} onChange={event => setPolicy(value => ({ ...value, autoApprove: event.target.checked }))} /><span>Automatically approve new photographer orders</span></label><p className={styles.muted}>Off means review each order. Automatic approval releases photographer review only; it does not accept the order for the lab or complete any production work.</p><label>Who approves the print crops?<select value={policy.cropResponsibility} onChange={event => setPolicy(value => ({ ...value, cropResponsibility: event.target.value as ProductionPolicy["cropResponsibility"] }))}><option value="photographer">I review and approve each crop</option><option value="lab">Ask the lab to crop and approve each size</option></select></label><label className={styles.check}><input type="checkbox" checked={policy.labColourCorrection} onChange={event => setPolicy(value => ({ ...value, labColourCorrection: event.target.checked }))} /><span>Request lab colour correction</span></label><p className={styles.muted}>A person at the lab reviews colour. No paid AI service is used.</p><button className={styles.secondary} disabled={!policyDirty} onClick={() => void mutate({ action: { action: "save_policy", expectedVersion: workspace.policy.version, policy } })}>Save production preferences</button></fieldset>
        <h2>2. Add original photos</h2><p className={styles.muted}>Private JPEG or PNG, up to 4 MB each. This package needs at least 1600 × 2000 upright pixels. Select up to 20 eligible photos after upload.</p>{policyDirty && <p className={styles.notice}>Save preferences before uploading originals or creating a gallery.</p>}<label style={{ marginTop: 13 }}>Upload one original<input type="file" accept="image/jpeg,image/png" disabled={busy || !!pending || policyDirty} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadOriginal(file); }} /></label>
        <div className={styles.photos}>{visibleOriginals.map(asset => <label key={asset.id} className={styles.photo} data-selected={assetIds.includes(asset.id)}><ProductionAssetImage asset={asset} userId={userId} audience={audience} /><span><input type="checkbox" checked={assetIds.includes(asset.id)} disabled={busy || !!pending || !productionOriginalEligible(asset) || assetIds.length >= 20 && !assetIds.includes(asset.id)} onChange={event => setAssetIds(current => event.target.checked ? [...current, asset.id] : current.filter(id => id !== asset.id))} />{asset.filename}</span><p className={styles.muted}>{asset.widthPixels} × {asset.heightPixels} px{!productionOriginalEligible(asset) && " · Too small for this package"}</p></label>)}</div>
        {originalCount > 0 && <p className={styles.muted}>Showing {visibleOriginals.length} of {originalCount} private originals · {assetIds.length} selected</p>}
        {visibleOriginals.length < originalCount && <button type="button" className={styles.secondary} style={{ margin: "12px 0 20px" }} onClick={() => setOriginalLimit(current => Math.min(current + 20, originalCount))}>Load 20 more originals</button>}
        <h2>3. Create the private gallery</h2><fieldset disabled={busy || !!pending || policyDirty}><label>Copied price sheet<select value={sheet?.id ?? ""} onChange={event => { setSheetId(event.target.value); setEntryId(""); }}>{workspace.sheets.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><label>Print package<select value={offer?.id ?? ""} onChange={event => setEntryId(event.target.value)}>{sheet?.offers.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>{offer && sheet && <div className={styles.offer}><h3>{offer.name}</h3><ul className={styles.contents}>{offer.contents.map((content, index) => <li key={index}>{content.qty} × {content.name}</li>)}</ul><strong className={styles.price}>{formatCurrency(offer.retailCents, sheet.currency)}</strong></div>}<label>Fulfillment<select value={targetLabId} onChange={event => setTargetLabId(event.target.value)}><option value="">My own studio · In-house</option>{workspace.labs.map(lab => <option key={lab.id} value={lab.id}>{lab.name}</option>)}</select></label>{targetLabId && <p className={styles.muted}>{product8 && product5 ? "Approved lab products: one 8×10 and two 5×7 prints." : "This lab needs approved 8×10 and 5×7 products before this gallery can be created."}</p>}<label>Gallery name<input maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label><button className={styles.primary} disabled={!canCreate} onClick={createGallery}><Plus size={15} />Create private production gallery</button></fieldset>
      </section><section className={styles.panel}><div className={styles.sectionHead}><div><h2>Private production galleries</h2><p>Open the parent view to choose a photo and place a test order.</p></div></div>{workspace.galleries.length ? <div className={styles.galleryList}>{workspace.galleries.map(gallery => <article key={gallery.id} className={styles.card}><header><h3>{gallery.name}</h3><span className={styles.badge}>{gallery.revokedAt ? "Closed" : "Private"}</span></header><p>{gallery.targetLabel} · {gallery.photos.length} photos</p><p>{gallery.offer.name} · {formatCurrency(gallery.offer.retailCents, gallery.currency)}</p><p className={styles.muted}>Order approval: {gallery.policy.autoApprove ? "Automatic" : "Manual"} · Crop: {gallery.policy.cropResponsibility} · Lab colour: {gallery.policy.labColourCorrection ? "Requested" : "Off"}</p><p className={styles.muted}>Expires {date(gallery.expiresAt)}</p>{!gallery.revokedAt && <div className={styles.actions}>{links[gallery.id] && <button className={styles.primary} disabled={busy || !!pending} onClick={() => openGallery(gallery)}>Open parent gallery</button>}<button className={styles.secondary} disabled={busy || !!pending} onClick={() => { const token = productionToken(); void mutate({ token, action: { action: "rotate_gallery", galleryId: gallery.id, expectedVersion: gallery.version, accessToken: token } }); }}>{links[gallery.id] ? "Replace private link" : "Generate private link"}</button><button className={styles.quiet} disabled={busy || !!pending} onClick={() => void mutate({ action: { action: "revoke_gallery", galleryId: gallery.id, expectedVersion: gallery.version } })}>Close gallery</button></div>}</article>)}</div> : <div className={styles.empty}><ImageIcon size={28} /><p>Create a private gallery with your own original photo to begin.</p></div>}</section></div> : <div className={styles.jobGrid}><section className={styles.jobList} aria-label="Production jobs">{workspace.jobs.length ? workspace.jobs.map(job => <button className={styles.jobButton} key={job.id} aria-pressed={job.id === selectedId} onClick={() => { setSelectedId(job.id); setCrop(null); }}><span className={styles.status}>{statuses[job.status]}</span><strong>{job.reference}</strong><p>{job.studioName} → {job.targetLabel}</p><footer><span>{job.holds.length} production holds</span><span>{job.amountKind === "wholesale" ? "Lab product cost" : "Retail subtotal"} · {formatCurrency(job.subtotalMinor, job.currency)}</span></footer></button>) : <div className={`${styles.panel} ${styles.empty}`}><Inbox size={28} /><h2>No production jobs yet</h2><p>New private gallery orders appear here. Existing direct lab orders remain in their original workspace.</p></div>}</section>{selected && <ProductionJobDetail key={selected.id} job={selected} audience={audience} userId={userId} busy={busy || !!pending} fileBusy={fileBusy} crop={crop} onAction={action => void mutate({ action })} onCrop={size => void startCrop(selected, size)} onSaveCrop={rect => void saveCrop(rect)} onCancelCrop={() => setCrop(null)} onCorrected={(size, file) => void corrected(selected, size, file)} onDownload={file => void download(selected.id, file)} onDownloadAsset={asset => void downloadAsset(asset)} />}</div>}
    </>}
  </main></div>;
}

function ProductionAssetImage({ asset, userId, audience, onReady }: { asset: ProductionAsset; userId: string; audience: "studio" | "lab"; onReady?: () => void }) {
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); let objectUrl = ""; productionPrivateBlob(`/api/dashboard/lab-production-assets?assetId=${encodeURIComponent(asset.id)}&preview=1&audience=${audience}`, userId, controller.signal).then(blob => { if (controller.signal.aborted) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Preview unavailable"); }); return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [asset.id, audience, userId]);
  return error ? <p className={styles.muted}>{error}</p> : url ? <Image unoptimized src={url} width={asset.widthPixels} height={asset.heightPixels} className={styles.linePreview} alt={asset.filename} onLoad={onReady} /> : <p className={styles.muted}>Loading private preview…</p>;
}

export function ProductionJobDetail({ job, audience, userId, busy, fileBusy, crop, onAction, onCrop, onSaveCrop, onCancelCrop, onCorrected, onDownload, onDownloadAsset }: { job: ProductionJob; audience: "studio" | "lab"; userId: string; busy: boolean; fileBusy: string; crop: CropSelection | null; onAction: (action: ProductionOwnerAction) => void; onCrop: (size: ProductionSize) => void; onSaveCrop: (rect: ProductionCropRect) => void; onCancelCrop: () => void; onCorrected: (size: ProductionSize, file: File) => void; onDownload: (file: "manifest" | "8x10" | "10x7") => void; onDownloadAsset: (asset: ProductionAsset) => void }) {
  const [seenAssets, setSeenAssets] = useState<string[]>([]);
  const recordPreview = (assetId: string) => setSeenAssets(current => current.includes(assetId) ? current : [...current, assetId]);
  const labWork = job.canReceive;
  const cropAllowed = job.canCrop;
  const base = () => ({ jobId: job.id, expectedVersion: job.version, requestId: crypto.randomUUID() });
  const next = job.status === "accepted" ? "in_production" : job.status === "in_production" ? "ready" : job.status === "ready" ? "completed" : null;
  return <article className={styles.panel}><header className={styles.detailHead}><div><div className={styles.eyebrow}>PRIVATE PRODUCTION JOB</div><h2>{job.reference}</h2><p>{job.studioName} → {job.targetLabel}</p><p>{date(job.createdAt)} · Version {job.version}</p></div><span className={styles.status}>{statuses[job.status]}</span></header><div className={styles.boundary}>Test order without payment · Physical printing disabled. Downloading final files does not send a printer job.</div><h3>{job.offer.name}</h3><p className={styles.muted}>{job.quantity} package sets · {job.amountKind === "wholesale" ? "Lab product cost" : "Retail subtotal"}: {formatCurrency(job.subtotalMinor, job.currency)}</p><div className={styles.checks}><div><strong>Photographer approval</strong><span>{job.photographerApproved ? job.policy.autoApprove ? "Automatically approved" : "Approved" : "Needs studio review"}</span></div><div><strong>Crop responsibility</strong><span>{job.policy.cropResponsibility === "photographer" ? "Photographer" : "Lab"} · {job.lines.filter(line => line.cropApproved).length}/{job.lines.length} sizes approved</span></div><div><strong>Lab colour</strong><span>{job.policy.labColourCorrection ? `${job.lines.filter(line => line.colourCompletedAt).length}/${job.lines.length} sizes reviewed` : "Not requested"}</span></div></div>{job.holds.length > 0 && <div className={styles.notice}><strong>Before production:</strong><ul className={styles.contents}>{job.holds.map(hold => <li key={hold}>{productionHoldLabel(hold)}</li>)}</ul></div>}
    <div className={styles.actions}>{job.canApproveOrder && !job.photographerApproved && <button className={styles.primary} disabled={busy} onClick={() => onAction({ ...base(), action: "approve_order" })}>Approve order for production review</button>}{labWork && job.status === "submitted" && <button className={styles.secondary} disabled={busy} onClick={() => onAction({ ...base(), action: "accept" })}>Accept job for review</button>}</div>
    <section className={styles.section}><h3>Preserved original</h3><ProductionAssetImage key={job.source.id} asset={job.source} audience={audience} userId={userId} /><p className={styles.muted}>{job.source.filename} · {job.source.widthPixels} × {job.source.heightPixels} pixels · SHA-256 {job.source.sha256.slice(0, 16)}…</p></section>
    <section className={styles.section}><h3>Print sizes and final files</h3>{job.lines.map(line => { const final = line.finalAsset ?? line.colourAsset ?? line.cropAsset; return <article key={line.size} className={styles.line}><div className={styles.lineTop}><div><h3>{line.size === "8x10" ? "8×10 print" : "5×7 print"} · {line.quantity} copies</h3><p>Crop: {line.cropApproved ? "Approved" : line.cropAsset ? "Generated · needs approval" : "Not saved"} · Final review: {line.finalReviewedAt ? "Complete" : "Pending"}</p></div></div>{final && <><ProductionAssetImage key={final.id} asset={final} audience={audience} userId={userId} onReady={() => recordPreview(final.id)} /><p className={styles.muted}>{final.widthPixels} × {final.heightPixels} px · SHA-256 {final.sha256.slice(0, 16)}…</p></>}
        {crop?.jobId === job.id && crop.size === line.size ? <ProductionCropEditor sourceUrl={crop.url} sourceWidth={job.source.widthPixels} sourceHeight={job.source.heightPixels} targetWidth={line.widthInches} targetHeight={line.heightInches} size={line.size} busy={busy} onSave={onSaveCrop} onCancel={onCancelCrop} /> : <div className={styles.actions}>{cropAllowed && ["submitted", "accepted"].includes(job.status) && <button className={styles.secondary} disabled={busy || !!fileBusy} onClick={() => onCrop(line.size)}><Crop size={14} />{line.cropAsset ? "Review / change crop" : `Crop for ${line.size}`}</button>}{cropAllowed && line.cropAsset && !line.cropApproved && <button className={styles.primary} disabled={busy || !seenAssets.includes(line.cropAsset.id)} onClick={() => onAction({ ...base(), action: "approve_crop", size: line.size, assetId: line.cropAsset!.id })}>Approve saved crop</button>}</div>}
        {labWork && job.status === "accepted" && job.policy.labColourCorrection && line.cropApproved && !line.colourCompletedAt && <div className={`${styles.section} ${styles.form}`}><h3>Lab colour review</h3><p className={styles.muted}>Production files use sRGB; requested lab adjustments remain separate. Correct colour outside Studio OS, then upload the result with exactly {line.cropAsset?.widthPixels} × {line.cropAsset?.heightPixels} pixels. Keep the crop unchanged.</p><button className={styles.secondary} disabled={!!fileBusy} onClick={() => onDownloadAsset(line.cropAsset!)}><Download size={14} />Download cropped file for colour review</button><label style={{ marginTop: 12 }}>Upload colour-corrected print file<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onCorrected(line.size, file); }} /></label><ProductionNoChangeReview key={line.cropAsset!.id} busy={busy || !seenAssets.includes(line.cropAsset!.id)} onConfirm={() => onAction({ ...base(), action: "complete_colour", size: line.size, assetId: line.cropAsset!.id, reviewNoChange: true })} /></div>}
        {labWork && job.status === "accepted" && line.cropApproved && (!job.policy.labColourCorrection || !!line.colourCompletedAt) && !line.finalReviewedAt && final && <div className={styles.actions}><button className={styles.primary} disabled={busy || !seenAssets.includes(final.id)} onClick={() => onAction({ ...base(), action: "final_review", size: line.size, assetId: final.id })}><CheckCircle2 size={14} />Approve final print file</button></div>}
      </article>; })}</section>
    {labWork && <section className={styles.section}><h3>Production handoff</h3>{next && <button className={styles.primary} disabled={busy || next === "in_production" && !!job.holds.length} onClick={() => onAction({ ...base(), action: "transition", status: next })}>{next === "in_production" ? "Start production preparation" : next === "ready" ? "Mark ready" : "Complete job"}</button>}<div className={styles.actions}><button className={styles.secondary} disabled={!!fileBusy || job.holds.length > 0 || job.lines.some(line => !line.finalReviewedAt)} onClick={() => onDownload("8x10")}><Download size={14} />Download 8×10</button><button className={styles.secondary} disabled={!!fileBusy || job.holds.length > 0 || job.lines.some(line => !line.finalReviewedAt)} onClick={() => onDownload("10x7")}><Download size={14} />Download 10×7 sheet (two 5×7)</button><button className={styles.secondary} disabled={!!fileBusy || job.holds.length > 0 || job.lines.some(line => !line.finalReviewedAt)} onClick={() => onDownload("manifest")}>Order manifest</button></div><p className={styles.muted}>Packing uses the approved 5×7 render twice on one 10×7 sheet. Physical printing stays disabled in this pilot.</p></section>}
    <section className={styles.section}><h3>Production history</h3><ol className={styles.timeline}>{job.events.map(event => <li key={event.id}>{productionEventLabel(event.action)} · {event.actorRole}<time dateTime={event.createdAt}>{date(event.createdAt)}</time></li>)}</ol></section>
  </article>;
}

function ProductionNoChangeReview({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  return <div><label className={styles.check}><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} /><span>I reviewed this cropped file and no colour change is needed.</span></label><button className={styles.secondary} disabled={busy || !reviewed} onClick={onConfirm}>Save no-change colour review</button></div>;
}
