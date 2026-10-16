"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Loader2, LockKeyhole, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/labs/money";
import type { ProductionGallery as Gallery } from "@/lib/labs/production-types";
import { PRODUCTION_V2_SLOT_IDS, type ProductionV2ParentAction, type ProductionV2Receipt, type ProductionV2Selections, type ProductionV2SlotId } from "@/lib/labs/production-v2-types";
import { ProductionApiError, productionSessionRead, productionSessionWrite, productionToken } from "./production-client";
import { productionV2ParentRequest } from "./production-v2-client";
import { productionV2SlotLabel } from "./production-v2-labels";
import { productionEventLabel } from "./production-labels";
import styles from "./production.module.css";
import slotStyles from "./production-v2.module.css";

type Submit = Extract<ProductionV2ParentAction, { action: "submit" }>;
const emptySelections: ProductionV2Selections = { "8x10": "", "5x7-a": "", "5x7-b": "" };
const statuses = { submitted: "Submitted", accepted: "Accepted", in_production: "In production", ready: "Ready", completed: "Completed" };
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export function productionV2ParentQuantity(value: string): number | null { return /^(?:[1-9]|10)$/.test(value) ? Number(value) : null; }
export function productionV2SelectionsValid(selections: ProductionV2Selections, photos: Pick<Gallery["photos"][number], "id">[], loadedIds: string[]): boolean {
  return PRODUCTION_V2_SLOT_IDS.every(slotId => !!selections[slotId] && photos.some(photo => photo.id === selections[slotId]) && loadedIds.includes(selections[slotId]));
}

export function ProductionV2Gallery({ galleryId }: { galleryId: string }) {
  const [gallery, setGallery] = useState<Gallery | null>(null), [receipt, setReceipt] = useState<ProductionV2Receipt | null>(null);
  const [access, setAccess] = useState(""), [receiptToken, setReceiptToken] = useState(""), [pending, setPending] = useState<Submit | null>(null);
  const [selections, setSelections] = useState<ProductionV2Selections>(emptySelections), [activeSlot, setActiveSlot] = useState<ProductionV2SlotId>("8x10");
  const [quantity, setQuantity] = useState("1"), [packageSelected, setPackageSelected] = useState(false), [previews, setPreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const key = `studio-os-production-v2-parent:${galleryId}`;
  useEffect(() => {
    const controller = new AbortController();
    async function open() {
      const saved = productionSessionRead<{ token: string }>(`${key}:receipt`), waiting = productionSessionRead<Submit>(`${key}:pending`);
      const validPending = waiting?.action === "submit" && waiting.galleryId === galleryId && /^[a-f0-9]{64}$/.test(waiting.receiptToken) && PRODUCTION_V2_SLOT_IDS.every(slotId => typeof waiting.selections?.[slotId] === "string") ? waiting : null;
      if (validPending) { setPending(validPending); setSelections(validPending.selections); setQuantity(String(validPending.quantity)); setPackageSelected(true); }
      const savedReceipt = saved?.token && /^[a-f0-9]{64}$/.test(saved.token) ? saved.token : "";
      if (savedReceipt || validPending) {
        const token = savedReceipt || validPending!.receiptToken;
        try {
          const result = await productionV2ParentRequest({ action: "receipt", receiptToken: token }, controller.signal);
          if (controller.signal.aborted) return;
          if (!result.receipt) throw new Error("The saved receipt was not returned.");
          productionSessionWrite(`${key}:receipt`, { token }); sessionStorage.removeItem(`${key}:pending`);
          setReceiptToken(token); setReceipt(result.receipt); setPending(null); return;
        } catch (cause) { if (controller.signal.aborted) return; if (savedReceipt || !(cause instanceof ProductionApiError) || cause.status !== 404) throw cause; }
      }
      const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("access");
      if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Open the full private gallery link supplied by your studio.");
      const result = await productionV2ParentRequest({ action: "gallery", galleryId, accessToken: token }, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.gallery) throw new Error("The private gallery was not returned.");
      setAccess(token); setGallery(result.gallery);
    }
    open().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "This private gallery could not be opened."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [galleryId, key]);
  async function submit(attempt?: Submit) {
    if (busy) return;
    const count = productionV2ParentQuantity(quantity);
    if (!attempt && (!gallery || !productionV2SelectionsValid(selections, gallery.photos, Object.keys(previews)) || !count || !packageSelected)) { setError("Choose and preview a photo for all three prints, select the package and enter 1 to 10 complete package sets."); return; }
    const body: Submit = attempt ?? { action: "submit", galleryId, accessToken: access, requestId: crypto.randomUUID(), receiptToken: productionToken(), selections: { ...selections }, quantity: count! };
    try { productionSessionWrite(`${key}:pending`, body); setPending(body); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The private receipt could not be retained."); return; }
    setBusy(true); setError("");
    try {
      const result = await productionV2ParentRequest(body);
      if (!result.receipt) throw new Error("The order could not be confirmed. Retry the same request to check its result.");
      productionSessionWrite(`${key}:receipt`, { token: body.receiptToken }); sessionStorage.removeItem(`${key}:pending`);
      setReceiptToken(body.receiptToken); setReceipt(result.receipt); setPending(null); setNotice("Your private test order and three photo choices are saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The order could not be confirmed. Retry the same retained request."); }
    finally { setBusy(false); }
  }
  async function refresh() {
    if (!receiptToken || busy) return; setBusy(true); setError("");
    try { const result = await productionV2ParentRequest({ action: "receipt", receiptToken }); if (!result.receipt) throw new Error("The latest saved receipt was not returned."); setReceipt(result.receipt); setNotice("The latest saved order status is shown below."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The status could not be refreshed."); }
    finally { setBusy(false); }
  }
  const count = productionV2ParentQuantity(quantity), choicesReady = !!gallery && productionV2SelectionsValid(selections, gallery.photos, Object.keys(previews));
  return <div className={styles.shell}><main className={styles.page} style={{ maxWidth: 1120 }}><header className={styles.header}><div><div className={styles.eyebrow}>{receipt?.studioName || gallery?.studioName || "STUDIO OS"}</div><h1>{receipt ? "Your saved order" : gallery?.name || "Private three-print gallery"}</h1></div><span className={styles.badge}><LockKeyhole size={13} />Private test</span></header><div className={styles.boundary}>Choose each print’s photo. Private test only: no payment collected and physical printing disabled.</div>
    {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
    {loading ? <section className={styles.empty}><Loader2 size={27} className={styles.spin} /><h2>Opening your gallery</h2></section> : receipt ? <ProductionV2ReceiptView receipt={receipt} busy={busy} onRefresh={() => void refresh()} /> : gallery ? <>
      {pending && !busy && <div className={styles.notice}>The original order is waiting for confirmation. All three photo choices, quantity and request ID are retained.<div className={styles.actions}><button className={styles.primary} onClick={() => void submit(pending)}>Retry same order</button></div></div>}
      <form onSubmit={event => { event.preventDefault(); void submit(pending ?? undefined); }}><section className={styles.panel}><h2>1. Choose a photo for each print</h2><p className={styles.muted}>Choose three different photos or use the same photo more than once. Every package set repeats these exact choices.</p><div className={slotStyles.slots}>{PRODUCTION_V2_SLOT_IDS.map(slotId => { const photo = gallery.photos.find(value => value.id === selections[slotId]); return <article key={slotId} className={`${slotStyles.slot} ${styles.form}`} data-active={activeSlot === slotId}><button type="button" className={styles.quiet} aria-pressed={activeSlot === slotId} onClick={() => setActiveSlot(slotId)}>Choose {productionV2SlotLabel(slotId)}</button><div className={slotStyles.selectedPreview}>{photo && previews[photo.id] ? <Image unoptimized src={previews[photo.id]} width={photo.widthPixels} height={photo.heightPixels} alt={`${productionV2SlotLabel(slotId)}: ${photo.filename}`} /> : <p className={styles.muted}>No photo selected</p>}</div><label>Photo for {productionV2SlotLabel(slotId)}<select value={selections[slotId]} disabled={busy || !!pending} onChange={event => setSelections(current => ({ ...current, [slotId]: event.target.value }))}><option value="">Choose a photo</option>{gallery.photos.map(value => <option key={value.id} value={value.id} disabled={!previews[value.id]}>{value.filename}</option>)}</select></label><p className={styles.muted}>1 print per package set</p></article>; })}</div><h3 style={{ marginTop: 22 }}>Tap a photo to use it for {productionV2SlotLabel(activeSlot)}</h3><div className={styles.photos}>{gallery.photos.map(photo => <button type="button" key={photo.id} className={styles.photo} aria-label={`Use ${photo.filename} for ${productionV2SlotLabel(activeSlot)}`} data-selected={selections[activeSlot] === photo.id} disabled={busy || !!pending || !previews[photo.id]} onClick={() => setSelections(current => ({ ...current, [activeSlot]: photo.id }))}><ProductionV2ParentPhoto galleryId={gallery.id} accessToken={access} photo={photo} onReady={url => setPreviews(current => current[photo.id] === url ? current : { ...current, [photo.id]: url })} /><span>{photo.filename}</span></button>)}</div></section>
      <section className={`${styles.panel} ${styles.form}`}><h2>2. Review your package</h2><div className={styles.offer}><label className={styles.check}><input type="checkbox" checked={packageSelected} disabled={busy || !!pending} onChange={event => setPackageSelected(event.target.checked)} /><span>{gallery.offer.name}</span></label><ul className={styles.contents}>{PRODUCTION_V2_SLOT_IDS.map(slotId => <li key={slotId}>{productionV2SlotLabel(slotId)} · {gallery.photos.find(photo => photo.id === selections[slotId])?.filename || "Choose a photo above"}</li>)}</ul><strong className={styles.price}>{formatCurrency(gallery.offer.retailCents, gallery.currency)}</strong><p className={styles.muted}>Per complete package · One 8×10 and two individually chosen 5×7 prints</p></div><label style={{ maxWidth: 220 }}>Complete package sets<input type="number" inputMode="numeric" min="1" max="10" step="1" value={quantity} disabled={busy || !!pending} onChange={event => setQuantity(event.target.value)} /></label><div className={styles.offer}><p>{count ? `${count} package ${count === 1 ? "set" : "sets"} · ${count * 3} prints` : "Enter 1 to 10 package sets"}</p><strong className={styles.price}>{formatCurrency(gallery.offer.retailCents * (count || 0), gallery.currency)}</strong><p className={styles.muted}>Saved test subtotal. Tax and shipping are not collected in this rehearsal.</p></div><button className={styles.primary} disabled={busy || !pending && !choicesReady || !packageSelected || !count}>{busy ? <Loader2 className={styles.spin} size={15} /> : <CheckCircle2 size={15} />}{busy ? "Saving order…" : pending ? "Retry same order" : "Place private test order"}</button><p className={styles.muted} style={{ marginTop: 15 }}>Each chosen print is cropped and reviewed separately before preparation. Keep this browser session to refresh your private receipt.</p></section></form>
    </> : <section className={`${styles.panel} ${styles.empty}`}><h2>This gallery needs its private link</h2><p>Return to the full link provided by your studio.</p></section>}
  </main></div>;
}

function ProductionV2ParentPhoto({ galleryId, accessToken, photo, onReady }: { galleryId: string; accessToken: string; photo: Gallery["photos"][number]; onReady: (url: string) => void }) {
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); let objectUrl = ""; fetch("/api/labs-pilot/production-v2", { method: "POST", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "photo", galleryId, accessToken, photoId: photo.id }) }).then(async response => { if (!response.ok) throw new Error("The private photo preview could not be loaded."); const blob = await response.blob(); if (controller.signal.aborted) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Private preview unavailable."); }); return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [galleryId, accessToken, photo.id]);
  return url ? <Image unoptimized src={url} width={photo.widthPixels} height={photo.heightPixels} alt={photo.filename} onLoad={() => onReady(url)} /> : <p className={styles.muted}>{error || "Loading private photo…"}</p>;
}

export function ProductionV2ReceiptView({ receipt, busy, onRefresh }: { receipt: ProductionV2Receipt; busy: boolean; onRefresh: () => void }) {
  return <section className={styles.panel}><header className={styles.detailHead}><div><div className={styles.eyebrow}>PRIVATE TEST RECEIPT</div><h2>{receipt.reference}</h2><p>{receipt.studioName} · {date(receipt.createdAt)}</p></div><span className={styles.status}>{statuses[receipt.status]}</span></header><h3>{receipt.offer.name}</h3><p className={styles.muted}>{receipt.quantity} complete package {receipt.quantity === 1 ? "set" : "sets"} · {receipt.quantity * 3} prints</p><ul className={styles.contents}>{receipt.printSlots.map(slot => <li key={slot.slotId}>{receipt.quantity} × {productionV2SlotLabel(slot.slotId)} · {slot.filename}</li>)}</ul><strong className={styles.price}>{formatCurrency(receipt.subtotalMinor, receipt.currency)}</strong><p className={styles.muted}>No payment collected. This is a private test receipt; physical printing stays disabled.</p><section className={styles.section}><h3>Order progress</h3><ol className={styles.timeline}>{receipt.events.map(event => <li key={event.id}>{event.action === "reopen" ? "Order reopened for review" : event.action === "set_slot_source" ? "A print photo was updated by the studio" : productionEventLabel(event.action)}<time dateTime={event.createdAt}>{date(event.createdAt)}</time></li>)}</ol><button className={styles.secondary} disabled={busy} onClick={onRefresh} style={{ marginTop: 18 }}><RefreshCw size={14} className={busy ? styles.spin : ""} />Refresh order status</button></section></section>;
}
