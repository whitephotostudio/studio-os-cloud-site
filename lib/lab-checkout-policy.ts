/**
 * Native lab price sheets are staged separately from existing studio fulfillment.
 * They must not silently become ordinary print purchases through an old client,
 * a direct package ID, or a gallery with no selected profile. Activation requires
 * a separately verified lab checkout/asset/production release.
 */
export function labCheckoutIssue(packages: readonly { items?: unknown }[]): string | null {
  const labProduct = packages.some((pkg) => Array.isArray(pkg.items) && pkg.items.some(
    (item: unknown) => item !== null && typeof item === "object" && "lab" in item,
  ));
  return labProduct
    ? "This lab price sheet is being prepared. Please contact the photographer before ordering these products."
    : null;
}
