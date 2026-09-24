// Memory only: never persist private dashboard lists to browser storage.
// Every page visit still revalidates against the authenticated data source.
const MAX_AGE_MS = 5 * 60 * 1000;
type Entry = { value: unknown; savedAt: number };
const entries = new Map<string, Entry>();
let owner: string | null = null;

export function clearDashboardListCache() {
  entries.clear();
  owner = null;
}

export function readDashboardListCache<T>(userId: string, key: string): T | undefined {
  if (owner !== userId) {
    clearDashboardListCache();
    owner = userId;
  }
  const entry = entries.get(key);
  if (!entry || Date.now() - entry.savedAt >= MAX_AGE_MS) {
    entries.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function writeDashboardListCache<T>(userId: string, key: string, value: T) {
  // An old request must not repopulate the cache after sign-out/account switch.
  if (owner !== userId) return;
  entries.set(key, { value, savedAt: Date.now() });
}

export function invalidateDashboardListCache(key: string) {
  entries.delete(key);
}
