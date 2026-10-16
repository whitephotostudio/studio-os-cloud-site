"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { enqueueUsbCapture } from "@/lib/capture-queue";
import {
  getUsbCamera, importUsbPhoto, prepareDslrPhoto, readUsbPhoto,
  type UsbCameraPlugin, type UsbCameraStatus, type UsbCaptureTarget, type UsbPhoto,
} from "@/lib/mobile-usb-camera";

const buttonStyle = { border: "1px solid #d1d5db", borderRadius: 10, padding: "10px 12px", background: "#fff", color: "#111827", fontSize: 13, fontWeight: 800, cursor: "pointer" } as const;

export default function MobileUsbCamera({ ownerId, target, onQueued, onBusyChange }: {
  ownerId: string | null;
  target: UsbCaptureTarget | null;
  onQueued: (target: UsbCaptureTarget, count: number) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [camera, setCamera] = useState<UsbCameraPlugin | null>(null);
  const [status, setStatus] = useState<UsbCameraStatus>({ state: "disconnected" });
  const [photos, setPhotos] = useState<UsbPhoto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const abortRef = useRef(new AbortController());
  const lockRef = useRef(false);
  const previewUrlRef = useRef("");

  const refreshPhotos = useCallback(async (device: UsbCameraPlugin, owner: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    const result = await device.listPhotos({ ownerId: owner });
    if (!signal.aborted) setPhotos(result.photos);
  }, []);

  useEffect(() => {
    const device = getUsbCamera();
    abortRef.current = new AbortController();
    let cancelled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the installed native plugin and account scope after hydration
    setCamera(device);
    setConnected(false);
    setPhotos([]);
    setSelected(new Set());
    setPreview(null);
    URL.revokeObjectURL(previewUrlRef.current);
    if (!device || !ownerId) return;
    void (async () => {
      const keep = async (handle: { remove: () => Promise<void> }) => {
        if (cancelled) await handle.remove();
        else handles.push(handle);
      };
      await keep(await device.addListener("statusChanged", (value) => { if (!cancelled) setStatus(value); }));
      if (cancelled) return;
      await keep(await device.addListener("photoReady", () => { if (!cancelled) void refreshPhotos(device, ownerId, abortRef.current.signal).catch(() => {}); }));
    })().catch(() => { if (!cancelled) setError("Could not open the USB camera connection."); });
    const background = () => {
      if (document.visibilityState !== "hidden") return;
      abortRef.current.abort();
      setConnected(false);
      void device.stop().catch(() => {});
    };
    document.addEventListener("visibilitychange", background);
    return () => {
      cancelled = true;
      abortRef.current.abort();
      document.removeEventListener("visibilitychange", background);
      for (const handle of handles) void handle.remove();
      void device.stop().catch(() => {});
      URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [ownerId, refreshPhotos]);

  async function connect() {
    if (!camera || !ownerId || lockRef.current) return;
    if (abortRef.current.signal.aborted) abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    lockRef.current = true;
    setWorking(true);
    setError("");
    try {
      const value = await camera.start({ ownerId });
      if (signal.aborted) return;
      setStatus(value);
      setConnected(true);
      await refreshPhotos(camera, ownerId, signal);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "Could not connect the camera.");
    } finally {
      lockRef.current = false;
      setWorking(false);
    }
  }

  async function capture() {
    if (!camera || !ownerId || lockRef.current) return;
    lockRef.current = true;
    setError("");
    try { await camera.capture({ ownerId }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The camera could not take a photo."); }
    finally { lockRef.current = false; }
  }

  async function importSelected() {
    if (!camera || !target || lockRef.current) return;
    const fixedTarget = { ...target };
    const signal = abortRef.current.signal;
    const batch = photos.filter((photo) => selected.has(photo.id));
    if (!batch.length) return;
    lockRef.current = true;
    setWorking(true);
    onBusyChange(true);
    setError("");
    let added = 0;
    try {
      for (const photo of batch) {
        if (await importUsbPhoto({ camera, photo, target: fixedTarget, prepare: prepareDslrPhoto, enqueue: enqueueUsbCapture, signal })) added += 1;
        setSelected((current) => { const next = new Set(current); next.delete(photo.id); return next; });
      }
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "Could not queue the photo. Its saved copy has been kept.");
    } finally {
      if (added && !signal.aborted) onQueued(fixedTarget, added);
      await refreshPhotos(camera, fixedTarget.ownerId, signal).catch(() => {});
      onBusyChange(false);
      setWorking(false);
      lockRef.current = false;
    }
  }

  async function showPreview(photo: UsbPhoto) {
    if (!camera || !ownerId || lockRef.current) return;
    const signal = abortRef.current.signal;
    lockRef.current = true;
    setWorking(true);
    setError("");
    try {
      const blob = await readUsbPhoto(camera, photo, ownerId, signal);
      signal.throwIfAborted();
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = URL.createObjectURL(blob);
      setPreview({ name: photo.name, url: previewUrlRef.current });
    } catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : "Could not preview the photo."); }
    finally { setWorking(false); lockRef.current = false; }
  }

  return (
    <section aria-label="USB DSLR camera" style={{ padding: 14, border: "1px solid #d1d5db", borderRadius: 14, background: "#f9fafb", display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 900, color: "#111827" }}>USB camera</div>
      {camera ? <>
        <div role="status" style={{ fontSize: 13, color: status.state === "ready" ? "#15803d" : "#374151" }}>
          {status.cameraName ? `${status.cameraName} · ` : ""}{status.message || (connected ? status.state : "Connect your camera, then tap Connect USB.")}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" style={buttonStyle} disabled={working || !ownerId} onClick={() => void connect()}>{working ? "Please wait…" : connected ? "Reconnect USB" : "Connect USB"}</button>
          {connected ? <button type="button" style={buttonStyle} disabled={working} onClick={() => void camera.stop().then(() => setConnected(false)).catch(() => setError("Could not disconnect. Unplug the USB cable."))}>Disconnect</button> : null}
          {status.canCapture && connected ? <button type="button" style={buttonStyle} disabled={working || status.state !== "ready"} onClick={() => void capture()}>Take photo</button> : null}
        </div>
        <div style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.5 }}>Set the camera to JPEG or RAW + JPEG. New photos appear here for review. Select the photos and confirm the student before uploading. Capture copies are resized; originals stay on the camera.</div>
        {photos.length ? <>
          <div style={{ fontWeight: 800, fontSize: 13 }}>{photos.length} photo{photos.length === 1 ? "" : "s"} to review</div>
          <div style={{ display: "grid", gap: 8, maxHeight: 240, overflowY: "auto" }}>
            {photos.map((photo) => <div key={photo.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 0, fontSize: 13 }}>
                <input type="checkbox" disabled={working} checked={selected.has(photo.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(photo.id); else next.delete(photo.id); return next; })} />
                <span style={{ overflowWrap: "anywhere" }}>{photo.name}</span>
              </label>
              <button type="button" style={buttonStyle} disabled={working} onClick={() => void showPreview(photo)}>Preview</button>
            </div>)}
          </div>
          {preview ? <figure style={{ margin: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- private native photo object URL */}
            <img src={preview.url} alt={preview.name} style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 10 }} />
            <figcaption style={{ fontSize: 12 }}>{preview.name}</figcaption>
          </figure> : null}
          <button type="button" style={{ ...buttonStyle, background: "#111827", color: "#fff" }} disabled={working || !target || selected.size === 0} onClick={() => void importSelected()}>
            {target ? `Add ${selected.size} selected to ${target.studentName}` : "Scan a student or enter their PIN first"}
          </button>
        </> : null}
      </> : <div style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.5 }}>Direct USB needs the Studio OS iPhone app with USB camera support. Safari and older app builds can import photos already saved to Photos or Files using the button below.</div>}
      <details style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.5 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Camera says Busy / camera compatibility</summary>
        <p>Finish any photo transfer, disconnect USB, close Photos and other camera apps, then switch the camera off and on. Reconnect with a data cable and tap Connect USB. For the Canon 1D X Mark III USB connection, disable its wireless connection first.</p>
        <p>USB controls depend on the camera model. The app checks capabilities before offering capture. Each model needs a real camera test; connection support does not guarantee remote shooting. Photos import is also available after transferring with your camera&apos;s own app.</p>
      </details>
      {error ? <div role="alert" style={{ color: "#9f2f24", fontSize: 13 }}>{error}</div> : null}
    </section>
  );
}
