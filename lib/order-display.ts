export type OrderMoneyLike = {
  total_cents?: number | null;
  total_amount?: number | null;
  subtotal_cents?: number | null;
  package_price?: number | null;
};

export type OrderItemMoneyLike = {
  product_name?: string | null;
  quantity?: number | null;
  unit_price_cents?: number | null;
  line_total_cents?: number | null;
  price?: number | null;
  sku?: string | null;
};

export type ParsedOrderPhotoSelection = {
  itemIndex: number | null;
  label: string;
  url: string;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function finiteNumber(value: number | null | undefined) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function positiveCents(value: number | null | undefined) {
  const next = finiteNumber(value);
  if (next == null || next <= 0) return null;
  return Math.round(next);
}

function amountToCents(value: number | null | undefined) {
  const next = finiteNumber(value);
  if (next == null || next <= 0) return null;
  return Math.round(next * 100);
}

export function isWebImageUrl(value: string | null | undefined) {
  const raw = clean(value);
  return /^https?:\/\//i.test(raw) &&
    /\.(png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(raw);
}

export function resolveLineItemCents(item: OrderItemMoneyLike) {
  const line = finiteNumber(item.line_total_cents);
  if (line != null && line !== 0) return Math.round(line);

  const unit = finiteNumber(item.unit_price_cents);
  const qty = finiteNumber(item.quantity) ?? 1;
  if (unit != null && unit !== 0 && qty > 0) return Math.round(unit * qty);

  const price = finiteNumber(item.price);
  if (price != null && price !== 0 && qty > 0) return Math.round(price * qty * 100);

  return null;
}

export function sumLineItemCents(items: OrderItemMoneyLike[] | null | undefined) {
  let sum = 0;
  let hasValue = false;

  for (const item of items ?? []) {
    const cents = resolveLineItemCents(item);
    if (cents == null) continue;
    sum += cents;
    hasValue = true;
  }

  return hasValue && sum > 0 ? sum : null;
}

export function resolveOrderTotalCents(
  order: OrderMoneyLike,
  items?: OrderItemMoneyLike[] | null,
) {
  return positiveCents(order.total_cents) ??
    amountToCents(order.total_amount) ??
    sumLineItemCents(items) ??
    amountToCents(order.package_price) ??
    0;
}

export function resolveOrderSubtotalCents(
  order: OrderMoneyLike,
  items?: OrderItemMoneyLike[] | null,
) {
  return positiveCents(order.subtotal_cents) ??
    sumLineItemCents(items) ??
    resolveOrderTotalCents(order, items);
}

export function resolveOrderItemDisplayCents(
  item: OrderItemMoneyLike,
  items: OrderItemMoneyLike[] | null | undefined,
  orderTotalCents: number,
  index: number,
) {
  const explicit = resolveLineItemCents(item);
  if (explicit != null) return explicit;

  const count = Math.max((items ?? []).filter(Boolean).length, 1);
  if (orderTotalCents <= 0) return 0;

  const base = Math.floor(orderTotalCents / count);
  return index === count - 1
    ? orderTotalCents - base * (count - 1)
    : base;
}

function firstImageUrl(value: string) {
  const match = value.match(
    /(https?:\/\/[^\n\r]*?\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s<>"']*)?)/i,
  );
  return match?.[1]?.trim() ?? "";
}

export function parseOrderPhotoSelections(
  notes: string | null | undefined,
): ParsedOrderPhotoSelection[] {
  const raw = clean(notes);
  if (!raw) return [];

  const selections: ParsedOrderPhotoSelection[] = [];
  const seen = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    const url = firstImageUrl(line);
    if (!url || seen.has(url)) continue;

    const itemMatch = line.match(
      /^\s*Item\s*(\d+)\s*:\s*(.*?)(?:\s*(?:→|->)\s*https?:\/\/)/i,
    );
    selections.push({
      itemIndex: itemMatch ? Number(itemMatch[1]) - 1 : null,
      label: clean(itemMatch?.[2]) || "Photo",
      url,
    });
    seen.add(url);
  }

  if (selections.length > 0) return selections;

  const urlMatches = raw.match(
    /(https?:\/\/[^\n\r]*?\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s<>"']*)?)/gi,
  ) ?? [];
  return urlMatches
    .map((url) => url.trim())
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .map((url) => ({ itemIndex: null, label: "Photo", url }));
}

export function extractOrderPhotoUrls(notes: string | null | undefined) {
  return parseOrderPhotoSelections(notes).map((entry) => entry.url);
}

export function cleanOrderCustomerNote(notes: string | null | undefined) {
  const raw = clean(notes);
  if (!raw) return "";

  return raw
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^ORDER ITEM\s*\d+/i.test(t)) return false;
      if (/^PHOTO SELECTIONS/i.test(t)) return false;
      if (/^CLASS COMPOSITE/i.test(t)) return false;
      if (/^Item\s*\d+:/i.test(t)) return false;
      if (/^Combined order group/i.test(t)) return false;
      if (/^Sibling tier:/i.test(t)) return false;
      if (/^Sibling discount/i.test(t)) return false;
      if (/^Shipping:\s*\$/i.test(t)) return false;
      if (/https?:\/\//i.test(t)) return false;
      if (/^[a-f0-9-]{20,}/i.test(t)) return false;
      if (/^\d+\/[A-Za-z_]+\.(png|jpg|jpeg|webp|gif|avif)/i.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();
}
