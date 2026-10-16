// Offline-durable capture queue.
//
// School gyms have terrible wifi, so a captured photo is written to IndexedDB
// the instant it's taken, then uploaded in the background with retry. A dropped
// connection (or even closing the app) never loses a photo — the queue is
// re-processed on next load and whenever the device comes back online.

export type CaptureStatus = "pending" | "uploading" | "error";

export type CaptureRecord = {
  id: string;
  ownerId?: string;
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
const USB_IMPORTS = "usbImports";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    let blocked = false;
    req.onblocked = () => {
      blocked = true;
      reject(new Error("Close other Studio OS tabs, then reopen Capture to save photos."));
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(USB_IMPORTS)) {
        db.createObjectStore(USB_IMPORTS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
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
        let tx: IDBTransaction;
        let result: T;
        let settled = false;
        let requestError: DOMException | null = null;
        try {
          tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          req.onsuccess = () => { result = req.result as T; };
          req.onerror = () => { requestError = req.error; };
        } catch (error) {
          db.close();
          reject(error);
          return;
        }
        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          db.close();
          resolve(result);
        };
        const fail = () => {
          if (settled) return;
          settled = true;
          db.close();
          reject(tx.error ?? requestError ?? new Error("Capture storage transaction failed."));
        };
        tx.onabort = fail;
        tx.onerror = fail;
      }),
  );
}

export async function addCapture(rec: CaptureRecord): Promise<void> {
  await run("readwrite", (s) => s.put(rec));
}

/** Commit the photo and its import receipt together before acknowledging the
 * native transfer. Receipts outlive uploaded photos, so an acknowledgement
 * retry cannot upload the same USB photo again or assign it to another student.
 */
export async function enqueueUsbCapture(
  rec: CaptureRecord & { ownerId: string },
  photoId: string,
): Promise<boolean> {
  if (!rec.ownerId.trim() || !photoId.trim()) {
    throw new Error("USB photos require an account and photo identifier.");
  }
  const db = await openDb();
  return new Promise<boolean>((resolve, reject) => {
    let tx: IDBTransaction;
    let added = false;
    let settled = false;
    let requestError: unknown;
    try {
      tx = db.transaction([STORE, USB_IMPORTS], "readwrite");
      const receipts = tx.objectStore(USB_IMPORTS);
      const id = `${rec.ownerId}:${photoId}`;
      const lookup = receipts.get(id);
      lookup.onsuccess = () => {
        if (lookup.result) return;
        try {
          tx.objectStore(STORE).add(rec);
          receipts.add({ id, captureId: rec.id, createdAt: Date.now() });
          added = true;
        } catch (error) {
          requestError = error;
          tx.abort();
        }
      };
      lookup.onerror = () => { requestError = lookup.error; };
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      db.close();
      resolve(added);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      db.close();
      reject(tx.error ?? requestError ?? new Error("USB photo could not be saved."));
    };
    tx.onabort = fail;
    tx.onerror = fail;
  });
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
  ownerId?: string;
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
    // The module lock prevents overlapping pumps. A persisted "uploading" row
    // belongs to an interrupted prior run and must be retried after reload.
    const queue = (await allCaptures()).filter(
      (r) => !r.ownerId || r.ownerId === hooks.ownerId,
    );
    for (const rec of queue) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      await putCapture({ ...rec, status: "uploading" });
      hooks.onChange?.();
      try {
        const form = new FormData();
        form.append("file", rec.blob, `${rec.id}.jpg`);
        form.append("schoolId", rec.schoolId);
        form.append("studentId", rec.studentId);
        if (rec.ownerId && rec.id.startsWith("usb-")) form.append("captureId", rec.id);
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
