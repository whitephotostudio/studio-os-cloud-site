"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Crop, Download, ImageIcon, Inbox, Loader2, LockKeyhole, Plus, RefreshCw, ShieldCheck } from "lucide-react";
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
import { productionV2NextStep, productionV2PrintStage, productionV2ReviewComplete, productionV2ShortReference } from "@/lib/labs/production-v2-guidance";
import styles from "./production.module.css";
import guided from "./production-v2-guided.module.css";

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
  const [setupStep, setSetupStep] = useState(1);
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
  return <div className={styles.shell}><main className={`${styles.page} ${guided.workspace}`}>
    <nav className={styles.nav}><Link href={audience === "lab" ? "/lab" : "/dashboard/labs"}><ArrowLeft size={14} />{audience === "lab" ? "Existing lab orders" : "Labs & price sheets"}</Link><details className={guided.navDetails}><summary>Other workspaces</summary><div>{audience === "studio" && <Link href="/dashboard/labs/sheets">Build a test print sheet</Link>}<Link href={audience === "lab" ? "/dashboard/labs/production-v2" : "/lab/production-v2"}>{audience === "lab" ? "Photographer production" : "Lab production receiving"}</Link><Link href={audience === "lab" ? "/lab/production" : "/dashboard/labs/production"}>Previous production jobs</Link></div></details></nav>
    <header className={styles.header}><div><div className={styles.eyebrow}>THREE PRINTS · INDEPENDENT PHOTO CHOICES</div><h1>{audience === "lab" ? "Your lab orders" : "Your prints, made simple"}</h1><p>{audience === "lab" ? "Open an order, review its three prints and follow the next step." : "Set your preferences once. Choose photos and prices, then follow every order in one place."}</p></div><span className={styles.badge}><LockKeyhole size={13} />Private pilot</span></header>
    <div className={styles.boundary}><ShieldCheck size={15} style={{ display: "inline", verticalAlign: "middle", marginRight: 7 }} />Test mode · GTA orders, payments and physical printing are disabled. Current schools and prices stay unchanged.</div>
    {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
    {pending && !busy && <div className={styles.notice}><strong>An update needs confirmation.</strong> Its original request is retained.<div className={styles.actions}><button className={styles.primary} onClick={() => void mutate(pending)}>Retry same update</button><button className={styles.secondary} onClick={() => void refresh()}>Refresh & review</button><button className={styles.quiet} onClick={() => { sessionStorage.removeItem(`${key}:pending`); setPending(null); }}>Dismiss pending retry</button></div></div>}
    {loading ? <section className={styles.empty}><Loader2 className={styles.spin} size={27} /><h2>Opening private production</h2></section> : !workspace ? <section className={`${styles.panel} ${styles.empty}`}><Inbox size={28} /><h2>Sign in to your connected account</h2><p>Only the studio and assigned lab can review their production jobs.</p><Link className={styles.primary} href={`/sign-in?redirect=${encodeURIComponent(audience === "lab" ? "/lab/production-v2" : "/dashboard/labs/production-v2")}`}>Sign in</Link></section> : <>
      <div className={styles.tabs} role="tablist" aria-label="Production views">{audience === "studio" && <button role="tab" aria-selected={tab === "galleries"} onClick={() => setTab("galleries")}>Galleries & preferences</button>}<button role="tab" aria-selected={tab === "jobs"} onClick={() => setTab("jobs")}>{audience === "lab" ? "Receiving queue" : "Orders & production checks"}</button><button className={styles.quiet} disabled={busy} onClick={() => void refresh()}><RefreshCw size={13} />Refresh</button></div>
      {tab === "galleries" && audience === "studio" ? <div className={styles.grid}><section className={`${styles.panel} ${styles.form}`}><nav className={guided.setupSteps} aria-label="Create a test gallery">{["Preferences", "Photos", "Prices & gallery"].map((step, index) => <button key={step} aria-current={setupStep === index + 1 ? "step" : undefined} disabled={busy || !!pending || index > 0 && policyDirty || index === 2 && !assetIds.length} onClick={() => setSetupStep(index + 1)}>{index + 1}. {step}</button>)}</nav><section hidden={setupStep !== 1}><h2>1. Choose who handles the prints</h2><p className={styles.muted}>Saved preferences apply to future galleries. Existing galleries and orders keep their instructions.</p><fieldset disabled={busy || !!pending} className={styles.policy}><label className={styles.check}><input type="checkbox" checked={policy.autoApprove} onChange={event => setPolicy(value => ({ ...value, autoApprove: event.target.checked }))} /><span>Automatically approve new photographer orders</span></label><p className={styles.muted}>Off means review each order. Automatic approval releases photographer review only; it does not accept the order for the lab or complete any production work.</p><label>Who approves the print crops?<select value={policy.cropResponsibility} onChange={event => setPolicy(value => ({ ...value, cropResponsibility: event.target.value as ProductionPolicy["cropResponsibility"] }))}><option value="photographer">I review and approve each crop</option><option value="lab">Ask the lab to crop and approve each print</option></select></label><label className={styles.check}><input type="checkbox" checked={policy.labColourCorrection} onChange={event => setPolicy(value => ({ ...value, labColourCorrection: event.target.checked }))} /><span>Request lab colour correction</span></label><p className={styles.muted}>A person at the lab reviews colour. No paid AI service is used.</p><button className={styles.secondary} disabled={!policyDirty} onClick={() => void mutate({ action: { action: "save_policy", expectedVersion: workspace.policy.version, policy } })}>Save production preferences</button></fieldset>
        <div className={styles.actions}><button className={styles.primary} disabled={busy || !!pending || policyDirty} onClick={() => setSetupStep(2)}>Next: choose photos<ArrowRight size={14} /></button></div></section><section hidden={setupStep !== 2}><h2>2. Choose your photos</h2><p className={styles.muted}>Private JPEG or PNG, up to 4 MB each. This package needs at least 1600 × 2000 upright pixels. Select up to 20 eligible photos after upload.</p>{policyDirty && <p className={styles.notice}>Save preferences before uploading originals or creating a gallery.</p>}<label style={{ marginTop: 13 }}>Upload one original<input type="file" accept="image/jpeg,image/png" disabled={busy || !!pending || policyDirty} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadOriginal(file); }} /></label>
        <div className={styles.photos}>{visibleOriginals.map(asset => <label key={asset.id} className={styles.photo} data-selected={assetIds.includes(asset.id)}><ProductionAssetImage asset={asset} userId={userId} audience={audience} /><span><input type="checkbox" checked={assetIds.includes(asset.id)} disabled={busy || !!pending || !productionOriginalEligible(asset) || assetIds.length >= 20 && !assetIds.includes(asset.id)} onChange={event => setAssetIds(current => event.target.checked ? [...current, asset.id] : current.filter(id => id !== asset.id))} />{asset.filename}</span><p className={styles.muted}>{asset.widthPixels} × {asset.heightPixels} px{!productionOriginalEligible(asset) && " · Too small for this package"}</p></label>)}</div>
        {originalCount > 0 && <p className={styles.muted}>Showing {visibleOriginals.length} of {originalCount} private originals · {assetIds.length} selected</p>}
        {visibleOriginals.length < originalCount && <button type="button" className={styles.secondary} style={{ margin: "12px 0 20px" }} onClick={() => setOriginalLimit(current => Math.min(current + 20, originalCount))}>Load 20 more originals</button>}
        <div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={() => setSetupStep(1)}>Back</button><button className={styles.primary} disabled={busy || !!pending || !assetIds.length || policyDirty} onClick={() => setSetupStep(3)}>Next: prices & gallery<ArrowRight size={14} /></button></div></section><section hidden={setupStep !== 3}><h2>3. Prices & gallery</h2><fieldset disabled={busy || !!pending || policyDirty}><label>Copied price sheet<select value={sheet?.id ?? ""} onChange={event => { setSheetId(event.target.value); setEntryId(""); }}>{workspace.sheets.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><label>Print package<select value={offer?.id ?? ""} onChange={event => setEntryId(event.target.value)}>{sheet?.offers.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>{offer && sheet && <div className={styles.offer}><h3>{offer.name}</h3><ul className={styles.contents}>{offer.contents.map((content, index) => <li key={index}>{content.qty} × {content.name}</li>)}</ul><strong className={styles.price}>{formatCurrency(offer.retailCents, sheet.currency)}</strong></div>}<label>Fulfillment<select value={targetLabId} onChange={event => setTargetLabId(event.target.value)}><option value="">My own studio · In-house</option>{workspace.labs.map(lab => <option key={lab.id} value={lab.id}>{lab.name}</option>)}</select></label>{targetLabId && <p className={styles.muted}>{product8 && product5 ? "Approved lab products: one 8×10 and two 5×7 prints." : "This lab needs approved 8×10 and 5×7 products before this gallery can be created."}</p>}<label>Gallery name<input maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label><button className={styles.primary} disabled={!canCreate} onClick={createGallery}><Plus size={15} />Create private production gallery</button></fieldset><button className={styles.quiet} disabled={busy} onClick={() => setSetupStep(2)}>Back to photos</button></section>
      </section><section className={styles.panel}><div className={styles.sectionHead}><div><h2>Private production galleries</h2><p>Open the parent view to choose each print’s photo and place a test order.</p></div></div>{workspace.galleries.length ? <div className={styles.galleryList}>{workspace.galleries.map(gallery => <article key={gallery.id} className={styles.card}><header><h3>{gallery.name}</h3><span className={styles.badge}>{gallery.revokedAt ? "Closed" : "Private"}</span></header><p>{gallery.targetLabel} · {gallery.photos.length} photos</p><p>{gallery.offer.name} · {formatCurrency(gallery.offer.retailCents, gallery.currency)}</p><p className={styles.muted}>Order approval: {gallery.policy.autoApprove ? "Automatic" : "Manual"} · Crop: {gallery.policy.cropResponsibility} · Lab colour: {gallery.policy.labColourCorrection ? "Requested" : "Off"}</p><p className={styles.muted}>Expires {date(gallery.expiresAt)}</p>{!gallery.revokedAt && <div className={styles.actions}>{links[gallery.id] && <button className={styles.primary} disabled={busy || !!pending} onClick={() => openGallery(gallery)}>Open three-print parent gallery</button>}<button className={styles.secondary} disabled={busy || !!pending} onClick={() => { const token = productionToken(); void mutate({ token, action: { action: "rotate_gallery", galleryId: gallery.id, expectedVersion: gallery.version, accessToken: token } }); }}>{links[gallery.id] ? "Replace private link" : "Generate private link"}</button><button className={styles.quiet} disabled={busy || !!pending} onClick={() => void mutate({ action: { action: "revoke_gallery", galleryId: gallery.id, expectedVersion: gallery.version } })}>Close gallery</button></div>}</article>)}</div> : <div className={styles.empty}><ImageIcon size={28} /><p>Create a private gallery with your own original photos to begin.</p></div>}</section></div> : <div className={guided.jobGrid}><section aria-label="Production jobs"><div className={guided.queueTitle}><h2>Orders</h2><span>{workspace.jobs.length} total</span></div><div className={styles.jobList}>{workspace.jobs.length ? workspace.jobs.map(job => <button className={styles.jobButton} key={job.id} aria-pressed={job.id === selectedId} onClick={() => { setSelectedId(job.id); setCrop(null); }}><span className={styles.status}>{statuses[job.status]}</span><strong title={job.reference}>{productionV2ShortReference(job.reference)}</strong><p>{job.studioName} → {job.targetLabel}</p><footer><span>{job.holds.length ? `${job.holds.length} checks left` : "Reviews complete"}</span><span>{job.amountKind === "wholesale" ? "Lab product cost" : "Retail subtotal"} · {formatCurrency(job.subtotalMinor, job.currency)}</span></footer></button>) : <div className={`${styles.panel} ${styles.empty}`}><Inbox size={28} /><h2>No three-print jobs yet</h2><p>Previous production jobs remain available in their existing workspace.</p></div>}</div></section>{selected && <ProductionV2JobDetail key={selected.id} job={selected} audience={audience} userId={userId} busy={busy || !!pending} fileBusy={fileBusy} crop={crop} onAction={action => void mutate({ action })} onCrop={slotId => void startCrop(selected, slotId)} onSaveCrop={rect => void saveCrop(rect)} onCancelCrop={() => setCrop(null)} onCorrected={(slotId, file) => void corrected(selected, slotId, file)} onDownload={file => void download(selected.id, file)} onDownloadAsset={asset => void downloadAsset(asset, selected.id)} onStage={() => void mutate({ connector: true, action: { action: "queue", jobId: selected.id, expectedVersion: selected.version, requestId: crypto.randomUUID() } })} />}</div>}
      <ProductionConnectorPanel audience={audience} userId={userId} />
    </>}
  </main></div>;
}

function ProductionAssetImage({ asset, userId, audience, onReady, jobId }: { asset: ProductionAsset; userId: string; audience: "studio" | "lab"; onReady?: () => void; jobId?: string }) {
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); let objectUrl = ""; const path = jobId ? `/api/dashboard/lab-production-v2-assets?assetId=${encodeURIComponent(asset.id)}&jobId=${encodeURIComponent(jobId)}&preview=1&audience=${audience}` : `/api/dashboard/lab-production-assets?assetId=${encodeURIComponent(asset.id)}&preview=1&audience=${audience}`; productionPrivateBlob(path, userId, controller.signal).then(blob => { if (controller.signal.aborted) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Preview unavailable"); }); return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [asset.id, audience, userId, jobId]);
  return error ? <p className={styles.muted}>{error}</p> : url ? <Image unoptimized src={url} width={asset.widthPixels} height={asset.heightPixels} className={styles.linePreview} alt={asset.filename} onLoad={onReady} onError={() => setError("Preview could not be loaded. Refresh before approving this print.")} /> : <p className={styles.muted}>Loading private preview…</p>;
}

export function ProductionV2JobDetail({ job, audience, userId, busy, fileBusy, crop, onAction, onCrop, onSaveCrop, onCancelCrop, onCorrected, onDownload, onDownloadAsset, onStage }: {
  job: ProductionJob; audience: "studio" | "lab"; userId: string; busy: boolean; fileBusy: string; crop: CropSelection | null;
  onAction: (action: ProductionOwnerAction) => void; onCrop: (slotId: ProductionV2SlotId) => void; onSaveCrop: (rect: ProductionCropRect) => void; onCancelCrop: () => void;
  onCorrected: (slotId: ProductionV2SlotId, file: File) => void; onDownload: (file: "manifest" | "8x10" | "10x7" | "5x7-a" | "5x7-b") => void; onDownloadAsset: (asset: ProductionAsset) => void; onStage: () => void;
}) {
  const guidance = productionV2NextStep(job);
  const [activeSlotId, setActiveSlotId] = useState<ProductionV2SlotId>(guidance.slotId ?? job.slots[0]?.id ?? "8x10");
  const [seenAssets, setSeenAssets] = useState<string[]>([]), [choices, setChoices] = useState<Record<string, string>>({});
  const [correction, setCorrection] = useState<"reopen" | "reprint" | null>(null), [reason, setReason] = useState(""), [acknowledged, setAcknowledged] = useState(false), [stageAcknowledged, setStageAcknowledged] = useState(false);
  const [manualReviewAcknowledged, setManualReviewAcknowledged] = useState(false);
  const reviewRef = useRef<HTMLElement>(null);
  const recordPreview = (assetId: string) => setSeenAssets(current => current.includes(assetId) ? current : [...current, assetId]);
  const base = () => ({ jobId: job.id, expectedVersion: job.version, requestId: crypto.randomUUID() });
  const editable = job.dispatchState === "idle" && ["submitted", "accepted"].includes(job.status);
  const complete = productionV2ReviewComplete(job);
  const slot = job.slots.find(value => value.id === (crop?.slotId ?? activeSlotId)) ?? job.slots[0];
  const final = slot ? slot.finalAsset ?? slot.colourAsset ?? slot.cropAsset : null;
  const label = slot ? productionV2SlotLabel(slot.id) : "Print";
  const stage = slot ? productionV2PrintStage(job, slot) : "crop";
  const reviewed = job.slots.filter(value => productionV2PrintStage(job, value) === "done").length;
  const finalVisible = !!final && seenAssets.includes(final.id);
  function openPrint(slotId: ProductionV2SlotId) { setActiveSlotId(slotId); reviewRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }
  function confirmCorrection() {
    const validatedReason = productionV2CorrectionReason(reason);
    if (!correction || !validatedReason || !acknowledged) return;
    if (correction === "reprint") onAction({ ...base(), action: "reprint", reason: validatedReason, receiptToken: productionToken() });
    else onAction({ ...base(), action: "reopen", reason: validatedReason });
    setCorrection(null); setAcknowledged(false); setReason("");
  }
  const printStageLabel = (value: typeof stage) => ({ crop: "Crop needed", approve_crop: "Check saved crop", colour: "Colour review", final_review: "Final check", done: "Reviewed" })[value];
  return <article className={`${styles.panel} ${guided.order}`}>
    <header className={styles.detailHead}><div><div className={styles.eyebrow}>THREE PRINTS · ONE ORDER</div><h2>{productionV2ShortReference(job.reference)}</h2><p>{job.studioName} → {job.targetLabel}</p><p>{date(job.createdAt)}</p></div><span className={styles.status}>{statuses[job.status]}</span></header>
    <p className={guided.testLine}><ShieldCheck size={14} />Test order · No payment collected · Physical printing disabled</p>
    <Link className={styles.quiet} href={`${audience === "lab" ? "/lab/sheets" : "/dashboard/labs/sheets"}?jobId=${encodeURIComponent(job.id)}`}>Build a test sheet with these photos<ArrowRight size={14} /></Link>
    <div className={guided.packageSummary}><div><h3>{job.offer.name}</h3><p>{job.quantity} complete package {job.quantity === 1 ? "set" : "sets"} · {job.quantity * 3} prints</p></div><div><span>{job.amountKind === "wholesale" ? "Lab product cost" : "Retail subtotal"}:</span><strong>{formatCurrency(job.subtotalMinor, job.currency)}</strong></div></div>
    <ol className={guided.progress} aria-label="Order progress">
      <li data-done={job.photographerApproved && job.status !== "submitted"}><span>1</span>Order review</li>
      <li data-done={complete}><span>2</span>Print checks</li>
      <li data-done={job.dispatchState === "handed_off"}><span>3</span>Windows files</li>
      <li data-done={job.status === "completed"}><span>4</span>Finish test</li>
    </ol>
    <section className={guided.nextStep} aria-labelledby="production-next-step"><div className={styles.eyebrow}>NEXT STEP</div><h3 id="production-next-step">{guidance.title}</h3><p>{guidance.description}</p>
      {guidance.kind === "approve_order" && <button className={styles.primary} disabled={busy} onClick={() => onAction({ ...base(), action: "approve_order" })}>Approve order for production review<ArrowRight size={15} /></button>}
      {guidance.kind === "accept" && <button className={styles.primary} disabled={busy} onClick={() => onAction({ ...base(), action: "accept" })}>Accept job for review<ArrowRight size={15} /></button>}
      {guidance.slotId && !["waiting", "blocked"].includes(guidance.kind) && guidance.slotId !== slot?.id && <button className={styles.primary} disabled={busy || !!crop} onClick={() => openPrint(guidance.slotId!)}>Review {productionV2SlotLabel(guidance.slotId)}<ArrowRight size={15} /></button>}
      {guidance.kind === "prepare" && <button className={styles.primary} disabled={busy || !complete} onClick={() => onAction({ ...base(), action: "transition", status: "in_production" })}>Start production preparation<ArrowRight size={15} /></button>}
      {guidance.kind === "handoff" && <div><a className={styles.quiet} href="#production-connector-title">Check Windows connection</a><label className={styles.check}><input type="checkbox" disabled={busy} checked={stageAcknowledged} onChange={event => setStageAcknowledged(event.target.checked)} /><span>I understand this sends reviewed test files to the Windows helper and does not print them.</span></label><button className={styles.primary} disabled={busy || !stageAcknowledged || !complete} onClick={onStage}>Stage on Windows test helper<ArrowRight size={15} /></button></div>}
      {guidance.kind === "ready" && <button className={styles.primary} disabled={busy || !complete} onClick={() => onAction({ ...base(), action: "transition", status: "ready" })}>Mark test job ready<ArrowRight size={15} /></button>}
      {guidance.kind === "complete" && <button className={styles.primary} disabled={busy || !complete} onClick={() => onAction({ ...base(), action: "transition", status: "completed" })}>Complete test job<CheckCircle2 size={15} /></button>}
    </section>
    <div className={guided.reviewHeading}><h3>Choose a print to review</h3><span>{reviewed}/3 final files reviewed</span></div>
    <div className={guided.printCards} aria-label="Three independent prints">
      {job.slots.map(value => {
        const image = value.finalAsset ?? value.colourAsset ?? value.cropAsset ?? value.source;
        const valueLabel = productionV2SlotLabel(value.id), valueStage = productionV2PrintStage(job, value);
        return <button className={guided.printCard} key={value.id} aria-pressed={slot?.id === value.id} aria-label={`Review ${valueLabel} · ${printStageLabel(valueStage)}`} disabled={busy || !!fileBusy || !!crop} onClick={() => setActiveSlotId(value.id)}>
          <span className={guided.cardTitle}>{valueLabel} · {value.quantity} {value.quantity === 1 ? "copy" : "copies"}{valueStage === "done" && <CheckCircle2 size={17} />}</span>
          <div className={guided.cardImage}><ProductionAssetImage key={image.id} jobId={job.id} asset={image} userId={userId} audience={audience} /></div>
          <span className={guided.cardStatus}>{printStageLabel(valueStage)}</span><span className={guided.filename} title={value.source.filename}>{value.source.filename}</span>
        </button>;
      })}
    </div>
    {slot && <section ref={reviewRef} className={guided.reviewPanel} aria-label={`${label} print review`}>
      <div className={styles.lineTop}><div><div className={styles.eyebrow}>REVIEWING ONE PRINT</div><h3>{label} · {printStageLabel(stage)}</h3></div><span className={styles.badge}>{job.policy.cropResponsibility === "photographer" ? "Photographer crop" : "Lab crop"}</span></div>
      <p className={guided.helperText}>Only {label} changes here. The other two prints keep their saved work.</p>
      {crop?.jobId === job.id && crop.slotId === slot.id ? <ProductionCropEditor sourceUrl={crop.url} sourceWidth={slot.source.widthPixels} sourceHeight={slot.source.heightPixels} targetWidth={slot.widthInches} targetHeight={slot.heightInches} size={label} busy={busy} onSave={onSaveCrop} onCancel={onCancelCrop} /> : <>
        <div className={guided.largePreview}><ProductionAssetImage key={(final ?? slot.source).id} jobId={job.id} asset={final ?? slot.source} userId={userId} audience={audience} onReady={final ? () => recordPreview(final.id) : undefined} /></div>
        <p className={guided.previewCaption}>{final ? `Saved ${label} print file` : `Original photo for ${label} · crop not saved yet`}</p>
        {editable && job.canCrop && <div className={styles.actions}>
          {stage === "crop" && <button className={styles.primary} disabled={busy || !!fileBusy} onClick={() => onCrop(slot.id)}><Crop size={15} />Crop {label}</button>}
          {stage === "approve_crop" && slot.cropAsset && <button className={styles.primary} disabled={busy || !seenAssets.includes(slot.cropAsset.id)} onClick={() => onAction({ ...base(), action: "approve_crop", slotId: slot.id, assetId: slot.cropAsset!.id })}>Approve saved {label} crop<CheckCircle2 size={15} /></button>}
          {slot.cropAsset && <button className={styles.quiet} disabled={busy || !!fileBusy} onClick={() => onCrop(slot.id)}><Crop size={14} />Change {label} crop</button>}
        </div>}
        {editable && !job.canCrop && ["crop", "approve_crop"].includes(stage) && <p className={guided.helperText}>Waiting for the {job.policy.cropResponsibility === "lab" ? "lab" : "photographer"} to crop and approve this print.</p>}
        {job.canReceive && job.status === "accepted" && job.dispatchState === "idle" && stage === "colour" && slot.cropApproved && slot.cropAsset && <section className={guided.colourReview}>
          <h3>{label} lab colour review</h3><p>Use your usual photo editor if colour needs adjusting. No paid AI is used.</p>
          <ProductionV2NoChangeReview key={slot.cropAsset.id} label={label} busy={busy || !seenAssets.includes(slot.cropAsset.id)} onConfirm={() => onAction({ ...base(), action: "complete_colour", slotId: slot.id, assetId: slot.cropAsset!.id, reviewNoChange: true })} />
          <details className={guided.disclosure}><summary>Colour needs a correction</summary><div className={styles.form}><ol className={guided.colourSteps}><li>Download this print and open it in your photo editor.</li><li>Adjust the colour and save at the same size.</li><li>Upload the corrected file, then review its saved preview.</li></ol><button className={styles.secondary} disabled={!!fileBusy} onClick={() => onDownloadAsset(slot.cropAsset!)}><Download size={14} />Download {label} cropped file</button><label style={{ marginTop: 15 }}>Upload corrected {label} file<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onCorrected(slot.id, file); }} /></label><p className={styles.muted}>Production files use sRGB. Please keep this print’s {slot.cropAsset.widthPixels} × {slot.cropAsset.heightPixels} pixels unchanged. JPEG or PNG, up to 4 MB.</p></div></details>
        </section>}
        {job.canReceive && job.status === "accepted" && job.dispatchState === "idle" && stage === "final_review" && slot.cropApproved && (!job.policy.labColourCorrection || !!slot.colourCompletedAt && !!slot.colourAsset) && final && <div className={styles.actions}><button className={styles.primary} disabled={busy || !finalVisible} onClick={() => onAction({ ...base(), action: "final_review", slotId: slot.id, assetId: final.id })}>Approve {label} final print file<CheckCircle2 size={15} /></button></div>}
        {final && !finalVisible && editable && <p className={styles.muted}>Waiting for this saved preview to load before approval is available.</p>}
        {stage === "done" && <p className={guided.reviewed}><CheckCircle2 size={16} />This print’s final file is reviewed.{guidance.slotId && guidance.slotId !== slot.id && <button className={styles.quiet} disabled={busy} onClick={() => openPrint(guidance.slotId!)}>Next: {productionV2SlotLabel(guidance.slotId)}<ArrowRight size={14} /></button>}</p>}
        {job.canChangeSource && editable && <details className={guided.disclosure}><summary>Change the photo for {label}</summary><div className={styles.form}><label>Choose another gallery photo for {label}<select value={choices[slot.id] ?? slot.photoId} disabled={busy} onChange={event => setChoices(current => ({ ...current, [slot.id]: event.target.value }))}>{job.availablePhotos.map(photo => <option key={photo.id} value={photo.id}>{photo.filename}</option>)}</select></label><p className={styles.muted}>This clears only {label} crop, colour and final reviews.</p><button className={styles.secondary} disabled={busy || (choices[slot.id] ?? slot.photoId) === slot.photoId} onClick={() => onAction({ ...base(), action: "set_slot_source", slotId: slot.id, photoId: choices[slot.id] ?? slot.photoId })}>Change {label} photo</button></div></details>}
      </>}
    </section>}
    <p className={guided.sheetHint}>After review, 5×7 A + B share one 10×7 sheet. The 8×10 uses its own sheet.</p>
    <details className={guided.disclosure}><summary>Order details, files & history</summary>
      <dl className={guided.metadata}><dt>Full order reference</dt><dd>{job.reference}</dd><dt>Saved revision</dt><dd>{job.version}</dd><dt>Photographer approval</dt><dd>{job.photographerApproved ? job.policy.autoApprove ? "Automatically approved" : "Approved" : "Needs studio review"}</dd><dt>Print reviews</dt><dd>{job.slots.filter(value => value.cropApproved).length}/3 crops · {reviewed}/3 final files</dd><dt>Windows handoff</dt><dd>{job.dispatchState === "idle" ? "Not sent" : job.dispatchState === "claimed" ? "Waiting for receipt" : job.dispatchState === "handed_off" ? "Files received · physical printing disabled" : "Check recorded handoff"}</dd>{job.reprintOf && <><dt>Linked reprint of</dt><dd>{job.reprintOf}</dd></>}</dl>
      {job.holds.length > 0 && <section className={styles.section}><h3>Pending checks</h3><ul className={styles.contents}>{job.holds.map(hold => <li key={hold}>{productionHoldLabel(hold)}</li>)}</ul></section>}
      <section className={styles.section}><h3>Saved print details</h3>{job.slots.map(value => <p className={styles.muted} key={value.id}>{productionV2SlotLabel(value.id)} · {value.source.filename} · {value.source.widthPixels} × {value.source.heightPixels} px{value.finalAsset && ` · Final SHA-256 ${value.finalAsset.sha256}`}</p>)}</section>
      {job.canReceive && <section className={styles.section}><h3>Reviewed paper files</h3><p className={styles.muted}>The left and right cells keep the independent 5×7 A and B renders. Downloads become available after all required checks pass.</p><div className={styles.actions}>{(["8x10", "10x7", "5x7-a", "5x7-b", "manifest"] as const).map(file => <button key={file} className={styles.secondary} disabled={!!fileBusy || !complete} onClick={() => onDownload(file)}><Download size={14} />{file === "manifest" ? "Order manifest" : file === "10x7" ? "10×7 sheet · A + B" : `${productionV2SlotLabel(file)} file`}</button>)}</div>{job.status === "in_production" && job.dispatchState === "idle" && complete && <details className={guided.disclosure}><summary>Finish a manual file review</summary><p className={styles.muted}>Use this only if you reviewed the downloaded paper files yourself. This does not record a Windows receipt or confirm a physical print.</p><label className={styles.check}><input type="checkbox" checked={manualReviewAcknowledged} disabled={busy} onChange={event => setManualReviewAcknowledged(event.target.checked)} /><span>I reviewed the downloaded test files outside the Windows helper.</span></label><button className={styles.secondary} disabled={busy || !manualReviewAcknowledged} onClick={() => onAction({ ...base(), action: "transition", status: "ready" })}>Mark test job ready</button></details>}</section>}
      {(job.canReopen || job.canReprint) && <section className={styles.section}><h3>Corrections & reprints</h3><div className={styles.actions}>{job.canReopen && <button className={styles.secondary} disabled={busy} onClick={() => { setCorrection("reopen"); setAcknowledged(false); setReason(""); }}>Reopen for review</button>}{job.canReprint && <button className={styles.secondary} disabled={busy} onClick={() => { setCorrection("reprint"); setAcknowledged(false); setReason(""); }}>Create linked full-package reprint</button>}</div>{correction && <div className={`${styles.notice} ${styles.form}`} style={{ marginTop: 14 }}><h3>{correction === "reopen" ? "Reopen this saved job?" : "Create a separate reprint job?"}</h3><p>{correction === "reopen" ? "This clears all final approvals. Unchanged crops and colour work are preserved. Handed-off files cannot be silently replaced." : "This creates a separate job for the complete 8×10 + 5×7 A + 5×7 B package. The original stays locked. This does not cancel an existing handoff; acceptance and print reviews must be done again."}</p><label style={{ marginTop: 12 }}>Reason · at least 5 characters<input minLength={5} maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label><label className={styles.check}><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>I reviewed the scope and understand that this action does not send a physical print job.</span></label><div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={() => setCorrection(null)}>Keep current job</button><button className={styles.primary} disabled={busy || !productionV2CorrectionReason(reason) || !acknowledged} onClick={confirmCorrection}>{correction === "reopen" ? "Confirm reopen" : "Create linked reprint"}</button></div></div>}</section>}
      <section className={styles.section}><h3>Production history</h3><ol className={styles.timeline}>{job.events.map(event => <li key={event.id}>{event.action === "reopen" ? "Job reopened for review" : event.action === "reprint" ? "Linked reprint created" : event.action === "set_slot_source" ? "Print photo changed" : productionEventLabel(event.action)} · {event.actorRole}<time dateTime={event.createdAt}>{date(event.createdAt)}</time></li>)}</ol></section>
    </details>
  </article>;
}

function ProductionV2NoChangeReview({ label, busy, onConfirm }: { label: string; busy: boolean; onConfirm: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  return <div><label className={styles.check}><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} /><span>I reviewed {label} colour and no change is needed.</span></label><button className={styles.secondary} disabled={busy || !reviewed} onClick={onConfirm}>Save {label} no-change review</button></div>;
}
