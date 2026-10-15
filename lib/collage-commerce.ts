import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CollageAccessError, COLLAGE_UUID, collageArtworkKey, collageContentHash, storedCollageVersion, type CollageVersionRow } from "@/lib/collage-server";
import { parseCollageTemplate, MAX_TEMPLATE_BYTES, type CollageTemplate } from "@/lib/collage-template";
import { resolvePackageProfileId, filterPackagesForProfile } from "@/lib/package-profile-selection";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { resolvePhotographerOrderCurrency } from "@/lib/order-currency";

type Row = Record<string, unknown>;
export type CommerceState = { owner: Row; profiles: Row[]; schools: Row[]; projects: Row[]; packages: Row[] };
export type CommerceProductRequest = { mode: "create" | "update"; id?: string; profileId: string | null; name?: string; priceCents: number; copyCount: number; itemIndex: number | null };
export type CommerceRequest = { requestId: string; catalogRevision: string; templateId: string | null; design: CollageTemplate; galleries: Array<{ kind: "school" | "project"; id: string }>; product: CommerceProductRequest };
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const profileId = (value: unknown) => value == null || value === "" ? null : text(value);
export function commerceCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(commerceCanonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, commerceCanonical(entry)]));
  return value;
}
export const commerceHash = (value: unknown) => createHash("sha256").update(JSON.stringify(commerceCanonical(value))).digest("hex");
export const commerceOwnerFields = "id,billing_currency,default_package_profile_id";
export const commerceSchoolFields = "id,photographer_id,school_name,package_profile_id,gallery_settings";
export const commerceProjectFields = "id,photographer_id,title,workflow_type,package_profile_id,gallery_settings";

async function ownerRows(service: SupabaseClient, table: string, fields: string, owner: string) {
  const rows: Row[] = [];
  for (let offset = 0; offset < 10_000; offset += 500) {
    const result = await service.from(table).select(fields).eq("photographer_id", owner).order("id").range(offset, offset + 499);
    if (result.error) throw result.error;
    rows.push(...((result.data ?? []) as unknown as Row[]));
    if ((result.data?.length ?? 0) < 500) return rows;
  }
  throw new CollageAccessError("Too many catalogue records to publish safely. Please contact support.", 409);
}
export async function loadCommerceState(service: SupabaseClient, photographerId: string): Promise<CommerceState> {
  const [owner, profiles, schools, projects, packages] = await Promise.all([
    service.from("photographers").select(commerceOwnerFields).eq("id", photographerId).maybeSingle(),
    ownerRows(service, "package_profiles", "*", photographerId), ownerRows(service, "schools", commerceSchoolFields, photographerId),
    ownerRows(service, "projects", commerceProjectFields, photographerId), ownerRows(service, "packages", "*", photographerId),
  ]);
  if (owner.error) throw owner.error;
  if (!owner.data) throw new CollageAccessError("Photographer profile not found.", 404);
  return { owner: owner.data as Row, profiles, schools, projects, packages };
}
function activePackages(state: CommerceState) {
  return state.packages.filter(row => row.active === true).slice().sort((a, b) => Number(a.price_cents) - Number(b.price_cents) || text(a.id).localeCompare(text(b.id)));
}
function selectedProfile(state: CommerceState, gallery: Row) {
  return text(gallery.package_profile_id) || normalizeEventGallerySettings(gallery.gallery_settings).extras.priceSheetProfileId.trim() || text(state.owner.default_package_profile_id) || null;
}
function packageShape(row: Row) {
  return { id: text(row.id), localId: typeof row.local_id === "string" ? row.local_id : null, profileId: profileId(row.profile_id), name: text(row.name), priceCents: Number(row.price_cents), active: row.active === true,
    category: typeof row.category === "string" ? row.category : null, items: Array.isArray(row.items) ? row.items : [], revision: commerceHash(row) };
}
export function commerceCatalogue(state: CommerceState) {
  const currency = resolvePhotographerOrderCurrency(state.owner.billing_currency);
  if (!currency) throw new CollageAccessError("This studio's sales currency is unsupported. Update its existing sales settings before publishing.", 409);
  const profiles = new Map<string | null, { id: string | null; name: string }>();
  for (const row of state.profiles) profiles.set(text(row.id), { id: text(row.id), name: text(row.name) || "Price sheet" });
  for (const row of state.packages) if (!profiles.has(profileId(row.profile_id))) profiles.set(profileId(row.profile_id), { id: profileId(row.profile_id), name: text(row.profile_name) || (profileId(row.profile_id) ?? "Unassigned catalogue") });
  if (!profiles.size) profiles.set(null, { id: null, name: "Unassigned catalogue" });
  const packages = activePackages(state);
  const galleries = [...state.schools.map(row => ({ kind: "school" as const, row })), ...state.projects.filter(row => row.workflow_type === "event").map(row => ({ kind: "project" as const, row }))].map(({ kind, row }) => {
    const selected = selectedProfile(state, row);
    // An explicitly selected owned but empty sheet becomes usable when its
    // first collage is created; no gallery profile is changed to accomplish it.
    const effective = selected && profiles.has(selected) ? selected : resolvePackageProfileId({ selectedProfileId: selected, packages: packages as Array<{ profile_id?: string | null; profile_name?: string | null }> });
    return { kind, id: text(row.id), name: text(kind === "school" ? row.school_name : row.title) || "Gallery", profileId: effective, selectedProfileId: selected };
  });
  return { currency, catalogRevision: commerceHash(state), profiles: [...profiles.values()], galleries, products: state.packages.map(packageShape) };
}
function record(value: unknown, message = "Invalid collage publication."): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CollageAccessError(message);
  return value as Row;
}
export function parseCommerceRequest(value: unknown): CommerceRequest {
  const body = record(value), product = record(body.product);
  if (!COLLAGE_UUID.test(text(body.requestId)) || typeof body.catalogRevision !== "string" || !/^[a-f0-9]{64}$/.test(body.catalogRevision)) throw new CollageAccessError("Refresh the catalogue and use a valid publication request ID.");
  if (body.templateId != null && !COLLAGE_UUID.test(text(body.templateId))) throw new CollageAccessError("Choose a valid template.");
  let design: CollageTemplate;
  try { design = parseCollageTemplate(body.design); } catch (error) { throw new CollageAccessError(error instanceof Error ? error.message : "Invalid collage design."); }
  if (!Array.isArray(body.galleries) || !body.galleries.length || body.galleries.length > 100) throw new CollageAccessError("Choose between one and 100 galleries.");
  const galleries = body.galleries.map(raw => {
    const gallery = record(raw);
    if ((gallery.kind !== "school" && gallery.kind !== "project") || !COLLAGE_UUID.test(text(gallery.id))) throw new CollageAccessError("Choose valid gallery targets.");
    return { kind: gallery.kind as "school" | "project", id: text(gallery.id).toLowerCase() };
  });
  if (new Set(galleries.map(g => `${g.kind}:${g.id}`)).size !== galleries.length) throw new CollageAccessError("A gallery was selected more than once.");
  if (product.mode !== "create" && product.mode !== "update") throw new CollageAccessError("Choose a valid product action.");
  if (product.mode === "update" && !COLLAGE_UUID.test(text(product.id))) throw new CollageAccessError("Choose a valid existing product.");
  const pid = profileId(product.profileId);
  if (product.profileId !== null && (typeof product.profileId !== "string" || !pid || pid.length > 200 || /[:\\\u0000-\u001f\u007f]/.test(pid))) throw new CollageAccessError("Choose an owned price sheet or the unassigned catalogue.");
  if (!Number.isInteger(product.priceCents) || Number(product.priceCents) < 1 || Number(product.priceCents) > 100_000_000) throw new CollageAccessError("Set a price in whole minor currency units from 1 to 100000000.");
  if (!Number.isInteger(product.copyCount) || Number(product.copyCount) < 1 || Number(product.copyCount) > 20) throw new CollageAccessError("Choose between one and 20 collage copies per package set.");
  if (product.itemIndex != null && (!Number.isInteger(product.itemIndex) || Number(product.itemIndex) < 0 || Number(product.itemIndex) > 19)) throw new CollageAccessError("Choose a valid existing collage item.");
  if (product.mode === "create" && (!text(product.name) || text(product.name).length > 100 || /[\u0000-\u001f\u007f]/.test(text(product.name)))) throw new CollageAccessError("Enter a product name up to 100 characters.");
  if (product.mode === "create" && (product.id != null || product.itemIndex != null)) throw new CollageAccessError("A new product cannot replace an existing item.");
  return { requestId: text(body.requestId).toLowerCase(), catalogRevision: body.catalogRevision, templateId: body.templateId == null ? null : text(body.templateId).toLowerCase(), design, galleries,
    product: { mode: product.mode, ...(product.mode === "update" ? { id: text(product.id).toLowerCase() } : {}), profileId: pid, ...(product.mode === "create" ? { name: text(product.name) } : {}), priceCents: Number(product.priceCents), copyCount: Number(product.copyCount), itemIndex: product.itemIndex == null ? null : Number(product.itemIndex) } };
}

export function validateCommercePublication(state: CommerceState, request: CommerceRequest) {
  if (commerceHash(state) !== request.catalogRevision) throw new CollageAccessError("The catalogue changed. Refresh before publishing so current prices and package contents can be reviewed.", 409);
  const product = request.product;
  const knownProfile = product.profileId === null || state.profiles.some(p => text(p.id) === product.profileId) || state.packages.some(p => profileId(p.profile_id) === product.profileId);
  if (!knownProfile) throw new CollageAccessError("The price sheet does not belong to this studio.", 403);
  const existing = product.mode === "update" ? state.packages.find(p => p.id === product.id) : undefined;
  if (product.mode === "update" && (!existing || profileId(existing.profile_id) !== product.profileId)) throw new CollageAccessError("The selected product or its price sheet changed. Refresh the catalogue.", 409);
  if (existing && (existing.active !== true || existing.is_retouch_addon === true || /digital|download|usb|jpeg|jpg|png|\bfiles?\b|composite/i.test(text(existing.category)))) throw new CollageAccessError("Choose an active physical print or mixed print package.");
  const items = existing && Array.isArray(existing.items) ? [...existing.items] : [];
  if (existing && !Array.isArray(existing.items)) throw new CollageAccessError("This package needs valid print items before a collage can be added.");
  if (product.itemIndex !== null) {
    const current = items[product.itemIndex];
    if (!current || typeof current !== "object" || Array.isArray(current) || !(current as Row).collage) throw new CollageAccessError("Replace only a collage item. Add a new collage to preserve ordinary and class-composite prints.");
  }
  const label = `${request.design.widthInches}×${request.design.heightInches} ${request.design.name}`;
  const item = { ...(product.itemIndex !== null ? items[product.itemIndex] as Row : {}), name: label, qty: product.copyCount, size: `${request.design.widthInches}x${request.design.heightInches}`, type: "print", composite: false, collage: { templateVersionId: "new-version" } };
  if (product.itemIndex === null) items.push(item); else items[product.itemIndex] = item;
  let count = 0;
  for (const value of items) {
    if (typeof value !== "string" && (!value || typeof value !== "object" || Array.isArray(value))) throw new CollageAccessError("The package contains an invalid print item.");
    const current = typeof value === "string" ? {} : value as Row;
    const qty = current.qty == null ? 1 : Number(current.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20 || /digital|download|usb|jpeg|jpg|png|\bfiles?\b/i.test(text(current.type))) throw new CollageAccessError("Mixed collage packages must contain valid physical print copies.");
    count += qty;
  }
  if (count > 20) throw new CollageAccessError("A collage package set can contain at most 20 finished print copies.");
  const candidate = { ...(existing ?? {}), id: existing?.id ?? "new-product", profile_id: product.profileId, price_cents: product.priceCents, active: true, items };
  const prospective = [...state.packages.filter(p => p.id !== existing?.id && p.active === true), candidate].sort((a, b) => Number(a.price_cents) - Number(b.price_cents) || text(a.id).localeCompare(text(b.id)));
  for (const target of request.galleries) {
    const gallery = (target.kind === "school" ? state.schools : state.projects).find(g => g.id === target.id && (target.kind === "school" || g.workflow_type === "event"));
    if (!gallery) throw new CollageAccessError("A selected gallery does not belong to this studio.", 403);
    const selected = selectedProfile(state, gallery);
    const matching = filterPackagesForProfile(prospective as Array<{ profile_id?: string | null; profile_name?: string | null; id: unknown }>, { selectedProfileId: selected }).packages;
    if (!matching.some(p => p.id === candidate.id)) throw new CollageAccessError("The collage product's price sheet is not offered by a selected gallery. Choose a matching price sheet; gallery assignments were not changed.", 409);
  }
  return { existing, items };
}

export async function prepareCommerceArtwork(design: CollageTemplate, photographerId: string) {
  let artworkKey: string | null = null;
  if (design.overlay) {
    const encoded = design.overlay.split(",")[1], original = Buffer.from(encoded, "base64");
    if (original.length > 9 * 1024 * 1024 || original.toString("base64") !== encoded) throw new CollageAccessError("Use PNG or JPEG artwork smaller than 9 MB.");
    const image = sharp(original, { limitInputPixels: 40_000_000 }), meta = await image.metadata();
    if (!["png", "jpeg"].includes(meta.format || "")) throw new CollageAccessError("Use clean PNG or JPEG design artwork.");
    const bytes = await image.rotate().png().toBuffer();
    if (bytes.length > MAX_TEMPLATE_BYTES) throw new CollageAccessError("The decoded artwork is too large.");
    artworkKey = collageArtworkKey(photographerId, createHash("sha256").update(bytes).digest("hex"));
    const { writeProduction, readProduction, digest } = await import("@/lib/order-automation-storage");
    try { await writeProduction(artworkKey, bytes, "image/png", { create: true }); }
    catch (error) { const previous = await readProduction(artworkKey, MAX_TEMPLATE_BYTES).catch(() => null); if (!previous || digest(previous.bytes) !== digest(bytes)) throw error; }
  }
  const stored = { ...design, overlay: null };
  return { design: stored, artworkKey, contentHash: collageContentHash(stored, artworkKey) };
}
export function commercePublicationResponse(data: unknown, currency: string, requestId: string) {
  const result = record(data, "Invalid collage publication receipt.");
  return { ok: true, preview: true, version: storedCollageVersion(result.version as CollageVersionRow), product: packageShape(record(result.product)), currency, requestId, replayed: result.replayed === true };
}
