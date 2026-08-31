import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_DELIVERY_PHOTOS,
  encodeObjectKey,
  escapeHtml,
  validateOrderId,
  validatePhotoPaths,
} from "../../supabase/functions/send-digital-delivery/security.ts";

const schoolId = "11111111-1111-4111-8111-111111111111";
const studentId = "22222222-2222-4222-8222-222222222222";
const functionSource = readFileSync(
  new URL("../../supabase/functions/send-digital-delivery/index.ts", import.meta.url),
  "utf8",
);

test("function authenticates the caller and scopes the order to its photographer", () => {
  assert.match(functionSource, /auth\.getUser\(\)/);
  assert.match(functionSource, /\.eq\("photographer_id", photographer\.id\)/);
  assert.match(functionSource, /const parentEmail = cleanText\(order\.customer_email\)/);
  assert.doesNotMatch(functionSource, /const \{[^}]*parent_email[^}]*\} = payload/);
});

test("accepts and deduplicates paths within the order's student folder", () => {
  const path = `${schoolId}/${studentId}/portrait 1.jpg`;
  assert.deepEqual(validatePhotoPaths([path, path], schoolId, studentId), {
    ok: true,
    paths: [path],
  });
});

test("rejects traversal, URLs, and paths for another student", () => {
  const badPaths = [
    `${schoolId}/${studentId}/../private.jpg`,
    `https://example.com/${schoolId}/${studentId}/photo.jpg`,
    `${schoolId}/33333333-3333-4333-8333-333333333333/photo.jpg`,
    `${schoolId}/${studentId}/photo.jpg?token=secret`,
  ];
  for (const path of badPaths) {
    assert.equal(validatePhotoPaths([path], schoolId, studentId).ok, false);
  }
});

test("rejects empty and oversized deliveries", () => {
  assert.equal(validatePhotoPaths([], schoolId, studentId).ok, false);
  const paths = Array.from(
    { length: MAX_DELIVERY_PHOTOS + 1 },
    (_, i) => `${schoolId}/${studentId}/${i}.jpg`,
  );
  assert.equal(validatePhotoPaths(paths, schoolId, studentId).ok, false);
});

test("validates UUID order IDs", () => {
  assert.equal(validateOrderId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(validateOrderId("not-an-order"), null);
});

test("escapes email HTML and safely encodes object keys", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(encodeObjectKey("folder/student/photo 1.jpg"), "folder/student/photo%201.jpg");
});
