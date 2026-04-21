import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * CSP violation sink.
 *
 * Browsers POST here whenever they see something blocked by the
 * `Content-Security-Policy-Report-Only` header set in next.config.ts. We log
 * the report to the server console so it shows up in Vercel logs — that's
 * enough to triage unexpected origins (new CDN, leftover dev tool, XSS
 * attempt) before we promote the policy to an enforcing CSP.
 *
 * The legacy `report-uri` directive sends `application/csp-report`. The newer
 * `report-to` directive sends `application/reports+json`. We accept either
 * and never fail the request — the browser is a fire-and-forget client.
 */
type LegacyCspReport = {
  "csp-report"?: {
    "document-uri"?: string;
    referrer?: string;
    "violated-directive"?: string;
    "effective-directive"?: string;
    "original-policy"?: string;
    "blocked-uri"?: string;
    "status-code"?: number;
    "script-sample"?: string;
    "source-file"?: string;
    "line-number"?: number;
    "column-number"?: number;
  };
};

type ModernCspReport = {
  type?: string;
  url?: string;
  body?: {
    documentURL?: string;
    referrer?: string;
    effectiveDirective?: string;
    violatedDirective?: string;
    originalPolicy?: string;
    blockedURL?: string;
    statusCode?: number;
    sample?: string;
    sourceFile?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
};

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    // Both formats are JSON; browsers just vary the media type.
    const raw = await request.text();
    if (!raw) return NextResponse.json({ ok: true }, { status: 204 });

    let parsed: LegacyCspReport | ModernCspReport[] | ModernCspReport | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn("[csp-report] unparseable body", { contentType, raw: raw.slice(0, 500) });
      return NextResponse.json({ ok: true }, { status: 204 });
    }

    const reports: Array<Record<string, unknown>> = [];

    if (Array.isArray(parsed)) {
      // report-to batch
      for (const entry of parsed) {
        if (entry?.body) reports.push({ format: "report-to", ...entry.body });
      }
    } else if (parsed && typeof parsed === "object") {
      const legacy = (parsed as LegacyCspReport)["csp-report"];
      if (legacy) {
        reports.push({ format: "report-uri", ...legacy });
      } else if ((parsed as ModernCspReport).body) {
        const modern = parsed as ModernCspReport;
        reports.push({ format: "report-to", ...modern.body });
      }
    }

    for (const report of reports) {
      console.warn("[csp-report]", report);
    }

    // 204 No Content is the idiomatic response for report endpoints.
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[csp-report]", error);
    // Never let this surface a 500 to the browser — the browser will just
    // retry on the next violation and flood logs. Return 204 regardless.
    return new NextResponse(null, { status: 204 });
  }
}
