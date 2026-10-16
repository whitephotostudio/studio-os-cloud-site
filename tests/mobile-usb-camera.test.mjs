import test from "node:test";
import assert from "node:assert/strict";
import { loadMobileUsbCamera, usbPhotoFixture } from "./helpers/mobile-usb-camera-harness.mjs";

const target = () => ({ ownerId: "account-a", schoolId: "school-a", studentId: "student-a", studentName: "Student A", className: "Grade 9" });

test("USB control is offered only when the installed iOS app has the native camera plugin", () => {
  const plugin = {};
  assert.equal(loadMobileUsbCamera({ plugin }).getUsbCamera(), plugin);
  assert.equal(loadMobileUsbCamera({ platform: "web", plugin }).getUsbCamera(), null);
  assert.equal(loadMobileUsbCamera({ platform: "android", plugin }).getUsbCamera(), null);
  assert.equal(loadMobileUsbCamera({ available: false, plugin }).getUsbCamera(), null);
});

test("native JPEG bridge reads bounded chunks with exact offsets and preserves bytes", async () => {
  const api = loadMobileUsbCamera(), fixture = usbPhotoFixture(262144 + 37);
  const blob = await api.readUsbPhoto(fixture.camera, fixture.photo, "account-a");
  assert.equal(blob.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), fixture.bytes);
  assert.deepEqual(fixture.reads.map(({ offset, length }) => ({ offset, length })), [
    { offset: 0, length: 262144 }, { offset: 262144, length: 37 },
  ]);
  assert.equal(fixture.acknowledgements.length, 0);
  assert.ok(fixture.reads.every(request => request.ownerId === "account-a"));
});

test("unsupported format and invalid native lengths fail before any bridge transfer", async () => {
  const api = loadMobileUsbCamera(), fixture = usbPhotoFixture();
  for (const photo of [
    { ...fixture.photo, mimeType: "image/x-canon-cr3" },
    ...[0, 2, -1, 2.5, NaN, Infinity, 64 * 1024 * 1024 + 1].map(size => ({ ...fixture.photo, size })),
  ]) await assert.rejects(api.readUsbPhoto(fixture.camera, photo, "account-a"), /JPEG/);
  assert.equal(fixture.reads.length, 0);
});

test("truncated packets, incorrect completion markers and non-JPEG bytes are rejected", async () => {
  const api = loadMobileUsbCamera();
  const fixture = usbPhotoFixture();
  await assert.rejects(api.readUsbPhoto({ readPhoto: async () => ({ data: "AA==", done: true }) }, fixture.photo, "account-a"), /incomplete/);
  await assert.rejects(api.readUsbPhoto({ readPhoto: async () => ({ data: Buffer.from(fixture.bytes).toString("base64"), done: false }) }, fixture.photo, "account-a"), /incomplete/);
  const big = usbPhotoFixture(262145);
  await assert.rejects(api.readUsbPhoto({ readPhoto: async () => ({ data: Buffer.from(big.bytes.subarray(0, 262144)).toString("base64"), done: true }) }, big.photo, "account-a"), /incomplete/);
  await assert.rejects(api.readUsbPhoto({ readPhoto: async () => ({ data: Buffer.alloc(8).toString("base64"), done: true }) }, fixture.photo, "account-a"), /JPEG photo/);
});

test("student and account are snapshotted before native reads, preparation and durable enqueue", async () => {
  const api = loadMobileUsbCamera(), fixture = usbPhotoFixture(), chosen = target();
  const read = fixture.camera.readPhoto;
  fixture.camera.readPhoto = async request => {
    chosen.ownerId = "account-b"; chosen.schoolId = "school-b"; chosen.studentId = "student-b";
    return read(request);
  };
  let queued;
  const result = await api.importUsbPhoto({
    ...fixture, target: chosen, prepare: async blob => blob,
    enqueue: async (record, photoId) => {
      assert.equal(fixture.acknowledgements.length, 0);
      queued = { record, photoId }; return true;
    },
  });
  assert.equal(result, true);
  assert.equal(queued.record.ownerId, "account-a");
  assert.equal(queued.record.schoolId, "school-a");
  assert.equal(queued.record.studentId, "student-a");
  assert.equal(queued.photoId, fixture.photo.id);
  assert.equal(queued.record.status, "pending");
  assert.equal(queued.record.blob.type, "image/jpeg");
  assert.equal(fixture.acknowledgements.length, 1);
  assert.equal(fixture.reads[0].ownerId, "account-a");
  assert.equal(fixture.acknowledgements[0].ownerId, "account-a");
});

test("failed preparation or durable enqueue never acknowledges the camera copy", async () => {
  const api = loadMobileUsbCamera();
  for (const failure of ["prepare", "enqueue"]) {
    const fixture = usbPhotoFixture();
    await assert.rejects(api.importUsbPhoto({
      ...fixture, target: target(),
      prepare: async blob => { if (failure === "prepare") throw new Error("Image decode failed"); return blob; },
      enqueue: async () => { throw new Error("Transaction aborted"); },
    }), /failed|aborted/);
    assert.equal(fixture.acknowledgements.length, 0);
  }
});

test("aborting during native transfer never enqueues or acknowledges an incomplete photo", async () => {
  const api = loadMobileUsbCamera(), fixture = usbPhotoFixture(), controller = new AbortController();
  let queued = false;
  const read = fixture.camera.readPhoto;
  fixture.camera.readPhoto = async request => { const result = await read(request); controller.abort(); return result; };
  await assert.rejects(api.importUsbPhoto({
    ...fixture, target: target(), signal: controller.signal, prepare: async blob => blob,
    enqueue: async () => { queued = true; return true; },
  }), { name: "AbortError" });
  assert.equal(queued, false);
  assert.equal(fixture.acknowledgements.length, 0);
});

test("aborting while the queue commits retains the native copy for a receipt-safe retry", async () => {
  const api = loadMobileUsbCamera(), fixture = usbPhotoFixture(), controller = new AbortController();
  let committed = false;
  await assert.rejects(api.importUsbPhoto({
    ...fixture, target: target(), signal: controller.signal, prepare: async blob => blob,
    enqueue: async () => { committed = true; controller.abort(); return true; },
  }), { name: "AbortError" });
  assert.equal(committed, true);
  assert.equal(fixture.acknowledgements.length, 0);
});

test("DSLR preparation scales to 2400px and releases object URLs after success and decode errors", async () => {
  const urls = [], revoked = [], dimensions = [], draws = [];
  let failDecode = false;
  const api = loadMobileUsbCamera({
    URL: { createObjectURL: () => { const url = `blob:${urls.length}`; urls.push(url); return url; }, revokeObjectURL: url => revoked.push(url) },
    Image: class { naturalWidth = 6000; naturalHeight = 4000; async decode() { if (failDecode) throw new Error("Decode failed"); } },
    document: { createElement: () => {
      const canvas = { width: 0, height: 0,
        getContext: () => ({ drawImage: (...args) => draws.push(args.slice(1)) }),
        toBlob: callback => { dimensions.push([canvas.width, canvas.height]); callback(new Blob(["jpeg"], { type: "image/jpeg" })); },
      }; return canvas;
    } },
  });
  assert.equal((await api.prepareDslrPhoto(new Blob(["input"]))).type, "image/jpeg");
  assert.deepEqual(dimensions, [[2400, 1600]]);
  assert.deepEqual(draws[0], [0, 0, 2400, 1600]);
  failDecode = true;
  await assert.rejects(api.prepareDslrPhoto(new Blob(["input"])), /Decode failed/);
  assert.deepEqual(revoked, urls);
});
