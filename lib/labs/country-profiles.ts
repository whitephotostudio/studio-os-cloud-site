import type { SupabaseClient } from "@supabase/supabase-js";
import { isLabCountryCode } from "../lab-directory";
import { parseFulfillmentProfile, type FulfillmentSize } from "./fulfillment-profile";
import type { Lab, LabCatalogProduct, LabCountryProfileOption, LabCountryProfiles } from "./types";
import { LabError } from "./validation";

export type LabCountryProfileRow = { lab_id: string; market_country_code: string; revision: number; status: "pending" | "approved"; document: unknown; reviewed_by: string | null; reviewed_at: string | null };
const pending = (lab: Lab, country: string, revision: number | null, reason: string): LabCountryProfileOption => ({ labId: lab.id, marketCountryCode: country, city: lab.city, region: lab.region, physicalCountryCode: lab.countryCode, revision, status: "pending", reason, profile: null, catalogProductIds: [], testOnly: true, printAllowed: false, operationallyAuthorized: false });
function fraction(value: number, multiplier: bigint): [bigint, bigint] | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return null;
  const decimals = match[2] || "";
  return [BigInt(match[1] + decimals) * multiplier, BigInt(10) ** BigInt(decimals.length)];
}
/** Exact decimal equality; no conversion to a neighbouring nominal print size. */
function exactDimension(inches: number, value: number, unit: FulfillmentSize["unit"]) {
  const a = fraction(inches, BigInt(25_400_000)), b = fraction(value, unit === "in" ? BigInt(25_400_000) : BigInt(1_000_000));
  return a !== null && b !== null && a[0] * b[1] === b[0] * a[1];
}
export function projectLabCountryProfiles(rows: LabCountryProfileRow[], labs: Lab[], catalog: LabCatalogProduct[]): LabCountryProfiles {
  const options = new Map<string, LabCountryProfileOption>(), directory = new Map(labs.map(l => [l.id, l]));
  for (const lab of labs) if (isLabCountryCode(lab.countryCode)) options.set(`${lab.id}:${lab.countryCode}`, pending(lab, lab.countryCode, null, "Country profile setup pending. The existing catalog is available for reference only."));
  const latest = new Map<string, LabCountryProfileRow>();
  for (const row of rows) {
    if (!directory.has(row.lab_id) || !isLabCountryCode(row.market_country_code) || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1) continue;
    const key = `${row.lab_id}:${row.market_country_code}`, old = latest.get(key);
    if (!old || Number(old.revision) < Number(row.revision)) latest.set(key, row);
  }
  const products = new Map(catalog.map(p => [p.id, p]));
  for (const [key, row] of latest) {
    const lab = directory.get(row.lab_id)!;
    let option = pending(lab, row.market_country_code, Number(row.revision), "This country's lab profile is pending review. Services and production options are not confirmed.");
    if (row.status === "approved" && row.reviewed_by && row.reviewed_at && Number.isFinite(Date.parse(row.reviewed_at))) {
      try {
        const profile = parseFulfillmentProfile(row.document);
        if (profile.labId !== lab.id || profile.marketCountryCode !== row.market_country_code || profile.revision !== Number(row.revision)) throw Error("identity");
        if (profile.location.countryCode !== lab.countryCode || profile.location.city !== lab.city || profile.currency !== lab.currency) throw Error("location_currency");
        if (lab.status === "paused" || !lab.catalogVerified || profile.transport.state !== "configured" || profile.transport.kind !== "manual_download") throw Error("not_configured");
        const ids: string[] = [];
        for (const product of profile.products) {
          const actual = products.get(product.productId);
          if (!actual || actual.labId !== lab.id || actual.sku !== product.sku || actual.currency !== profile.currency || !actual.active || !actual.verified || actual.costSource !== "lab_confirmed" || !Number.isSafeInteger(actual.costCents) || actual.costCents! < 0 || actual.costCents! > 100_000_000 || actual.printsPerUnit !== 1 || !exactDimension(actual.widthInches, product.finishedSize.width, product.finishedSize.unit) || !exactDimension(actual.heightInches, product.finishedSize.height, product.finishedSize.unit)) throw Error("catalog");
          ids.push(actual.id);
        }
        option = { ...option, status: "configured", reason: "Reviewed country profile matches the current catalog. Test planning only; ordering and printing remain disabled.", profile, catalogProductIds: ids };
      } catch { option.reason = "The saved country profile is unavailable, unsupported or no longer matches the current verified catalog. Reference browsing remains available."; }
    }
    options.set(key, option);
  }
  for (const option of options.values()) if (option.status === "pending" && option.marketCountryCode === option.physicalCountryCode) {
    const ids = catalog.filter(p => p.labId === option.labId && p.active && p.currency === directory.get(option.labId)!.currency).map(p => p.id);
    if (ids.length <= 500) option.catalogProductIds = ids;
    else option.reason = "The reference catalog needs a filtered view before a new country-bound draft can be created.";
  }
  return { available: true, options: [...options.values()].sort((a, b) => a.marketCountryCode.localeCompare(b.marketCountryCode) || a.city.localeCompare(b.city) || a.labId.localeCompare(b.labId)) };
}
export async function loadLabCountryProfiles(service: SupabaseClient, labs: Lab[], catalog: LabCatalogProduct[]): Promise<LabCountryProfiles> {
  const rows: LabCountryProfileRow[] = [];
  let bytes = 0;
  try {
    // Bounded reads; an unavailable additive registry never interrupts old prices.
    for (let from = 0; from <= 500; from += 25) {
      const result = await service.from("lab_country_profile_latest").select("lab_id,market_country_code,revision,status,document,reviewed_by,reviewed_at").order("lab_id").order("market_country_code").range(from, Math.min(from + 24, 500));
      if (result.error || !Array.isArray(result.data)) throw Error("registry unavailable");
      rows.push(...result.data as LabCountryProfileRow[]);
      bytes += new TextEncoder().encode(JSON.stringify(result.data)).length;
      if (rows.length > 500 || bytes > 500_000) throw Error("registry capacity");
      if (result.data.length < 25) return projectLabCountryProfiles(rows, labs, catalog);
    }
  } catch { /* Fail closed for new profiles; leave existing workspace intact. */ }
  return { ...projectLabCountryProfiles([], labs, catalog), available: false };
}
/** Trusted operations helper only. No browser write route is exposed this pass. */
export async function appendLabCountryProfile(service: SupabaseClient, actorUserId: string, input: { labId: string; marketCountryCode: string; revision: number; status: "pending" | "approved"; document: unknown }, labs: Lab[], catalog: LabCatalogProduct[]) {
  if (!isLabCountryCode(input.marketCountryCode) || !Number.isSafeInteger(input.revision) || input.revision < 1 || input.revision > 1_000_000_000 || !labs.some(l => l.id === input.labId) || !["pending", "approved"].includes(input.status)) throw new LabError("Choose the exact listed lab, supported country and next profile revision.");
  if (input.status === "approved") {
    const document = parseFulfillmentProfile(input.document);
    const projected = projectLabCountryProfiles([{ lab_id: input.labId, market_country_code: input.marketCountryCode, revision: input.revision, status: "approved", document, reviewed_by: actorUserId, reviewed_at: new Date().toISOString() }], labs, catalog);
    if (!projected.options.some(o => o.labId === input.labId && o.marketCountryCode === input.marketCountryCode && o.status === "configured")) throw new LabError("Review the exact lab, market, currency, catalog SKUs, physical dimensions and supported transport before approving this profile.", 409, "LAB_COUNTRY_PROFILE_PENDING");
  } else if (input.document !== null) throw new LabError("A pending registry entry must not claim unverified production services.");
  const result = await service.rpc("put_lab_country_profile", { p_actor_user_id: actorUserId, p_lab_id: input.labId, p_market_country_code: input.marketCountryCode, p_revision: input.revision, p_status: input.status, p_document: input.document });
  if (result.error) throw new LabError("The profile revision could not be recorded. Review its current revision and administrator authorization.", /VERSION_CONFLICT|REQUEST_CONFLICT/.test(result.error.message || "") ? 409 : 503, "LAB_COUNTRY_PROFILE_UNAVAILABLE");
  return result.data;
}
