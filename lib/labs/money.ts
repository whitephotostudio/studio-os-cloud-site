import type { LabRounding } from "./types";

// Intl accepts invented three-letter codes, so NumberFormat alone cannot
// validate a catalog's currency. Use the runtime's supported ISO currency set.
const currencies = new Set(Intl.supportedValuesOf("currency"));
const minorUnitCache = new Map<string, number>();

export function isLabCurrency(currency: unknown): currency is string {
  return typeof currency === "string" && /^[A-Z]{3}$/.test(currency) && currencies.has(currency);
}
export const isSupportedCurrency = isLabCurrency;

export function currencyMinorUnits(currency: string): number {
  if (!isLabCurrency(currency)) throw new TypeError("Use a supported uppercase ISO 4217 currency code.");
  const cached = minorUnitCache.get(currency);
  if (cached !== undefined) return cached;
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  if (digits === undefined || !Number.isInteger(digits) || digits < 0 || digits > 4) throw new TypeError("This currency's minor unit is unsupported.");
  minorUnitCache.set(currency, digits);
  return digits;
}

export function currencyScale(currency: string): number { return 10 ** currencyMinorUnits(currency); }

/** Plain decimal major units to safe integer minor units, without float rounding. */
export function parseCurrencyAmount(value: string, currency: string): number | null {
  if (!isLabCurrency(currency) || typeof value !== "string") return null;
  const text = value.trim();
  if (text.length > 32) return null;
  const digits = currencyMinorUnits(currency), match = text.match(/^(\d+)(?:\.(\d*))?$/);
  if (!match || (match[2]?.length ?? 0) > digits) return null;
  const integer = BigInt(match[1]) * BigInt(10 ** digits) + BigInt((match[2] || "").padEnd(digits, "0") || "0");
  return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : null;
}

/** Fixed plain decimal for editable amount inputs, including 0- and 3-digit currencies. */
export function formatCurrencyAmount(minorUnits: number, currency: string): string {
  const digits = currencyMinorUnits(currency);
  if (!Number.isSafeInteger(minorUnits)) throw new TypeError("A safe integer amount in currency minor units is required.");
  const sign = minorUnits < 0 ? "-" : "", absolute = Math.abs(minorUnits).toString().padStart(digits + 1, "0");
  return sign + (digits ? `${absolute.slice(0, -digits)}.${absolute.slice(-digits)}` : absolute);
}

/** Localized display. Stored costCents/retailCents fields always mean minor units. */
export function formatCurrency(minorUnits: number, currency: string, locale = "en-CA"): string {
  if (!Number.isSafeInteger(minorUnits)) throw new TypeError("A safe integer amount in currency minor units is required.");
  return new Intl.NumberFormat(locale, { style: "currency", currency,
    minimumFractionDigits: currencyMinorUnits(currency), maximumFractionDigits: currencyMinorUnits(currency),
  }).format(minorUnits / currencyScale(currency));
}
export const formatCurrencyMinor = formatCurrency;

export function roundedLabRetail(costMinorUnits: number, markupPercent: number, rounding: LabRounding, currency: string): number {
  if (!Number.isSafeInteger(costMinorUnits) || costMinorUnits < 0 || !Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 10_000) {
    throw new TypeError("Valid nonnegative cost and markup values are required.");
  }
  const scale = currencyScale(currency), digits = currencyMinorUnits(currency);
  const raw = Math.round(costMinorUnits * (1 + markupPercent / 100));
  if (!Number.isSafeInteger(raw)) throw new TypeError("The retail amount is too large.");
  if (rounding === "nearest-dollar") return Math.round(raw / scale) * scale;
  if (rounding === "0.99") {
    // .99 is .990 in a three-digit currency. JPY has no fractional amounts.
    if (digits === 0) return raw;
    const ending = scale - 10 ** Math.max(0, digits - 2);
    return Math.max(ending, Math.ceil((raw - ending) / scale) * scale + ending);
  }
  if (rounding !== "none") throw new TypeError("Choose a supported rounding rule.");
  return raw;
}
