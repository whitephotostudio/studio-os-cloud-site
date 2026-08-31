/**
 * Client-side helper to upload a file to Cloudflare R2 via our API route.
 * Returns the durable object reference and storage key. The historical
 * `publicUrl` field name remains temporarily for client compatibility, but
 * its value is now the same private-ready object key.
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
