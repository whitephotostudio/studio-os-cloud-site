/**
 * Client-side helper to upload a file to Cloudflare R2 via our API route.
 * Returns the public URL and storage key.
 */
export async function uploadToR2(
  file: File,
  key: string,
  accessToken: string,
): Promise<{ publicUrl: string; key: string } | null> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("key", key);

    const res = await fetch("/api/dashboard/upload-to-r2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    });

    if (!res.ok) {
      console.error("R2 upload failed:", res.status);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error("R2 upload error:", err);
    return null;
  }
}
