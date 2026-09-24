import { createHash } from "node:crypto";

/** Stable across JSON key ordering; array order remains significant. */
export function canonicalCheckoutJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalCheckoutJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalCheckoutJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function checkoutAttemptIdentity(scope: string, payload: unknown, attemptId?: string | null) {
  if (attemptId && !/^[0-9a-f-]{36}$/i.test(attemptId)) throw new Error("Invalid checkout attempt.");
  const hash = createHash("sha256").update(canonicalCheckoutJson({ scope, payload })).digest("hex");
  // Old browser versions also receive retry protection. Intentional identical
  // purchases use a fresh explicit attempt ID after the previous cart is cleared.
  const key = createHash("sha256").update(`${scope}:${attemptId || hash}`).digest("hex");
  return { key, hash };
}
