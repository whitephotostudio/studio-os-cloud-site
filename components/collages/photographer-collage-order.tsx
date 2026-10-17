"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import type { CollageOrderSnapshot } from "@/lib/collage-checkout";

export function PhotographerCollageOrder({ orderId }: { orderId: string }) {
  const [prints, setPrints] = useState<Array<{ id: string; selection: CollageOrderSnapshot }>>([]);
  const [error, setError] = useState("");
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [loadedOrderId, setLoadedOrderId] = useState("");
  const outputUrls = useRef<string[]>([]);
  const activeOrder = useRef(orderId);
  useEffect(() => {
    let cancelled = false;
    activeOrder.current = orderId;
    void fetch(`/api/dashboard/collages/order?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" }).then(async response => {
      const payload = await response.json();
      if (!response.ok) throw Error(payload.message || "Could not load the collage print recipes.");
      if (!cancelled) { setPrints(payload.prints ?? []); setOutputs({}); setError(""); setLoadedOrderId(orderId); }
    }).catch(e => { if (!cancelled) { setPrints([]); setOutputs({}); setError(e.message); setLoadedOrderId(orderId); } });
    return () => { cancelled = true; activeOrder.current = ""; outputUrls.current.forEach(url => URL.revokeObjectURL(url)); outputUrls.current = []; };
  }, [orderId]);
  async function prepare(id: string) {
    setBusy(id); setError("");
    try {
      const response = await fetch(`/api/dashboard/collages/production?orderId=${encodeURIComponent(orderId)}&itemId=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) { const payload = await response.json(); throw Error(payload.message || "Could not prepare this collage."); }
      const blob = await response.blob();
      const expected = response.headers.get("X-Collage-Sha256");
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), n => n.toString(16).padStart(2, "0")).join("");
      if (!expected || hash !== expected) throw Error("The finished collage failed its integrity check.");
      if (activeOrder.current !== orderId) return;
      const url = URL.createObjectURL(blob); outputUrls.current.push(url);
      setOutputs(previous => ({ ...previous, [id]: url }));
    } catch (e) { if (activeOrder.current === orderId) setError(e instanceof Error ? e.message : "Could not prepare this collage."); }
    finally { if (activeOrder.current === orderId) setBusy(""); }
  }
  if (loadedOrderId !== orderId || (!prints.length && !error)) return null;
  return <section style={{ padding: 16, border: "1px solid #cbd5e1", borderRadius: 12, marginBottom: 16, color: "#172033", background: "white" }}>
    <h3 style={{ marginTop: 0 }}>Collage prints · saved parent selections</h3>
    {error && <p role="alert">{error}</p>}
    {prints.map(({ id, selection }, index) => <article key={id} style={{ borderTop: "1px solid #e2e8f0", paddingTop: 12, marginTop: 12 }}>
      <strong>Print {index + 1}: {selection.design.name}</strong>
      <p>{selection.design.widthInches} × {selection.design.heightInches} in · bleed {selection.design.bleedInches ?? 0} in · template v{selection.versionNumber} · one finished image</p>
      <p>{Object.values(selection.caption).filter(Boolean).join(" · ")}</p>
      <details style={{ overflowWrap: "anywhere" }}><summary>Photos and crops selected by the parent</summary><ul>{selection.placements.map(p => <li key={p.slotId}>{selection.design.slots.find(slot => slot.id === p.slotId)?.label}: {p.mediaId} · zoom {p.zoom.toFixed(2)} · horizontal {Math.round(p.x * 100)}% · vertical {Math.round(p.y * 100)}%</li>)}</ul></details>
      {outputs[id] ? <div style={{ marginTop: 12 }}><img src={outputs[id]} alt={`Finished ${selection.design.name}`} style={{ width: "100%", maxWidth: 340, display: "block" }} /><a href={outputs[id]} download={`collage-${orderId}-${id}-300ppi.png`}>Download finished print PNG</a></div> : <button type="button" disabled={!!busy} onClick={() => void prepare(id)} style={{ marginTop: 12, padding: 10, borderRadius: 8 }}>{busy === id ? "Rendering original photos…" : "Prepare finished print"}</button>}
    </article>)}
    <p style={{ fontSize: 12 }}>Paid orders render from the frozen design and original photos. The order ZIP includes every collage print, its hash and resolution report.</p>
  </section>;
}
