import { createHash } from "node:crypto";
import { rateLimit } from "@/lib/rate-limit";

// A shared school/venue network can browse several complete galleries. Image
// requests still have a global abuse budget, plus a separate signed-viewer budget.
export async function portalPreviewGlobalLimit(ip: string) {
  return rateLimit(ip, { namespace: "portal-preview-global", limit: 12000, windowSeconds: 60 });
}
export async function portalPreviewViewerLimit(ip: string, galleryId: string, email: string) {
  const key = createHash("sha256").update(JSON.stringify([ip, galleryId, email.trim().toLowerCase()])).digest("hex");
  return rateLimit(key, { namespace: "portal-preview-viewer", limit: 3000, windowSeconds: 60 });
}
