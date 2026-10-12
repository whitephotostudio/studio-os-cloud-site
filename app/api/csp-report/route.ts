import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const MAX_REPORT_BYTES = 32_768;
const MAX_REPORTS = 10;

// Gallery URLs may contain PINs and student names. Diagnostics retain origins
// only; samples, referrers, policy nonces and arbitrary fields stay private.
function originOnly(value: unknown) {
  if (typeof value !== "string") return undefined;
  if (["inline", "eval", "data", "blob", "self"].includes(value)) return value;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : undefined;
  } catch { return undefined; }
}

function directiveOnly(value: unknown) {
  if (typeof value !== "string") return undefined;
  const directive = value.split(/\s/, 1)[0];
  return /^[a-z-]{1,64}$/.test(directive) ? directive : undefined;
}

function reportSummary(report: Record<string, unknown>, format: string) {
  return {
    format,
    documentOrigin: originOnly(report["document-uri"] ?? report.documentURL),
    blockedOrigin: originOnly(report["blocked-uri"] ?? report.blockedURL),
    sourceOrigin: originOnly(report["source-file"] ?? report.sourceFile),
    directive: directiveOnly(report["effective-directive"] ?? report.effectiveDirective ?? report["violated-directive"] ?? report.violatedDirective),
  };
}

async function boundedBody(request: NextRequest) {
  if (Number(request.headers.get("content-length")) > MAX_REPORT_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      total += value.byteLength;
      if (total > MAX_REPORT_BYTES) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

/** Accept enforcing CSP diagnostics without retaining private credentials. */
export async function POST(request: NextRequest) {
  try {
    const raw = await boundedBody(request);
    if (!raw) return new NextResponse(null, { status: 204 });
    const parsed: unknown = JSON.parse(raw);
    const entries = (Array.isArray(parsed) ? parsed : [parsed]).slice(0, MAX_REPORTS);
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const container = entry as Record<string, unknown>;
      const legacy = container["csp-report"];
      const body = legacy ?? container.body;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        console.warn("[csp-report]", reportSummary(body as Record<string, unknown>, legacy ? "report-uri" : "report-to"));
      }
    }
  } catch {
    // Malformed bodies and network errors must never echo untrusted input.
  }
  return new NextResponse(null, { status: 204 });
}
