import { isSupportedOrderCurrency } from "./order-currency";

export type BusinessCountry = "CA" | "US";

export class ConnectProfileError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function normalizeBusinessCountry(value: unknown): BusinessCountry | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new ConnectProfileError("Choose Canada or the United States as your business country.");
  const country = value.trim().toUpperCase();
  if (country !== "CA" && country !== "US") throw new ConnectProfileError("Choose Canada or the United States as your business country.");
  return country;
}

export function normalizeSelectedSalesCurrency(value: unknown): string | null {
  if (value == null || value === "") return null;
  const currency = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!isSupportedOrderCurrency(currency)) throw new ConnectProfileError("Choose a supported sales currency.");
  return currency;
}

export function verifiedConnectCountry(account: { country?: string | null }, selectedCountry?: string | null): string {
  const actual = account.country?.trim().toUpperCase();
  if (!actual || !/^[A-Z]{2}$/.test(actual)) throw new ConnectProfileError("Unable to verify the Stripe account’s business country. Try refreshing its status before continuing.", 409);
  if (selectedCountry && actual !== selectedCountry) {
    throw new ConnectProfileError(`Your Stripe account is registered in ${actual}, but your studio business country is ${selectedCountry}. Contact Studio OS support to review this account before continuing.`, 409);
  }
  return actual;
}
