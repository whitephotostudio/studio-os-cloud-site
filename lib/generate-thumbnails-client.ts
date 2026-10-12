/**
 * Client-side helper to call the thumbnail generation API after uploading a
 * photo to R2. Database writers should persist the returned object keys; the
 * URLs remain temporarily available for older display-only callers.
 */
export async function generateThumbnails(
  storagePath: string,
  accessToken: string,
  requireGeneratedPreview = false,
): Promise<{
  thumbnailKey: string | null;
  previewKey: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
}> {
  try {
    const res = await fetch("/api/dashboard/generate-thumbnails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ storagePath }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      console.error("Thumbnail generation failed:", res.status);
      if (requireGeneratedPreview) {
        const body = await res.json().catch(() => null) as { error?: string; message?: string } | null;
        throw new Error(body?.error || body?.message || "The photo uploaded, but its preview could not be created. Retry the failed photo.");
      }
      return {
        thumbnailKey: null,
        previewKey: null,
        thumbnailUrl: null,
        previewUrl: null,
      };
    }

    const data = await res.json();
    if (requireGeneratedPreview && (!data.previewKey || data.previewKey === storagePath || !data.thumbnailKey || data.thumbnailKey === storagePath)) {
      throw new Error("The photo uploaded, but its preview could not be created. Retry the failed photo, or export it as JPEG and upload that copy.");
    }
    return {
      thumbnailKey: data.thumbnailKey || null,
      previewKey: data.previewKey || null,
      thumbnailUrl: data.thumbnailUrl || null,
      previewUrl: data.previewUrl || null,
    };
  } catch (err) {
    console.error("Thumbnail generation error:", err);
    if (requireGeneratedPreview) {
      if (err instanceof Error && err.name !== "TimeoutError" && err.name !== "TypeError") throw err;
      throw new Error("The photo uploaded, but preview creation could not be completed. Check your connection and retry the failed photo.");
    }
    return {
      thumbnailKey: null,
      previewKey: null,
      thumbnailUrl: null,
      previewUrl: null,
    };
  }
}
