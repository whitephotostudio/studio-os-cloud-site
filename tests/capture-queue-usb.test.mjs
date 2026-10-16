import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadMobileUsbCamera, usbPhotoFixture } from "./helpers/mobile-usb-camera-harness.mjs";

const compiled = ts.transpileModule(
  fs.readFileSync(new URL("../lib/capture-queue.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const tick = () => new Promise(resolve => setImmediate(resolve));

// Model separate request-success and transaction-commit events. Writes become
// visible only at commit and are discarded on abort; the controllable commit
// boundary catches premature native acknowledgements without a browser runtime.
function indexedDbHarness({ legacy = [] } = {}) {
  const data = new Map([["captures", new Map(legacy.map(row => [row.id, row]))]]);
  const state = {
    version: 1, closed: 0, transactions: [], holdNext: false,
    abortNext: false, failStore: null, blockNext: false, unblock: null,
  };
  const copy = name => new Map(data.get(name));
  const indexedDB = {
    open(_name, version) {
      const req = {};
      queueMicrotask(() => {
        const db = {
          objectStoreNames: { contains: name => data.has(name) },
          createObjectStore(name) { data.set(name, new Map()); },
          close() { state.closed += 1; },
          transaction(names, mode) {
            const stores = Array.isArray(names) ? names : [names];
            const staged = new Map(stores.map(name => [name, copy(name)]));
            const held = state.holdNext, abortAtCommit = state.abortNext;
            state.holdNext = false; state.abortNext = false;
            let pending = 0, done = false, scheduled = false;
            const tx = {
              mode, stores, ready: false, error: null,
              abort() {
                if (done) return;
                done = true;
                tx.error ??= new Error("Transaction aborted");
                tx.onabort?.();
              },
              complete() {
                if (done || pending) return;
                if (abortAtCommit) return tx.abort();
                done = true;
                if (mode === "readwrite") {
                  for (const [name, rows] of staged) data.set(name, rows);
                }
                tx.oncomplete?.();
              },
              objectStore(name) {
                if (!staged.has(name)) throw new Error("Store outside transaction");
                const rows = staged.get(name);
                const request = (operation, write = false) => {
                  if (done) throw new Error("Inactive transaction");
                  const result = {};
                  pending += 1;
                  queueMicrotask(() => {
                    if (done) return;
                    try {
                      if (write && state.failStore === name) {
                        state.failStore = null;
                        throw new Error("Disk quota exceeded");
                      }
                      result.result = operation();
                      result.onsuccess?.();
                    } catch (error) {
                      result.error = error;
                      tx.error = error;
                      result.onerror?.();
                      tx.onerror?.();
                      tx.abort();
                    }
                    pending -= 1;
                    schedule();
                  });
                  return result;
                };
                return {
                  get: id => request(() => rows.get(id)),
                  getAll: () => request(() => [...rows.values()]),
                  put: row => request(() => { rows.set(row.id, row); return row.id; }, true),
                  add: row => request(() => {
                    if (rows.has(row.id)) throw new Error("Duplicate capture id");
                    rows.set(row.id, row); return row.id;
                  }, true),
                  delete: id => request(() => rows.delete(id), true),
                };
              },
            };
            function schedule() {
              if (scheduled || done || pending) return;
              scheduled = true;
              setImmediate(() => {
                scheduled = false;
                if (done || pending) return;
                tx.ready = true;
                if (!held) tx.complete();
              });
            }
            state.transactions.push(tx);
            return tx;
          },
        };
        const finishOpen = () => {
          req.result = db;
          if (version > state.version) {
            state.version = version;
            req.onupgradeneeded?.();
          }
          req.onsuccess?.();
        };
        if (state.blockNext) {
          state.blockNext = false;
          state.unblock = finishOpen;
          req.onblocked?.();
        } else finishOpen();
      });
      return req;
    },
  };
  return { indexedDB, data, state };
}

function load(harness, fetch = async () => ({ ok: true, json: async () => ({ ok: true }) })) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, indexedDB: harness.indexedDB, fetch,
    navigator: { onLine: true }, FormData, Blob, Date, console,
  });
  return exports;
}

function capture(id = "capture-1", ownerId = "account-a", studentId = "student-a") {
  return {
    id, ownerId, schoolId: "school-a", studentId,
    studentName: "Student", className: "Grade 9",
    blob: new Blob([new Uint8Array([255, 216, 255, 217])], { type: "image/jpeg" }),
    createdAt: 1, status: "pending", attempts: 0,
  };
}

test("capture writes resolve after transaction commit, never after request success", async () => {
  const harness = indexedDbHarness(), queue = load(harness);
  harness.state.holdNext = true;
  let settled = false;
  const write = queue.addCapture(capture()).then(() => { settled = true; });
  await tick(); await tick();
  assert.equal(harness.state.transactions[0].ready, true);
  assert.equal(settled, false);
  assert.equal(harness.data.get("captures").size, 0);
  harness.state.transactions[0].complete();
  await write;
  assert.equal(harness.data.get("captures").size, 1);
  assert.equal(harness.state.closed, 1);
});

test("request success followed by transaction abort rejects and persists no capture", async () => {
  const harness = indexedDbHarness(), queue = load(harness);
  harness.state.abortNext = true;
  await assert.rejects(queue.addCapture(capture()), /aborted/);
  assert.equal(harness.data.get("captures").size, 0);
  assert.equal(harness.state.closed, 1);
});

test("an old open capture tab produces actionable storage guidance and closes a late connection", async () => {
  const harness = indexedDbHarness(), queue = load(harness);
  harness.state.blockNext = true;
  await assert.rejects(queue.enqueueUsbCapture(capture(), "native-photo"), /Close other Studio OS tabs.*reopen Capture/);
  assert.equal(harness.state.transactions.length, 0);
  harness.state.unblock();
  assert.equal(harness.state.closed, 1);
  assert.equal(harness.data.get("captures").size, 0);
  assert.equal(await queue.enqueueUsbCapture(capture(), "native-photo"), true);
});

test("USB receipt and photo commit atomically and preserve legacy captures on DB upgrade", async () => {
  const legacy = capture("legacy"); delete legacy.ownerId;
  const harness = indexedDbHarness({ legacy: [legacy] }), queue = load(harness);
  harness.state.holdNext = true;
  let settled = false;
  const write = queue.enqueueUsbCapture(capture(), "camera-photo-1").then(added => {
    settled = true; return added;
  });
  await tick(); await tick();
  assert.equal(settled, false);
  assert.equal(harness.data.get("usbImports").size, 0);
  assert.equal(harness.data.get("captures").size, 1);
  assert.deepEqual(Array.from(harness.state.transactions[0].stores), ["captures", "usbImports"]);
  harness.state.transactions[0].complete();
  assert.equal(await write, true);
  assert.equal(harness.state.version, 2);
  assert.equal(harness.data.get("captures").size, 2);
  const receipt = harness.data.get("usbImports").get("account-a:camera-photo-1");
  assert.equal(receipt.captureId, "capture-1");
  assert.equal("blob" in receipt, false);
});

test("USB storage error rolls back both stores so the native transfer can safely retry", async () => {
  const harness = indexedDbHarness(), queue = load(harness);
  harness.state.failStore = "usbImports";
  await assert.rejects(queue.enqueueUsbCapture(capture(), "camera-photo-1"), /quota/);
  assert.equal(harness.data.get("captures").size, 0);
  assert.equal(harness.data.get("usbImports").size, 0);
  assert.equal(await queue.enqueueUsbCapture(capture(), "camera-photo-1"), true);
  assert.equal(harness.state.closed, 2);
});

test("acknowledgement retries cannot reassign or reupload an imported USB photo", async () => {
  const harness = indexedDbHarness(), queue = load(harness);
  assert.equal(await queue.enqueueUsbCapture(capture(), "camera-photo-1"), true);
  assert.equal(await queue.enqueueUsbCapture(capture("capture-2", "account-a", "student-b"), "camera-photo-1"), false);
  const saved = await queue.allCaptures();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].studentId, "student-a");
  await queue.deleteCapture(saved[0].id);
  assert.equal(await queue.enqueueUsbCapture(capture("capture-3"), "camera-photo-1"), false);
  assert.equal((await queue.allCaptures()).length, 0);
  assert.equal(harness.data.get("usbImports").size, 1);
});

test("USB identifiers are account-scoped and missing account/photo ids are rejected", async () => {
  const harness = indexedDbHarness(), queue = load(harness);
  await assert.rejects(queue.enqueueUsbCapture(capture("a", ""), "photo"), /account/);
  await assert.rejects(queue.enqueueUsbCapture(capture(), "  "), /identifier/);
  assert.equal(await queue.enqueueUsbCapture(capture("a"), "photo"), true);
  assert.equal(await queue.enqueueUsbCapture(capture("b", "account-b"), "photo"), true);
  assert.equal(harness.data.get("captures").size, 2);
});

test("upload pump preserves JPEG bytes, legacy behavior and the current account boundary", async () => {
  const harness = indexedDbHarness(), uploads = [];
  const queue = load(harness, async (_url, options) => {
    const file = options.body.get("file");
    uploads.push({ student: options.body.get("studentId"), type: file.type, name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] });
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const legacy = capture("legacy", undefined, "legacy-student"); delete legacy.ownerId;
  await queue.addCapture(legacy);
  await queue.addCapture(capture("account-a-photo", "account-a", "student-a"));
  await queue.addCapture(capture("account-b-photo", "account-b", "student-b"));
  await queue.processCaptureQueue();
  assert.deepEqual(uploads.map(row => row.student), ["legacy-student"]);
  await queue.processCaptureQueue({ ownerId: "account-a" });
  assert.deepEqual(uploads.map(row => row.student), ["legacy-student", "student-a"]);
  assert.deepEqual(uploads[1], { student: "student-a", type: "image/jpeg", name: "account-a-photo.jpg", bytes: [255, 216, 255, 217] });
  assert.deepEqual((await queue.allCaptures()).map(row => row.id), ["account-b-photo"]);
});

test("failed native acknowledgement after durable commit retries without duplicate uploads or reassignment", async () => {
  const harness = indexedDbHarness(), uploads = [];
  const queue = load(harness, async (_url, options) => {
    uploads.push(options.body.get("studentId"));
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const api = loadMobileUsbCamera(), fixture = usbPhotoFixture();
  const chosen = { ownerId: "account-a", schoolId: "school-a", studentId: "student-a", studentName: "Student A", className: "Grade 9" };
  let acknowledgements = 0;
  fixture.camera.acknowledgePhoto = async () => {
    acknowledgements += 1;
    if (acknowledgements === 1) throw new Error("Native acknowledgement interrupted");
  };
  const options = { ...fixture, target: chosen, prepare: async blob => blob, enqueue: queue.enqueueUsbCapture };
  await assert.rejects(api.importUsbPhoto(options), /interrupted/);
  assert.equal((await queue.allCaptures()).length, 1);
  await queue.processCaptureQueue({ ownerId: chosen.ownerId });
  chosen.studentId = "student-b";
  assert.equal(await api.importUsbPhoto(options), false);
  await queue.processCaptureQueue({ ownerId: chosen.ownerId });
  assert.deepEqual(uploads, ["student-a"]);
  assert.equal((await queue.allCaptures()).length, 0);
  assert.equal(acknowledgements, 2);
});

test("a fresh upload pump recovers an interrupted uploading row and retains its USB retry identifier", async () => {
  const harness = indexedDbHarness(), original = load(harness), uploads = [];
  const id = "usb-account-a-0258d261-a57a-4f52-9af5-1069a42b0561";
  await original.addCapture({ ...capture(id), status: "uploading" });
  const reloaded = load(harness, async (_url, options) => {
    uploads.push({ studentId: options.body.get("studentId"), captureId: options.body.get("captureId") });
    return { ok: true, json: async () => ({ ok: true }) };
  });
  await reloaded.processCaptureQueue({ ownerId: "account-a" });
  assert.deepEqual(uploads, [{ studentId: "student-a", captureId: id }]);
  assert.equal((await reloaded.allCaptures()).length, 0);
});

test("USB response-loss retries retain one capture identifier while phone/manual uploads omit it", async () => {
  const harness = indexedDbHarness(), ids = [];
  let responseLost = true;
  const queue = load(harness, async (_url, options) => {
    ids.push(options.body.get("captureId"));
    if (responseLost) { responseLost = false; throw new Error("Upload response lost"); }
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const id = "usb-account-a-0258d261-a57a-4f52-9af5-1069a42b0561";
  await queue.addCapture(capture(id));
  await queue.processCaptureQueue({ ownerId: "account-a" });
  assert.equal((await queue.allCaptures())[0].status, "error");
  await queue.processCaptureQueue({ ownerId: "account-a" });
  await queue.addCapture(capture("phone-photo"));
  await queue.processCaptureQueue({ ownerId: "account-a" });
  assert.deepEqual(ids, [id, id, null]);
});
