"use client";

import { useState } from "react";
import Image from "next/image";
import { Crop, Loader2, RotateCcw } from "lucide-react";
import styles from "./production.module.css";

export type ProductionCropRect = { x: number; y: number; width: number; height: number };

/** A bounded, fixed-aspect crop selected by a person in upright source coordinates. */
export function productionCropRect(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number, zoom: number, horizontal: number, vertical: number): ProductionCropRect {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight, zoom].every(value => Number.isFinite(value) && value > 0)) throw new Error("The source and print dimensions are unavailable.");
  const ratio = targetWidth / targetHeight, sourceRatio = sourceWidth / sourceHeight;
  const scale = Math.max(1, Math.min(4, zoom));
  const width = (sourceRatio > ratio ? ratio / sourceRatio : 1) / scale;
  const height = (sourceRatio > ratio ? 1 : sourceRatio / ratio) / scale;
  return { x: (1 - width) * Math.max(0, Math.min(100, horizontal)) / 100, y: (1 - height) * Math.max(0, Math.min(100, vertical)) / 100, width, height };
}

export function ProductionCropEditor({ sourceUrl, sourceWidth, sourceHeight, targetWidth, targetHeight, size, busy, onSave, onCancel }: { sourceUrl: string; sourceWidth: number; sourceHeight: number; targetWidth: number; targetHeight: number; size: string; busy: boolean; onSave: (crop: ProductionCropRect) => void; onCancel: () => void }) {
  const [zoom, setZoom] = useState(1), [horizontal, setHorizontal] = useState(50), [vertical, setVertical] = useState(50), [reviewed, setReviewed] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const crop = productionCropRect(sourceWidth, sourceHeight, targetWidth, targetHeight, zoom, horizontal, vertical);
  const retainedPpi = Math.min(sourceWidth * crop.width / targetWidth, sourceHeight * crop.height / targetHeight);
  const change = (update: () => void) => { update(); setReviewed(false); };
  return <section className={styles.cropEditor} aria-label={`Crop for ${size}`}><header><div><h3><Crop size={17} />Crop for {size}</h3><p>Position the image inside the print shape. Saving asks the server to create and confirm a new print file. Changing a saved crop clears its later colour and final reviews.</p></div></header>
    <div className={styles.cropCanvas} style={{ width: `min(100%, ${Math.min(380, 480 * targetWidth / targetHeight)}px)`, maxHeight: "none", aspectRatio: `${targetWidth} / ${targetHeight}` }}><Image unoptimized src={sourceUrl} width={sourceWidth} height={sourceHeight} alt={`Manually selected crop preview for ${size}`} onLoad={() => setPreviewReady(true)} onError={() => setPreviewReady(false)} style={{ position: "absolute", maxWidth: "none", width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, left: `${-100 * crop.x / crop.width}%`, top: `${-100 * crop.y / crop.height}%` }} /><div className={styles.cropGuide} aria-hidden="true" /></div>
    <fieldset disabled={busy || !previewReady} className={styles.cropControls}><label>Zoom <output>{zoom.toFixed(2)}×</output><input type="range" min="1" max="4" step="0.01" value={zoom} onChange={event => change(() => setZoom(Number(event.target.value)))} /></label><label>Horizontal position<input type="range" min="0" max="100" step="1" value={horizontal} onChange={event => change(() => setHorizontal(Number(event.target.value)))} /></label><label>Vertical position<input type="range" min="0" max="100" step="1" value={vertical} onChange={event => change(() => setVertical(Number(event.target.value)))} /></label><p className={styles.muted}>Selected source area: approximately {Math.round(sourceWidth * crop.width)} × {Math.round(sourceHeight * crop.height)} pixels · {Math.floor(retainedPpi)} pixels per inch at {size}. Minimum 200 ppi. The original image is preserved.</p>{!previewReady && <p className={styles.muted}>Waiting for the original preview before crop approval.</p>}{retainedPpi < 200 && <p className={styles.error} role="alert">This crop retains too few pixels. Reduce zoom or use a higher-resolution original.</p>}<label className={styles.check}><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /><span>I reviewed the crop for this print size.</span></label></fieldset>
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => change(() => { setZoom(1); setHorizontal(50); setVertical(50); })}><RotateCcw size={14} />Reset</button><button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className={styles.primary} disabled={busy || !previewReady || !reviewed || retainedPpi < 200} onClick={() => onSave(crop)}>{busy ? <Loader2 size={14} className={styles.spin} /> : <Crop size={14} />}{busy ? "Generating print file…" : `Save crop for ${size}`}</button></div>
  </section>;
}
