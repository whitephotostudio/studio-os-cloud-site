export type GalleryImagePriority = "high" | "low" | "auto";

type ImageEntry = {
  image: HTMLImageElement;
  promise: Promise<HTMLImageElement>;
  ready: boolean;
  expiresAt: number;
  pixels: number;
};

type GalleryImageCacheOptions = {
  createImage?: () => HTMLImageElement;
  now?: () => number;
  maxEntries?: number;
  maxDecodedPixels?: number;
  ttlMs?: number;
  loadTimeoutMs?: number;
};

/** Page-local decoded images; protected preview URLs keep their server no-store policy. */
export function createGalleryImageCache({
  createImage = () => new Image(),
  now = Date.now,
  maxEntries = 48,
  maxDecodedPixels = 12_000_000,
  ttlMs = 120_000,
  loadTimeoutMs = 15_000,
}: GalleryImageCacheOptions = {}) {
  const entries = new Map<string, ImageEntry>();

  function prune() {
    const time = now();
    for (const [src, entry] of entries) {
      if (entry.expiresAt <= time) entries.delete(src);
    }
    let pixels = Array.from(entries.values()).reduce((sum, entry) => sum + entry.pixels, 0);
    for (const [src, entry] of entries) {
      if (entries.size <= maxEntries && pixels <= maxDecodedPixels) break;
      entries.delete(src);
      pixels -= entry.pixels;
    }
  }

  function touch(src: string, entry: ImageEntry) {
    entries.delete(src);
    entries.set(src, entry);
  }

  function peek(src: string): HTMLImageElement | null {
    prune();
    const entry = entries.get(src);
    if (!entry?.ready) return null;
    touch(src, entry);
    return entry.image;
  }

  function load(src: string, priority: GalleryImagePriority = "auto"): Promise<HTMLImageElement> {
    if (!src) return Promise.reject(new Error("Preview image is missing."));
    prune();
    const existing = entries.get(src);
    if (existing) {
      if (priority === "high") existing.image.fetchPriority = "high";
      touch(src, existing);
      return existing.promise;
    }

    let image: HTMLImageElement;
    try { image = createImage(); } catch (error) { return Promise.reject(error); }
    image.decoding = "async";
    image.fetchPriority = priority;
    // Native R2 URLs and these authorized gateways can reach storage without
    // CORS rules. A gateway's same-origin URL still redirects cross-origin;
    // anonymous CORS would reject its image before canvas consumers can draw it.
    let anonymousCors = true;
    try {
      const origin = typeof window === "undefined" ? "https://gallery.invalid" : window.location.origin;
      const url = new URL(src, origin);
      const redirectsToPrivateStorage = url.pathname.startsWith("/api/r2/img/") ||
        url.pathname.startsWith("/api/storage/legacy-media/");
      anonymousCors = !redirectsToPrivateStorage && !/\.r2\.cloudflarestorage\.com$/i.test(url.hostname);
    } catch { /* Let the image loader report an invalid URL. */ }
    image.crossOrigin = anonymousCors ? "anonymous" : null;

    let resolveImage!: (image: HTMLImageElement) => void;
    let rejectImage!: (error: Error) => void;
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      resolveImage = resolve;
      rejectImage = reject;
    });
    const entry: ImageEntry = { image, promise, ready: false, expiresAt: now() + loadTimeoutMs, pixels: 0 };
    entries.set(src, entry);
    prune();
    let settled = false;
    let decoding = false;
    const timer = setTimeout(() => fail(), loadTimeoutMs);

    function cleanup() {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
    }

    function fail() {
      if (settled) return;
      settled = true;
      cleanup();
      if (entries.get(src) === entry) entries.delete(src);
      rejectImage(new Error("Preview image could not be loaded."));
    }

    image.onload = () => {
      if (settled || decoding) return;
      decoding = true;
      void (async () => {
        try {
          // Decode once before consumers draw; onload alone can defer decoding
          // until a large canvas draw and stall photo navigation.
          if (typeof image.decode === "function") await image.decode();
        } catch {
          if (!image.naturalWidth || !image.naturalHeight) { fail(); return; }
        }
        if (settled) return;
        if (!image.naturalWidth || !image.naturalHeight) { fail(); return; }
        settled = true;
        cleanup();
        entry.ready = true;
        entry.expiresAt = now() + ttlMs;
        entry.pixels = image.naturalWidth * image.naturalHeight;
        if (entries.get(src) === entry) prune();
        resolveImage(image);
      })();
    };
    image.onerror = fail;
    image.src = src;
    return promise;
  }

  return { load, peek };
}

const galleryImages = createGalleryImageCache();
export const loadGalleryImage = galleryImages.load;
export const cachedGalleryImage = galleryImages.peek;

/** Request the existing small, authorized derivative for thumbnail canvases. */
export function galleryThumbnailUrl(src: string): string {
  if (!src) return src;
  try {
    const url = new URL(src, "https://gallery.invalid");
    if (!/^\/api\/portal\/(school|event)-preview\//.test(url.pathname)) return src;
    url.searchParams.set("size", "thumbnail");
    return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")
      ? url.toString()
      : `${url.pathname}${url.search}${url.hash}`;
  } catch { return src; }
}
