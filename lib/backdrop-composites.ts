const DEFAULT_BLUR_PX = 4;
const MIN_BLUR_PX = 4;
const MAX_BLUR_PX = 24;

export type BackdropCompositeSelection = {
  id?: string | null;
  name?: string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  tier?: string | null;
  price_cents?: number | null;
  priceCents?: number | null;
  blurred?: boolean | null;
  blurAmount?: number | null;
};

export type BackdropCompositeResult = {
  buffer: Buffer;
  contentType: "image/jpeg";
  extension: ".jpg";
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

async function loadSharp() {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<any>;
  const mod = await dynamicImport("sharp");
  return mod.default ?? mod;
}

async function downloadR2(key: string) {
  const mod = await import("@/lib/r2");
  return mod.r2Download(key);
}

function safeNumber(value: number | null | undefined) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function photoBaseNameFromFileName(name: string | null | undefined) {
  let base = clean(name).split(/[?#]/)[0].split("/").pop() ?? "";
  for (let index = 0; index < 3; index += 1) {
    base = base.replace(/\.[^.]+$/i, "");
    base = base.replace(/_(preview|thumbnail|cutout|nobg)$/i, "");
  }
  return base;
}

function folderFromStoragePath(storagePath: string | null | undefined) {
  const normalized = clean(storagePath)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function normalizeOriginalKey(value: string | null | undefined) {
  const key = (r2KeyFromAnyUrlLocal(value) || clean(value))
    .replace(/^\/+/, "")
    .split("?")[0]
    .split("#")[0]
    .replace(/_(preview|thumbnail)\.[^.]+$/i, ".jpg");
  return key.includes("..") ? "" : key;
}

function r2KeyFromAnyUrlLocal(input: string | null | undefined): string {
  const value = clean(input);
  if (!value) return "";

  if (!/^https?:\/\//i.test(value)) {
    const stripped = value.replace(/^\/+/, "");
    if (stripped.startsWith("api/r2/img/")) {
      return decodeURIComponent(stripped.slice("api/r2/img/".length));
    }
    return decodeURIComponent(stripped);
  }

  try {
    const parsed = new URL(value);
    if (parsed.pathname.startsWith("/api/r2/img/")) {
      return decodeURIComponent(parsed.pathname.slice("/api/r2/img/".length));
    }
    if (/\.r2\.dev$/i.test(parsed.host)) {
      return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    }
    if (/\.r2\.cloudflarestorage\.com$/i.test(parsed.host)) {
      const stripped = parsed.pathname.replace(/^\/+/, "");
      const slash = stripped.indexOf("/");
      return slash >= 0 ? decodeURIComponent(stripped.slice(slash + 1)) : "";
    }
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

function nobgCandidateKeysForOriginalKey(originalKey: string) {
  const folder = folderFromStoragePath(originalKey);
  const baseName = photoBaseNameFromFileName(originalKey);
  if (!folder || !baseName) return [];

  return unique([
    originalKey ? `nobg-photos/${originalKey}.png` : null,
    originalKey ? `nobg-photos/${originalKey}_cutout.png` : null,
    originalKey ? `nobg-photos/${originalKey}_nobg.png` : null,
    `nobg-photos/${folder}/${baseName}_cutout.png`,
    `nobg-photos/${folder}/${baseName}_nobg.png`,
    `nobg-photos/${folder}/${baseName}.png`,
  ]);
}

async function loadHttpsImageBytes(value: string | null | undefined) {
  const raw = clean(value);
  if (!/^https:\/\//i.test(raw)) return null;
  const response = await fetch(raw, { cache: "no-store", redirect: "follow" });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

async function firstReadableImageObject(keys: string[]) {
  for (const key of keys) {
    try {
      return await downloadR2(key);
    } catch {
      // Try the next known background-removal naming convention.
    }
  }
  return null;
}

async function loadTrustedImageBytes(value: string | null | undefined) {
  const raw = clean(value);
  if (!raw) return null;

  const key = normalizeOriginalKey(raw);
  if (key) {
    try {
      return await downloadR2(key);
    } catch {
      // Some backdrop URLs are stored outside R2; fall back to HTTPS below.
    }
  }

  return loadHttpsImageBytes(raw);
}

function backdropImageUrl(backdrop: BackdropCompositeSelection | null | undefined) {
  return clean(backdrop?.image_url) || clean(backdrop?.imageUrl);
}

function backdropBlur(backdrop: BackdropCompositeSelection | null | undefined) {
  if (!backdrop?.blurred) return 0;
  const blur = safeNumber(backdrop.blurAmount) ?? DEFAULT_BLUR_PX;
  return Math.min(MAX_BLUR_PX, Math.max(MIN_BLUR_PX, Math.round(blur)));
}

export function hasBackdropCompositeSelection(
  backdrop: BackdropCompositeSelection | null | undefined,
) {
  return Boolean(backdropImageUrl(backdrop));
}

export function backdropCompositeFileName(
  originalName: string | null | undefined,
  backdrop: BackdropCompositeSelection | null | undefined,
) {
  const source = clean(originalName).split(/[?#]/)[0].split("/").pop() || "photo.jpg";
  const dot = source.lastIndexOf(".");
  const base = (dot > 0 ? source.slice(0, dot) : source).replace(/[\\/:*?"<>|\r\n]+/g, "_");
  const backdropName = clean(backdrop?.name)
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .replace(/\s+/g, "_");
  return `${base}${backdropName ? `_${backdropName}` : ""}_backdrop.jpg`;
}

export async function composeBackdropImage(options: {
  originalUrlOrKey: string | null | undefined;
  backdrop: BackdropCompositeSelection | null | undefined;
  orientation?: "portrait" | "landscape" | null;
}): Promise<BackdropCompositeResult | null> {
  const originalKey = normalizeOriginalKey(options.originalUrlOrKey);
  const backdropUrl = backdropImageUrl(options.backdrop);
  if (!originalKey || !backdropUrl) return null;

  const [foregroundBuffer, backdropBuffer] = await Promise.all([
    firstReadableImageObject(nobgCandidateKeysForOriginalKey(originalKey)),
    loadTrustedImageBytes(backdropUrl),
  ]);
  if (!foregroundBuffer || !backdropBuffer) return null;

  const sharp = await loadSharp();
  const foregroundMeta = await sharp(foregroundBuffer, { animated: false }).metadata();
  const sourceWidth = foregroundMeta.width ?? 0;
  const sourceHeight = foregroundMeta.height ?? 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  const isLandscape = options.orientation === "landscape";
  const canvasHeight = sourceHeight;
  const canvasWidth = isLandscape
    ? Math.max(sourceWidth, Math.round(canvasHeight * (4 / 3)))
    : sourceWidth;

  let background = sharp(backdropBuffer, { animated: false }).resize(canvasWidth, canvasHeight, {
    fit: "cover",
    position: "center",
  });
  const blurPx = backdropBlur(options.backdrop);
  if (blurPx > 0) {
    background = background.blur(blurPx);
  }
  const backgroundBuffer = await background.jpeg({ quality: 95 }).toBuffer();

  let overlayInput = foregroundBuffer;
  let left = 0;
  let top = 0;

  if (isLandscape) {
    const scale = 1.05;
    const targetHeight = Math.round(canvasHeight * scale);
    const targetWidth = Math.round(targetHeight * (sourceWidth / sourceHeight));
    overlayInput = await sharp(foregroundBuffer, { animated: false })
      .resize(targetWidth, targetHeight, { fit: "contain" })
      .png()
      .toBuffer();
    left = Math.round((canvasWidth - targetWidth) / 2);
    top = Math.max(0, Math.round((canvasHeight - targetHeight) / 2 + canvasHeight * 0.04));
  }

  const buffer = await sharp(backgroundBuffer, { animated: false })
    .composite([{ input: overlayInput, left, top }])
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();

  return {
    buffer,
    contentType: "image/jpeg",
    extension: ".jpg",
  };
}
