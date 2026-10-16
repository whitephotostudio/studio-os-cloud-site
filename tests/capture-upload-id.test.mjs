import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { usbCaptureUploadFileName } from "../lib/capture-upload-id.ts";

const owner = "9d246b02-0070-4647-b07b-17b06e50be07";
const photo = "0258d261-a57a-4f52-9af5-1069a42b0561";
const captureId = `usb-${owner}-${photo}`;

test("USB retry filenames are stable, account-scoped UUIDs and normalize native uppercase UUIDs", () => {
  assert.equal(usbCaptureUploadFileName(captureId, owner), `capture_usb_${photo}.jpg`);
  assert.equal(usbCaptureUploadFileName(`usb-${owner}-${photo.toUpperCase()}`, owner), `capture_usb_${photo}.jpg`);
  assert.equal(usbCaptureUploadFileName(null, owner), null);
  assert.equal(usbCaptureUploadFileName(undefined, owner), null);
});

test("specified malformed, cross-account and path-containing capture identifiers are rejected", () => {
  for (const id of ["", "  ", photo, `usb-other-${photo}`, `${captureId}/../other`, `usb-${owner}-../photo`, ` ${captureId}`, `${captureId}\n`, 42, new Blob(["id"])]) {
    assert.throws(() => usbCaptureUploadFileName(id, owner), /Invalid capture identifier/);
  }
});

function uploadRoute({ userId = owner } = {}) {
  const uploaded = [], scopes = [];
  const records = {
    photographers: { id: "photographer-a" },
    schools: { id: "school-a", local_school_id: "school-local" },
    students: { id: "student-a", school_id: "school-a", first_name: "Alex", last_name: "Smith", pin: "12345", class_name: "Grade 9", folder_name: null, photo_url: "existing-preview" },
  };
  const service = { from(table) {
    const query = {
      select() { return query; },
      eq(field, value) { scopes.push([table, field, value]); return query; },
      async maybeSingle() { return { data: records[table] }; },
    }; return query;
  } };
  const dependencies = {
    "next/server": { NextResponse: { json(body, { status = 200 } = {}) { return new Response(JSON.stringify(body), { status }); } } },
    "@/lib/dashboard-auth": { resolveDashboardAuth: async () => ({ user: userId ? { id: userId } : null }), createDashboardServiceClient: () => service },
    "@/lib/require-agreement": { guardAgreement: async () => ({ ok: true }) },
    "@/lib/capture-upload-id": { usbCaptureUploadFileName },
    "@/lib/r2": { r2Upload: async (key, bytes, mimeType) => { uploaded.push({ key, bytes, mimeType }); return `https://photos.invalid/${key}`; } },
    sharp: () => {
      const image = { rotate: () => image, resize: () => image, jpeg: () => image, toBuffer: async () => Buffer.from([255, 216, 255, 217]) };
      return image;
    },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("../app/api/dashboard/capture/upload/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, Buffer, Date, console });
  async function post(id) {
    const form = new FormData();
    form.append("file", new Blob(["source-jpeg"], { type: "image/jpeg" }), "IMG_0001.JPG");
    form.append("schoolId", "school-a"); form.append("studentId", "student-a");
    if (id !== undefined) form.append("captureId", id);
    const response = await exports.POST(new Request("https://studio.invalid/api/dashboard/capture/upload", { method: "POST", body: form }));
    return { status: response.status, body: await response.json() };
  }
  return { post, uploaded, scopes };
}

test("authenticated upload retries overwrite the same student JPEG key after a lost response", async () => {
  const route = uploadRoute();
  const first = await route.post(captureId), retried = await route.post(captureId);
  assert.equal(first.status, 200); assert.equal(retried.status, 200);
  assert.equal(first.body.key, `school-local/Grade 9/Smith Alex 12345/capture_usb_${photo}.jpg`);
  assert.equal(first.body.key, retried.body.key);
  assert.equal(new Set(route.uploaded.map(upload => upload.key)).size, 1);
  assert.equal(route.uploaded[0].mimeType, "image/jpeg");
  assert.ok(route.scopes.some(([table, field, value]) => table === "schools" && field === "photographer_id" && value === "photographer-a"));
  assert.ok(route.scopes.some(([table, field, value]) => table === "students" && field === "school_id" && value === "school-a"));
});

test("capture identifiers are validated after authentication and invalid IDs never reach storage", async () => {
  const unauthenticated = uploadRoute({ userId: null });
  assert.equal((await unauthenticated.post(captureId)).status, 401);
  const route = uploadRoute();
  assert.equal((await route.post(`usb-other-${photo}`)).status, 400);
  assert.equal(route.uploaded.length, 0);
  const legacy = await route.post();
  assert.equal(legacy.status, 200);
  assert.match(legacy.body.fileName, /^capture_\d+_[a-z0-9]+\.jpg$/);
});
