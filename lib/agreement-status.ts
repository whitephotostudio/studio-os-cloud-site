/** A transport failure is not evidence that a photographer needs to accept again. */
export async function loadAgreementStatus(fetcher: typeof fetch = fetch): Promise<"ok" | "required" | "no-session"> {
  const response = await fetcher("/api/dashboard/agreement/status", {
    credentials: "include", cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Agreement check unavailable");
  const payload = await response.json();
  if (payload.authenticated === false) return "no-session";
  if (payload.authenticated !== true || typeof payload.accepted !== "boolean") throw new Error("Invalid agreement status");
  return payload.accepted ? "ok" : "required";
}
