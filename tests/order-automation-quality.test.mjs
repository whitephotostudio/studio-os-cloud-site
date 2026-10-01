import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePortraitAssessment,
  labEmailText,
} from "../lib/order-automation-quality.ts";
const good = {
  faceCount: 1,
  confidence: 0.98,
  head: { left: 0.34, top: 0.1, right: 0.66, bottom: 0.48 },
  eyeY: 0.28,
  fullHeadAndHair: "pass",
  crop: "pass",
  backgroundAndEdges: "pass",
  retouching: "not_required",
  reasons: [],
};
test("only complete conservative portrait evidence can pass", () => {
  assert.equal(
    evaluatePortraitAssessment(good, { background: true, retouch: false })
      .passed,
    true,
  );
  for (const patch of [
    { faceCount: 2 },
    { confidence: 0.94 },
    { head: { ...good.head, top: 0 } },
    { head: { ...good.head, bottom: 0.8 } },
    { head: { ...good.head, right: 0.9 } },
    { eyeY: 0.7 },
    { fullHeadAndHair: "uncertain" },
    { backgroundAndEdges: "uncertain" },
    { reasons: ["Hair edge halo"] },
  ]) {
    assert.equal(
      evaluatePortraitAssessment(
        { ...good, ...patch },
        { background: true, retouch: false },
      ).passed,
      false,
      JSON.stringify(patch),
    );
  }
  assert.equal(
    evaluatePortraitAssessment(
      { ...good, confidence: NaN },
      { background: false, retouch: false },
    ).passed,
    false,
  );
  assert.equal(
    evaluatePortraitAssessment(
      { ...good, untrusted: true },
      { background: false, retouch: false },
    ).passed,
    false,
  );
  assert.equal(
    evaluatePortraitAssessment(good, { background: true, retouch: true })
      .passed,
    false,
  );
});
test("lab email identifies held exceptions and requested turnaround without promising completion", () => {
  const text = labEmailText({
    labName: "Lab",
    orders: 5,
    pieces: 12,
    days: 2,
    link: "https://example.test/private",
    studio: "Studio",
    reference: "batch",
    date: "2026-10-01",
  });
  for (const phrase of [
    "5 orders",
    "12 print pieces",
    "2 days, if possible",
    "Please reply to confirm receipt",
    "held back",
    "expires in 7 days",
  ])
    assert.ok(text.includes(phrase));
  assert.ok(!text.includes("labels printed"));
});
