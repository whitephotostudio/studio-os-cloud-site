/** Album originals go directly to R2 so full-resolution photos never pass
 * through the web function's small request-body limit. Authorization still
 * happens on our owned-resource signing route before any bytes are sent. */
export const PROJECT_PHOTO_MAX_BYTES = 250 * 1024 * 1024;
export const PROJECT_PHOTO_ACCEPT = ".jpg,.jpeg,.png,.webp,.avif,image/jpeg,image/png,image/webp,image/avif";

const PHOTO_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", avif: "image/avif",
};

export function projectPhotoContentType(file: Pick<File, "name" | "type" | "size">): string {
  if (!file.size) throw new Error("This photo is empty. Choose another file.");
  if (file.size > PROJECT_PHOTO_MAX_BYTES) throw new Error("Use a photo smaller than 250 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = file.type.toLowerCase() === "image/jpg" ? "image/jpeg" : file.type.toLowerCase();
  if (Object.values(PHOTO_TYPES).includes(type)) return type;
  // Some browsers omit the MIME type for folder-picked files.
  if ((!type || type === "application/octet-stream") && PHOTO_TYPES[extension]) return PHOTO_TYPES[extension];
  throw new Error("Use a JPEG, PNG, WebP, or AVIF photo. Export RAW, TIFF, and HEIC files as JPEG first.");
}

export async function withPhotoUploadTimeout<T>(operation: Promise<T>, milliseconds = 30000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Checking your sign-in took too long. Check your connection and retry the failed photos.")), milliseconds);
      }),
    ]);
  } finally { if (timeout) clearTimeout(timeout); }
}

async function uploadResponseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (response.status === 401) return new Error("Your session has expired. Sign in again, then retry the failed photos.");
  return new Error(body?.error || body?.message || fallback);
}

export async function uploadProjectPhotoToR2(file: File, key: string, accessToken: string): Promise<{
  key: string; publicUrl: string; contentType: string;
}> {
  const contentType = projectPhotoContentType(file);
  if (!accessToken) throw new Error("Your session has expired. Sign in again, then retry the failed photos.");

  let signedResponse: Response;
  try {
    signedResponse = await fetch("/api/dashboard/r2-access", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ action: "sign-upload", key, contentType, contentLength: file.size }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("Could not prepare the photo upload. Check your connection and retry.");
  }
  if (!signedResponse.ok) throw await uploadResponseError(signedResponse, "Could not prepare the photo upload. Please retry.");
  const ticket = await signedResponse.json().catch(() => null) as {
    ok?: boolean; key?: string; url?: string; headers?: Record<string, string>;
  } | null;
  if (!ticket?.ok || ticket.key !== key || !ticket.url?.startsWith("https://")) {
    throw new Error("Photo storage did not return a valid upload link. Please retry.");
  }
  let uploaded: Response;
  try {
    uploaded = await fetch(ticket.url, {
      method: "PUT", credentials: "omit", headers: ticket.headers,
      body: file, signal: AbortSignal.timeout(300000),
    });
  } catch {
    throw new Error("Photo storage could not be reached. Check your connection and retry the failed photos.");
  }
  if (!uploaded.ok) throw new Error("Photo storage could not save this photo. Please retry the failed photos.");
  return { key, publicUrl: key, contentType };
}
