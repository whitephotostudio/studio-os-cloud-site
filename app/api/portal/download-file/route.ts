import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const R2_PUBLIC_URL = (
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL ||
  process.env.R2_PUBLIC_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).replace(/\/$/, "");

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
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
  if (matchesOriginPrefix(target, R2_PUBLIC_URL)) {
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

    const headers = new Headers();
    const contentType = clean(upstream.headers.get("content-type"));
    const contentLength = clean(upstream.headers.get("content-length"));
    const cacheControl = clean(upstream.headers.get("cache-control"));

    if (contentType) headers.set("content-type", contentType);
    if (contentLength) headers.set("content-length", contentLength);
    headers.set("cache-control", cacheControl || "private, no-store");

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
