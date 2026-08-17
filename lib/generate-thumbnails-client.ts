/**
 * Client-side helper to call the thumbnail generation API after uploading a
 * photo to R2. Database writers should persist the returned object keys; the
 * URLs remain temporarily available for older display-only callers.
 */
export async function generateThumbnails(
  storagePath: string,
  accessToken: string,
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
    });

    if (!res.ok) {
      console.error("Thumbnail generation failed:", res.status);
      return {
        thumbnailKey: null,
        previewKey: null,
        thumbnailUrl: null,
        previewUrl: null,
      };
    }

    const data = await res.json();
    return {
      thumbnailKey: data.thumbnailKey || null,
      previewKey: data.previewKey || null,
      thumbnailUrl: data.thumbnailUrl || null,
      previewUrl: data.previewUrl || null,
    };
  } catch (err) {
    console.error("Thumbnail generation error:", err);
    return {
      thumbnailKey: null,
      previewKey: null,
      thumbnailUrl: null,
      previewUrl: null,
    };
  }
}
