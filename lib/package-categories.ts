export type PackageItemValue =
  | string
  | {
      qty?: number | string | null;
      name?: string | null;
      type?: string | null;
      size?: string | null;
      finish?: string | null;
      composite?: boolean | null;
    };

export type PackageCategory =
  | "package"
  | "print"
  | "digital"
  | "specialty"
  | "metal"
  | "canvas";

type PackageCategoryInput = {
  name?: string | null;
  description?: string | null;
  category?: string | null;
  items?: PackageItemValue[] | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalize(value: string | null | undefined) {
  return clean(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatItemText(item: PackageItemValue) {
  if (typeof item === "string") return normalize(item);

  const qty =
    item.qty !== undefined && item.qty !== null && clean(String(item.qty))
      ? `${clean(String(item.qty))} `
      : "";
  return normalize([qty + clean(item.name), clean(item.type), clean(item.size), clean(item.finish)].join(" "));
}

function buildSearchText(pkg: PackageCategoryInput) {
  return [
    normalize(pkg.name),
    normalize(pkg.description),
    normalize(pkg.category),
    ...(pkg.items ?? []).map(formatItemText),
  ]
    .filter(Boolean)
    .join(" ");
}

function buildBundleSignalText(pkg: PackageCategoryInput) {
  return [
    normalize(pkg.name),
    normalize(pkg.description),
    ...(pkg.items ?? []).map(formatItemText),
  ]
    .filter(Boolean)
    .join(" ");
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}

function extractDistinctSizes(text: string) {
  const matches = text.matchAll(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/g);
  const sizes = new Set<string>();
  for (const match of matches) {
    const left = clean(match[1]);
    const right = clean(match[2]);
    if (left && right) {
      sizes.add(`${left}x${right}`);
    }
  }
  return sizes;
}

const DIGITAL_KEYWORDS = ["digital", "digitals", "download", "downloads", "usb", "file", "files", "jpeg", "jpg"];
const CANVAS_KEYWORDS = ["canvas", "canvases", "gallery wrap", "wrapped canvas"];
const METAL_KEYWORDS = ["metal", "aluminum", "aluminium"];
const SPECIALTY_KEYWORDS = [
  "specialty",
  "magnet",
  "mug",
  "ornament",
  "coaster",
  "puzzle",
  "keychain",
  "button",
  "snow globe",
  "statuette",
  "retouch",
  "retouching",
  "editing",
  "restoration",
];
const PRINT_KEYWORDS = ["print", "prints", "lustre", "luster", "glossy", "matte", "wallet", "wallets"];
const PACKAGE_KEYWORDS = ["package", "packages", "bundle", "bundles", "combo", "collection"];

function getExplicitCategory(rawCategory: string): PackageCategory | null {
  if (!rawCategory) return null;
  if (includesAny(rawCategory, DIGITAL_KEYWORDS)) return "digital";
  if (includesAny(rawCategory, CANVAS_KEYWORDS)) return "canvas";
  if (includesAny(rawCategory, METAL_KEYWORDS)) return "metal";
  if (includesAny(rawCategory, SPECIALTY_KEYWORDS)) return "specialty";
  if (includesAny(rawCategory, PRINT_KEYWORDS) || rawCategory === "individual items") return "print";
  if (includesAny(rawCategory, PACKAGE_KEYWORDS)) return "package";
  return null;
}

function hasBundleSignals(
  pkg: PackageCategoryInput,
  searchText: string,
  explicitCategory: PackageCategory | null,
) {
  const itemLabels = (pkg.items ?? []).map(formatItemText).filter(Boolean);
  const distinctSizes = extractDistinctSizes(searchText);
  const bundleSignalText = buildBundleSignalText(pkg);

  if (itemLabels.length > 1) return true;
  if (distinctSizes.size > 1) return true;
  if (/\s\+\s|^\d+\s*-\s*\d+\s*[x×]\s*\d+.*\+/.test(bundleSignalText)) return true;
  if (/\b(bundle|bundles|package|packages|combo|collection)\b/.test(bundleSignalText)) return true;
  if (/\bwallets?\b/.test(bundleSignalText) && distinctSizes.size > 0) return true;
  if (explicitCategory === "package" && !distinctSizes.size && !itemLabels.length) return true;

  return false;
}

function hasPrintSignals(searchText: string) {
  return includesAny(searchText, PRINT_KEYWORDS) || /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/.test(searchText);
}

export function getPackageCategory(pkg: PackageCategoryInput): PackageCategory {
  const rawCategory = normalize(pkg.category);
  const explicitCategory = getExplicitCategory(rawCategory);
  const searchText = buildSearchText(pkg);

  if (explicitCategory && explicitCategory !== "package") {
    return explicitCategory;
  }

  if (includesAny(searchText, DIGITAL_KEYWORDS)) return "digital";
  if (includesAny(searchText, CANVAS_KEYWORDS)) return "canvas";
  if (includesAny(searchText, METAL_KEYWORDS)) return "metal";
  if (includesAny(searchText, SPECIALTY_KEYWORDS)) return "specialty";

  if (hasBundleSignals(pkg, searchText, explicitCategory)) {
    return "package";
  }

  if (hasPrintSignals(searchText)) return "print";

  return explicitCategory ?? "package";
}
