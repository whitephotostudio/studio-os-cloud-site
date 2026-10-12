/** Finish the verified account through the same idempotent initializer as sign-in. */
export async function completeConfirmedAccountSetup(
  accessToken: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("/api/studio-os-app/status", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (response.status === 401) {
    throw new Error("Your email is confirmed. Sign in again to finish setting up your account.");
  }
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    signedIn?: boolean;
    mfaRequired?: boolean;
    trialActive?: boolean;
    trialDaysRemaining?: number;
  } | null;
  if (response.status === 403 && payload?.mfaRequired === true) {
    throw new Error("Your email is confirmed. Sign in and complete two-step verification to finish setting up your account.");
  }
  const trialDaysRemaining = payload?.trialDaysRemaining;
  if (!response.ok || payload?.ok !== true || payload.signedIn !== true ||
      typeof payload.trialActive !== "boolean" || typeof trialDaysRemaining !== "number" ||
      !Number.isInteger(trialDaysRemaining) || trialDaysRemaining < 0 ||
      (payload.trialActive && trialDaysRemaining === 0)) {
    throw new Error("Your email is confirmed, but we couldn’t finish setting up your account. Please try again.");
  }
  return {
    trialActive: payload.trialActive === true,
    trialDaysRemaining,
  };
}
