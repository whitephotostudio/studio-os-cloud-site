"use client";

import { useRef, type CSSProperties, type PointerEvent } from "react";
import Image from "next/image";
import { Check, Move, RotateCcw, Scaling } from "lucide-react";
import type { ProductionCrop } from "@/lib/labs/production-types";
import styles from "./sheet-crop-editor.module.css";

export type SheetNormalizedCrop = { x: number; y: number; width: number; height: number };
export function sheetCropFit(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): SheetNormalizedCrop {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error("Photo dimensions are unavailable.");
  const ratio = targetWidth / targetHeight, sourceRatio = sourceWidth / sourceHeight;
  const width = sourceRatio > ratio ? ratio / sourceRatio : 1, height = sourceRatio > ratio ? 1 : sourceRatio / ratio;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}
export function sheetCropPan(crop: SheetNormalizedCrop, dx: number, dy: number, viewportWidth: number, viewportHeight: number): SheetNormalizedCrop {
  if (![dx, dy, viewportWidth, viewportHeight].every(Number.isFinite) || viewportWidth <= 0 || viewportHeight <= 0) return crop;
  return { ...crop, x: Math.max(0, Math.min(1 - crop.width, crop.x - dx * crop.width / viewportWidth)), y: Math.max(0, Math.min(1 - crop.height, crop.y - dy * crop.height / viewportHeight)) };
}
export function sheetCropZoom(crop: SheetNormalizedCrop, fit: SheetNormalizedCrop, zoom: number): SheetNormalizedCrop {
  const bounded = Math.max(1, Math.min(4, Number.isFinite(zoom) ? zoom : 1)), width = fit.width / bounded, height = fit.height / bounded;
  return { x: Math.max(0, Math.min(1 - width, crop.x + (crop.width - width) / 2)), y: Math.max(0, Math.min(1 - height, crop.y + (crop.height - height) / 2)), width, height };
}
export function sheetCropToPixels(crop: SheetNormalizedCrop, width: number, height: number): ProductionCrop {
  const x = Math.max(0, Math.round(crop.x * width)), y = Math.max(0, Math.round(crop.y * height));
  return { x, y, width: Math.min(width - x, Math.max(1, Math.round(crop.width * width))), height: Math.min(height - y, Math.max(1, Math.round(crop.height * height))), rotation: 0 };
}
export function sheetCropSnap(crop: SheetNormalizedCrop, width: number, height: number): SheetNormalizedCrop { const pixels = sheetCropToPixels(crop, width, height); return { x: pixels.x / width, y: pixels.y / height, width: pixels.width / width, height: pixels.height / height }; }
export function sheetCropImageStyle(crop: SheetNormalizedCrop): CSSProperties { return { position: "absolute", maxWidth: "none", width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, left: `${-100 * crop.x / crop.width}%`, top: `${-100 * crop.y / crop.height}%` }; }

export function SheetCropFrame({ url, width, height, crop, fit, label, disabled, onChange, onReady }: { url: string; width: number; height: number; crop: SheetNormalizedCrop; fit: SheetNormalizedCrop; label: string; disabled: boolean; onChange: (crop: SheetNormalizedCrop) => void; onReady: (ready: boolean) => void }) {
  const frame = useRef<HTMLDivElement>(null), drag = useRef<{ id: number; x: number; y: number; crop: SheetNormalizedCrop; width: number; height: number; zoom: boolean } | null>(null);
  function start(event: PointerEvent<HTMLElement>, zoom = false) {
    if (disabled || event.button !== 0 || !frame.current) return;
    event.preventDefault(); event.stopPropagation(); const rect = frame.current.getBoundingClientRect();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, crop, width: rect.width, height: rect.height, zoom }; event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current; if (!current || current.id !== event.pointerId || disabled) return;
    event.preventDefault(); const dx = event.clientX - current.x, dy = event.clientY - current.y;
    onChange(current.zoom ? sheetCropZoom(current.crop, fit, fit.width / current.crop.width * Math.exp((dx - dy) / 180)) : sheetCropPan(current.crop, dx, dy, current.width, current.height));
  }
  function end(event: PointerEvent<HTMLElement>) { if (drag.current?.id === event.pointerId) { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } }
  return <div ref={frame} className={styles.frame} tabIndex={disabled ? -1 : 0} role="group" aria-label={`Move photo in ${label}. Use arrow keys or drag. Use the corner handle to resize the photo.`} onPointerDown={event => start(event)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={event => {
    if (disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 12 : 3;
    onChange(sheetCropPan(crop, event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0, event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0, frame.current?.clientWidth || 200, frame.current?.clientHeight || 200));
  }}><Image unoptimized draggable={false} src={url} width={width} height={height} alt={`Crop preview for ${label}`} style={sheetCropImageStyle(crop)} onLoad={() => onReady(true)} onError={() => onReady(false)} /><span className={styles.guide} aria-hidden="true" /><span className={styles.dragHint} aria-hidden="true"><Move size={13} />Drag photo</span><button type="button" className={styles.handle} disabled={disabled} aria-label="Drag to resize photo; photo size slider is also available" onPointerDown={event => start(event, true)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={event => { if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onChange(sheetCropZoom(crop, fit, fit.width / crop.width + (["ArrowUp", "ArrowRight"].includes(event.key) ? .05 : -.05))); } }}><Scaling size={17} aria-hidden="true" /></button></div>;
}

export function SheetCropEditor({ crop, fit, sourceWidth, sourceHeight, targetWidth, targetHeight, label, ready, reviewed, busy, onChange, onReview, onSave, onCancel }: { crop: SheetNormalizedCrop; fit: SheetNormalizedCrop; sourceWidth: number; sourceHeight: number; targetWidth: number; targetHeight: number; label: string; ready: boolean; reviewed: boolean; busy: boolean; onReview: (reviewed: boolean) => void; onChange: (crop: SheetNormalizedCrop) => void; onSave: () => void; onCancel: () => void }) {
  const zoom = fit.width / crop.width, ppi = Math.min(crop.width * sourceWidth / targetWidth, crop.height * sourceHeight / targetHeight);
  const change = (next: SheetNormalizedCrop) => { onReview(false); onChange(next); };
  return <section className={styles.editor} aria-label={`Crop controls for ${label}`}><header><h3>Adjust {label}</h3><p>Drag the photo on the paper to move it. Drag its corner handle or change the photo size below. The print stays {targetWidth} × {targetHeight} inches.</p></header><fieldset disabled={busy || !ready}><label>Photo size <output>{zoom.toFixed(2)}×</output><input type="range" min="1" max="4" step="0.01" value={zoom} onChange={event => change(sheetCropZoom(crop, fit, Number(event.target.value)))} /></label><label>Left / right<input type="range" min="0" max="100" step="1" value={crop.width >= 1 ? 50 : crop.x / (1 - crop.width) * 100} disabled={crop.width >= 1} onChange={event => change({ ...crop, x: (1 - crop.width) * Number(event.target.value) / 100 })} /></label><label>Up / down<input type="range" min="0" max="100" step="1" value={crop.height >= 1 ? 50 : crop.y / (1 - crop.height) * 100} disabled={crop.height >= 1} onChange={event => change({ ...crop, y: (1 - crop.height) * Number(event.target.value) / 100 })} /></label><p className={styles.resolution}>{Math.floor(ppi)} pixels per inch · Minimum 200</p>{ppi < 200 && <p className={styles.warning}>This crop is too small for the print. Reduce photo size or choose a larger original.</p>}{!ready && <p className={styles.resolution}>Loading the photo before crop review…</p>}<label className={styles.review}><input type="checkbox" checked={reviewed} onChange={event => onReview(event.target.checked)} /><span>I reviewed this photo’s framing for {label}.</span></label></fieldset><div className={styles.actions}><button type="button" disabled={busy} onClick={() => change(fit)}><RotateCcw size={13} />Reset</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className={styles.primary} disabled={busy || !ready || !reviewed || ppi < 200} onClick={onSave}><Check size={14} />Keep this crop</button></div></section>;
}
