/** Copied into a temporary local Next route by the acceptance runner only. */
import { NextRequest } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const configured = process.env.COLLAGE_E2E_ORIGIN || "";
  const fixture = new URL(configured);
  if (fixture.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(fixture.hostname)) throw Error("Use an isolated loopback fixture server.");
  const { path } = await context.params;
  const target = new URL(`/${path.join("/")}${request.nextUrl.search}`, fixture);
  const headers = new Headers(request.headers);
  headers.delete("host"); headers.set("origin", fixture.origin); headers.set("sec-fetch-site", "same-origin");
  const response = await fetch(target, { method: request.method, headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(), redirect: "manual", cache: "no-store" });
  const output = new Headers(response.headers); output.delete("content-encoding"); output.delete("content-length");
  if (response.headers.get("content-type")?.includes("application/json")) {
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
        typeof entry === "string" && /^(url|photo_url|preview_url|thumbnail_url|download_url|cover_url)$/.test(key) && entry.startsWith("/api/")
          ? `${fixture.origin}${entry}` : rewrite(entry)]));
      return value;
    };
    return Response.json(rewrite(await response.json()), { status: response.status, headers: output });
  }
  return new Response(response.body, { status: response.status, headers: output });
}
export const GET = proxy;
export const POST = proxy;
