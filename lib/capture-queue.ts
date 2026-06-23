// Offline-durable capture queue.
//
// School gyms have terrible wifi, so a captured photo is written to IndexedDB
// the instant it's taken, then uploaded in the background with retry. A dropped
// connection (or even closing the app) never loses a photo — the queue is
// re-processed on next load and whenever the device comes back online.

export type CaptureStatus = "pending" | "uploading" | "error";

export type CaptureRecord = {
  id: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  className: string;
  blob: Blob;
  createdAt: number;
  status: CaptureStatus;
  attempts: number;
  lastError?: string;
};

const DB_NAME = "studio-os-capture";
const STORE = "captures";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function addCapture(rec: CaptureRecord): Promise<void> {
  await run("readwrite", (s) => s.put(rec));
}

export async function allCaptures(): Promise<CaptureRecord[]> {
  const rows = await run<CaptureRecord[]>("readonly", (s) => s.getAll());
  return (rows ?? []).sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteCapture(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}

async function putCapture(rec: CaptureRecord): Promise<void> {
  await run("readwrite", (s) => s.put(rec));
}

let processing = false;

export type ProcessHooks = {
  onChange?: () => void;
  onUploaded?: (rec: CaptureRecord) => void;
};

/** Upload every pending/errored capture. Safe to call repeatedly — it no-ops if
 *  already running or offline. */
export async function processCaptureQueue(hooks: ProcessHooks = {}): Promise<void> {
  if (processing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  processing = true;
  try {
    const queue = (await allCaptures()).filter((r) => r.status !== "uploading");
    for (const rec of queue) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      await putCapture({ ...rec, status: "uploading" });
      hooks.onChange?.();
      try {
        const form = new FormData();
        form.append("file", rec.blob, `${rec.id}.jpg`);
        form.append("schoolId", rec.schoolId);
        form.append("studentId", rec.studentId);
        const res = await fetch("/api/dashboard/capture/upload", {
          method: "POST",
          body: form,
        });
        const payload = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || payload.ok === false) {
          throw new Error(payload.error || `Upload failed (${res.status})`);
        }
        await deleteCapture(rec.id);
        hooks.onUploaded?.(rec);
      } catch (error) {
        await putCapture({
          ...rec,
          status: "error",
          attempts: rec.attempts + 1,
          lastError: error instanceof Error ? error.message : "Upload failed",
        });
      }
      hooks.onChange?.();
    }
  } finally {
    processing = false;
  }
}
