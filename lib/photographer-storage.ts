import {
  defaultStorageRegion,
  enterStorageRegion,
  getStorageRegion,
  selectableStorageRegions,
  storageRegionForCode,
  storageRegionForCountry,
  type StorageRegion,
} from "@/lib/storage-regions";

// Which storage region a photographer's photos live in.
//
// `photographers.storage_region` holds a region code (`ca`, `us`, …) or NULL.
// NULL means "the deployment's default region", which is how every account
// created before regional storage existed is handled — their photos were all
// migrated together, so flipping STORAGE_DEFAULT_REGION moves them as a group.
// An explicit code is only written for accounts deliberately homed elsewhere.

type PhotographerStorageRow = { id: string; storage_region?: string | null };

type QueryResult<T> = { data: T | null; error: { message?: string; code?: string } | null };

// Structural type kept deliberately loose: matching the full SupabaseClient
// generic here makes TypeScript's instantiation explode (TS2589).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PhotographerQueryClient = { from: (table: "photographers") => any };

export const PHOTOGRAPHER_STORAGE_COLUMNS = "id, storage_region";

// Until the `storage_region` migration has been applied, the column does not
// exist. Fall back to the historical `id`-only select so a deploy that lands
// before the migration keeps every photographer on the default region.
let storageRegionColumnMissing = false;

function isMissingStorageRegionColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = (error?.message ?? "").toLowerCase();
  return !!error && (error.code === "42703" || (message.includes("storage_region") && (message.includes("does not exist") || message.includes("could not find"))));
}

/**
 * Drop-in replacement for `service.from("photographers").select("id").eq(column, value).maybeSingle()`
 * that also returns the photographer's storage region when available.
 */
export async function selectPhotographerStorage(
  service: PhotographerQueryClient,
  column: "user_id" | "id",
  value: string,
): Promise<QueryResult<PhotographerStorageRow>> {
  if (!storageRegionColumnMissing) {
    const result = await service.from("photographers").select(PHOTOGRAPHER_STORAGE_COLUMNS).eq(column, value).maybeSingle();
    if (!isMissingStorageRegionColumn(result.error)) return result as QueryResult<PhotographerStorageRow>;
    storageRegionColumnMissing = true;
    console.warn("[photographer-storage] photographers.storage_region is missing; apply the storage region migration. Using the default region.");
  }
  const result = await service.from("photographers").select("id").eq(column, value).maybeSingle();
  return result as QueryResult<PhotographerStorageRow>;
}

/** Resolve a loaded photographer row's region and bind the request to it. */
export function enterPhotographerStorage(row: PhotographerStorageRow | null | undefined): StorageRegion {
  return enterStorageRegion(storageRegionForCode(row?.storage_region));
}

/** Region for a photographer row without touching the request context. */
export function photographerStorageRegion(row: PhotographerStorageRow | null | undefined): StorageRegion {
  return storageRegionForCode(row?.storage_region);
}

/**
 * Load the photographer owning a dashboard user (or a photographer id) with
 * the columns needed to bind storage, and bind the request to that region.
 */
export async function loadPhotographerStorage(
  service: PhotographerQueryClient,
  lookup: { userId: string } | { photographerId: string },
): Promise<{ photographer: PhotographerStorageRow; region: StorageRegion } | null> {
  const { data: row, error } = "userId" in lookup
    ? await selectPhotographerStorage(service, "user_id", lookup.userId)
    : await selectPhotographerStorage(service, "id", lookup.photographerId);
  if (error) throw error;
  if (!row?.id) return null;
  return { photographer: row, region: enterPhotographerStorage(row) };
}

/** Whether new accounts may be homed outside the default region yet. */
export function signupStorageRegionSelectionEnabled() {
  return process.env.STORAGE_SIGNUP_REGIONS_ENABLED === "1";
}

/**
 * Region code to record for a brand-new account from a country, or null to
 * leave the account on the default region. Only used once every storage path
 * has been verified against a non-default region.
 */
export function storageRegionCodeForNewAccount(country: string | null | undefined): string | null {
  if (!signupStorageRegionSelectionEnabled()) return null;
  const region = storageRegionForCountry(country);
  if (region.code === defaultStorageRegion().code || region.code === "r2") return null;
  return selectableStorageRegions().some((candidate) => candidate.code === region.code) ? region.code : null;
}

/** Record a region for an account that has none yet (never overwrites). */
export async function assignPhotographerStorageRegion(
  service: PhotographerQueryClient,
  photographerId: string,
  code: string,
) {
  if (!getStorageRegion(code)) throw new Error(`Unknown storage region "${code}".`);
  const { error } = await service
    .from("photographers")
    .update({ storage_region: code })
    .eq("id", photographerId)
    .is("storage_region", null);
  if (error) throw error;
}
