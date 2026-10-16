"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Loader2, LockKeyhole, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/labs/money";
import type { ProductionGallery as Gallery, ProductionParentAction, ProductionReceipt } from "@/lib/labs/production-types";
import { ProductionApiError, productionParentRequest, productionSessionRead, productionSessionWrite, productionToken } from "./production-client";
import { productionEventLabel } from "./production-labels";
import styles from "./production.module.css";

type Submit = Extract<ProductionParentAction, { action: "submit" }>;
const statuses = { submitted: "Submitted", accepted: "Accepted", in_production: "In production", ready: "Ready", completed: "Completed" };
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export function productionParentQuantity(value: string): number | null { return /^(?:[1-9]|10)$/.test(value) ? Number(value) : null; }

export function ProductionGallery({ galleryId }: { galleryId: string }) {
  const [gallery, setGallery] = useState<Gallery | null>(null), [receipt, setReceipt] = useState<ProductionReceipt | null>(null);
  const [access, setAccess] = useState(""), [receiptToken, setReceiptToken] = useState(""), [pending, setPending] = useState<Submit | null>(null);
  const [photoId, setPhotoId] = useState(""), [quantity, setQuantity] = useState("1"), [packageSelected, setPackageSelected] = useState(false);
  const [loadedPhotos, setLoadedPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const key = `studio-os-production-parent:${galleryId}`;
  useEffect(() => {
    const controller = new AbortController();
    async function open() {
      const saved = productionSessionRead<{ token: string }>(`${key}:receipt`), waiting = productionSessionRead<Submit>(`${key}:pending`);
      const validPending = waiting?.action === "submit" && waiting.galleryId === galleryId && /^[a-f0-9]{64}$/.test(waiting.receiptToken) ? waiting : null;
      if (validPending) { setPending(validPending); setPhotoId(validPending.photoId); setQuantity(String(validPending.quantity)); setPackageSelected(true); }
      const savedReceipt = saved?.token && /^[a-f0-9]{64}$/.test(saved.token) ? saved.token : "";
      if (savedReceipt || validPending) {
        const token = savedReceipt || validPending!.receiptToken;
        try {
          const result = await productionParentRequest({ action: "receipt", receiptToken: token }, controller.signal);
          if (controller.signal.aborted) return;
          if (!result.receipt) throw new Error("The saved receipt was not returned.");
          productionSessionWrite(`${key}:receipt`, { token }); sessionStorage.removeItem(`${key}:pending`);
          setReceiptToken(token); setReceipt(result.receipt); setPending(null); return;
        } catch (cause) { if (controller.signal.aborted) return; if (savedReceipt || !(cause instanceof ProductionApiError) || cause.status !== 404) throw cause; }
      }
      const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("access");
      if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Open the full private gallery link supplied by your studio.");
      const result = await productionParentRequest({ action: "gallery", galleryId, accessToken: token }, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.gallery) throw new Error("The private gallery was not returned.");
      setAccess(token); setGallery(result.gallery);
    }
    open().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "This private gallery could not be opened."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [galleryId, key]);
  async function submit(attempt?: Submit) {
    if (busy) return;
    const count = productionParentQuantity(quantity);
    if (!attempt && (!gallery || !photoId || !loadedPhotos.includes(photoId) || !count || !packageSelected)) { setError("Wait for your private photo preview, select the package and enter 1 to 10 package sets."); return; }
    const body: Submit = attempt ?? { action: "submit", galleryId, accessToken: access, requestId: crypto.randomUUID(), receiptToken: productionToken(), photoId, quantity: count! };
    try { productionSessionWrite(`${key}:pending`, body); setPending(body); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The private receipt could not be retained."); return; }
    setBusy(true); setError("");
    try {
      const result = await productionParentRequest(body);
      if (!result.receipt) throw new Error("The order could not be confirmed. Retry the same request to check its result.");
      productionSessionWrite(`${key}:receipt`, { token: body.receiptToken }); sessionStorage.removeItem(`${key}:pending`);
      setReceiptToken(body.receiptToken); setReceipt(result.receipt); setPending(null); setNotice("Your private test order is saved. Your studio can now review its production checks.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The order could not be confirmed. Retry the same retained request."); }
    finally { setBusy(false); }
  }
  async function refresh() {
    if (!receiptToken || busy) return; setBusy(true); setError("");
    try { const result = await productionParentRequest({ action: "receipt", receiptToken }); if (!result.receipt) throw new Error("The latest saved receipt was not returned."); setReceipt(result.receipt); setNotice("The latest saved order status is shown below."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The status could not be refreshed."); }
    finally { setBusy(false); }
  }
  const count = productionParentQuantity(quantity);
  return <div className={styles.shell}><main className={styles.page} style={{ maxWidth: 1080 }}><header className={styles.header}><div><div className={styles.eyebrow}>{receipt?.studioName || gallery?.studioName || "STUDIO OS"}</div><h1>{receipt ? "Your saved order" : gallery?.name || "Private photo gallery"}</h1></div><span className={styles.badge}><LockKeyhole size={13} />Private test</span></header><div className={styles.boundary}>Private production rehearsal using your studio’s photos and prices. No payment collected. Physical printing is disabled.</div>
    {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
    {loading ? <section className={styles.empty}><Loader2 size={27} className={styles.spin} /><h2>Opening your gallery</h2></section> : receipt ? <ProductionReceiptView receipt={receipt} busy={busy} onRefresh={() => void refresh()} /> : gallery ? <>
      {pending && !busy && <div className={styles.notice}>The original order is waiting for confirmation. Its photo, quantity and request ID are retained.<div className={styles.actions}><button className={styles.primary} onClick={() => void submit(pending)}>Retry same order</button></div></div>}
      <form className={styles.grid} onSubmit={event => { event.preventDefault(); void submit(pending ?? undefined); }}><section className={styles.panel}><h2>1. Choose your photo</h2><div className={styles.photos}>{gallery.photos.map(photo => <label key={photo.id} className={styles.photo} data-selected={photo.id === photoId}><ProductionParentPhoto galleryId={gallery.id} accessToken={access} photo={photo} onReady={() => setLoadedPhotos(current => current.includes(photo.id) ? current : [...current, photo.id])} /><span><input type="radio" name="production-photo" checked={photo.id === photoId} disabled={busy || !!pending || !loadedPhotos.includes(photo.id)} onChange={() => setPhotoId(photo.id)} />{photo.filename}</span></label>)}</div></section><section className={`${styles.panel} ${styles.form}`}><h2>2. Choose your package</h2><div className={styles.offer}><label className={styles.check}><input type="checkbox" checked={packageSelected} disabled={busy || !!pending} onChange={event => setPackageSelected(event.target.checked)} /><span>{gallery.offer.name}</span></label><ul className={styles.contents}>{gallery.offer.contents.map((content, index) => <li key={index}>{content.qty} × {content.name}</li>)}</ul><strong className={styles.price}>{formatCurrency(gallery.offer.retailCents, gallery.currency)}</strong><p className={styles.muted}>Per package · One chosen photo</p></div><label>Package sets<input type="number" inputMode="numeric" min="1" max="10" step="1" value={quantity} disabled={busy || !!pending} onChange={event => setQuantity(event.target.value)} /></label><div className={styles.offer}><p>{count ? `${count} package ${count === 1 ? "set" : "sets"}` : "Enter 1 to 10 package sets"}</p><strong className={styles.price}>{formatCurrency(gallery.offer.retailCents * (count || 0), gallery.currency)}</strong><p className={styles.muted}>Saved test subtotal. Tax and shipping are not collected in this rehearsal.</p></div><button className={styles.primary} style={{ width: "100%" }} disabled={busy || !photoId || !pending && !loadedPhotos.includes(photoId) || !packageSelected || !count}>{busy ? <Loader2 className={styles.spin} size={15} /> : <CheckCircle2 size={15} />}{busy ? "Saving order…" : pending ? "Retry same order" : "Place private test order"}</button><p className={styles.muted} style={{ marginTop: 15 }}>Your studio reviews the selected photo for each print size before production preparation. Keep this browser session to refresh your receipt.</p></section></form>
    </> : <section className={`${styles.panel} ${styles.empty}`}><h2>This gallery needs its private link</h2><p>Return to the full link provided by your studio. Only a valid private link opens these photos.</p></section>}
  </main></div>;
}

function ProductionParentPhoto({ galleryId, accessToken, photo, onReady }: { galleryId: string; accessToken: string; photo: Gallery["photos"][number]; onReady: () => void }) {
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); let objectUrl = ""; fetch("/api/labs-pilot/production", { method: "POST", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "photo", galleryId, accessToken, photoId: photo.id }) }).then(async response => { if (!response.ok) throw new Error("The private photo preview could not be loaded."); const blob = await response.blob(); if (controller.signal.aborted) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Private preview unavailable."); }); return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [galleryId, accessToken, photo.id]);
  return url ? <Image unoptimized src={url} width={photo.widthPixels} height={photo.heightPixels} alt={photo.filename} onLoad={onReady} /> : <p className={styles.muted}>{error || "Loading private photo…"}</p>;
}

export function ProductionReceiptView({ receipt, busy, onRefresh }: { receipt: ProductionReceipt; busy: boolean; onRefresh: () => void }) {
  return <section className={styles.panel}><header className={styles.detailHead}><div><div className={styles.eyebrow}>PRIVATE TEST RECEIPT</div><h2>{receipt.reference}</h2><p>{receipt.studioName} · {date(receipt.createdAt)}</p></div><span className={styles.status}>{statuses[receipt.status]}</span></header><h3>{receipt.offer.name}</h3><p className={styles.muted}>{receipt.quantity} package {receipt.quantity === 1 ? "set" : "sets"}</p><ul className={styles.contents}>{receipt.offer.contents.map((content, index) => <li key={index}>{content.qty * receipt.quantity} × {content.name}</li>)}</ul><strong className={styles.price}>{formatCurrency(receipt.subtotalMinor, receipt.currency)}</strong><p className={styles.muted}>No payment collected. This is a private test receipt; physical printing stays disabled.</p><section className={styles.section}><h3>Order progress</h3><ol className={styles.timeline}>{receipt.events.map(event => <li key={event.id}>{productionEventLabel(event.action)}<time dateTime={event.createdAt}>{date(event.createdAt)}</time></li>)}</ol><button className={styles.secondary} disabled={busy} onClick={onRefresh} style={{ marginTop: 18 }}><RefreshCw size={14} className={busy ? styles.spin : ""} />Refresh order status</button></section></section>;
}
