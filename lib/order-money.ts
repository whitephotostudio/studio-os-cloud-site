/** Saved prices remain two-decimal minor units; displaying a currency never converts them. */
export function formatOrderMoney(cents: number | null | undefined, currency: unknown = "cad") {
  const amount = (Number(cents ?? 0) || 0) / 100;
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(code)) return `${amount.toFixed(2)} (currency unavailable)`;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: code,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
