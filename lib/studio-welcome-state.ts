type WelcomeStorage = Pick<Storage, "getItem" | "setItem">;

export function studioWelcomeStorageKey(photographerId: string, version: string): string {
  return `studio_os_download_welcome_seen:${photographerId}:${version}`;
}

export function hasSeenStudioWelcome(photographerId: string, version: string, storage?: WelcomeStorage | null): boolean {
  try { return (storage ?? globalThis.localStorage)?.getItem(studioWelcomeStorageKey(photographerId, version)) === "1"; }
  catch { return false; }
}

export function markStudioWelcomeSeen(photographerId: string, version: string, storage?: WelcomeStorage | null): void {
  try { (storage ?? globalThis.localStorage)?.setItem(studioWelcomeStorageKey(photographerId, version), "1"); }
  catch { /* Storage restrictions must never block account use. */ }
}
