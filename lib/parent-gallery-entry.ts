import "server-only";
import { decryptCapability, encryptCapability } from "@/lib/encrypted-capability";

export const PARENT_GALLERY_ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PAYLOAD_BYTES = 2048;
export const MAX_PARENT_GALLERY_ENTRY_TOKEN_LENGTH = Math.ceil(PAYLOAD_BYTES * 4 / 3) + 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type EntryInput = {
  kind: "school" | "event"; galleryId: string; photographerId: string; pin: string; email: string;
  tab?: "orders";
};
export type ParentGalleryEntry = EntryInput & { v: 1; expiresAt: number };
export class ParentGalleryEntryInputError extends Error {}
const invalid = (): never => { throw new Error("This gallery entry link is unavailable. Please use your QR label or PIN."); };
function options() {
  const secret = process.env.EVENT_DOWNLOAD_TOKEN_SECRET || process.env.DOWNLOAD_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { secret, purpose: "parent-gallery-entry" as const, maximumPayloadBytes: PAYLOAD_BYTES };
}
function normalized(input: EntryInput): EntryInput {
  if (!input || typeof input !== "object" || !["school", "event"].includes(input.kind) ||
    typeof input.galleryId !== "string" || !UUID.test(input.galleryId) ||
    typeof input.photographerId !== "string" || !UUID.test(input.photographerId) ||
    typeof input.pin !== "string" || !input.pin.trim() || input.pin.trim().length > 64 || /[\u0000-\u001f\u007f]/.test(input.pin) ||
    typeof input.email !== "string" || input.email.trim().length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) ||
    (input.tab !== undefined && input.tab !== "orders")) throw new ParentGalleryEntryInputError("Gallery entry context is unavailable.");
  return { kind: input.kind, galleryId: input.galleryId.toLowerCase(), photographerId: input.photographerId.toLowerCase(),
    pin: input.pin.trim(), email: input.email.trim().toLowerCase(), ...(input.tab ? { tab: input.tab } : {}) };
}

/** Share/receipt bearer bootstrap. Every redemption still checks current access. */
export function createParentGalleryEntryPath(input: EntryInput) {
  const payload: ParentGalleryEntry = { v: 1, ...normalized(input), expiresAt: Date.now() + PARENT_GALLERY_ENTRY_TTL_MS };
  const token = encryptCapability(payload, options());
  return `/api/portal/session/entry?${new URLSearchParams({ token })}`;
}

/** This authenticates the issuer and payload only; it never authorizes a gallery. */
export function readParentGalleryEntryToken(token: string): ParentGalleryEntry {
  if (typeof token !== "string" || token.length > MAX_PARENT_GALLERY_ENTRY_TOKEN_LENGTH || !token.startsWith("ec1.")) invalid();
  const raw = decryptCapability(token, options()) as ParentGalleryEntry;
  if (Object.keys(raw).some(key => !["v", "kind", "galleryId", "photographerId", "pin", "email", "expiresAt", "tab"].includes(key)) ||
    raw.v !== 1 || !Number.isSafeInteger(raw.expiresAt) || raw.expiresAt <= Date.now() ||
    raw.expiresAt > Date.now() + PARENT_GALLERY_ENTRY_TTL_MS + 5 * 60 * 1000) invalid();
  const entry = normalized(raw);
  // Issued payloads are canonical; do not silently accept another credential
  // spelling or scope representation inside an authenticated link.
  for (const key of ["kind", "galleryId", "photographerId", "pin", "email", "tab"] as const) if (entry[key] !== raw[key]) invalid();
  return { v: 1, ...entry, expiresAt: raw.expiresAt };
}
