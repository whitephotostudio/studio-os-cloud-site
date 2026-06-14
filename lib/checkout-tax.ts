export type CheckoutTaxSettings = {
  enabled: boolean;
  percent: number;
  label: string;
  country: string;
  ratesByCountry: Record<string, number>;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeCountry(value: unknown, fallback = "CA") {
  return asString(value, fallback).trim().toUpperCase().slice(0, 2) || fallback;
}

function parseRates(value: unknown): Record<string, number> {
  const source = asObject(value);
  const rates: Record<string, number> = {};
  for (const [rawCountry, rawRate] of Object.entries(source)) {
    const country = normalizeCountry(rawCountry, "");
    const rate = asNumber(rawRate, -1);
    if (country && rate >= 0) rates[country] = Math.min(100, rate);
  }
  return rates;
}

export function resolveCheckoutTaxSettings(
  gallerySettings: unknown,
  countryOverride?: string | null,
): CheckoutTaxSettings {
  const settings = asObject(gallerySettings);
  const commerce = asObject(settings.commerce);
  const extras = asObject(settings.extras);
  const ratesByCountry = {
    ...parseRates(extras.taxRatesByCountry),
    ...parseRates(commerce.taxRatesByCountry),
  };
  const country = normalizeCountry(
    countryOverride || commerce.taxCountry || extras.taxCountry,
    "CA",
  );
  const basePercent = asNumber(
    commerce.taxPercent ?? extras.taxPercent,
    ratesByCountry[country] ?? 0,
  );
  const percent = Math.min(
    100,
    Math.max(0, ratesByCountry[country] ?? basePercent),
  );

  return {
    enabled: asBoolean(commerce.taxEnabled ?? extras.taxEnabled, false) && percent > 0,
    percent,
    label: asString(commerce.taxLabel ?? extras.taxLabel, "Tax"),
    country,
    ratesByCountry,
  };
}

export function calculateCheckoutTaxCents(
  taxableCents: number,
  gallerySettings: unknown,
  countryOverride?: string | null,
) {
  const tax = resolveCheckoutTaxSettings(gallerySettings, countryOverride);
  if (!tax.enabled || taxableCents <= 0) return 0;
  return Math.round(taxableCents * (tax.percent / 100));
}
