export type CheckoutTaxSettings = {
  enabled: boolean;
  percent: number;
  label: string;
  country: string;
  ratesByCountry: Record<string, number>;
};

export type StudioTaxSettingsSource = {
  tax_enabled?: unknown;
  tax_percent?: unknown;
  tax_label?: unknown;
  tax_country?: unknown;
  tax_rates_by_country?: unknown;
  taxEnabled?: unknown;
  taxPercent?: unknown;
  taxLabel?: unknown;
  taxCountry?: unknown;
  taxRatesByCountry?: unknown;
} | null | undefined;

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
  fallbackSettings?: StudioTaxSettingsSource,
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
  const galleryTax: CheckoutTaxSettings = {
    enabled: asBoolean(commerce.taxEnabled ?? extras.taxEnabled, false) && percent > 0,
    percent,
    label: asString(commerce.taxLabel ?? extras.taxLabel, "Tax"),
    country,
    ratesByCountry,
  };

  if (galleryTax.enabled || !fallbackSettings) return galleryTax;

  const fallback = asObject(fallbackSettings);
  const fallbackRatesByCountry = {
    ...parseRates(fallback.tax_rates_by_country),
    ...parseRates(fallback.taxRatesByCountry),
  };
  const fallbackCountry = normalizeCountry(
    countryOverride ||
      fallback.tax_country ||
      fallback.taxCountry ||
      commerce.taxCountry ||
      extras.taxCountry,
    "CA",
  );
  const fallbackBasePercent = asNumber(
    fallback.tax_percent ?? fallback.taxPercent,
    fallbackRatesByCountry[fallbackCountry] ?? 0,
  );
  const fallbackPercent = Math.min(
    100,
    Math.max(0, fallbackRatesByCountry[fallbackCountry] ?? fallbackBasePercent),
  );

  return {
    enabled:
      asBoolean(fallback.tax_enabled ?? fallback.taxEnabled, false) &&
      fallbackPercent > 0,
    percent: fallbackPercent,
    label: asString(fallback.tax_label ?? fallback.taxLabel, galleryTax.label),
    country: fallbackCountry,
    ratesByCountry: fallbackRatesByCountry,
  };
}

export function calculateCheckoutTaxCents(
  taxableCents: number,
  gallerySettings: unknown,
  countryOverride?: string | null,
  fallbackSettings?: StudioTaxSettingsSource,
) {
  const tax = resolveCheckoutTaxSettings(
    gallerySettings,
    countryOverride,
    fallbackSettings,
  );
  if (!tax.enabled || taxableCents <= 0) return 0;
  return Math.round(taxableCents * (tax.percent / 100));
}

export function applyCheckoutTaxFallbackToSettings<TSettings>(
  gallerySettings: TSettings,
  fallbackSettings?: StudioTaxSettingsSource,
) {
  const tax = resolveCheckoutTaxSettings(gallerySettings, null, fallbackSettings);
  if (!tax.enabled) return gallerySettings;

  const settings = asObject(gallerySettings);
  const extras = asObject(settings.extras);
  const commerce = asObject(settings.commerce);

  return {
    ...settings,
    extras: {
      ...extras,
      taxEnabled: tax.enabled,
      taxPercent: tax.percent,
      taxLabel: tax.label,
      taxCountry: tax.country,
      taxRatesByCountry: tax.ratesByCountry,
    },
    commerce: {
      ...commerce,
      taxEnabled: tax.enabled,
      taxPercent: tax.percent,
      taxLabel: tax.label,
      taxCountry: tax.country,
      taxRatesByCountry: tax.ratesByCountry,
    },
  } as TSettings;
}
