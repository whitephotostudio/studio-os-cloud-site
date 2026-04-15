/**
 * Client-side helper to call the thumbnail generation API after uploading a
 * photo to Supabase Storage.  Returns pre-generated thumbnail and preview
 * URLs that point to direct public storage paths (no Supabase Image
 * Transformations needed).
 */
export async function generateThumbnails(
  storagePath: string,
  accessToken: string,
): Promise<{ thumbnailUrl: string | null; previewUrl: string | null }> {
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
      return { thumbnailUrl: null, previewUrl: null };
    }

    const data = await res.json();
    return {
      thumbnailUrl: data.thumbnailUrl || null,
      previewUrl: data.previewUrl || null,
    };
  } catch (err) {
    console.error("Thumbnail generation error:", err);
    return { thumbnailUrl: null, previewUrl: null };
  }
}
