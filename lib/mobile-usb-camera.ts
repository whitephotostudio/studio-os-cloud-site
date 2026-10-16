import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type UsbCameraStatus = {
  state: "disconnected" | "searching" | "opening" | "ready" | "busy" | "error";
  cameraName?: string;
  message?: string;
  canCapture?: boolean;
};
export type UsbPhoto = { id: string; name: string; size: number; mimeType: "image/jpeg" };
export type UsbCaptureTarget = {
  ownerId: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  className: string;
};
export interface UsbCameraPlugin {
  start(options: { ownerId: string }): Promise<UsbCameraStatus>;
  stop(): Promise<void>;
  getStatus(): Promise<UsbCameraStatus>;
  capture(options: { ownerId: string }): Promise<void>;
  listPhotos(options: { ownerId: string }): Promise<{ photos: UsbPhoto[] }>;
  readPhoto(options: { ownerId: string; id: string; offset: number; length: number }): Promise<{ data: string; done: boolean }>;
  acknowledgePhoto(options: { ownerId: string; id: string }): Promise<void>;
  addListener(event: "statusChanged", listener: (status: UsbCameraStatus) => void): Promise<PluginListenerHandle>;
  addListener(event: "photoReady", listener: (photo: UsbPhoto) => void): Promise<PluginListenerHandle>;
}

const nativeCamera = registerPlugin<UsbCameraPlugin>("StudioOSCamera");
export function getUsbCamera(): UsbCameraPlugin | null {
  return Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("StudioOSCamera")
    ? nativeCamera : null;
}

// Small bridge packets avoid putting a full DSLR JPEG into one base64 message.
export async function readUsbPhoto(camera: UsbCameraPlugin, photo: UsbPhoto, ownerId: string, signal?: AbortSignal): Promise<Blob> {
  if (photo.mimeType !== "image/jpeg" || !Number.isSafeInteger(photo.size) || photo.size < 3 || photo.size > 64 * 1024 * 1024) {
    throw new Error("Use JPEG or RAW + JPEG on the camera. This photo cannot be imported.");
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  while (offset < photo.size) {
    signal?.throwIfAborted();
    const length = Math.min(262144, photo.size - offset);
    const result = await camera.readPhoto({ ownerId, id: photo.id, offset, length });
    signal?.throwIfAborted();
    const bytes = Uint8Array.from(atob(result.data), (character) => character.charCodeAt(0));
    if (bytes.length !== length || result.done !== (offset + length === photo.size)) {
      throw new Error("The camera transfer is incomplete. The saved copy has been kept; try again.");
    }
    chunks.push(bytes);
    offset += bytes.length;
  }
  if (chunks[0][0] !== 0xff || chunks[0][1] !== 0xd8) throw new Error("The camera did not send a JPEG photo.");
  return new Blob(chunks, { type: "image/jpeg" });
}

/** Capture uploads use a small JPEG copy; the original remains on the camera. */
export async function prepareDslrPhoto(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Could not read this photo.");
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the photo for upload.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!jpeg || jpeg.size > 4 * 1024 * 1024) throw new Error("Could not make an upload copy. The original has been kept.");
    return jpeg;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Bind to a snapshot before any await. Acknowledge only a committed queue write. */
export async function importUsbPhoto(options: {
  camera: UsbCameraPlugin;
  photo: UsbPhoto;
  target: UsbCaptureTarget;
  prepare: (blob: Blob) => Promise<Blob>;
  enqueue: (record: UsbCaptureTarget & { id: string; blob: Blob; createdAt: number; status: "pending"; attempts: number }, photoId: string) => Promise<boolean>;
  signal?: AbortSignal;
}): Promise<boolean> {
  const { camera, photo, prepare, enqueue, signal } = options;
  const target = { ...options.target };
  const blob = await prepare(await readUsbPhoto(camera, photo, target.ownerId, signal));
  signal?.throwIfAborted();
  const added = await enqueue({ ...target, id: `usb-${target.ownerId}-${photo.id}`, blob, createdAt: Date.now(), status: "pending", attempts: 0 }, photo.id);
  signal?.throwIfAborted();
  // An acknowledgement failure is safe: the persistent receipt makes retry a no-op.
  await camera.acknowledgePhoto({ ownerId: target.ownerId, id: photo.id });
  return added;
}
