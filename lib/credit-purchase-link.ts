/** Desktop URLs identify a selection only. Billing always uses the signed-in user. */
export function creditPurchaseSignInUrl(search: string) {
  const packageId = new URLSearchParams(search).get("package_id");
  const params = new URLSearchParams();
  if (packageId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(packageId)) {
    params.set("package_id", packageId);
  }
  const destination = `/credits${params.size ? `?${params}` : ""}`;
  return `/sign-in?redirect=${encodeURIComponent(destination)}`;
}

export function selectedCreditPack<T extends { id: string; code: string }>(search: string, packs: T[]) {
  const params = new URLSearchParams(search);
  return packs.find(pack => pack.id === params.get("package_id") || pack.code === params.get("pack"))?.code ?? null;
}
