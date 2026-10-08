import assert from "node:assert/strict";
import test from "node:test";
import { createAbandonedCartStopUrl, verifyAbandonedCartStopToken, cartReminderLinkEmailMatches } from "../lib/abandoned-cart-reminder-links.ts";

const input = { orderId: "11111111-1111-4111-8111-111111111111", photographerId: "22222222-2222-4222-8222-222222222222", recipientEmail: "Parent@example.com" };

test("signed stop links hide contact data and reject tampering, expiry and oversized tokens", () => {
  const old = process.env.CART_REMINDER_TOKEN_SECRET;
  process.env.CART_REMINDER_TOKEN_SECRET = "cart-reminder-fixture-secret-is-long-enough";
  try {
    const now = new Date("2026-10-08T15:00:00Z");
    const url = new URL(createAbandonedCartStopUrl({ ...input, origin: "https://attacker.example", now }));
    assert.equal(url.origin, "https://www.studiooscloud.com");
    const token = url.searchParams.get("token");
    const payload = verifyAbandonedCartStopToken(token, now);
    assert.equal(payload.o, input.orderId);
    assert.equal(payload.p, input.photographerId);
    assert.ok(cartReminderLinkEmailMatches(" parent@EXAMPLE.com ", payload.h));
    assert.equal(cartReminderLinkEmailMatches("different@example.com", payload.h), false);
    assert.doesNotMatch(Buffer.from(token.split(".")[0], "base64url").toString(), /parent@|pin/i);
    assert.equal(verifyAbandonedCartStopToken(token + "x", now), null);
    assert.equal(verifyAbandonedCartStopToken(token + ".", now), null);
    assert.equal(verifyAbandonedCartStopToken(token + "..junk", now), null);
    assert.equal(verifyAbandonedCartStopToken(token, new Date("2027-01-07T15:00:00Z")), null);
    assert.equal(verifyAbandonedCartStopToken("x".repeat(2000), now), null);
    assert.equal(createAbandonedCartStopUrl({ ...input, orderId: "not-an-order" }), null);
  } finally {
    if (old === undefined) delete process.env.CART_REMINDER_TOKEN_SECRET;
    else process.env.CART_REMINDER_TOKEN_SECRET = old;
  }
});

test("key rotation verifies old signatures and recipient hashes only with an explicit previous key", () => {
  const old = process.env.CART_REMINDER_TOKEN_SECRET;
  const previous = process.env.CART_REMINDER_TOKEN_PREVIOUS_SECRET;
  try {
    process.env.CART_REMINDER_TOKEN_SECRET = "original-cart-reminder-fixture-secret-long";
    const token = new URL(createAbandonedCartStopUrl(input)).searchParams.get("token");
    const payload = verifyAbandonedCartStopToken(token);
    process.env.CART_REMINDER_TOKEN_SECRET = "replacement-cart-reminder-fixture-secret-long";
    assert.equal(verifyAbandonedCartStopToken(token), null);
    process.env.CART_REMINDER_TOKEN_PREVIOUS_SECRET = "original-cart-reminder-fixture-secret-long";
    assert.deepEqual(verifyAbandonedCartStopToken(token), payload);
    assert.equal(cartReminderLinkEmailMatches(input.recipientEmail, payload.h), true);
  } finally {
    if (old === undefined) delete process.env.CART_REMINDER_TOKEN_SECRET;
    else process.env.CART_REMINDER_TOKEN_SECRET = old;
    if (previous === undefined) delete process.env.CART_REMINDER_TOKEN_PREVIOUS_SECRET;
    else process.env.CART_REMINDER_TOKEN_PREVIOUS_SECRET = previous;
  }
});
