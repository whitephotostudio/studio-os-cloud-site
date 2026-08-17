import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createUploadedDeliveryToken,
  isPaidUploadedDeliveryOrder,
  MAX_UPLOADED_DELIVERY_FILES,
  validateUploadedDeliveryKeys,
  verifyUploadedDeliveryToken,
} from "../../lib/uploaded-digital-delivery-security.ts";

process.env.DIGITAL_DELIVERY_TOKEN_SECRET = "test-only-secret-that-is-not-used-in-production";

const schoolId = "11111111-1111-4111-8111-111111111111";
const studentId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const objectKey = `photos/${schoolId}/${studentId}/portrait 1.jpg`;

const dashboardRoute = readFileSync(
  new URL("../../app/api/dashboard/digital-delivery/send-uploaded/route.ts", import.meta.url),
  "utf8",
);
const portalRoute = readFileSync(
  new URL("../../app/api/portal/uploaded-digital-delivery/route.ts", import.meta.url),
  "utf8",
);

function payload(overrides = {}) {
  return {
    v: 1,
    kind: "uploaded-digital-order-delivery",
    orderId,
    recipientEmail: "parent@example.com",
    objectKeys: [objectKey],
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

test("encrypts delivery metadata and verifies the authentic token", () => {
  const expected = payload();
  const token = createUploadedDeliveryToken(expected);
  assert.equal(token.includes(objectKey), false);
  assert.equal(token.includes("parent@example.com"), false);
  assert.deepEqual(verifyUploadedDeliveryToken(token), expected);
});

test("rejects a modified or expired encrypted token", () => {
  const token = createUploadedDeliveryToken(payload());
  const parts = token.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  assert.throws(() => verifyUploadedDeliveryToken(parts.join(".")));
  assert.throws(() => verifyUploadedDeliveryToken(createUploadedDeliveryToken(payload({ exp: Date.now() - 1 }))));
});

test("only accepts bounded files in the paid order's exact student folder", () => {
  assert.deepEqual(
    validateUploadedDeliveryKeys([objectKey, objectKey], schoolId, studentId),
    [objectKey],
  );
  const rejected = [
    `photos/${schoolId}/${studentId}/../private.jpg`,
    `photos/${schoolId}/another-student/photo.jpg`,
    `https://example.com/photos/${schoolId}/${studentId}/photo.jpg`,
    `photos/${schoolId}/${studentId}/photo.jpg?token=secret`,
    `photos/${schoolId}/${studentId}/malware.exe`,
  ];
  for (const key of rejected) {
    assert.equal(validateUploadedDeliveryKeys([key], schoolId, studentId), null, key);
  }
  assert.equal(
    validateUploadedDeliveryKeys(
      Array.from({ length: MAX_UPLOADED_DELIVERY_FILES + 1 }, (_, index) =>
        `photos/${schoolId}/${studentId}/${index}.jpg`,
      ),
      schoolId,
      studentId,
    ),
    null,
  );
});

test("requires confirmed payment before delivery", () => {
  assert.equal(isPaidUploadedDeliveryOrder({ payment_status: "paid" }), true);
  assert.equal(isPaidUploadedDeliveryOrder({ paid_at: new Date().toISOString() }), true);
  assert.equal(isPaidUploadedDeliveryOrder({ status: "digital_sent" }), true);
  assert.equal(isPaidUploadedDeliveryOrder({ status: "new", payment_status: "pending" }), false);
});

test("dashboard and portal routes re-check authorization instead of trusting the app", () => {
  assert.match(dashboardRoute, /resolveDashboardAuth\(request\)/);
  assert.match(dashboardRoute, /guardAgreement/);
  assert.match(dashboardRoute, /order\.photographer_id !== photographer\.id/);
  assert.match(dashboardRoute, /HeadObjectCommand/);
  assert.match(dashboardRoute, /isPaidUploadedDeliveryOrder\(order\)/);
  assert.match(portalRoute, /recipientEmail !== payload\.recipientEmail\.toLowerCase\(\)/);
  assert.match(portalRoute, /validateUploadedDeliveryKeys/);
  assert.doesNotMatch(dashboardRoute, /R2_PUBLIC_URL/);
  assert.doesNotMatch(portalRoute, /R2_PUBLIC_URL/);
});
