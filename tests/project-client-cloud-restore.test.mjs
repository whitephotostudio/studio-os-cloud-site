import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  desktopClientEmailFromSettings,
  desktopClientFieldsFromSettings,
  normalizeEventGallerySettings,
  sanitizeEventGallerySettingsForClient,
} from "../lib/event-gallery-settings.ts";

test("project contact email survives a reused gallery visitor contact", () => {
  const settings = normalizeEventGallerySettings({
    desktopClientEmail: " Client@Example.com ",
    linkedContacts: [{ id: "visitor-1", email: "client@example.com", role: "Client" }],
  });
  assert.equal(desktopClientEmailFromSettings(settings), "client@example.com");
  assert.equal(sanitizeEventGallerySettingsForClient(settings).desktopClientEmail, "");
});

test("current project client email wins after the contact changes", () => {
  const settings = {
    desktopClientEmail: "new@example.com",
    linkedContacts: [
      { id: "desktop-client-old", email: "old@example.com", role: "Client" },
      { id: "desktop-client-new", email: "new@example.com", role: "Client" },
    ],
  };
  assert.equal(desktopClientEmailFromSettings(settings), "new@example.com");
});

test("explicit project contact fields restore and clear without leaking publicly", () => {
  const settings = normalizeEventGallerySettings({
    desktopClientEmail: "old@example.com",
    desktopClientContact: {
      name: "Pat",
      email: "",
      phone: "",
      address: "",
    },
    linkedContacts: [{ id: "desktop-client-old", email: "old@example.com", role: "Client" }],
  });
  assert.deepEqual(desktopClientFieldsFromSettings(settings), {
    client_email: "",
    client_phone: "",
    client_address: "",
  });
  const publicSettings = sanitizeEventGallerySettingsForClient(settings);
  assert.equal(publicSettings.desktopClientEmail, "");
  assert.equal(publicSettings.desktopClientContact, undefined);
});

test("legacy desktop project contact is used only when unambiguous", () => {
  const original = {
    linkedContacts: [{ id: "desktop-client-one", email: "one@example.com", role: "Client" }],
  };
  assert.equal(desktopClientEmailFromSettings(original), "one@example.com");
  assert.deepEqual(desktopClientFieldsFromSettings(original), {
    client_email: "one@example.com",
  });
  assert.equal(desktopClientEmailFromSettings({
    linkedContacts: [...original.linkedContacts,
      { id: "desktop-client-two", email: "two@example.com", role: "Client" }],
  }), "");
});

test("client-only save checks project ownership and changes only contact fields", () => {
  const route = readFileSync(new URL("../app/api/dashboard/events/desktop-access/route.ts", import.meta.url), "utf8");
  const branch = route.split("if (body.clientOnly) {")[1]?.split("// ── Find or create project ──")[0] ?? "";
  assert.match(branch, /\.eq\("photographer_id", photographerId\)/);
  assert.match(branch, /workflow_type !== "event"/);
  assert.match(branch, /client_name: clientName \|\| null/);
  assert.match(branch, /gallery_settings: gallerySettings/);
  assert.doesNotMatch(branch, /portal_status:|access_mode:|access_pin:|collections/);
});
