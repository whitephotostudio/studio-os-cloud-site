/** Keep an attempt for each cart, including when another gallery is opened. */
export async function checkoutAttemptForPayload(scope: string, payload: unknown, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  const fingerprint = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  const key = `studio-os-checkout-attempt:${scope}:${fingerprint}`;
  const saved = storage.getItem(key);
  if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
  const id = crypto.randomUUID();
  // Persistence failures stop before any order request; never silently issue
  // a fresh attempt after losing the previous response.
  storage.setItem(key, id);
  return id;
}
