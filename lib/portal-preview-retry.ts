type PreviewImage = { src: string; isConnected: boolean; alt: string; style?: { opacity: string }; dataset: Record<string, string | undefined> };
// Native img errors hide HTTP headers. Retry once briefly, then after the
// maximum one-minute preview cooldown. Never retry indefinitely or stale nodes.
export function retryPortalPreviewImage(image: PreviewImage, schedule: (run: () => void, delay: number) => unknown = setTimeout) {
  let url: URL;
  try { url = new URL(image.src, "https://gallery.invalid"); } catch { return false; }
  if (!/^\/api\/portal\/(event|school)-preview\//.test(url.pathname)) return false;
  url.searchParams.delete("previewRetry");
  const identity = url.toString();
  if (image.dataset.previewRetrySource !== identity) {
    image.dataset.previewRetrySource = identity;
    image.dataset.previewRetryCount = "0";
  }
  const count = Number(image.dataset.previewRetryCount || 0);
  if (count >= 2) return false;
  image.dataset.previewRetryCount = String(count + 1);
  image.alt = "Preview temporarily unavailable. Retrying.";
  if (image.style) image.style.opacity = "1";
  const failedSource = image.src;
  schedule(() => {
    if (!image.isConnected || image.src !== failedSource) return;
    url.searchParams.set("previewRetry", String(count + 1));
    image.src = url.toString();
  }, count === 0 ? 1500 : 60000);
  return true;
}
