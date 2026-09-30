import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "sales-document-assets";
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const INVOICE_STATUS = new Set(["draft", "issued", "sent", "paid", "void"]);
const QUOTE_STATUS = new Set([
  "draft", "finalized", "sent", "accepted", "declined", "expired", "converted",
]);

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { user, mfaSatisfied } = await resolveDashboardAuth(request);
    if (!user || !mfaSatisfied) {
      return privateJson({ ok: false, message: "Please sign in again." }, 401);
    }
    const body = await request.json().catch(() => null);
    const kind = body?.kind;
    const documentId = body?.documentId;
    const asset = body?.asset;
    const status = body?.status;
    if (
      (kind !== "invoice" && kind !== "quote") ||
      typeof documentId !== "string" || !SAFE_ID.test(documentId) ||
      (asset !== "pdf" && asset !== "logo") ||
      (asset === "pdf" && (
        typeof status !== "string" ||
        !(kind === "invoice" ? INVOICE_STATUS : QUOTE_STATUS).has(status)
      ))
    ) {
      return privateJson({ ok: false, message: "Invalid sales asset." }, 400);
    }

    const service = createDashboardServiceClient();
    const { data: photographer, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (photographerError) throw photographerError;
    if (!photographer?.id) {
      return privateJson({ ok: false, message: "Photographer profile not found." }, 404);
    }
    const quota = await rateLimit(photographer.id, {
      namespace: "sales-asset-sign-download",
      limit: 300,
      windowSeconds: 60,
    });
    if (!quota.allowed) {
      return privateJson({ ok: false, message: "Too many asset requests. Retry shortly." }, 429);
    }
    const { data: document, error: documentError } = await service
      .from("sales_documents")
      .select("id")
      .eq("photographer_id", photographer.id)
      .eq("kind", kind)
      .eq("client_request_id", documentId)
      .is("deleted_at", null)
      .maybeSingle();
    if (documentError) throw documentError;
    if (!document) {
      return privateJson({ ok: false, message: "Sales document not found." }, 404);
    }

    const key = `${user.id}/${kind}/${documentId}/${asset === "logo" ? "logo" : `${status}.pdf`}`;
    const storage = service.storage.from(BUCKET);
    const { data: files, error: listError } = await storage.list(
      `${user.id}/${kind}/${documentId}`,
      { limit: 20 },
    );
    if (listError) {
      console.error("[dashboard:sales-assets:sign-download] Storage unavailable", listError);
      return privateJson({ ok: false, message: "Sales asset storage is not ready. Retry later." }, 503);
    }
    if (!files?.some((file) => file.name === (asset === "logo" ? "logo" : `${status}.pdf`))) {
      return privateJson({ ok: false, message: "Sales asset not found." }, 404);
    }
    const { data, error } = await storage.createSignedUrl(key, 60);
    if (error || !data?.signedUrl) {
      console.error("[dashboard:sales-assets:sign-download] Could not sign asset", error);
      return privateJson({ ok: false, message: "Could not open sales asset." }, 503);
    }
    return privateJson({ ok: true, signedUrl: data.signedUrl });
  } catch (error) {
    console.error("[dashboard:sales-assets:sign-download]", error);
    return privateJson({ ok: false, message: "Could not open sales asset." }, 500);
  }
}
