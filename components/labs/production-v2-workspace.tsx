"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Crop, Download, ImageIcon, Inbox, Loader2, LockKeyhole, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/labs/money";
import type { ProductionAsset, ProductionCrop, ProductionGallery, ProductionPolicy } from "@/lib/labs/production-types";
import type { ProductionV2Job as ProductionJob, ProductionV2OwnerAction as ProductionOwnerAction, ProductionV2SlotId, ProductionV2Workspace as Workspace } from "@/lib/labs/production-v2-types";
import { ProductionCropEditor, type ProductionCropRect } from "./production-crop-editor";
import { productionPrivateBlob, productionSessionRead, productionSessionWrite, productionToken } from "./production-client";
import { productionV2GalleryPath as productionGalleryPath, productionV2Request as productionRequest } from "./production-v2-client";
import { ProductionConnectorPanel, productionConnectorRequest, type ProductionConnectorQueueAction } from "./production-connectors";
import { productionV2HoldLabel as productionHoldLabel, productionV2SlotLabel } from "./production-v2-labels";
import { productionEventLabel } from "./production-labels";
import styles from "./production.module.css";

const statuses = { submitted: "Submitted", accepted: "Accepted", in_production: "In production", ready: "Ready", completed: "Completed" };
const defaults: ProductionPolicy = { autoApprove: false, cropResponsibility: "photographer", labColourCorrection: false };
type Pending = { action: ProductionOwnerAction | ProductionConnectorQueueAction; token?: string; connector?: boolean };
type CropSelection = { jobId: string; slotId: ProductionV2SlotId; url: string };
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const normalizedSize = (value: string) => value.toLowerCase().replace(/[\s″"']/g, "").replace(/×/g, "x");

export function productionCropPixels(rect: ProductionCropRect, width: number, height: number): ProductionCrop {
  const x = Math.round(rect.x * width), y = Math.round(rect.y * height);
  return { x, y, width: Math.min(width - x, Math.round(rect.width * width)), height: Math.min(height - y, Math.round(rect.height * height)), rotation: 0 };
}
export function productionV2CorrectionReason(value: string): string | null { const reason = value.trim(); return reason.length >= 5 && reason.length <= 500 && !/[\x00-\x1f\x7f]/.test(reason) ? reason : null; }
export function productionOriginalEligible(asset: Pick<ProductionAsset, "widthPixels" | "heightPixels">): boolean { return asset.widthPixels >= 1600 && asset.heightPixels >= 2000; }
export function productionVisibleOriginals(assets: ProductionAsset[], selectedIds: string[], limit = 20): ProductionAsset[] {
  const selected = new Set(selectedIds);
  return assets.filter(asset => asset.kind === "original").filter((asset, index) => index < limit || selected.has(asset.id));
}

export function ProductionV2Workspace({ audience }: { audience: "studio" | "lab" }) {
  const endpoint = audience === "lab" ? "/api/lab/production-v2" : "/api/dashboard/lab-production-v2";
  const [workspace, setWorkspace] = useState<Workspace | null>(null), [userId, setUserId] = useState("");
  const activeUser = useRef("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"galleries" | "jobs">(audience === "lab" ? "jobs" : "galleries");
  const [policy, setPolicy] = useState<ProductionPolicy>(defaults), [sheetId, setSheetId] = useState(""), [entryId, setEntryId] = useState("");
  const [name, setName] = useState("Private three-print gallery"), [assetIds, setAssetIds] = useState<string[]>([]), [targetLabId, setTargetLabId] = useState("");
  const [originalLimit, setOriginalLimit] = useState(20);
  const [links, setLinks] = useState<Record<string, string>>({}), [pending, setPending] = useState<Pending | null>(null), [selectedId, setSelectedId] = useState("");
  const [crop, setCrop] = useState<CropSelection | null>(null), [fileBusy, setFileBusy] = useState("");
  const key = `studio-os-production-v2:${userId}:${audience}`;
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
      const savedKey = `studio-os-production-v2:${session.user.id}:${audience}`;
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
      if (attempt.connector) await productionConnectorRequest(audience, userId, attempt.action);
      const result = await productionRequest(endpoint, attempt.connector ? undefined : attempt.action, userId);
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
  async function startCrop(job: ProductionJob, slotId: ProductionV2SlotId) {
    const slot = job.slots.find(value => value.id === slotId); if (!slot) return;
    setFileBusy(`crop:${slotId}`); setError("");
    try { const blob = await productionPrivateBlob(`/api/dashboard/lab-production-v2-assets?assetId=${encodeURIComponent(slot.source.id)}&jobId=${encodeURIComponent(job.id)}&preview=1&audience=${audience}`, userId); if (activeUser.current !== userId) throw new Error("Reopen this workspace after signing in."); setCrop({ jobId: job.id, slotId, url: URL.createObjectURL(blob) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This print's original preview could not be opened."); }
    finally { setFileBusy(""); }
  }
  async function saveCrop(rect: ProductionCropRect) {
    if (!crop || !selected || selected.id !== crop.jobId) return;
    const slot = selected.slots.find(value => value.id === crop.slotId); if (!slot) return;
    if (await mutate({ action: { action: "save_crop", jobId: selected.id, expectedVersion: selected.version, requestId: crypto.randomUUID(), slotId: crop.slotId, rect: productionCropPixels(rect, slot.source.widthPixels, slot.source.heightPixels) } })) setCrop(null);
  }
  async function corrected(job: ProductionJob, slotId: ProductionV2SlotId, file: File) {
    const slot = job.slots.find(value => value.id === slotId); if (!slot?.cropAsset) return;
    if (file.size > 4_000_000 || !["image/jpeg", "image/png"].includes(file.type)) { setError("Choose a corrected JPEG or PNG up to 4 MB with the current cropped file's exact pixels."); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("kind", "corrected"); form.append("file", file); form.append("jobId", job.id); form.append("slotId", slotId); form.append("sourceAssetId", slot.cropAsset.id); form.append("audience", audience);
      const result = await productionRequest("/api/dashboard/lab-production-v2-assets", form, userId);
      if (!result.asset || activeUser.current !== userId) throw new Error("The corrected print file could not be confirmed.");
      const attempt: Pending = { action: { action: "complete_colour", jobId: job.id, expectedVersion: job.version, requestId: crypto.randomUUID(), slotId, assetId: result.asset.id, reviewNoChange: false } };
      productionSessionWrite(`${key}:pending`, attempt); setPending(attempt);
      const saved = await productionRequest(endpoint, attempt.action, userId);
      if (!saved.workspace || activeUser.current !== userId) throw new Error("The colour review could not be confirmed. Retry the retained request.");
      adopt(saved.workspace); sessionStorage.removeItem(`${key}:pending`); setPending(null); setNotice("Colour review saved for this print only. Its final file still needs review.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The corrected file could not be saved."); }
    finally { setBusy(false); }
  }
  async function download(jobId: string, file: "manifest" | "8x10" | "10x7" | "5x7-a" | "5x7-b") {
    setFileBusy(file); setError("");
    try { const blob = await productionPrivateBlob(`/api/dashboard/lab-production-v2-files?jobId=${encodeURIComponent(jobId)}&file=${file}&audience=${audience}`, userId); if (activeUser.current !== userId) throw new Error("Reopen this workspace after signing in."); const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = file === "manifest" ? `${jobId}.json` : `${file}.jpg`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The reviewed paper files are not ready."); }
    finally { setFileBusy(""); }
  }
  async function downloadAsset(asset: ProductionAsset, jobId: string) {
    setFileBusy(asset.id); setError("");
    try { const blob = await productionPrivateBlob(`/api/dashboard/lab-production-v2-assets?assetId=${encodeURIComponent(asset.id)}&jobId=${encodeURIComponent(jobId)}&audience=${audience}`, userId); if (activeUser.current !== userId) throw new Error("Reopen this workspace after signing in."); const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = asset.filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The cropped print file could not be downloaded."); }
    finally { setFileBusy(""); }
  }
  return <div className={styles.shell}><main className={styles.page}>
    <nav className={styles.nav}><Link href={audience === "lab" ? "/lab" : "/dashboard/labs"}><ArrowLeft size={14} />{audience === "lab" ? "Existing lab orders" : "Labs & price sheets"}</Link><Link href={audience === "lab" ? "/dashboard/labs/production-v2" : "/lab/production-v2"}>{audience === "lab" ? "Photographer production" : "Lab production receiving"}</Link><Link href={audience === "lab" ? "/lab/production" : "/dashboard/labs/production"}>Previous production jobs</Link></nav>
    <header className={styles.header}><div><div className={styles.eyebrow}>THREE PRINTS · INDEPENDENT PHOTO CHOICES</div><h1>{audience === "lab" ? "Lab receiving · three print slots" : "Choose and review each print separately"}</h1><p>Use a different photo for the 8×10, 5×7 A and 5×7 B. Each print keeps its own crop, colour work and final review.</p></div><span className={styles.badge}><LockKeyhole size={13} />Private pilot</span></header>
    <div className={styles.boundary}><ShieldCheck size={15} style={{ display: "inline", verticalAlign: "middle", marginRight: 7 }} />Test order · No payment collected · Physical printing disabled. GTA remains on hold. Current schools, prices and existing order workflows stay unchanged.</div>
    {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
    {pending && !busy && <div className={styles.notice}><strong>An update needs confirmation.</strong> Its original request is retained.<div className={styles.actions}><button className={styles.primary} onClick={() => void mutate(pending)}>Retry same update</button><button className={styles.secondary} onClick={() => void refresh()}>Refresh & review</button><button className={styles.quiet} onClick={() => { sessionStorage.removeItem(`${key}:pending`); setPending(null); }}>Dismiss pending retry</button></div></div>}
    {loading ? <section className={styles.empty}><Loader2 className={styles.spin} size={27} /><h2>Opening private production</h2></section> : !workspace ? <section className={`${styles.panel} ${styles.empty}`}><Inbox size={28} /><h2>Sign in to your connected account</h2><p>Only the studio and assigned lab can review their production jobs.</p><Link className={styles.primary} href={`/sign-in?redirect=${encodeURIComponent(audience === "lab" ? "/lab/production-v2" : "/dashboard/labs/production-v2")}`}>Sign in</Link></section> : <>
      <div className={styles.tabs} role="tablist" aria-label="Production views">{audience === "studio" && <button role="tab" aria-selected={tab === "galleries"} onClick={() => setTab("galleries")}>Galleries & preferences</button>}<button role="tab" aria-selected={tab === "jobs"} onClick={() => setTab("jobs")}>{audience === "lab" ? "Receiving queue" : "Orders & production checks"}</button><button className={styles.quiet} disabled={busy} onClick={() => void refresh()}><RefreshCw size={13} />Refresh</button></div>
      {tab === "galleries" && audience === "studio" ? <div className={styles.grid}><section className={`${styles.panel} ${styles.form}`}><h2>1. Choose production preferences</h2><p className={styles.muted}>Saved preferences apply to future galleries. Existing galleries and orders keep their instructions.</p><fieldset disabled={busy || !!pending} className={styles.policy}><label className={styles.check}><input type="checkbox" checked={policy.autoApprove} onChange={event => setPolicy(value => ({ ...value, autoApprove: event.target.checked }))} /><span>Automatically approve new photographer orders</span></label><p className={styles.muted}>Off means review each order. Automatic approval releases photographer review only; it does not accept the order for the lab or complete any production work.</p><label>Who approves the print crops?<select value={policy.cropResponsibility} onChange={event => setPolicy(value => ({ ...value, cropResponsibility: event.target.value as ProductionPolicy["cropResponsibility"] }))}><option value="photographer">I review and approve each crop</option><option value="lab">Ask the lab to crop and approve each print</option></select></label><label className={styles.check}><input type="checkbox" checked={policy.labColourCorrection} onChange={event => setPolicy(value => ({ ...value, labColourCorrection: event.target.checked }))} /><span>Request lab colour correction</span></label><p className={styles.muted}>A person at the lab reviews colour. No paid AI service is used.</p><button className={styles.secondary} disabled={!policyDirty} onClick={() => void mutate({ action: { action: "save_policy", expectedVersion: workspace.policy.version, policy } })}>Save production preferences</button></fieldset>
        <h2>2. Add original photos</h2><p className={styles.muted}>Private JPEG or PNG, up to 4 MB each. This package needs at least 1600 × 2000 upright pixels. Select up to 20 eligible photos after upload.</p>{policyDirty && <p className={styles.notice}>Save preferences before uploading originals or creating a gallery.</p>}<label style={{ marginTop: 13 }}>Upload one original<input type="file" accept="image/jpeg,image/png" disabled={busy || !!pending || policyDirty} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadOriginal(file); }} /></label>
        <div className={styles.photos}>{visibleOriginals.map(asset => <label key={asset.id} className={styles.photo} data-selected={assetIds.includes(asset.id)}><ProductionAssetImage asset={asset} userId={userId} audience={audience} /><span><input type="checkbox" checked={assetIds.includes(asset.id)} disabled={busy || !!pending || !productionOriginalEligible(asset) || assetIds.length >= 20 && !assetIds.includes(asset.id)} onChange={event => setAssetIds(current => event.target.checked ? [...current, asset.id] : current.filter(id => id !== asset.id))} />{asset.filename}</span><p className={styles.muted}>{asset.widthPixels} × {asset.heightPixels} px{!productionOriginalEligible(asset) && " · Too small for this package"}</p></label>)}</div>
        {originalCount > 0 && <p className={styles.muted}>Showing {visibleOriginals.length} of {originalCount} private originals · {assetIds.length} selected</p>}
        {visibleOriginals.length < originalCount && <button type="button" className={styles.secondary} style={{ margin: "12px 0 20px" }} onClick={() => setOriginalLimit(current => Math.min(current + 20, originalCount))}>Load 20 more originals</button>}
        <h2>3. Create the private gallery</h2><fieldset disabled={busy || !!pending || policyDirty}><label>Copied price sheet<select value={sheet?.id ?? ""} onChange={event => { setSheetId(event.target.value); setEntryId(""); }}>{workspace.sheets.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><label>Print package<select value={offer?.id ?? ""} onChange={event => setEntryId(event.target.value)}>{sheet?.offers.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>{offer && sheet && <div className={styles.offer}><h3>{offer.name}</h3><ul className={styles.contents}>{offer.contents.map((content, index) => <li key={index}>{content.qty} × {content.name}</li>)}</ul><strong className={styles.price}>{formatCurrency(offer.retailCents, sheet.currency)}</strong></div>}<label>Fulfillment<select value={targetLabId} onChange={event => setTargetLabId(event.target.value)}><option value="">My own studio · In-house</option>{workspace.labs.map(lab => <option key={lab.id} value={lab.id}>{lab.name}</option>)}</select></label>{targetLabId && <p className={styles.muted}>{product8 && product5 ? "Approved lab products: one 8×10 and two 5×7 prints." : "This lab needs approved 8×10 and 5×7 products before this gallery can be created."}</p>}<label>Gallery name<input maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label><button className={styles.primary} disabled={!canCreate} onClick={createGallery}><Plus size={15} />Create private production gallery</button></fieldset>
      </section><section className={styles.panel}><div className={styles.sectionHead}><div><h2>Private production galleries</h2><p>Open the parent view to choose each print’s photo and place a test order.</p></div></div>{workspace.galleries.length ? <div className={styles.galleryList}>{workspace.galleries.map(gallery => <article key={gallery.id} className={styles.card}><header><h3>{gallery.name}</h3><span className={styles.badge}>{gallery.revokedAt ? "Closed" : "Private"}</span></header><p>{gallery.targetLabel} · {gallery.photos.length} photos</p><p>{gallery.offer.name} · {formatCurrency(gallery.offer.retailCents, gallery.currency)}</p><p className={styles.muted}>Order approval: {gallery.policy.autoApprove ? "Automatic" : "Manual"} · Crop: {gallery.policy.cropResponsibility} · Lab colour: {gallery.policy.labColourCorrection ? "Requested" : "Off"}</p><p className={styles.muted}>Expires {date(gallery.expiresAt)}</p>{!gallery.revokedAt && <div className={styles.actions}>{links[gallery.id] && <button className={styles.primary} disabled={busy || !!pending} onClick={() => openGallery(gallery)}>Open three-print parent gallery</button>}<button className={styles.secondary} disabled={busy || !!pending} onClick={() => { const token = productionToken(); void mutate({ token, action: { action: "rotate_gallery", galleryId: gallery.id, expectedVersion: gallery.version, accessToken: token } }); }}>{links[gallery.id] ? "Replace private link" : "Generate private link"}</button><button className={styles.quiet} disabled={busy || !!pending} onClick={() => void mutate({ action: { action: "revoke_gallery", galleryId: gallery.id, expectedVersion: gallery.version } })}>Close gallery</button></div>}</article>)}</div> : <div className={styles.empty}><ImageIcon size={28} /><p>Create a private gallery with your own original photos to begin.</p></div>}</section></div> : <div className={styles.jobGrid}><section className={styles.jobList} aria-label="Production jobs">{workspace.jobs.length ? workspace.jobs.map(job => <button className={styles.jobButton} key={job.id} aria-pressed={job.id === selectedId} onClick={() => { setSelectedId(job.id); setCrop(null); }}><span className={styles.status}>{statuses[job.status]}</span><strong>{job.reference}</strong><p>{job.studioName} → {job.targetLabel}</p><footer><span>{job.holds.length} production holds</span><span>{job.amountKind === "wholesale" ? "Lab product cost" : "Retail subtotal"} · {formatCurrency(job.subtotalMinor, job.currency)}</span></footer></button>) : <div className={`${styles.panel} ${styles.empty}`}><Inbox size={28} /><h2>No three-print jobs yet</h2><p>Previous production jobs remain available in their existing workspace.</p></div>}</section>{selected && <ProductionV2JobDetail key={selected.id} job={selected} audience={audience} userId={userId} busy={busy || !!pending} fileBusy={fileBusy} crop={crop} onAction={action => void mutate({ action })} onCrop={slotId => void startCrop(selected, slotId)} onSaveCrop={rect => void saveCrop(rect)} onCancelCrop={() => setCrop(null)} onCorrected={(slotId, file) => void corrected(selected, slotId, file)} onDownload={file => void download(selected.id, file)} onDownloadAsset={asset => void downloadAsset(asset, selected.id)} onStage={() => void mutate({ connector: true, action: { action: "queue", jobId: selected.id, expectedVersion: selected.version, requestId: crypto.randomUUID() } })} />}</div>}
      <ProductionConnectorPanel audience={audience} userId={userId} />
    </>}
  </main></div>;
}

function ProductionAssetImage({ asset, userId, audience, onReady, jobId }: { asset: ProductionAsset; userId: string; audience: "studio" | "lab"; onReady?: () => void; jobId?: string }) {
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); let objectUrl = ""; const path = jobId ? `/api/dashboard/lab-production-v2-assets?assetId=${encodeURIComponent(asset.id)}&jobId=${encodeURIComponent(jobId)}&preview=1&audience=${audience}` : `/api/dashboard/lab-production-assets?assetId=${encodeURIComponent(asset.id)}&preview=1&audience=${audience}`; productionPrivateBlob(path, userId, controller.signal).then(blob => { if (controller.signal.aborted) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Preview unavailable"); }); return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [asset.id, audience, userId, jobId]);
  return error ? <p className={styles.muted}>{error}</p> : url ? <Image unoptimized src={url} width={asset.widthPixels} height={asset.heightPixels} className={styles.linePreview} alt={asset.filename} onLoad={onReady} /> : <p className={styles.muted}>Loading private preview…</p>;
}

export function ProductionV2JobDetail({ job, audience, userId, busy, fileBusy, crop, onAction, onCrop, onSaveCrop, onCancelCrop, onCorrected, onDownload, onDownloadAsset, onStage }: {
  job: ProductionJob; audience: "studio" | "lab"; userId: string; busy: boolean; fileBusy: string; crop: CropSelection | null;
  onAction: (action: ProductionOwnerAction) => void; onCrop: (slotId: ProductionV2SlotId) => void; onSaveCrop: (rect: ProductionCropRect) => void; onCancelCrop: () => void;
  onCorrected: (slotId: ProductionV2SlotId, file: File) => void; onDownload: (file: "manifest" | "8x10" | "10x7" | "5x7-a" | "5x7-b") => void; onDownloadAsset: (asset: ProductionAsset) => void; onStage: () => void;
}) {
  const [seenAssets, setSeenAssets] = useState<string[]>([]), [choices, setChoices] = useState<Record<string, string>>({});
  const [correction, setCorrection] = useState<"reopen" | "reprint" | null>(null), [reason, setReason] = useState(""), [acknowledged, setAcknowledged] = useState(false), [stageAcknowledged, setStageAcknowledged] = useState(false);
  const recordPreview = (assetId: string) => setSeenAssets(current => current.includes(assetId) ? current : [...current, assetId]);
  const base = () => ({ jobId: job.id, expectedVersion: job.version, requestId: crypto.randomUUID() });
  const editable = job.dispatchState === "idle" && ["submitted", "accepted"].includes(job.status);
  const next = job.status === "accepted" ? "in_production" : job.status === "in_production" ? "ready" : job.status === "ready" ? "completed" : null;
  const complete = job.slots.length === 3 && job.holds.length === 0 && job.slots.every(slot => slot.finalReviewedAt && slot.finalAsset);
  function confirmCorrection() {
    const validatedReason = productionV2CorrectionReason(reason);
    if (!correction || !validatedReason || !acknowledged) return;
    if (correction === "reprint") onAction({ ...base(), action: "reprint", reason: validatedReason, receiptToken: productionToken() });
    else onAction({ ...base(), action: "reopen", reason: validatedReason });
    setCorrection(null); setAcknowledged(false); setReason("");
  }
  return <article className={styles.panel}><header className={styles.detailHead}><div><div className={styles.eyebrow}>THREE INDEPENDENT PRINTS</div><h2>{job.reference}</h2><p>{job.studioName} → {job.targetLabel}</p><p>{date(job.createdAt)} · Revision {job.version}</p>{job.reprintOf && <p className={styles.muted}>Linked reprint of {job.reprintOf}</p>}</div><span className={styles.status}>{statuses[job.status]}</span></header>
    <div className={styles.boundary}>Test-only order · No payment collected · Physical printing disabled. The 10×7 sheet uses the separately approved 5×7 A and 5×7 B files.</div>
    <h3>{job.offer.name}</h3><p className={styles.muted}>{job.quantity} complete package {job.quantity === 1 ? "set" : "sets"} · {job.quantity * 3} prints · {job.amountKind === "wholesale" ? "Lab product cost" : "Retail subtotal"}: {formatCurrency(job.subtotalMinor, job.currency)}</p>
    <div className={styles.checks}><div><strong>Photographer approval</strong><span>{job.photographerApproved ? job.policy.autoApprove ? "Automatically approved" : "Approved" : "Needs studio review"}</span></div><div><strong>Print reviews</strong><span>{job.slots.filter(slot => slot.cropApproved).length}/3 crops · {job.slots.filter(slot => slot.finalReviewedAt).length}/3 final files</span></div><div><strong>Windows test handoff</strong><span>{job.dispatchState.replace(/_/g, " ")}</span></div></div>
    {job.holds.length > 0 && <div className={styles.notice}><strong>Before production:</strong><ul className={styles.contents}>{job.holds.map(hold => <li key={hold}>{productionHoldLabel(hold)}</li>)}</ul></div>}
    <div className={styles.actions}>{job.canApproveOrder && !job.photographerApproved && <button className={styles.primary} disabled={busy} onClick={() => onAction({ ...base(), action: "approve_order" })}>Approve order for production review</button>}{job.canReceive && job.status === "submitted" && <button className={styles.secondary} disabled={busy} onClick={() => onAction({ ...base(), action: "accept" })}>Accept job for review</button>}</div>
    <section className={styles.section}><h3>Review each print</h3><p className={styles.muted}>Source or crop changes reset checks for that print only. Each complete package repeats the three choices below.</p>
      {job.slots.map(slot => {
        const final = slot.finalAsset ?? slot.colourAsset ?? slot.cropAsset, label = productionV2SlotLabel(slot.id), selectedPhoto = choices[slot.id] ?? slot.photoId;
        return <article className={styles.line} key={slot.id} aria-label={`${label} print review`}><div className={styles.lineTop}><div><h3>{label} · {slot.quantity} {slot.quantity === 1 ? "copy" : "copies"}</h3><p>Crop: {slot.cropApproved ? "Approved" : slot.cropAsset ? "Generated · needs approval" : "Not saved"} · Final: {slot.finalReviewedAt ? "Reviewed" : "Pending"}</p></div><span className={styles.badge}>{job.policy.cropResponsibility === "photographer" ? "Photographer crop" : "Lab crop"}</span></div>
          <div className={styles.section}><h3>Photo for {label}</h3><ProductionAssetImage key={slot.source.id} jobId={job.id} asset={slot.source} userId={userId} audience={audience} /><p className={styles.muted}>{slot.source.filename} · {slot.source.widthPixels} × {slot.source.heightPixels} px</p>
            {job.canChangeSource && editable && <div className={styles.form} style={{ marginTop: 12 }}><label>Choose another gallery photo for {label}<select value={selectedPhoto} disabled={busy} onChange={event => setChoices(current => ({ ...current, [slot.id]: event.target.value }))}>{job.availablePhotos.map(photo => <option key={photo.id} value={photo.id}>{photo.filename}</option>)}</select></label><button className={styles.secondary} disabled={busy || selectedPhoto === slot.photoId} onClick={() => onAction({ ...base(), action: "set_slot_source", slotId: slot.id, photoId: selectedPhoto })}>Change {label} photo</button><p className={styles.muted}>This clears {label} crop, colour and final reviews. The other two prints keep their saved work.</p></div>}
          </div>
          {final && <div className={styles.section}><h3>Saved {label} print file</h3><ProductionAssetImage key={final.id} jobId={job.id} asset={final} userId={userId} audience={audience} onReady={() => recordPreview(final.id)} /><p className={styles.muted}>{final.widthPixels} × {final.heightPixels} px · SHA-256 {final.sha256.slice(0, 16)}…</p></div>}
          {crop?.jobId === job.id && crop.slotId === slot.id ? <ProductionCropEditor sourceUrl={crop.url} sourceWidth={slot.source.widthPixels} sourceHeight={slot.source.heightPixels} targetWidth={slot.widthInches} targetHeight={slot.heightInches} size={label} busy={busy} onSave={onSaveCrop} onCancel={onCancelCrop} /> : <div className={styles.actions}>{job.canCrop && editable && <button className={styles.secondary} disabled={busy || !!fileBusy} onClick={() => onCrop(slot.id)}><Crop size={14} />{slot.cropAsset ? `Review / change ${label} crop` : `Crop ${label}`}</button>}{job.canCrop && editable && slot.cropAsset && !slot.cropApproved && <button className={styles.primary} disabled={busy || !seenAssets.includes(slot.cropAsset.id)} onClick={() => onAction({ ...base(), action: "approve_crop", slotId: slot.id, assetId: slot.cropAsset!.id })}>Approve saved {label} crop</button>}</div>}
          {job.canReceive && job.status === "accepted" && job.dispatchState === "idle" && job.policy.labColourCorrection && slot.cropApproved && !slot.colourCompletedAt && <div className={`${styles.section} ${styles.form}`}><h3>{label} lab colour review</h3><p className={styles.muted}>Production files use sRGB. Correct colour outside Studio OS and keep this print’s {slot.cropAsset?.widthPixels} × {slot.cropAsset?.heightPixels} pixels unchanged.</p><button className={styles.secondary} disabled={!!fileBusy} onClick={() => onDownloadAsset(slot.cropAsset!)}><Download size={14} />Download {label} cropped file</button><label style={{ marginTop: 12 }}>Upload corrected {label} file<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onCorrected(slot.id, file); }} /></label><ProductionV2NoChangeReview key={slot.cropAsset!.id} label={label} busy={busy || !seenAssets.includes(slot.cropAsset!.id)} onConfirm={() => onAction({ ...base(), action: "complete_colour", slotId: slot.id, assetId: slot.cropAsset!.id, reviewNoChange: true })} /></div>}
          {job.canReceive && job.status === "accepted" && job.dispatchState === "idle" && slot.cropApproved && (!job.policy.labColourCorrection || !!slot.colourCompletedAt) && !slot.finalReviewedAt && final && <div className={styles.actions}><button className={styles.primary} disabled={busy || !seenAssets.includes(final.id)} onClick={() => onAction({ ...base(), action: "final_review", slotId: slot.id, assetId: final.id })}><CheckCircle2 size={14} />Approve {label} final print file</button></div>}
        </article>;
      })}
    </section>
    {job.canReceive && <section className={styles.section}><h3>Reviewed paper-file handoff</h3>{next && <button className={styles.primary} disabled={busy || next === "in_production" && !complete} onClick={() => onAction({ ...base(), action: "transition", status: next })}>{next === "in_production" ? "Start production preparation" : next === "ready" ? "Mark ready" : "Complete job"}</button>}<div className={styles.actions}>{(["8x10", "5x7-a", "5x7-b", "10x7", "manifest"] as const).map(file => <button key={file} className={styles.secondary} disabled={!!fileBusy || !complete} onClick={() => onDownload(file)}><Download size={14} />{file === "manifest" ? "Order manifest" : file === "10x7" ? "10×7 sheet · A + B" : `${productionV2SlotLabel(file)} file`}</button>)}</div><p className={styles.muted}>One 8×10 file and one 10×7 paper sheet per package set. The left and right cells keep the independent 5×7 A and B renders.</p>
      {job.status === "in_production" && job.dispatchState === "idle" && complete && <div className={styles.notice} style={{ marginTop: 16 }}><label className={styles.check}><input type="checkbox" disabled={busy} checked={stageAcknowledged} onChange={event => setStageAcknowledged(event.target.checked)} /><span>I understand this stages reviewed test files on the Windows helper and does not print them.</span></label><button className={styles.primary} disabled={busy || !stageAcknowledged} onClick={onStage}>Stage on Windows test helper</button></div>}
    </section>}
    {(job.canReopen || job.canReprint) && <section className={styles.section}><h3>Controlled corrections</h3><div className={styles.actions}>{job.canReopen && <button className={styles.secondary} disabled={busy} onClick={() => { setCorrection("reopen"); setAcknowledged(false); setReason(""); }}>Reopen for review</button>}{job.canReprint && <button className={styles.secondary} disabled={busy} onClick={() => { setCorrection("reprint"); setAcknowledged(false); setReason(""); }}>Create linked full-package reprint</button>}</div>{correction && <div className={`${styles.notice} ${styles.form}`} style={{ marginTop: 14 }}><h3>{correction === "reopen" ? "Reopen this saved job?" : "Create a separate reprint job?"}</h3><p>{correction === "reopen" ? "This creates a new saved review revision and clears all final approvals. Unchanged crops and colour work are preserved. Handed-off files cannot be silently replaced." : "This creates a new linked job for the complete 8×10 + 5×7 A + 5×7 B package. The original job and any queued or staged dispatch stay locked and audited. This does not cancel an existing handoff; acceptance and print reviews must be done again for the new job."}</p><label style={{ marginTop: 12 }}>Reason · at least 5 characters<input minLength={5} maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label><label className={styles.check}><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>I reviewed the scope and understand that this action does not send a physical print job.</span></label><div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={() => setCorrection(null)}>Keep current job</button><button className={styles.primary} disabled={busy || !productionV2CorrectionReason(reason) || !acknowledged} onClick={confirmCorrection}>{correction === "reopen" ? "Confirm reopen" : "Create linked reprint"}</button></div></div>}</section>}
    <section className={styles.section}><h3>Production history</h3><ol className={styles.timeline}>{job.events.map(event => <li key={event.id}>{event.action === "reopen" ? "Job reopened for review" : event.action === "reprint" ? "Linked reprint created" : event.action === "set_slot_source" ? "Print photo changed" : productionEventLabel(event.action)} · {event.actorRole}<time dateTime={event.createdAt}>{date(event.createdAt)}</time></li>)}</ol></section>
  </article>;
}

function ProductionV2NoChangeReview({ label, busy, onConfirm }: { label: string; busy: boolean; onConfirm: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  return <div><label className={styles.check}><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} /><span>I reviewed {label} colour and no change is needed.</span></label><button className={styles.secondary} disabled={busy || !reviewed} onClick={onConfirm}>Save {label} no-change review</button></div>;
}
