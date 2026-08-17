import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_BUCKET = process.env.R2_BUCKET_NAME || "whitephoto-media";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function safeDownloadFileName(raw: string, fallback = "photo.jpg") {
  const lastSegment = clean(raw).split("/").pop()?.split("\\").pop() ?? "";
  let decoded = lastSegment;
  try {
    decoded = decodeURIComponent(lastSegment);
  } catch {
    decoded = lastSegment;
  }
  const sanitized = Array.from(decoded)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      const isLetter =
        (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
      const isDigit = code >= 48 && code <= 57;
      const isSafePunct =
        ch === "." ||
        ch === "_" ||
        ch === " " ||
        ch === "(" ||
        ch === ")" ||
        ch === "-";
      return isLetter || isDigit || isSafePunct ? ch : "_";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || fallback;
}

function matchesOriginPrefix(target: URL, baseUrl: string) {
  const safeBaseUrl = clean(baseUrl);
  if (!safeBaseUrl) return false;

  try {
    const parsedBaseUrl = new URL(safeBaseUrl);
    if (target.origin !== parsedBaseUrl.origin) return false;

    const basePath = parsedBaseUrl.pathname.replace(/\/+$/, "");
    if (!basePath) return true;
    return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
  } catch {
    return false;
  }
}

function isAllowedDownloadUrl(target: URL) {
  if (isAllowedSignedR2Url(target)) {
    return true;
  }

  if (matchesOriginPrefix(target, SUPABASE_URL)) {
    return (
      target.pathname.startsWith("/storage/v1/object/public/") ||
      target.pathname.startsWith("/storage/v1/render/image/public/")
    );
  }

  return false;
}

function isAllowedSignedR2Url(target: URL) {
  if (!R2_ACCOUNT_ID || !R2_BUCKET) return false;
  if (target.protocol !== "https:") return false;
  if (target.host !== `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`) return false;

  const pathPrefix = `/${R2_BUCKET}/`;
  if (!target.pathname.startsWith(pathPrefix)) return false;

  return (
    target.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256" &&
    Boolean(clean(target.searchParams.get("X-Amz-Credential"))) &&
    Boolean(clean(target.searchParams.get("X-Amz-Date"))) &&
    Boolean(clean(target.searchParams.get("X-Amz-Expires"))) &&
    Boolean(clean(target.searchParams.get("X-Amz-SignedHeaders"))) &&
    Boolean(clean(target.searchParams.get("X-Amz-Signature")))
  );
}

export async function GET(request: NextRequest) {
  try {
    const sourceUrl = clean(request.nextUrl.searchParams.get("url"));
    if (!sourceUrl) {
      return NextResponse.json(
        { ok: false, message: "Missing download URL." },
        { status: 400 },
      );
    }

    let target: URL;
    try {
      target = new URL(sourceUrl);
    } catch {
      return NextResponse.json(
        { ok: false, message: "Invalid download URL." },
        { status: 400 },
      );
    }

    if (!["http:", "https:"].includes(target.protocol)) {
      return NextResponse.json(
        { ok: false, message: "Unsupported download protocol." },
        { status: 400 },
      );
    }

    if (!isAllowedDownloadUrl(target)) {
      return NextResponse.json(
        { ok: false, message: "That file cannot be downloaded from this route." },
        { status: 403 },
      );
    }

    const upstream = await fetch(target.toString(), {
      cache: "no-store",
      redirect: "follow",
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { ok: false, message: "Could not download the requested file." },
        { status: upstream.status || 502 },
      );
    }

    const requestedName = clean(request.nextUrl.searchParams.get("name"));
    const downloadName = safeDownloadFileName(requestedName || target.pathname);

    const headers = new Headers();
    const contentType = clean(upstream.headers.get("content-type"));
    const contentLength = clean(upstream.headers.get("content-length"));
    const cacheControl = clean(upstream.headers.get("cache-control"));

    if (contentType) headers.set("content-type", contentType);
    if (contentLength) headers.set("content-length", contentLength);
    headers.set("cache-control", cacheControl || "private, no-store");
    headers.set(
      "content-disposition",
      `attachment; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(
        downloadName,
      )}`,
    );

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Could not proxy the requested file." },
      { status: 502 },
    );
  }
}
