"use client";

import { useState } from "react";
import { CheckCircle2, FileImage, FileUp, Info, Loader2, Plus, ShieldCheck, X } from "lucide-react";
import type { Lab, LabCatalogProduct } from "@/lib/labs/types";
import type { LabOrder, LabOrderAsset, LabOrderDelivery, LabOrderSubmitAction } from "@/lib/labs/orders-types";
import { LAB_ORDER_MAX_FILE_BYTES, LAB_ORDER_MAX_LINES, LAB_ORDER_MAX_QUANTITY, labOrderAspectMatches } from "@/lib/labs/orders-validation";
import { formatCurrency } from "@/lib/labs/money";
import { LabDialog } from "./lab-dialog";
import { LabOrderApiError, labOrderRequest } from "./lab-orders-api";
import styles from "./lab-orders.module.css";

type DraftLine = { id: string; catalogProductId: string; quantity: number; file: File | null; asset: LabOrderAsset | null; uploading: boolean; error: string };
const newLine = (): DraftLine => ({ id: crypto.randomUUID(), catalogProductId: "", quantity: 1, file: null, asset: null, uploading: false, error: "" });
const productName = (product: LabCatalogProduct) => `${product.name} · ${product.size} · ${product.finish || product.category}`;

export function LabOrderCompose({ labs, catalog, onClose, onSubmitted }: { labs: Lab[]; catalog: LabCatalogProduct[]; onClose: () => void; onSubmitted: (order: LabOrder) => void }) {
  const readyLabs = labs.filter(lab => lab.status === "active" && lab.intakeEnabled && lab.catalogVerified);
  const [labId, setLabId] = useState(readyLabs[0]?.id ?? "");
  const [reference, setReference] = useState(""); const [notes, setNotes] = useState("");
  const [delivery, setDelivery] = useState<LabOrderDelivery>({ mode: "pickup", name: "", address: "" });
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [attempt, setAttempt] = useState<LabOrderSubmitAction | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [showDiscard, setShowDiscard] = useState(false);
  const lab = readyLabs.find(entry => entry.id === labId);
  const products = catalog.filter(product => product.labId === labId && product.active && product.verified && !!product.sku && product.costCents !== null);
  const productMap = new Map(products.map(product => [product.id, product]));
  const hasFiles = lines.some(line => !!line.file || !!line.asset);
  const uploading = lines.some(line => line.uploading);
  const total = lines.reduce((sum, line) => sum + (productMap.get(line.catalogProductId)?.costCents ?? 0) * line.quantity, 0);
  const validLines = lines.every(line => { const product = productMap.get(line.catalogProductId); return product && line.asset?.ready && !line.uploading && !line.error && line.quantity >= 1 && line.quantity <= LAB_ORDER_MAX_QUANTITY && labOrderAspectMatches(line.asset.widthPixels, line.asset.heightPixels, product.widthInches, product.heightInches); });
  const valid = !!lab && !!reference.trim() && !!delivery.name.trim() && (delivery.mode === "pickup" || !!delivery.address.trim()) && validLines && acknowledged;
  const dirty = hasFiles || !!reference || !!notes || !!delivery.name || !!delivery.address;
  const close = () => { if (dirty || attempt) setShowDiscard(true); else onClose(); };
  function changeLine(id: string, changes: Partial<DraftLine>) { setLines(current => current.map(line => line.id === id ? { ...line, ...changes } : line)); }
  async function upload(id: string, file: File) {
    if (!lab) return;
    if (file.size > LAB_ORDER_MAX_FILE_BYTES) { changeLine(id, { file, asset: null, error: "Choose a final JPEG or PNG smaller than 4 MB.", uploading: false }); return; }
    if (!["image/jpeg", "image/png"].includes(file.type)) { changeLine(id, { file, asset: null, error: "Use a JPEG or PNG final print file.", uploading: false }); return; }
    changeLine(id, { file, asset: null, error: "", uploading: true });
    const form = new FormData(); form.append("labId", labId); form.append("file", file);
    try { const result = await labOrderRequest("/api/dashboard/lab-order-assets", form); if (!result.asset) throw new Error("The file upload was not confirmed. Retry this file."); changeLine(id, { asset: result.asset, uploading: false, error: "" }); }
    catch (cause) { changeLine(id, { uploading: false, error: cause instanceof Error ? cause.message : "This upload could not be confirmed. Your file is kept for retry." }); }
  }
  async function submit() {
    if (busy || uploading || !valid && !attempt) return;
    const payload: LabOrderSubmitAction = attempt ?? { action: "submit", requestId, labId, reference: reference.trim(), notes: notes.trim(), delivery: { ...delivery, name: delivery.name.trim(), address: delivery.address.trim() }, items: lines.map(line => ({ catalogProductId: line.catalogProductId, assetId: line.asset!.id, quantity: line.quantity })) };
    setAttempt(payload); setBusy(true); setError(""); setNotice("");
    try { const result = await labOrderRequest("/api/dashboard/lab-orders", payload); if (!result.order) throw new Error("The submitted order could not be confirmed. Retry this exact submission to check its result."); onSubmitted(result.order); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The submission result could not be confirmed. Your files and original request are retained."); if (cause instanceof LabOrderApiError && cause.status >= 400 && cause.status < 500) { setAttempt(null); setRequestId(crypto.randomUUID()); } }
    finally { setBusy(false); }
  }
  async function reviewPending() {
    if (!attempt) return; setBusy(true); setError("");
    try {
      const result = await labOrderRequest("/api/dashboard/lab-orders");
      const found = result.workspace?.orders.find(order => order.events.some(event => event.requestId === attempt.requestId));
      if (found) onSubmitted(found);
      else setNotice("No receipt for this request was returned in the latest orders. Your original request is still retained. Retry the same submission to confirm its outcome.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The latest orders could not be checked."); }
    finally { setBusy(false); }
  }

  return <><LabDialog title="A clear handoff to your lab." description="Upload the final files exactly as they should print. The lab receives a separate production order and handles its own billing." onClose={close} busy={busy || uploading} error={error} wide><form onSubmit={event => { event.preventDefault(); void submit(); }}><fieldset className={styles.composeFieldset} disabled={busy || !!attempt}><div className={styles.twoColumns}><label>Ready lab<select autoFocus required value={labId} disabled={hasFiles} onChange={event => { setLabId(event.target.value); setLines([newLine()]); }}><option value="">Choose a ready lab</option>{readyLabs.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.city} · {entry.currency}</option>)}</select></label><label>Order reference *<input required maxLength={120} value={reference} onChange={event => setReference(event.target.value)} placeholder="e.g. Portrait session · October" /></label></div>{hasFiles && <p className={styles.composeHint}>The lab is fixed once files are added. Start a new order to use another lab.</p>}
      <div className={styles.composeSectionHeading}><h3>Final production files</h3><span>JPEG / PNG · 4 MB per file</span></div><p className={styles.composeHint}>Export images upright, with rotation applied to the image pixels. Files that still rely on camera orientation metadata must be re-exported before uploading. Final files must match the print shape within 2%, in portrait or landscape orientation. Studio OS does not crop these files. Review colour, resolution and product size before sending.</p>
      <div className={styles.composeLines}>{lines.map((line, index) => { const product = productMap.get(line.catalogProductId); const mismatch = !!product && !!line.asset && !labOrderAspectMatches(line.asset.widthPixels, line.asset.heightPixels, product.widthInches, product.heightInches); return <article key={line.id} className={styles.composeLine}><div className={styles.composeLineHeading}><span>ITEM {index + 1}</span><button type="button" className={styles.iconButton} disabled={lines.length === 1 || line.uploading} aria-label={`Remove item ${index + 1}`} onClick={() => setLines(current => current.filter(row => row.id !== line.id))}><X size={16} /></button></div><div className={styles.productQuantity}><label>Product *<select required value={line.catalogProductId} onChange={event => changeLine(line.id, { catalogProductId: event.target.value })}><option value="">Choose an approved product</option>{products.map(entry => <option key={entry.id} value={entry.id}>{productName(entry)} · {formatCurrency(entry.costCents!, entry.currency)}</option>)}</select></label><label>Quantity *<input type="number" min="1" max={LAB_ORDER_MAX_QUANTITY} step="1" required value={line.quantity} aria-label={`Item ${index + 1} quantity${product ? `, ${productName(product)}` : ""}`} onChange={event => changeLine(line.id, { quantity: Math.max(1, Math.min(LAB_ORDER_MAX_QUANTITY, Math.floor(Number(event.target.value) || 1))) })} /></label></div><div className={styles.filePicker}><span className={styles.fileTile}><FileImage size={21} /></span><div><strong>{line.asset?.filename || line.file?.name || "Choose the finished print file"}</strong><span>{line.asset ? `${line.asset.widthPixels} × ${line.asset.heightPixels} px · Upload confirmed` : line.uploading ? "Uploading and checking the image…" : "One final image for this product and quantity."}</span></div><label className={styles.fileButton}>{line.uploading ? <Loader2 size={14} className={styles.spin} /> : <FileUp size={14} />}{line.asset ? "Replace file" : "Choose file"}<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" disabled={line.uploading} aria-label={`Final JPEG or PNG for item ${index + 1}`} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(line.id, file); }} /></label></div>{line.error && <div className={styles.fileError} role="alert"><Info size={14} /><span>{line.error}</span>{line.file && <button type="button" disabled={line.uploading} onClick={() => void upload(line.id, line.file!)}>Retry file</button>}</div>}{mismatch && <p className={styles.fileError} role="alert">This file’s shape does not match {product?.size}. Export a final file with the correct crop, then replace it here.</p>}{product && <div className={styles.composeLineTotal}><span>SKU {product.sku} · {product.widthInches} × {product.heightInches} in</span><strong>{formatCurrency((product.costCents ?? 0) * line.quantity, product.currency)}</strong></div>}</article>; })}</div>
      <button type="button" className={styles.secondary} disabled={!products.length || lines.length >= LAB_ORDER_MAX_LINES} onClick={() => setLines(current => [...current, newLine()])}><Plus size={15} />Add another item</button>{!products.length && <p className={styles.fileError}>This lab has no approved products available for direct orders.</p>}
      <div className={styles.composeSectionHeading}><h3>Delivery to your studio</h3></div><div className={styles.twoColumns}><label>Delivery method<select value={delivery.mode} onChange={event => setDelivery(current => ({ ...current, mode: event.target.value as LabOrderDelivery["mode"] }))}><option value="pickup">Pick up at the lab</option><option value="ship_to_studio">Ship to my studio</option></select></label><label>{delivery.mode === "pickup" ? "Pickup contact name *" : "Delivery recipient *"}<input required maxLength={200} value={delivery.name} onChange={event => setDelivery(current => ({ ...current, name: event.target.value }))} /></label></div>{delivery.mode === "ship_to_studio" && <label>Studio delivery address *<textarea required rows={3} maxLength={1000} value={delivery.address} onChange={event => setDelivery(current => ({ ...current, address: event.target.value }))} placeholder="Business / street address / city / region / postal code / country" /></label>}<label>Notes for the lab<textarea rows={3} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Helpful production or pickup details…" /></label>
      <div className={styles.composeEstimate}><span>Product estimate <small>{lab?.currency} · Excludes shipping, taxes and any lab adjustments.</small></span><strong>{lab ? formatCurrency(total, lab.currency) : "—"}</strong></div><label className={styles.acknowledgement}><input required type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>I reviewed these final files, crops, sizes and quantities. I understand the lab bills me separately and Studio OS does not charge a card for this submission.</span></label>
      </fieldset>{notice && <p className={styles.pendingNotice} role="status">{notice}</p>}<div className={styles.composeFooter}><span><ShieldCheck size={15} />Files and order details are fixed on submission.</span><div>{attempt && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void reviewPending()}>Check latest orders</button>}<button type="button" className={styles.secondary} disabled={busy || uploading} onClick={close}>Cancel</button><button className={styles.primary} disabled={busy || uploading || !valid && !attempt}>{busy ? <Loader2 size={15} className={styles.spin} /> : <CheckCircle2 size={15} />}{busy ? "Submitting…" : attempt ? "Retry same submission" : "Submit order to lab"}</button></div></div>{attempt && <p className={styles.retryNote}>The form is locked to the original request while its outcome is unconfirmed. Retry confirms that same order.</p>}</form></LabDialog>{showDiscard && <LabDialog title={attempt ? "Keep checking this submission?" : "Leave this order form?"} description={attempt ? "The submission outcome is unconfirmed. Retrying the original request is the reliable way to check. Leaving the form does not cancel an order the lab may already have received." : "Your current file choices and order draft will be cleared. No new order will be submitted by leaving."} onClose={() => setShowDiscard(false)}><div className={styles.actionButtons}><button className={styles.secondary} onClick={() => setShowDiscard(false)}>{attempt ? "Keep checking" : "Keep editing"}</button><button className={styles.primary} onClick={onClose}>Leave form</button></div></LabDialog>}</>;
}
